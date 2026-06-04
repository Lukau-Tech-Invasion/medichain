use super::*;

// ----------------------------------------------------------------------------
// SAMPLE History Endpoints
// ----------------------------------------------------------------------------

/// Request body for creating/updating SAMPLE history
#[derive(Debug, Deserialize)]
pub struct CreateSAMPLEHistoryRequest {
    pub patient_id: String,
    pub signs_symptoms: Vec<String>,
    pub allergies: Vec<crate::clinical::AllergyInfo>,
    pub medications: Vec<crate::clinical::MedicationInfo>,
    pub past_medical_history: Vec<String>,
    pub last_intake: Option<crate::clinical::LastIntake>,
    pub events_leading: String,
}

/// Create SAMPLE history for a patient
/// Requires: healthcare provider role
#[post("/api/clinical/sample")]
pub async fn create_sample_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateSAMPLEHistoryRequest>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
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
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Healthcare provider role required".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }
    // Store in repository
    let entity = SampleHistoryEntity {
        id: Uuid::new_v4().to_string(),
        patient_id: req.patient_id.clone(),
        signs_symptoms: serde_json::to_value(&req.signs_symptoms)
            .unwrap_or(serde_json::Value::Array(vec![])),
        allergies_snapshot: serde_json::to_value(&req.allergies)
            .unwrap_or(serde_json::Value::Array(vec![])),
        medications: serde_json::to_value(&req.medications)
            .unwrap_or(serde_json::Value::Array(vec![])),
        past_medical_history: serde_json::to_value(&req.past_medical_history)
            .unwrap_or(serde_json::Value::Array(vec![])),
        last_intake: req
            .last_intake
            .as_ref()
            .map(|li| serde_json::to_value(li).unwrap_or(serde_json::Value::Null)),
        events_leading: req.events_leading.clone(),
        collected_by: current_user_id.clone(),
        collected_at: Utc::now(),
        facility_id: None,
        is_active: true,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    if let Err(e) = data.repositories.sample_history.create(entity).await {
        log::error!("Failed to store SAMPLE history in repository: {}", e);
    }

    // Log access in repository
    let log_entity = AccessLogEntity {
        id: secure_tokens::generate_access_id(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        patient_id: Some(req.patient_id.clone()),
        resource_type: "sample_history".to_string(),
        resource_id: None,
        action: "create".to_string(),
        access_reason: Some("SAMPLE history collection".to_string()),
        is_emergency_access: false,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: Utc::now(),
        facility_id: None,
    };

    if let Err(e) = data.repositories.access_logs.create(log_entity).await {
        log::error!("Failed to store access log in repository: {}", e);
    }
    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "patient_id": req.patient_id,
        "message": "SAMPLE history recorded"
    }))
}

/// Get SAMPLE history for a patient
#[get("/api/clinical/sample/{patient_id}")]
pub async fn get_sample_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }
    match data
        .repositories
        .sample_history
        .get_by_patient(&patient_id, Pagination::new(0, 1))
        .await
    {
        Ok(result) => {
            if let Some(entity) = result.items.first() {
                let history = crate::clinical::SAMPLEHistory {
                    patient_id: entity.patient_id.clone(),
                    signs_symptoms: serde_json::from_value(entity.signs_symptoms.clone())
                        .unwrap_or_default(),
                    allergies: serde_json::from_value(entity.allergies_snapshot.clone())
                        .unwrap_or_default(),
                    medications: serde_json::from_value(entity.medications.clone())
                        .unwrap_or_default(),
                    past_medical_history: serde_json::from_value(
                        entity.past_medical_history.clone(),
                    )
                    .unwrap_or_default(),
                    last_intake: entity
                        .last_intake
                        .as_ref()
                        .and_then(|v| serde_json::from_value(v.clone()).ok()),
                    events_leading: entity.events_leading.clone(),
                    collected_by: entity.collected_by.clone(),
                    collected_at: entity.collected_at.timestamp(),
                };
                HttpResponse::Ok().json(serde_json::json!({ "success": true, "history": history }))
            } else {
                HttpResponse::NotFound().json(ErrorResponse {
                    success: false,
                    error: format!("No SAMPLE history found for patient {}", patient_id),
                    code: "NOT_FOUND".to_string(),
                })
            }
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create autopsy request
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/clinical/autopsy/request")]
pub async fn create_autopsy_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AutopsyRequest>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let request_id = req.request_id.clone();
    {
        let mut records = data.autopsy_requests.write().unwrap();
        records.insert(request_id.clone(), req.into_inner());
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "request_id": request_id
    }))
}

/// Get autopsy request
#[get("/api/clinical/autopsy/request/{request_id}")]
pub async fn get_autopsy_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let request_id = path.into_inner();

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

    let records = data.autopsy_requests.read().unwrap();
    match records.get(&request_id) {
        Some(record) => HttpResponse::Ok().json(record),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Autopsy request not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
    }
}
