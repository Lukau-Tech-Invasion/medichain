use super::*;

// ============================================================================
// ACUTE CRISIS EVENTS
// ============================================================================

/// Create code blue record
#[post("/api/emergency/code-blue")]
pub async fn create_code_blue(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CodeBlueRecord>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let record = req.into_inner();
    let id = record.event_id.clone();
    let owner_id = record.patient_id.clone();

    let _ = data
        .repositories
        .access_logs
        .create(access_log_entity(
            current_user_id,
            "medical_team",
            "create_code_blue",
            Some(owner_id),
        ))
        .await;

    let entity = code_blue_entity(&record, json_value(&record));
    match data.repositories.code_blue.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get code blue record
#[get("/api/emergency/code-blue/{id}")]
pub async fn get_code_blue(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.repositories.code_blue.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List code blue records for a patient
#[get("/api/emergency/code-blue/patient/{patient_id}")]
pub async fn list_patient_code_blues(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    let pagination = Pagination::new(0, 50);
    match data
        .repositories
        .code_blue
        .get_by_patient(&patient_id, pagination)
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create cardiac event record
#[post("/api/emergency/cardiac")]
pub async fn create_cardiac(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CardiacEvent>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let event = req.into_inner();
    let id = event.event_id.clone();

    let _ = data
        .repositories
        .access_logs
        .create(access_log_entity(
            current_user_id,
            "medical_team",
            "create_cardiac_event",
            Some(event.patient_id.clone()),
        ))
        .await;

    let entity = cardiac_entity(&event, json_value(&event));
    match data.repositories.cardiac_events_repo.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get cardiac event record
#[get("/api/emergency/cardiac/{id}")]
pub async fn get_cardiac(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.repositories.cardiac_events_repo.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}
