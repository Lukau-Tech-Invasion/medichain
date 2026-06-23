use super::*;

// ============================================================================
// PERI-OPERATIVE CARE
// ============================================================================

/// Create pre-operative assessment
#[post("/api/surgical/pre-op")]
pub async fn create_pre_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PreOperativeAssessment>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();
    let owner_id = assessment.patient_id.clone();

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: owner_id.clone(),
                accessor_id: current_user_id,
                accessor_role: "doctor".to_string(),
                access_type: "create_pre_op".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    match data.pre_op_assessments.write() {
        Ok(mut assessments) => {
            assessments.insert(id.clone(), assessment);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get pre-operative assessment
#[get("/api/surgical/pre-op/{id}")]
pub async fn get_pre_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let id = path.into_inner();
    match data.pre_op_assessments.read() {
        Ok(assessments) => assessments
            .get(&id)
            .map(|assessment| HttpResponse::Ok().json(assessment))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create operative note
#[post("/api/surgical/operative-note")]
pub async fn create_operative_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<OperativeNote>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let note = req.into_inner();
    let id = note.note_id.clone();
    let owner_id = note.patient_id.clone();

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: owner_id.clone(),
                accessor_id: current_user_id,
                accessor_role: "surgeon".to_string(),
                access_type: "create_operative_note".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    match data.operative_notes.write() {
        Ok(mut notes) => {
            notes.insert(id.clone(), note);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get operative note
#[get("/api/surgical/operative-note/{id}")]
pub async fn get_operative_note(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.operative_notes.read() {
        Ok(notes) => notes
            .get(&id)
            .map(|note| HttpResponse::Ok().json(note))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create post-operative note
#[post("/api/surgical/post-op")]
pub async fn create_post_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PostOperativeNote>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let note = req.into_inner();
    let id = note.note_id.clone();
    let owner_id = note.patient_id.clone();

    // Log access
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: owner_id.clone(),
                accessor_id: current_user_id,
                accessor_role: "doctor".to_string(),
                access_type: "create_post_op".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    match data.post_op_notes.write() {
        Ok(mut notes) => {
            notes.insert(id.clone(), note);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get post-operative note
#[get("/api/surgical/post-op/{id}")]
pub async fn get_post_op(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.post_op_notes.read() {
        Ok(notes) => notes
            .get(&id)
            .map(|note| HttpResponse::Ok().json(note))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}
