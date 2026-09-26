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
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Get patient_id - patients log for themselves, providers can log for patients.
    //
    // A patient's entries must be filed under their PATIENT RECORD id, not their
    // wallet: `GET /api/symptoms/{patient_id}` reads by record id, so filing by
    // wallet meant a patient logged a symptom and then could not see it in their
    // own history. `linked_patient_id` is the bridge between the two namespaces;
    // the wallet remains the fallback for accounts that have not claimed a
    // record yet, which is also the arm `caller_owns_patient_record` honours.
    let patient_id = if matches!(current_user.role, crate::Role::Patient) {
        current_user
            .linked_patient_id
            .clone()
            .unwrap_or_else(|| current_user_id.clone())
    } else {
        body.get("patient_id")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string())
            .unwrap_or(current_user_id.clone())
    };

    let Some(symptom) = body
        .get("symptom")
        .and_then(|s| s.as_str())
        .map(str::trim)
        .filter(|symptom| !symptom.is_empty())
    else {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "A symptom is required".to_string(),
            code: "SYMPTOM_REQUIRED".to_string(),
        });
    };
    let Some(severity) = body
        .get("severity")
        .and_then(|s| s.as_u64())
        .filter(|severity| (1..=10).contains(severity))
        .map(|severity| severity as u8)
    else {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "Severity must be between 1 and 10".to_string(),
            code: "INVALID_SYMPTOM_SEVERITY".to_string(),
        });
    };
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
        "severity": severity,
        "duration": body.get("duration").and_then(|d| d.as_str()),
        "notes": notes,
        "triggers": triggers,
        "relievedBy": body.get("relieved_by").or_else(|| body.get("relievedBy")),
        "logged_by": current_user_id,
        "logged_at": now.timestamp(),
        "timestamp": now.to_rfc3339(),
        "date": now.format("%Y-%m-%d").to_string(),
        // Retraction is an atomic active -> retracted state transition. Keeping
        // the original entry preserves clinical provenance and its audit trail.
        "status": "active"
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
        log::error!("symptom entry persist failed: {e}");
        return HttpResponse::InternalServerError().json(ErrorResponse {
            error: "Could not save the symptom entry".to_string(),
            code: "SYMPTOM_WRITE_FAILED".to_string(),
        });
    }

    // Log access via repository (persists to memory or postgres backend)
    if let Err(response) = crate::support::require_durable_audit(
        &data,
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
    .await
    {
        return response;
    }

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
            log::error!("symptom history load failed: {e}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Could not load symptom history".to_string(),
                code: "SYMPTOM_READ_FAILED".to_string(),
            });
        }
    };
    let mut entries: Vec<serde_json::Value> = records
        .into_iter()
        .map(|r| r.data)
        .filter(|entry| entry.get("status").and_then(|v| v.as_str()) != Some("retracted"))
        .collect();
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

/// Retract a symptom diary entry without destroying the clinical record.
///
/// A retraction is deliberately not a hard delete: the original report, who
/// withdrew it, and when remain available to authorised audit workflows. The
/// conditional replacement also prevents two concurrent requests from both
/// treating the same active entry as newly retracted.
#[post("/api/symptoms/{patient_id}/{entry_id}/retract")]
pub async fn retract_symptom(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<(String, String)>,
) -> impl Responder {
    let (patient_id, entry_id) = path.into_inner();
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user.wallet_address,
        Err(response) => return response,
    };
    let Some(current_user) = get_user(&data, &current_user_id) else {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        });
    };

    if !matches!(current_user.role, crate::Role::Patient)
        || !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
        return HttpResponse::Forbidden().finish();
    }

    let Some(record) = (match data.repositories.symptom_entries.get_by_id(&entry_id).await {
        Ok(record) => record,
        Err(error) => {
            log::error!("symptom entry load for retraction failed: {error}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Could not update the symptom entry".to_string(),
                code: "SYMPTOM_RETRACTION_FAILED".to_string(),
            });
        }
    }) else {
        return HttpResponse::NotFound().finish();
    };

    if record.owner_id != patient_id {
        return HttpResponse::NotFound().finish();
    }

    let now = chrono::Utc::now();
    let mut retracted_entry = record.data;
    retracted_entry["status"] = serde_json::Value::String("retracted".to_string());
    retracted_entry["retracted_at"] = serde_json::Value::String(now.to_rfc3339());
    retracted_entry["retracted_by"] = serde_json::Value::String(current_user_id.clone());
    let retracted_record = crate::repositories::traits::JsonRecordEntity {
        id: entry_id.clone(),
        owner_id: patient_id.clone(),
        data: retracted_entry,
        created_at: record.created_at,
        updated_at: now,
    };

    match data
        .repositories
        .symptom_entries
        .replace_if_field_eq(&entry_id, "status", "active", retracted_record)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                error: "This symptom entry has already been changed and cannot be retracted"
                    .to_string(),
                code: "SYMPTOM_RETRACTION_CONFLICT".to_string(),
            });
        }
        Err(error) => {
            log::error!("symptom entry retraction failed: {error}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Could not update the symptom entry".to_string(),
                code: "SYMPTOM_RETRACTION_FAILED".to_string(),
            });
        }
    }

    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id,
            accessor_id: current_user_id,
            accessor_role: current_user.role.to_string(),
            access_type: "retract_symptom".to_string(),
            location: None,
            timestamp: now,
            emergency: false,
        }
        .into(),
    )
    .await
    {
        return response;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "entry_id": entry_id,
        "message": "Symptom entry retracted"
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
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    let recipient_id = match body.get("recipient_id").and_then(|r| r.as_str()) {
        Some(r) if !r.trim().is_empty() => r.trim().to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: "recipient_id is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
        Some(_) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: "recipient_id cannot be empty".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let subject = body
        .get("subject")
        .and_then(|s| s.as_str())
        .unwrap_or("No Subject");
    let content = match body.get("content").and_then(|c| c.as_str()) {
        Some(c) if !c.trim().is_empty() => c.trim(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: "content is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
        Some(_) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: "content cannot be empty".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let priority = body
        .get("priority")
        .and_then(|p| p.as_str())
        .unwrap_or("normal");
    let related_patient_id = body.get("related_patient_id").and_then(|p| p.as_str());

    // Resolve every recipient before persisting anything. Previously only a
    // patient's recipient was checked, so a clinician could receive 201 for a
    // typo or stale wallet id even though no account could ever open the copy.
    let recipient = match get_user(&data, &recipient_id) {
        Some(user) => user,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: "Recipient account was not found".to_string(),
                code: "INVALID_RECIPIENT".to_string(),
            })
        }
    };

    // Patients can only message healthcare providers.
    if matches!(current_user.role, crate::Role::Patient)
        && matches!(recipient.role, crate::Role::Patient)
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Patients can only message healthcare providers".to_string(),
            code: "INVALID_RECIPIENT".to_string(),
        });
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
        "sender_name": current_user.name,
        "sender_role": current_user.role.to_string(),
        "recipient_id": recipient_id,
        "recipient_name": recipient.name,
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
            log::error!("message load failed: {e}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Could not load messages".to_string(),
                code: "MESSAGE_READ_FAILED".to_string(),
            });
        }
    };

    // `send_message` stores an `:in` copy for the recipient and an `:out` copy
    // for the sender, so the folder is decided by which copy this is rather
    // than by re-comparing ids (a user messaging themselves would break that).
    let unread_count = records
        .iter()
        .filter(|record| record.id.ends_with(":in"))
        .filter(|record| record.data.get("read").and_then(|value| value.as_bool()) != Some(true))
        .count();
    let wanted_suffix = if folder == "sent" { ":out" } else { ":in" };
    let mut messages: Vec<serde_json::Value> = records
        .into_iter()
        .filter(|r| folder == "all" || r.id.ends_with(wanted_suffix))
        .map(|r| enrich_message_display_names(&data, r.data))
        .collect();
    messages.sort_by_key(|m| std::cmp::Reverse(m.get("sent_at").and_then(|v| v.as_i64())));
    if let Err(response) = attach_attachment_descriptions(&data, &mut messages).await {
        return response;
    }

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
            let mut thread = grouped.remove(&counterpart).unwrap_or_default();
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
                .map(str::to_string)
                .or_else(|| crate::get_user(&data, &counterpart).map(|user| user.name))
                .unwrap_or_else(|| counterpart.clone());
            let counterpart_user = crate::get_user(&data, &counterpart);
            let unread = thread
                .iter()
                .filter(|m| {
                    m.get("read").and_then(|v| v.as_bool()) == Some(false)
                        && m.get("sender_id").and_then(|v| v.as_str()) != Some(&current_user_id)
                })
                .count();
            // The mailbox itself is newest-first, which is useful for the
            // conversation list. A chat transcript must read oldest-to-newest.
            thread.reverse();
            serde_json::json!({
                "id": counterpart,
                "providerId": counterpart,
                "providerName": counterpart_name,
                "providerRole": counterpart_user.as_ref().map(|user| user.role.to_string()),
                "specialty": counterpart_user.as_ref().and_then(|user| user.specialty.clone()),
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
        "count": messages.len(),
        "unread_count": unread_count
    }))
}

/// Persist that the authenticated recipient opened one inbox message.
///
/// The inbox copy is the authority for the recipient's unread count. The
/// sender's outbox copy is updated as a read receipt when it still exists.
#[post("/api/messages/{message_id}/read")]
pub async fn mark_message_read(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user.wallet_address,
        Err(response) => return response,
    };
    let message_id = path.into_inner();
    let inbox_id = format!("{message_id}:in");
    let mut inbox = match data.repositories.messages.get_by_id(&inbox_id).await {
        Ok(Some(record)) if record.owner_id == current_user_id => record,
        Ok(Some(_)) => {
            return HttpResponse::Forbidden().json(ErrorResponse {
                error: "Only the recipient can mark this message as read".to_string(),
                code: "FORBIDDEN".to_string(),
            })
        }
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Message not found".to_string(),
                code: "MESSAGE_NOT_FOUND".to_string(),
            })
        }
        Err(error) => {
            log::error!("message read lookup failed: {error}");
            return message_read_failure();
        }
    };

    if inbox.data.get("read").and_then(serde_json::Value::as_bool) != Some(true) {
        inbox.data["read"] = serde_json::Value::Bool(true);
        inbox.data["read_at"] = serde_json::json!(chrono::Utc::now().timestamp());
        inbox.updated_at = chrono::Utc::now();
        if let Err(error) = data.repositories.messages.create(inbox.clone()).await {
            log::error!("message read update failed: {error}");
            return message_read_failure();
        }
        sync_sender_read_receipt(&data, &message_id, &inbox.data).await;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message_id": message_id,
        "read": true
    }))
}

fn message_read_failure() -> HttpResponse {
    HttpResponse::InternalServerError().json(ErrorResponse {
        error: "Could not update the message".to_string(),
        code: "MESSAGE_UPDATE_FAILED".to_string(),
    })
}

async fn sync_sender_read_receipt(
    data: &web::Data<AppState>,
    message_id: &str,
    inbox_data: &serde_json::Value,
) {
    let sent_id = format!("{message_id}:out");
    let Ok(Some(mut sent)) = data.repositories.messages.get_by_id(&sent_id).await else {
        return;
    };
    sent.data["read"] = serde_json::Value::Bool(true);
    sent.data["read_at"] = inbox_data["read_at"].clone();
    sent.updated_at = chrono::Utc::now();
    if let Err(error) = data.repositories.messages.create(sent).await {
        log::warn!("message sender read-receipt update failed: {error}");
    }
}

/// Add each message's attachments (WP7.2) as an `attachments` array.
///
/// One read for the whole list. A storage failure is returned as the response
/// rather than a list that silently drops files the sender attached.
async fn attach_attachment_descriptions(
    data: &web::Data<AppState>,
    messages: &mut [serde_json::Value],
) -> Result<(), HttpResponse> {
    let ids: Vec<String> = messages
        .iter()
        .filter_map(|m| {
            m.get("message_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .collect();
    let mut grouped = super::message_attachments::attachments_by_message(data, &ids).await?;
    for message in messages.iter_mut() {
        let id = message
            .get("message_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let files = grouped.remove(&id).unwrap_or_default();
        if let Some(object) = message.as_object_mut() {
            object.insert("attachments".to_string(), serde_json::json!(files));
        }
    }
    Ok(())
}

/// Add only server-authoritative display names to legacy message records.
///
/// Older rows predate `sender_name`; returning their opaque wallet identifiers
/// made an inbox unreadable. Unknown users stay unnamed rather than being
/// represented by a guessed person or a leaked identifier.
fn enrich_message_display_names(
    data: &web::Data<AppState>,
    mut message: serde_json::Value,
) -> serde_json::Value {
    for (id_key, name_key) in [
        ("sender_id", "sender_name"),
        ("recipient_id", "recipient_name"),
    ] {
        let Some(id) = message.get(id_key).and_then(serde_json::Value::as_str) else {
            continue;
        };
        if let Some(user) = crate::get_user(data, id) {
            // Always prefer the current directory display name. Early message
            // rows persisted usernames such as `btpatient`, which made the
            // conversation list look like an implementation detail rather than
            // a chat between people.
            message[name_key] = serde_json::Value::String(user.name);
        }
    }
    message
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, App};

    fn register(state: &AppState, wallet: &str, name: &str, role: crate::Role) {
        state.users.write().unwrap().insert(
            wallet.to_string(),
            crate::User {
                wallet_address: wallet.to_string(),
                username: Some(name.to_string()),
                name: name.to_string(),
                role,
                created_at: chrono::Utc::now(),
                created_by: None,
                linked_patient_id: None,
                email: None,
                phone: None,
                department: None,
                specialty: None,
                license_number: None,
                status: "active".to_string(),
                last_login: None,
            },
        );
    }

    #[actix_web::test]
    async fn opening_message_persists_read_state_and_updates_counts() {
        let state = crate::AppState::new();
        register(&state, "doctor", "Dr Test", crate::Role::Doctor);
        register(&state, "patient", "Patient Test", crate::Role::Patient);
        let data = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(data.clone())
                .service(send_message)
                .service(get_messages)
                .service(mark_message_read),
        )
        .await;

        let sent = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/messages/send")
                .insert_header(("X-User-Id", "doctor"))
                .set_json(serde_json::json!({
                    "recipient_id": "patient",
                    "subject": "Follow-up",
                    "content": "Your result is available"
                }))
                .to_request(),
        )
        .await;
        assert_eq!(sent.status(), actix_web::http::StatusCode::CREATED);
        let sent_body: serde_json::Value = test::read_body_json(sent).await;
        let message_id = sent_body["message"]["message_id"].as_str().unwrap();

        let inbox_response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/messages")
                .insert_header(("X-User-Id", "patient"))
                .to_request(),
        )
        .await;
        assert_eq!(inbox_response.status(), actix_web::http::StatusCode::OK);
        let inbox: serde_json::Value = test::read_body_json(inbox_response).await;
        assert_eq!(inbox["unread_count"], 1);
        assert_eq!(inbox["messages"][0]["recipient_name"], "Patient Test");

        let opened = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/messages/{message_id}/read"))
                .insert_header(("X-User-Id", "patient"))
                .to_request(),
        )
        .await;
        assert_eq!(opened.status(), actix_web::http::StatusCode::OK);

        let inbox_response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/messages")
                .insert_header(("X-User-Id", "patient"))
                .to_request(),
        )
        .await;
        assert_eq!(inbox_response.status(), actix_web::http::StatusCode::OK);
        let inbox: serde_json::Value = test::read_body_json(inbox_response).await;
        assert_eq!(inbox["unread_count"], 0);
        assert_eq!(inbox["messages"][0]["read"], true);
        let sender_copy = data
            .repositories
            .messages
            .get_by_id(&format!("{message_id}:out"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(sender_copy.data["read"], true);
    }

    #[actix_web::test]
    async fn two_way_messages_are_returned_as_one_chronological_conversation() {
        let state = crate::AppState::new();
        register(&state, "doctor", "Dr Test", crate::Role::Doctor);
        register(&state, "patient", "Patient Test", crate::Role::Patient);
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .service(send_message)
                .service(get_messages),
        )
        .await;

        let first = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/messages/send")
                .insert_header(("X-User-Id", "doctor"))
                .set_json(serde_json::json!({
                    "recipient_id": "patient",
                    "subject": "Follow-up",
                    "content": "First message"
                }))
                .to_request(),
        )
        .await;
        let first_body: serde_json::Value = test::read_body_json(first).await;
        let thread_id = first_body["message"]["thread_id"].as_str().unwrap();

        let reply = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/messages/send")
                .insert_header(("X-User-Id", "patient"))
                .set_json(serde_json::json!({
                    "recipient_id": "doctor",
                    "subject": "Re: Follow-up",
                    "content": "Second message",
                    "thread_id": thread_id
                }))
                .to_request(),
        )
        .await;
        assert_eq!(reply.status(), actix_web::http::StatusCode::CREATED);

        let response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/messages?folder=all")
                .insert_header(("X-User-Id", "doctor"))
                .to_request(),
        )
        .await;
        let body: serde_json::Value = test::read_body_json(response).await;
        assert_eq!(body["conversations"].as_array().unwrap().len(), 1);
        let messages = body["conversations"][0]["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["content"], "First message");
        assert_eq!(messages[1]["content"], "Second message");
        assert_eq!(messages[0]["sender_name"], "Dr Test");
        assert_eq!(messages[1]["sender_name"], "Patient Test");
        assert_eq!(body["conversations"][0]["unreadCount"], 1);
    }

    #[actix_web::test]
    async fn unknown_recipient_is_rejected_before_persistence() {
        let state = crate::AppState::new();
        register(&state, "doctor", "Dr Test", crate::Role::Doctor);
        let data = web::Data::new(state);
        let app = test::init_service(App::new().app_data(data.clone()).service(send_message)).await;
        let response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/messages/send")
                .insert_header(("X-User-Id", "doctor"))
                .set_json(serde_json::json!({
                    "recipient_id": "missing-user",
                    "content": "This must not be accepted"
                }))
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), actix_web::http::StatusCode::BAD_REQUEST);
        assert!(data
            .repositories
            .messages
            .list_all()
            .await
            .unwrap()
            .is_empty());
    }
}
