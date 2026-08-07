//! `clinical_endpoints::insurance_pharmacy::medication_reminders` — Phase 20 (medication reminders).
//!
//! Split out of the former single-file `insurance_pharmacy.rs` (itself split from the
//! original 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `insurance_pharmacy/mod.rs`
//! so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// PHASE 20: MEDICATION REMINDERS
// ============================================================================

/// Create medication reminder request
#[derive(Debug, Deserialize)]
pub struct CreateMedicationReminderRequest {
    pub patient_id: String,
    pub medication_name: String,
    pub dosage: String,
    pub frequency: String,
    pub reminder_times: Vec<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub instructions: Option<String>,
    pub push_notification: Option<bool>,
    pub sms: Option<bool>,
    pub email: Option<bool>,
}

/// Create a medication reminder
#[post("/api/reminders/medication")]
pub async fn create_medication_reminder(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateMedicationReminderRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    // Patient can create for self, provider can create for any patient
    let is_own_reminder = current_user_id == req.patient_id;

    if !is_own_reminder && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only patients can create reminders for themselves or providers for patients"
                .to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let frequency = match req.frequency.as_str() {
        "once" => crate::clinical::ReminderFrequency::Once,
        "daily" => crate::clinical::ReminderFrequency::Daily,
        "twice_daily" => crate::clinical::ReminderFrequency::TwiceDaily,
        "three_times_daily" => crate::clinical::ReminderFrequency::ThreeTimesDaily,
        "weekly" => crate::clinical::ReminderFrequency::Weekly,
        "as_needed" => crate::clinical::ReminderFrequency::AsNeeded,
        _ => crate::clinical::ReminderFrequency::Daily,
    };

    let reminder = crate::clinical::MedicationReminder {
        reminder_id: format!("REM-{}", uuid::Uuid::new_v4()),
        patient_id: req.patient_id.clone(),
        medication_name: req.medication_name.clone(),
        dosage: req.dosage.clone(),
        frequency,
        reminder_times: req.reminder_times.clone(),
        start_date: req.start_date.clone(),
        end_date: req.end_date.clone(),
        instructions: req.instructions.clone(),
        active: true,
        created_by: current_user_id,
        created_at: chrono::Utc::now().timestamp(),
        notification_prefs: crate::clinical::NotificationPreferences {
            push_notification: req.push_notification.unwrap_or(true),
            sms: req.sms.unwrap_or(false),
            email: req.email.unwrap_or(false),
            in_app: true,
            reminder_before_minutes: 15,
        },
    };

    let reminder_id = reminder.reminder_id.clone();
    let entity: crate::repositories::traits::MedicationReminderEntity = reminder.into();
    if let Err(e) = data.repositories.medication_reminders.create(entity).await {
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: format!("Failed to create reminder: {}", e),
            code: "DB_ERROR".to_string(),
        });
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "reminder_id": reminder_id,
        "message": "Medication reminder created successfully"
    }))
}

/// Get medication reminders for a patient (Phase 20)
#[get("/api/reminders/medication/{patient_id}")]
pub async fn get_patient_reminders(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
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

    // Check access
    let is_own = crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id);
    if !is_own && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_reminders: Vec<crate::clinical::MedicationReminder> = match data
        .repositories
        .medication_reminders
        .get_active_by_patient(&patient_id)
        .await
    {
        Ok(items) => items
            .into_iter()
            .map(crate::clinical::MedicationReminder::from)
            .collect(),
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: format!("Failed to fetch reminders: {}", e),
                code: "DB_ERROR".to_string(),
            })
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "reminders": patient_reminders,
        "count": patient_reminders.len()
    }))
}

/// Log medication adherence
#[derive(Debug, Deserialize)]
pub struct LogAdherenceRequest {
    pub reminder_id: String,
    pub action: String,
    pub notes: Option<String>,
}

#[post("/api/reminders/adherence")]
pub async fn log_medication_adherence(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<LogAdherenceRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let reminder: crate::clinical::MedicationReminder = match data
        .repositories
        .medication_reminders
        .get_by_id(&req.reminder_id)
        .await
    {
        Ok(e) => e.into(),
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Reminder not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only the patient can log their own adherence
    if current_user_id != reminder.patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only patient can log their own adherence".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Normalize the action to a canonical string for the entity
    let action_taken = match req.action.as_str() {
        "taken" => "taken",
        "skipped" => "skipped",
        "snoozed" => "snoozed",
        "missed" => "missed",
        "taken_late" => "taken_late",
        _ => "taken",
    };

    let now = chrono::Utc::now();
    let taken = matches!(req.action.as_str(), "taken" | "taken_late");
    let log_id = format!("ADH-{}", uuid::Uuid::new_v4());

    // Persist via repository (was: in-memory data.adherence_logs HashMap, lost on restart)
    let entity = crate::repositories::traits::AdherenceLogEntity {
        id: log_id.clone(),
        patient_id: reminder.patient_id.clone(),
        reminder_id: Some(req.reminder_id.clone()),
        prescription_id: None,
        medication_name: reminder.medication_name.clone(),
        scheduled_time: now,
        action_taken: action_taken.to_string(),
        actual_time: if taken { Some(now) } else { None },
        reported_by: Some(current_user_id.clone()),
        skip_reason: None,
        side_effects_reported: None,
        notes: req.notes.clone(),
        device_id: None,
        location: None,
        created_at: now,
    };

    match data.repositories.adherence_logs.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "log_id": log_id,
            "message": "Adherence logged successfully"
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Delete a medication reminder
#[delete("/api/reminders/medication/{reminder_id}")]
pub async fn delete_medication_reminder(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let reminder_id = path.into_inner();

    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let reminder: crate::clinical::MedicationReminder = match data
        .repositories
        .medication_reminders
        .get_by_id(&reminder_id)
        .await
    {
        Ok(e) => e.into(),
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Reminder not found".to_string(),
                code: "NOT_FOUND".to_string(),
            });
        }
    };

    if reminder.patient_id != current_user_id && reminder.created_by != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    if let Err(e) = data
        .repositories
        .medication_reminders
        .deactivate(&reminder_id)
        .await
    {
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: format!("Failed to deactivate: {}", e),
            code: "DB_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Reminder deactivated"
    }))
}

/// Check and deliver due medication reminders.
/// Called by a background task to simulate notification delivery.
/// Reminders are matched by comparing their HH:MM time strings against the current UTC time.
pub async fn check_and_send_medication_reminders(data: &crate::AppState) {
    let now_utc = chrono::Utc::now();
    let current_hhmm = now_utc.format("%H:%M").to_string();

    let due_reminders: Vec<crate::clinical::MedicationReminder> = match data
        .repositories
        .medication_reminders
        .list_all_active()
        .await
    {
        Ok(items) => items
            .into_iter()
            .map(crate::clinical::MedicationReminder::from)
            .filter(|r| {
                r.active
                    && r.reminder_times
                        .iter()
                        .any(|t| t.as_str() == current_hhmm.as_str())
            })
            .collect(),
        Err(_) => return,
    };

    for reminder in &due_reminders {
        // Log delivery attempt (in production: call SMS/push API here)
        log::info!(
            "REMINDER_DUE: patient={} medication={} time={} push={} sms={} email={}",
            reminder.patient_id,
            reminder.medication_name,
            current_hhmm,
            reminder.notification_prefs.push_notification,
            reminder.notification_prefs.sms,
            reminder.notification_prefs.email,
        );

        // Push real-time SSE notification
        crate::websocket::push_reminder(
            &data.ws_manager,
            &reminder.patient_id,
            &reminder.medication_name,
        );

        // FCM Push notification
        if reminder.notification_prefs.push_notification {
            let repos = data.repositories.clone();
            let patient_id = reminder.patient_id.clone();
            let med_name = reminder.medication_name.clone();
            tokio::spawn(async move {
                let _ = crate::notifications::send_push_to_user(
                    &repos,
                    crate::notifications::PushNotification {
                        user_id: patient_id,
                        title: "Medication Reminder".to_string(),
                        body: format!("It's time to take your {}.", med_name),
                        data: Some(
                            [("type".to_string(), "medication_reminder".to_string())].into(),
                        ),
                    },
                )
                .await;
            });
        }

        // Africa's Talking SMS integration (when SMS_ENABLED=true)
        if reminder.notification_prefs.sms {
            // Get patient phone from repository
            let patient_phone = match data
                .repositories
                .patients
                .get_by_id(&reminder.patient_id)
                .await
            {
                Ok(p) => {
                    if p.phone_encrypted.is_some() {
                        // Phone is encrypted in Phase 2, but for SMS we'd need to decrypt it.
                        // For demo, we use a placeholder or check if a plain phone field exists.
                        Some("Redacted".to_string())
                    } else {
                        None
                    }
                }
                Err(_) => None,
            };

            if let Some(phone) = patient_phone {
                if phone != "Redacted" {
                    let body = crate::notifications::SmsTemplate::MedicationReminder {
                        medication: reminder.medication_name.clone(),
                    }
                    .render();
                    let repositories = data.repositories.clone();
                    tokio::spawn(async move {
                        // This branch is gated on the reminder's SMS opt-in, so
                        // opted_in = true; retry + global kill-switch handled inside.
                        let status = crate::notifications::send_sms_with_retry(
                            &repositories,
                            crate::notifications::SmsMessage { to: phone, body },
                            true,
                        )
                        .await;
                        log::info!("[sms] medication reminder delivery status: {:?}", status);
                    });
                }
            }
        }
    }
}
