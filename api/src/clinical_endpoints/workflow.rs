//! `clinical_endpoints::workflow` — handlers split out of the original 21K-line monolith (Phase 10.1).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// DASHBOARD & WORKFLOW ENDPOINTS
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
        "recent_soap_notes": soap_notes,
        "triage_history": triage_history,
        "summary": {
            "total_lab_results": lab_results.len(),
            "total_medical_records": medical_records.len(),
            "total_visits": soap_notes.len()
        }
    }))
}

/// Doctor Dashboard - patient list, pending tasks, alerts
#[get("/api/dashboard/doctor")]
pub async fn doctor_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(current_user.role, crate::Role::Doctor | crate::Role::Admin) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Doctor dashboard requires Doctor or Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get all patients from repository
    let pagination = Pagination::new(0, 50);
    let patients_result = match data.repositories.patients.list(pagination.clone()).await {
        Ok(res) => res,
        Err(_) => PaginatedResult::new(Vec::new(), 0, &Pagination::new(0, 50)),
    };
    let patients = patients_result.items;

    // Get pending lab results awaiting approval from repository
    let pagination = Pagination::new(0, 100);
    let pending_labs: Vec<_> = match data
        .repositories
        .lab_submissions
        .get_by_provider(&current_user.wallet_address, pagination.clone())
        .await
    {
        Ok(result) => result
            .items
            .into_iter()
            .filter(|s| s.status == "pending")
            .collect(),
        Err(_) => Vec::new(),
    };

    // Get critical values needing attention from repository
    let pagination = Pagination::new(0, 10);
    let critical_values: Vec<_> = match data
        .repositories
        .critical_values
        .get_by_patient("", pagination.clone()) // Empty patient_id to get all for provider/global
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get recent code blues from repository
    let pagination = Pagination::new(0, 5);
    let code_blues: Vec<_> = match data
        .repositories
        .code_blue
        .get_by_patient("", pagination.clone()) // Empty to get all
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get active physician orders from repository
    let pagination = Pagination::new(0, 20);
    let active_orders: Vec<_> = match data
        .repositories
        .physician_orders
        .get_by_patient("", pagination.clone()) // Empty to get all
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get recent consults from repository
    let pagination = Pagination::new(0, 10);
    let pending_consults: Vec<_> = match data
        .repositories
        .consultation_notes
        .get_by_status("pending", pagination.clone())
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "role": "Doctor",
        "patients": {
            "total": patients.len(),
            "list": patients.iter().take(50).collect::<Vec<_>>()
        },
        "pending_lab_approvals": pending_labs,
        "critical_values": critical_values,
        "recent_code_blues": code_blues,
        "active_orders": active_orders,
        "pending_consults": pending_consults,
        "alerts": {
            "pending_labs_count": pending_labs.len(),
            "critical_values_count": critical_values.len(),
            "code_blues_count": code_blues.len()
        }
    }))
}

/// Nurse Dashboard - assigned patients, tasks, medication due
#[get("/api/dashboard/nurse")]
pub async fn nurse_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(current_user.role, crate::Role::Nurse | crate::Role::Admin) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Nurse dashboard requires Nurse or Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get all patients from repository
    let pagination = Pagination::new(0, 50);
    let patients = match data.repositories.patients.list(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get active care plans from repository
    let pagination = Pagination::new(0, 50);
    let care_plans = match data
        .repositories
        .nursing_care_plans
        .list_all(pagination)
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get recent vital signs needing attention from repository
    let vitals_needing_attention = match data.repositories.vital_signs.get_critical().await {
        Ok(v) => v,
        Err(_) => Vec::new(),
    };

    // Get medication records for today from repository
    let pagination = Pagination::new(0, 20);
    let medication_records = match data
        .repositories
        .medication_records
        .list_all(pagination)
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get I/O records from repository
    let pagination = Pagination::new(0, 20);
    let io_records = match data.repositories.io_records.list_all(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get wound assessments from repository
    let pagination = Pagination::new(0, 10);
    let wound_assessments = match data
        .repositories
        .wound_assessments
        .list_all(pagination)
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get IV site assessments from repository
    let pagination = Pagination::new(0, 10);
    let iv_assessments = match data
        .repositories
        .iv_assessments
        .get_by_patient("", pagination)
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get fall risk assessments from repository
    let pagination = Pagination::new(0, 50);
    let fall_risks = match data
        .repositories
        .fall_risk_assessments
        .get_by_patient("", pagination)
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get recent incidents from repository
    let pagination = Pagination::new(0, 10);
    let incidents = match data
        .repositories
        .incident_reports
        .list_all(pagination)
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "role": "Nurse",
        "patients": {
            "total": patients.len(),
            "list": patients.iter().take(30).collect::<Vec<_>>()
        },
        "care_plans": care_plans,
        "vitals_needing_attention": vitals_needing_attention,
        "medication_records": medication_records,
        "io_records": io_records,
        "wound_assessments": wound_assessments,
        "iv_assessments": iv_assessments,
        "fall_risk_patients": fall_risks,
        "recent_incidents": incidents,
        "tasks": {
            "vitals_due": vitals_needing_attention.len(),
            "meds_due": medication_records.len(),
            "wounds_to_assess": wound_assessments.len(),
            "ivs_to_check": iv_assessments.len()
        }
    }))
}

/// Lab Technician Dashboard - test queue, pending specimens, QC status
#[get("/api/dashboard/lab")]
pub async fn lab_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(
        current_user.role,
        crate::Role::LabTechnician | crate::Role::Admin
    ) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Lab dashboard requires LabTechnician or Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get pending lab submissions (via repository)
    let pending_submissions: Vec<crate::LabResultSubmission> = data
        .repositories
        .lab_result_submissions
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::LabResultSubmission>(r.data).ok())
        .filter(|s| s.status == crate::LabResultStatus::Pending)
        .collect();

    // Get approved submissions (via repository)
    let approved_submissions: Vec<crate::LabResultSubmission> = data
        .repositories
        .lab_result_submissions
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::LabResultSubmission>(r.data).ok())
        .filter(|s| s.status == crate::LabResultStatus::Approved)
        .take(20)
        .collect();

    // Get specimen collections (via repository)
    let specimens: Vec<_> = data
        .repositories
        .specimen_collections
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .take(20)
        .collect();

    // Get specimen rejections (via repository)
    let rejections: Vec<_> = data
        .repositories
        .specimen_rejections
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .take(10)
        .collect();

    // Get QC records (via repository)
    let qc_records: Vec<_> = data
        .repositories
        .lab_qc_records
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .take(10)
        .collect();

    // Get critical value notifications (via repository)
    let critical_notifications: Vec<_> = data
        .repositories
        .critical_values
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .take(10)
        .collect();

    // Get chain of custody records (via repository)
    let custody_records: Vec<_> = data
        .repositories
        .chain_of_custody
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .take(10)
        .collect();

    // Get lab panels — static reference data (was: data.lab_panels HashMap)
    let lab_panels = clinical::get_standard_lab_panels();

    HttpResponse::Ok().json(serde_json::json!({
        "role": "LabTechnician",
        "test_queue": {
            "pending": pending_submissions,
            "approved_today": approved_submissions,
            "pending_count": pending_submissions.len(),
            "approved_count": approved_submissions.len()
        },
        "specimens": specimens,
        "rejections": rejections,
        "qc_records": qc_records,
        "critical_notifications": critical_notifications,
        "chain_of_custody": custody_records,
        "available_panels": lab_panels,
        "alerts": {
            "pending_tests": pending_submissions.len(),
            "critical_values": critical_notifications.len(),
            "rejections_today": rejections.len()
        }
    }))
}

/// Admin Dashboard - system overview, all users, all data
#[get("/api/dashboard/admin")]
pub async fn admin_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(current_user.role, crate::Role::Admin) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Admin dashboard requires Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get all users from repository
    // Note: User repository doesn't seem to be in RepositoryContainer,
    // it's likely part of PatientRepository or separate.
    // Checking main.rs AppState, it has `users: RwLock<HashMap<String, User>>`.
    // For now, I'll keep user list as is if no user repository exists,
    // or I'll check if patients.list covers it.
    let users: Vec<_> = {
        let users = data.users.read().unwrap();
        users.values().cloned().collect()
    };

    // Get all patients from repository
    let pagination = Pagination::new(0, 100);
    let patients = match data.repositories.patients.list(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Count by role (still using in-memory users for now)
    let doctors_count = users
        .iter()
        .filter(|u| matches!(u.role, crate::Role::Doctor))
        .count();
    let nurses_count = users
        .iter()
        .filter(|u| matches!(u.role, crate::Role::Nurse))
        .count();
    let lab_techs_count = users
        .iter()
        .filter(|u| matches!(u.role, crate::Role::LabTechnician))
        .count();
    let pharmacists_count = users
        .iter()
        .filter(|u| matches!(u.role, crate::Role::Pharmacist))
        .count();
    let patients_count = users
        .iter()
        .filter(|u| matches!(u.role, crate::Role::Patient))
        .count();

    // Get access logs from repository
    let pagination = Pagination::new(0, 50);
    let access_logs = match data.repositories.access_logs.list(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get NFC cards from repository
    let pagination = Pagination::new(0, 100);
    let nfc_cards = match data.repositories.nfc_tags.list(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get all lab submissions from repository
    let pagination = Pagination::new(0, 100);
    let lab_submissions = match data
        .repositories
        .lab_submissions
        .get_by_patient("", pagination)
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get emergency events from repositories
    let pagination = Pagination::new(0, 1);
    let code_blues_count = match data
        .repositories
        .code_blue
        .get_by_patient("", pagination.clone())
        .await
    {
        Ok(r) => r.total,
        Err(_) => 0,
    };
    let traumas_count = match data
        .repositories
        .trauma_assessments_repo
        .get_by_patient("", pagination.clone())
        .await
    {
        Ok(r) => r.total,
        Err(_) => 0,
    };
    let strokes_count = match data
        .repositories
        .stroke_assessments_repo
        .get_by_patient("", pagination.clone())
        .await
    {
        Ok(r) => r.total,
        Err(_) => 0,
    };
    let sepsis_count = match data
        .repositories
        .sepsis_assessments_repo
        .get_by_patient("", pagination)
        .await
    {
        Ok(r) => r.total,
        Err(_) => 0,
    };

    HttpResponse::Ok().json(serde_json::json!({
        "role": "Admin",
        "system_stats": {
            "total_users": users.len(),
            "total_patients": patients.len(),
            "doctors": doctors_count,
            "nurses": nurses_count,
            "lab_technicians": lab_techs_count,
            "pharmacists": pharmacists_count,
            "patient_users": patients_count
        },
        "users": users,
        "nfc_cards": {
            "total": nfc_cards.len(),
            "cards": nfc_cards.iter().take(20).collect::<Vec<_>>()
        },
        "lab_submissions": {
            "total": lab_submissions.len(),
            "pending": lab_submissions.iter().filter(|s| s.status == "pending").count(),
            "approved": lab_submissions.iter().filter(|s| s.status == "approved").count()
        },
        "emergency_events": {
            "code_blues": code_blues_count,
            "traumas": traumas_count,
            "strokes": strokes_count,
            "sepsis_cases": sepsis_count,
            "total": code_blues_count + traumas_count + strokes_count + sepsis_count
        },
        "recent_access_logs": access_logs
    }))
}

/// Pharmacist Dashboard - pending prescriptions, drug interactions, inventory
#[get("/api/dashboard/pharmacist")]
pub async fn pharmacist_dashboard(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(
        current_user.role,
        crate::Role::Pharmacist | crate::Role::Admin
    ) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Pharmacist dashboard requires Pharmacist or Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get e-prescriptions from the repository
    let pagination = Pagination::new(0, 100);
    let prescriptions = match data.repositories.e_prescriptions.list_all(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Count prescriptions by status
    let pending_fill = prescriptions
        .iter()
        .filter(|rx| rx.status == "transmitted" || rx.status == "received")
        .count();
    let in_progress = prescriptions
        .iter()
        .filter(|rx| rx.status == "in_progress")
        .count();
    let completed_today = prescriptions
        .iter()
        .filter(|rx| rx.status == "dispensed" || rx.status == "partial_fill")
        .count();

    // Get prescriptions needing to be filled (transmitted or received)
    let pending_prescriptions: Vec<_> = prescriptions
        .iter()
        .filter(|rx| rx.status == "transmitted" || rx.status == "received")
        .take(20)
        .cloned()
        .collect();

    // Get drug interaction alerts - placeholder for now (would query drug interaction database)
    let drug_interaction_alerts: Vec<String> = Vec::new();

    // Get allergy alerts - placeholder for now (would cross-reference patient allergies)
    let allergy_alerts: Vec<String> = Vec::new();

    HttpResponse::Ok().json(serde_json::json!({
        "role": "Pharmacist",
        "prescriptions": {
            "pending_fill": pending_fill,
            "in_progress": in_progress,
            "completed_today": completed_today,
            "list": pending_prescriptions
        },
        "drug_interactions": drug_interaction_alerts,
        "allergy_alerts": allergy_alerts,
        "alerts": {
            "pending_rx_count": pending_fill,
            "interactions_count": drug_interaction_alerts.len(),
            "allergy_alerts_count": allergy_alerts.len()
        }
    }))
}

// ============================================================================
// PATIENT LIST & FILTERING
// ============================================================================

/// Get patient list with filters (for doctors/nurses)
#[get("/api/patients/list")]
pub async fn get_patient_list(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Use repository for patient list/search
    let limit: u32 = query
        .get("limit")
        .and_then(|l| l.parse().ok())
        .unwrap_or(50);

    let offset: u32 = query
        .get("offset")
        .and_then(|o| o.parse().ok())
        .unwrap_or(0);

    let page = offset / limit;
    let pagination = Pagination::new(page, limit);

    let patient_result = if let Some(search) = query.get("search") {
        data.repositories.patients.search(search, pagination).await
    } else {
        data.repositories.patients.list(pagination).await
    };

    let result = match patient_result {
        Ok(res) => res,
        Err(_) => PaginatedResult::new(Vec::new(), 0, &Pagination::new(page, limit)),
    };

    // Filter by additional criteria in memory for now if repository doesn't support them all
    let mut patient_list = result.items;

    if let Some(blood_type) = query.get("blood_type") {
        patient_list.retain(|p| {
            p.blood_type.as_ref().map(|bt| bt.to_lowercase()) == Some(blood_type.to_lowercase())
        });
    }

    if let Some(organ_donor) = query.get("organ_donor") {
        if organ_donor == "true" {
            patient_list.retain(|p| p.organ_donor);
        }
    }

    if let Some(dnr) = query.get("dnr") {
        if dnr == "true" {
            patient_list.retain(|p| p.dnr_status);
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "patients": patient_list,
        "total": result.total,
        "limit": limit,
        "offset": offset,
        "page": result.page,
        "total_pages": result.total_pages
    }))
}

// ============================================================================
// ORDER SETS (Common Order Bundles)
// ============================================================================

/// Get available order sets
#[get("/api/order-sets")]
pub async fn get_order_sets(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Predefined order sets
    let order_sets = vec![
        serde_json::json!({
            "id": "OS-CHF",
            "name": "CHF Admission Orders",
            "category": "Cardiology",
            "orders": [
                {"type": "diet", "description": "Low sodium diet (2g Na)"},
                {"type": "activity", "description": "Bed rest with bathroom privileges"},
                {"type": "vital_signs", "description": "VS q4h, daily weights"},
                {"type": "lab", "description": "BMP, BNP, CBC daily"},
                {"type": "medication", "description": "Furosemide 40mg IV BID"},
                {"type": "medication", "description": "Lisinopril 10mg PO daily"},
                {"type": "medication", "description": "Carvedilol 12.5mg PO BID"},
                {"type": "iv", "description": "IV access, saline lock"},
                {"type": "monitoring", "description": "Strict I&O, fluid restriction 1.5L/day"}
            ]
        }),
        serde_json::json!({
            "id": "OS-DKA",
            "name": "DKA Management Orders",
            "category": "Endocrinology",
            "orders": [
                {"type": "iv", "description": "NS 1L bolus, then 250-500ml/hr"},
                {"type": "lab", "description": "BMP q2h, POC glucose q1h"},
                {"type": "medication", "description": "Regular insulin 0.1 U/kg/hr IV"},
                {"type": "medication", "description": "Potassium replacement per protocol"},
                {"type": "monitoring", "description": "Strict I&O, neuro checks q2h"},
                {"type": "vital_signs", "description": "VS q1h x4, then q2h"}
            ]
        }),
        serde_json::json!({
            "id": "OS-SEPSIS",
            "name": "Sepsis Bundle Orders",
            "category": "Infectious Disease",
            "orders": [
                {"type": "lab", "description": "Blood cultures x2 sets, lactate, CBC, BMP, LFTs"},
                {"type": "iv", "description": "30ml/kg crystalloid bolus"},
                {"type": "medication", "description": "Broad spectrum antibiotics within 1 hour"},
                {"type": "monitoring", "description": "MAP goal ≥65, urine output ≥0.5ml/kg/hr"},
                {"type": "vital_signs", "description": "VS q15min x4, then q1h"},
                {"type": "consult", "description": "Consider ICU consult if refractory"}
            ]
        }),
        serde_json::json!({
            "id": "OS-STROKE",
            "name": "Acute Stroke Orders",
            "category": "Neurology",
            "orders": [
                {"type": "imaging", "description": "CT head STAT, CT angio if indicated"},
                {"type": "lab", "description": "CBC, BMP, PT/INR, glucose"},
                {"type": "vital_signs", "description": "Neuro checks q15min, VS q15min"},
                {"type": "diet", "description": "NPO pending swallow eval"},
                {"type": "activity", "description": "Bed rest, HOB 0-30 degrees"},
                {"type": "medication", "description": "tPA if eligible (door-to-needle <60min)"},
                {"type": "consult", "description": "Neurology STAT, consider interventional"}
            ]
        }),
        serde_json::json!({
            "id": "OS-CHEST-PAIN",
            "name": "Chest Pain Rule-Out ACS",
            "category": "Cardiology",
            "orders": [
                {"type": "lab", "description": "Troponin x3 (0, 3, 6 hours), BMP, CBC"},
                {"type": "ecg", "description": "12-lead ECG STAT, repeat if symptoms change"},
                {"type": "medication", "description": "Aspirin 325mg PO x1 (if not contraindicated)"},
                {"type": "medication", "description": "Nitroglycerin 0.4mg SL PRN chest pain"},
                {"type": "iv", "description": "IV access, saline lock"},
                {"type": "monitoring", "description": "Continuous cardiac monitoring"},
                {"type": "vital_signs", "description": "VS q4h, pain reassessment q1h"}
            ]
        }),
        serde_json::json!({
            "id": "OS-PNEUMONIA",
            "name": "Community Acquired Pneumonia",
            "category": "Pulmonology",
            "orders": [
                {"type": "lab", "description": "CBC, BMP, procalcitonin, blood cultures x2"},
                {"type": "imaging", "description": "Chest X-ray PA/Lateral"},
                {"type": "medication", "description": "Ceftriaxone 1g IV daily + Azithromycin 500mg IV daily"},
                {"type": "medication", "description": "Acetaminophen 650mg PO q6h PRN fever"},
                {"type": "iv", "description": "NS at 75ml/hr"},
                {"type": "diet", "description": "Regular diet as tolerated"},
                {"type": "vital_signs", "description": "VS q4h, pulse ox continuous"}
            ]
        }),
        serde_json::json!({
            "id": "OS-POST-OP",
            "name": "General Post-Op Orders",
            "category": "Surgery",
            "orders": [
                {"type": "diet", "description": "NPO until bowel sounds, advance as tolerated"},
                {"type": "activity", "description": "OOB to chair POD1, ambulate TID"},
                {"type": "vital_signs", "description": "VS q4h, neuro checks q4h if applicable"},
                {"type": "medication", "description": "DVT prophylaxis per protocol"},
                {"type": "medication", "description": "Pain management per service"},
                {"type": "lab", "description": "CBC, BMP POD1"},
                {"type": "wound", "description": "Wound checks daily, dressing change POD2"}
            ]
        }),
        serde_json::json!({
            "id": "OS-ASTHMA",
            "name": "Acute Asthma Exacerbation",
            "category": "Pulmonology",
            "orders": [
                {"type": "medication", "description": "Albuterol 2.5mg nebulizer q20min x3"},
                {"type": "medication", "description": "Ipratropium 0.5mg nebulizer x1"},
                {"type": "medication", "description": "Methylprednisolone 125mg IV x1"},
                {"type": "lab", "description": "ABG if severe, peak flow before/after"},
                {"type": "vital_signs", "description": "VS q15min during treatment"},
                {"type": "monitoring", "description": "Continuous pulse ox"},
                {"type": "imaging", "description": "CXR if first episode or concern for PNA"}
            ]
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "order_sets": order_sets,
        "total": order_sets.len()
    }))
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
        "notifications": notifications,
        "count": notifications.len(),
        "unread": notifications.len()
    }))
}

// ============================================================================
// MEDICATION REMINDERS (for patients)
// ============================================================================

/// Get medication reminders for a patient
#[get("/api/medication-reminders/{patient_id}")]
pub async fn get_medication_reminders(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

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

    // Patients can only see their own, healthcare providers can see any
    if !current_user.role.can_view_medical_records() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient profile for current medications from repository
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => Some(p),
        Err(_) => None,
    };

    // TODO: Phase 2: Chronic medications should be fetched from repository
    let medications: Vec<String> = Vec::new();

    // Generate reminders based on medication names (simplified)
    let reminders: Vec<_> = medications
        .iter()
        .enumerate()
        .map(|(i, med)| {
            serde_json::json!({
                "id": format!("rem-{}", i),
                "medication": med,
                "schedule": if med.to_lowercase().contains("daily") {
                    vec!["08:00"]
                } else if med.to_lowercase().contains("bid") {
                    vec!["08:00", "20:00"]
                } else if med.to_lowercase().contains("tid") {
                    vec!["08:00", "14:00", "20:00"]
                } else {
                    vec!["08:00"]
                },
                "next_due": "08:00",
                "last_taken": serde_json::Value::Null,
                "refill_due": false
            })
        })
        .collect();

    // Get MAR records for history from repository
    let pagination = Pagination::new(0, 5);
    let mar_history: Vec<_> = match data
        .repositories
        .medication_records
        .get_by_patient(&patient_id, None, pagination)
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "medications": medications,
        "reminders": reminders,
        "administration_history": mar_history,
        "total_medications": medications.len()
    }))
}

// ============================================================================
// NURSE TASK LIST
// ============================================================================

/// Get task list for nurses
#[get("/api/tasks/nurse")]
pub async fn get_nurse_tasks(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(current_user.role, crate::Role::Nurse | crate::Role::Admin) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Nurse task list requires Nurse or Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let now = chrono::Utc::now();
    let mut tasks = Vec::new();

    // Vital signs tasks - Use repository for patient list
    {
        let pagination = Pagination::new(0, 100);
        let patients = match data.repositories.patients.list(pagination).await {
            Ok(res) => res.items,
            Err(_) => Vec::new(),
        };
        for patient in patients {
            tasks.push(serde_json::json!({
                "id": format!("vs-{}", patient.id),
                "type": "vital_signs",
                "patient_id": patient.id,
                "patient_name": "Patient", // Name is encrypted, would need decryption
                "description": "Vital signs check due",
                "due_time": now.timestamp() + 3600, // 1 hour from now
                "priority": "routine",
                "completed": false
            }));
        }
    }

    // Medication administration tasks - Use repository
    {
        let pagination = Pagination::new(0, 10);
        let mars = match data
            .repositories
            .medication_records
            .list_all(pagination)
            .await
        {
            Ok(res) => res.items,
            Err(_) => Vec::new(),
        };
        for mar in mars {
            if let Some(scheduled) = mar.scheduled_medications.as_array() {
                for med_val in scheduled {
                    let med_name = med_val
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown");
                    tasks.push(serde_json::json!({
                        "id": format!("med-{}-{}", mar.patient_id, med_name),
                        "type": "medication",
                        "patient_id": mar.patient_id,
                        "description": format!("Administer {}", med_name),
                        "due_time": now.timestamp() + 1800, // 30 min from now
                        "priority": "high",
                        "completed": false
                    }));
                }
            }
        }
    }

    // Wound care tasks - Use repository
    {
        let wounds = match data
            .repositories
            .wound_assessments
            .list_all(Pagination::new(0, 5))
            .await
        {
            Ok(res) => res.items,
            Err(_) => Vec::new(),
        };
        for wound in wounds.iter().take(5) {
            tasks.push(serde_json::json!({
                "id": format!("wound-{}", wound.id),
                "type": "wound_care",
                "patient_id": wound.patient_id,
                "description": format!("Wound assessment - {}", wound.wound_id),
                "due_time": now.timestamp() + 7200, // 2 hours
                "priority": "medium",
                "completed": false
            }));
        }
    }

    // IV checks - Use repository (sites needing attention)
    {
        let ivs = data
            .repositories
            .iv_assessments
            .get_sites_needing_attention()
            .await
            .unwrap_or_default();
        for iv in ivs.iter().take(5) {
            tasks.push(serde_json::json!({
                "id": format!("iv-{}", iv.id),
                "type": "iv_check",
                "patient_id": iv.patient_id,
                "description": format!("IV site check - {}", iv.site_id),
                "due_time": now.timestamp() + 14400, // 4 hours
                "priority": "routine",
                "completed": false
            }));
        }
    }

    // Sort by due time
    tasks.sort_by(|a, b| {
        let time_a = a.get("due_time").and_then(|t| t.as_i64()).unwrap_or(0);
        let time_b = b.get("due_time").and_then(|t| t.as_i64()).unwrap_or(0);
        time_a.cmp(&time_b)
    });

    HttpResponse::Ok().json(serde_json::json!({
        "tasks": tasks,
        "total": tasks.len(),
        "overdue": tasks.iter().filter(|t| {
            t.get("due_time").and_then(|d| d.as_i64()).unwrap_or(0) < now.timestamp()
        }).count()
    }))
}

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
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

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

    // Patients can only see their own, providers can see any
    if !current_user.role.can_view_medical_records() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient's chronic conditions for context from repository
    // TODO: Phase 2: Chronic conditions should be fetched from repository
    let chronic_conditions: Vec<String> = Vec::new();

    // Generate sample symptom history based on chronic conditions from repository
    let pagination = Pagination::new(0, 50);
    let symptom_entries: Vec<_> = match data
        .repositories
        .sample_history
        .get_by_patient(&patient_id, pagination)
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

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
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
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

    let folder = query.get("folder").map(|s| s.as_str()).unwrap_or("inbox");

    // Generate sample messages based on role
    let messages: Vec<serde_json::Value> = if matches!(current_user.role, crate::Role::Patient) {
        vec![
            serde_json::json!({
                "message_id": "MSG-001",
                "sender_id": "PROVIDER-SAMPLE-001",
                "sender_name": "Dr. Sample",
                "sender_role": "Doctor",
                "subject": "Your lab results are ready",
                "preview": "Your recent blood work shows improvement...",
                "sent_at": chrono::Utc::now().timestamp() - 3600,
                "read": false,
                "priority": "normal"
            }),
            serde_json::json!({
                "message_id": "MSG-002",
                "sender_id": "PROVIDER-SAMPLE-002",
                "sender_name": "Nurse Sample",
                "sender_role": "Nurse",
                "subject": "Appointment reminder",
                "preview": "This is a reminder for your appointment tomorrow...",
                "sent_at": chrono::Utc::now().timestamp() - 86400,
                "read": true,
                "priority": "normal"
            }),
        ]
    } else {
        vec![
            serde_json::json!({
                "message_id": "MSG-003",
                "sender_id": "PATIENT-SAMPLE-001",
                "sender_name": "Patient Sample",
                "sender_role": "Patient",
                "subject": "Question about medication",
                "preview": "I've been experiencing some side effects...",
                "sent_at": chrono::Utc::now().timestamp() - 1800,
                "read": false,
                "priority": "high"
            }),
            serde_json::json!({
                "message_id": "MSG-004",
                "sender_id": "PROVIDER-SAMPLE-003",
                "sender_name": "Dr. Colleague",
                "sender_role": "Doctor",
                "subject": "Consult request",
                "preview": "I'd like your opinion on a patient case...",
                "sent_at": chrono::Utc::now().timestamp() - 7200,
                "read": false,
                "priority": "normal"
            }),
        ]
    };

    HttpResponse::Ok().json(serde_json::json!({
        "folder": folder,
        "messages": messages,
        "unread_count": messages.iter().filter(|m| !m.get("read").and_then(|r| r.as_bool()).unwrap_or(true)).count(),
        "total": messages.len()
    }))
}

// ============================================================================
// CONSENT FORMS MANAGEMENT
// ============================================================================

/// Available consent form types
#[get("/api/consent/types")]
pub async fn get_consent_types(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let consent_types = vec![
        serde_json::json!({
            "type_id": "CONSENT-TREATMENT",
            "name": "General Treatment Consent",
            "description": "Consent for general medical treatment and care",
            "required_for": ["admission", "outpatient"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-SURGERY",
            "name": "Surgical Consent",
            "description": "Consent for surgical procedures",
            "required_for": ["surgery"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-ANESTHESIA",
            "name": "Anesthesia Consent",
            "description": "Consent for anesthesia administration",
            "required_for": ["surgery"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-BLOOD",
            "name": "Blood Transfusion Consent",
            "description": "Consent for blood product transfusion",
            "required_for": ["transfusion"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-HIPAA",
            "name": "HIPAA Privacy Notice",
            "description": "Acknowledgment of privacy practices",
            "required_for": ["admission"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-RESEARCH",
            "name": "Research Participation Consent",
            "description": "Consent for participation in clinical research",
            "required_for": ["research"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-TELEMEDICINE",
            "name": "Telemedicine Consent",
            "description": "Consent for virtual/remote care",
            "required_for": ["telemedicine"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-IMAGING",
            "name": "Imaging/Radiology Consent",
            "description": "Consent for diagnostic imaging procedures",
            "required_for": ["imaging"],
            "expires_after_days": 30
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "consent_types": consent_types,
        "total": consent_types.len()
    }))
}

/// Sign a consent form
#[post("/api/consent/sign")]
pub async fn sign_consent(
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

    let patient_id = body
        .get("patient_id")
        .and_then(|p| p.as_str())
        .map(|s| s.to_string())
        .unwrap_or(current_user_id.clone());

    let consent_type = match body.get("consent_type").and_then(|c| c.as_str()) {
        Some(c) => c,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "consent_type is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let witness_id = body.get("witness_id").and_then(|w| w.as_str());
    let procedure_description = body.get("procedure_description").and_then(|p| p.as_str());

    let consent_id = format!(
        "CSNT-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Generate signature hash (in production: use actual digital signature)
    let signature_hash = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        format!(
            "{}{}{}",
            patient_id,
            consent_type,
            chrono::Utc::now().timestamp()
        )
        .hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    };

    let signed_consent = serde_json::json!({
        "consent_id": consent_id,
        "patient_id": patient_id,
        "consent_type": consent_type,
        "procedure_description": procedure_description,
        "signed_by": current_user_id,
        "signer_name": current_user.username,
        "signer_role": current_user.role.to_string(),
        "witness_id": witness_id,
        "signature_hash": signature_hash,
        "signed_at": chrono::Utc::now().timestamp(),
        "valid_until": chrono::Utc::now().timestamp() + (30 * 24 * 60 * 60), // 30 days
        "status": "active",
        "ip_address": "127.0.0.1", // In production: actual IP
        "device_info": "MediChain API"
    });

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: "sign_consent".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "consent": signed_consent,
        "message": "Consent form signed successfully"
    }))
}

/// Get patient's consent forms
#[get("/api/consent/patient/{patient_id}")]
pub async fn get_patient_consents(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

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

    // Patients can only see their own, providers can see any
    if !current_user.role.can_view_medical_records() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Sample consents for demo
    let consents = vec![
        serde_json::json!({
            "consent_id": "CSNT-001",
            "consent_type": "CONSENT-TREATMENT",
            "signed_at": chrono::Utc::now().timestamp() - 86400 * 30,
            "valid_until": chrono::Utc::now().timestamp() + 86400 * 335,
            "status": "active"
        }),
        serde_json::json!({
            "consent_id": "CSNT-002",
            "consent_type": "CONSENT-HIPAA",
            "signed_at": chrono::Utc::now().timestamp() - 86400 * 30,
            "valid_until": chrono::Utc::now().timestamp() + 86400 * 335,
            "status": "active"
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "consents": consents,
        "total": consents.len()
    }))
}

// ============================================================================
// BARCODE/SAMPLE TRACKING (Simulation)
// ============================================================================

/// Generate a barcode for specimen tracking
#[post("/api/barcode/generate")]
pub async fn generate_barcode(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let entity_type = body
        .get("entity_type")
        .and_then(|e| e.as_str())
        .unwrap_or("specimen");
    let entity_id = body
        .get("entity_id")
        .and_then(|e| e.as_str())
        .unwrap_or("UNKNOWN");
    let patient_id = body.get("patient_id").and_then(|p| p.as_str());

    let barcode_id = format!(
        "BC-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .replace("-", "")
            .chars()
            .take(12)
            .collect::<String>()
            .to_uppercase()
    );

    // Generate barcode value (Code 128 compatible)
    let barcode_value = format!(
        "MC{}{:06}",
        match entity_type {
            "specimen" => "SP",
            "medication" => "MED",
            "patient" => "PAT",
            "equipment" => "EQ",
            _ => "XX",
        },
        chrono::Utc::now().timestamp() % 1000000
    );

    let barcode = serde_json::json!({
        "barcode_id": barcode_id,
        "barcode_value": barcode_value,
        "barcode_type": "CODE128",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "patient_id": patient_id,
        "generated_by": current_user.wallet_address,
        "generated_at": chrono::Utc::now().timestamp(),
        "status": "active",
        "scan_count": 0
    });

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "barcode": barcode,
        "message": "Barcode generated successfully"
    }))
}

/// Scan a barcode and get entity information
#[post("/api/barcode/scan")]
pub async fn scan_barcode(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let barcode_value = match body.get("barcode_value").and_then(|b| b.as_str()) {
        Some(b) => b,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "barcode_value is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let location = body
        .get("location")
        .and_then(|l| l.as_str())
        .unwrap_or("Unknown");

    // Parse barcode to determine type
    let entity_type = if barcode_value.starts_with("MCSP") {
        "specimen"
    } else if barcode_value.starts_with("MCMED") {
        "medication"
    } else if barcode_value.starts_with("MCPAT") {
        "patient"
    } else if barcode_value.starts_with("MCEQ") {
        "equipment"
    } else {
        "unknown"
    };

    let scan_result = serde_json::json!({
        "barcode_value": barcode_value,
        "entity_type": entity_type,
        "scan_time": chrono::Utc::now().timestamp(),
        "scanned_by": current_user.wallet_address,
        "scanned_by_role": current_user.role.to_string(),
        "location": location,
        "status": "valid",
        "entity_info": match entity_type {
            "specimen" => serde_json::json!({
                "specimen_type": "Blood",
                "collection_time": chrono::Utc::now().timestamp() - 3600,
                "tests_ordered": ["CBC", "BMP"],
                "status": "In Transit"
            }),
            "medication" => serde_json::json!({
                "medication_name": "Metformin 500mg",
                "lot_number": "LOT-2026-001",
                "expiry_date": "2027-12-31",
                "status": "Available"
            }),
            "patient" => serde_json::json!({
                "patient_name": "Verified Patient",
                "room": "Room 101",
                "allergies": ["Penicillin"],
                "status": "Admitted"
            }),
            _ => serde_json::json!({"status": "Unknown barcode format"})
        }
    });

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "scan_result": scan_result,
        "message": "Barcode scanned successfully"
    }))
}

/// Get tracking history for a barcode
#[get("/api/barcode/track/{barcode_value}")]
pub async fn track_barcode(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let barcode_value = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Sample tracking history
    let tracking_history = vec![
        serde_json::json!({
            "event": "Generated",
            "timestamp": chrono::Utc::now().timestamp() - 7200,
            "location": "Lab Reception",
            "user": "LAB-TECH-SAMPLE-001"
        }),
        serde_json::json!({
            "event": "Collected",
            "timestamp": chrono::Utc::now().timestamp() - 6000,
            "location": "Room 101",
            "user": "NURSE-SAMPLE-001"
        }),
        serde_json::json!({
            "event": "Received at Lab",
            "timestamp": chrono::Utc::now().timestamp() - 3600,
            "location": "Main Laboratory",
            "user": "LAB-TECH-SAMPLE-001"
        }),
        serde_json::json!({
            "event": "Processing",
            "timestamp": chrono::Utc::now().timestamp() - 1800,
            "location": "Hematology Section",
            "user": "LAB-TECH-SAMPLE-001"
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "barcode_value": barcode_value,
        "tracking_history": tracking_history,
        "current_status": "Processing",
        "current_location": "Hematology Section",
        "total_scans": tracking_history.len()
    }))
}

/// Get user's barcode scan history
#[get("/api/barcode/scan-history")]
pub async fn get_barcode_scan_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Return sample scan history for the user
    // In a production system, this would query the database for actual scan records
    let scan_history: Vec<serde_json::Value> = vec![
        serde_json::json!({
            "id": format!("SCAN-{}", uuid::Uuid::new_v4()),
            "type": "patient",
            "barcode": "MCPAT-12345-001",
            "name": "John Smith",
            "details": "Room 101 - Admitted",
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "result": "success",
            "message": "Patient verified"
        }),
        serde_json::json!({
            "id": format!("SCAN-{}", uuid::Uuid::new_v4()),
            "type": "medication",
            "barcode": "MCMED-500-MET",
            "name": "Metformin 500mg",
            "details": "Lot: LOT-2026-001",
            "timestamp": (chrono::Utc::now() - chrono::Duration::hours(2)).to_rfc3339(),
            "result": "success",
            "message": "Medication verified"
        }),
        serde_json::json!({
            "id": format!("SCAN-{}", uuid::Uuid::new_v4()),
            "type": "specimen",
            "barcode": "MCSP-CBC-001",
            "name": "Blood Sample CBC",
            "details": "Collection pending",
            "timestamp": (chrono::Utc::now() - chrono::Duration::hours(4)).to_rfc3339(),
            "result": "success",
            "message": "Specimen tracked"
        }),
    ];

    HttpResponse::Ok().json(scan_history)
}

// ============================================================================
// QUICK NOTE TEMPLATES
// ============================================================================

/// Get available note templates
#[get("/api/templates/notes")]
pub async fn get_note_templates(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let templates = vec![
        // SOAP Note Templates
        serde_json::json!({
            "template_id": "TPL-SOAP-ROUTINE",
            "name": "Routine Follow-up SOAP",
            "category": "SOAP",
            "content": {
                "subjective": "Patient presents for routine follow-up. Reports [SYMPTOMS]. Denies [NEGATIVE_SYMPTOMS]. Medications are being taken as prescribed.",
                "objective": "VS: BP [BP], HR [HR], RR [RR], Temp [TEMP], SpO2 [SPO2]. General: Alert and oriented, no acute distress. [SYSTEM_EXAM]",
                "assessment": "1. [PRIMARY_DIAGNOSIS] - [STATUS]\n2. [SECONDARY_DIAGNOSIS] - [STATUS]",
                "plan": "1. Continue current medications\n2. [ADDITIONAL_ORDERS]\n3. Follow-up in [TIMEFRAME]"
            }
        }),
        serde_json::json!({
            "template_id": "TPL-SOAP-ED",
            "name": "Emergency Department SOAP",
            "category": "SOAP",
            "content": {
                "subjective": "Chief Complaint: [CC]\nHPI: [AGE] y/o [SEX] presents with [SYMPTOMS] x [DURATION]. Onset: [ONSET]. Quality: [QUALITY]. Severity: [SEVERITY]/10. Associated symptoms: [ASSOCIATED]. Denies: [PERTINENT_NEGATIVES].",
                "objective": "VS: BP [BP], HR [HR], RR [RR], Temp [TEMP], SpO2 [SPO2]\nGeneral: [GENERAL]\nHEENT: [HEENT]\nCardio: [CARDIO]\nPulm: [PULM]\nAbd: [ABD]\nExt: [EXT]\nNeuro: [NEURO]",
                "assessment": "1. [DIAGNOSIS] - [DIFFERENTIAL_CONSIDERATIONS]",
                "plan": "1. [WORKUP]\n2. [TREATMENT]\n3. [DISPOSITION]"
            }
        }),
        // H&P Templates
        serde_json::json!({
            "template_id": "TPL-HP-ADMISSION",
            "name": "Admission H&P",
            "category": "H&P",
            "content": {
                "chief_complaint": "[CC]",
                "hpi": "[AGE] y/o [SEX] with PMH of [PMH] presenting with [SYMPTOMS]...",
                "pmh": "[PMH_LIST]",
                "psh": "[SURGICAL_HISTORY]",
                "medications": "[MEDICATION_LIST]",
                "allergies": "[ALLERGY_LIST]",
                "social_history": "Smoking: [SMOKING]\nAlcohol: [ALCOHOL]\nDrugs: [DRUGS]\nOccupation: [OCCUPATION]",
                "family_history": "[FAMILY_HISTORY]",
                "ros": "Constitutional: [CONST]\nCardiovascular: [CV]\nRespiratory: [RESP]\nGI: [GI]\nGU: [GU]\nMSK: [MSK]\nNeuro: [NEURO]\nPsych: [PSYCH]",
                "physical_exam": "[EXAM_FINDINGS]",
                "assessment_plan": "[ASSESSMENT_AND_PLAN]"
            }
        }),
        // Procedure Notes
        serde_json::json!({
            "template_id": "TPL-PROC-CENTRAL",
            "name": "Central Line Procedure Note",
            "category": "Procedure",
            "content": {
                "procedure": "Central Venous Catheter Placement",
                "indication": "[INDICATION]",
                "consent": "Informed consent obtained",
                "site": "[SITE] - [IJ/SC/FEMORAL]",
                "technique": "Sterile technique with full barrier precautions. Ultrasound-guided. Local anesthesia with [LIDOCAINE_DOSE]. [CATHETER_TYPE] catheter placed using Seldinger technique. [ATTEMPTS] attempt(s). Blood aspirated from all ports. Catheter secured at [CM] cm.",
                "complications": "[NONE/COMPLICATIONS]",
                "post_procedure": "CXR ordered for placement confirmation",
                "attending": "[ATTENDING_NAME]"
            }
        }),
        serde_json::json!({
            "template_id": "TPL-PROC-LP",
            "name": "Lumbar Puncture Procedure Note",
            "category": "Procedure",
            "content": {
                "procedure": "Lumbar Puncture",
                "indication": "[INDICATION]",
                "consent": "Informed consent obtained",
                "position": "[LATERAL_DECUBITUS/SITTING]",
                "site": "[L3-L4/L4-L5]",
                "technique": "Sterile technique. Local anesthesia with [LIDOCAINE]. [NEEDLE_SIZE] spinal needle. Opening pressure: [OP] cm H2O. [VOLUME] mL CSF collected in [TUBES] tubes.",
                "csf_appearance": "[CLEAR/CLOUDY/BLOODY/XANTHOCHROMIC]",
                "closing_pressure": "[CP] cm H2O",
                "complications": "[NONE/COMPLICATIONS]",
                "post_procedure": "Patient instructed to remain supine for [DURATION]"
            }
        }),
        // Discharge Templates
        serde_json::json!({
            "template_id": "TPL-DC-STANDARD",
            "name": "Standard Discharge Summary",
            "category": "Discharge",
            "content": {
                "admission_date": "[ADMIT_DATE]",
                "discharge_date": "[DC_DATE]",
                "admitting_diagnosis": "[ADMIT_DX]",
                "discharge_diagnoses": "[DC_DX_LIST]",
                "procedures": "[PROCEDURES_LIST]",
                "hospital_course": "[COURSE_SUMMARY]",
                "discharge_medications": "[DC_MEDS]",
                "discharge_instructions": "[INSTRUCTIONS]",
                "follow_up": "[FOLLOW_UP_APPOINTMENTS]",
                "pending_results": "[PENDING_LABS_IMAGING]"
            }
        }),
        // Consultation Templates
        serde_json::json!({
            "template_id": "TPL-CONSULT-CARDIO",
            "name": "Cardiology Consult",
            "category": "Consult",
            "content": {
                "reason_for_consult": "[REASON]",
                "hpi": "[CARDIAC_HPI]",
                "cardiac_history": "[CARDIAC_PMH]",
                "risk_factors": "HTN: [Y/N], DM: [Y/N], Smoking: [Y/N], Dyslipidemia: [Y/N], Family Hx: [Y/N]",
                "current_meds": "[CARDIAC_MEDS]",
                "exam": "VS: [VS]\nJVP: [JVP]\nCarotids: [CAROTIDS]\nHeart: [HEART_EXAM]\nLungs: [LUNG_EXAM]\nExt: [EXTREMITIES]",
                "ecg": "[ECG_FINDINGS]",
                "echo": "[ECHO_FINDINGS]",
                "impression": "[IMPRESSION]",
                "recommendations": "[RECOMMENDATIONS]"
            }
        }),
        // Progress Note Templates
        serde_json::json!({
            "template_id": "TPL-PROG-ICU",
            "name": "ICU Progress Note",
            "category": "Progress",
            "content": {
                "events_overnight": "[OVERNIGHT_EVENTS]",
                "neuro": "GCS: [GCS], Sedation: [RASS], Pain: [CPOT]",
                "cardiovascular": "HR: [HR], BP: [BP], MAP: [MAP], Pressors: [PRESSORS], CVP: [CVP]",
                "respiratory": "Vent Mode: [MODE], FiO2: [FIO2], PEEP: [PEEP], TV: [TV], RR: [RR], SpO2: [SPO2], ABG: [ABG]",
                "renal_fluids": "I/O: [IO], UOP: [UOP], Cr: [CR], BUN: [BUN]",
                "gi_nutrition": "Diet: [DIET], Bowel: [BOWEL], Feeds: [FEEDS]",
                "heme": "Hgb: [HGB], Plt: [PLT], INR: [INR], Anticoag: [ANTICOAG]",
                "id": "Temp: [TEMP], WBC: [WBC], Abx: [ABX], Cultures: [CULTURES]",
                "skin": "[SKIN_ASSESSMENT]",
                "lines_tubes_drains": "[LINES_TUBES]",
                "assessment_plan": "[AP_BY_PROBLEM]"
            }
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "templates": templates,
        "total": templates.len(),
        "categories": ["SOAP", "H&P", "Procedure", "Discharge", "Consult", "Progress"]
    }))
}

/// Create a note from template
#[post("/api/templates/notes/use")]
pub async fn use_note_template(
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let template_id = match body.get("template_id").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "template_id is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let patient_id = match body.get("patient_id").and_then(|p| p.as_str()) {
        Some(p) => p,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "patient_id is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let replacements = body.get("replacements").and_then(|r| r.as_object());

    let note_id = format!(
        "NOTE-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    let created_note = serde_json::json!({
        "note_id": note_id,
        "template_id": template_id,
        "patient_id": patient_id,
        "created_by": current_user_id,
        "created_at": chrono::Utc::now().timestamp(),
        "status": "draft",
        "replacements_applied": replacements.is_some(),
        "message": "Note created from template. Fill in placeholders and save."
    });

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: patient_id.to_string(),
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: "create_note_from_template".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "note": created_note
    }))
}
