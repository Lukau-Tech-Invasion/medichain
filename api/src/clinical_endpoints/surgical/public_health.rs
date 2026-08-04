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

    let record = req.into_inner();
    let id = record.record_id.clone();
    match data.immunization_records.write() {
        Ok(mut records) => {
            records.insert(id.clone(), record);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
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
    match data.immunization_records.read() {
        Ok(records) => records
            .get(&id)
            .map(|record| HttpResponse::Ok().json(record))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
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
    match data.family_histories.write() {
        Ok(mut histories) => {
            histories.insert(id.clone(), history);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
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
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.family_histories.read() {
        Ok(histories) => histories
            .get(&id)
            .map(|history| HttpResponse::Ok().json(history))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
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
    match data.blood_type_screens.write() {
        Ok(mut screens) => {
            screens.insert(id.clone(), screen);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
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
    match data.blood_type_screens.read() {
        Ok(screens) => screens
            .get(&id)
            .map(|screen| HttpResponse::Ok().json(screen))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create transfusion record
#[post("/api/surgical/transfusion")]
pub async fn create_transfusion(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<TransfusionRecord>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
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

    match data.transfusion_records.write() {
        Ok(mut records) => {
            records.insert(id.clone(), record);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
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
    match data.transfusion_records.read() {
        Ok(records) => records
            .get(&id)
            .map(|record| HttpResponse::Ok().json(record))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create electronic prescription
#[post("/api/surgical/e-prescription")]
pub async fn create_e_prescription(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ElectronicPrescription>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let prescription = req.into_inner();
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
                accessor_role: "doctor".to_string(),
                access_type: "create_e_prescription".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    match data.e_prescriptions.write() {
        Ok(mut prescriptions) => {
            prescriptions.insert(id.clone(), prescription);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
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
    match data.e_prescriptions.read() {
        Ok(prescriptions) => prescriptions
            .get(&id)
            .map(|prescription| HttpResponse::Ok().json(prescription))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
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
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
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

    match data.death_certificates.write() {
        Ok(mut certificates) => {
            certificates.insert(id.clone(), certificate);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
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
    match data.death_certificates.read() {
        Ok(certificates) => certificates
            .get(&id)
            .map(|cert| HttpResponse::Ok().json(cert))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
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
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
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
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
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

/// Create satisfaction survey
#[post("/api/surgical/satisfaction-survey")]
pub async fn create_satisfaction_survey(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PatientSatisfactionSurvey>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let survey = req.into_inner();
    let id = survey.survey_id.clone();

    match data.satisfaction_surveys.write() {
        Ok(mut surveys) => {
            surveys.insert(id.clone(), survey);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
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
    match data.satisfaction_surveys.read() {
        Ok(surveys) => surveys
            .get(&id)
            .map(|survey| HttpResponse::Ok().json(survey))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}
