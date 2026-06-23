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
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

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
#[get("/api/surgical/immunization/{id}")]
pub async fn get_immunization(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
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
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

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
#[get("/api/surgical/family-history/{id}")]
pub async fn get_family_history(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
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
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

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
#[get("/api/surgical/blood-type/{id}")]
pub async fn get_blood_type_screen(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
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
#[get("/api/surgical/transfusion/{id}")]
pub async fn get_transfusion(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
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
#[get("/api/surgical/e-prescription/{id}")]
pub async fn get_e_prescription(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
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
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let appointment = req.into_inner();
    let id = appointment.appointment_id.clone();

    match data.appointments.write() {
        Ok(mut appointments) => {
            appointments.insert(id.clone(), appointment);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get appointment
#[get("/api/surgical/appointment/{id}")]
pub async fn get_appointment(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.appointments.read() {
        Ok(appointments) => appointments
            .get(&id)
            .map(|appointment| HttpResponse::Ok().json(appointment))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
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
#[get("/api/surgical/death-certificate/{id}")]
pub async fn get_death_certificate(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
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

    match data.autopsy_requests.write() {
        Ok(mut requests) => {
            requests.insert(id.clone(), request);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get autopsy request
#[get("/api/surgical/autopsy/{id}")]
pub async fn get_autopsy_request(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.autopsy_requests.read() {
        Ok(requests) => requests
            .get(&id)
            .map(|request| HttpResponse::Ok().json(request))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
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
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

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
#[get("/api/surgical/satisfaction-survey/{id}")]
pub async fn get_satisfaction_survey(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.satisfaction_surveys.read() {
        Ok(surveys) => surveys
            .get(&id)
            .map(|survey| HttpResponse::Ok().json(survey))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}
