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
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let id = path.into_inner();
    match data.pre_op_assessments.read() {
        Ok(assessments) => assessments
            .get(&id)
            .map(|assessment| HttpResponse::Ok().json(assessment))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List a patient's pre-operative assessments (provider or the patient).
///
/// Reads the same store `create_pre_op` writes, so listing sees created
/// records. Added to connect the doctor portal's Pre-Op page, which fetched a
/// per-patient list from a route that did not exist.
#[get("/api/surgical/pre-op/patient/{patient_id}")]
pub async fn list_patient_pre_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_surgical_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data.pre_op_assessments.read() {
        Ok(assessments) => {
            let items: Vec<_> = assessments
                .values()
                .filter(|a| a.patient_id == patient_id)
                .cloned()
                .collect();
            HttpResponse::Ok().json(items)
        }
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
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_operative_note`'s authenticated-caller bar.
#[get("/api/surgical/operative-note/{id}")]
pub async fn get_operative_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.operative_notes.read() {
        Ok(notes) => notes
            .get(&id)
            .map(|note| HttpResponse::Ok().json(note))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List a patient's operative notes (provider or the patient).
#[get("/api/surgical/operative-note/patient/{patient_id}")]
pub async fn list_patient_operative_notes(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_surgical_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data.operative_notes.read() {
        Ok(notes) => {
            let items: Vec<_> = notes
                .values()
                .filter(|n| n.patient_id == patient_id)
                .cloned()
                .collect();
            HttpResponse::Ok().json(items)
        }
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
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_post_op`'s authenticated-caller bar.
#[get("/api/surgical/post-op/{id}")]
pub async fn get_post_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.post_op_notes.read() {
        Ok(notes) => notes
            .get(&id)
            .map(|note| HttpResponse::Ok().json(note))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List a patient's post-operative notes (provider or the patient).
#[get("/api/surgical/post-op/patient/{patient_id}")]
pub async fn list_patient_post_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_surgical_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data.post_op_notes.read() {
        Ok(notes) => {
            let items: Vec<_> = notes
                .values()
                .filter(|n| n.patient_id == patient_id)
                .cloned()
                .collect();
            HttpResponse::Ok().json(items)
        }
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}
