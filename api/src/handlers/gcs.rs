use super::*;

// ----------------------------------------------------------------------------
// Glasgow Coma Scale Endpoints
// ----------------------------------------------------------------------------

/// Request body for creating a GCS assessment
#[derive(Debug, Deserialize)]
pub struct CreateGCSRequest {
    pub patient_id: String,
    pub eye_response: u8,
    pub verbal_response: u8,
    pub motor_response: u8,
    pub pupil_assessment: Option<crate::clinical::PupilAssessment>,
    pub notes: Option<String>,
}

/// Response for GCS assessment
#[derive(Debug, Serialize)]
pub struct GCSResponse {
    pub success: bool,
    pub assessment_id: String,
    pub total_score: u8,
    pub interpretation: String,
    pub is_comatose: bool,
    pub needs_airway: bool,
    pub message: String,
}

/// Create a new GCS assessment
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/clinical/gcs")]
pub async fn create_gcs_assessment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateGCSRequest>,
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
            error: format!(
                "Role '{}' cannot create GCS assessments. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Input validation
    if let Err(e) =
        validation::validate_string_length(&req.patient_id, "patient_id", validation::MAX_ID_LENGTH)
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e,
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    // Verify patient exists
    {
        if data
            .repositories
            .patients
            .get_by_id(&req.patient_id)
            .await
            .is_err()
        {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    }

    // Parse response scores
    let eye = match crate::clinical::EyeResponse::from_score(req.eye_response) {
        Some(e) => e,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Eye response must be 1-4".to_string(),
                code: "INVALID_EYE_RESPONSE".to_string(),
            });
        }
    };

    let verbal = match crate::clinical::VerbalResponse::from_score(req.verbal_response) {
        Some(v) => v,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Verbal response must be 1-5".to_string(),
                code: "INVALID_VERBAL_RESPONSE".to_string(),
            });
        }
    };

    let motor = match crate::clinical::MotorResponse::from_score(req.motor_response) {
        Some(m) => m,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Motor response must be 1-6".to_string(),
                code: "INVALID_MOTOR_RESPONSE".to_string(),
            });
        }
    };

    // Generate assessment ID
    let assessment_id = format!(
        "GCS-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Create GCS assessment with auto-calculation
    let gcs = GlasgowComaScale::new(
        assessment_id.clone(),
        req.patient_id.clone(),
        eye,
        verbal,
        motor,
        req.pupil_assessment.clone(),
        req.notes.clone(),
        current_user_id.clone(),
    );

    let total_score = gcs.total_score;
    let interpretation = gcs.interpret_score().to_string();
    let is_comatose = gcs.is_comatose();
    let needs_airway = gcs.needs_airway_protection();

    // Store assessment
    let entity = GcsAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: req.patient_id.clone(),
        eye_response: req.eye_response as i32,
        verbal_response: req.verbal_response as i32,
        motor_response: req.motor_response as i32,
        total_score: total_score as i32,
        interpretation: interpretation.clone(),
        notes: None,
        pupil_assessment: req.pupil_assessment.as_ref().map(|p| serde_json::to_value(p).unwrap_or(serde_json::Value::Null)),
        assessed_by: current_user_id.clone(),
        assessed_at: Utc::now(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        facility_id: None,
    };

    if let Err(e) = data.repositories.gcs_assessments.create(entity).await {
        log::error!("Failed to store GCS assessment in repository: {}", e);
    }

    // Log access in repository
    let log_entity = AccessLogEntity {
        id: secure_tokens::generate_access_id(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        patient_id: Some(req.patient_id.clone()),
        resource_type: "gcs".to_string(),
        resource_id: Some(assessment_id.clone()),
        action: "create".to_string(),
        access_reason: Some("GCS assessment".to_string()),
        is_emergency_access: is_comatose,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: Utc::now(),
        facility_id: None,
    };

    if let Err(e) = data.repositories.access_logs.create(log_entity).await {
        log::error!("Failed to store access log in repository: {}", e);
    }

    log::info!(
        "GCS assessment {} created for patient {} - Score: {}",
        assessment_id,
        req.patient_id,
        total_score
    );

    HttpResponse::Created().json(GCSResponse {
        success: true,
        assessment_id,
        total_score,
        interpretation,
        is_comatose,
        needs_airway,
        message: format!("GCS assessment created. Total score: {}", total_score),
    })
}

/// Get a GCS assessment by ID
#[get("/api/clinical/gcs/{assessment_id}")]
pub async fn get_gcs_assessment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

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
            error: "Only healthcare providers can view GCS assessments".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.gcs_assessments.get_by_id(&assessment_id).await {
        Ok(entity) => {
            let assessment = GlasgowComaScale {
                assessment_id: entity.id,
                patient_id: entity.patient_id,
                eye_response: crate::clinical::EyeResponse::from_score(entity.eye_response as u8)
                    .unwrap_or(crate::clinical::EyeResponse::None),
                verbal_response: crate::clinical::VerbalResponse::from_score(entity.verbal_response as u8)
                    .unwrap_or(crate::clinical::VerbalResponse::None),
                motor_response: crate::clinical::MotorResponse::from_score(entity.motor_response as u8)
                    .unwrap_or(crate::clinical::MotorResponse::None),
                total_score: entity.total_score as u8,
                interpretation: entity.interpretation,
                pupil_assessment: None,
                notes: entity.notes.clone(),
                assessed_by: entity.assessed_by,
                assessed_at: entity.assessed_at.timestamp(),
            };
            HttpResponse::Ok().json(assessment)
        }
        Err(_) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("GCS assessment '{}' not found", assessment_id),
            code: "ASSESSMENT_NOT_FOUND".to_string(),
        }),
    }
}

/// Get all GCS assessments for a patient
#[get("/api/clinical/patient/{patient_id}/gcs")]
pub async fn get_patient_gcs_assessments(
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

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    match data
        .repositories
        .gcs_assessments
        .get_by_patient(&patient_id, Pagination::new(0, 50))
        .await
    {
        Ok(result) => {
            let assessments: Vec<GlasgowComaScale> = result
                .items
                .into_iter()
                .map(|entity| GlasgowComaScale {
                    assessment_id: entity.id,
                    patient_id: entity.patient_id,
                    eye_response: crate::clinical::EyeResponse::from_score(entity.eye_response as u8)
                        .unwrap_or(crate::clinical::EyeResponse::None),
                    verbal_response: crate::clinical::VerbalResponse::from_score(
                        entity.verbal_response as u8,
                    )
                    .unwrap_or(crate::clinical::VerbalResponse::None),
                    motor_response: crate::clinical::MotorResponse::from_score(entity.motor_response as u8)
                        .unwrap_or(crate::clinical::MotorResponse::None),
                    total_score: entity.total_score as u8,
                    interpretation: entity.interpretation,
                    pupil_assessment: None,
                    notes: entity.notes.clone(),
                    assessed_by: entity.assessed_by,
                    assessed_at: entity.assessed_at.timestamp(),
                })
                .collect();

            HttpResponse::Ok().json(serde_json::json!({
                "patient_id": patient_id,
                "assessments": assessments,
                "total": result.total
            }))
        }
        Err(_) => HttpResponse::Ok().json(serde_json::json!({
            "patient_id": patient_id,
            "assessments": [],
            "total": 0
        })),
    }
}

