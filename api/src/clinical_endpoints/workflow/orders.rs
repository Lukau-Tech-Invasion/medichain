use super::*;

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
            "id": "os_chest_pain",
            "name": "Chest Pain / ACS Protocol",
            "category": "Emergency",
            "orders": [
                {"type": "Lab", "name": "Troponin I", "stat": true},
                {"type": "Lab", "name": "CBC", "stat": true},
                {"type": "Lab", "name": "BMP", "stat": true},
                {"type": "Radiology", "name": "CXR Portable", "stat": true},
                {"type": "Medication", "name": "Aspirin 325mg PO once", "stat": true},
                {"type": "Procedure", "name": "ECG 12-lead", "stat": true}
            ]
        }),
        serde_json::json!({
            "id": "os_fever_eval",
            "name": "Fever Evaluation",
            "category": "Inpatient",
            "orders": [
                {"type": "Lab", "name": "CBC with Diff"},
                {"type": "Lab", "name": "Blood Culture x2"},
                {"type": "Lab", "name": "Urinalysis"},
                {"type": "Medication", "name": "Acetaminophen 650mg PO q6h PRN fever >38.5C"}
            ]
        }),
        serde_json::json!({
            "id": "os_routine_wellness",
            "name": "Routine Adult Wellness",
            "category": "Outpatient",
            "orders": [
                {"type": "Lab", "name": "Lipid Panel"},
                {"type": "Lab", "name": "HbA1c"},
                {"type": "Lab", "name": "TSH"}
            ]
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "order_sets": order_sets
    }))
}
