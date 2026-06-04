use super::*;

// ----------------------------------------------------------------------------
// Triage Assessment Endpoints
// ----------------------------------------------------------------------------

/// Request body for creating a triage assessment
#[derive(Debug, Deserialize)]
pub struct CreateTriageRequest {
    pub patient_id: String,
    pub esi_level: u8,
    pub chief_complaint: String,
    pub vital_signs: crate::clinical::TriageVitalSigns,
    pub pain_scale: Option<u8>,
    pub notes: Option<String>,
}

/// Response for triage assessment creation
#[derive(Debug, Serialize)]
pub struct CreateTriageResponse {
    pub success: bool,
    pub assessment_id: String,
    pub esi_level: u8,
    pub color_code: String,
    pub expected_wait: String,
    pub has_critical_vitals: bool,
    pub message: String,
}

/// Create a new triage assessment
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/clinical/triage")]
pub async fn create_triage_assessment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateTriageRequest>,
) -> impl Responder {
    // RBAC: Only healthcare providers who can edit records
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
                "Role '{}' cannot create triage assessments. Required: Doctor, Nurse, or Admin",
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
    if let Err(e) = validation::validate_string_length(
        &req.chief_complaint,
        "chief_complaint",
        validation::MAX_TEXT_LENGTH,
    ) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e,
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if let Err(e) = validation::validate_optional_string_length(
        &req.notes,
        "notes",
        validation::MAX_TEXT_LENGTH,
    ) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e,
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if req.chief_complaint.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "chief_complaint cannot be empty".to_string(),
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

    // Parse ESI level
    let esi_level = match ESILevel::from_level(req.esi_level) {
        Some(level) => level,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "ESI level must be 1-5".to_string(),
                code: "INVALID_ESI_LEVEL".to_string(),
            });
        }
    };

    // Validate pain scale if provided
    if let Some(pain) = req.pain_scale {
        if pain > 10 {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Pain scale must be 0-10".to_string(),
                code: "INVALID_PAIN_SCALE".to_string(),
            });
        }
    }

    // Generate assessment ID
    let assessment_id = format!(
        "TRIAGE-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Check for critical vitals
    let has_critical_vitals = req.vital_signs.has_critical_values();

    // Create triage assessment
    let assessment = TriageAssessment {
        assessment_id: assessment_id.clone(),
        patient_id: req.patient_id.clone(),
        esi_level,
        chief_complaint: req.chief_complaint.clone(),
        vital_signs: req.vital_signs.clone(),
        pain_scale: req.pain_scale,
        notes: req.notes.clone(),
        performed_by: current_user_id.clone(),
        performed_at: Utc::now().timestamp(),
    };

    // Store assessment
    let entity = TriageAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: req.patient_id.clone(),
        esi_level: esi_level.level() as i32,
        chief_complaint: req.chief_complaint.clone(),
        heart_rate: req.vital_signs.heart_rate.map(|v| v as i32),
        respiratory_rate: req.vital_signs.respiratory_rate.map(|v| v as i32),
        blood_pressure_systolic: req.vital_signs.bp_systolic.map(|v| v as i32),
        blood_pressure_diastolic: req.vital_signs.bp_diastolic.map(|v| v as i32),
        temperature: req.vital_signs.temperature_celsius.map(|v| v as f64),
        oxygen_saturation: req.vital_signs.oxygen_saturation.map(|v| v as i32),
        pain_scale: req.pain_scale.map(|v| v as i32),
        gcs_score: None,
        blood_glucose: None,
        weight: None,
        is_critical: has_critical_vitals,
        requires_isolation: false,
        disposition: None,
        assigned_bed: None,
        triage_time: Utc::now(),
        seen_by_provider_at: None,
        performed_by: current_user_id.clone(),
        facility_id: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    if let Err(e) = data.repositories.triage_assessments.create(entity).await {
        log::error!("Failed to store triage assessment in repository: {}", e);
    }

    // Log access in repository
    let log_entity = AccessLogEntity {
        id: secure_tokens::generate_access_id(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        patient_id: Some(req.patient_id.clone()),
        resource_type: "triage".to_string(),
        resource_id: Some(assessment_id.clone()),
        action: "create".to_string(),
        access_reason: Some("triage assessment".to_string()),
        is_emergency_access: esi_level.level() <= 2,
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
        "Triage assessment {} created for patient {} - ESI Level {}",
        assessment_id,
        req.patient_id,
        esi_level.level()
    );

    HttpResponse::Created().json(CreateTriageResponse {
        success: true,
        assessment_id,
        esi_level: esi_level.level(),
        color_code: esi_level.color_code().to_string(),
        expected_wait: esi_level.expected_wait().to_string(),
        has_critical_vitals,
        message: format!(
            "Triage assessment created. ESI Level {}: {}",
            esi_level.level(),
            esi_level.description()
        ),
    })
}

/// Get a triage assessment by ID
#[get("/api/clinical/triage/{assessment_id}")]
pub async fn get_triage_assessment(
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

    // Healthcare providers can view any triage
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can view triage assessments".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .triage_assessments
        .get_by_id(&assessment_id)
        .await
    {
        Ok(entity) => {
            // Convert Entity to TriageAssessment struct
            let assessment = TriageAssessment {
                assessment_id: entity.id,
                patient_id: entity.patient_id,
                esi_level: ESILevel::from_level(entity.esi_level as u8)
                    .unwrap_or(ESILevel::Level3Urgent),
                chief_complaint: entity.chief_complaint,
                vital_signs: crate::clinical::TriageVitalSigns {
                    heart_rate: entity.heart_rate.map(|v| v as u16),
                    respiratory_rate: entity.respiratory_rate.map(|v| v as u16),
                    bp_systolic: entity.blood_pressure_systolic.map(|v| v as u16),
                    bp_diastolic: entity.blood_pressure_diastolic.map(|v| v as u16),
                    temperature_celsius: entity.temperature.map(|v| v as f32),
                    oxygen_saturation: entity.oxygen_saturation.map(|v| v as u8),
                    pain_scale: None,
                    gcs_score: None,
                    blood_glucose: None,
                    weight_kg: None,
                },
                pain_scale: None,
                notes: entity.disposition.clone(), // Map disposition to notes for now
                performed_by: entity.performed_by,
                performed_at: entity.triage_time.timestamp(),
            };
            HttpResponse::Ok().json(assessment)
        }
        Err(_) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Triage assessment '{}' not found", assessment_id),
            code: "ASSESSMENT_NOT_FOUND".to_string(),
        }),
    }
}

/// Get all triage assessments for a patient
#[get("/api/clinical/patient/{patient_id}/triage")]
pub async fn get_patient_triage_assessments(
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

    // Healthcare providers or patient viewing own records
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    match data
        .repositories
        .triage_assessments
        .get_by_patient(&patient_id, Pagination::new(0, 50))
        .await
    {
        Ok(result) => {
            let assessments: Vec<TriageAssessment> = result
                .items
                .into_iter()
                .map(|entity| TriageAssessment {
                    assessment_id: entity.id,
                    patient_id: entity.patient_id,
                    esi_level: ESILevel::from_level(entity.esi_level as u8)
                        .unwrap_or(ESILevel::Level3Urgent),
                    chief_complaint: entity.chief_complaint,
                    vital_signs: crate::clinical::TriageVitalSigns {
                        heart_rate: entity.heart_rate.map(|v| v as u16),
                        respiratory_rate: entity.respiratory_rate.map(|v| v as u16),
                        bp_systolic: entity.blood_pressure_systolic.map(|v| v as u16),
                        bp_diastolic: entity.blood_pressure_diastolic.map(|v| v as u16),
                        temperature_celsius: entity.temperature.map(|v| v as f32),
                        oxygen_saturation: entity.oxygen_saturation.map(|v| v as u8),
                        pain_scale: None,
                        gcs_score: None,
                        blood_glucose: None,
                        weight_kg: None,
                    },
                    pain_scale: None,
                    notes: entity.disposition.clone(),
                    performed_by: entity.performed_by,
                    performed_at: entity.triage_time.timestamp(),
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

/// Get triage queue - all pending triage assessments sorted by ESI level
/// Requires: Doctor, Nurse, or Admin role
#[get("/api/clinical/triage/queue")]
pub async fn get_triage_queue(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
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

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(user) => user,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Insufficient permissions to view triage queue".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    match data
        .repositories
        .triage_assessments
        .get_ed_dashboard()
        .await
    {
        Ok(items) => {
            let assessments: Vec<TriageAssessment> = items
                .into_iter()
                .map(|entity| TriageAssessment {
                    assessment_id: entity.id,
                    patient_id: entity.patient_id,
                    esi_level: ESILevel::from_level(entity.esi_level as u8)
                        .unwrap_or(ESILevel::Level3Urgent),
                    chief_complaint: entity.chief_complaint,
                    vital_signs: crate::clinical::TriageVitalSigns {
                        heart_rate: entity.heart_rate.map(|v| v as u16),
                        respiratory_rate: entity.respiratory_rate.map(|v| v as u16),
                        bp_systolic: entity.blood_pressure_systolic.map(|v| v as u16),
                        bp_diastolic: entity.blood_pressure_diastolic.map(|v| v as u16),
                        temperature_celsius: entity.temperature.map(|v| v as f32),
                        oxygen_saturation: entity.oxygen_saturation.map(|v| v as u8),
                        pain_scale: None,
                        gcs_score: None,
                        blood_glucose: None,
                        weight_kg: None,
                    },
                    pain_scale: None,
                    notes: entity.disposition.clone(),
                    performed_by: entity.performed_by,
                    performed_at: entity.triage_time.timestamp(),
                })
                .collect();

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "queue": assessments,
                "total": assessments.len()
            }))
        }
        Err(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "queue": [],
            "total": 0
        })),
    }
}
