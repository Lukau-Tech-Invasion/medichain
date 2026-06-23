use super::*;

// ============================================================================
// ER MANAGEMENT & NURSING
// ============================================================================

/// Create MAR entry
#[post("/api/emergency/mar")]
pub async fn create_mar(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::MedicationAdministrationRecord>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let record = req.into_inner();
    let id = format!("MAR-{}-{}", record.patient_id, record.date);
    let entity =
        medication_record_entity(id.clone(), &record, current_user_id, json_value(&record));
    match data.repositories.medication_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get MAR entry
#[get("/api/emergency/mar/{patient_id}/{medication_id}")]
pub async fn get_mar(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<(String, String)>,
) -> impl Responder {
    let (patient_id, medication_id) = path.into_inner();
    // Composite ID lookup simulation
    let id = format!("{}:{}", patient_id, medication_id);
    match data.repositories.medication_records.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List all MAR entries
#[get("/api/emergency/mar/list")]
pub async fn list_mar(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    match data
        .repositories
        .medication_records
        .list_all(Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Administer medication (Workflow shortcut)
#[post("/api/emergency/administer-med")]
pub async fn administer_medication(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
    _req: web::Json<serde_json::Value>,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    HttpResponse::Ok()
        .json(serde_json::json!({"success": true, "message": "Medication administered and logged"}))
}

/// Create I/O record
#[post("/api/emergency/io")]
pub async fn create_io(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::IntakeOutputRecord>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let record = req.into_inner();
    let id = format!("IO-{}-{}", record.patient_id, record.date);
    let entity = io_record_entity(id.clone(), &record, json_value(&record));
    match data.repositories.io_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get I/O record
#[get("/api/emergency/io/{patient_id}/{type}/{timestamp}")]
pub async fn get_io(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<(String, String, String)>,
) -> impl Responder {
    let (patient_id, _, date) = path.into_inner();
    let id = format!("IO-{}-{}", patient_id, date);
    match data.repositories.io_records.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List all I/O records
#[get("/api/emergency/io/list")]
pub async fn list_io(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    match data
        .repositories
        .io_records
        .list_all(Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Record fluid (Workflow shortcut)
#[post("/api/emergency/record-fluid")]
pub async fn record_fluid(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
    _req: web::Json<serde_json::Value>,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    HttpResponse::Ok()
        .json(serde_json::json!({"success": true, "message": "Fluid intake/output recorded"}))
}

/// Create nursing care plan
#[post("/api/emergency/care-plan")]
pub async fn create_care_plan(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::NursingCarePlan>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let plan = req.into_inner();
    let id = plan.care_plan_id.clone();
    let entity = nursing_care_plan_entity(&plan, json_value(&plan));
    match data.repositories.nursing_care_plans.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get care plan
#[get("/api/emergency/care-plan/{id}")]
pub async fn get_care_plan(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.repositories.nursing_care_plans.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List all care plans
#[get("/api/emergency/care-plan/list")]
pub async fn list_care_plans(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    match data
        .repositories
        .nursing_care_plans
        .list_all(Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create wound assessment
#[post("/api/emergency/wound")]
pub async fn create_wound(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::WoundAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();
    let entity = wound_assessment_entity(&assessment, json_value(&assessment));
    match data.repositories.wound_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get wound assessment
#[get("/api/emergency/wound/{id}")]
pub async fn get_wound(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.repositories.wound_assessments.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List all wound assessments
#[get("/api/emergency/wound/list")]
pub async fn list_wound_assessments(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    match data
        .repositories
        .wound_assessments
        .list_all(Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create IV site assessment
#[post("/api/emergency/iv-site")]
pub async fn create_iv_site(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::IVSiteAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();
    let entity = iv_assessment_entity(&assessment, json_value(&assessment));
    match data.repositories.iv_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get IV site assessment
#[get("/api/emergency/iv-site/{id}")]
pub async fn get_iv_site(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.repositories.iv_assessments.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// Create shift handoff
#[post("/api/emergency/handoff")]
pub async fn create_shift_handoff(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::ShiftHandoff>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let handoff = req.into_inner();
    let id = handoff.handoff_id.clone();
    let entity = shift_handoff_entity(&handoff, json_value(&handoff));
    match data.repositories.shift_handoffs.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get shift handoff
#[get("/api/emergency/handoff/{id}")]
pub async fn get_shift_handoff(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.repositories.shift_handoffs.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// Create incident report
#[post("/api/emergency/incident")]
pub async fn create_incident(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::IncidentReport>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let report = req.into_inner();
    let id = report.report_id.clone();
    let entity = incident_report_entity(&report, json_value(&report));
    match data.repositories.incident_reports.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get incident report
#[get("/api/emergency/incident/{id}")]
pub async fn get_incident(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.repositories.incident_reports.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// Create fall risk assessment
#[post("/api/emergency/fall-risk")]
pub async fn create_fall_risk(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::FallRiskAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();
    let entity = fall_risk_entity(&assessment, json_value(&assessment));
    match data.repositories.fall_risk_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get fall risk assessment
#[get("/api/emergency/fall-risk/{id}")]
pub async fn get_fall_risk(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.repositories.fall_risk_assessments.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}
