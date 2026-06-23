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
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
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
#[get("/api/emergency/trauma/{id}")]
pub async fn get_trauma(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
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

/// Create stroke assessment
#[post("/api/emergency/stroke")]
pub async fn create_stroke(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<StrokeAssessment>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
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
#[get("/api/emergency/stroke/{id}")]
pub async fn get_stroke(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
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

/// Create sepsis assessment
#[post("/api/emergency/sepsis")]
pub async fn create_sepsis(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<SepsisAssessment>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
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
#[get("/api/emergency/sepsis/{id}")]
pub async fn get_sepsis(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
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

/// Create EMS handoff
#[post("/api/emergency/ems-handoff")]
pub async fn create_ems_handoff(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<EMSHandoff>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
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
#[get("/api/emergency/ems-handoff/{id}")]
pub async fn get_ems_handoff(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
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
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
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
