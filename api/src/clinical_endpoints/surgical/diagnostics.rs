use super::*;

// ============================================================================
// ANESTHESIA & DIAGNOSTICS
// ============================================================================

/// Create anesthesia record
#[post("/api/surgical/anesthesia")]
pub async fn create_anesthesia(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AnesthesiaRecord>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let record = req.into_inner();
    let id = record.record_id.clone();
    let owner_id = record.patient_id.clone();

    // Log access
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: owner_id.clone(),
                accessor_id: current_user_id,
                accessor_role: "anesthesiologist".to_string(),
                access_type: "create_anesthesia".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    match data.anesthesia_records.write() {
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

/// Get anesthesia record
#[get("/api/surgical/anesthesia/{id}")]
pub async fn get_anesthesia(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.anesthesia_records.read() {
        Ok(records) => records
            .get(&id)
            .map(|record| HttpResponse::Ok().json(record))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List all anesthesia records (Admin/Audit)
#[get("/api/surgical/anesthesia/list")]
pub async fn list_anesthesia(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if !http_req.headers().contains_key("X-User-Id") {
        return HttpResponse::Unauthorized().finish();
    }
    match data.anesthesia_records.read() {
        Ok(records) => HttpResponse::Ok().json(records.values().cloned().collect::<Vec<_>>()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create radiology order
#[post("/api/surgical/radiology/order")]
pub async fn create_radiology_order(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<RadiologyOrder>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let order = req.into_inner();
    let id = order.order_id.clone();
    let owner_id = order.patient_id.clone();

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
                access_type: "create_radiology_order".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    match data.radiology_orders.write() {
        Ok(mut orders) => {
            orders.insert(id.clone(), order);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get radiology order
#[get("/api/surgical/radiology/order/{id}")]
pub async fn get_radiology_order(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.radiology_orders.read() {
        Ok(orders) => orders
            .get(&id)
            .map(|order| HttpResponse::Ok().json(order))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create radiology report
#[post("/api/surgical/radiology/report")]
pub async fn create_radiology_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<RadiologyReport>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let report = req.into_inner();
    let id = report.report_id.clone();
    let owner_id = report.patient_id.clone();

    // Log access
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: owner_id.clone(),
                accessor_id: current_user_id,
                accessor_role: "radiologist".to_string(),
                access_type: "create_radiology_report".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    match data.radiology_reports.write() {
        Ok(mut reports) => {
            reports.insert(id.clone(), report);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get radiology report
#[get("/api/surgical/radiology/report/{id}")]
pub async fn get_radiology_report(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.radiology_reports.read() {
        Ok(reports) => reports
            .get(&id)
            .map(|report| HttpResponse::Ok().json(report))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create pathology report
#[post("/api/surgical/pathology")]
pub async fn create_pathology(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PathologyReport>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let report = req.into_inner();
    let id = report.report_id.clone();
    let owner_id = report.patient_id.clone();

    // Log access
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: owner_id.clone(),
                accessor_id: current_user_id,
                accessor_role: "pathologist".to_string(),
                access_type: "create_pathology".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    match data.pathology_reports.write() {
        Ok(mut reports) => {
            reports.insert(id.clone(), report);
            HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get pathology report
#[get("/api/surgical/pathology/{id}")]
pub async fn get_pathology(
    data: web::Data<AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let id = path.into_inner();
    match data.pathology_reports.read() {
        Ok(reports) => reports
            .get(&id)
            .map(|report| HttpResponse::Ok().json(report))
            .unwrap_or_else(|| HttpResponse::NotFound().finish()),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}
