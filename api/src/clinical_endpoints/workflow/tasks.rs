use super::*;

/// A worklist must never turn a repository outage into an empty shift queue.
macro_rules! required_worklist_read {
    ($result:expr, $area:literal) => {
        match $result {
            Ok(value) => value,
            Err(error) => {
                log::error!("{} read failed: {error}", $area);
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    success: false,
                    error: "Clinical worklist data is temporarily unavailable".to_string(),
                    code: "WORKLIST_DATA_UNAVAILABLE".to_string(),
                });
            }
        }
    };
}

// ============================================================================
// NOTIFICATION SYSTEM
// ============================================================================

/// Get notifications for current user
#[get("/api/notifications")]
pub async fn get_notifications(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
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

    let mut notifications = Vec::new();

    // For doctors/nurses/admins - check for critical values
    if current_user.role.can_view_medical_records() {
        // Via repository (was: in-memory data.critical_values HashMap)
        let critical_values = required_worklist_read!(
            data.repositories.critical_values.list_all().await,
            "critical-value notification"
        );
        for cv in critical_values.iter().take(5) {
            notifications.push(serde_json::json!({
                "id": cv.id,
                "type": "critical_value",
                "priority": "high",
                "title": format!("Critical Value: {}", cv.test_name),
                "patient_id": cv.patient_id,
                "timestamp": cv.created_at.timestamp()
            }));
        }

        // Check for pending lab approvals (doctors only)
        if matches!(current_user.role, crate::Role::Doctor | crate::Role::Admin) {
            let pending: Vec<crate::LabResultSubmission> = required_worklist_read!(
                data.repositories.lab_result_submissions.list_all().await,
                "pending lab notification"
            )
            .into_iter()
            .filter_map(|r| serde_json::from_value::<crate::LabResultSubmission>(r.data).ok())
            .filter(|s| s.status == crate::LabResultStatus::Pending)
            .collect();
            if let Some(newest) = pending.iter().map(|s| s.submitted_at.timestamp()).max() {
                notifications.push(serde_json::json!({
                    "id": "pending-labs",
                    "type": "pending_approval",
                    "priority": "medium",
                    "title": format!("{} lab results awaiting approval", pending.len()),
                    "count": pending.len(),
                    "timestamp": newest
                }));
            }
        }

        // Check for recent code blues - Use repository
        let code_blues = required_worklist_read!(
            data.repositories.code_blue.list_all().await,
            "code-blue notification"
        );
        for cb in code_blues.iter().take(3) {
            notifications.push(serde_json::json!({
                "id": cb.id,
                "type": "code_blue",
                "priority": "critical",
                "title": "Code Blue Event",
                "patient_id": cb.patient_id,
                "timestamp": cb.code_called_at
            }));
        }
    }

    // For patients - check for new lab results
    if matches!(current_user.role, crate::Role::Patient) {
        let approved_results: Vec<crate::LabResultSubmission> = required_worklist_read!(
            data.repositories
                .lab_result_submissions
                .get_by_owner(&current_user_id)
                .await,
            "patient lab notification"
        )
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::LabResultSubmission>(r.data).ok())
        .filter(|s| s.status == crate::LabResultStatus::Approved)
        .take(5)
        .collect();

        for result in approved_results {
            notifications.push(serde_json::json!({
                "id": result.id,
                "type": "lab_result",
                "priority": "low",
                "title": format!("New lab result: {}", result.test_name),
                "timestamp": result.reviewed_at.map(|t| t.timestamp()).unwrap_or(0)
            }));
        }

        if let Some(patient_id) = current_user.linked_patient_id.as_deref() {
            let emergency_notifications =
                match emergency_access_notifications(&data, patient_id).await {
                    Ok(entries) => entries,
                    Err(()) => {
                        return HttpResponse::InternalServerError().json(ErrorResponse {
                            success: false,
                            error: "Failed to load notifications".to_string(),
                            code: "NOTIFICATION_LOAD_FAILED".to_string(),
                        })
                    }
                };
            notifications.extend(emergency_notifications);
        }
    }

    // What has already been read.
    //
    // `unread_count` used to be `notifications.len()`: every notification was
    // unread forever, so the bell's badge was a constant that no amount of
    // reading could clear, and the screen behind it did not exist (the header
    // navigated to `/notifications`, which no route served, so the router's
    // catch-all bounced the click to the dashboard).
    let read_at = match notifications_read_at(&data, &current_user_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let unread = notifications
        .iter()
        .filter(|entry| entry_is_unread(entry, read_at))
        .count();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "notifications": notifications,
        "count": notifications.len(),
        "unread_count": unread,
        "read_at": read_at,
    }))
}

/// Is this entry newer than the caller's read marker?
///
/// An entry with no timestamp is treated as unread: the alternative is hiding
/// something because its time could not be established.
fn entry_is_unread(entry: &serde_json::Value, read_at: i64) -> bool {
    entry
        .get("timestamp")
        .and_then(serde_json::Value::as_i64)
        .map(|stamp| stamp > read_at)
        .unwrap_or(true)
}

/// When this user last marked their notifications read. `0` means never.
async fn notifications_read_at(
    data: &web::Data<AppState>,
    user_id: &str,
) -> Result<i64, HttpResponse> {
    match data
        .repositories
        .notification_reads
        .get_by_id(user_id)
        .await
    {
        Ok(Some(record)) => Ok(record
            .data
            .get("read_at")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0)),
        Ok(None) => Ok(0),
        Err(error) => {
            log::error!("notification read marker load failed: {error}");
            Err(HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Notifications are temporarily unavailable".to_string(),
                code: "NOTIFICATION_READ_STATE_UNAVAILABLE".to_string(),
            }))
        }
    }
}

/// Mark every notification up to now as read.
///
/// Deliberately a marker rather than a per-entry flag: the list is derived
/// from live clinical state, so its entries are not rows anybody can flag, and
/// an aggregate like "6 lab results awaiting approval" has no identity that
/// survives the seventh arriving.
#[post("/api/notifications/read")]
pub async fn mark_notifications_read(
    data: web::Data<AppState>,
    http_req: HttpRequest,
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
    if get_user(&data, &current_user_id).is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        });
    }
    let now = chrono::Utc::now();
    let record = crate::repositories::traits::JsonRecordEntity {
        id: current_user_id.clone(),
        owner_id: current_user_id,
        data: serde_json::json!({ "read_at": now.timestamp() }),
        created_at: now,
        updated_at: now,
    };
    match data.repositories.notification_reads.create(record).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "read_at": now.timestamp(),
        })),
        Err(error) => {
            log::error!("notification read marker write failed: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The notifications could not be marked read".to_string(),
                code: "NOTIFICATION_READ_STATE_UNAVAILABLE".to_string(),
            })
        }
    }
}

#[cfg(test)]
mod notification_read_tests {
    use super::*;
    use crate::test_fixtures::register;
    use actix_web::{http::StatusCode, test, App};

    /// A doctor with one pending lab result has one unread notification, and
    /// marking them read clears the count without hiding the entry itself.
    #[actix_web::test]
    async fn marking_read_clears_the_count_but_keeps_the_list() {
        let state = AppState::new();
        register(&state, "doctor_a", crate::Role::Doctor);
        let submitted_at = chrono::Utc::now() - chrono::Duration::minutes(5);
        let submission = serde_json::json!({
            "id": "LRS-1",
            "patient_id": "PAT-1",
            "patient_name": "Test Patient",
            "test_name": "Potassium",
            "test_category": "chemistry",
            "results": [],
            "submitted_by": "lab_a",
            "submitted_at": submitted_at,
            "status": "Pending"
        });
        state
            .repositories
            .lab_result_submissions
            .create(crate::repositories::traits::JsonRecordEntity {
                id: "LRS-1".to_string(),
                owner_id: "PAT-1".to_string(),
                data: submission,
                created_at: submitted_at,
                updated_at: submitted_at,
            })
            .await
            .unwrap();
        let state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(get_notifications)
                .service(mark_notifications_read),
        )
        .await;

        let before: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::get()
                .uri("/api/notifications")
                .insert_header(("x-user-id", "doctor_a"))
                .to_request(),
        )
        .await;
        assert_eq!(before["unread_count"], 1, "{before}");

        let marked = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/notifications/read")
                .insert_header(("x-user-id", "doctor_a"))
                .to_request(),
        )
        .await;
        assert_eq!(marked.status(), StatusCode::OK);

        let after: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::get()
                .uri("/api/notifications")
                .insert_header(("x-user-id", "doctor_a"))
                .to_request(),
        )
        .await;
        assert_eq!(after["unread_count"], 0, "{after}");
        assert_eq!(after["count"], 1, "the entry is read, not deleted");
    }

    #[actix_web::test]
    async fn an_anonymous_caller_cannot_mark_notifications_read() {
        let state = web::Data::new(AppState::new());
        let app =
            test::init_service(App::new().app_data(state).service(mark_notifications_read)).await;
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/notifications/read")
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}

async fn emergency_access_notifications(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> Result<Vec<serde_json::Value>, ()> {
    let accesses = data
        .repositories
        .emergency_capsules
        .access_history(patient_id, 5)
        .await
        .map_err(|error| {
            log::error!("Failed to load emergency-access notifications: {error}");
        })?;
    Ok(accesses
        .into_iter()
        .map(|access| {
            serde_json::json!({
                "id": access.id,
                "type": "emergency_access",
                "priority": "high",
                "title": "Your emergency medical information was accessed",
                "accessed_by": access.accessed_by,
                "reason_code": access.reason_code,
                "fields_revealed": access.fields_revealed,
                "commitment_verified": access.commitment_verified,
                "timestamp": access.accessed_at.timestamp()
            })
        })
        .collect())
}

/// Get medication reminders for patient
#[get("/api/medications/reminders/{patient_id}")]
pub async fn get_medication_reminders(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
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

    let all_records = required_worklist_read!(
        data.repositories
            .medication_reminders
            .get_by_patient(&patient_id)
            .await,
        "patient medication reminder"
    );
    let reminders: Vec<_> = all_records.into_iter().filter(|m| m.is_active).collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "reminders": reminders,
        "count": reminders.len()
    }))
}

/// Classifies a nursing order into the task kind the worklist groups by.
///
/// The order book stores the clinical instruction as free text, so the kind is
/// read from what the order actually says. Anything that is neither an
/// observation nor a dressing stays `nursing_care` rather than being forced
/// into one of the two: a mislabelled task sends the nurse to the bedside
/// expecting the wrong equipment.
fn nursing_task_kind(order: &crate::repositories::traits::PhysicianOrderEntity) -> &'static str {
    let haystack = format!(
        "{} {} {}",
        order.order_details,
        order.indication.as_deref().unwrap_or(""),
        order.special_instructions.as_deref().unwrap_or("")
    )
    .to_lowercase();

    const VITALS: [&str; 6] = [
        "vital",
        "observation",
        "blood pressure",
        "temperature",
        "pulse",
        "saturation",
    ];
    const WOUND: [&str; 4] = ["wound", "dressing", "incision", "pressure ulcer"];

    if VITALS.iter().any(|k| haystack.contains(k)) {
        "vital_signs"
    } else if WOUND.iter().any(|k| haystack.contains(k)) {
        "wound_care"
    } else {
        "nursing_care"
    }
}

/// Get nurse tasks (medication administrations, monitoring)
#[get("/api/nurse/tasks")]
pub async fn get_nurse_tasks(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => return HttpResponse::Unauthorized().finish(),
    };

    if !matches!(current_user.role, crate::Role::Nurse | crate::Role::Admin) {
        return HttpResponse::Forbidden().finish();
    }

    // Medication administration tasks from repository
    let all_reminders = required_worklist_read!(
        data.repositories
            .medication_reminders
            .list_all_active()
            .await,
        "nurse medication task"
    );
    let med_tasks: Vec<_> = all_reminders
        .into_iter()
        .filter(|m| m.is_active)
        .map(|m| {
            let scheduled_at = chrono::Utc::now()
                .date_naive()
                .and_time(m.scheduled_time)
                .and_utc()
                .timestamp();
            serde_json::json!({
                "id": m.id,
                "type": "medication_admin",
                "patient_id": m.patient_id,
                "medication": m.medication_name,
                "dosage": m.dosage,
                "scheduled_at": scheduled_at,
                "priority": if scheduled_at < chrono::Utc::now().timestamp() { "high" } else { "medium" }
            })
        })
        .collect();

    // Monitoring tasks.
    //
    // These were two hardcoded rows against the invented patient ids
    // `0xPATIENT1` and `0xPATIENT2` — a nurse's shift worklist showing work for
    // patients who do not exist, while genuine nursing orders on the ward were
    // absent from it entirely. Both failure directions are unsafe: the invented
    // rows waste the nurse's attention, and the missing ones are care that never
    // reaches the queue.
    //
    // The real source is the physician order book: `order_type = 'nursing'`
    // orders that are still outstanding are exactly the recurring nursing work
    // (observations, wound care, positioning) a shift queue exists to surface.
    let monitoring_tasks: Vec<serde_json::Value> = required_worklist_read!(
        data.repositories
            .physician_orders
            .get_pending_orders()
            .await,
        "nurse monitoring task"
    )
    .into_iter()
    .filter(|o| o.order_type.eq_ignore_ascii_case("nursing"))
    .map(|o| {
        // `last_done` is the last recorded execution; a never-executed order
        // falls back to when it was due to start, so an overdue first
        // observation still sorts as outstanding rather than as done now.
        let last_done = o
            .executed_at
            .or(o.start_datetime)
            .unwrap_or(o.order_datetime)
            .timestamp();
        serde_json::json!({
            "id": o.id,
            "type": nursing_task_kind(&o),
            "patient_id": o.patient_id,
            "frequency": o.frequency.clone().unwrap_or_else(|| "as ordered".to_string()),
            "last_done": last_done,
            "priority": match o.priority.to_lowercase().as_str() {
                "stat" | "urgent" | "asap" => "high",
                "routine" | "scheduled" => "medium",
                _ => "low",
            },
            "instructions": o.special_instructions
        })
    })
    .collect();

    let mut tasks = med_tasks;
    tasks.extend(monitoring_tasks);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "tasks": tasks
    }))
}
