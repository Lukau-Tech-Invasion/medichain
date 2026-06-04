//! `clinical_endpoints::insurance_pharmacy` — handlers split out of the original 21K-line monolith (Phase 10.1).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// Insurance Verification API
// ============================================================================

/// Verify insurance coverage
#[post("/api/insurance/verify")]
pub async fn verify_insurance(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let patient_id = match body.get("patient_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "patient_id is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            });
        }
    };

    // Get patient from repository
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => Some(p),
        Err(_) => None,
    };

    match patient {
        Some(patient) => {
            // Get insurance from repository
            let insurance_list = match data
                .repositories
                .insurance_records
                .get_by_patient(&patient_id)
                .await
            {
                Ok(res) => res,
                Err(_) => Vec::new(),
            };

            match insurance_list.first() {
                Some(insurance) => {
                    // Simulate verification (in production: call external API)
                    let coverage_active = insurance.is_active;

                    HttpResponse::Ok().json(serde_json::json!({
                        "success": true,
                        "patient_id": patient_id,
                        "verification": {
                            "verified": true,
                            "verified_at": chrono::Utc::now().to_rfc3339(),
                            "coverage_active": coverage_active,
                            "provider": insurance.payer_name.clone(),
                            "policy_number": insurance.policy_number.clone(),
                            "group_number": insurance.group_number.clone(),
                            "coverage_type": insurance.plan_type.clone(),
                            "valid_from": insurance.effective_date.to_string(),
                            "valid_to": insurance.termination_date.map(|d| d.to_string()),
                            "benefits": {
                                "emergency_services": true,
                                "inpatient": true,
                                "outpatient": true,
                                "laboratory": true,
                                "radiology": true,
                                "pharmacy": true,
                                "mental_health": true
                            },
                            "copay": {
                                "emergency": "R500",
                                "specialist": "R300",
                                "primary_care": "R150",
                                "pharmacy": "20%"
                            },
                            "deductible": {
                                "annual": "R5000",
                                "met": "R2500",
                                "remaining": "R2500"
                            }
                        }
                    }))
                }
                None => HttpResponse::Ok().json(serde_json::json!({
                    "success": true,
                    "patient_id": patient_id,
                    "verification": {
                        "verified": true,
                        "verified_at": chrono::Utc::now().to_rfc3339(),
                        "coverage_active": false,
                        "message": "No insurance on file. Patient is self-pay."
                    }
                })),
            }
        }
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Patient not found".to_string(),
            code: "PATIENT_NOT_FOUND".to_string(),
        }),
    }
}

/// Get insurance eligibility for a service
#[post("/api/insurance/eligibility")]
pub async fn check_eligibility(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let patient_id = body
        .get("patient_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let service_code = body
        .get("service_code")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Get patient from repository
    let patient = match data.repositories.patients.get_by_id(patient_id).await {
        Ok(p) => Some(p),
        Err(_) => None,
    };

    match patient {
        Some(patient) => {
            // Get insurance from repository
            let pagination = Pagination::new(0, 1);
            let insurance_list = match data
                .repositories
                .insurance_records
                .get_by_patient(patient_id)
                .await
            {
                Ok(res) => res,
                Err(_) => Vec::new(),
            };
            let has_insurance = !insurance_list.is_empty();

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "patient_id": patient_id,
                "service_code": service_code,
                "eligibility": {
                    "eligible": has_insurance,
                    "checked_at": chrono::Utc::now().to_rfc3339(),
                    "coverage_details": if has_insurance {
                        serde_json::json!({
                            "covered": true,
                            "requires_preauth": service_code.starts_with("99"),
                            "copay_applies": true,
                            "deductible_applies": true
                        })
                    } else {
                        serde_json::json!({
                            "covered": false,
                            "reason": "No active insurance coverage"
                        })
                    }
                }
            }))
        }
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Patient not found".to_string(),
            code: "PATIENT_NOT_FOUND".to_string(),
        }),
    }
}

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

    // Check access
    let is_own = current_user_id == patient_id;
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
                    tokio::spawn(async move {
                        // This branch is gated on the reminder's SMS opt-in, so
                        // opted_in = true; retry + global kill-switch handled inside.
                        let status = crate::notifications::send_sms_with_retry(
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

// ============================================================================
// PHASE 21: DRUG INTERACTION CHECKING
// ============================================================================

/// Get drug database for lookup/search
#[get("/api/drugs")]
pub async fn get_drug_database(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    // Validate user is authenticated
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

    // Drug reference database (clinical formulary)
    let drugs = vec![
        crate::clinical::DrugReference {
            drug_id: "DRUG-001".to_string(),
            name: "Warfarin".to_string(),
            generic_name: "warfarin".to_string(),
            brand_names: vec!["Coumadin".to_string(), "Jantoven".to_string()],
            drug_class: "Anticoagulant".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "1mg".to_string(),
                "2mg".to_string(),
                "2.5mg".to_string(),
                "3mg".to_string(),
                "4mg".to_string(),
                "5mg".to_string(),
                "6mg".to_string(),
                "7.5mg".to_string(),
                "10mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-002".to_string(),
            name: "Aspirin".to_string(),
            generic_name: "aspirin".to_string(),
            brand_names: vec![
                "Bayer".to_string(),
                "Ecotrin".to_string(),
                "Bufferin".to_string(),
            ],
            drug_class: "NSAID/Antiplatelet".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec!["81mg".to_string(), "325mg".to_string(), "500mg".to_string()],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-003".to_string(),
            name: "Lisinopril".to_string(),
            generic_name: "lisinopril".to_string(),
            brand_names: vec!["Prinivil".to_string(), "Zestril".to_string()],
            drug_class: "ACE Inhibitor".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "2.5mg".to_string(),
                "5mg".to_string(),
                "10mg".to_string(),
                "20mg".to_string(),
                "40mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-004".to_string(),
            name: "Metformin".to_string(),
            generic_name: "metformin".to_string(),
            brand_names: vec![
                "Glucophage".to_string(),
                "Fortamet".to_string(),
                "Glumetza".to_string(),
            ],
            drug_class: "Biguanide".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "500mg".to_string(),
                "850mg".to_string(),
                "1000mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-005".to_string(),
            name: "Amoxicillin".to_string(),
            generic_name: "amoxicillin".to_string(),
            brand_names: vec!["Amoxil".to_string(), "Moxatag".to_string()],
            drug_class: "Penicillin Antibiotic".to_string(),
            route: "oral".to_string(),
            form: "capsule".to_string(),
            common_doses: vec![
                "250mg".to_string(),
                "500mg".to_string(),
                "875mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-006".to_string(),
            name: "Simvastatin".to_string(),
            generic_name: "simvastatin".to_string(),
            brand_names: vec!["Zocor".to_string()],
            drug_class: "Statin".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "5mg".to_string(),
                "10mg".to_string(),
                "20mg".to_string(),
                "40mg".to_string(),
                "80mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-007".to_string(),
            name: "Omeprazole".to_string(),
            generic_name: "omeprazole".to_string(),
            brand_names: vec!["Prilosec".to_string(), "Losec".to_string()],
            drug_class: "Proton Pump Inhibitor".to_string(),
            route: "oral".to_string(),
            form: "capsule".to_string(),
            common_doses: vec!["10mg".to_string(), "20mg".to_string(), "40mg".to_string()],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-008".to_string(),
            name: "Levothyroxine".to_string(),
            generic_name: "levothyroxine".to_string(),
            brand_names: vec![
                "Synthroid".to_string(),
                "Levoxyl".to_string(),
                "Unithroid".to_string(),
            ],
            drug_class: "Thyroid Hormone".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "25mcg".to_string(),
                "50mcg".to_string(),
                "75mcg".to_string(),
                "88mcg".to_string(),
                "100mcg".to_string(),
                "112mcg".to_string(),
                "125mcg".to_string(),
                "137mcg".to_string(),
                "150mcg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-009".to_string(),
            name: "Amlodipine".to_string(),
            generic_name: "amlodipine".to_string(),
            brand_names: vec!["Norvasc".to_string()],
            drug_class: "Calcium Channel Blocker".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec!["2.5mg".to_string(), "5mg".to_string(), "10mg".to_string()],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-010".to_string(),
            name: "Fluoxetine".to_string(),
            generic_name: "fluoxetine".to_string(),
            brand_names: vec!["Prozac".to_string(), "Sarafem".to_string()],
            drug_class: "SSRI Antidepressant".to_string(),
            route: "oral".to_string(),
            form: "capsule".to_string(),
            common_doses: vec![
                "10mg".to_string(),
                "20mg".to_string(),
                "40mg".to_string(),
                "60mg".to_string(),
            ],
        },
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "drugs": drugs,
        "count": drugs.len()
    }))
}

/// Get interaction database for reference/lookup
#[get("/api/interactions")]
pub async fn get_interaction_database(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    // Validate user is authenticated
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

    // Reference interaction database
    let interactions = vec![
        serde_json::json!({
            "interactionId": "INT-001",
            "type": "drug-drug",
            "severity": "major",
            "drug1": "Warfarin",
            "drug2": "Aspirin",
            "title": "Warfarin + Aspirin: Increased Bleeding Risk",
            "description": "Concurrent use of warfarin with aspirin significantly increases the risk of bleeding complications.",
            "mechanism": "Additive anticoagulant and antiplatelet effects. Both drugs inhibit different pathways in hemostasis, leading to synergistic bleeding risk.",
            "clinicalEffects": ["Increased risk of major bleeding (GI, intracranial)", "Prolonged bleeding time", "Elevated INR", "Easy bruising", "Hematuria or melena"],
            "management": ["Avoid combination when possible", "If combination necessary, use lowest effective aspirin dose (81mg)", "Monitor INR more frequently (weekly initially)", "Watch for signs of bleeding", "Consider PPI for GI protection", "Educate patient on bleeding signs"],
            "monitoring": ["INR every 1-2 weeks until stable", "CBC for anemia", "Stool guaiac for occult blood", "Monitor for bruising, bleeding gums"],
            "alternatives": ["Use aspirin alone for cardiovascular protection if anticoagulation can be stopped", "Consider alternative anticoagulant if aspirin essential"],
            "evidenceLevel": "A",
            "references": ["Holbrook AM, et al. Arch Intern Med. 2005;165(10):1095-1106.", "Johnson SG, et al. Am Heart J. 2008;155(5):918-924."],
            "onset": "Immediate (within days)",
            "documentation": "Well-established",
            "riskFactors": ["Age >65", "History of bleeding", "Renal impairment", "Peptic ulcer disease"]
        }),
        serde_json::json!({
            "interactionId": "INT-002",
            "type": "drug-drug",
            "severity": "moderate",
            "drug1": "Lisinopril",
            "drug2": "Aspirin",
            "title": "ACE Inhibitors + NSAIDs: Reduced Antihypertensive Effect",
            "description": "NSAIDs may reduce the antihypertensive effect of ACE inhibitors and increase risk of renal impairment.",
            "mechanism": "NSAIDs inhibit prostaglandin synthesis, which is important for ACE inhibitor-mediated vasodilation and natriuresis.",
            "clinicalEffects": ["Reduced blood pressure control", "Increased risk of acute kidney injury", "Hyperkalemia", "Sodium and fluid retention"],
            "management": ["Monitor blood pressure closely", "Check renal function and potassium", "Use lowest effective NSAID dose for shortest duration", "Consider alternative analgesic (acetaminophen)"],
            "monitoring": ["Blood pressure weekly during NSAID therapy", "Serum creatinine and potassium baseline and after 1 week", "Volume status"],
            "alternatives": ["Acetaminophen for pain", "Topical NSAIDs", "COX-2 selective inhibitor (caution still needed)"],
            "evidenceLevel": "B",
            "references": ["Fournier JP, et al. BMJ. 2012;344:e4128.", "Lapi F, et al. Drug Saf. 2013;36(10):899-918."],
            "onset": "Days to weeks",
            "documentation": "Established",
            "riskFactors": ["Pre-existing renal disease", "Volume depletion", "Age >65", "Diabetes"]
        }),
        serde_json::json!({
            "interactionId": "INT-003",
            "type": "drug-drug",
            "severity": "major",
            "drug1": "Simvastatin",
            "drug2": "Fluoxetine",
            "title": "Simvastatin + Fluoxetine: Increased Statin Levels",
            "description": "Fluoxetine inhibits CYP3A4, increasing simvastatin levels and risk of myopathy/rhabdomyolysis.",
            "mechanism": "Fluoxetine is a moderate CYP3A4 inhibitor. Simvastatin is extensively metabolized by CYP3A4.",
            "clinicalEffects": ["Increased simvastatin plasma concentrations", "Myalgia and muscle weakness", "Elevated creatine kinase (CK)", "Rhabdomyolysis (rare but serious)", "Acute kidney injury from myoglobinuria"],
            "management": ["Reduce simvastatin dose (max 20mg daily with moderate CYP3A4 inhibitor)", "Monitor for muscle symptoms", "Check CK if symptoms develop", "Consider alternative statin not metabolized by CYP3A4 (rosuvastatin, pravastatin)"],
            "monitoring": ["Baseline CK", "Patient education on myopathy symptoms", "CK if muscle pain/weakness", "Renal function"],
            "alternatives": ["Switch to rosuvastatin or pravastatin", "Switch to alternative SSRI with less CYP3A4 inhibition (sertraline)"],
            "evidenceLevel": "B",
            "references": ["FDA Drug Safety Communication on Simvastatin", "Law M, Rudnicka AR. Am J Cardiovasc Drugs. 2006;6(6):343-348."],
            "onset": "Days to weeks",
            "documentation": "Established",
            "riskFactors": ["High simvastatin dose", "Renal impairment", "Hypothyroidism", "Age >65", "Female gender"]
        }),
        serde_json::json!({
            "interactionId": "INT-004",
            "type": "drug-drug",
            "severity": "moderate",
            "drug1": "Metformin",
            "drug2": "Lisinopril",
            "title": "Metformin + ACE Inhibitors: Hypoglycemia Risk",
            "description": "ACE inhibitors may enhance the hypoglycemic effect of metformin.",
            "mechanism": "ACE inhibitors may improve insulin sensitivity and glucose uptake.",
            "clinicalEffects": ["Increased risk of hypoglycemia", "Enhanced glucose-lowering effect", "Symptoms: tremor, sweating, confusion, tachycardia"],
            "management": ["Monitor blood glucose more frequently when initiating ACE inhibitor", "Educate patient on hypoglycemia symptoms", "May need to adjust metformin or other antidiabetic dose", "Generally beneficial interaction for diabetic patients"],
            "monitoring": ["Blood glucose daily initially", "HbA1c at 3 months", "Hypoglycemia symptoms"],
            "alternatives": ["Generally continue both medications", "Adjust doses as needed based on glucose control"],
            "evidenceLevel": "C",
            "references": ["Paolisso G, et al. J Clin Invest. 1992;89(4):1295-1300."],
            "onset": "Days to weeks",
            "documentation": "Probable",
            "riskFactors": ["Elderly", "Renal impairment", "Tight glycemic control", "Irregular meals"]
        }),
        serde_json::json!({
            "interactionId": "INT-005",
            "type": "drug-drug",
            "severity": "moderate",
            "drug1": "Levothyroxine",
            "drug2": "Omeprazole",
            "title": "Levothyroxine + PPIs: Reduced Levothyroxine Absorption",
            "description": "PPIs increase gastric pH, which may reduce levothyroxine absorption.",
            "mechanism": "Levothyroxine absorption is pH-dependent. Increased gastric pH from PPI reduces dissolution and absorption.",
            "clinicalEffects": ["Reduced levothyroxine efficacy", "Elevated TSH", "Hypothyroid symptoms may recur"],
            "management": ["Separate administration by at least 4 hours", "Take levothyroxine first thing in the morning on empty stomach", "Take PPI later in the day", "Monitor TSH 6-8 weeks after PPI initiation", "May need to increase levothyroxine dose"],
            "monitoring": ["TSH and free T4 at 6-8 weeks", "Clinical symptoms of hypothyroidism"],
            "alternatives": ["H2 antagonist instead of PPI if appropriate", "Antacids (though also affect absorption)"],
            "evidenceLevel": "C",
            "references": ["Centanni M, et al. N Engl J Med. 2006;354(17):1787-1795."],
            "onset": "Weeks",
            "documentation": "Probable",
            "riskFactors": ["Marginal thyroid function", "High PPI dose", "Long-term PPI use"]
        }),
        serde_json::json!({
            "interactionId": "INT-006",
            "type": "drug-allergy",
            "severity": "contraindicated",
            "drug1": "Amoxicillin",
            "allergen": "Penicillin",
            "title": "Amoxicillin in Penicillin-Allergic Patients",
            "description": "Absolute contraindication to use amoxicillin (a penicillin) in patients with documented penicillin allergy.",
            "mechanism": "Cross-reactivity due to shared beta-lactam ring structure.",
            "clinicalEffects": ["Immediate hypersensitivity reaction", "Urticaria, angioedema", "Bronchospasm", "Anaphylaxis (life-threatening)", "Stevens-Johnson syndrome (rare)"],
            "management": ["DO NOT ADMINISTER", "Use alternative antibiotic class", "If beta-lactam essential, consider allergy testing and possible desensitization", "Update allergy list in medical record"],
            "monitoring": ["N/A - do not use"],
            "alternatives": ["Macrolides (azithromycin, clarithromycin)", "Fluoroquinolones (levofloxacin, moxifloxacin)", "Cephalosporins (use with caution, 1-10% cross-reactivity)"],
            "evidenceLevel": "A",
            "references": ["Joint Task Force on Practice Parameters. J Allergy Clin Immunol. 2010;125(3 Suppl 2):S126-137."],
            "onset": "Immediate to hours",
            "documentation": "Well-established",
            "riskFactors": ["History of severe reaction", "Atopy", "Previous penicillin reaction"]
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "interactions": interactions,
        "count": interactions.len()
    }))
}

/// Check drug interactions request
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct CheckDrugInteractionsRequest {
    pub patient_id: String,
    pub medications: Vec<String>,
    pub include_allergies: Option<bool>,
    pub include_conditions: Option<bool>,
}

/// Check for drug-drug and drug-allergy interactions
#[post("/api/interactions/check")]
pub async fn check_drug_interactions(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CheckDrugInteractionsRequest>,
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

    // Only healthcare providers can check interactions
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can check drug interactions".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Auto-screen the requested medications against the curated interaction table.
    let interactions = evaluate_drug_interactions(&req.medications);
    check_interactions_response(&data, &req, &current_user_id, interactions).await
}

/// Curated drug-drug interaction table and pairwise screen — the single source of
/// truth shared by the `/api/interactions/check` endpoint and `create_e_prescription`.
/// Each medication pair is matched (case-insensitive substring) against the table.
pub fn evaluate_drug_interactions(medications: &[String]) -> Vec<crate::clinical::DrugInteraction> {
    // Comprehensive clinically significant drug interaction database
    let known_interactions: Vec<(&str, &str, &str, &str)> = vec![
        // ── CONTRAINDICATED ──────────────────────────────────────────────────
        // SSRIs + MAOIs → serotonin syndrome
        ("ssri", "maoi", "contraindicated", "Serotonin syndrome: potentially fatal combination; concurrent use is absolutely contraindicated"),
        ("fluoxetine", "maoi", "contraindicated", "Serotonin syndrome: allow ≥14 days washout between fluoxetine and any MAOI"),
        ("sertraline", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("paroxetine", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("citalopram", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("escitalopram", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("venlafaxine", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("duloxetine", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("linezolid", "ssri", "contraindicated", "Serotonin syndrome: linezolid has weak MAOI activity"),
        ("linezolid", "maoi", "contraindicated", "Severe serotonin syndrome risk with dual MAO inhibition"),
        // Opioid + benzodiazepine → respiratory depression
        ("opioid", "benzodiazepine", "contraindicated", "Profound respiratory depression and death; co-prescribing carries an FDA black-box warning"),
        ("morphine", "benzodiazepine", "contraindicated", "Respiratory depression and death; avoid concurrent use"),
        ("oxycodone", "benzodiazepine", "contraindicated", "Respiratory depression and death; avoid concurrent use"),
        ("hydrocodone", "benzodiazepine", "contraindicated", "Respiratory depression and death; avoid concurrent use"),
        ("fentanyl", "benzodiazepine", "contraindicated", "Respiratory depression and death; avoid concurrent use"),
        ("methadone", "benzodiazepine", "contraindicated", "Respiratory depression and QT prolongation; avoid concurrent use"),
        ("buprenorphine", "benzodiazepine", "contraindicated", "Respiratory depression risk is lower but still significant; avoid when possible"),
        // QT-prolonging combinations
        ("haloperidol", "methadone", "contraindicated", "Additive QT prolongation; risk of torsades de pointes and sudden death"),
        ("haloperidol", "sotalol", "contraindicated", "Additive QT prolongation; torsades de pointes risk"),
        ("methadone", "sotalol", "contraindicated", "Additive QT prolongation; torsades de pointes risk"),
        ("methadone", "amiodarone", "contraindicated", "Additive QT prolongation; torsades de pointes risk"),
        ("azithromycin", "haloperidol", "contraindicated", "Additive QT prolongation; high torsades risk"),
        ("moxifloxacin", "haloperidol", "contraindicated", "Additive QT prolongation; avoid concurrent use"),
        ("moxifloxacin", "amiodarone", "contraindicated", "Additive QT prolongation; high torsades risk"),
        ("cisapride", "macrolide", "contraindicated", "Fatal QT prolongation; cisapride + macrolide combination is absolutely contraindicated"),
        ("cisapride", "azithromycin", "contraindicated", "Fatal QT prolongation; absolutely contraindicated"),
        ("pimozide", "macrolide", "contraindicated", "Additive QT prolongation; absolutely contraindicated"),
        // Alcohol + metronidazole → disulfiram-like reaction
        ("metronidazole", "alcohol", "contraindicated", "Disulfiram-like reaction: severe flushing, vomiting, tachycardia; avoid alcohol during and 48 h after therapy"),
        ("tinidazole", "alcohol", "contraindicated", "Disulfiram-like reaction; avoid alcohol for 72 h after last dose"),
        ("disulfiram", "alcohol", "contraindicated", "Intended disulfiram reaction; may be severe or fatal at high alcohol intake"),
        // Tyramine + MAOIs → hypertensive crisis
        ("maoi", "tyramine", "contraindicated", "Hypertensive crisis: tyramine-rich foods (aged cheese, cured meats, red wine) can cause a life-threatening BP spike"),
        ("phenelzine", "tyramine", "contraindicated", "Hypertensive crisis; strict tyramine-free diet required"),
        ("tranylcypromine", "tyramine", "contraindicated", "Hypertensive crisis; strict tyramine-free diet required"),
        // Other contraindicated combinations
        ("warfarin", "thrombolytic", "contraindicated", "Uncontrollable haemorrhage risk; concurrent use is contraindicated"),
        ("warfarin", "streptokinase", "contraindicated", "Uncontrollable haemorrhage risk"),
        ("warfarin", "alteplase", "contraindicated", "Uncontrollable haemorrhage risk"),
        ("clopidogrel", "thrombolytic", "contraindicated", "Uncontrollable haemorrhage risk"),
        ("simvastatin", "itraconazole", "contraindicated", "Severe myopathy/rhabdomyolysis due to CYP3A4 inhibition markedly raising simvastatin AUC"),
        ("simvastatin", "ketoconazole", "contraindicated", "Severe myopathy/rhabdomyolysis; avoid combination"),
        ("sildenafil", "nitrate", "contraindicated", "Catastrophic hypotension; concurrent use is absolutely contraindicated"),
        ("tadalafil", "nitrate", "contraindicated", "Catastrophic hypotension; concurrent use is absolutely contraindicated"),
        ("vardenafil", "nitrate", "contraindicated", "Catastrophic hypotension; concurrent use is absolutely contraindicated"),
        ("sildenafil", "nitroglycerin", "contraindicated", "Catastrophic hypotension; concurrent use is absolutely contraindicated"),

        // ── MAJOR ─────────────────────────────────────────────────────────────
        // Warfarin + NSAIDs / antibiotics / other interactors
        ("warfarin", "aspirin", "major", "Increased bleeding risk: additive antiplatelet effect plus GI mucosal damage; monitor INR closely"),
        ("warfarin", "ibuprofen", "major", "Increased bleeding risk: NSAID-mediated platelet inhibition and GI injury"),
        ("warfarin", "naproxen", "major", "Increased bleeding risk: NSAID-mediated platelet inhibition"),
        ("warfarin", "celecoxib", "major", "Increased INR and bleeding risk; monitor closely"),
        ("warfarin", "diclofenac", "major", "Increased bleeding risk; monitor INR"),
        ("warfarin", "amoxicillin", "major", "Antibiotics may disrupt gut flora and raise INR; monitor INR when starting or stopping"),
        ("warfarin", "ciprofloxacin", "major", "CYP1A2 inhibition raises warfarin levels; significant INR increase"),
        ("warfarin", "metronidazole", "major", "CYP2C9 inhibition markedly raises warfarin levels; reduce warfarin dose and monitor INR"),
        ("warfarin", "fluconazole", "major", "CYP2C9/3A4 inhibition greatly increases warfarin effect; major INR elevation"),
        ("warfarin", "amiodarone", "major", "CYP2C9 inhibition raises warfarin effect; marked INR increase, may persist for weeks after amiodarone stopped"),
        ("warfarin", "trimethoprim", "major", "CYP2C9 inhibition and folate antagonism raise INR; monitor closely"),
        ("warfarin", "sulfamethoxazole", "major", "CYP2C9 inhibition raises warfarin effect; cotrimoxazole frequently causes major INR elevation"),
        ("warfarin", "erythromycin", "major", "CYP3A4 inhibition increases warfarin levels; monitor INR"),
        ("warfarin", "clarithromycin", "major", "CYP3A4 inhibition increases warfarin levels; monitor INR"),
        // Methotrexate + NSAIDs / trimethoprim
        ("methotrexate", "nsaid", "major", "Methotrexate toxicity: NSAIDs reduce renal clearance and increase methotrexate levels; risk of bone marrow suppression and mucositis"),
        ("methotrexate", "ibuprofen", "major", "Reduced methotrexate clearance; serious toxicity risk"),
        ("methotrexate", "naproxen", "major", "Reduced methotrexate clearance; serious toxicity risk"),
        ("methotrexate", "aspirin", "major", "Reduced methotrexate clearance and protein displacement; toxicity risk"),
        ("methotrexate", "trimethoprim", "major", "Additive folate antagonism; severe bone marrow suppression"),
        ("methotrexate", "sulfamethoxazole", "major", "Additive folate antagonism; severe bone marrow suppression"),
        ("methotrexate", "penicillin", "major", "Reduced renal tubular secretion of methotrexate; toxicity risk"),
        // Digoxin interactions
        ("digoxin", "amiodarone", "major", "Digoxin toxicity: amiodarone inhibits P-gp and reduces renal clearance; reduce digoxin dose by 50% and monitor levels"),
        ("digoxin", "verapamil", "major", "Digoxin toxicity: verapamil inhibits P-gp and reduces renal clearance; monitor levels"),
        ("digoxin", "quinidine", "major", "Digoxin toxicity: quinidine doubles digoxin plasma levels; monitor levels and halve digoxin dose"),
        ("digoxin", "clarithromycin", "major", "P-gp inhibition raises digoxin levels; monitor closely"),
        ("digoxin", "erythromycin", "major", "P-gp inhibition raises digoxin levels; monitor closely"),
        // ACE inhibitors + potassium-sparing diuretics / potassium
        ("lisinopril", "spironolactone", "major", "Severe hyperkalemia: additive potassium retention; monitor serum potassium frequently"),
        ("lisinopril", "eplerenone", "major", "Severe hyperkalemia; monitor potassium"),
        ("enalapril", "spironolactone", "major", "Severe hyperkalemia; monitor potassium"),
        ("ramipril", "spironolactone", "major", "Severe hyperkalemia; monitor potassium"),
        ("lisinopril", "potassium", "major", "Hyperkalemia: ACE inhibitors reduce renal potassium excretion; avoid high-dose potassium supplementation"),
        ("ace inhibitor", "potassium-sparing diuretic", "major", "Severe hyperkalemia; potassium monitoring mandatory"),
        // Statins + fibrates → rhabdomyolysis
        ("simvastatin", "gemfibrozil", "major", "Rhabdomyolysis: gemfibrozil inhibits simvastatin metabolism; combination is generally avoided"),
        ("atorvastatin", "gemfibrozil", "major", "Rhabdomyolysis risk; use lowest statin dose if combination is necessary"),
        ("rosuvastatin", "gemfibrozil", "major", "Rhabdomyolysis: gemfibrozil inhibits rosuvastatin clearance; avoid or use lowest dose"),
        ("lovastatin", "gemfibrozil", "major", "Rhabdomyolysis risk; avoid combination"),
        ("simvastatin", "fenofibrate", "major", "Rhabdomyolysis risk lower than gemfibrozil but still significant; monitor CK"),
        // Lithium + NSAIDs / ACE inhibitors
        ("lithium", "ibuprofen", "major", "Lithium toxicity: NSAIDs reduce renal lithium clearance; may cause lithium levels to rise dangerously"),
        ("lithium", "naproxen", "major", "Lithium toxicity: reduced renal clearance"),
        ("lithium", "diclofenac", "major", "Lithium toxicity: reduced renal clearance"),
        ("lithium", "lisinopril", "major", "Lithium toxicity: ACE inhibitors reduce renal lithium clearance; monitor levels"),
        ("lithium", "enalapril", "major", "Lithium toxicity: reduced renal clearance"),
        ("lithium", "hydrochlorothiazide", "major", "Lithium toxicity: thiazides decrease lithium excretion; risk of toxic levels"),
        ("lithium", "furosemide", "major", "Lithium toxicity risk if sodium-depleted; monitor carefully"),
        // Theophylline + quinolones / macrolides
        ("theophylline", "ciprofloxacin", "major", "Theophylline toxicity: ciprofloxacin inhibits CYP1A2, raising theophylline levels; nausea, arrhythmia, seizures"),
        ("theophylline", "enoxacin", "major", "Severe theophylline toxicity; enoxacin is one of the strongest inhibitors; avoid"),
        ("theophylline", "erythromycin", "major", "CYP1A2 inhibition raises theophylline levels; toxicity risk"),
        ("theophylline", "clarithromycin", "major", "CYP1A2 inhibition raises theophylline levels; monitor levels"),
        ("theophylline", "fluvoxamine", "major", "Potent CYP1A2 inhibition; theophylline levels may double"),
        // Serotonin syndrome — non-MAOI combinations
        ("fluoxetine", "tramadol", "major", "Serotonin syndrome risk and reduced tramadol analgesia due to CYP2D6 inhibition"),
        ("sertraline", "tramadol", "major", "Serotonin syndrome risk"),
        ("paroxetine", "tramadol", "major", "Serotonin syndrome risk; paroxetine also reduces tramadol efficacy"),
        ("ssri", "triptans", "major", "Serotonin syndrome risk when high doses used; monitor closely"),
        ("ssri", "tramadol", "major", "Serotonin syndrome risk with serotonergic opioid"),
        ("ssri", "lithium", "major", "Serotonin syndrome risk at higher doses; monitor carefully"),
        // Immunosuppressants + live vaccines
        ("cyclosporine", "live vaccine", "major", "Disseminated vaccine-strain infection; live vaccines are contraindicated in immunosuppressed patients"),
        ("tacrolimus", "live vaccine", "major", "Disseminated vaccine-strain infection; avoid live vaccines"),
        ("methotrexate", "live vaccine", "major", "Disseminated vaccine-strain infection; avoid live vaccines while on immunosuppressive doses"),
        ("azathioprine", "live vaccine", "major", "Avoid live vaccines during immunosuppressive therapy"),
        ("mycophenolate", "live vaccine", "major", "Avoid live vaccines during immunosuppressive therapy"),
        // Anticoagulants + thrombolytics
        ("heparin", "thrombolytic", "major", "Synergistic bleeding risk; requires careful monitoring and timing"),
        ("apixaban", "thrombolytic", "major", "Synergistic bleeding risk"),
        ("rivaroxaban", "thrombolytic", "major", "Synergistic bleeding risk"),
        ("dabigatran", "thrombolytic", "major", "Synergistic bleeding risk"),
        // Metformin + contrast
        ("metformin", "contrast dye", "major", "Risk of contrast-induced nephropathy leading to lactic acidosis; hold metformin 48 h before and after contrast"),
        ("metformin", "iodinated contrast", "major", "Lactic acidosis risk if renal function impaired; withhold metformin peri-procedure"),
        // Antidiabetics + beta-blockers
        ("insulin", "propranolol", "major", "Beta-blockers mask tachycardia warning of hypoglycemia and prolong recovery; non-selective beta-blockers are most problematic"),
        ("insulin", "atenolol", "major", "Masking of hypoglycemia symptoms; use with caution"),
        ("sulfonylurea", "propranolol", "major", "Masking of hypoglycemia symptoms and prolonged hypoglycemic episodes"),
        ("glipizide", "propranolol", "major", "Masking of hypoglycemia symptoms"),
        // CYP interactions — rifampin (potent CYP450 inducer)
        ("rifampin", "warfarin", "major", "CYP2C9/3A4 induction markedly reduces warfarin levels; INR may fall by 50% or more"),
        ("rifampin", "oral contraceptive", "major", "CYP3A4 induction reduces contraceptive plasma levels; additional contraception required"),
        ("rifampin", "cyclosporine", "major", "CYP3A4 induction sharply reduces cyclosporine levels; risk of transplant rejection"),
        ("rifampin", "tacrolimus", "major", "CYP3A4 induction reduces tacrolimus levels; risk of rejection"),
        ("rifampin", "hiv protease inhibitor", "major", "CYP3A4 induction reduces antiretroviral levels; virological failure"),
        ("rifampin", "fluconazole", "major", "CYP3A4 induction reduces fluconazole levels significantly"),
        // Other major interactions
        ("clopidogrel", "omeprazole", "major", "CYP2C19 inhibition reduces clopidogrel antiplatelet activation; increased thrombotic risk"),
        ("clopidogrel", "esomeprazole", "major", "CYP2C19 inhibition reduces clopidogrel activation; use pantoprazole as alternative PPI"),
        ("phenytoin", "carbamazepine", "major", "Mutual CYP induction; unpredictable changes in both drug levels requiring monitoring"),
        ("phenytoin", "valproate", "major", "Valproate displaces phenytoin from protein binding and inhibits its metabolism; complex bidirectional interaction"),
        ("carbamazepine", "oral contraceptive", "major", "CYP3A4 induction reduces contraceptive efficacy; use alternative contraception"),

        // ── MODERATE ─────────────────────────────────────────────────────────
        // Antihypertensives + NSAIDs → BP increase
        ("lisinopril", "ibuprofen", "moderate", "NSAIDs blunt antihypertensive effect of ACE inhibitors and increase risk of renal impairment"),
        ("lisinopril", "naproxen", "moderate", "NSAIDs reduce antihypertensive effect; monitor blood pressure"),
        ("amlodipine", "ibuprofen", "moderate", "NSAIDs may attenuate antihypertensive effect"),
        ("hydrochlorothiazide", "ibuprofen", "moderate", "NSAIDs reduce diuretic and antihypertensive effect; risk of fluid retention"),
        ("metoprolol", "ibuprofen", "moderate", "NSAIDs may reduce antihypertensive efficacy"),
        // Diuretics + aminoglycosides → ototoxicity
        ("furosemide", "gentamicin", "moderate", "Additive ototoxicity: furosemide plus aminoglycoside substantially increases risk of permanent hearing loss"),
        ("furosemide", "tobramycin", "moderate", "Additive ototoxicity; avoid or monitor hearing"),
        ("furosemide", "amikacin", "moderate", "Additive ototoxicity"),
        ("ethacrynic acid", "aminoglycoside", "moderate", "Severe ototoxicity risk; ethacrynic acid is the most ototoxic loop diuretic"),
        // Tetracycline / fluoroquinolone + antacids / dairy
        ("tetracycline", "antacid", "moderate", "Chelation by divalent cations (Ca, Mg, Al) markedly reduces tetracycline absorption; separate by ≥2 h"),
        ("tetracycline", "calcium", "moderate", "Calcium chelation reduces tetracycline bioavailability; separate by ≥2 h"),
        ("tetracycline", "iron", "moderate", "Iron chelation reduces tetracycline absorption"),
        ("doxycycline", "antacid", "moderate", "Chelation reduces doxycycline absorption; separate doses"),
        ("doxycycline", "iron", "moderate", "Reduced doxycycline absorption due to chelation"),
        ("ciprofloxacin", "antacid", "moderate", "Antacids containing Mg or Al reduce ciprofloxacin absorption by up to 90%; separate by ≥2–4 h"),
        ("ciprofloxacin", "calcium", "moderate", "Divalent cations reduce ciprofloxacin absorption; separate doses"),
        ("ciprofloxacin", "iron", "moderate", "Iron chelation reduces ciprofloxacin absorption"),
        ("levofloxacin", "antacid", "moderate", "Reduced absorption due to chelation; separate by ≥2 h"),
        ("moxifloxacin", "antacid", "moderate", "Reduced absorption due to chelation; separate by ≥2 h"),
        // Rifampin — moderate-level interactions
        ("rifampin", "diazepam", "moderate", "CYP3A4/2C19 induction reduces diazepam levels; benzodiazepine effect may be insufficient"),
        ("rifampin", "methadone", "moderate", "CYP3A4 induction reduces methadone; opioid withdrawal may occur"),
        ("rifampin", "doxycycline", "moderate", "CYP3A4 induction reduces doxycycline levels"),
        // Statins + CYP3A4 inhibitors
        ("simvastatin", "amlodipine", "moderate", "Amlodipine inhibits CYP3A4 and can increase simvastatin exposure; limit simvastatin to 20 mg/day"),
        ("simvastatin", "diltiazem", "moderate", "CYP3A4 inhibition raises simvastatin levels; limit simvastatin dose"),
        ("simvastatin", "verapamil", "moderate", "CYP3A4 inhibition raises simvastatin levels; limit dose"),
        ("atorvastatin", "clarithromycin", "moderate", "CYP3A4 inhibition increases atorvastatin; myopathy risk"),
        ("atorvastatin", "erythromycin", "moderate", "CYP3A4 inhibition increases atorvastatin levels"),
        ("simvastatin", "grapefruit", "moderate", "Grapefruit inhibits intestinal CYP3A4; increased statin levels and myopathy risk"),
        ("atorvastatin", "grapefruit", "moderate", "Grapefruit inhibits intestinal CYP3A4; increased atorvastatin levels"),
        // ACE inhibitor / ARB + NSAIDs (triple whammy)
        ("ace inhibitor", "nsaid", "moderate", "Reduced antihypertensive effect and risk of acute kidney injury when combined with a diuretic"),
        ("losartan", "ibuprofen", "moderate", "NSAIDs reduce antihypertensive effect and increase renal impairment risk"),
        ("valsartan", "ibuprofen", "moderate", "NSAIDs reduce antihypertensive effect and increase renal impairment risk"),
        // CNS depressant combinations
        ("opioid", "gabapentin", "moderate", "Additive CNS/respiratory depression; risk of oversedation particularly in elderly"),
        ("morphine", "gabapentin", "moderate", "Additive CNS/respiratory depression"),
        ("opioid", "pregabalin", "moderate", "Additive CNS/respiratory depression; fatal opioid overdoses are more common with concomitant gabapentinoids"),
        ("benzodiazepine", "alcohol", "moderate", "Additive CNS depression; impaired psychomotor function and increased sedation"),
        ("antidepressant", "alcohol", "moderate", "Additive CNS depression and potential loss of antidepressant efficacy"),
        // Antifungal interactions
        ("fluconazole", "simvastatin", "moderate", "CYP3A4 inhibition raises simvastatin levels; myopathy risk"),
        ("fluconazole", "sulfonylurea", "moderate", "CYP2C9 inhibition raises sulfonylurea levels; hypoglycemia risk"),
        ("fluconazole", "phenytoin", "moderate", "CYP2C9 inhibition raises phenytoin levels; toxicity risk"),
        // Other moderate interactions
        ("allopurinol", "azathioprine", "moderate", "Allopurinol inhibits xanthine oxidase and raises azathioprine/mercaptopurine to toxic levels; reduce azathioprine dose by 75%"),
        ("allopurinol", "mercaptopurine", "moderate", "Same mechanism as azathioprine; reduce dose by 75%"),
        ("spironolactone", "ace inhibitor", "moderate", "Hyperkalemia risk; monitor potassium, especially in renal impairment or heart failure"),
        ("ssri", "nsaid", "moderate", "Additive risk of GI bleeding: SSRIs inhibit platelet serotonin uptake; co-prescribe with a PPI"),
        ("ssri", "aspirin", "moderate", "Additive GI bleeding risk; consider gastroprotection"),
        ("quinidine", "digoxin", "moderate", "Digoxin toxicity: quinidine raises digoxin levels; monitor"),
        ("verapamil", "beta-blocker", "moderate", "Additive negative chronotropy and inotropy; bradycardia and heart block risk"),
        ("diltiazem", "beta-blocker", "moderate", "Additive negative chronotropy; bradycardia and AV block risk"),
    ];

    let mut interactions: Vec<crate::clinical::DrugInteraction> = Vec::new();
    let medications_lower: Vec<String> = medications.iter().map(|m| m.to_lowercase()).collect();

    // Check each pair of medications
    for i in 0..medications_lower.len() {
        for j in (i + 1)..medications_lower.len() {
            let med1 = &medications_lower[i];
            let med2 = &medications_lower[j];

            for (drug1, drug2, severity, description) in &known_interactions {
                if (med1.contains(drug1) && med2.contains(drug2))
                    || (med1.contains(drug2) && med2.contains(drug1))
                {
                    let severity_enum = match *severity {
                        "contraindicated" => crate::clinical::InteractionSeverity::Contraindicated,
                        "major" => crate::clinical::InteractionSeverity::Major,
                        "moderate" => crate::clinical::InteractionSeverity::Moderate,
                        _ => crate::clinical::InteractionSeverity::Minor,
                    };

                    interactions.push(crate::clinical::DrugInteraction {
                        drug_a: medications[i].clone(),
                        drug_b: medications[j].clone(),
                        severity: severity_enum,
                        description: description.to_string(),
                        clinical_effects: description.to_string(),
                        management: format!(
                            "Monitor closely or consider alternatives for {} and {}",
                            medications[i], medications[j]
                        ),
                        evidence_level: crate::clinical::EvidenceLevel::Established,
                        source: "Clinical Pharmacology Database".to_string(),
                    });
                }
            }
        }
    }
    interactions
}

/// Finalize a standalone drug-interaction check: allergy screen, result assembly,
/// persistence, and JSON response. Split out of `check_drug_interactions` so the
/// curated table in `evaluate_drug_interactions` can be reused by other flows.
async fn check_interactions_response(
    data: &web::Data<crate::AppState>,
    req: &CheckDrugInteractionsRequest,
    current_user_id: &str,
    interactions: Vec<crate::clinical::DrugInteraction>,
) -> HttpResponse {
    let medications_lower: Vec<String> = req.medications.iter().map(|m| m.to_lowercase()).collect();

    // Check allergies if requested (via repository)
    let mut allergy_alerts: Vec<serde_json::Value> = Vec::new();
    if req.include_allergies.unwrap_or(true) {
        let patient_allergies = data
            .repositories
            .allergies
            .get_active_by_patient(&req.patient_id)
            .await
            .unwrap_or_default();
        for allergy in &patient_allergies {
            let allergen_lower = allergy.allergen.to_lowercase();
            for med in &medications_lower {
                if med.contains(&allergen_lower) {
                    allergy_alerts.push(serde_json::json!({
                        "type": "allergy",
                        "medication": med,
                        "allergen": allergy.allergen,
                        "severity": allergy.severity,
                        "reaction": allergy.reaction
                    }));
                }
            }
        }
    }

    // Calculate overall severity
    let overall_severity = interactions
        .iter()
        .map(|i| &i.severity)
        .max()
        .cloned()
        .unwrap_or(crate::clinical::InteractionSeverity::None);

    let safe_to_prescribe = !matches!(
        overall_severity,
        crate::clinical::InteractionSeverity::Contraindicated
            | crate::clinical::InteractionSeverity::Major
    );

    let result = crate::clinical::DrugInteractionResult {
        result_id: format!("CHK-{}", uuid::Uuid::new_v4()),
        patient_id: req.patient_id.clone(),
        checked_at: chrono::Utc::now().timestamp(),
        new_medication: req.medications.first().cloned().unwrap_or_default(),
        interactions: interactions.clone(),
        overall_severity,
        safe_to_prescribe,
        checked_by: current_user_id.to_string(),
    };

    // Store the result via repository (was: in-memory data.drug_interactions HashMap)
    let check_id = result.result_id.clone();
    {
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: check_id.clone(),
            owner_id: result.patient_id.clone(),
            data: serde_json::to_value(&result).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data
            .repositories
            .drug_interaction_checks
            .create(entity)
            .await;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "check_id": check_id,
        "patient_id": req.patient_id,
        "medications_checked": req.medications.len(),
        "interactions_found": interactions.len(),
        "has_critical": interactions.iter().any(|i|
            matches!(i.severity, crate::clinical::InteractionSeverity::Contraindicated |
                                  crate::clinical::InteractionSeverity::Major)),
        "interactions": interactions,
        "allergy_alerts": allergy_alerts,
        "recommendation": if interactions.is_empty() && allergy_alerts.is_empty() {
            "No significant interactions detected"
        } else if interactions.iter().any(|i| matches!(i.severity, crate::clinical::InteractionSeverity::Contraindicated)) {
            "CONTRAINDICATED - Do not prescribe together"
        } else if interactions.iter().any(|i| matches!(i.severity, crate::clinical::InteractionSeverity::Major)) {
            "MAJOR interactions - Consider alternatives"
        } else {
            "Moderate interactions - Monitor patient closely"
        }
    }))
}

/// Get interaction check history for a patient
#[get("/api/interactions/history/{patient_id}")]
pub async fn get_interaction_history(
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
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let history: Vec<crate::clinical::DrugInteractionResult> = data
        .repositories
        .drug_interaction_checks
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| {
            serde_json::from_value::<crate::clinical::DrugInteractionResult>(r.data).ok()
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "checks": history,
        "count": history.len()
    }))
}
