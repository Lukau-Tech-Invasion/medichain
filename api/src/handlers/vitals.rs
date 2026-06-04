use super::*;

// ----------------------------------------------------------------------------
// Vital Signs Endpoints
// ----------------------------------------------------------------------------

/// Request body for adding a vital signs reading
#[derive(Debug, Deserialize)]
pub struct AddVitalSignsRequest {
    pub patient_id: String,
    pub heart_rate: Option<u16>,
    pub systolic_bp: Option<u16>,
    pub diastolic_bp: Option<u16>,
    pub respiratory_rate: Option<u16>,
    pub oxygen_saturation: Option<u16>,
    pub temperature_celsius: Option<f32>,
    pub pain_scale: Option<u8>,
    pub notes: Option<String>,
}

/// Response for vital signs reading
#[derive(Debug, Serialize)]
pub struct VitalSignsResponse {
    pub success: bool,
    pub reading_id: String,
    pub mean_arterial_pressure: Option<u16>,
    pub critical_alerts: Vec<String>,
    pub message: String,
}

/// Add a vital signs reading for a patient
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/clinical/vitals")]
pub async fn add_vital_signs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AddVitalSignsRequest>,
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
                "Role '{}' cannot add vital signs. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
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

    // Generate reading ID
    let reading_id = format!(
        "VS-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Create vital signs reading
    let reading = VitalSignsReading {
        reading_id: reading_id.clone(),
        timestamp: Utc::now().timestamp(),
        heart_rate: req.heart_rate,
        systolic_bp: req.systolic_bp,
        diastolic_bp: req.diastolic_bp,
        respiratory_rate: req.respiratory_rate,
        oxygen_saturation: req.oxygen_saturation,
        temperature_celsius: req.temperature_celsius,
        pain_scale: req.pain_scale,
        recorded_by: current_user_id.clone(),
        notes: req.notes.clone(),
    };

    let map = reading.calculate_map();
    let critical_alerts = reading.has_critical_values();
    let has_critical = !critical_alerts.is_empty();

    // Persist vital signs via repository
    {
        let entity: crate::repositories::traits::VitalSignsEntity =
            (req.patient_id.clone(), reading).into();
        if let Err(e) = data.repositories.vital_signs.create(entity).await {
            log::error!("Vital signs persistence failed: {}", e);
        }
    }

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            AccessLogEntry {
                access_id: secure_tokens::generate_access_id(),
                patient_id: req.patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: "add_vital_signs".to_string(),
                location: None,
                timestamp: Utc::now(),
                emergency: has_critical,
            }
            .into(),
        )
        .await;

    log::info!(
        "Vital signs {} added for patient {}{}",
        reading_id,
        req.patient_id,
        if has_critical {
            " - CRITICAL VALUES DETECTED"
        } else {
            ""
        }
    );

    HttpResponse::Created().json(VitalSignsResponse {
        success: true,
        reading_id,
        mean_arterial_pressure: map,
        critical_alerts: critical_alerts.clone(),
        message: if has_critical {
            format!(
                "Vital signs recorded. ALERT: {}",
                critical_alerts.join(", ")
            )
        } else {
            "Vital signs recorded successfully".to_string()
        },
    })
}

/// Get vital signs flowsheet for a patient
#[get("/api/clinical/patient/{patient_id}/vitals")]
pub async fn get_patient_vitals(
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
        .vital_signs
        .get_by_patient(&patient_id, Pagination::new(0, 100))
        .await
    {
        Ok(result) => {
            let readings: Vec<crate::clinical::VitalSignsReading> = result
                .items
                .into_iter()
                .map(|v| crate::clinical::VitalSignsReading {
                    reading_id: v.id,
                    timestamp: v.recorded_at.timestamp(),
                    recorded_by: v.recorded_by,
                    heart_rate: v.heart_rate.map(|val| val as u16),
                    respiratory_rate: v.respiratory_rate.map(|val| val as u16),
                    systolic_bp: v.blood_pressure_systolic.map(|val| val as u16),
                    diastolic_bp: v.blood_pressure_diastolic.map(|val| val as u16),
                    temperature_celsius: v.temperature.map(|val| val as f32),
                    oxygen_saturation: v.oxygen_saturation.map(|val| val as u16),
                    pain_scale: v.pain_scale.map(|val| val as u8),
                    notes: None,
                })
                .collect();

            HttpResponse::Ok().json(serde_json::json!({
                "patient_id": patient_id,
                "readings": readings,
                "total": result.total,
                "critical_alerts": []
            }))
        }
        Err(_) => HttpResponse::Ok().json(serde_json::json!({
            "patient_id": patient_id,
            "readings": [],
            "total": 0,
            "critical_alerts": []
        })),
    }
}

/// Get vital signs flowsheet for a patient (alias endpoint for frontend compatibility)
#[get("/api/clinical/vitals/flowsheet/{patient_id}")]
pub async fn get_vitals_flowsheet(
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
        .vital_signs
        .get_by_patient(&patient_id, Pagination::new(0, 100))
        .await
    {
        Ok(result) => {
            let readings: Vec<crate::clinical::VitalSignsReading> = result
                .items
                .into_iter()
                .map(|v| crate::clinical::VitalSignsReading {
                    reading_id: v.id,
                    timestamp: v.recorded_at.timestamp(),
                    recorded_by: v.recorded_by,
                    heart_rate: v.heart_rate.map(|val| val as u16),
                    respiratory_rate: v.respiratory_rate.map(|val| val as u16),
                    systolic_bp: v.blood_pressure_systolic.map(|val| val as u16),
                    diastolic_bp: v.blood_pressure_diastolic.map(|val| val as u16),
                    temperature_celsius: v.temperature.map(|val| val as f32),
                    oxygen_saturation: v.oxygen_saturation.map(|val| val as u16),
                    pain_scale: v.pain_scale.map(|val| val as u8),
                    notes: None,
                })
                .collect();

            HttpResponse::Ok().json(serde_json::json!({
                "patient_id": patient_id,
                "readings": readings,
                "total": result.total,
                "critical_alerts": []
            }))
        }
        Err(_) => HttpResponse::Ok().json(serde_json::json!({
            "patient_id": patient_id,
            "readings": [],
            "total": 0,
            "critical_alerts": []
        })),
    }
}

/// Get latest vital signs for a patient
#[get("/api/clinical/patient/{patient_id}/vitals/latest")]
pub async fn get_patient_latest_vitals(
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
        .vital_signs
        .get_latest_by_patient(&patient_id)
        .await
    {
        Ok(Some(vitals)) => {
            let reading = crate::clinical::VitalSignsReading {
                reading_id: vitals.id,
                timestamp: vitals.recorded_at.timestamp(),
                recorded_by: vitals.recorded_by,
                heart_rate: vitals.heart_rate.map(|val| val as u16),
                respiratory_rate: vitals.respiratory_rate.map(|val| val as u16),
                systolic_bp: vitals.blood_pressure_systolic.map(|val| val as u16),
                diastolic_bp: vitals.blood_pressure_diastolic.map(|val| val as u16),
                temperature_celsius: vitals.temperature.map(|val| val as f32),
                oxygen_saturation: vitals.oxygen_saturation.map(|val| val as u16),
                pain_scale: vitals.pain_scale.map(|val| val as u8),
                notes: None,
            };
            let alerts = reading.has_critical_values();
            HttpResponse::Ok().json(serde_json::json!({
                "patient_id": patient_id,
                "reading": reading,
                "critical_alerts": alerts
            }))
        }
        Ok(None) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "No vital signs recorded".to_string(),
            code: "NO_READINGS".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
