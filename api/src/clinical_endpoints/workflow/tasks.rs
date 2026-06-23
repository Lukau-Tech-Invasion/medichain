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

    if current_user_id != patient_id && !current_user_id.starts_with("0xPROV") {
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

    // Monitoring tasks from repository (Placeholder for actual monitoring schedule)
    let monitoring_tasks = vec![
        serde_json::json!({
            "id": "mon-001",
            "type": "vital_signs",
            "patient_id": "0xPATIENT1",
            "frequency": "q4h",
            "last_done": chrono::Utc::now().timestamp() - 7200,
            "priority": "medium"
        }),
        serde_json::json!({
            "id": "mon-002",
            "type": "wound_care",
            "patient_id": "0xPATIENT2",
            "frequency": "daily",
            "last_done": chrono::Utc::now().timestamp() - 80000,
            "priority": "low"
        }),
    ];

    let mut tasks = med_tasks;
    tasks.extend(monitoring_tasks);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "tasks": tasks
    }))
}
