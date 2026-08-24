use super::*;

// ============================================================================
// PUBLIC HEALTH & ADMINISTRATION
// ============================================================================

/// Create immunization record
#[post("/api/surgical/immunization")]
pub async fn create_immunization(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ImmunizationRecord>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let mut record = req.into_inner();
    // The id is the primary key, so it is the server's to assign. A blank or
    // absent one used to be stored verbatim, so the second such record
    // collided and failed with an opaque 500.
    if record.record_id.trim().is_empty() {
        record.record_id = crate::middleware::error_handling::secure_tokens::generate_access_id()
            .replacen("ACC-", "IMM-", 1);
    }
    // Persisted through the typed repository, so it survives a restart.
    match data
        .repositories
        .immunization_records
        .create(record.into())
        .await
    {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("immunization record could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Immunization record could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get immunization record
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_immunization`'s authenticated-caller bar.
#[get("/api/surgical/immunization/{id}")]
pub async fn get_immunization(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.immunization_records.get_by_id(&id).await {
        // Infallible, unlike the other clinical conversions: this entity has
        // typed columns for every field the API type carries, so there is no
        // payload to fail to deserialize.
        Ok(entity) => HttpResponse::Ok().json(ImmunizationRecord::from(entity)),
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("immunization-record lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create family history
#[post("/api/surgical/family-history")]
pub async fn create_family_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<FamilyMedicalHistory>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let history = req.into_inner();
    let id = history.patient_id.clone();
    // Persisted through the repository, so it survives a restart. Keyed by
    // patient: a family history is one evolving record per patient rather than
    // a series, so a re-post replaces it.
    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: id.clone(),
        data: serde_json::to_value(&history).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .family_history_records
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("family-history record could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Family history could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get family history
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_family_history`'s authenticated-caller bar.
#[get("/api/surgical/family-history/{id}")]
pub async fn get_family_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    // Registered caller, NOT clinical-staff-only: a patient must be able to
    // read their own record here. The staff gate rejected them with
    // INSUFFICIENT_ROLE before the self-or-provider check below could run.
    if let Err(resp) = crate::support::require_registered_caller(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data
        .repositories
        .family_history_records
        .get_by_id(&id)
        .await
    {
        // A patient with nothing recorded has an EMPTY family history, not a
        // missing one. Answering 404 made the patient app's Medical History
        // page report a failed load for the ordinary case of "nobody has filled
        // this in yet" — indistinguishable, to the caller, from a broken route.
        Ok(Some(rec)) => match serde_json::from_value::<FamilyMedicalHistory>(rec.data) {
            Ok(history) => HttpResponse::Ok().json(history),
            Err(e) => {
                log::error!("family-history stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored family history could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Ok(None) => HttpResponse::Ok().json(serde_json::json!({
            "patient_id": id,
            "entries": [],
        })),
        Err(e) => {
            log::error!("family-history lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create blood type screen
#[post("/api/surgical/blood-type")]
pub async fn create_blood_type_screen(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<BloodTypeScreen>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let screen = req.into_inner();
    let id = screen.test_id.clone();
    // Persisted through the repository, so it survives a restart.
    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: screen.patient_id.clone(),
        data: serde_json::to_value(&screen).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .blood_type_screen_records
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("blood-type screen could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Blood type screen could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get blood type screen
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_blood_type_screen`'s authenticated-caller bar.
#[get("/api/surgical/blood-type/{id}")]
pub async fn get_blood_type_screen(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data
        .repositories
        .blood_type_screen_records
        .get_by_id(&id)
        .await
    {
        Ok(Some(rec)) => match serde_json::from_value::<BloodTypeScreen>(rec.data) {
            Ok(screen) => HttpResponse::Ok().json(screen),
            Err(e) => {
                // A partial blood type screen is more dangerous than none.
                log::error!("blood-type screen stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored blood type screen could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("blood-type screen lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create transfusion record
#[post("/api/surgical/transfusion")]
pub async fn create_transfusion(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<TransfusionRecord>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let record = req.into_inner();
    let id = record.transfusion_id.clone();

    // Log access
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: record.patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: "nurse".to_string(),
                access_type: "create_transfusion".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    // Persisted through the repository, so it survives a restart.
    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .transfusion_event_records
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("transfusion record could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Transfusion record could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get transfusion record
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_transfusion`'s authenticated-caller bar.
#[get("/api/surgical/transfusion/{id}")]
pub async fn get_transfusion(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data
        .repositories
        .transfusion_event_records
        .get_by_id(&id)
        .await
    {
        Ok(Some(rec)) => match serde_json::from_value::<TransfusionRecord>(rec.data) {
            Ok(record) => HttpResponse::Ok().json(record),
            Err(e) => {
                // A partial transfusion record is more dangerous than none.
                log::error!("transfusion record stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored transfusion record could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("transfusion-record lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create electronic prescription
#[post("/api/surgical/e-prescription")]
pub async fn create_e_prescription(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ElectronicPrescription>,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let current_user_id = caller.wallet_address.clone();

    let mut prescription = req.into_inner();

    // The whole `ElectronicPrescription` used to be persisted verbatim from the
    // request body, so the client chose its own `rx_id` (letting one call
    // overwrite an existing prescription) and named its own `prescriber`
    // (attributing a prescription to another clinician, while the access log
    // recorded the real caller — the record and the audit trail disagreed by
    // construction). See docs/WORKFLOW_AUDIT.md, WF-020.
    //
    // Both are now server-derived. `PrescriberInfo` identifies a clinician by
    // name and licence rather than wallet, so those are stamped from the
    // caller's own account record.
    prescription.rx_id = format!("RX-{}", uuid::Uuid::new_v4());
    prescription.prescriber.name = caller.name.clone();
    if let Some(licence) = caller.license_number.clone() {
        prescription.prescriber.state_license = licence;
    }
    let id = prescription.rx_id.clone();

    // Log access
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: prescription.patient_id.clone(),
                accessor_id: current_user_id,
                // Was the literal "doctor" regardless of who called.
                accessor_role: caller.role.to_string(),
                access_type: "create_e_prescription".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    // Persisted through the repository, so it survives a restart.
    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: prescription.patient_id.clone(),
        data: serde_json::to_value(&prescription).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .e_prescription_records
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("e-prescription could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "E-prescription could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get electronic prescription
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_e_prescription`'s authenticated-caller bar.
#[get("/api/surgical/e-prescription/{id}")]
pub async fn get_e_prescription(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data
        .repositories
        .e_prescription_records
        .get_by_id(&id)
        .await
    {
        Ok(Some(rec)) => match serde_json::from_value::<ElectronicPrescription>(rec.data) {
            Ok(prescription) => HttpResponse::Ok().json(prescription),
            Err(e) => {
                // A partial e-prescription is more dangerous than none.
                log::error!("e-prescription stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored e-prescription could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("e-prescription lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create appointment
#[post("/api/surgical/appointment")]
pub async fn create_appointment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<Appointment>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let appointment = req.into_inner();
    let id = appointment.appointment_id.clone();

    let entity: crate::repositories::traits::AppointmentEntity = appointment.into();
    match data.repositories.appointments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get surgical appointment.
///
/// This explicit handler name prevents it from colliding with the appointment
/// booking endpoint while preserving the established HTTP route.
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_appointment`'s authenticated-caller bar.
#[get("/api/surgical/appointment/{id}")]
pub async fn get_surgical_appointment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.appointments.get_by_id(&id).await {
        Ok(entity) => {
            let appointment: Appointment = entity.into();
            HttpResponse::Ok().json(appointment)
        }
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// Create death certificate
#[post("/api/surgical/death-certificate")]
pub async fn create_death_certificate(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<DeathCertificate>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let certificate = req.into_inner();
    let id = certificate.certificate_id.clone();

    // Log access
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: certificate.patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: "doctor".to_string(),
                access_type: "create_death_certificate".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    // Persisted through the repository, so it survives a restart.
    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: certificate.patient_id.clone(),
        data: serde_json::to_value(&certificate).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .death_certificate_records
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("death certificate could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Death certificate could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get death certificate
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_death_certificate`'s authenticated-caller bar.
#[get("/api/surgical/death-certificate/{id}")]
pub async fn get_death_certificate(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data
        .repositories
        .death_certificate_records
        .get_by_id(&id)
        .await
    {
        Ok(Some(rec)) => match serde_json::from_value::<DeathCertificate>(rec.data) {
            Ok(certificate) => HttpResponse::Ok().json(certificate),
            Err(e) => {
                log::error!("death-certificate stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored death certificate could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("death-certificate lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create autopsy request
// Persisted via `data.repositories.autopsy_requests` (was: the legacy
// `data.autopsy_requests` HashMap, which the admin list view at
// `/api/platform/list/autopsy` never read from — creates were invisible to
// that list and lost on restart).
#[post("/api/surgical/autopsy")]
pub async fn create_autopsy_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AutopsyRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let request = req.into_inner();
    let id = request.request_id.clone();

    // Log access
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: request.patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: "doctor".to_string(),
                access_type: "create_autopsy_request".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: request.patient_id.clone(),
        data: serde_json::to_value(&request).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data.repositories.autopsy_requests.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get autopsy request
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_autopsy_request`'s authenticated-caller bar.
#[get("/api/surgical/autopsy/{id}")]
pub async fn get_autopsy_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.autopsy_requests.get_by_id(&id).await {
        Ok(Some(rec)) => match serde_json::from_value::<AutopsyRequest>(rec.data) {
            Ok(request) => HttpResponse::Ok().json(request),
            Err(_) => HttpResponse::InternalServerError().finish(),
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create autopsy report
#[post("/api/surgical/autopsy/report")]
pub async fn create_autopsy_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AutopsyReport>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let report = req.into_inner();
    let id = report.report_id.clone();

    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: report.patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: "doctor".to_string(),
                access_type: "create_autopsy_report".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: report.patient_id.clone(),
        data: serde_json::to_value(&report).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data.repositories.autopsy_reports.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get autopsy report
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_autopsy_report`'s authenticated-caller bar.
#[get("/api/surgical/autopsy/report/{id}")]
pub async fn get_autopsy_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.autopsy_reports.get_by_id(&id).await {
        Ok(Some(rec)) => match serde_json::from_value::<AutopsyReport>(rec.data) {
            Ok(report) => HttpResponse::Ok().json(report),
            Err(_) => HttpResponse::InternalServerError().finish(),
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Patient-facing satisfaction survey submission.
///
/// The patient identity is derived from the authenticated account. The client
/// cannot submit feedback under another patient's identifier.
#[derive(Debug, Deserialize)]
pub struct SubmitSatisfactionSurveyRequest {
    pub visit_id: Option<String>,
    pub visit_date: String,
    pub department: String,
    pub survey_type: SurveyType,
    #[serde(default)]
    pub responses: Vec<SurveyResponse>,
    pub overall_rating: u8,
    pub nps_score: u8,
    pub comments: Option<String>,
    pub anonymous: bool,
    pub follow_up_requested: bool,
    pub contact_method: Option<String>,
}

fn satisfaction_storage_unavailable(operation: &str) -> HttpResponse {
    log::error!("Satisfaction survey repository failed during {operation}");
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        success: false,
        error: "Satisfaction survey storage is temporarily unavailable".to_string(),
        code: "STORAGE_UNAVAILABLE".to_string(),
    })
}

fn satisfaction_patient_id(caller: User) -> Result<String, HttpResponse> {
    caller.linked_patient_id.ok_or_else(|| {
        HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "A linked patient identity is required".to_string(),
            code: "PATIENT_CONTEXT_REQUIRED".to_string(),
        })
    })
}

fn build_satisfaction_survey(
    patient_id: String,
    input: SubmitSatisfactionSurveyRequest,
) -> Result<(String, JsonRecordEntity), HttpResponse> {
    if !(1..=5).contains(&input.overall_rating) || input.nps_score > 10 {
        return Err(HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Overall rating must be 1-5 and NPS score must be 0-10".to_string(),
            code: "INVALID_SURVEY_RATING".to_string(),
        }));
    }
    let survey_id = format!("SURV-{}", uuid::Uuid::new_v4());
    let now = Utc::now();
    let survey = PatientSatisfactionSurvey {
        survey_id: survey_id.clone(),
        patient_id: patient_id.clone(),
        visit_id: input.visit_id.unwrap_or_default(),
        visit_date: input.visit_date,
        department: input.department,
        survey_type: input.survey_type,
        responses: input.responses,
        overall_rating: input.overall_rating,
        nps_score: input.nps_score,
        comments: input.comments.filter(|value| !value.trim().is_empty()),
        submitted_at: now.timestamp(),
        anonymous: input.anonymous,
        follow_up_requested: input.follow_up_requested,
        contact_method: input.contact_method,
    };
    let data = serde_json::to_value(survey)
        .map_err(|_| satisfaction_storage_unavailable("serialization"))?;
    Ok((
        survey_id.clone(),
        JsonRecordEntity {
            id: survey_id,
            owner_id: patient_id,
            data,
            created_at: now,
            updated_at: now,
        },
    ))
}

#[post("/api/clinical/satisfaction-survey")]
pub async fn create_satisfaction_survey(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<SubmitSatisfactionSurveyRequest>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let patient_id = match satisfaction_patient_id(caller) {
        Ok(patient_id) => patient_id,
        Err(response) => return response,
    };
    let (survey_id, record) = match build_satisfaction_survey(patient_id, req.into_inner()) {
        Ok(result) => result,
        Err(response) => return response,
    };

    match data.repositories.satisfaction_surveys.create(record).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "id": survey_id,
            "success": true
        })),
        Err(_) => satisfaction_storage_unavailable("create"),
    }
}

/// Get satisfaction survey
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_satisfaction_survey`'s authenticated-caller bar.
#[get("/api/surgical/satisfaction-survey/{id}")]
pub async fn get_satisfaction_survey(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.satisfaction_surveys.get_by_id(&id).await {
        Ok(Some(record)) => {
            match serde_json::from_value::<PatientSatisfactionSurvey>(record.data) {
                Ok(survey) => HttpResponse::Ok().json(survey),
                Err(_) => satisfaction_storage_unavailable("deserialization"),
            }
        }
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(_) => satisfaction_storage_unavailable("read"),
    }
}
