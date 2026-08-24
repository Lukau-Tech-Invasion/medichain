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
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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

    // Persisted through the repository, so the assessment survives a restart.
    // The full payload — including the WHO checklist's site_verified and
    // site_marked — is carried in record_json; see types::conversions.
    match data
        .repositories
        .pre_op_assessments
        .create(assessment.into())
        .await
    {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("pre-op assessment {id} could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Pre-operative assessment could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
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
    match data.repositories.pre_op_assessments.get_by_id(&id).await {
        Ok(entity) => match PreOperativeAssessment::try_from(entity) {
            Ok(assessment) => HttpResponse::Ok().json(assessment),
            Err(e) => {
                // The stored payload could not be read back. Half an assessment
                // is more dangerous than none, so this is an error, not a
                // partial response.
                log::error!("pre-op assessment {id} stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored assessment could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("pre-op assessment {id} lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
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
    match data
        .repositories
        .pre_op_assessments
        .get_by_patient(&patient_id, crate::repositories::Pagination::new(0, 100))
        .await
    {
        Ok(page) => {
            // A row whose payload will not deserialize is reported, not
            // silently skipped: a pre-op list that quietly omits an assessment
            // reads as "this patient has none", which is the wrong answer.
            let mut items = Vec::with_capacity(page.items.len());
            for entity in page.items {
                let id = entity.id.clone();
                match PreOperativeAssessment::try_from(entity) {
                    Ok(assessment) => items.push(assessment),
                    Err(e) => {
                        log::error!("pre-op assessment {id} stored payload is unreadable: {e}");
                        return HttpResponse::InternalServerError().json(ErrorResponse {
                            success: false,
                            error: "One or more stored assessments could not be read".to_string(),
                            code: "RECORD_UNREADABLE".to_string(),
                        });
                    }
                }
            }
            HttpResponse::Ok().json(items)
        }
        Err(e) => {
            log::error!("pre-op assessments could not be listed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create operative note
#[post("/api/surgical/operative-note")]
pub async fn create_operative_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<OperativeNote>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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

    // Persisted through the repository, so the note survives a restart.
    match data.repositories.operative_notes.create(note.into()).await {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("operative note {id} could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Operative note could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
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
    match data.repositories.operative_notes.get_by_id(&id).await {
        Ok(entity) => match OperativeNote::try_from(entity) {
            Ok(note) => HttpResponse::Ok().json(note),
            Err(e) => {
                // Half an operative note is more dangerous than none.
                log::error!("operative note {id} stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored operative note could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("operative note {id} lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
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
    match data
        .repositories
        .operative_notes
        .get_by_patient(&patient_id, crate::repositories::Pagination::new(0, 100))
        .await
    {
        Ok(page) => {
            // An unreadable row is reported, not skipped: a list that quietly
            // omits a note reads as "this patient has none".
            let mut items = Vec::with_capacity(page.items.len());
            for entity in page.items {
                let id = entity.id.clone();
                match OperativeNote::try_from(entity) {
                    Ok(note) => items.push(note),
                    Err(e) => {
                        log::error!("operative note {id} stored payload is unreadable: {e}");
                        return HttpResponse::InternalServerError().json(ErrorResponse {
                            success: false,
                            error: "One or more stored operative notes could not be read"
                                .to_string(),
                            code: "RECORD_UNREADABLE".to_string(),
                        });
                    }
                }
            }
            HttpResponse::Ok().json(items)
        }
        Err(e) => {
            log::error!("operative note list failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create post-operative note
#[post("/api/surgical/post-op")]
pub async fn create_post_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PostOperativeNote>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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

    // Persisted through the repository, so the note survives a restart.
    match data.repositories.post_op_notes.create(note.into()).await {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("post-op note {id} could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Post-operative note could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
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
    match data.repositories.post_op_notes.get_by_id(&id).await {
        Ok(entity) => match PostOperativeNote::try_from(entity) {
            Ok(note) => HttpResponse::Ok().json(note),
            Err(e) => {
                log::error!("post-op note {id} stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored post-operative note could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("post-op note {id} lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
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
    match data
        .repositories
        .post_op_notes
        .get_by_patient(&patient_id, crate::repositories::Pagination::new(0, 100))
        .await
    {
        Ok(page) => {
            let mut items = Vec::with_capacity(page.items.len());
            for entity in page.items {
                let id = entity.id.clone();
                match PostOperativeNote::try_from(entity) {
                    Ok(note) => items.push(note),
                    Err(e) => {
                        log::error!("post-op note {id} stored payload is unreadable: {e}");
                        return HttpResponse::InternalServerError().json(ErrorResponse {
                            success: false,
                            error: "One or more stored post-operative notes could not be read"
                                .to_string(),
                            code: "RECORD_UNREADABLE".to_string(),
                        });
                    }
                }
            }
            HttpResponse::Ok().json(items)
        }
        Err(e) => {
            log::error!("post-op note list failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}
