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
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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

    let now = chrono::Utc::now();
    let symptom_entry = serde_json::json!({
        "entry_id": entry_id,
        "id": entry_id,
        "patient_id": patient_id,
        "symptom": symptom,
        "category": body.get("category").and_then(|c| c.as_str()),
        "severity": severity.min(10), // 0-10 scale
        "duration": body.get("duration").and_then(|d| d.as_str()),
        "notes": notes,
        "triggers": triggers,
        "relievedBy": body.get("relieved_by").or_else(|| body.get("relievedBy")),
        "logged_by": current_user_id,
        "logged_at": now.timestamp(),
        "timestamp": now.to_rfc3339(),
        "date": now.format("%Y-%m-%d").to_string()
    });

    // Horizon HZ-023: the entry used to be built and returned but never
    // stored, so the diary could be written to and never read back.
    if let Err(e) = data
        .repositories
        .symptom_entries
        .create(crate::repositories::traits::JsonRecordEntity {
            id: entry_id.clone(),
            owner_id: patient_id.clone(),
            data: symptom_entry.clone(),
            created_at: now,
            updated_at: now,
        })
        .await
    {
        log::error!("symptom entry persist failed for {}: {}", patient_id, e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Could not save the symptom entry".to_string(),
            code: "SYMPTOM_WRITE_FAILED".to_string(),
        });
    }

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

/// Get a patient's logged symptom diary.
///
/// Horizon HZ-023: this returned invented chronic conditions — Hypertension
/// and Type 2 Diabetes — for whatever patient id was asked for. It now reads
/// the entries actually logged via `/api/symptoms/log`. Chronic conditions are
/// deliberately **not** synthesised here: nothing in this store establishes a
/// diagnosis, and inferring one from self-reported symptoms would recreate the
/// original defect in a subtler form.
#[get("/api/symptoms/{patient_id}")]
pub async fn get_symptom_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    // Horizon HZ-024: a "0xPROV" id prefix is not authorization — see the note
    // in `download_offline_data`. Resolve the role from the user store.
    let is_provider = crate::get_user(&data, &current_user_id)
        .is_some_and(|user| user.role.is_healthcare_provider());
    if !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
        && !is_provider
    {
        return HttpResponse::Forbidden().finish();
    }

    let records = match data
        .repositories
        .symptom_entries
        .get_by_owner(&patient_id)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::error!("symptom history load failed for {}: {}", patient_id, e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Could not load symptom history".to_string(),
                code: "SYMPTOM_READ_FAILED".to_string(),
            });
        }
    };
    let mut entries: Vec<serde_json::Value> = records.into_iter().map(|r| r.data).collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.get("logged_at").and_then(|v| v.as_i64())));

    // `entries` is what the patient app's SymptomTrackerPage reads;
    // `symptom_history` is kept for existing callers of this endpoint.
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "entries": entries,
        "symptom_history": entries,
        "total_entries": entries.len()
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
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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

    // Horizon HZ-023: this used to return the message without storing it, so
    // nothing sent was ever retrievable. Persisted twice — once owned by the
    // recipient (their inbox) and once by the sender (their sent folder) —
    // because the store is keyed by a single owner and both parties must be
    // able to read the thread.
    let now = chrono::Utc::now();
    let inbox_copy = crate::repositories::traits::JsonRecordEntity {
        id: format!("{}:in", message_id),
        owner_id: recipient_id.clone(),
        data: message.clone(),
        created_at: now,
        updated_at: now,
    };
    let sent_copy = crate::repositories::traits::JsonRecordEntity {
        id: format!("{}:out", message_id),
        owner_id: current_user_id.clone(),
        data: message.clone(),
        created_at: now,
        updated_at: now,
    };
    if let Err(e) = data.repositories.messages.create(inbox_copy).await {
        log::error!("message persist (inbox) failed: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Could not send the message".to_string(),
            code: "MESSAGE_WRITE_FAILED".to_string(),
        });
    }
    if let Err(e) = data.repositories.messages.create(sent_copy).await {
        // The recipient already has it, so the message was delivered; only the
        // sender's own copy is missing. Log rather than fail the send.
        log::warn!("message persist (sent folder) failed: {}", e);
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "message": message,
        "info": "Message sent successfully"
    }))
}

/// Get the caller's messages, grouped into conversations by counterpart.
///
/// Horizon HZ-023: this returned a fixed pair of invented messages to every
/// caller. It now reads the real store. Both `messages` (flat, newest first)
/// and `conversations` (grouped, which is what the patient app renders) are
/// returned so neither client has to re-derive the other.
#[get("/api/messages")]
pub async fn get_messages(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let folder = query.get("folder").map(|s| s.as_str()).unwrap_or("inbox");
    let records = match data
        .repositories
        .messages
        .get_by_owner(&current_user_id)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::error!("message load failed for {}: {}", current_user_id, e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Could not load messages".to_string(),
                code: "MESSAGE_READ_FAILED".to_string(),
            });
        }
    };

    // `send_message` stores an `:in` copy for the recipient and an `:out` copy
    // for the sender, so the folder is decided by which copy this is rather
    // than by re-comparing ids (a user messaging themselves would break that).
    let wanted_suffix = if folder == "sent" { ":out" } else { ":in" };
    let mut messages: Vec<serde_json::Value> = records
        .into_iter()
        .filter(|r| r.id.ends_with(wanted_suffix))
        .map(|r| r.data)
        .collect();
    messages.sort_by_key(|m| std::cmp::Reverse(m.get("sent_at").and_then(|v| v.as_i64())));

    // Group into conversations by the counterpart, newest message first.
    let mut order: Vec<String> = Vec::new();
    let mut grouped: std::collections::HashMap<String, Vec<serde_json::Value>> =
        std::collections::HashMap::new();
    for m in &messages {
        let sender = m.get("sender_id").and_then(|v| v.as_str()).unwrap_or("");
        let recipient = m.get("recipient_id").and_then(|v| v.as_str()).unwrap_or("");
        let counterpart = if sender == current_user_id {
            recipient
        } else {
            sender
        }
        .to_string();
        if !grouped.contains_key(&counterpart) {
            order.push(counterpart.clone());
        }
        grouped.entry(counterpart).or_default().push(m.clone());
    }
    let conversations: Vec<serde_json::Value> = order
        .into_iter()
        .map(|counterpart| {
            let thread = grouped.remove(&counterpart).unwrap_or_default();
            let latest = thread.first().cloned().unwrap_or(serde_json::Value::Null);
            let counterpart_name = thread
                .iter()
                .find_map(|m| {
                    let sender = m.get("sender_id").and_then(|v| v.as_str()).unwrap_or("");
                    if sender == counterpart {
                        m.get("sender_name").and_then(|v| v.as_str())
                    } else {
                        None
                    }
                })
                .unwrap_or(&counterpart)
                .to_string();
            let unread = thread
                .iter()
                .filter(|m| {
                    m.get("read").and_then(|v| v.as_bool()) == Some(false)
                        && m.get("sender_id").and_then(|v| v.as_str()) != Some(&current_user_id)
                })
                .count();
            serde_json::json!({
                "id": counterpart,
                "providerId": counterpart,
                "providerName": counterpart_name,
                "providerRole": latest.get("sender_role"),
                "lastMessage": latest.get("content"),
                "lastMessageTime": latest.get("sent_at"),
                "unreadCount": unread,
                "messages": thread,
            })
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "folder": folder,
        "messages": messages,
        "conversations": conversations,
        "count": messages.len()
    }))
}
