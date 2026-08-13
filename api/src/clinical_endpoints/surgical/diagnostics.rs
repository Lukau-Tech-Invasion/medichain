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
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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

    // Persisted through the repository, so the record survives a restart.
    match data
        .repositories
        .anesthesia_records
        .create(record.into())
        .await
    {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("anesthesia record {id} could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Anesthesia record could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get anesthesia record
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_anesthesia`'s authenticated-caller bar.
#[get("/api/surgical/anesthesia/{id}")]
pub async fn get_anesthesia(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.anesthesia_records.get_by_id(&id).await {
        Ok(entity) => match AnesthesiaRecord::try_from(entity) {
            Ok(record) => HttpResponse::Ok().json(record),
            Err(e) => {
                // Half an anesthesia record is more dangerous than none.
                log::error!("anesthesia record {id} stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored anesthesia record could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("anesthesia record {id} lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// List anesthesia records.
///
/// Previously returned *every* record in the deployment to any clinical staff
/// member — one of the unscoped bulk reads in the multi-tenant backlog. The
/// cross-patient view is now the administrator audit case only; an ordinary
/// anaesthetist gets the records they are responsible for, which is what the
/// portal's list actually needs.
#[get("/api/surgical/anesthesia/list")]
pub async fn list_anesthesia(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let entities = if caller.role.is_admin() {
        data.repositories.anesthesia_records.list_all().await
    } else {
        data.repositories
            .anesthesia_records
            .get_by_provider(
                &caller.wallet_address,
                crate::repositories::Pagination::new(0, 200),
            )
            .await
            .map(|page| page.items)
    };

    match entities {
        Ok(entities) => {
            let mut items = Vec::with_capacity(entities.len());
            for entity in entities {
                let id = entity.id.clone();
                match AnesthesiaRecord::try_from(entity) {
                    Ok(record) => items.push(record),
                    Err(e) => {
                        log::error!("anesthesia record {id} stored payload is unreadable: {e}");
                        return HttpResponse::InternalServerError().json(ErrorResponse {
                            success: false,
                            error: "One or more stored anesthesia records could not be read"
                                .to_string(),
                            code: "RECORD_UNREADABLE".to_string(),
                        });
                    }
                }
            }
            HttpResponse::Ok().json(items)
        }
        Err(e) => {
            log::error!("anesthesia record list failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create radiology order
#[post("/api/surgical/radiology/order")]
pub async fn create_radiology_order(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<RadiologyOrder>,
) -> impl Responder {
    // An imaging order is an accountable clinical act, so the ordering provider
    // is whoever placed it — not whoever the body names. `ordering_provider`
    // was previously persisted straight from the request with no comparison
    // against the caller (docs/WORKFLOW_AUDIT.md, WF-021). Unlike scheduling,
    // this admits no administrator override: delegating the *act* of ordering
    // would misattribute clinical responsibility.
    let caller = match crate::support::require_actor_is_caller(
        &data,
        &http_req,
        Some(req.ordering_provider.as_str()),
    ) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let current_user_id = caller.wallet_address.clone();

    let mut order = req.into_inner();
    // Stamp it from the session so the stored record cannot disagree with the
    // authenticated identity even if the check above is ever relaxed.
    order.ordering_provider = caller.wallet_address.clone();
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
                // The caller's actual role. This was the literal "doctor",
                // so a lab technician or pharmacist placing an order was
                // recorded in the audit trail as a doctor.
                accessor_role: caller.role.to_string(),
                access_type: "create_radiology_order".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    // Persisted through the repository, so it survives a restart.
    match data
        .repositories
        .radiology_orders
        .create(order.into())
        .await
    {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("radiology order {id} could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Radiology order could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get radiology order
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_radiology_order`'s authenticated-caller bar.
#[get("/api/surgical/radiology/order/{id}")]
pub async fn get_radiology_order(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.radiology_orders.get_by_id(&id).await {
        Ok(entity) => match RadiologyOrder::try_from(entity) {
            Ok(order) => HttpResponse::Ok().json(order),
            Err(e) => {
                // A partial radiology order is more dangerous than none.
                log::error!("radiology order {id} stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored radiology order could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("radiology order {id} lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create radiology report
#[post("/api/surgical/radiology/report")]
pub async fn create_radiology_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<RadiologyReport>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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

    // Persisted through the repository, so it survives a restart.
    match data
        .repositories
        .radiology_reports
        .create(report.into())
        .await
    {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("radiology report {id} could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Radiology report could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get radiology report
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_radiology_report`'s authenticated-caller bar.
#[get("/api/surgical/radiology/report/{id}")]
pub async fn get_radiology_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.radiology_reports.get_by_id(&id).await {
        Ok(entity) => match RadiologyReport::try_from(entity) {
            Ok(report) => HttpResponse::Ok().json(report),
            Err(e) => {
                // A partial radiology report is more dangerous than none.
                log::error!("radiology report {id} stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored radiology report could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("radiology report {id} lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create pathology report
#[post("/api/surgical/pathology")]
pub async fn create_pathology(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PathologyReport>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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

    // Persisted through the repository, so it survives a restart.
    match data
        .repositories
        .pathology_reports
        .create(report.into())
        .await
    {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("pathology report {id} could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Pathology report could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get pathology report
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_pathology`'s authenticated-caller bar.
#[get("/api/surgical/pathology/{id}")]
pub async fn get_pathology(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.pathology_reports.get_by_id(&id).await {
        Ok(entity) => match PathologyReport::try_from(entity) {
            Ok(report) => HttpResponse::Ok().json(report),
            Err(e) => {
                // A partial pathology report is more dangerous than none.
                log::error!("pathology report {id} stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored pathology report could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("pathology report {id} lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}
