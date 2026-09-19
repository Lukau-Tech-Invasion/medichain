//! `clinical_endpoints::physician::orders` — Phase 8 physician order handlers.
//!
//! Split out of the former single-file `physician.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `physician/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// PHASE 8: PHYSICIAN DOCUMENTATION ENDPOINTS
// ============================================================================

/// Create physician order
/// What the orders form actually submits.
///
/// The clinical `PhysicianOrder` type is a much larger structure than the order
/// form fills in, and the handler populated only the `data` blob via
/// `..Default::default()` - leaving ordering_provider_id, order_datetime,
/// order_type, priority, status and order_details empty even though all six are
/// NOT NULL, so every order failed to insert.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateOrderRequest {
    pub patient_id: String,
    #[serde(alias = "order_type")]
    pub category: String,
    #[serde(alias = "order_details")]
    pub order_text: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub frequency: Option<String>,
    #[serde(default)]
    pub cosign_required: bool,
}

#[post("/api/clinical/order")]
pub async fn create_order(
    data: web::Data<AppState>,
    req: web::Json<CreateOrderRequest>,
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

    let record = req.into_inner();
    if record.patient_id.trim().is_empty() || record.order_text.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id and order details are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&record.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", record.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    // The form sends a display label ("Laboratory"), while the column's CHECK
    // constraint accepts the clinical vocabulary ("lab"). Sending the label
    // through unmapped violated the constraint and lost the order.
    let order_type = match record.category.trim().to_lowercase().as_str() {
        "laboratory" | "lab" => "lab",
        "medication" | "medications" => "medication",
        "imaging" | "radiology" => "imaging",
        "consult" | "consultation" => "consult",
        "procedure" => "procedure",
        "nursing" => "nursing",
        "diet" => "diet",
        "activity" => "activity",
        _ => "other",
    }
    .to_string();
    let priority = match record.priority.trim().to_lowercase().as_str() {
        "stat" => "stat",
        "asap" => "asap",
        "urgent" => "urgent",
        "prn" => "prn",
        _ => "routine",
    }
    .to_string();

    let now = Utc::now();
    let order_id = format!("ORD-{}", uuid::Uuid::new_v4().simple());
    let entity = PhysicianOrderEntity {
        id: order_id.clone(),
        patient_id: record.patient_id.clone(),
        ordering_provider_id: current_user.wallet_address.clone(),
        order_datetime: now,
        order_type,
        priority,
        status: "pending".to_string(),
        order_details: serde_json::json!({ "text": record.order_text.trim() }),
        indication: record.instructions.clone(),
        diagnosis_codes: None,
        start_datetime: Some(now),
        end_datetime: None,
        frequency: record.frequency.clone(),
        duration: None,
        special_instructions: record.instructions.clone(),
        requires_cosign: record.cosign_required,
        cosigned_by: None,
        cosigned_at: None,
        verified_by: None,
        verified_at: None,
        executed_by: None,
        executed_at: None,
        discontinued_by: None,
        discontinued_at: None,
        discontinue_reason: None,
        linked_order_id: None,
        notes: record.instructions.clone(),
        created_at: now,
        updated_at: now,
        data: serde_json::to_value(&record).unwrap_or_default(),
    };

    match data.repositories.physician_orders.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "order_id": order_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("physician order persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the order".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

#[get("/api/clinical/order/{order_id}")]
pub async fn get_order(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let order_id = path.into_inner();

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

    match data
        .repositories
        .physician_orders
        .get_by_id(&order_id)
        .await
    {
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Physician order not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Request body for updating a physician order's status.
#[derive(serde::Deserialize)]
pub struct UpdateOrderStatusRequest {
    pub status: String,
}

/// Convert UI and API status spellings into the database lifecycle vocabulary.
fn canonical_order_status(status: &str) -> Option<&'static str> {
    match status
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' '], "_")
        .as_str()
    {
        "pending" => Some("pending"),
        // The portal historically called this `in_progress`; the database and
        // all durable readers call the same state `active`.
        "in_progress" | "active" => Some("active"),
        "completed" => Some("completed"),
        "discontinued" => Some("discontinued"),
        "cancelled" => Some("cancelled"),
        "on_hold" => Some("on_hold"),
        _ => None,
    }
}

/// Update a physician order's durable lifecycle status (doctor-portal OrdersPage).
///
/// The typed `status` column is the source of truth. The legacy JSON payload is
/// updated as a compatibility mirror, and completion time is stamped there for
/// readers that still need it. Edit-medical-records role required.
#[actix_web::put("/api/clinical/orders/{order_id}/status")]
pub async fn update_order_status(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<UpdateOrderStatusRequest>,
) -> impl Responder {
    let order_id = path.into_inner();
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
    let new_status = body.status.trim().to_string();
    if new_status.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "status is required".to_string(),
            code: "INVALID_STATUS".to_string(),
        });
    }
    let mut entity = match data
        .repositories
        .physician_orders
        .get_by_id(&order_id)
        .await
    {
        Ok(e) => e,
        Err(RepositoryError::NotFound(_)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Physician order not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: e.to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    };
    // The COLUMN is what every reader uses.
    //
    // This used to write the new status only into the `data` blob, and
    // `list_orders` reads `entity.status` — with a comment right there saying
    // `data` is always null on PostgreSQL. So the endpoint answered
    // `{"success": true, "status": "completed"}` and the order stayed
    // `pending` on the ward list forever, which is how two clinicians action
    // one order twice.
    //
    // Normalised to the vocabulary the CHECK permits (`pending`, `active`,
    // `completed`, `discontinued`, `cancelled`, `on_hold`): `OrdersPage` sends
    // "Completed" with a capital, and the constraint is lowercase.
    let canonical_status = match canonical_order_status(&new_status) {
        Some(status) => status.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Unsupported order status".to_string(),
                code: "INVALID_STATUS".to_string(),
            });
        }
    };
    entity.status = canonical_status.clone();
    if let Some(obj) = entity.data.as_object_mut() {
        obj.insert(
            "status".to_string(),
            serde_json::Value::String(canonical_status.clone()),
        );
        if canonical_status == "completed" {
            obj.insert(
                "completed_at".to_string(),
                serde_json::json!(Utc::now().timestamp_millis()),
            );
        }
    }
    entity.updated_at = Utc::now();
    match data.repositories.physician_orders.update(entity).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "order_id": order_id,
            "status": canonical_status
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[cfg(test)]
mod order_status_tests {
    use super::canonical_order_status;

    #[test]
    fn maps_legacy_in_progress_to_the_persisted_active_state() {
        assert_eq!(canonical_order_status("In Progress"), Some("active"));
        assert_eq!(canonical_order_status("active"), Some("active"));
    }

    #[test]
    fn rejects_statuses_outside_the_order_lifecycle() {
        assert_eq!(canonical_order_status("ready"), None);
        assert_eq!(canonical_order_status(""), None);
    }
}

/// List all physician orders (for NursingPage and OrdersPage)
#[get("/api/clinical/orders")]
pub async fn list_orders(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
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

    let pagination = Pagination::new(0, 100);
    match data
        .repositories
        .physician_orders
        .get_by_patient("all", pagination)
        .await
    {
        Ok(result) => {
            // `data` is `#[sqlx(skip)]`, so it is always null when read back -
            // mapping to it returned a list of nulls once any order existed.
            // Project the typed columns the page actually renders instead.
            let order_list: Vec<serde_json::Value> = result
                .items
                .into_iter()
                .map(|e| {
                    serde_json::json!({
                        "order_id": e.id,
                        "patient_id": e.patient_id,
                        "order_type": e.order_type,
                        "order_details": e
                            .order_details
                            .get("text")
                            .and_then(|t| t.as_str())
                            .unwrap_or_default(),
                        "priority": e.priority,
                        "status": e.status,
                        "notes": e.notes,
                        "ordering_provider": e.ordering_provider_id,
                        "ordered_at": e.order_datetime.to_rfc3339(),
                    })
                })
                .collect();
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "orders": order_list
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
