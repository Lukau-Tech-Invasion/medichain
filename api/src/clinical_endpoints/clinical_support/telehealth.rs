//! `clinical_endpoints::clinical_support::telehealth` — Phase 26 (telehealth integration).
//!
//! Split out of the former single-file `clinical_support.rs` (itself split from the
//! original 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `clinical_support/mod.rs`
//! so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// Persist a telehealth session or return a stable, non-disclosing response.
async fn persist_session(
    data: &crate::AppState,
    session: &crate::clinical::TelehealthSession,
) -> Result<(), HttpResponse> {
    let now = chrono::Utc::now();
    let payload = serde_json::to_value(session).map_err(|error| {
        log::error!("Telehealth session serialization failed: {error}");
        HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "error": "Could not save the telehealth session",
            "code": "TELEHEALTH_SERIALIZATION_FAILED"
        }))
    })?;
    data.repositories
        .telehealth_session_records
        .create(crate::repositories::traits::JsonRecordEntity {
            id: session.session_id.clone(),
            owner_id: session.patient_id.clone(),
            data: payload,
            created_at: now,
            updated_at: now,
        })
        .await
        .map(|_| ())
        .map_err(|error| {
            log::error!("Telehealth session persistence failed: {error}");
            HttpResponse::ServiceUnavailable().json(serde_json::json!({
                "success": false,
                "error": "Telehealth session storage is unavailable",
                "code": "TELEHEALTH_PERSISTENCE_FAILED"
            }))
        })
}

// ============================================================================
// PHASE 26: TELEHEALTH INTEGRATION
// ============================================================================

/// Create telehealth session request
#[derive(Debug, Deserialize)]
pub struct CreateTelehealthSessionRequest {
    pub patient_id: String,
    pub appointment_id: Option<String>,
    pub session_type: String,
    pub scheduled_start: i64,
    pub recording_enabled: Option<bool>,
    /// How long to book the room for. `TelehealthPage` has always collected
    /// this and has always sent it; nothing read it.
    pub duration_minutes: Option<u32>,
}

/// The session types a caller may name, in the spelling this API stores them.
///
/// Published in the refusal below so a client that sends the wrong word is told
/// which words are right, rather than being quietly given a video visit.
pub(crate) const SESSION_TYPE_VOCABULARY: [&str; 6] = [
    "VideoVisit",
    "PhoneCall",
    "SecureMessage",
    "AsyncVideo",
    "RemoteMonitoring",
    "VirtualGroupVisit",
];

/// Resolve a session type, or `None` if it is not one.
///
/// This used to be a `match` ending in `_ => VideoVisit`, and
/// `TelehealthPage` offered four values -- `video_consultation`, `follow_up`,
/// `mental_health`, `urgent_care` -- none of which were in it. So every session
/// booked from that screen became a video visit whatever the clinician chose,
/// and the list then rendered the stored `VideoVisit` back, which was in
/// neither vocabulary and displayed as the raw enum name.
///
/// The short forms are kept because existing callers send them; the canonical
/// names are added because that is what a reader gets back and therefore what a
/// client will naturally send. Anything else is refused.
pub(crate) fn parse_session_type(raw: &str) -> Option<crate::clinical::TelehealthType> {
    use crate::clinical::TelehealthType;
    match raw.trim() {
        "video" | "VideoVisit" => Some(TelehealthType::VideoVisit),
        "phone" | "PhoneCall" => Some(TelehealthType::PhoneCall),
        "message" | "SecureMessage" => Some(TelehealthType::SecureMessage),
        "async_video" | "AsyncVideo" => Some(TelehealthType::AsyncVideo),
        "monitoring" | "RemoteMonitoring" => Some(TelehealthType::RemoteMonitoring),
        "group" | "VirtualGroupVisit" => Some(TelehealthType::VirtualGroupVisit),
        _ => None,
    }
}

/// Shortest and longest bookable session, in minutes.
///
/// The upper bound is not arbitrary: the join token's expiry is
/// `scheduled_at + duration + 30`, so an unbounded duration mints a link that
/// stays valid for as long as the caller asks for.
pub(crate) const MIN_SESSION_MINUTES: u32 = 5;
pub(crate) const MAX_SESSION_MINUTES: u32 = 480;

/// How long before the scheduled start a session may be joined, and how long
/// after it stays joinable.
///
/// A telehealth room is a private clinical space. Leaving it open indefinitely
/// means a link shared once works forever; opening it weeks early means the
/// room exists long before anyone should be in it. The window is generous
/// enough for an early patient and an overrunning clinic, and no more.
pub(crate) const JOIN_OPENS_BEFORE_SECS: i64 = 15 * 60;
pub(crate) const JOIN_CLOSES_AFTER_SECS: i64 = 4 * 60 * 60;

/// Whether `now` falls inside the joinable window for a session starting at
/// `scheduled_start`.
pub(crate) fn within_join_window(scheduled_start: i64, now: i64) -> bool {
    now >= scheduled_start - JOIN_OPENS_BEFORE_SECS
        && now <= scheduled_start + JOIN_CLOSES_AFTER_SECS
}

/// A freshly provisioned session, plus which backend produced its URLs.
pub(crate) struct ProvisionedSession {
    pub session: crate::clinical::TelehealthSession,
    /// The video backend that issued the room. Provider failures return an
    /// error; this field never represents a fallback room.
    pub platform: String,
}

/// Provision a telehealth session and persist it.
///
/// Extracted from `create_telehealth_session` so that booking a telehealth
/// appointment can create the session too. Before this, the only way a session
/// came into existence was a clinician separately filling in the Telehealth
/// screen — re-entering the patient — so a "telehealth" appointment and an
/// actual meeting were unrelated objects (`docs/WORKFLOW_AUDIT.md`, WF-014).
///
/// Returns the session on success. Errors are surfaced to the caller rather
/// than swallowed: an appointment that believes it has a meeting when none was
/// created is the exact failure this work exists to remove.
/// What a telehealth session is being provisioned for.
///
/// A struct rather than seven positional arguments: `scheduled_start` and
/// `duration_minutes` are both bare integers, and two call sites passing them
/// in the other order would have compiled.
pub(crate) struct SessionRequest<'a> {
    pub patient_id: &'a str,
    pub provider_id: &'a str,
    pub appointment_id: Option<String>,
    pub scheduled_start: i64,
    pub session_type: crate::clinical::TelehealthType,
    pub recording_enabled: bool,
    pub duration_minutes: u32,
}

pub(crate) async fn provision_session(
    data: &crate::AppState,
    request: SessionRequest<'_>,
) -> Result<ProvisionedSession, String> {
    let SessionRequest {
        patient_id,
        provider_id,
        appointment_id,
        scheduled_start,
        session_type,
        recording_enabled,
        duration_minutes,
    } = request;
    let session_id = format!("TH-{}", uuid::Uuid::new_v4());
    let scheduled_at =
        chrono::DateTime::from_timestamp(scheduled_start, 0).unwrap_or_else(chrono::Utc::now);

    let service_params = crate::telehealth::CreateSessionParams {
        session_id: session_id.clone(),
        patient_id: patient_id.to_string(),
        provider_id: provider_id.to_string(),
        scheduled_at,
        duration_minutes,
    };
    let (provider_join_url, patient_join_url, platform) =
        match data.telehealth_service.create_session(service_params).await {
            Ok(info) => (
                info.provider_join_url,
                info.patient_join_url,
                info.provider_name,
            ),
            Err(error) => {
                log::error!("Telehealth session provisioning failed: {error}");
                return Err(
                    "Telehealth is temporarily unavailable; the appointment was not provisioned"
                        .into(),
                );
            }
        };

    let session = crate::clinical::TelehealthSession {
        session_id: session_id.clone(),
        appointment_id,
        patient_id: patient_id.to_string(),
        provider_id: provider_id.to_string(),
        session_type,
        scheduled_start,
        duration_minutes,
        actual_start: None,
        actual_end: None,
        status: crate::clinical::TelehealthStatus::Scheduled,
        video_room_url: provider_join_url,
        waiting_room_url: patient_join_url,
        join_instructions: "Use the provided link to join your telehealth session. \
            Ensure camera and microphone are enabled."
            .to_string(),
        technical_requirements: vec![
            "Modern web browser (Chrome, Firefox, Safari, Edge)".to_string(),
            "Stable internet connection (2+ Mbps)".to_string(),
            "Camera and microphone access".to_string(),
        ],
        patient_joined_at: None,
        provider_joined_at: None,
        recording_enabled,
        recording_consent: false,
        chat_enabled: true,
        screen_share_enabled: true,
        quality_metrics: None,
        visit_notes: None,
        follow_up_scheduled: None,
    };

    let now_dt = chrono::Utc::now();
    let payload = serde_json::to_value(&session)
        .map_err(|error| format!("Could not serialize telehealth session: {error}"))?;
    data.repositories
        .telehealth_session_records
        .create(crate::repositories::traits::JsonRecordEntity {
            id: session_id,
            owner_id: session.patient_id.clone(),
            data: payload,
            created_at: now_dt,
            updated_at: now_dt,
        })
        .await
        .map_err(|e| e.to_string())?;

    Ok(ProvisionedSession { session, platform })
}

/// Create a new telehealth session
#[post("/api/telehealth/sessions")]
pub async fn create_telehealth_session(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateTelehealthSessionRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only healthcare providers can create telehealth sessions".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let session_type = match parse_session_type(&req.session_type) {
        Some(kind) => kind,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: format!(
                    "Unknown session type '{}'. Expected one of: {}",
                    req.session_type,
                    SESSION_TYPE_VOCABULARY.join(", ")
                ),
                code: "UNKNOWN_SESSION_TYPE".to_string(),
            });
        }
    };

    // Bounded rather than trusted. An out-of-range duration is refused, not
    // clamped: silently booking 480 minutes for someone who asked for 4000
    // gives them a room and a join link neither they nor the schedule expects.
    let duration_minutes = req.duration_minutes.unwrap_or(60);
    if !(MIN_SESSION_MINUTES..=MAX_SESSION_MINUTES).contains(&duration_minutes) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: format!(
                "A session must be between {MIN_SESSION_MINUTES} and {MAX_SESSION_MINUTES} minutes"
            ),
            code: "INVALID_DURATION".to_string(),
        });
    }

    // Same provisioning path the appointment booking uses, so a session
    // created here and one created by booking a telehealth appointment are the
    // same object with the same guarantees.
    let provisioned = match provision_session(
        &data,
        SessionRequest {
            patient_id: &req.patient_id,
            provider_id: &current_user_id,
            appointment_id: req.appointment_id.clone(),
            scheduled_start: req.scheduled_start,
            session_type,
            recording_enabled: req.recording_enabled.unwrap_or(false),
            duration_minutes,
        },
    )
    .await
    {
        Ok(p) => p,
        Err(e) => {
            log::error!("telehealth session provisioning failed: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The telehealth session could not be created".to_string(),
                code: "TELEHEALTH_UNAVAILABLE".to_string(),
            });
        }
    };
    let session_id = provisioned.session.session_id.clone();
    let provider_join_url = provisioned.session.video_room_url.clone();
    let patient_join_url = provisioned.session.waiting_room_url.clone();
    let video_room_url = provider_join_url.clone();
    let waiting_room_url = patient_join_url.clone();
    let platform = provisioned.platform;

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "session_id": session_id,
        "video_room_url": video_room_url,
        "waiting_room_url": waiting_room_url,
        "provider_join_url": provider_join_url,
        "patient_join_url": patient_join_url,
        "platform": platform,
        "message": "Telehealth session created successfully"
    }))
}

/// Get telehealth session details
#[get("/api/telehealth/sessions/{session_id}")]
pub async fn get_telehealth_session(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let session_id = path.into_inner();

    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let session: crate::clinical::TelehealthSession = match data
        .repositories
        .telehealth_session_records
        .get_by_id(&session_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(s) => s,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only patient or provider can view session.
    //
    // `session.patient_id` is a `PAT-…` record id and `current_user_id` is an
    // SS58 wallet: comparing them directly is never true for a real patient
    // account, so the data subject was denied their own session.
    // `caller_owns_patient_record` bridges the two namespaces.
    let caller_is_patient =
        crate::support::caller_owns_patient_record(&data, &current_user_id, &session.patient_id);
    if !caller_is_patient && session.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "session": session
    }))
}

/// Join telehealth session
#[post("/api/telehealth/sessions/{session_id}/join")]
pub async fn join_telehealth_session(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let session_id = path.into_inner();

    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let mut session: crate::clinical::TelehealthSession = match data
        .repositories
        .telehealth_session_records
        .get_by_id(&session_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(s) => s,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    let now = chrono::Utc::now().timestamp();
    // Same namespace bridge as the view handler above: a wallet address is
    // never equal to a `PAT-…` record id, so this used to tell the patient
    // "You are not part of this session" about their own consultation —
    // i.e. a patient could never join their own video call.
    let is_patient =
        crate::support::caller_owns_patient_record(&data, &current_user_id, &session.patient_id);
    let is_provider = session.provider_id == current_user_id;

    if !is_patient && !is_provider {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "You are not part of this session".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // A finished consultation is not a room you can walk back into. Without
    // this, a link from a completed visit kept working indefinitely.
    if matches!(
        session.status,
        crate::clinical::TelehealthStatus::Completed
            | crate::clinical::TelehealthStatus::Cancelled
            | crate::clinical::TelehealthStatus::NoShow
    ) {
        return HttpResponse::Conflict().json(ErrorResponse {
            error: "This consultation has ended".to_string(),
            code: "SESSION_ENDED".to_string(),
        });
    }

    // Nor is it a room that exists from the moment it is booked. The window is
    // enforced here, not merely hidden in the UI, so a saved link cannot be
    // used weeks early or long afterwards.
    if !within_join_window(session.scheduled_start, now) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "This consultation is not open to join yet".to_string(),
            code: "OUTSIDE_JOIN_WINDOW".to_string(),
        });
    }

    if is_patient {
        session.patient_joined_at = Some(now);
        if session.status == crate::clinical::TelehealthStatus::Scheduled {
            session.status = crate::clinical::TelehealthStatus::WaitingRoom;
        }
    } else if is_provider {
        session.provider_joined_at = Some(now);
        if session.patient_joined_at.is_some() {
            session.status = crate::clinical::TelehealthStatus::InProgress;
            session.actual_start = Some(now);
        }
    }

    // Check if both have joined
    if session.patient_joined_at.is_some() && session.provider_joined_at.is_some() {
        session.status = crate::clinical::TelehealthStatus::InProgress;
        if session.actual_start.is_none() {
            session.actual_start = Some(now);
        }
    }

    // Persist the updated session (upsert preserves original created_at)
    {
        if let Err(response) = persist_session(&data, &session).await {
            return response;
        }
    }

    // Entering a patient's live consultation is an access to their care, and
    // it was the one telehealth event that left no trace: recording-start and
    // recording-stop both audited, joining did not. A provider could sit in a
    // patient's video visit and the access trail would show nothing — in a
    // system whose central claim is a tamper-evident record of who reached a
    // patient, that is the entry an auditor would look for first.
    {
        let joined_at = chrono::Utc::now();
        let accessor_role = if is_provider {
            crate::support::get_user(&data, &current_user_id)
                .map(|u| u.role.to_string())
                .unwrap_or_else(|| "Doctor".to_string())
        } else {
            "Patient".to_string()
        };
        let log = crate::repositories::traits::AccessLogEntity {
            id: uuid::Uuid::new_v4().to_string(),
            accessor_id: current_user_id.clone(),
            accessor_role,
            patient_id: Some(session.patient_id.clone()),
            resource_type: "telehealth_session".to_string(),
            resource_id: Some(session_id.clone()),
            // MUST be a value `access_logs_action_check` accepts. The first
            // draft of this used "joined", which the constraint rejects — the
            // insert would have failed on PostgreSQL and, because this write
            // only logs its error, the audit row would have been silently lost
            // while the join succeeded. That is the exact bug this block exists
            // to fix, reintroduced one layer down. The in-memory backend
            // enforces no CHECK constraint, so it would have looked fine here.
            action: TELEHEALTH_JOIN_ACTION.to_string(),
            access_reason: Some("telehealth consultation".to_string()),
            is_emergency_access: false,
            ip_address: None,
            user_agent: None,
            blockchain_tx_hash: None,
            accessed_at: joined_at,
            facility_id: None,
        };
        if let Err(response) = crate::support::require_durable_audit(&data, log).await {
            return response;
        }
    }

    // Phase 1: issue Jitsi IFrame-API credentials (domain, room, JWT) mapped to
    // the caller's role. `jitsi` is null for providers that don't support JWT.
    let role_str = if is_provider {
        crate::support::get_user(&data, &current_user_id)
            .map(|u| u.role.to_string())
            .unwrap_or_else(|| "doctor".to_string())
    } else {
        "patient".to_string()
    };
    let display_name = if is_provider {
        crate::support::get_user(&data, &current_user_id)
            .map(|u| u.name)
            .unwrap_or_else(|| "Care Provider".to_string())
    } else {
        "Patient".to_string()
    };
    let jitsi = data.telehealth_service.join_credentials(
        &session_id,
        &current_user_id,
        &display_name,
        &role_str,
    );

    // Room pre-config (Phase 3): privacy-first defaults applied client-side once
    // the room loads. The subject is deliberately PHI-free (no patient name in
    // room titles that may be logged).
    let room_config = data.telehealth_service.configure_room(&session_id);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "session_id": session_id,
        "status": format!("{:?}", session.status),
        // Role-appropriate room URL. This always returned the *provider*
        // URL, so a patient using the non-IFrame fallback joined labelled
        // "Care Provider" and bypassed the waiting room the session model
        // had just put them in.
        "video_room_url": if is_provider {
            session.video_room_url.clone()
        } else {
            session.waiting_room_url.clone()
        },
        "role": role_str,
        "jitsi": jitsi,
        "subject": room_config.subject,
        "room_config": room_config,
        "message": if is_patient { "Joined waiting room" } else { "Provider joined session" }
    }))
}

/// Telehealth (Jitsi) availability health check (Phase 5).
///
/// Pings the configured Jitsi domain and reports reachability + latency, the
/// active provider, and whether JWT auth is configured. Used by load-balancer
/// health checks. Unauthenticated (path is under the `/api/health` bypass).
#[get("/api/health/telehealth")]
pub async fn telehealth_health(data: web::Data<crate::AppState>) -> impl Responder {
    let domain = std::env::var("JITSI_DOMAIN").unwrap_or_else(|_| "meet.jit.si".to_string());
    let jwt_configured = std::env::var("JITSI_APP_SECRET")
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    let provider = data.telehealth_service.active_provider_name();

    // The address the SERVER can reach, which is a third value distinct from
    // both the XMPP domain the token is scoped to and the origin the browser
    // opens. Inside a container `https://localhost/` is this API, not Jitsi,
    // so probing the browser's hostname reported the video service
    // permanently "unreachable" while it was running and healthy on the
    // compose network at `http://jitsi-web/`.
    //
    // Defaults to the public origin, so a deployment where the two are the
    // same configures nothing.
    let probe_url = std::env::var("JITSI_INTERNAL_URL")
        .ok()
        .map(|url| url.trim().trim_end_matches('/').to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| {
            std::env::var("JITSI_PUBLIC_URL")
                .ok()
                .map(|url| url.trim().trim_end_matches('/').to_string())
                .filter(|url| !url.is_empty())
                .unwrap_or_else(|| format!("https://{domain}"))
        });

    let start = std::time::Instant::now();
    let probe = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        // A self-hosted Jitsi generates its own certificate, so a probe that
        // insists on a trusted chain reports the service down for a reason
        // that has nothing to do with whether it is up. This request carries
        // no credentials and reads no data -- it asks whether the port
        // answers.
        .danger_accept_invalid_certs(true)
        .build();
    let (status, http_status) = match probe {
        Ok(client) => match client.get(format!("{probe_url}/")).send().await {
            Ok(resp) => ("healthy", Some(resp.status().as_u16())),
            Err(_) => ("unreachable", None),
        },
        Err(_) => ("error", None),
    };
    let response_time_ms = start.elapsed().as_millis();

    let body = serde_json::json!({
        "status": status,
        "domain": domain,
        "provider": provider,
        "jwt_configured": jwt_configured,
        "response_time_ms": response_time_ms,
        "http_status": http_status,
    });
    if status == "healthy" {
        HttpResponse::Ok().json(body)
    } else {
        HttpResponse::ServiceUnavailable().json(body)
    }
}

/// Telehealth lifecycle events a client may report.
///
/// Deliberately a closed set. `event_type` is written verbatim into
/// `access_logs.action`, which is CHECK-constrained, so an unvalidated value
/// would be accepted here and then fail the audit insert on PostgreSQL. Because
/// the audit path fails closed, that turns a typo in a client — or a caller
/// choosing an arbitrary string — into a refused request whose error blames the
/// audit trail rather than the input. Rejecting it at the boundary gives a 400
/// that names the real problem, and keeps the audit vocabulary enumerable.
///
/// These are the events `JitsiMeetComponent` emits. Adding one here means adding
/// it to the `access_logs_action_check` constraint in the same change;
/// `test_pg_access_log_accepts_every_action_the_handlers_write` enforces that.
pub const TELEHEALTH_EVENT_TYPES: &[&str] = &[
    "conference-joined",
    "conference-left",
    "participant-joined",
    "participant-left",
    "error",
    // Written by `join_telehealth_session` when a participant enters the room.
    // Listed here so `test_pg_telehealth_event_types_are_all_accepted_by_the_schema`
    // proves the schema accepts it, rather than a paramedic-hours discovery
    // that telehealth joins stopped being audited on PostgreSQL.
    TELEHEALTH_JOIN_ACTION,
];

/// The `access_logs.action` value recorded when someone joins a consultation.
///
/// Constrained by `access_logs_action_check` in the schema, so it cannot be an
/// arbitrary string. Kept as a named constant so the writer and the vocabulary
/// test above can never disagree about which value that is.
pub const TELEHEALTH_JOIN_ACTION: &str = "conference-joined";

#[derive(serde::Deserialize)]
pub struct TelehealthEventRequest {
    /// One of [`TELEHEALTH_EVENT_TYPES`].
    pub event_type: String,
    pub detail: Option<String>,
}

/// Relay a telehealth lifecycle event to other clients via SSE + write an audit
/// log row (Phase 7). The frontend `JitsiMeetComponent` calls this on join/leave/
/// error so a second viewer (e.g. the patient app) updates without polling.
#[post("/api/telehealth/sessions/{session_id}/event")]
pub async fn telehealth_event(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<TelehealthEventRequest>,
) -> impl Responder {
    let session_id = path.into_inner();
    let actor = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    // Validate before broadcasting: an event that cannot be audited must not be
    // relayed to other clients either, or viewers would see something the audit
    // trail has no record of.
    if !TELEHEALTH_EVENT_TYPES.contains(&body.event_type.as_str()) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: format!(
                "unsupported event_type {:?}; expected one of: {}",
                body.event_type,
                TELEHEALTH_EVENT_TYPES.join(", ")
            ),
            code: "UNSUPPORTED_EVENT_TYPE".to_string(),
        });
    }

    let now = chrono::Utc::now();

    // Broadcast to connected SSE clients.
    data.ws_manager.push_event(crate::websocket::PushEvent {
        event_type: "telehealth".to_string(),
        patient_id: None,
        payload: serde_json::json!({
            "session_id": session_id,
            "event": body.event_type,
            "actor": actor,
            "detail": body.detail,
        }),
        timestamp: now.timestamp(),
    });

    // Audit trail (HIPAA): persist the event via the access-log repository.
    let log = crate::repositories::traits::AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: actor.clone(),
        accessor_role: String::new(),
        patient_id: None,
        resource_type: "telehealth".to_string(),
        resource_id: Some(session_id.clone()),
        action: body.event_type.clone(),
        access_reason: body.detail.clone(),
        is_emergency_access: false,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: now,
        facility_id: None,
    };
    if let Err(response) = crate::support::require_durable_audit(&data, log).await {
        return response;
    }

    HttpResponse::Ok().json(serde_json::json!({ "success": true }))
}

#[derive(serde::Deserialize)]
pub struct RecordingRequest {
    /// "start" or "stop".
    pub action: String,
    /// Required true to start (explicit recording consent).
    pub consent: Option<bool>,
}

fn parse_recording_action(action: &str) -> Result<bool, &'static str> {
    match action {
        "start" => Ok(true),
        "stop" => Ok(false),
        _ => Err("Recording action must be 'start' or 'stop'"),
    }
}

fn is_assigned_recording_provider(actor: &str, provider_id: &str) -> bool {
    actor == provider_id
}

/// Start/stop recording for a session (Phase 6). Moderator-only; starting
/// requires explicit consent. Updates the session, audits, and broadcasts.
#[post("/api/telehealth/sessions/{session_id}/recording")]
pub async fn telehealth_recording(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RecordingRequest>,
) -> impl Responder {
    let session_id = path.into_inner();
    let actor = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    // Only a session moderator may control recording.
    //
    // This used to ask `is_healthcare_provider()`, which is true for
    // Pharmacist and LabTechnician as well — so a pharmacist could start
    // recording a patient's consultation. Meanwhile `role_is_moderator` in
    // `crate::telehealth` (the mapping that decides the Jitsi JWT's moderator
    // claim) already excluded Pharmacist. Two definitions of "moderator" in one
    // feature, and the security-relevant gate happened to use the wider one.
    // There is now exactly one definition, so the room's moderator claim and
    // the API's recording gate cannot drift apart again.
    let is_moderator = crate::support::get_user(&data, &actor)
        .map(|u| crate::telehealth::role_is_moderator(&u.role.to_string()))
        .unwrap_or(false);
    if !is_moderator {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only a session moderator can control recording".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let mut session: crate::clinical::TelehealthSession = match data
        .repositories
        .telehealth_session_records
        .get_by_id(&session_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(s) => s,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    let starting = match parse_recording_action(&body.action) {
        Ok(starting) => starting,
        Err(error) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: error.to_string(),
                code: "INVALID_RECORDING_ACTION".to_string(),
            })
        }
    };

    // Being a moderator controls a room; it does not grant authority to
    // capture another clinician's consultation. The assigned provider is the
    // only moderator allowed to change this session's recording state.
    if !is_assigned_recording_provider(&actor, &session.provider_id) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only the assigned provider can control this session's recording".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    if starting && body.consent != Some(true) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "Recording requires explicit consent".to_string(),
            code: "CONSENT_REQUIRED".to_string(),
        });
    }
    session.recording_enabled = starting;
    if starting {
        session.recording_consent = true;
    }

    let now = chrono::Utc::now();
    if let Err(response) = persist_session(&data, &session).await {
        return response;
    }

    // Audit + broadcast.
    let action = if starting {
        "recording-started"
    } else {
        "recording-stopped"
    };
    let log = crate::repositories::traits::AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: actor.clone(),
        // The caller's actual role, not the literal "moderator". Audit
        // consumers filter and group by role, and "moderator" is not one —
        // these rows silently fell outside every role-based audit query.
        accessor_role: crate::support::get_user(&data, &actor)
            .map(|u| u.role.to_string())
            .unwrap_or_else(|| "Doctor".to_string()),
        patient_id: Some(session.patient_id.clone()),
        resource_type: "telehealth_recording".to_string(),
        resource_id: Some(session_id.clone()),
        action: action.to_string(),
        access_reason: Some("explicit consent".to_string()),
        is_emergency_access: false,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: now,
        facility_id: None,
    };
    if let Err(response) = crate::support::require_durable_audit(&data, log).await {
        return response;
    }
    data.ws_manager.push_event(crate::websocket::PushEvent {
        event_type: "telehealth".to_string(),
        patient_id: Some(session.patient_id.clone()),
        payload: serde_json::json!({ "session_id": session_id, "event": action }),
        timestamp: now.timestamp(),
    });

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "recording_enabled": session.recording_enabled,
    }))
}

/// End telehealth session
#[post("/api/telehealth/sessions/{session_id}/end")]
pub async fn end_telehealth_session(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<Option<EndTelehealthRequest>>,
) -> impl Responder {
    let session_id = path.into_inner();

    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let mut session: crate::clinical::TelehealthSession = match data
        .repositories
        .telehealth_session_records
        .get_by_id(&session_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(s) => s,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only provider can end session
    if session.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only the provider can end the session".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let now_ts = chrono::Utc::now().timestamp();
    session.actual_end = Some(now_ts);
    session.status = crate::clinical::TelehealthStatus::Completed;

    if let Some(end_req) = req.into_inner() {
        session.visit_notes = end_req.visit_notes;
        session.follow_up_scheduled = end_req.follow_up_date;
    }

    // Calculate duration
    let duration_minutes = if let Some(start) = session.actual_start {
        (now_ts - start) / 60
    } else {
        0
    };

    // Persist the completed session before the async teardown call
    {
        if let Err(response) = persist_session(&data, &session).await {
            return response;
        }
    }

    // Notify the TelehealthService so the provider backend can tear down the room
    if let Err(e) = data.telehealth_service.end_session(&session_id).await {
        log::warn!(
            "TelehealthService::end_session failed for {}: {}",
            session_id,
            e
        );
        // Non-fatal: the session is already marked Completed in the HashMap above
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "session_id": session_id,
        "duration_minutes": duration_minutes,
        "message": "Telehealth session ended"
    }))
}

/// End telehealth request
#[derive(Debug, Deserialize)]
pub struct EndTelehealthRequest {
    pub visit_notes: Option<String>,
    pub follow_up_date: Option<String>,
}

/// Get patient's telehealth sessions
/// The signed-in caller's telehealth sessions.
///
/// `TelehealthPage` fetches `GET /api/telehealth/sessions` on load and there was
/// no such route — only `/sessions/{id}` and
/// `/patient/{patient_id}/sessions`. So the clinician's telehealth screen
/// answered 404 and listed nothing, which is part of why that page sat in no
/// role's navigation until 2026-09-10: nobody could open it and find anything.
///
/// Scoped to the caller in the query rather than filtered in Rust after a bulk
/// read. A clinician sees the sessions they are the provider for; a patient
/// sees their own. Neither sees anyone else's.
#[get("/api/telehealth/sessions")]
pub async fn list_my_telehealth_sessions(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    query: web::Query<crate::pagination::CursorQuery>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };

    // A patient's sessions are stored against their patient id; a provider's
    // against their wallet. The owner key differs by who is asking, which is
    // why this is one endpoint and not two.
    let owner = caller
        .linked_patient_id
        .clone()
        .unwrap_or_else(|| caller.wallet_address.clone());

    // A read that fails says so. `unwrap_or_default()` here turned a database
    // outage into "no sessions", which a clinician would take as a free day.
    let unavailable = |e: crate::repositories::traits::RepositoryError| {
        log::error!("telehealth sessions could not be read: {e}");
        HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "Telehealth sessions could not be read".to_string(),
            code: "DATABASE_ERROR".to_string(),
        })
    };
    let mut records = match data
        .repositories
        .telehealth_session_records
        .get_by_owner(&owner)
        .await
    {
        Ok(records) => records,
        Err(e) => return unavailable(e),
    };

    // A session is owned by the patient and names its clinician in
    // `provider_id`. This used to look the clinician's wallet up as an OWNER a
    // second time, which can never match, so a doctor's list never showed a
    // session they had booked. Deduplicated by id: a clinician who is also the
    // owner must not see the session twice.
    if caller.role.is_healthcare_provider() {
        let as_provider = match data
            .repositories
            .telehealth_session_records
            .get_by_data_field("provider_id", &caller.wallet_address)
            .await
        {
            Ok(records) => records,
            Err(e) => return unavailable(e),
        };
        let known: std::collections::HashSet<String> =
            records.iter().map(|r| r.id.clone()).collect();
        records.extend(as_provider.into_iter().filter(|r| !known.contains(&r.id)));
        // Merged from two newest-first lists; the cursor needs one order.
        records.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
    }

    let (page, next_cursor) =
        crate::pagination::paginate_cursor(&records, query.cursor.as_deref(), query.limit);
    let sessions: Vec<crate::clinical::TelehealthSession> = page
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::clinical::TelehealthSession>(r.data).ok())
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "sessions": sessions,
        "count": sessions.len(),
        "next_cursor": next_cursor
    }))
}

#[get("/api/telehealth/patient/{patient_id}/sessions")]
pub async fn get_patient_telehealth_sessions(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<crate::pagination::CursorQuery>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let is_own = crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id);
    if !is_own && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let records = data
        .repositories
        .telehealth_session_records
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default();
    let (page, next_cursor) =
        crate::pagination::paginate_cursor(&records, query.cursor.as_deref(), query.limit);
    let patient_sessions: Vec<crate::clinical::TelehealthSession> = page
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::clinical::TelehealthSession>(r.data).ok())
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "sessions": patient_sessions,
        "count": patient_sessions.len(),
        "next_cursor": next_cursor
    }))
}

/// In-app web join URL for a session (Phase 4 — fully in-app, **no** native-app
/// deep links). Points at the PWA telehealth route so a scan/tap stays inside
/// MediChain.
///
/// `None` when `MEDICHAIN_APP_URL` is unset or empty. This used to fall back to
/// `https://app.medichain.health`, a domain nobody operates, so every QR and
/// redirect a deployment produced without the variable sent the patient to a
/// site that is not theirs -- and Compose passes the variable through as empty
/// when it is not configured, which produced a relative link no phone can open.
fn in_app_join_url(session_id: &str) -> Option<String> {
    let base = std::env::var("MEDICHAIN_APP_URL").ok()?;
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return None;
    }
    Some(format!("{}/telehealth?session={}&join=1", base, session_id))
}

fn join_links_unconfigured() -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        error: "Telehealth join links need MEDICHAIN_APP_URL, the patient app's address"
            .to_string(),
        code: "JOIN_URL_UNCONFIGURED".to_string(),
    })
}

/// Single-tap join redirect (Phase 4). Issues a 302 to the in-app web room so
/// phones open the consultation **inside the MediChain PWA** — never a native
/// app or app-store download. The SPA handles auth + auto-join from the query.
#[get("/api/telehealth/join/{session_id}")]
pub async fn telehealth_join_redirect(path: web::Path<String>) -> impl Responder {
    let session_id = path.into_inner();
    let Some(target) = in_app_join_url(&session_id) else {
        return join_links_unconfigured();
    };
    HttpResponse::Found()
        .insert_header(("Location", target))
        .finish()
}

/// QR code for single-tap mobile join (Phase 4). Encodes the in-app web join
/// URL as a PNG (base64) so a patient/paramedic can scan and join in-browser
/// without installing anything. Auth-gated like the other session endpoints.
#[get("/api/telehealth/sessions/{session_id}/qr")]
pub async fn telehealth_join_qr(
    // Took no application state, so "auth-gated" meant only that a header was
    // present. The QR encodes a session join URL, so an unresolved caller could
    // mint a joinable link for any session id.
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let session_id = path.into_inner();
    if let Err(resp) = crate::support::require_registered_caller(&data, &http_req) {
        return resp;
    }
    let Some(join_url) = in_app_join_url(&session_id) else {
        return join_links_unconfigured();
    };
    match crate::support::generate_qr_code_base64(&join_url) {
        Some(png_base64) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "session_id": session_id,
            "join_url": join_url,
            "qr_png_base64": png_base64,
        })),
        None => HttpResponse::InternalServerError().json(ErrorResponse {
            error: "Failed to generate QR code".to_string(),
            code: "QR_ERROR".to_string(),
        }),
    }
}

#[cfg(test)]
mod join_window_tests {
    use super::{within_join_window, JOIN_CLOSES_AFTER_SECS, JOIN_OPENS_BEFORE_SECS};

    const START: i64 = 1_800_000_000;

    #[test]
    fn the_room_is_open_around_the_appointment() {
        assert!(within_join_window(START, START), "at the scheduled minute");
        assert!(within_join_window(
            START,
            START - JOIN_OPENS_BEFORE_SECS + 1
        ));
        assert!(within_join_window(
            START,
            START + JOIN_CLOSES_AFTER_SECS - 1
        ));
    }

    /// A link is a private clinical space, not a permanent address. Booking an
    /// appointment must not make its room reachable from that moment on.
    #[test]
    fn the_room_is_shut_well_before_the_appointment() {
        assert!(!within_join_window(
            START,
            START - JOIN_OPENS_BEFORE_SECS - 1
        ));
        assert!(!within_join_window(START, START - 7 * 24 * 3600));
    }

    #[test]
    fn the_room_does_not_stay_open_forever_afterwards() {
        assert!(!within_join_window(
            START,
            START + JOIN_CLOSES_AFTER_SECS + 1
        ));
        assert!(!within_join_window(START, START + 30 * 24 * 3600));
    }

    /// The boundaries are inclusive, so a patient arriving exactly on the
    /// early edge is not turned away by a rounding accident.
    #[test]
    fn the_window_boundaries_are_inclusive() {
        assert!(within_join_window(START, START - JOIN_OPENS_BEFORE_SECS));
        assert!(within_join_window(START, START + JOIN_CLOSES_AFTER_SECS));
    }
}

/// Who clears the role gate before a session-specific recording check.
///
/// The handler asks `role_is_moderator(&user.role.to_string())`. That
/// composition — `Role`'s `Display` feeding the Jitsi moderator mapping — is
/// what these tests pin, because the defect they cover lived exactly there:
/// the gate used to ask `is_healthcare_provider()`, which is *true* for
/// Pharmacist, while the JWT's moderator claim said otherwise. The room and the
/// API disagreed about who the moderator was.
#[cfg(test)]
mod recording_authority_tests {
    use super::{is_assigned_recording_provider, parse_recording_action};
    use crate::telehealth::role_is_moderator;
    use crate::Role;

    fn may_control_recording(role: &Role) -> bool {
        role_is_moderator(&role.to_string())
    }

    #[test]
    fn a_pharmacist_cannot_start_recording_a_consultation() {
        assert!(
            !may_control_recording(&Role::Pharmacist),
            "a pharmacist is not a moderator of a clinical consultation"
        );
    }

    #[test]
    fn a_patient_cannot_start_recording_their_own_consultation() {
        assert!(!may_control_recording(&Role::Patient));
    }

    #[test]
    fn the_treating_clinicians_can_control_recording() {
        assert!(may_control_recording(&Role::Doctor));
        assert!(may_control_recording(&Role::Nurse));
        assert!(may_control_recording(&Role::Admin));
    }

    /// Every `Role` is decided deliberately, so adding a variant to the enum
    /// forces a decision here rather than silently inheriting a default.
    #[test]
    fn every_role_has_an_explicit_recording_decision() {
        for (role, expected) in [
            (Role::Admin, true),
            (Role::Doctor, true),
            (Role::Nurse, true),
            (Role::LabTechnician, true),
            (Role::Pharmacist, false),
            (Role::Patient, false),
        ] {
            assert_eq!(
                may_control_recording(&role),
                expected,
                "recording authority for {role}"
            );
        }
    }

    /// The regression itself: `is_healthcare_provider()` is a wider set than
    /// the moderator set, and using it as the recording gate is what let a
    /// pharmacist in. If the two ever become identical this test is the place
    /// that says the distinction was intentional.
    #[test]
    fn healthcare_provider_is_deliberately_wider_than_moderator() {
        assert!(
            Role::Pharmacist.is_healthcare_provider(),
            "a pharmacist is still a healthcare provider"
        );
        assert!(
            !may_control_recording(&Role::Pharmacist),
            "but that does not make them a session moderator"
        );
    }

    #[test]
    fn only_start_and_stop_are_valid_recording_actions() {
        assert_eq!(parse_recording_action("start"), Ok(true));
        assert_eq!(parse_recording_action("stop"), Ok(false));
        assert!(parse_recording_action("pause").is_err());
        assert!(parse_recording_action("").is_err());
    }

    #[test]
    fn a_moderator_cannot_control_another_providers_session() {
        assert!(is_assigned_recording_provider("doctor-a", "doctor-a"));
        assert!(!is_assigned_recording_provider("doctor-b", "doctor-a"));
    }
}

/// The clinician who books a session sees it in their own list. It is stored
/// against the patient and names the clinician only as `provider_id`.
#[cfg(test)]
mod provider_session_list_tests {
    use crate::test_fixtures::{register, seed_patient};
    use crate::{AppState, Role};
    use actix_web::{test, web, App};

    #[actix_rt::test]
    async fn the_booking_clinician_sees_the_session_without_searching_for_the_patient() {
        let state = AppState::new();
        register(&state, "5DocTele", Role::Doctor);
        register(&state, "5OtherDoc", Role::Doctor);
        seed_patient(&state, "PAT-TELE-1").await;
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .service(super::create_telehealth_session)
                .service(super::list_my_telehealth_sessions),
        )
        .await;

        let created: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::post()
                .uri("/api/telehealth/sessions")
                .insert_header(("X-User-Id", "5DocTele"))
                .set_json(serde_json::json!({
                    "patient_id": "PAT-TELE-1",
                    "session_type": "VideoVisit",
                    "scheduled_start": chrono::Utc::now().timestamp() + 86_400,
                }))
                .to_request(),
        )
        .await;
        let session_id = created["session"]["session_id"]
            .as_str()
            .or_else(|| created["session_id"].as_str())
            .unwrap_or_else(|| panic!("no session id in {created}"))
            .to_string();

        let list = |who: &'static str| {
            test::TestRequest::get()
                .uri("/api/telehealth/sessions")
                .insert_header(("X-User-Id", who))
                .to_request()
        };
        let mine: serde_json::Value = test::call_and_read_body_json(&app, list("5DocTele")).await;
        let ids: Vec<&str> = mine["sessions"]
            .as_array()
            .expect("sessions")
            .iter()
            .filter_map(|s| s["session_id"].as_str())
            .collect();
        assert_eq!(ids, vec![session_id.as_str()], "{mine}");

        let theirs: serde_json::Value =
            test::call_and_read_body_json(&app, list("5OtherDoc")).await;
        assert_eq!(theirs["count"], 0, "another clinician's list: {theirs}");
    }
}
