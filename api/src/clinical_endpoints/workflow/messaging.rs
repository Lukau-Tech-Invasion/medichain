use super::*;

// ============================================================================
// SYMPTOM TRACKER (for chronic condition management)
// ============================================================================

/// Log a symptom entry for a patient
#[post("/api/symptoms/log")]
pub async fn log_symptom(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Get patient_id - patients log for themselves, providers can log for patients
    let patient_id = if matches!(current_user.role, crate::Role::Patient) {
        current_user_id.clone()
    } else {
        body.get("patient_id")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string())
            .unwrap_or(current_user_id.clone())
    };

    let symptom = body
        .get("symptom")
        .and_then(|s| s.as_str())
        .unwrap_or("Unknown");
    let severity = body.get("severity").and_then(|s| s.as_u64()).unwrap_or(5) as u8;
    let notes = body
        .get("notes")
        .and_then(|n| n.as_str())
        .map(|s| s.to_string());
    let triggers = body
        .get("triggers")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let entry_id = format!(
        "SYM-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    let symptom_entry = serde_json::json!({
        "entry_id": entry_id,
        "patient_id": patient_id,
        "symptom": symptom,
        "severity": severity.min(10), // 0-10 scale
        "notes": notes,
        "triggers": triggers,
        "logged_by": current_user_id,
        "logged_at": chrono::Utc::now().timestamp(),
        "date": chrono::Utc::now().format("%Y-%m-%d").to_string()
    });

    // Log access via repository (persists to memory or postgres backend)
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: "log_symptom".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "entry": symptom_entry,
        "message": "Symptom logged successfully"
    }))
}

/// Get symptom history for a patient
#[get("/api/symptoms/{patient_id}")]
pub async fn get_symptom_history(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    if current_user_id != patient_id && !current_user_id.starts_with("0xPROV") {
        return HttpResponse::Forbidden().finish();
    }

    // Chronic conditions (Mock)
    let chronic_conditions = vec![
        serde_json::json!({"condition": "Hypertension", "diagnosed_at": "2023-01-15"}),
        serde_json::json!({"condition": "Type 2 Diabetes", "diagnosed_at": "2023-05-20"}),
    ];

    // Symptom history (Mock)
    let symptom_entries = vec![
        serde_json::json!({
            "entry_id": "SYM-001",
            "date": "2024-03-20",
            "symptom": "Headache",
            "severity": 4,
            "triggers": ["Stress", "Lack of sleep"],
            "notes": "Mild throbbing at temples"
        }),
        serde_json::json!({
            "entry_id": "SYM-002",
            "date": "2024-03-18",
            "symptom": "Fatigue",
            "severity": 6,
            "triggers": ["Working long hours"],
            "notes": "Improved after rest"
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "chronic_conditions": chronic_conditions,
        "symptom_history": symptom_entries,
        "total_entries": symptom_entries.len()
    }))
}

// ============================================================================
// SECURE MESSAGING SYSTEM
// ============================================================================

/// Send a secure message
#[post("/api/messages/send")]
pub async fn send_message(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    let recipient_id = match body.get("recipient_id").and_then(|r| r.as_str()) {
        Some(r) => r.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "recipient_id is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let subject = body
        .get("subject")
        .and_then(|s| s.as_str())
        .unwrap_or("No Subject");
    let content = match body.get("content").and_then(|c| c.as_str()) {
        Some(c) => c,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "content is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let priority = body
        .get("priority")
        .and_then(|p| p.as_str())
        .unwrap_or("normal");
    let related_patient_id = body.get("related_patient_id").and_then(|p| p.as_str());

    // Patients can only message healthcare providers
    if matches!(current_user.role, crate::Role::Patient) {
        let recipient = get_user(&data, &recipient_id);
        if recipient.is_none() || matches!(recipient.as_ref().unwrap().role, crate::Role::Patient) {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Patients can only message healthcare providers".to_string(),
                code: "INVALID_RECIPIENT".to_string(),
            });
        }
    }

    let message_id = format!(
        "MSG-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    let message = serde_json::json!({
        "message_id": message_id,
        "sender_id": current_user_id,
        "sender_name": current_user.username,
        "sender_role": current_user.role.to_string(),
        "recipient_id": recipient_id,
        "subject": subject,
        "content": content,
        "priority": priority,
        "related_patient_id": related_patient_id,
        "sent_at": chrono::Utc::now().timestamp(),
        "read": false,
        "thread_id": body.get("thread_id").and_then(|t| t.as_str()).unwrap_or(&message_id)
    });

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "message": message,
        "info": "Message sent successfully"
    }))
}

/// Get messages for current user
#[get("/api/messages")]
pub async fn get_messages(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let folder = query.get("folder").map(|s| s.as_str()).unwrap_or("inbox");

    // Mock message store
    let inbox = vec![
        serde_json::json!({
            "message_id": "MSG-001",
            "sender_id": "0xPROV1",
            "sender_name": "Dr. Miller",
            "subject": "Lab Results Review",
            "sent_at": chrono::Utc::now().timestamp() - 3600,
            "read": true
        }),
        serde_json::json!({
            "message_id": "MSG-002",
            "sender_id": "0xPATIENT1",
            "sender_name": "John Doe",
            "subject": "Appointment Question",
            "sent_at": chrono::Utc::now().timestamp() - 7200,
            "read": false
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "folder": folder,
        "messages": inbox,
        "count": inbox.len()
    }))
}
