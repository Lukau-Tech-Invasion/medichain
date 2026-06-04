//! `clinical_endpoints::clinical_support` — handlers split out of the original 21K-line monolith (Phase 10.1).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

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
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

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

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
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

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
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

#[derive(serde::Deserialize)]
pub struct TelehealthEventRequest {
    /// e.g. "participant-joined", "participant-left", "error".
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
    let actor = match crate::support::get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Authentication required".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };
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
    let actor = match crate::support::get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Authentication required".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
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

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
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
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<DeviceCheckRequest>,
) -> impl Responder {
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
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
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    let is_own = current_user_id == patient_id;
    if !is_own && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_sessions: Vec<crate::clinical::TelehealthSession> = data
        .repositories
        .telehealth_session_records
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::clinical::TelehealthSession>(r.data).ok())
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "sessions": patient_sessions,
        "count": patient_sessions.len()
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
pub async fn telehealth_join_qr(http_req: HttpRequest, path: web::Path<String>) -> impl Responder {
    let session_id = path.into_inner();
    if crate::support::get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Authentication required".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
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

// ============================================================================
// PHASE 27: CLINICAL DECISION SUPPORT (CDS)
// ============================================================================

/// Evaluate Clinical Decision Support rules for a patient based on their current vitals/labs.
/// Returns a list of auto-generated CDS alerts that should be created.
/// Fetch a patient's chronic conditions and current medications (best-effort) so
/// the CDS engine can evaluate drug/condition rules. Returns empty vecs when the
/// patient or profile blob isn't available.
pub async fn patient_conditions_and_meds(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> (Vec<String>, Vec<String>) {
    data.repositories
        .patients
        .get_by_id(patient_id)
        .await
        .ok()
        .and_then(|e| crate::patient_entity_to_profile(&e, &data.encryption_key))
        .map(|p| {
            (
                p.emergency_info.chronic_conditions,
                p.emergency_info.current_medications,
            )
        })
        .unwrap_or_default()
}

/// Run the CDS rules engine for a patient and persist + broadcast any new alerts.
///
/// Applies simple alert-fatigue suppression: an alert is skipped when an active
/// alert with the same title already exists for the patient (and duplicates within
/// a single evaluation are collapsed). Shared by every handler that triggers CDS
/// (vital signs, lab results, medication administration, nursing assessments).
pub async fn run_and_persist_cds_alerts(
    data: &web::Data<AppState>,
    patient_id: &str,
    vitals: Option<&crate::clinical::VitalSignsReading>,
    lab_values: Option<&std::collections::HashMap<String, f64>>,
    conditions: &[String],
    medications: &[String],
) {
    let alerts = evaluate_cds_rules(patient_id, vitals, lab_values, conditions, medications);
    if alerts.is_empty() {
        return;
    }
    // Active alert titles already on file for this patient (fatigue suppression).
    let existing: std::collections::HashSet<String> = data
        .repositories
        .cds_alerts
        .get_by_patient(patient_id, true)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|a| a.alert_title)
        .collect();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for alert in &alerts {
        if !seen.insert(alert.title.clone()) || existing.contains(&alert.title) {
            continue; // duplicate within this batch, or already an active alert
        }
        log::info!(
            "CDS alert fired for patient {}: {}",
            patient_id,
            alert.alert_id
        );
        crate::websocket::push_cds_alert(
            &data.ws_manager,
            patient_id,
            &alert.title,
            &format!("{:?}", alert.severity),
        );
        let entity: crate::repositories::traits::CdsAlertEntity = alert.clone().into();
        if let Err(e) = data.repositories.cds_alerts.create(entity).await {
            log::error!("Failed to persist CDS alert {}: {}", alert.alert_id, e);
        }
    }
}

pub fn evaluate_cds_rules(
    patient_id: &str,
    vitals: Option<&crate::clinical::VitalSignsReading>,
    lab_values: Option<&std::collections::HashMap<String, f64>>,
    patient_conditions: &[String],
    current_medications: &[String],
) -> Vec<crate::clinical::CDSAlert> {
    let mut alerts = Vec::new();
    let now = chrono::Utc::now().timestamp();

    // Helper closure for creating alerts
    let make_alert = |id_suffix: &str,
                      alert_type: crate::clinical::CDSAlertType,
                      title: &str,
                      description: &str,
                      severity: crate::clinical::CDSSeverity,
                      recommendation: &str|
     -> crate::clinical::CDSAlert {
        crate::clinical::CDSAlert {
            alert_id: format!("AUTO-CDS-{}-{}", id_suffix, uuid::Uuid::new_v4()),
            patient_id: patient_id.to_string(),
            provider_id: "cds_rules_engine".to_string(),
            alert_type,
            severity,
            title: title.to_string(),
            description: description.to_string(),
            clinical_context: "Automated CDS rules evaluation".to_string(),
            triggering_data: serde_json::json!({ "source": "automated_rules_engine" }),
            recommended_actions: vec![crate::clinical::CDSRecommendedAction {
                action_id: format!("ACT-{}", uuid::Uuid::new_v4()),
                action_type: "clinical_action".to_string(),
                description: recommendation.to_string(),
                strength: crate::clinical::RecommendationStrength::Strong,
                one_click_order: None,
            }],
            evidence: vec![crate::clinical::CDSEvidence {
                source: "CDS Rules Engine".to_string(),
                citation: "Clinical decision support automated rule".to_string(),
                url: None,
                evidence_grade: "A".to_string(),
            }],
            guideline_reference: None,
            created_at: now,
            expires_at: None,
            status: crate::clinical::CDSAlertStatus::Active,
            response: None,
        }
    };

    // --- VITAL SIGNS RULES ---
    if let Some(v) = vitals {
        // Sepsis screening (qSOFA criteria) — using available fields
        let mut qsofa_score = 0;
        if let Some(rr) = v.respiratory_rate {
            if rr >= 22 {
                qsofa_score += 1;
            }
        }
        if let Some(sbp) = v.systolic_bp {
            if sbp <= 100 {
                qsofa_score += 1;
            }
        }
        if qsofa_score >= 2 {
            alerts.push(make_alert(
                "SEPSIS",
                crate::clinical::CDSAlertType::BestPracticeAdvisory,
                "Sepsis Alert - qSOFA \u{2265} 2",
                &format!(
                    "qSOFA score: {}. Criteria met: RR\u{2265}22:{}, SBP\u{2264}100:{}",
                    qsofa_score,
                    v.respiratory_rate.map(|r| r >= 22).unwrap_or(false),
                    v.systolic_bp.map(|s| s <= 100).unwrap_or(false),
                ),
                crate::clinical::CDSSeverity::Critical,
                "Initiate sepsis bundle: blood cultures x2, lactate, broad-spectrum antibiotics within 1 hour, 30mL/kg IV crystalloid if hypotensive",
            ));
        }

        // Hypertensive crisis
        if let (Some(sbp), Some(dbp)) = (v.systolic_bp, v.diastolic_bp) {
            if sbp >= 180 || dbp >= 120 {
                alerts.push(make_alert(
                    "HTNCRISIS",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Hypertensive Crisis",
                    &format!("BP: {}/{} mmHg", sbp, dbp),
                    crate::clinical::CDSSeverity::Critical,
                    "Assess for end-organ damage. IV labetalol or nicardipine if hypertensive emergency. Oral agents if urgency only.",
                ));
            }
        }

        // Hypotensive shock
        if let Some(sbp) = v.systolic_bp {
            if sbp < 90 {
                let hr_tachycardia = v.heart_rate.map(|h| h > 100).unwrap_or(false);
                alerts.push(make_alert(
                    "HYPOSHOCK",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    if hr_tachycardia { "Shock - Hypotension + Tachycardia" } else { "Hypotension Alert" },
                    &format!("SBP: {} mmHg{}", sbp, if hr_tachycardia { ", HR >100 bpm" } else { "" }),
                    if hr_tachycardia { crate::clinical::CDSSeverity::Critical } else { crate::clinical::CDSSeverity::High },
                    "IV access x2, fluid resuscitation, determine shock type (septic/hemorrhagic/cardiogenic/distributive), consider vasopressors",
                ));
            }
        }

        // Bradycardia
        if let Some(hr) = v.heart_rate {
            if hr < 50 {
                alerts.push(make_alert(
                    "BRADY",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Severe Bradycardia",
                    &format!("HR: {} bpm", hr),
                    crate::clinical::CDSSeverity::High,
                    "12-lead ECG, assess for AV block, consider atropine 0.5mg IV if symptomatic",
                ));
            }
            // Tachycardia
            if hr > 130 {
                alerts.push(make_alert(
                    "TACHY",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Severe Tachycardia",
                    &format!("HR: {} bpm", hr),
                    crate::clinical::CDSSeverity::High,
                    "12-lead ECG, identify and treat underlying cause, consider rate control if stable",
                ));
            }
        }

        // Fever
        if let Some(temp) = v.temperature_celsius {
            if temp >= 38.5 {
                let severity = if temp >= 40.0 {
                    crate::clinical::CDSSeverity::Critical
                } else {
                    crate::clinical::CDSSeverity::High
                };
                alerts.push(make_alert(
                    "FEVER",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Fever Alert",
                    &format!("Temperature: {:.1}\u{00b0}C", temp),
                    severity,
                    if temp >= 40.0 {
                        "High fever - blood cultures, CBC, CMP, consider LP if meningeal signs, aggressive antipyretics, cooling measures"
                    } else {
                        "Fever - blood cultures if bacteremia suspected, CBC, antipyretics, investigate source"
                    },
                ));
            }
            if temp < 35.0 {
                alerts.push(make_alert(
                    "HYPOTHERMIA",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Hypothermia Alert",
                    &format!("Temperature: {:.1}\u{00b0}C", temp),
                    crate::clinical::CDSSeverity::Critical,
                    "Active warming, monitor for cardiac arrhythmias, check glucose, thyroid function",
                ));
            }
        }

        // Hypoxia
        if let Some(spo2) = v.oxygen_saturation {
            if spo2 < 90 {
                alerts.push(make_alert(
                    "HYPOXIA",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Critical Hypoxia",
                    &format!("SpO2: {}%", spo2),
                    crate::clinical::CDSSeverity::Critical,
                    "Supplemental O2 immediately, ABG, CXR, assess for PE/pneumonia/ARDS, prepare for intubation if refractory",
                ));
            } else if spo2 < 94 {
                alerts.push(make_alert(
                    "LOWSPO2",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Low Oxygen Saturation",
                    &format!("SpO2: {}%", spo2),
                    crate::clinical::CDSSeverity::High,
                    "Supplemental O2, assess work of breathing, ABG, CXR",
                ));
            }
        }
    }

    // --- LAB VALUE RULES ---
    if let Some(labs) = lab_values {
        // Acute Kidney Injury
        if let Some(&creatinine) = labs.get("creatinine") {
            if creatinine > 354.0 {
                // >4 mg/dL in µmol/L
                alerts.push(make_alert(
                    "AKI",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Severe AKI - Critical Creatinine",
                    &format!("Creatinine: {:.0} \u{00b5}mol/L", creatinine),
                    crate::clinical::CDSSeverity::Critical,
                    "Nephrology consult, hold nephrotoxins, strict fluid balance, consider renal replacement therapy",
                ));
            }
        }

        // Hyperkalemia
        if let Some(&potassium) = labs.get("potassium") {
            if potassium > 6.5 {
                alerts.push(make_alert(
                    "HYPERK",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Critical Hyperkalemia",
                    &format!("K+: {:.1} mmol/L", potassium),
                    crate::clinical::CDSSeverity::Critical,
                    "ECG immediately, calcium gluconate 1g IV, insulin 10u + D50W, sodium bicarbonate if acidotic, consider Kayexalate or dialysis",
                ));
            }
        }

        // Hyponatremia
        if let Some(&sodium) = labs.get("sodium") {
            if sodium < 120.0 {
                alerts.push(make_alert(
                    "HYPONATR",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Severe Hyponatremia",
                    &format!("Na+: {:.0} mmol/L", sodium),
                    crate::clinical::CDSSeverity::Critical,
                    "Neurology consult, 3% NaCl if symptomatic (seizures/altered MS), correct no faster than 8-12 mEq/L per 24h to avoid osmotic demyelination",
                ));
            }
        }

        // Critical hemoglobin
        if let Some(&hgb) = labs.get("hemoglobin") {
            if hgb < 70.0 {
                // < 7 g/dL in g/L
                alerts.push(make_alert(
                    "CRITANEMIA",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Critical Anemia",
                    &format!("Hemoglobin: {:.0} g/L", hgb),
                    crate::clinical::CDSSeverity::Critical,
                    "Transfusion threshold met, type and crossmatch, consider transfusion if symptomatic, identify bleeding source",
                ));
            }
        }

        // Troponin elevation
        if let Some(&troponin) = labs.get("troponin") {
            if troponin > 0.04 {
                // ng/mL
                alerts.push(make_alert(
                    "TROPONIN",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Elevated Troponin - ACS Suspected",
                    &format!("Troponin: {:.3} ng/mL", troponin),
                    crate::clinical::CDSSeverity::Critical,
                    "12-lead ECG, cardiology consult, aspirin 325mg, anticoagulation, serial troponins at 3h, consider cath lab activation",
                ));
            }
        }

        // INR supratherapeutic
        if let Some(&inr) = labs.get("inr") {
            if inr > 4.0 {
                alerts.push(make_alert(
                    "SUPRAINR",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Supratherapeutic INR",
                    &format!("INR: {:.1}", inr),
                    crate::clinical::CDSSeverity::High,
                    if inr > 9.0 {
                        "Hold warfarin, Vitamin K 10mg IV, consider 4-factor PCC if active bleeding"
                    } else {
                        "Hold warfarin, Vitamin K 2.5-5mg PO, repeat INR in 24h"
                    },
                ));
            }
        }

        // Lactic acidosis
        if let Some(&lactate) = labs.get("lactate") {
            if lactate > 4.0 {
                alerts.push(make_alert(
                    "LACTATCRIT",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Critical Lactic Acidosis",
                    &format!("Lactate: {:.1} mmol/L", lactate),
                    crate::clinical::CDSSeverity::Critical,
                    "Identify underlying cause (sepsis, mesenteric ischemia, hepatic failure), aggressive resuscitation, repeat lactate in 2h",
                ));
            }
        }
    }

    // --- MEDICATION SAFETY RULES ---
    let meds_lower: Vec<String> = current_medications
        .iter()
        .map(|m| m.to_lowercase())
        .collect();

    // Anticoagulation fall risk
    if meds_lower.iter().any(|m| {
        m.contains("warfarin")
            || m.contains("heparin")
            || m.contains("rivaroxaban")
            || m.contains("apixaban")
            || m.contains("dabigatran")
    }) {
        if patient_conditions
            .iter()
            .any(|c| c.to_lowercase().contains("fall") || c.to_lowercase().contains("dementia"))
        {
            alerts.push(make_alert(
                "ANTICOAGFALL",
                crate::clinical::CDSAlertType::BestPracticeAdvisory,
                "High Bleeding Risk - Anticoagulation + Fall Risk",
                "Patient on anticoagulant with documented fall risk or dementia",
                crate::clinical::CDSSeverity::High,
                "Fall prevention protocol, bed alarm, consider dose reduction, ensure INR/anti-Xa monitoring in place",
            ));
        }
    }

    // NSAIDs in renal impairment
    if meds_lower.iter().any(|m| {
        m.contains("ibuprofen")
            || m.contains("naproxen")
            || m.contains("diclofenac")
            || m.contains("indomethacin")
    }) {
        if patient_conditions.iter().any(|c| {
            c.to_lowercase().contains("renal")
                || c.to_lowercase().contains("kidney")
                || c.to_lowercase().contains("ckd")
        }) {
            alerts.push(make_alert(
                "NSAIDRENAL",
                crate::clinical::CDSAlertType::BestPracticeAdvisory,
                "NSAID Use in Renal Impairment",
                "Patient has renal disease and is receiving NSAID",
                crate::clinical::CDSSeverity::High,
                "Consider paracetamol/acetaminophen instead. If NSAID necessary, use lowest dose for shortest duration with close renal monitoring",
            ));
        }
    }

    alerts
}

/// Create CDS alert request
#[derive(Debug, Deserialize)]
pub struct CreateCDSAlertRequest {
    pub patient_id: String,
    pub alert_type: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub clinical_context: String,
    pub guideline_reference: Option<String>,
    pub expires_at: Option<i64>,
}

/// Create a new CDS alert
#[post("/api/cds/alerts")]
pub async fn create_cds_alert(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateCDSAlertRequest>,
) -> impl Responder {
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can create CDS alerts".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let alert_type = match req.alert_type.as_str() {
        "drug_interaction" => crate::clinical::CDSAlertType::DrugInteraction,
        "drug_allergy" => crate::clinical::CDSAlertType::DrugAllergy,
        "duplicate_therapy" => crate::clinical::CDSAlertType::DuplicateTherapy,
        "dose_range" => crate::clinical::CDSAlertType::DoseRangeCheck,
        "preventive_care" => crate::clinical::CDSAlertType::PreventiveCare,
        "diagnostic_gap" => crate::clinical::CDSAlertType::DiagnosticGap,
        "lab_abnormal" => crate::clinical::CDSAlertType::LaboratoryAbnormal,
        "vital_abnormal" => crate::clinical::CDSAlertType::VitalSignAbnormal,
        "care_plan_deviation" => crate::clinical::CDSAlertType::CarePlanDeviation,
        "quality_measure" => crate::clinical::CDSAlertType::QualityMeasure,
        "cost_saving" => crate::clinical::CDSAlertType::CostSavingOpportunity,
        "best_practice" => crate::clinical::CDSAlertType::BestPracticeAdvisory,
        "order_set" => crate::clinical::CDSAlertType::OrderSet,
        _ => crate::clinical::CDSAlertType::BestPracticeAdvisory,
    };

    let severity = match req.severity.as_str() {
        "informational" => crate::clinical::CDSSeverity::Informational,
        "low" => crate::clinical::CDSSeverity::Low,
        "medium" => crate::clinical::CDSSeverity::Medium,
        "high" => crate::clinical::CDSSeverity::High,
        "critical" => crate::clinical::CDSSeverity::Critical,
        _ => crate::clinical::CDSSeverity::Medium,
    };

    let alert_id = format!("CDS-{}", uuid::Uuid::new_v4());
    let now = chrono::Utc::now().timestamp();

    let alert = crate::clinical::CDSAlert {
        alert_id: alert_id.clone(),
        patient_id: req.patient_id.clone(),
        provider_id: current_user_id.clone(),
        alert_type,
        severity,
        title: req.title.clone(),
        description: req.description.clone(),
        clinical_context: req.clinical_context.clone(),
        triggering_data: serde_json::json!({}),
        recommended_actions: Vec::new(),
        evidence: Vec::new(),
        guideline_reference: req.guideline_reference.clone(),
        created_at: now,
        expires_at: req.expires_at,
        status: crate::clinical::CDSAlertStatus::Active,
        response: None,
    };

    let entity: crate::repositories::traits::CdsAlertEntity = alert.into();
    if let Err(e) = data.repositories.cds_alerts.create(entity).await {
        log::error!("CDS alert persistence failed: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to persist CDS alert".to_string(),
            code: "PERSISTENCE_ERROR".to_string(),
        });
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "alert_id": alert_id,
        "message": "CDS alert created successfully"
    }))
}

/// Get CDS alerts for provider
#[get("/api/cds/alerts")]
pub async fn get_cds_alerts(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can view CDS alerts".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_id = query.get("patient_id").cloned();
    let status_filter = query.get("status").cloned();

    // Repository can filter by patient; provider + status filtered in-memory.
    let entities = match patient_id.as_deref() {
        Some(pid) => match data
            .repositories
            .cds_alerts
            .get_by_patient(pid, false)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!("Failed to fetch CDS alerts by patient: {}", e);
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Failed to fetch alerts".to_string(),
                    code: "REPOSITORY_ERROR".to_string(),
                });
            }
        },
        None => match data.repositories.cds_alerts.get_unacknowledged(None).await {
            Ok(v) => v,
            Err(_) => Vec::new(),
        },
    };
    let filtered_alerts: Vec<crate::clinical::CDSAlert> = entities
        .into_iter()
        .map(crate::clinical::CDSAlert::from)
        .filter(|a| a.provider_id == current_user_id)
        .filter(|a| {
            status_filter
                .as_ref()
                .is_none_or(|s| format!("{:?}", a.status).to_lowercase() == s.to_lowercase())
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alerts": filtered_alerts,
        "count": filtered_alerts.len()
    }))
}

/// Get single CDS alert
#[get("/api/cds/alerts/{alert_id}")]
pub async fn get_cds_alert(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let alert_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let alert = match data.repositories.cds_alerts.get_by_id(&alert_id).await {
        Ok(e) => crate::clinical::CDSAlert::from(e),
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Alert not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Failed to fetch CDS alert: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch alert".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    if alert.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alert": alert
    }))
}

/// Respond to CDS alert request
#[derive(Debug, Deserialize)]
pub struct RespondCDSAlertRequest {
    pub action_taken: String,
    pub override_reason: Option<String>,
    pub notes: Option<String>,
}

/// Respond to CDS alert
#[post("/api/cds/alerts/{alert_id}/respond")]
pub async fn respond_to_cds_alert(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<RespondCDSAlertRequest>,
) -> impl Responder {
    let alert_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let mut alert: crate::clinical::CDSAlert =
        match data.repositories.cds_alerts.get_by_id(&alert_id).await {
            Ok(e) => e.into(),
            Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
                return HttpResponse::NotFound().json(ErrorResponse {
                    success: false,
                    error: "Alert not found".to_string(),
                    code: "NOT_FOUND".to_string(),
                })
            }
            Err(e) => {
                log::error!("Failed to fetch CDS alert: {}", e);
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Failed to fetch alert".to_string(),
                    code: "REPOSITORY_ERROR".to_string(),
                });
            }
        };

    if alert.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only the assigned provider can respond".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let action_taken = match req.action_taken.as_str() {
        "accepted" => crate::clinical::CDSActionTaken::Accepted,
        "accepted_modified" => crate::clinical::CDSActionTaken::AcceptedWithModification,
        "overridden" => crate::clinical::CDSActionTaken::Overridden,
        "deferred" => crate::clinical::CDSActionTaken::Deferred,
        "escalated" => crate::clinical::CDSActionTaken::EscalatedToPharmacy,
        "patient_refused" => crate::clinical::CDSActionTaken::PatientRefused,
        "not_applicable" => crate::clinical::CDSActionTaken::NotApplicable,
        _ => crate::clinical::CDSActionTaken::NotApplicable,
    };

    let now = chrono::Utc::now().timestamp();
    let time_to_response = (now - alert.created_at) as u32;

    alert.response = Some(crate::clinical::CDSResponse {
        responded_at: now,
        responded_by: current_user_id.clone(),
        action_taken: action_taken.clone(),
        override_reason: req.override_reason.clone(),
        notes: req.notes.clone(),
        time_to_response_seconds: time_to_response,
    });

    // Update status based on action
    alert.status = match action_taken {
        crate::clinical::CDSActionTaken::Accepted
        | crate::clinical::CDSActionTaken::AcceptedWithModification => {
            crate::clinical::CDSAlertStatus::Accepted
        }
        crate::clinical::CDSActionTaken::Overridden => crate::clinical::CDSAlertStatus::Overridden,
        crate::clinical::CDSActionTaken::Deferred => crate::clinical::CDSAlertStatus::Deferred,
        _ => crate::clinical::CDSAlertStatus::Acknowledged,
    };

    let entity: crate::repositories::traits::CdsAlertEntity = alert.clone().into();
    if let Err(e) = data.repositories.cds_alerts.update(entity).await {
        log::error!("Failed to persist CDS alert response: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to record response".to_string(),
            code: "PERSISTENCE_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alert_id": alert_id,
        "status": format!("{:?}", alert.status),
        "message": "CDS alert response recorded"
    }))
}

/// Get patient's CDS alert history
#[get("/api/cds/patient/{patient_id}/alerts")]
pub async fn get_patient_cds_alerts(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can view patient CDS alerts".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_alerts: Vec<crate::clinical::CDSAlert> = match data
        .repositories
        .cds_alerts
        .get_by_patient(&patient_id, false)
        .await
    {
        Ok(entities) => entities
            .into_iter()
            .map(crate::clinical::CDSAlert::from)
            .collect(),
        Err(e) => {
            log::error!("Failed to fetch patient CDS alerts: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch alerts".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "alerts": patient_alerts,
        "count": patient_alerts.len()
    }))
}

// ============================================================================
// PHASE 28: LAB RESULT TRENDING
// ============================================================================

/// Compute descriptive statistics and trend direction for a slice of numeric lab values.
fn compute_lab_statistics(values: &[f64]) -> serde_json::Value {
    if values.is_empty() {
        return serde_json::json!({ "count": 0 });
    }
    let count = values.len() as f64;
    let mean = values.iter().sum::<f64>() / count;
    let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / count;
    let std_dev = variance.sqrt();
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let min = sorted[0];
    let max = sorted[sorted.len() - 1];
    let median = if sorted.len() % 2 == 0 {
        (sorted[sorted.len() / 2 - 1] + sorted[sorted.len() / 2]) / 2.0
    } else {
        sorted[sorted.len() / 2]
    };
    // Trend direction: compare last 3 values to first 3 values
    let trend = if values.len() >= 6 {
        let first_avg = values[..3].iter().sum::<f64>() / 3.0;
        let last_avg = values[values.len() - 3..].iter().sum::<f64>() / 3.0;
        if last_avg > first_avg * 1.1 {
            "increasing"
        } else if last_avg < first_avg * 0.9 {
            "decreasing"
        } else {
            "stable"
        }
    } else {
        "insufficient_data"
    };

    serde_json::json!({
        "count": values.len(),
        "mean": (mean * 100.0).round() / 100.0,
        "std_dev": (std_dev * 100.0).round() / 100.0,
        "min": min,
        "max": max,
        "median": median,
        "trend": trend,
    })
}

/// Get lab trends for patient
#[get("/api/lab-trends/patient/{patient_id}")]
pub async fn get_lab_trends(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    let is_own = current_user_id == patient_id;
    if !is_own && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let test_code = query.get("test_code").cloned();

    let trends: Vec<crate::clinical::LabTrendResult> = data
        .repositories
        .lab_trend_results
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::clinical::LabTrendResult>(r.data).ok())
        .filter(|t| test_code.as_ref().is_none_or(|code| &t.loinc_code == code))
        .collect();

    // Compute aggregate statistics across all data points in the returned trends
    let all_values: Vec<f64> = trends
        .iter()
        .flat_map(|t| t.data_points.iter().map(|dp| dp.value))
        .collect();
    let statistics = compute_lab_statistics(&all_values);

    // Per-test statistics grouped by LOINC code
    let mut per_test: std::collections::HashMap<String, Vec<f64>> =
        std::collections::HashMap::new();
    for trend in &trends {
        let vals = per_test.entry(trend.loinc_code.clone()).or_default();
        for dp in &trend.data_points {
            vals.push(dp.value);
        }
    }
    let per_test_statistics: std::collections::HashMap<String, serde_json::Value> = per_test
        .iter()
        .map(|(code, vals)| (code.clone(), compute_lab_statistics(vals)))
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "trends": trends,
        "count": trends.len(),
        "statistics": statistics,
        "per_test_statistics": per_test_statistics
    }))
}

/// Request trend analysis
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct RequestLabTrendRequest {
    pub patient_id: String,
    pub test_codes: Vec<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

/// Request lab trend analysis
#[post("/api/lab-trends/analyze")]
pub async fn analyze_lab_trends(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<RequestLabTrendRequest>,
) -> impl Responder {
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can request trend analysis".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let now = chrono::Utc::now().timestamp();
    let mut results: Vec<crate::clinical::LabTrendResult> = Vec::new();

    for test_code in &req.test_codes {
        // Generate data points first so we can compute real statistics
        let result_id = format!("LT-{}", uuid::Uuid::new_v4());
        let data_points = generate_sample_data_points(test_code, now);

        // Compute real statistics from the data points
        let point_values: Vec<f64> = data_points.iter().map(|dp| dp.value).collect();
        let stats = compute_lab_statistics(&point_values);

        // Derive trend direction and metrics from statistics
        let trend_str = stats["trend"].as_str().unwrap_or("stable");
        let trend_direction = match trend_str {
            "increasing" => crate::clinical::TrendDirection::Increasing,
            "decreasing" => crate::clinical::TrendDirection::Decreasing,
            _ => crate::clinical::TrendDirection::Stable,
        };
        let mean_val = stats["mean"].as_f64().unwrap_or(0.0);
        let min_val = stats["min"].as_f64().unwrap_or(0.0);
        let percent_change = if min_val != 0.0 {
            ((mean_val - min_val) / min_val * 100.0 * 100.0).round() / 100.0
        } else {
            0.0
        };
        let statistically_significant = stats["std_dev"].as_f64().unwrap_or(0.0) > mean_val * 0.1;
        let clinical_significance = match trend_str {
            "increasing" => format!(
                "Upward trend detected. Mean: {} (std dev: {}). Monitor closely.",
                stats["mean"], stats["std_dev"]
            ),
            "decreasing" => format!(
                "Downward trend detected. Mean: {} (std dev: {}). Review with clinician.",
                stats["mean"], stats["std_dev"]
            ),
            _ => format!(
                "Values stable. Mean: {} (std dev: {}). No significant change from baseline.",
                stats["mean"], stats["std_dev"]
            ),
        };

        let trend_result = crate::clinical::LabTrendResult {
            result_id: result_id.clone(),
            patient_id: req.patient_id.clone(),
            loinc_code: test_code.clone(),
            test_name: get_test_name(test_code),
            unit: get_test_unit(test_code),
            reference_range: Some(crate::clinical::ReferenceRange {
                low: Some(get_reference_low(test_code)),
                high: Some(get_reference_high(test_code)),
                critical_low: None,
                critical_high: None,
                unit: get_test_unit(test_code),
                age_specific: false,
                gender_specific: false,
            }),
            data_points,
            trend_analysis: crate::clinical::TrendAnalysis {
                direction: trend_direction,
                percent_change: Some(percent_change),
                rate_of_change: Some(stats["std_dev"].as_f64().unwrap_or(0.0)),
                rate_unit: Some("per_month".to_string()),
                statistically_significant,
                clinical_significance,
                prediction: None,
            },
            generated_at: now,
        };

        {
            // Persist via repository (was: in-memory data.lab_trends HashMap)
            let now_dt = chrono::Utc::now();
            let entity = crate::repositories::traits::JsonRecordEntity {
                id: result_id.clone(),
                owner_id: req.patient_id.clone(),
                data: serde_json::to_value(&trend_result).unwrap_or_default(),
                created_at: now_dt,
                updated_at: now_dt,
            };
            let _ = data.repositories.lab_trend_results.create(entity).await;
        }
        results.push(trend_result);
    }

    // Compute aggregate statistics across all results
    let all_values: Vec<f64> = results
        .iter()
        .flat_map(|r| r.data_points.iter().map(|dp| dp.value))
        .collect();
    let aggregate_statistics = compute_lab_statistics(&all_values);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": req.patient_id,
        "trends": results,
        "count": results.len(),
        "aggregate_statistics": aggregate_statistics
    }))
}

/// Get specific trend result
#[get("/api/lab-trends/{result_id}")]
pub async fn get_lab_trend_result(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let result_id = path.into_inner();

    let _current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let trend: crate::clinical::LabTrendResult = match data
        .repositories
        .lab_trend_results
        .get_by_id(&result_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(t) => t,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Trend result not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "trend": trend
    }))
}

// Helper functions for lab trending
fn get_test_name(loinc_code: &str) -> String {
    match loinc_code {
        "2345-7" => "Glucose".to_string(),
        "2160-0" => "Creatinine".to_string(),
        "17861-6" => "Calcium".to_string(),
        "2951-2" => "Sodium".to_string(),
        "2823-3" => "Potassium".to_string(),
        "718-7" => "Hemoglobin".to_string(),
        "4548-4" => "Hemoglobin A1c".to_string(),
        "2093-3" => "Cholesterol".to_string(),
        _ => format!("Test {}", loinc_code),
    }
}

fn get_test_unit(loinc_code: &str) -> String {
    match loinc_code {
        "2345-7" => "mg/dL".to_string(),
        "2160-0" => "mg/dL".to_string(),
        "17861-6" => "mg/dL".to_string(),
        "2951-2" => "mEq/L".to_string(),
        "2823-3" => "mEq/L".to_string(),
        "718-7" => "g/dL".to_string(),
        "4548-4" => "%".to_string(),
        "2093-3" => "mg/dL".to_string(),
        _ => "units".to_string(),
    }
}

fn get_reference_low(loinc_code: &str) -> f64 {
    match loinc_code {
        "2345-7" => 70.0,
        "2160-0" => 0.7,
        "17861-6" => 8.5,
        "2951-2" => 136.0,
        "2823-3" => 3.5,
        "718-7" => 12.0,
        "4548-4" => 4.0,
        "2093-3" => 125.0,
        _ => 0.0,
    }
}

fn get_reference_high(loinc_code: &str) -> f64 {
    match loinc_code {
        "2345-7" => 100.0,
        "2160-0" => 1.3,
        "17861-6" => 10.5,
        "2951-2" => 145.0,
        "2823-3" => 5.0,
        "718-7" => 17.5,
        "4548-4" => 5.6,
        "2093-3" => 200.0,
        _ => 100.0,
    }
}

fn generate_sample_data_points(loinc_code: &str, now: i64) -> Vec<crate::clinical::LabDataPoint> {
    let base_value = match loinc_code {
        "2345-7" => 95.0,
        "2160-0" => 1.0,
        "718-7" => 14.5,
        "4548-4" => 5.4,
        _ => 50.0,
    };

    let day_seconds = 86400;
    let mut points = Vec::new();

    for i in 0..5 {
        let variation = (i as f64 * 0.02) - 0.04;
        points.push(crate::clinical::LabDataPoint {
            result_id: format!("LR-{}", uuid::Uuid::new_v4()),
            value: base_value * (1.0 + variation),
            collected_at: now - (i * 30 * day_seconds),
            status: crate::clinical::LabValueStatus::Normal,
            flag: None,
            performing_lab: "MediChain Central Lab".to_string(),
        });
    }

    points
}
