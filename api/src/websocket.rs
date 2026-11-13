//! WebSocket / Server-Sent Events (SSE) module for MediChain
//!
//! Provides real-time push notifications to connected clients using SSE,
//! which works with the existing actix-web + tokio + futures dependency set
//! without requiring any additional crates.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Instant;

use actix_web::{get, web, HttpResponse};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

// ============================================================================
// Push event type
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushEvent {
    /// One of: "cds_alert", "reminder_due", "lab_result", "notification"
    pub event_type: String,
    /// Optional patient identifier the event relates to
    pub patient_id: Option<String>,
    /// Arbitrary JSON payload
    pub payload: serde_json::Value,
    /// Unix timestamp (seconds since epoch)
    pub timestamp: i64,
    /// Who the event is for. Never sent to the client.
    #[serde(skip)]
    pub audience: Audience,
}

/// Who an event is for.
///
/// Every event used to reach every staff and administrator connection: a
/// doctor setting a patient's medication reminder put "Time to take: ..." on
/// the administrator's screen and on every clinician's in the hospital. An
/// event now names its audience, and a connection receives it only if its
/// account is in that audience (`delivery`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Audience {
    /// Only the patient the event is about: their own reminders.
    Patient,
    /// The patient, and the clinicians treating them
    /// (`care_access::treats_patient`).
    CareTeam,
    /// These accounts, and the patient when the event names one.
    Accounts(Vec<String>),
    /// Administrators only: security alerts.
    Administrators,
    /// Nobody. An event whose audience was never set reaches no one, rather
    /// than everyone.
    #[default]
    Nobody,
}

// ============================================================================
// Session manager
// ============================================================================

/// Manages SSE client subscriptions and broadcasts push events.
pub struct WsSessionManager {
    /// Broadcast channel used to fan-out events to all connected SSE clients.
    sender: broadcast::Sender<PushEvent>,
    /// Tracks how many active SSE streams exist per user id.
    subscribers: Arc<RwLock<HashMap<String, u32>>>,
}

impl WsSessionManager {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(1024);
        Self {
            sender,
            subscribers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Subscribe to the broadcast channel, recording the user id.
    /// Returns a `Receiver` that the SSE stream will poll.
    pub fn subscribe(&self, user_id: &str) -> broadcast::Receiver<PushEvent> {
        let mut subs = self.subscribers.write().unwrap();
        *subs.entry(user_id.to_string()).or_insert(0) += 1;
        self.sender.subscribe()
    }

    /// Decrement the subscriber count for a user id when a connection closes.
    pub fn unsubscribe(&self, user_id: &str) {
        let mut subs = self.subscribers.write().unwrap();
        if let Some(count) = subs.get_mut(user_id) {
            if *count > 0 {
                *count -= 1;
            }
        }
    }

    /// Broadcast an event to all connected SSE clients.
    /// Send errors (no active subscribers) are silently ignored.
    pub fn push_event(&self, event: PushEvent) {
        let _ = self.sender.send(event);
    }

    /// Returns the number of user ids with at least one active SSE stream.
    pub fn subscriber_count(&self) -> usize {
        self.subscribers
            .read()
            .unwrap()
            .values()
            .filter(|&&c| c > 0)
            .count()
    }
}

// ============================================================================
// SSE stream adapter
// ============================================================================

/// What a connection does with an event, before any chart check.
#[derive(Debug, PartialEq, Eq)]
enum Delivery {
    Deliver,
    Skip,
    /// Deliver only if this clinician is treating the patient.
    IfTreating(String),
}

/// Whether the account behind a connection is in an event's audience.
///
/// A patient receives events about their own record, never another patient's
/// and never an administrators-only one. Staff receive what names them, an
/// administrator receives security alerts, and a clinician receives a
/// patient's care-team events only while treating that patient.
fn delivery(user: &crate::User, event: &PushEvent) -> Delivery {
    let about = event.patient_id.as_deref();
    // An event addressed to this account by name reaches it, whoever it is.
    if let Audience::Accounts(ids) = &event.audience {
        if ids.iter().any(|id| id == &user.id) {
            return Delivery::Deliver;
        }
    }
    if user.role == crate::types::Role::Patient {
        let mine = about.is_some() && about == user.linked_patient_id.as_deref();
        let for_patients = matches!(
            event.audience,
            Audience::Patient | Audience::CareTeam | Audience::Accounts(_)
        );
        return if mine && for_patients {
            Delivery::Deliver
        } else {
            Delivery::Skip
        };
    }
    match &event.audience {
        Audience::Accounts(ids) if ids.iter().any(|id| id == &user.id) => Delivery::Deliver,
        Audience::Administrators if user.role.is_admin() => Delivery::Deliver,
        Audience::CareTeam => about
            .map(|patient| Delivery::IfTreating(patient.to_string()))
            .unwrap_or(Delivery::Skip),
        _ => Delivery::Skip,
    }
}

/// Longest the stream may stay silent before emitting a keep-alive comment.
const SSE_HEARTBEAT: std::time::Duration = std::time::Duration::from_secs(15);
/// How long a connection trusts its answer to "am I treating this patient?".
const TREATING_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(60);
/// Patients a connection remembers that answer for, before starting over.
const TREATING_CACHE_MAX: usize = 512;

/// One open `/api/events` stream: whose it is, and what it has decided.
struct Connection {
    receiver: broadcast::Receiver<PushEvent>,
    user: crate::User,
    data: web::Data<crate::AppState>,
    treating: HashMap<String, (bool, Instant)>,
    /// Whether the opening comment has been written yet.
    ///
    /// Without it this stream emitted **zero bytes** until some unrelated part
    /// of the system happened to push an event. Actix writes the response
    /// headers, but an intermediary that waits for the first body chunk before
    /// flushing them leaves the browser's `fetch()` hanging until it fails with
    /// `TypeError: Failed to fetch`. Nginx forwards headers immediately
    /// (`proxy_buffering off`), so this looked fine through the Docker gateway
    /// and failed through the Vite dev proxy — i.e. it failed in exactly the
    /// configuration a demo runs in.
    handshake_sent: bool,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.data.ws_manager.unsubscribe(&self.user.id);
    }
}

/// An SSE comment frame. Comments are ignored by `EventSource` and by this
/// project's `fetch`-based reader, so they are safe to interleave.
fn comment(text: &str) -> actix_web::web::Bytes {
    actix_web::web::Bytes::from(format!(": {}\n\n", text))
}

impl Connection {
    /// Whether this connection's account is treating `patient_id`, from a short
    /// cache so a burst of events does not become a burst of chart checks. A
    /// check that cannot be answered withholds the event.
    async fn is_treating(&mut self, patient_id: &str) -> bool {
        if let Some((answer, at)) = self.treating.get(patient_id) {
            if at.elapsed() < TREATING_CACHE_TTL {
                return *answer;
            }
        }
        let answer =
            match crate::care_access::treats_patient(&self.data, &self.user, patient_id).await {
                Ok(answer) => answer,
                Err(error) => {
                    log::warn!("event withheld: chart access unavailable: {}", error.0);
                    return false;
                }
            };
        if self.treating.len() >= TREATING_CACHE_MAX {
            self.treating.clear();
        }
        self.treating
            .insert(patient_id.to_string(), (answer, Instant::now()));
        answer
    }

    async fn may_receive(&mut self, event: &PushEvent) -> bool {
        match delivery(&self.user, event) {
            Delivery::Deliver => true,
            Delivery::Skip => false,
            Delivery::IfTreating(patient_id) => self.is_treating(&patient_id).await,
        }
    }

    /// The next frame: an event for this account, or a keep-alive. `None`
    /// ends the stream when the channel closes.
    async fn next_frame(
        mut self,
    ) -> Option<(Result<actix_web::web::Bytes, actix_web::Error>, Self)> {
        if !self.handshake_sent {
            self.handshake_sent = true;
            return Some((Ok(comment("connected")), self));
        }
        // Keep the connection provably alive: a quiet stream would otherwise
        // write nothing for minutes, and proxies close idle connections while
        // the client still looks "connected". Events skipped for this account
        // do not count as writes.
        let deadline = tokio::time::Instant::now() + SSE_HEARTBEAT;
        loop {
            let event = match tokio::time::timeout_at(deadline, self.receiver.recv()).await {
                Err(_) => return Some((Ok(comment("keepalive")), self)),
                Ok(Ok(event)) => event,
                Ok(Err(broadcast::error::RecvError::Lagged(missed))) => {
                    log::warn!("event stream for {} skipped {missed} events", self.user.id);
                    continue;
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => return None,
            };
            if self.may_receive(&event).await {
                let json = serde_json::to_string(&event).unwrap_or_default();
                let frame = actix_web::web::Bytes::from(format!("data: {}\n\n", json));
                return Some((Ok(frame), self));
            }
        }
    }
}

// ============================================================================
// SSE HTTP endpoint
// ============================================================================

/// GET /api/events
///
/// Streams Server-Sent Events to the caller. Requires an authenticated, known
/// caller (Horizon finding — previously fell back to `"anonymous"` and
/// streamed every patient's events to anyone, logged in or not) and delivers
/// only the events whose audience includes that caller (`delivery`).
#[get("/api/events")]
pub async fn sse_events(
    data: web::Data<crate::AppState>,
    caller: crate::middleware::AuthorizedUser,
) -> HttpResponse {
    // A patient-role account with no linked patient record can't be scoped to
    // anything real — deny rather than fall back to broad.
    if *caller.role() == crate::types::Role::Patient && caller.user.linked_patient_id.is_none() {
        return HttpResponse::Forbidden().json(crate::types::ErrorResponse {
            error: "Patient account has no linked patient record".to_string(),
            code: "NO_LINKED_PATIENT".to_string(),
        });
    }

    let connection = Connection {
        receiver: data.ws_manager.subscribe(&caller.user_id),
        user: caller.user,
        data: data.clone(),
        treating: HashMap::new(),
        handshake_sent: false,
    };
    let stream = futures::stream::unfold(connection, Connection::next_frame);

    HttpResponse::Ok()
        .insert_header(("Content-Type", "text/event-stream"))
        .insert_header(("Cache-Control", "no-cache"))
        .insert_header(("X-Accel-Buffering", "no"))
        .streaming(stream)
}

// ============================================================================
// Helper push functions
// ============================================================================

/// Push a Clinical Decision Support alert to the patient and the clinicians
/// treating them.
pub fn push_cds_alert(
    manager: &WsSessionManager,
    patient_id: &str,
    alert_title: &str,
    severity: &str,
) {
    manager.push_event(PushEvent {
        event_type: "cds_alert".to_string(),
        patient_id: Some(patient_id.to_string()),
        payload: serde_json::json!({
            "title": alert_title,
            "severity": severity,
            "patient_id": patient_id,
        }),
        timestamp: chrono::Utc::now().timestamp(),
        audience: Audience::CareTeam,
    });
}

/// Push a medication reminder to the patient it is for, and nobody else.
pub fn push_reminder(manager: &WsSessionManager, patient_id: &str, medication_name: &str) {
    manager.push_event(PushEvent {
        event_type: "reminder_due".to_string(),
        patient_id: Some(patient_id.to_string()),
        payload: serde_json::json!({
            "medication": medication_name,
            "patient_id": patient_id,
            "message": format!("Time to take: {}", medication_name),
        }),
        timestamp: chrono::Utc::now().timestamp(),
        audience: Audience::Patient,
    });
}

#[cfg(test)]
mod audience_tests {
    use super::*;
    use crate::types::Role;

    fn account(id: &str, role: Role, linked_patient: Option<&str>) -> crate::User {
        let mut user = crate::test_fixtures::staff(id, role);
        user.linked_patient_id = linked_patient.map(str::to_string);
        user
    }

    fn event(patient_id: Option<&str>, audience: Audience) -> PushEvent {
        PushEvent {
            event_type: "reminder_due".to_string(),
            patient_id: patient_id.map(str::to_string),
            payload: serde_json::json!({}),
            timestamp: 0,
            audience,
        }
    }

    /// The defect: a doctor sets a patient's reminder, and it reached the
    /// administrator and every clinician. Now only that patient receives it.
    #[test]
    fn a_patients_reminder_reaches_that_patient_only() {
        let reminder = event(Some("PAT-1"), Audience::Patient);
        let patient = account("u-p1", Role::Patient, Some("PAT-1"));
        let other_patient = account("u-p2", Role::Patient, Some("PAT-2"));
        assert_eq!(delivery(&patient, &reminder), Delivery::Deliver);
        assert_eq!(delivery(&other_patient, &reminder), Delivery::Skip);
        for role in [Role::Admin, Role::Doctor, Role::Nurse, Role::Pharmacist] {
            assert_eq!(
                delivery(&account("u-staff", role, None), &reminder),
                Delivery::Skip
            );
        }
    }

    #[test]
    fn a_clinical_alert_waits_on_whether_the_clinician_is_treating() {
        let alert = event(Some("PAT-1"), Audience::CareTeam);
        let doctor = account("u-d", Role::Doctor, None);
        assert_eq!(
            delivery(&doctor, &alert),
            Delivery::IfTreating("PAT-1".to_string())
        );
        assert_eq!(
            delivery(&account("u-p1", Role::Patient, Some("PAT-1")), &alert),
            Delivery::Deliver
        );
        assert_eq!(
            delivery(&account("u-p2", Role::Patient, Some("PAT-2")), &alert),
            Delivery::Skip
        );
        // A care-team event about nobody reaches nobody.
        assert_eq!(
            delivery(&doctor, &event(None, Audience::CareTeam)),
            Delivery::Skip
        );
    }

    #[test]
    fn named_accounts_and_administrators() {
        let call = event(Some("PAT-1"), Audience::Accounts(vec!["u-d".to_string()]));
        assert_eq!(
            delivery(&account("u-d", Role::Doctor, None), &call),
            Delivery::Deliver
        );
        assert_eq!(
            delivery(&account("u-other", Role::Doctor, None), &call),
            Delivery::Skip
        );
        assert_eq!(
            delivery(&account("u-admin", Role::Admin, None), &call),
            Delivery::Skip
        );
        assert_eq!(
            delivery(&account("u-p1", Role::Patient, Some("PAT-1")), &call),
            Delivery::Deliver
        );

        let security = event(None, Audience::Administrators);
        assert_eq!(
            delivery(&account("u-admin", Role::Admin, None), &security),
            Delivery::Deliver
        );
        assert_eq!(
            delivery(&account("u-d", Role::Doctor, None), &security),
            Delivery::Skip
        );
        assert_eq!(
            delivery(&account("u-p1", Role::Patient, Some("PAT-1")), &security),
            Delivery::Skip
        );
    }

    /// A message notice addressed to a patient's account reaches that patient
    /// though it names no patient record, and nobody else.
    #[test]
    fn a_named_account_receives_its_message_notice() {
        let notice = event(None, Audience::Accounts(vec!["u-p1".to_string()]));
        assert_eq!(
            delivery(&account("u-p1", Role::Patient, Some("PAT-1")), &notice),
            Delivery::Deliver
        );
        assert_eq!(
            delivery(&account("u-p2", Role::Patient, Some("PAT-2")), &notice),
            Delivery::Skip
        );
        assert_eq!(
            delivery(&account("u-admin", Role::Admin, None), &notice),
            Delivery::Skip
        );
    }

    #[test]
    fn an_event_with_no_audience_reaches_nobody() {
        let unaddressed = event(Some("PAT-1"), Audience::default());
        for user in [
            account("u-admin", Role::Admin, None),
            account("u-d", Role::Doctor, None),
            account("u-p1", Role::Patient, Some("PAT-1")),
        ] {
            assert_eq!(delivery(&user, &unaddressed), Delivery::Skip);
        }
    }
}
