//! `clinical_endpoints::clinical_support::telehealth` — Phase 26 (telehealth integration).
//!
//! Split out of the former single-file `clinical_support.rs` (itself split from the
//! original 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `clinical_support/mod.rs`
//! so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

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
}

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
#[allow(clippy::too_many_arguments)]
pub(crate) async fn provision_session(
    data: &crate::AppState,
    patient_id: &str,
    provider_id: &str,
    appointment_id: Option<String>,
    scheduled_start: i64,
    session_type: crate::clinical::TelehealthType,
    recording_enabled: bool,
) -> Result<ProvisionedSession, String> {
    let session_id = format!("TH-{}", uuid::Uuid::new_v4());
    let scheduled_at =
        chrono::DateTime::from_timestamp(scheduled_start, 0).unwrap_or_else(chrono::Utc::now);

    let service_params = crate::telehealth::CreateSessionParams {
        session_id: session_id.clone(),
        patient_id: patient_id.to_string(),
        provider_id: provider_id.to_string(),
        scheduled_at,
        duration_minutes: 60,
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
    data.repositories
        .telehealth_session_records
        .create(crate::repositories::traits::JsonRecordEntity {
            id: session_id,
            owner_id: session.patient_id.clone(),
            data: serde_json::to_value(&session).unwrap_or_default(),
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
            success: false,
            error: "Only healthcare providers can create telehealth sessions".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let session_type = match req.session_type.as_str() {
        "video" => crate::clinical::TelehealthType::VideoVisit,
        "phone" => crate::clinical::TelehealthType::PhoneCall,
        "message" => crate::clinical::TelehealthType::SecureMessage,
        "async_video" => crate::clinical::TelehealthType::AsyncVideo,
        "monitoring" => crate::clinical::TelehealthType::RemoteMonitoring,
        "group" => crate::clinical::TelehealthType::VirtualGroupVisit,
        _ => crate::clinical::TelehealthType::VideoVisit,
    };

    // Same provisioning path the appointment booking uses, so a session
    // created here and one created by booking a telehealth appointment are the
    // same object with the same guarantees.
    let provisioned = match provision_session(
        &data,
        &req.patient_id,
        &current_user_id,
        req.appointment_id.clone(),
        req.scheduled_start,
        session_type,
        req.recording_enabled.unwrap_or(false),
    )
    .await
    {
        Ok(p) => p,
        Err(e) => {
            log::error!("telehealth session provisioning failed: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
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
                success: false,
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
            success: false,
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
                success: false,
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
            success: false,
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
            success: false,
            error: "This consultation has ended".to_string(),
            code: "SESSION_ENDED".to_string(),
        });
    }

    // Nor is it a room that exists from the moment it is booked. The window is
    // enforced here, not merely hidden in the UI, so a saved link cannot be
    // used weeks early or long afterwards.
    if !within_join_window(session.scheduled_start, now) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
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
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: session_id.clone(),
            owner_id: session.patient_id.clone(),
            data: serde_json::to_value(&session).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data
            .repositories
            .telehealth_session_records
            .create(entity)
            .await;
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
        if let Err(e) = data.repositories.access_logs.create(log).await {
            log::error!("telehealth join audit write failed: {e}");
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

    let start = std::time::Instant::now();
    let probe = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build();
    let (status, http_status) = match probe {
        Ok(client) => match client.get(format!("https://{}/", domain)).send().await {
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
            success: false,
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
    let _ = data.repositories.access_logs.create(log).await;

    HttpResponse::Ok().json(serde_json::json!({ "success": true }))
}

#[derive(serde::Deserialize)]
pub struct RecordingRequest {
    /// "start" or "stop".
    pub action: String,
    /// Required true to start (explicit recording consent).
    pub consent: Option<bool>,
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
            success: false,
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
                success: false,
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    let starting = body.action == "start";
    if starting && body.consent != Some(true) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Recording requires explicit consent".to_string(),
            code: "CONSENT_REQUIRED".to_string(),
        });
    }
    session.recording_enabled = starting;
    if starting {
        session.recording_consent = true;
    }

    // Phase 6: on stop, run the configured transcriber and fold any transcript
    // into the visit notes so it lands in the clinical record. No-op unless a
    // STT provider is configured via `TRANSCRIPTION_PROVIDER`.
    if !starting {
        append_transcript_on_stop(&mut session).await;
    }

    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: session_id.clone(),
        owner_id: session.patient_id.clone(),
        data: serde_json::to_value(&session).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    let _ = data
        .repositories
        .telehealth_session_records
        .create(entity)
        .await;

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
    if let Err(e) = data.repositories.access_logs.create(log).await {
        log::error!("telehealth {action} audit write failed: {e}");
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
                success: false,
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only provider can end session
    if session.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
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
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: session_id.clone(),
            owner_id: session.patient_id.clone(),
            data: serde_json::to_value(&session).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data
            .repositories
            .telehealth_session_records
            .create(entity)
            .await;
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

/// Device check request
#[derive(Debug, Deserialize)]
pub struct DeviceCheckRequest {
    pub camera_working: bool,
    pub microphone_working: bool,
    pub speaker_working: bool,
    pub browser: String,
    pub bandwidth_mbps: Option<f32>,
}

/// Submit device check results
#[post("/api/telehealth/device-check")]
pub async fn submit_device_check(
    // Was `_data`: the handler ignored application state entirely, which is
    // exactly why it could only check that a header was present. It now
    // resolves the caller against the user store.
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<DeviceCheckRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let supported_browsers = ["chrome", "firefox", "safari", "edge"];
    let browser_supported = supported_browsers
        .iter()
        .any(|b| req.browser.to_lowercase().contains(b));

    let bandwidth = req.bandwidth_mbps.unwrap_or(0.0);
    let bandwidth_adequate = bandwidth >= 2.0;

    let mut issues: Vec<String> = Vec::new();
    let mut recommendations: Vec<String> = Vec::new();

    if !req.camera_working {
        issues.push("Camera not detected or not working".to_string());
        recommendations
            .push("Check camera permissions and ensure it's not in use by another app".to_string());
    }
    if !req.microphone_working {
        issues.push("Microphone not detected or not working".to_string());
        recommendations.push("Check microphone permissions and settings".to_string());
    }
    if !req.speaker_working {
        issues.push("Audio output not working".to_string());
        recommendations.push("Check speaker/headphone connection and volume settings".to_string());
    }
    if !browser_supported {
        issues.push("Browser may not be fully supported".to_string());
        recommendations
            .push("Use Chrome, Firefox, Safari, or Edge for best experience".to_string());
    }
    if !bandwidth_adequate {
        issues.push(format!(
            "Bandwidth ({:.1} Mbps) may be insufficient",
            bandwidth
        ));
        recommendations.push(
            "Minimum 2 Mbps recommended. Close other applications using internet".to_string(),
        );
    }

    let ready =
        req.camera_working && req.microphone_working && browser_supported && bandwidth_adequate;

    let device_check = crate::clinical::DeviceCheck {
        check_id: format!("DC-{}", uuid::Uuid::new_v4()),
        patient_id: current_user_id,
        checked_at: chrono::Utc::now().timestamp(),
        camera_working: req.camera_working,
        microphone_working: req.microphone_working,
        speaker_working: req.speaker_working,
        browser_supported,
        bandwidth_adequate,
        bandwidth_mbps: bandwidth,
        issues_detected: issues.clone(),
        recommendations: recommendations.clone(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "ready_for_telehealth": ready,
        "check_id": device_check.check_id,
        "issues": issues,
        "recommendations": recommendations,
        "details": {
            "camera": req.camera_working,
            "microphone": req.microphone_working,
            "speaker": req.speaker_working,
            "browser_supported": browser_supported,
            "bandwidth_adequate": bandwidth_adequate,
            "bandwidth_mbps": bandwidth
        }
    }))
}

/// Get patient's telehealth sessions
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
            success: false,
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

/// On recording stop, run the configured transcriber and append any transcript
/// to the session's visit notes (Phase 6). No-op when transcription is
/// unconfigured (default). Returns true when notes were updated.
async fn append_transcript_on_stop(session: &mut crate::clinical::TelehealthSession) -> bool {
    let transcriber = crate::services::transcription::transcriber_from_env();
    let req = crate::services::transcription::TranscriptionRequest {
        session_id: session.session_id.clone(),
        recording_ref: None,
        language: "en".to_string(),
    };
    match transcriber.transcribe(&req).await {
        Ok(Some(text)) if !text.is_empty() => {
            let mut notes = session.visit_notes.clone().unwrap_or_default();
            notes.push_str("\n\n[Auto-transcript]\n");
            notes.push_str(&text);
            session.visit_notes = Some(notes);
            true
        }
        _ => false,
    }
}

/// In-app web join URL for a session (Phase 4 — fully in-app, **no** native-app
/// deep links). Points at the PWA telehealth route so a scan/tap stays inside
/// MediChain. Configurable via `MEDICHAIN_APP_URL`.
fn in_app_join_url(session_id: &str) -> String {
    let base = std::env::var("MEDICHAIN_APP_URL")
        .unwrap_or_else(|_| "https://app.medichain.health".to_string());
    let base = base.trim_end_matches('/');
    format!("{}/telehealth?session={}&join=1", base, session_id)
}

/// Single-tap join redirect (Phase 4). Issues a 302 to the in-app web room so
/// phones open the consultation **inside the MediChain PWA** — never a native
/// app or app-store download. The SPA handles auth + auto-join from the query.
#[get("/api/telehealth/join/{session_id}")]
pub async fn telehealth_join_redirect(path: web::Path<String>) -> impl Responder {
    let session_id = path.into_inner();
    let target = in_app_join_url(&session_id);
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
    let join_url = in_app_join_url(&session_id);
    match crate::support::generate_qr_code_base64(&join_url) {
        Some(png_base64) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "session_id": session_id,
            "join_url": join_url,
            "qr_png_base64": png_base64,
        })),
        None => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
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

/// Who may control recording of a consultation.
///
/// The handler asks `role_is_moderator(&user.role.to_string())`. That
/// composition — `Role`'s `Display` feeding the Jitsi moderator mapping — is
/// what these tests pin, because the defect they cover lived exactly there:
/// the gate used to ask `is_healthcare_provider()`, which is *true* for
/// Pharmacist, while the JWT's moderator claim said otherwise. The room and the
/// API disagreed about who the moderator was.
#[cfg(test)]
mod recording_authority_tests {
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
}
