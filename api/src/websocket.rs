//! WebSocket / Server-Sent Events (SSE) module for MediChain
//!
//! Provides real-time push notifications to connected clients using SSE,
//! which works with the existing actix-web + tokio + futures dependency set
//! without requiring any additional crates.

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::{Arc, RwLock};
use std::task::{Context, Poll};

use actix_web::{get, web, HttpResponse};
use futures::Stream;
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
}

// ============================================================================
// Session manager
// ============================================================================

/// Manages SSE client subscriptions and broadcasts push events.
pub struct WsSessionManager {
    /// Broadcast channel used to fan-out events to all connected SSE clients.
    sender: broadcast::Sender<PushEvent>,
    /// Tracks how many active SSE streams exist per wallet address.
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

    /// Subscribe to the broadcast channel, recording the wallet address.
    /// Returns a `Receiver` that the SSE stream will poll.
    pub fn subscribe(&self, wallet_address: &str) -> broadcast::Receiver<PushEvent> {
        let mut subs = self.subscribers.write().unwrap();
        *subs.entry(wallet_address.to_string()).or_insert(0) += 1;
        self.sender.subscribe()
    }

    /// Decrement the subscriber count for a wallet address when a connection closes.
    pub fn unsubscribe(&self, wallet_address: &str) {
        let mut subs = self.subscribers.write().unwrap();
        if let Some(count) = subs.get_mut(wallet_address) {
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

    /// Returns the number of wallet addresses with at least one active SSE stream.
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

/// Which events a connection may receive.
///
/// Horizon finding (surfaced during continued remediation, not one of
/// HZ-001..012): `push_event` broadcasts every event to every connected SSE
/// client with no per-connection filtering at all — a patient's medication
/// reminders and CDS alerts (patient_id, medication name, alert title and
/// severity) went to *every* open stream, authenticated or not. This scopes
/// what each connection is allowed to see.
#[derive(Debug, Clone)]
pub enum EventScope {
    /// A patient sees only events about their own linked patient record.
    OwnPatientOnly(String),
    /// Providers/Admin see the full stream — matches this codebase's existing
    /// (imperfect, already-flagged — see `HZ-WP6-CONS-003`'s observation on
    /// the absence of a per-patient ongoing consent-grant mechanism) broad
    /// provider read access; not further restricted here.
    AllEvents,
}

impl EventScope {
    fn allows(&self, event: &PushEvent) -> bool {
        match self {
            EventScope::AllEvents => true,
            EventScope::OwnPatientOnly(own_id) => event.patient_id.as_deref() == Some(own_id.as_str()),
        }
    }
}

/// Wraps a `broadcast::Receiver<PushEvent>` and implements `Stream` so it can
/// be passed to `HttpResponse::streaming()`.
///
/// Polling strategy: when the channel is temporarily empty we return
/// `Poll::Pending` and schedule an immediate wake-up via a short sleep spawned
/// on the tokio runtime.  This avoids busy-looping while still delivering
/// events with low latency.
struct SseStream {
    receiver: broadcast::Receiver<PushEvent>,
    scope: EventScope,
}

impl Stream for SseStream {
    type Item = Result<actix_web::web::Bytes, actix_web::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        loop {
            match self.receiver.try_recv() {
                Ok(event) => {
                    if !self.scope.allows(&event) {
                        // Not for this connection — keep draining without
                        // yielding Pending, so an out-of-scope event doesn't
                        // stall delivery of the next in-scope one.
                        continue;
                    }
                    let json = serde_json::to_string(&event).unwrap_or_default();
                    let frame = format!("data: {}\n\n", json);
                    return Poll::Ready(Some(Ok(actix_web::web::Bytes::from(frame))));
                }
                Err(broadcast::error::TryRecvError::Empty) => {
                    // Schedule a wake-up after a short delay so we do not busy-spin.
                    let waker = cx.waker().clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                        waker.wake();
                    });
                    return Poll::Pending;
                }
                // Channel was closed (sender dropped) — signal end of stream.
                Err(_) => return Poll::Ready(None),
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
/// streamed every patient's events to anyone, logged in or not) and scopes
/// delivered events to what that caller may see (`EventScope`).
#[get("/api/events")]
pub async fn sse_events(
    data: web::Data<crate::AppState>,
    caller: crate::middleware::AuthorizedUser,
) -> HttpResponse {
    let scope = if *caller.role() == crate::types::Role::Patient {
        match &caller.user.linked_patient_id {
            Some(patient_id) => EventScope::OwnPatientOnly(patient_id.clone()),
            // A patient-role account with no linked patient record can't be
            // scoped to anything real — deny rather than fall back to broad.
            None => {
                return HttpResponse::Forbidden().json(crate::types::ErrorResponse {
                    success: false,
                    error: "Patient account has no linked patient record".to_string(),
                    code: "NO_LINKED_PATIENT".to_string(),
                })
            }
        }
    } else {
        EventScope::AllEvents
    };

    let receiver = data.ws_manager.subscribe(&caller.wallet_address);
    let stream = SseStream { receiver, scope };

    HttpResponse::Ok()
        .insert_header(("Content-Type", "text/event-stream"))
        .insert_header(("Cache-Control", "no-cache"))
        .insert_header(("X-Accel-Buffering", "no"))
        .streaming(stream)
}

// ============================================================================
// Helper push functions
// ============================================================================

/// Push a Clinical Decision Support alert to all connected SSE clients.
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
    });
}

/// Push a medication reminder to all connected SSE clients.
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
    });
}

#[cfg(test)]
mod hz_sse_scope_tests {
    use super::*;

    fn event_for(patient_id: &str) -> PushEvent {
        PushEvent {
            event_type: "reminder_due".to_string(),
            patient_id: Some(patient_id.to_string()),
            payload: serde_json::json!({}),
            timestamp: 0,
        }
    }

    /// HZ regression: a patient-scoped connection must not see another
    /// patient's events — this is the exact gap that let every connected
    /// client see every patient's medication reminders/CDS alerts.
    #[test]
    fn own_patient_only_rejects_other_patients_events() {
        let scope = EventScope::OwnPatientOnly("PAT-1".to_string());
        assert!(scope.allows(&event_for("PAT-1")));
        assert!(!scope.allows(&event_for("PAT-2")));
    }

    #[test]
    fn all_events_scope_allows_everything() {
        let scope = EventScope::AllEvents;
        assert!(scope.allows(&event_for("PAT-1")));
        assert!(scope.allows(&event_for("PAT-2")));
    }
}
