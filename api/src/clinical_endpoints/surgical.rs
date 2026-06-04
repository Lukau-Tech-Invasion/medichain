//! `clinical_endpoints::surgical` — handlers split out of the original 21K-line monolith (Phase 10.1).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// Phase 9: Surgical Documentation
// ============================================================================

/// Create pre-operative assessment
#[post("/api/clinical/pre-op")]
pub async fn create_pre_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PreOperativeAssessment>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let assessment = req.into_inner();
    let assessment_id = assessment.assessment_id.clone();
    let now = chrono::Utc::now();
    let entity = PreOpAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        data: serde_json::to_value(&assessment).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.pre_op_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get pre-operative assessment
#[get("/api/clinical/pre-op/{assessment_id}")]
pub async fn get_pre_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .pre_op_assessments
        .get_by_id(&assessment_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Pre-operative assessment not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create operative note
#[post("/api/clinical/operative-note")]
pub async fn create_operative_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<OperativeNote>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let note = req.into_inner();
    let note_id = note.note_id.clone();
    let now = chrono::Utc::now();
    let entity = OperativeNoteEntity {
        id: note_id.clone(),
        patient_id: note.patient_id.clone(),
        data: serde_json::to_value(&note).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.operative_notes.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "note_id": note_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get operative note
#[get("/api/clinical/operative-note/{note_id}")]
pub async fn get_operative_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let note_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.operative_notes.get_by_id(&note_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Operative note not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create post-operative note
#[post("/api/clinical/post-op")]
pub async fn create_post_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PostOperativeNote>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let note = req.into_inner();
    let note_id = note.note_id.clone();
    let now = chrono::Utc::now();
    let entity = PostOpNoteEntity {
        id: note_id.clone(),
        patient_id: note.patient_id.clone(),
        data: serde_json::to_value(&note).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.post_op_notes.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "note_id": note_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get post-operative note
#[get("/api/clinical/post-op/{note_id}")]
pub async fn get_post_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let note_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.post_op_notes.get_by_id(&note_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Post-operative note not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 10: Anesthesia Records
// ============================================================================

/// Create anesthesia record
#[post("/api/clinical/anesthesia")]
pub async fn create_anesthesia(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AnesthesiaRecord>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let record_id = record.record_id.clone();
    let now = chrono::Utc::now();
    let entity = AnesthesiaRecordEntity {
        id: record_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.anesthesia_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "record_id": record_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get anesthesia record
#[get("/api/clinical/anesthesia/{record_id}")]
pub async fn get_anesthesia(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let record_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .anesthesia_records
        .get_by_id(&record_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Anesthesia record not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all anesthesia records
#[get("/api/clinical/anesthesia")]
pub async fn list_anesthesia(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record_list = data
        .repositories
        .anesthesia_records
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(record_list)
}

// ============================================================================
// Phase 11: Radiology & Imaging
// ============================================================================

/// Create radiology order
#[post("/api/clinical/radiology/order")]
pub async fn create_radiology_order(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<RadiologyOrder>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let order = req.into_inner();
    let order_id = order.order_id.clone();
    let now = chrono::Utc::now();
    let entity = RadiologyOrderEntity {
        id: order_id.clone(),
        patient_id: order.patient_id.clone(),
        data: serde_json::to_value(&order).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.radiology_orders.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "order_id": order_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get radiology order
#[get("/api/clinical/radiology/order/{order_id}")]
pub async fn get_radiology_order(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let order_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .radiology_orders
        .get_by_id(&order_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Radiology order not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create radiology report
#[post("/api/clinical/radiology/report")]
pub async fn create_radiology_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<RadiologyReport>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let report = req.into_inner();
    let report_id = report.report_id.clone();
    let now = chrono::Utc::now();
    let entity = RadiologyReportEntity {
        id: report_id.clone(),
        patient_id: report.patient_id.clone(),
        data: serde_json::to_value(&report).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.radiology_reports.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "report_id": report_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get radiology report
#[get("/api/clinical/radiology/report/{report_id}")]
pub async fn get_radiology_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let report_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .radiology_reports
        .get_by_id(&report_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Radiology report not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
// ============================================================================
// Phase 12: Pathology Reports
// ============================================================================

/// Create pathology report
#[post("/api/clinical/pathology")]
pub async fn create_pathology(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PathologyReport>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let report = req.into_inner();
    let report_id = report.report_id.clone();
    let now = chrono::Utc::now();
    let entity = PathologyReportEntity {
        id: report_id.clone(),
        patient_id: report.patient_id.clone(),
        data: serde_json::to_value(&report).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.pathology_reports.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "report_id": report_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get pathology report
#[get("/api/clinical/pathology/{report_id}")]
pub async fn get_pathology(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let report_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .pathology_reports
        .get_by_id(&report_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Pathology report not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 13: Immunization Records
// ============================================================================

/// Create immunization record
#[post("/api/clinical/immunization")]
pub async fn create_immunization(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ImmunizationRecord>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let record_id = record.record_id.clone();
    let entity: ImmunizationRecordEntity = record.into();

    match data.repositories.immunization_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "record_id": record_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get immunization record
#[get("/api/clinical/immunization/{record_id}")]
pub async fn get_immunization(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let record_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .immunization_records
        .get_by_id(&record_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Immunization record not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 14: Family Medical History
// ============================================================================

/// Create/update family medical history
#[post("/api/clinical/family-history")]
pub async fn create_family_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<FamilyMedicalHistory>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let history = req.into_inner();
    let patient_id = history.patient_id.clone();
    let now = chrono::Utc::now();
    let entity = FamilyMedicalHistoryEntity {
        id: format!("fmh-{}", uuid::Uuid::new_v4()),
        patient_id: patient_id.clone(),
        data: serde_json::to_value(&history).unwrap_or_default(),
        created_at: Some(now),
        updated_at: Some(now),
        ..Default::default()
    };

    match data
        .repositories
        .family_medical_histories
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "patient_id": patient_id
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get family medical history
#[get("/api/clinical/family-history/{patient_id}")]
pub async fn get_family_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Healthcare provider or patient viewing own history
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    match data
        .repositories
        .family_medical_histories
        .get_by_patient(&patient_id)
        .await
    {
        Ok(entities) if !entities.is_empty() => {
            let history_data: Vec<serde_json::Value> =
                entities.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(history_data)
        }
        Ok(_) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Family medical history not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 15: Blood Bank
// ============================================================================

/// Create blood type screen
#[post("/api/clinical/blood-bank/type-screen")]
pub async fn create_blood_type_screen(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<BloodTypeScreen>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let screen = req.into_inner();
    let test_id = screen.test_id.clone();
    let now = chrono::Utc::now();
    let entity = BloodTypeScreenEntity {
        id: test_id.clone(),
        patient_id: screen.patient_id.clone(),
        data: serde_json::to_value(&screen).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.blood_type_screens.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "test_id": test_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get blood type screen
#[get("/api/clinical/blood-bank/type-screen/{test_id}")]
pub async fn get_blood_type_screen(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let test_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .blood_type_screens
        .get_by_id(&test_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Blood type screen not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create transfusion record
#[post("/api/clinical/blood-bank/transfusion")]
pub async fn create_transfusion(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<TransfusionRecord>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let transfusion = req.into_inner();
    let transfusion_id = transfusion.transfusion_id.clone();
    let now = chrono::Utc::now();
    let entity = TransfusionRecordEntity {
        id: transfusion_id.clone(),
        patient_id: transfusion.patient_id.clone(),
        data: serde_json::to_value(&transfusion).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.transfusion_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "transfusion_id": transfusion_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get transfusion record
#[get("/api/clinical/blood-bank/transfusion/{transfusion_id}")]
pub async fn get_transfusion(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let transfusion_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .transfusion_records
        .get_by_id(&transfusion_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Transfusion record not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
// ============================================================================
// Phase 16: E-Prescribing
// ============================================================================

/// Create electronic prescription
#[post("/api/clinical/e-prescription")]
pub async fn create_e_prescription(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ElectronicPrescription>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let rx = req.into_inner();
    let rx_id = rx.rx_id.clone();
    let now = chrono::Utc::now();

    // ── 4.1: automatic drug-interaction screen ───────────────────────────────
    // Screen the new medication against the patient's current medications via the
    // shared curated table. Contraindicated combinations block the save unless the
    // prescriber explicitly overrides; major/moderate are recorded and surfaced.
    let mut new_meds = vec![rx.medication_name.clone()];
    if !rx.generic_name.trim().is_empty()
        && !rx.generic_name.eq_ignore_ascii_case(&rx.medication_name)
    {
        new_meds.push(rx.generic_name.clone());
    }
    let current_meds: Vec<String> = data
        .repositories
        .patients
        .get_by_id(&rx.patient_id)
        .await
        .ok()
        .and_then(|e| crate::patient_entity_to_profile(&e, &data.encryption_key))
        .map(|p| p.emergency_info.current_medications)
        .unwrap_or_default();
    let mut screen_list = current_meds;
    screen_list.extend(new_meds.iter().cloned());
    let interactions: Vec<crate::clinical::DrugInteraction> =
        evaluate_drug_interactions(&screen_list)
            .into_iter()
            .filter(|x| {
                let a = x.drug_a.to_lowercase();
                let b = x.drug_b.to_lowercase();
                new_meds.iter().any(|n| {
                    let n = n.to_lowercase();
                    a.contains(&n) || b.contains(&n)
                })
            })
            .collect();
    let has_contraindicated = interactions.iter().any(|i| {
        matches!(
            i.severity,
            crate::clinical::InteractionSeverity::Contraindicated
        )
    });
    let has_major = interactions
        .iter()
        .any(|i| matches!(i.severity, crate::clinical::InteractionSeverity::Major));

    // Block contraindicated combinations unless explicitly overridden.
    if has_contraindicated && !rx.override_interactions {
        return HttpResponse::Conflict().json(
            crate::middleware::error_handling::error_envelope_json(
                "INTERACTION_CONTRAINDICATED",
                "Contraindicated drug interaction detected — prescription blocked. \
                 Resubmit with override_interactions=true and an override_reason to proceed.",
                Some(serde_json::json!({
                    "override_required": true,
                    "interactions": interactions,
                })),
            ),
        );
    }

    // Record an audit trail + notify the care team for major/contraindicated combos.
    if has_contraindicated || has_major {
        let result = crate::clinical::DrugInteractionResult {
            result_id: format!("RXCHK-{}", uuid::Uuid::new_v4()),
            patient_id: rx.patient_id.clone(),
            checked_at: now.timestamp(),
            new_medication: rx.medication_name.clone(),
            interactions: interactions.clone(),
            overall_severity: if has_contraindicated {
                crate::clinical::InteractionSeverity::Contraindicated
            } else {
                crate::clinical::InteractionSeverity::Major
            },
            safe_to_prescribe: false,
            checked_by: current_user_id.clone(),
        };
        let audit = crate::repositories::traits::JsonRecordEntity {
            id: result.result_id.clone(),
            owner_id: rx.patient_id.clone(),
            data: serde_json::to_value(&result).unwrap_or_default(),
            created_at: now,
            updated_at: now,
        };
        let _ = data
            .repositories
            .drug_interaction_checks
            .create(audit)
            .await;
        crate::websocket::push_cds_alert(
            &data.ws_manager,
            &rx.patient_id,
            "Drug interaction at prescribing",
            if has_contraindicated {
                "Contraindicated"
            } else {
                "Major"
            },
        );
    }

    let entity = EPrescriptionEntity {
        id: rx_id.clone(),
        patient_id: rx.patient_id.clone(),
        data: serde_json::to_value(&rx).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.e_prescriptions.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "rx_id": rx_id,
            "interaction_warning": has_contraindicated || has_major,
            "interactions": interactions,
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get electronic prescription
#[get("/api/clinical/e-prescription/{rx_id}")]
pub async fn get_e_prescription(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let rx_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.e_prescriptions.get_by_id(&rx_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Prescription not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 17: Appointments
// ============================================================================

/// Create appointment
#[post("/api/clinical/appointment")]
pub async fn create_appointment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<Appointment>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Any healthcare provider or patient can create appointments
    if !current_user.role.is_healthcare_provider() && current_user_id != req.patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let appointment = req.into_inner();
    let appointment_id = appointment.appointment_id.clone();
    let patient_id = appointment.patient_id.clone();
    let appointment_date = appointment.scheduled_date.clone();
    let provider_name = appointment.provider_name.clone();
    let now = chrono::Utc::now();

    let entity = AppointmentEntity {
        id: appointment_id.clone(),
        patient_id: patient_id.clone(),
        data: serde_json::to_value(&appointment).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.appointments.create(entity).await {
        Ok(_) => {
            // Fire-and-forget FCM push notification to the patient.
            let repos = data.repositories.clone();
            let patient_id_clone = patient_id.clone();
            tokio::spawn(async move {
                crate::notifications::notify_appointment(
                    &repos,
                    &patient_id_clone,
                    &appointment_date,
                    &provider_name,
                )
                .await;
            });

            HttpResponse::Created().json(serde_json::json!({
                "success": true,
                "appointment_id": appointment_id
            }))
        }
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get appointment
#[get("/api/clinical/appointment/{appointment_id}")]
pub async fn get_appointment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let appointment_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    match data
        .repositories
        .appointments
        .get_by_id(&appointment_id)
        .await
    {
        Ok(entity) => {
            // Patients can only see their own appointments
            if !current_user.role.is_healthcare_provider() && current_user_id != entity.patient_id {
                return HttpResponse::Forbidden().json(ErrorResponse {
                    success: false,
                    error: "Access denied".to_string(),
                    code: "ACCESS_DENIED".to_string(),
                });
            }
            HttpResponse::Ok().json(entity.data)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Appointment not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 18: Death Certificate & Autopsy
// ============================================================================

/// Create death certificate
#[post("/api/clinical/death-certificate")]
pub async fn create_death_certificate(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<DeathCertificate>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let cert = req.into_inner();
    let certificate_id = cert.certificate_id.clone();
    let now = chrono::Utc::now();
    let entity = DeathRecordEntity {
        id: certificate_id.clone(),
        patient_id: cert.patient_id.clone(),
        data: serde_json::to_value(&cert).unwrap_or_default(),
        created_at: Some(now),
        updated_at: Some(now),
        ..Default::default()
    };

    match data.repositories.death_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "certificate_id": certificate_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get death certificate
#[get("/api/clinical/death-certificate/{certificate_id}")]
pub async fn get_death_certificate(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let certificate_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .death_records
        .get_by_id(&certificate_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Death certificate not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create autopsy request
#[post("/api/clinical/autopsy/request")]
pub async fn create_autopsy_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AutopsyRequest>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let request_id = req.request_id.clone();
    {
        // Persist via repository (was: in-memory data.autopsy_requests HashMap)
        let value = serde_json::to_value(req.into_inner()).unwrap_or_default();
        let owner = value
            .get("deceased_id")
            .or_else(|| value.get("patient_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: request_id.clone(),
            owner_id: owner,
            data: value,
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.autopsy_requests.create(entity).await;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "request_id": request_id
    }))
}

/// Get autopsy request
#[get("/api/clinical/autopsy/request/{request_id}")]
pub async fn get_autopsy_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let request_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let stored = data
        .repositories
        .autopsy_requests
        .get_by_id(&request_id)
        .await
        .ok()
        .flatten();
    match stored {
        Some(record) => HttpResponse::Ok().json(record.data),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Autopsy request not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
    }
}

// ============================================================================
// Phase 19: Patient Satisfaction Surveys
// ============================================================================

/// Create patient satisfaction survey
#[post("/api/clinical/satisfaction-survey")]
pub async fn create_satisfaction_survey(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PatientSatisfactionSurvey>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let _current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Any authenticated user can submit a survey
    let survey_id = req.survey_id.clone();
    {
        // Persist via repository (was: in-memory data.satisfaction_surveys HashMap)
        let value = serde_json::to_value(req.into_inner()).unwrap_or_default();
        let owner = value
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: survey_id.clone(),
            owner_id: owner,
            data: value,
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.satisfaction_surveys.create(entity).await;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "survey_id": survey_id
    }))
}

/// Get patient satisfaction survey
#[get("/api/clinical/satisfaction-survey/{survey_id}")]
pub async fn get_satisfaction_survey(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let survey_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only admins can view surveys (for privacy)
    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let stored = data
        .repositories
        .satisfaction_surveys
        .get_by_id(&survey_id)
        .await
        .ok()
        .flatten();
    match stored {
        Some(record) => HttpResponse::Ok().json(record.data),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Survey not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
    }
}
