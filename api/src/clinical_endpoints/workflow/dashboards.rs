use super::*;

// ============================================================================
// DASHBOARD ENDPOINTS
// ============================================================================

/// Patient Home Dashboard - timeline of visits, meds, test results
#[get("/api/dashboard/patient")]
pub async fn patient_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
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

    // Get patient profile from repository
    let patient_profile = match data.repositories.patients.get_by_id(&current_user_id).await {
        Ok(p) => Some(p),
        Err(_) => None,
    };

    // Get recent lab results (approved only for patients) from repository
    let pagination = Pagination::new(0, 10);
    let lab_results: Vec<_> = match data
        .repositories
        .lab_submissions
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result
            .items
            .into_iter()
            .filter(|s| current_user.role.can_view_medical_records() || s.status == "approved")
            .collect(),
        Err(_) => Vec::new(),
    };

    // Get medical records from repository
    let pagination = Pagination::new(0, 50);
    let medical_records: Vec<_> = match data
        .repositories
        .medical_records
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get latest vital signs from repository
    let vital_signs = match data
        .repositories
        .vital_signs
        .get_latest_by_patient(&current_user_id)
        .await
    {
        Ok(v) => v,
        Err(_) => None,
    };

    // Get SOAP notes (Progress notes) from repository
    let pagination = Pagination::new(0, 5);
    let soap_notes: Vec<_> = match data
        .repositories
        .progress_notes
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get triage assessments from repository
    let pagination = Pagination::new(0, 5);
    let triage_history: Vec<_> = match data
        .repositories
        .triage_assessments
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "user_id": current_user_id,
        "role": current_user.role.to_string(),
        "profile": patient_profile,
        "recent_lab_results": lab_results,
        "medical_records": medical_records,
        "vital_signs": vital_signs,
        "soap_notes": soap_notes,
        "triage_history": triage_history
    }))
}

/// Physician Dashboard
#[get("/api/dashboard/doctor")]
pub async fn doctor_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    // Get assigned patients from repository
    let pagination = Pagination::new(0, 20);
    let assigned_patients: Vec<_> = match data.repositories.patients.list(pagination).await {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get recent progress notes written by this doctor
    let pagination = Pagination::new(0, 10);
    let recent_notes: Vec<_> = match data.repositories.progress_notes.list_all(pagination).await {
        Ok(result) => result
            .items
            .into_iter()
            .filter(|n| n.created_by == current_user_id)
            .take(10)
            .collect(),
        Err(_) => Vec::new(),
    };

    // Get pending lab review counts from repository
    let lab_submissions = data
        .repositories
        .lab_submissions
        .get_pending_by_priority()
        .await
        .unwrap_or_default();
    let pending_labs = lab_submissions
        .iter()
        .filter(|s| s.status == "pending")
        .count();

    HttpResponse::Ok().json(serde_json::json!({
        "physician_id": current_user_id,
        "assigned_patients_count": assigned_patients.len(),
        "assigned_patients": assigned_patients,
        "recent_notes": recent_notes,
        "pending_lab_reviews": pending_labs
    }))
}

/// Nursing Station Dashboard
#[get("/api/dashboard/nurse")]
pub async fn nurse_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    // Get active patients (admitted/ER) from repository
    let active_patients: Vec<_> = data
        .repositories
        .patients
        .list(Pagination::new(0, 15))
        .await
        .map(|result| result.items)
        .unwrap_or_default();

    // Get pending medications from repository
    let all_reminders = data
        .repositories
        .medication_reminders
        .list_all_active()
        .await
        .unwrap_or_default();
    let pending_meds: Vec<_> = all_reminders
        .into_iter()
        .filter(|m| m.is_active)
        .take(10)
        .collect();

    // Get critical alerts from repository
    let all_alerts = data
        .repositories
        .cds_alerts
        .list_all(Pagination::new(0, 20))
        .await
        .map(|result| result.items)
        .unwrap_or_default();
    let critical_alerts: Vec<_> = all_alerts
        .into_iter()
        .filter(|a| a.severity == "critical")
        .take(5)
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "nurse_id": current_user_id,
        "active_patients": active_patients,
        "pending_medications": pending_meds,
        "critical_alerts": critical_alerts
    }))
}

/// Laboratory Dashboard
#[get("/api/dashboard/lab")]
pub async fn lab_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    // Get pending specimens from repository
    let all_submissions = data
        .repositories
        .lab_submissions
        .get_pending_by_priority()
        .await
        .unwrap_or_default();
    let pending_work = all_submissions
        .iter()
        .filter(|s| s.status == "pending")
        .count();
    let urgent_work = all_submissions
        .iter()
        .filter(|s| s.status == "urgent")
        .count();

    // Get recent QC logs from repository
    let qc_logs = data
        .repositories
        .lab_qc_records
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "lab_tech_id": current_user_id,
        "pending_work_count": pending_work,
        "urgent_work_count": urgent_work,
        "recent_qc_logs": qc_logs.into_iter().take(5).collect::<Vec<_>>()
    }))
}

/// Administrator / System Dashboard
#[get("/api/dashboard/admin")]
pub async fn admin_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    // Check admin role
    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => return HttpResponse::Unauthorized().finish(),
    };

    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().finish();
    }

    // System stats from repositories
    let patient_count = data.repositories.patients.count().await.unwrap_or(0);
    let record_count = data
        .medical_records
        .read()
        .map(|records| records.values().map(Vec::len).sum::<usize>())
        .unwrap_or_default();
    let tx_count = data
        .repositories
        .chain_of_custody
        .list_all()
        .await
        .unwrap_or_default()
        .len();

    // Node status (placeholder)
    let node_status = serde_json::json!({
        "status": "healthy",
        "peers": 4,
        "best_block": 12450,
        "finalized_block": 12445
    });

    HttpResponse::Ok().json(serde_json::json!({
        "admin_id": current_user_id,
        "system_stats": {
            "total_patients": patient_count,
            "total_records": record_count,
            "total_blockchain_transactions": tx_count
        },
        "node_status": node_status
    }))
}

/// Pharmacist Dashboard
#[get("/api/dashboard/pharmacist")]
pub async fn pharmacist_dashboard(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    // Get pending e-prescriptions from repository
    let all_prescriptions = data
        .repositories
        .e_prescriptions_v2
        .list_all()
        .await
        .unwrap_or_default();
    let pending_fills = all_prescriptions.into_iter().take(10).collect::<Vec<_>>();

    HttpResponse::Ok().json(serde_json::json!({
        "pharmacist_id": current_user_id,
        "pending_fills_count": pending_fills.len(),
        "pending_fills": pending_fills
    }))
}
