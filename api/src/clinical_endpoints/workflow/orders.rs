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

/// One of the bundles the deployment ships with. Read-only.
///
/// These used to be emitted in their own vocabulary -- `id`, `category`, and
/// orders carrying `name` and `stat` -- while the screen reads `setId`,
/// `specialty`, `description` and `priority`. So the three built-in sets
/// rendered as nameless rows with empty order lists. The page's keys win; the
/// table below is the source of the values.
struct BuiltinOrderSet {
    set_id: &'static str,
    name: &'static str,
    set_type: &'static str,
    specialty: &'static str,
    description: &'static str,
    /// (order type, description, priority)
    orders: &'static [(&'static str, &'static str, &'static str)],
}

const BUILTIN_ORDER_SETS: [BuiltinOrderSet; 3] = [
    BuiltinOrderSet {
        set_id: "os_chest_pain",
        name: "Chest Pain / ACS Protocol",
        set_type: "emergency",
        specialty: "Emergency",
        description: "Initial workup for suspected acute coronary syndrome",
        orders: &[
            ("lab", "Troponin I", "stat"),
            ("lab", "CBC", "stat"),
            ("lab", "BMP", "stat"),
            ("imaging", "CXR Portable", "stat"),
            ("medication", "Aspirin 325mg PO once", "stat"),
            ("nursing", "ECG 12-lead", "stat"),
        ],
    },
    BuiltinOrderSet {
        set_id: "os_fever_eval",
        name: "Fever Evaluation",
        set_type: "admission",
        specialty: "Inpatient",
        description: "Source workup for a febrile inpatient",
        orders: &[
            ("lab", "CBC with Diff", "routine"),
            ("lab", "Blood Culture x2", "urgent"),
            ("lab", "Urinalysis", "routine"),
            (
                "medication",
                "Acetaminophen 650mg PO q6h PRN fever >38.5C",
                "prn",
            ),
        ],
    },
    BuiltinOrderSet {
        set_id: "os_routine_wellness",
        name: "Routine Adult Wellness",
        set_type: "protocol",
        specialty: "Outpatient",
        description: "Screening panel for a routine adult visit",
        orders: &[
            ("lab", "Lipid Panel", "routine"),
            ("lab", "HbA1c", "routine"),
            ("lab", "TSH", "routine"),
        ],
    },
];

/// A built-in bundle in the shape the screen reads.
fn builtin_row(set: &BuiltinOrderSet) -> serde_json::Value {
    let orders: Vec<serde_json::Value> = set
        .orders
        .iter()
        .enumerate()
        .map(|(index, (order_type, description, priority))| {
            serde_json::json!({
                "orderId": format!("{}-O{:02}", set.set_id, index + 1),
                "type": order_type,
                "description": description,
                "priority": priority,
                "order": index + 1,
            })
        })
        .collect();
    serde_json::json!({
        "setId": set.set_id,
        "id": set.set_id,
        "name": set.name,
        "type": set.set_type,
        "specialty": set.specialty,
        "category": set.specialty,
        "description": set.description,
        "indication": "",
        "orders": orders,
        "tags": [],
        "createdBy": "MediChain",
        "usageCount": 0,
        "status": "approved",
        "isActive": true,
        "builtIn": true,
    })
}

/// Get available order sets: the built-in bundles, every approved
/// clinician-authored set, and the caller's own drafts awaiting review.
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

    // A pharmacist reviews order sets and cannot edit medical records, so the
    // edit predicate alone would hide from the reviewer the very drafts they
    // are the only person able to approve.
    if !(current_user.role.can_view_medical_records()) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let mut order_sets: Vec<serde_json::Value> =
        BUILTIN_ORDER_SETS.iter().map(builtin_row).collect();
    match super::visible_order_sets(&data, &current_user).await {
        Ok(stored) => order_sets.extend(stored),
        Err(error) => {
            log::error!("order set read failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Order sets could not be read".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "order_sets": order_sets
    }))
}
