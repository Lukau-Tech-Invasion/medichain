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
            log::error!("anesthesia record could not be stored: {e}");
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
                log::error!("anesthesia record stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored anesthesia record could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("anesthesia-record lookup failed: {e}");
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
                match AnesthesiaRecord::try_from(entity) {
                    Ok(record) => items.push(record),
                    Err(e) => {
                        log::error!("anesthesia record stored payload is unreadable: {e}");
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
            log::error!("radiology order could not be stored: {e}");
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
                log::error!("radiology order stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored radiology order could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("radiology-order lookup failed: {e}");
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
            log::error!("radiology report could not be stored: {e}");
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
                log::error!("radiology report stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored radiology report could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("radiology-report lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// What the pathology page actually submits: a specimen accession, not a report.
///
/// The typed `PathologyReport` is the *finished* report — accession number,
/// special stains, IHC, molecular studies, synoptic cancer dataset. The lab
/// screen accessions a specimen long before any of that exists, and sends the
/// tracking record instead: who collected it, from where, in what fixative, and
/// where it currently sits in the grossing/processing/staining workflow.
///
/// Requiring the report shape meant every accession was rejected with a
/// deserialization error naming a status variant the page has never used, so a
/// specimen could not be booked in at all. Both shapes are accepted now: this
/// DTO takes the accession, and the report fields stay optional so the same
/// endpoint can carry a completed report.
#[derive(Debug, serde::Deserialize)]
pub struct CreatePathologyRequest {
    #[serde(alias = "specimenId", alias = "report_id", alias = "reportId")]
    pub specimen_id: String,
    #[serde(alias = "patientId")]
    pub patient_id: String,
    #[serde(default, alias = "specimenType")]
    pub specimen_type: Option<String>,
    #[serde(default)]
    pub site: Option<String>,
    #[serde(default, alias = "collectionDate")]
    pub collection_date: Option<String>,
    #[serde(default, alias = "clinicalHistory")]
    pub clinical_history: Option<String>,
    #[serde(default, alias = "grossDescription")]
    pub gross_description: Option<String>,
    #[serde(default, alias = "microscopicDescription")]
    pub microscopic_description: Option<String>,
    #[serde(default)]
    pub diagnosis: Option<serde_json::Value>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub clinician: Option<String>,
    #[serde(default)]
    pub pathologist: Option<String>,
    /// Everything the page sends, kept verbatim so the worklist can read back
    /// the fields the typed columns have no home for (priority, container,
    /// fixative, laterality, blocks, slides).
    #[serde(flatten)]
    pub rest: std::collections::HashMap<String, serde_json::Value>,
}

/// Create pathology specimen accession or report
#[post("/api/surgical/pathology")]
pub async fn create_pathology(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreatePathologyRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let body = req.into_inner();
    let id = body.specimen_id.clone();
    let owner_id = body.patient_id.clone();

    // Log access
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: owner_id.clone(),
                accessor_id: current_user_id.clone(),
                accessor_role: "pathologist".to_string(),
                access_type: "create_pathology".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    let now = chrono::Utc::now();
    let parse_date = |value: &Option<String>| {
        value
            .as_deref()
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            .and_then(|d| d.and_hms_opt(0, 0, 0))
            .map(|dt| dt.and_utc())
            .unwrap_or(now)
    };

    // The whole submission, so the worklist reads back the tracking fields the
    // typed columns cannot hold.
    let mut payload = serde_json::to_value(&body.rest).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(object) = payload.as_object_mut() {
        object.insert("specimenId".into(), serde_json::json!(body.specimen_id));
        object.insert("patientId".into(), serde_json::json!(body.patient_id));
        object.insert("status".into(), serde_json::json!(body.status));
    }

    let entity = crate::repositories::traits::PathologyReportEntity {
        id: id.clone(),
        patient_id: owner_id.clone(),
        // NOT the accession number. `specimen_id` is a foreign key into
        // `specimen_collections` — the physical sample the lab logged in — and
        // the pathology screen's `specimenId` is the accession the report is
        // filed under, which lives in `id`. Binding the accession here violated
        // the foreign key and failed every submission. Populated only when the
        // caller names a collection record that actually exists.
        specimen_id: body
            .rest
            .get("collectionId")
            .or_else(|| body.rest.get("collection_id"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        ordering_provider_id: body
            .clinician
            .clone()
            .unwrap_or_else(|| current_user_id.clone()),
        pathologist_id: body.pathologist.clone().unwrap_or(current_user_id),
        specimen_type: body
            .specimen_type
            .clone()
            .unwrap_or_else(|| "surgical".to_string()),
        specimen_source: body.site.clone().unwrap_or_default(),
        collection_date: parse_date(&body.collection_date),
        received_date: now,
        report_date: now,
        clinical_history: body.clinical_history.clone(),
        gross_description: body.gross_description.clone().unwrap_or_default(),
        microscopic_description: body.microscopic_description.clone().unwrap_or_default(),
        special_stains: None,
        immunohistochemistry: None,
        molecular_studies: None,
        // A diagnosis arrives as a list from the report form and as absent from
        // the accession form; joined so the queryable column holds text either
        // way rather than a JSON blob a `LIKE` cannot search.
        diagnosis: match &body.diagnosis {
            Some(serde_json::Value::Array(items)) => items
                .iter()
                .filter_map(|d| d.as_str())
                .collect::<Vec<_>>()
                .join("; "),
            Some(serde_json::Value::String(s)) => s.clone(),
            _ => String::new(),
        },
        staging: None,
        tnm_classification: None,
        margin_status: None,
        lymph_node_status: None,
        comments: None,
        addendum: None,
        addendum_datetime: None,
        addendum_by: None,
        // Lowercased so the CHECK constraint sees one spelling; a specimen that
        // has not been accessioned into the workflow yet is `received`.
        status: body
            .status
            .clone()
            .unwrap_or_else(|| "received".to_string())
            .to_lowercase(),
        synoptic_report: None,
        created_at: now,
        updated_at: now,
        data: payload,
    };

    // Persisted through the repository, so it survives a restart.
    match data.repositories.pathology_reports.create(entity).await {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("pathology specimen could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Pathology specimen could not be stored".to_string(),
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
                log::error!("pathology report stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored pathology report could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("pathology-report lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}
