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
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all
/// before returning the full record by bare `{id}`. Now matches
/// `create_code_blue`'s authenticated-caller bar.
#[get("/api/emergency/code-blue/{id}")]
pub async fn get_code_blue(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.code_blue.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List code blue records for a patient
///
/// HZ-009 audit: same unauthenticated-read gap as `get_code_blue` above.
#[get("/api/emergency/code-blue/patient/{patient_id}")]
pub async fn list_patient_code_blues(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // HZ-019 IDOR follow-up: previously authenticated-only, so an unrelated
    // patient could read this patient's code-blue records. A cross-patient sweep
    // masked it (the victim had no records); code inspection confirmed the gap.
    // Apply provider-or-self, matching the clinical endpoints.
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    match get_user(&data, &current_user_id) {
        Some(u) if u.role.is_healthcare_provider() || current_user_id == patient_id => {}
        Some(_) => {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Access denied".to_string(),
                code: "ACCESS_DENIED".to_string(),
            })
        }
        None => return HttpResponse::Unauthorized().finish(),
    }

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
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all
/// before returning the full record by bare `{id}`. Now matches
/// `create_cardiac`'s authenticated-caller bar.
#[get("/api/emergency/cardiac/{id}")]
pub async fn get_cardiac(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.cardiac_events_repo.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List a patient's cardiac events (provider or the patient themselves).
///
/// Connects the Emergency Protocols page's cardiac tab; the repository already
/// supported `get_by_patient`.
#[get("/api/emergency/cardiac/patient/{patient_id}")]
pub async fn list_patient_cardiac(
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
        .cardiac_events_repo
        .get_by_patient(&patient_id, Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}
