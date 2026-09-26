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
    pub gcs_total: Option<u8>,
    /// mmol/L.
    pub blood_glucose: Option<f64>,
    pub weight_kg: Option<f32>,
    pub notes: Option<String>,
    /// Stable fixture key accepted only in explicit demo mode.
    #[serde(default)]
    pub demo_seed_key: Option<String>,
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

fn vital_reading_json(v: crate::repositories::traits::VitalSignsEntity) -> serde_json::Value {
    serde_json::json!({
        "reading_id": v.id,
        "timestamp": v.recorded_at.timestamp(),
        "recorded_at": v.recorded_at,
        "recorded_by": v.recorded_by,
        "heart_rate": v.heart_rate,
        "respiratory_rate": v.respiratory_rate,
        "systolic_bp": v.blood_pressure_systolic,
        "diastolic_bp": v.blood_pressure_diastolic,
        "temperature_celsius": v.temperature,
        "oxygen_saturation": v.oxygen_saturation,
        "pain_scale": v.pain_scale,
        "gcs_total": v.gcs_score,
        "blood_glucose": v.blood_glucose,
        "weight_kg": v.weight_kg,
    })
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
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
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
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    }

    // A pressure entered the wrong way round is refused rather than stored:
    // filed as it stands it reads as profound hypotension, and the critical
    // alert it raises is about a patient who does not exist.
    if let (Some(systolic), Some(diastolic)) = (req.systolic_bp, req.diastolic_bp) {
        if crate::clinical_scoring::blood_pressure_is_transposed(systolic, diastolic) {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: format!(
                    "Systolic {systolic} is not above diastolic {diastolic}; check the two are not swapped"
                ),
                code: "BLOOD_PRESSURE_TRANSPOSED".to_string(),
            });
        }
    }

    if let Some(glucose) = req.blood_glucose {
        if crate::clinical_scoring::glucose_looks_like_mg_dl(glucose) {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: format!(
                    "A blood glucose of {glucose} mmol/L is not plausible; enter it in mmol/L, not mg/dL"
                ),
                code: "GLUCOSE_UNIT_SUSPECT".to_string(),
            });
        }
    }

    let reading_id = match req.demo_seed_key.as_deref() {
        Some(key) => {
            if !crate::support::is_demo_mode()
                || key.len() != 3
                || !key.bytes().all(|byte| byte.is_ascii_digit())
            {
                return HttpResponse::Forbidden().json(ErrorResponse {
                    error: "Deterministic demo vital signs are disabled in this deployment."
                        .to_string(),
                    code: "DEMO_SEED_DISABLED".to_string(),
                });
            }
            let id = format!("VS-DEMO-{key}");
            if data.repositories.vital_signs.get_by_id(&id).await.is_ok() {
                return HttpResponse::Ok().json(VitalSignsResponse {
                    success: true,
                    reading_id: id,
                    mean_arterial_pressure: None,
                    critical_alerts: Vec::new(),
                    message: "Deterministic demo vital signs already exist.".to_string(),
                });
            }
            id
        }
        None => format!(
            "VS-{}",
            Uuid::new_v4()
                .to_string()
                .split('-')
                .next()
                .unwrap_or("000")
        ),
    };

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
    let mut critical_alerts = reading.has_critical_values();
    // Glucose is not part of `VitalSignsReading`, so its band is checked here.
    // It was checked nowhere: a critical glucose raised no alert at all.
    if let Some(glucose) = req.blood_glucose {
        critical_alerts.extend(crate::clinical_scoring::glucose_alerts(glucose));
    }
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
        let mut entity: crate::repositories::traits::VitalSignsEntity =
            (req.patient_id.clone(), reading).into();
        entity.gcs_score = req.gcs_total.map(i32::from);
        entity.blood_glucose = req.blood_glucose;
        entity.weight_kg = req.weight_kg.map(f64::from);
        if let Err(e) = data.repositories.vital_signs.create(entity).await {
            log::error!("Vital signs persistence failed: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Vital signs could not be saved".to_string(),
                code: "DATABASE_ERROR".to_string(),
            });
        }
    }

    // Log access via repository
    if let Err(response) = crate::support::require_durable_audit(
        &data,
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
    .await
    {
        return response;
    }

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

/// Response when vital signs cannot be read.
///
/// These endpoints used to answer `200` with an empty list on a storage error,
/// which tells a nurse "no vitals recorded" -- a clinically false statement --
/// and, with disclosure auditing, would log a read that disclosed nothing.
///
/// # Parameters
/// * `patient_id` - the patient whose vitals were requested (logged, not returned).
/// * `error` - the repository error text (logged only, never sent to the client).
///
/// # Returns
/// A 503 with a user-safe message.
fn vitals_unavailable(patient_id: &str, error: &str) -> HttpResponse {
    log::error!("Vital signs read failed for patient {patient_id}: {error}");
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        error: "Vital signs are temporarily unavailable. Please try again.".to_string(),
        code: "VITALS_UNAVAILABLE".to_string(),
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
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
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
            let readings: Vec<_> = result.items.into_iter().map(vital_reading_json).collect();

            HttpResponse::Ok().json(serde_json::json!({
                "patient_id": patient_id,
                "readings": readings,
                "total": result.total,
                "critical_alerts": []
            }))
        }
        Err(error) => vitals_unavailable(&patient_id, &error.to_string()),
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
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
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
            let readings: Vec<_> = result.items.into_iter().map(vital_reading_json).collect();

            HttpResponse::Ok().json(serde_json::json!({
                "patient_id": patient_id,
                "readings": readings,
                "total": result.total,
                "critical_alerts": []
            }))
        }
        Err(error) => vitals_unavailable(&patient_id, &error.to_string()),
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
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
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
            let mut alerts = reading.has_critical_values();
            if let Some(glucose) = vitals.blood_glucose {
                alerts.extend(crate::clinical_scoring::glucose_alerts(glucose));
            }
            HttpResponse::Ok().json(serde_json::json!({
                "patient_id": patient_id,
                "reading": reading,
                "critical_alerts": alerts
            }))
        }
        // No observations is a known, normal state for a registered patient;
        // it is not a missing resource. Returning 404 made every patient chart
        // without a reading look like a frontend/API failure in the browser.
        Ok(None) => HttpResponse::Ok().json(serde_json::json!({
            "patient_id": patient_id,
            "reading": serde_json::Value::Null,
            "critical_alerts": false
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
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
            time_of_birth: None,
            national_id: format!("NID-{id}"),
            gender: None,
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

    /// A pressure entered the wrong way round is refused, and nothing is stored.
    #[actix_web::test]
    async fn a_transposed_blood_pressure_is_refused_and_not_stored() {
        let state = crate::AppState::new();
        let patient_id = "PAT-BP-SWAPPED";
        let profile = test_patient(patient_id, Vec::new(), Vec::new());
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

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/vitals")
                .insert_header(("x-user-id", "doctor_wallet"))
                .set_json(serde_json::json!({
                    "patient_id": patient_id,
                    "systolic_bp": 80,
                    "diastolic_bp": 120,
                }))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::BAD_REQUEST);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["error"]["code"], "BLOOD_PRESSURE_TRANSPOSED", "{body}");

        let stored = app_state
            .repositories
            .vital_signs
            .get_latest_by_patient(patient_id)
            .await
            .unwrap();
        assert!(stored.is_none(), "a refused reading was stored");
    }

    /// Glucose is in mmol/L. A value typed in mg/dL from habit is refused, and a
    /// critical one now raises an alert -- it raised none in any unit.
    #[actix_web::test]
    async fn glucose_is_mmol_l_a_mg_dl_value_is_refused_and_a_low_one_alerts() {
        let state = crate::AppState::new();
        let patient_id = "PAT-GLUCOSE";
        let profile = test_patient(patient_id, Vec::new(), Vec::new());
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
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .service(add_vital_signs),
        )
        .await;
        let post = |glucose: f64| {
            test::TestRequest::post()
                .uri("/api/clinical/vitals")
                .insert_header(("x-user-id", "doctor_wallet"))
                .set_json(serde_json::json!({ "patient_id": patient_id, "blood_glucose": glucose }))
                .to_request()
        };

        let refused = test::call_service(&app, post(110.0)).await;
        assert_eq!(refused.status(), actix_web::http::StatusCode::BAD_REQUEST);
        let body: serde_json::Value = test::read_body_json(refused).await;
        assert_eq!(body["error"]["code"], "GLUCOSE_UNIT_SUSPECT", "{body}");

        let low: serde_json::Value = test::call_and_read_body_json(&app, post(2.1)).await;
        assert!(
            low["critical_alerts"].to_string().contains("Hypoglycaemia"),
            "{low}"
        );

        let normal: serde_json::Value = test::call_and_read_body_json(&app, post(5.4)).await;
        assert_eq!(normal["critical_alerts"], serde_json::json!([]), "{normal}");
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
