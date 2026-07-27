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

    // CDS: evaluate the full rules engine (sepsis/qSOFA, shock, hypertensive crisis,
    // stroke, AKI, hyperkalemia, etc.) against this reading plus the patient's real
    // chronic conditions/medications — not just the simple threshold check above.
    {
        let (conditions, medications) =
            crate::clinical_endpoints::patient_conditions_and_meds(&data, &req.patient_id).await;
        crate::clinical_endpoints::run_and_persist_cds_alerts(
            &data,
            &req.patient_id,
            Some(&reading),
            None,
            &conditions,
            &medications,
            None,
        )
        .await;
    }

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

#[cfg(test)]
mod cds_wiring_tests {
    use super::*;
    use actix_web::{test, App};

    fn test_patient(
        id: &str,
        conditions: Vec<String>,
        medications: Vec<String>,
    ) -> crate::PatientProfile {
        let now = Utc::now();
        crate::PatientProfile {
            patient_id: id.to_string(),
            full_name: "Test Patient".to_string(),
            date_of_birth: "1980-01-01".to_string(),
            national_id: format!("NID-{id}"),
            phone: "+27000000000".to_string(),
            emergency_info: crate::EmergencyInfo {
                patient_id: id.to_string(),
                blood_type: crate::BloodType::OPositive,
                allergies: Vec::new(),
                current_medications: medications,
                chronic_conditions: conditions,
                emergency_contacts: Vec::new(),
                organ_donor: false,
                dnr_status: false,
                dnr_verified_by: None,
                dnr_verified_at: None,
                dnr_document_ref: None,
                languages: vec!["en".to_string()],
                last_updated: now,
            },
            address: None,
            insurance: None,
            primary_doctor: None,
            community_health_worker: None,
            preferences: crate::PatientPreferences::default(),
            advanced_directives: Vec::new(),
            family_notifications: None,
            created_at: now,
            last_updated: now,
        }
    }

    fn test_doctor() -> User {
        User {
            wallet_address: "doctor_wallet".to_string(),
            username: None,
            name: "Dr. Test".to_string(),
            role: Role::Doctor,
            created_at: Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    /// Recording vital signs for a patient with a documented renal condition and an
    /// NSAID on their medication list should trigger the CDS rules engine's
    /// "NSAID Use in Renal Impairment" rule — this rule needs no vitals/labs at all,
    /// so any vitals submission is enough to exercise the new wiring end-to-end.
    #[actix_web::test]
    async fn add_vital_signs_triggers_condition_and_medication_cds_rule() {
        let state = crate::AppState::new();
        let patient_id = "PAT-CDS-VITALS-1";
        let profile = test_patient(
            patient_id,
            vec!["Chronic Kidney Disease".to_string()],
            vec!["Ibuprofen".to_string()],
        );
        state
            .repositories
            .patients
            .create(crate::patient_profile_to_entity(
                &profile,
                &state.encryption_keyring,
            ))
            .await
            .unwrap();
        state
            .users
            .write()
            .unwrap()
            .insert("doctor_wallet".to_string(), test_doctor());

        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(add_vital_signs),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/clinical/vitals")
            .insert_header(("x-user-id", "doctor_wallet"))
            .set_json(serde_json::json!({
                "patient_id": patient_id,
                "heart_rate": 80,
                "systolic_bp": 120,
                "diastolic_bp": 80,
                "respiratory_rate": 16,
                "oxygen_saturation": 98,
                "temperature_celsius": 37.0,
            }))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let alerts = app_state
            .repositories
            .cds_alerts
            .get_by_patient(patient_id, true)
            .await
            .unwrap_or_default();
        assert!(
            alerts.iter().any(|a| a.alert_title.contains("NSAID")),
            "expected an NSAID-in-renal-impairment CDS alert, got: {:?}",
            alerts.iter().map(|a| &a.alert_title).collect::<Vec<_>>()
        );
    }
}
