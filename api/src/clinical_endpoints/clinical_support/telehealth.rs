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

    let session_id = format!("TH-{}", uuid::Uuid::new_v4());

    // Delegate URL generation to the configured TelehealthService provider
    // (internal / Daily.co / Twilio). Falls back gracefully to Jitsi-style URLs.
    let scheduled_at =
        chrono::DateTime::from_timestamp(req.scheduled_start, 0).unwrap_or_else(chrono::Utc::now);
    let service_params = crate::telehealth::CreateSessionParams {
        session_id: session_id.clone(),
        patient_id: req.patient_id.clone(),
        provider_id: current_user_id.clone(),
        scheduled_at,
        duration_minutes: 60,
    };
    let session_info = data.telehealth_service.create_session(service_params).await;

    let (provider_join_url, patient_join_url, video_room_url, waiting_room_url, platform) =
        match session_info {
            Ok(ref info) => (
                info.provider_join_url.clone(),
                info.patient_join_url.clone(),
                info.provider_join_url.clone(),
                info.patient_join_url.clone(),
                info.provider_name.clone(),
            ),
            Err(ref e) => {
                // Graceful fallback to Jitsi if the provider call fails
                log::warn!(
                    "TelehealthService::create_session failed ({}); falling back to Jitsi",
                    e
                );
                let room_name = format!(
                    "medichain-{}-{}",
                    session_id.to_lowercase().replace('_', "-"),
                    &uuid::Uuid::new_v4().to_string()[..8]
                );
                (
                    format!(
                        "https://meet.jit.si/{}#userInfo.displayName=%22Provider%22",
                        room_name
                    ),
                    format!(
                        "https://meet.jit.si/{}#userInfo.displayName=%22Patient%22",
                        room_name
                    ),
                    format!("https://meet.jit.si/{}", room_name),
                    format!("https://meet.jit.si/{}", room_name),
                    "jitsi-fallback".to_string(),
                )
            }
        };

    let session = crate::clinical::TelehealthSession {
        session_id: session_id.clone(),
        appointment_id: req.appointment_id.clone(),
        patient_id: req.patient_id.clone(),
        provider_id: current_user_id.clone(),
        session_type,
        scheduled_start: req.scheduled_start,
        actual_start: None,
        actual_end: None,
        status: crate::clinical::TelehealthStatus::Scheduled,
        video_room_url: video_room_url.clone(),
        waiting_room_url: waiting_room_url.clone(),
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
        recording_enabled: req.recording_enabled.unwrap_or(false),
        recording_consent: false,
        chat_enabled: true,
        screen_share_enabled: true,
        quality_metrics: None,
        visit_notes: None,
        follow_up_scheduled: None,
    };

    {
        // Persist via repository (was: in-memory data.telehealth_sessions HashMap)
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

    // Only patient or provider can view session
    if session.patient_id != current_user_id && session.provider_id != current_user_id {
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
    let is_patient = session.patient_id == current_user_id;
    let is_provider = session.provider_id == current_user_id;

    if !is_patient && !is_provider {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "You are not part of this session".to_string(),
            code: "FORBIDDEN".to_string(),
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
        "video_room_url": session.video_room_url,
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
];

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

    // Only a healthcare provider (moderator) may control recording.
    let is_moderator = crate::support::get_user(&data, &actor)
        .map(|u| u.role.is_healthcare_provider())
        .unwrap_or(false);
    if !is_moderator {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only the provider can control recording".to_string(),
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
        accessor_role: "moderator".to_string(),
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
    let _ = data.repositories.access_logs.create(log).await;
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
