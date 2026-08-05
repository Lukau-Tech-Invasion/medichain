use super::*;

// ============================================================================
// EMERGENCY ASSESSMENTS
// ============================================================================

/// Create trauma assessment
#[post("/api/emergency/trauma")]
pub async fn create_trauma(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<TraumaAssessment>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();

    let _ = data
        .repositories
        .access_logs
        .create(access_log_entity(
            current_user_id,
            "trauma_team",
            "create_trauma_assessment",
            Some(assessment.patient_id.clone()),
        ))
        .await;

    let entity = trauma_entity(&assessment, json_value(&assessment));
    match data
        .repositories
        .trauma_assessments_repo
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get trauma assessment
///
/// HZ-009 audit: took an unused `_http_req` and returned the full clinical
/// assessment by bare `{id}` with no authentication at all. Now requires the
/// same authenticated-caller bar as `create_trauma` above.
#[get("/api/emergency/trauma/{id}")]
pub async fn get_trauma(
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
        .trauma_assessments_repo
        .get_by_id(&id)
        .await
    {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List a patient's trauma assessments (provider or the patient themselves).
///
/// Added to connect the doctor portal's Emergency Protocols page, which fetches
/// per-type lists by patient. The repository already supported `get_by_patient`
/// (the aggregate `get_patient_emergency_records` uses it); this exposes it as
/// its own route, mirroring `list_patient_code_blues`.
#[get("/api/emergency/trauma/patient/{patient_id}")]
pub async fn list_patient_trauma(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_emergency_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data
        .repositories
        .trauma_assessments_repo
        .get_by_patient(&patient_id, Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create stroke assessment
#[post("/api/emergency/stroke")]
pub async fn create_stroke(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<StrokeAssessment>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();

    let _ = data
        .repositories
        .access_logs
        .create(access_log_entity(
            current_user_id,
            "stroke_team",
            "create_stroke_assessment",
            Some(assessment.patient_id.clone()),
        ))
        .await;

    let entity = stroke_entity(&assessment, json_value(&assessment));
    match data
        .repositories
        .stroke_assessments_repo
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get stroke assessment
///
/// HZ-009 audit: took an unused `_http_req` and returned the full clinical
/// assessment by bare `{id}` with no authentication at all. Now requires the
/// same authenticated-caller bar as `create_stroke` above.
#[get("/api/emergency/stroke/{id}")]
pub async fn get_stroke(
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
        .stroke_assessments_repo
        .get_by_id(&id)
        .await
    {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List a patient's stroke assessments (provider or the patient themselves).
#[get("/api/emergency/stroke/patient/{patient_id}")]
pub async fn list_patient_stroke(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_emergency_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data
        .repositories
        .stroke_assessments_repo
        .get_by_patient(&patient_id, Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create sepsis assessment
#[post("/api/emergency/sepsis")]
pub async fn create_sepsis(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<SepsisAssessment>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();

    let _ = data
        .repositories
        .access_logs
        .create(access_log_entity(
            current_user_id,
            "sepsis_team",
            "create_sepsis_assessment",
            Some(assessment.patient_id.clone()),
        ))
        .await;

    let entity = sepsis_entity(&assessment, json_value(&assessment));
    match data
        .repositories
        .sepsis_assessments_repo
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get sepsis assessment
///
/// HZ-009 audit: took an unused `_http_req` and returned the full clinical
/// assessment by bare `{id}` with no authentication at all. Now requires the
/// same authenticated-caller bar as `create_sepsis` above.
#[get("/api/emergency/sepsis/{id}")]
pub async fn get_sepsis(
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
        .sepsis_assessments_repo
        .get_by_id(&id)
        .await
    {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List a patient's sepsis assessments (provider or the patient themselves).
#[get("/api/emergency/sepsis/patient/{patient_id}")]
pub async fn list_patient_sepsis(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_emergency_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data
        .repositories
        .sepsis_assessments_repo
        .get_by_patient(&patient_id, Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create EMS handoff
#[post("/api/emergency/ems-handoff")]
pub async fn create_ems_handoff(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<EMSHandoff>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let handoff = req.into_inner();
    let id = handoff.report_id.clone();

    let _ = data
        .repositories
        .access_logs
        .create(access_log_entity(
            current_user_id,
            "ems",
            "create_ems_handoff",
            handoff.patient_id.clone(),
        ))
        .await;

    let entity = ems_handoff_entity(&handoff, json_value(&handoff));
    match data.repositories.ems_handoffs.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get EMS handoff
///
/// HZ-009 audit: took an unused `_http_req` and returned the full clinical
/// handoff by bare `{id}` with no authentication at all. Now requires the
/// same authenticated-caller bar as `create_ems_handoff` above.
#[get("/api/emergency/ems-handoff/{id}")]
pub async fn get_ems_handoff(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.ems_handoffs.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// Aggregate emergency records for a patient
#[get("/api/emergency/patient/{patient_id}")]
pub async fn get_patient_emergency_records(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // HZ-019 IDOR follow-up: this previously checked only that SOME X-User-Id
    // header was present, so any authenticated account — including an unrelated
    // patient — could read any patient's emergency records. Apply the same
    // provider-or-self rule the clinical endpoints use (e.g. get_patient_vitals):
    // a healthcare provider, or the patient reading their own record. The
    // token-based break-glass path is separate (POST /api/emergency/nfc-token
    // then the medical-id endpoints).
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    let pagination = Pagination::new(0, 10);

    let code_blues = data
        .repositories
        .code_blue
        .get_by_patient(&patient_id, pagination.clone())
        .await
        .map(|r| r.items)
        .unwrap_or_default();
    let trauma = data
        .repositories
        .trauma_assessments_repo
        .get_by_patient(&patient_id, pagination.clone())
        .await
        .map(|r| r.items)
        .unwrap_or_default();
    let stroke = data
        .repositories
        .stroke_assessments_repo
        .get_by_patient(&patient_id, pagination.clone())
        .await
        .map(|r| r.items)
        .unwrap_or_default();
    let sepsis = data
        .repositories
        .sepsis_assessments_repo
        .get_by_patient(&patient_id, pagination)
        .await
        .map(|r| r.items)
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "code_blues": code_blues,
        "trauma_assessments": trauma,
        "stroke_assessments": stroke,
        "sepsis_assessments": sepsis
    }))
}
