use super::*;

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
        let critical_values = data
            .repositories
            .critical_values
            .list_all()
            .await
            .unwrap_or_default();
        for cv in critical_values.iter().take(5) {
            notifications.push(serde_json::json!({
                "id": cv.id,
                "type": "critical_value",
                "priority": "high",
                "title": format!("Critical Value: {}", cv.test_name),
                "patient_id": cv.patient_id,
                "timestamp": chrono::Utc::now().timestamp()
            }));
        }

        // Check for pending lab approvals (doctors only)
        if matches!(current_user.role, crate::Role::Doctor | crate::Role::Admin) {
            let pending_count = data
                .repositories
                .lab_result_submissions
                .list_all()
                .await
                .unwrap_or_default()
                .into_iter()
                .filter_map(|r| serde_json::from_value::<crate::LabResultSubmission>(r.data).ok())
                .filter(|s| s.status == crate::LabResultStatus::Pending)
                .count();
            if pending_count > 0 {
                notifications.push(serde_json::json!({
                    "id": "pending-labs",
                    "type": "pending_approval",
                    "priority": "medium",
                    "title": format!("{} lab results awaiting approval", pending_count),
                    "count": pending_count,
                    "timestamp": chrono::Utc::now().timestamp()
                }));
            }
        }

        // Check for recent code blues - Use repository
        let code_blues = data
            .repositories
            .code_blue
            .list_all()
            .await
            .unwrap_or_default();
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
        let approved_results: Vec<crate::LabResultSubmission> = data
            .repositories
            .lab_result_submissions
            .get_by_owner(&current_user_id)
            .await
            .unwrap_or_default()
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
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "notifications": notifications,
        "count": notifications.len()
    }))
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

    let all_records = data
        .repositories
        .medication_reminders
        .get_by_patient(&patient_id)
        .await
        .unwrap_or_default();
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
    let all_reminders = data
        .repositories
        .medication_reminders
        .list_all_active()
        .await
        .unwrap_or_default();
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
    let monitoring_tasks: Vec<serde_json::Value> = data
        .repositories
        .physician_orders
        .get_pending_orders()
        .await
        .unwrap_or_default()
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
