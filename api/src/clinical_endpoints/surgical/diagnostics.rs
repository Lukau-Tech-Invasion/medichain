use super::*;

// ============================================================================
// ANESTHESIA & DIAGNOSTICS
// ============================================================================

/// Create anesthesia record
/// What the anaesthesia page actually submits.
///
/// The typed `AnesthesiaRecord` in `clinical.rs` is a **complete** anaesthetic
/// record: 38 required fields including `pre_assessment`, `airway`,
/// `induction`, `maintenance`, `emergence` and `pacu_handoff` as nested
/// structs. `AnesthesiaPage` collects a summary -- about twenty flat camelCase
/// fields -- so every submission failed deserialization with
/// "missing field `record_id`", which the page surfaced as a generic save
/// failure. The feature could not be used at all.
///
/// Verified against a live server 2026-09-15: `POST /api/surgical/anesthesia`
/// answered 400 for the page's own payload.
///
/// Both shapes are accepted here. The screen's fields map onto the entity's
/// typed columns where one exists, and the whole submission is kept in the
/// record blob, so nothing the clinician entered is dropped -- the same
/// approach as `CreatePathologyRequest`.
#[derive(Debug, serde::Deserialize)]
pub struct CreateAnesthesiaRequest {
    // No `id`: the server assigns the record id.
    #[serde(alias = "patientId")]
    pub patient_id: String,
    #[serde(default, alias = "anesthesiaType")]
    pub anesthesia_type: Option<String>,
    #[serde(default, alias = "asaClass", alias = "asa_classification")]
    pub asa_class: Option<String>,
    #[serde(default, alias = "airwayType", alias = "airway_management")]
    pub airway_type: Option<serde_json::Value>,
    #[serde(default, alias = "inductionAgents")]
    pub induction_agents: Option<serde_json::Value>,
    #[serde(default, alias = "maintenanceAgents")]
    pub maintenance_agents: Option<serde_json::Value>,
    #[serde(default, alias = "relaxants", alias = "neuromuscular_blockers")]
    pub neuromuscular_blockers: Option<serde_json::Value>,
    #[serde(default, alias = "reversals", alias = "reversal_agents")]
    pub reversal_agents: Option<serde_json::Value>,
    #[serde(default, alias = "vasoactives", alias = "vasopressors")]
    pub vasopressors: Option<serde_json::Value>,
    #[serde(default, alias = "fluidsGiven", alias = "intraop_fluids")]
    pub fluids: Option<serde_json::Value>,
    #[serde(default, alias = "bloodProducts")]
    pub blood_products: Option<serde_json::Value>,
    #[serde(default, alias = "vitals", alias = "vital_signs_timeline")]
    pub vital_signs: Option<serde_json::Value>,
    #[serde(default)]
    pub complications: Option<serde_json::Value>,
    // No `anesthesiologist_id` field here on purpose. The column is stamped
    // from the session below, so capturing the body's claim in a typed field
    // would only invite someone to trust it. The screen's `documentedBy` flows
    // into `rest` instead, where it is preserved as what the client asserted
    // rather than as who actually signed in.
    /// Everything else the screen sends -- the procedure, the analgesics and
    /// antiemetics, estimated blood loss, urine output, the timings and the
    /// notes. Kept rather than dropped: a record without the blood loss is not
    /// an anaesthetic record.
    #[serde(flatten)]
    pub rest: serde_json::Map<String, serde_json::Value>,
}

#[post("/api/surgical/anesthesia")]
pub async fn create_anesthesia(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateAnesthesiaRequest>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };
    let current_user_id = current_user.wallet_address.clone();

    let record = req.into_inner();
    let owner_id = record.patient_id.clone();
    if owner_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "patient_id is required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    // Log access
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: owner_id.clone(),
            accessor_id: current_user_id.clone(),
            accessor_role: current_user.role.to_string(),
            access_type: "create_anesthesia".to_string(),
            location: None,
            timestamp: chrono::Utc::now(),
            emergency: false,
        }
        .into(),
    )
    .await
    {
        return response;
    }

    // Persisted through the repository, so the record survives a restart.
    let now = chrono::Utc::now();
    // Server-assigned when the screen does not supply one: the id is the
    // primary key, and a blank one collides on the second record.
    // Server-generated. The page sent `PREFIX-${Date.now()}`; on PostgreSQL a
    // collision was refused, in the in-memory backend it silently replaced the
    // other record. The id is the server's to assign either way.
    let record_id = format!("ANES-{}", uuid::Uuid::new_v4().simple());

    // The whole submission, so the screen reads back the fields the typed
    // columns have no home for.
    let mut payload = serde_json::to_value(&record.rest).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(object) = payload.as_object_mut() {
        object.insert("id".into(), serde_json::json!(record_id));
        object.insert("patient_id".into(), serde_json::json!(owner_id));
    }

    let entity = crate::repositories::traits::AnesthesiaRecordEntity {
        id: record_id.clone(),
        patient_id: owner_id.clone(),
        operative_note_id: None,
        // Stamped from the session. Administering an anaesthetic is an
        // accountable clinical act, so the anaesthetist is whoever is signed
        // in -- not whoever the body names.
        anesthesiologist_id: current_user_id.clone(),
        crna_id: None,
        anesthesia_type: record.anesthesia_type.clone().unwrap_or_default(),
        asa_classification: record.asa_class.clone(),
        airway_management: record.airway_type.clone(),
        induction_agents: record.induction_agents.clone(),
        maintenance_agents: record.maintenance_agents.clone(),
        neuromuscular_blockers: record.neuromuscular_blockers.clone(),
        reversal_agents: record.reversal_agents.clone(),
        vasopressors: record.vasopressors.clone(),
        intraop_fluids: record.fluids.clone(),
        blood_products: record.blood_products.clone(),
        monitoring: None,
        vital_signs_timeline: record.vital_signs.clone(),
        events: None,
        // A list of complications is stored as text here; the structured list
        // survives in the payload above.
        complications: record
            .complications
            .as_ref()
            .and_then(|c| serde_json::to_string(c).ok()),
        emergence_time: None,
        extubation_time: None,
        pacu_arrival_time: None,
        pacu_discharge_time: None,
        aldrete_score_arrival: None,
        aldrete_score_discharge: None,
        post_anesthesia_orders: None,
        created_at: now,
        updated_at: now,
        data: payload,
    };

    match data.repositories.anesthesia_records.create(entity).await {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("anesthesia record could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
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
        // The stored record, not a `AnesthesiaRecord` rebuilt from the blob.
        //
        // `AnesthesiaRecord` is the COMPLETE anaesthetic record -- 38 required
        // fields -- and `AnesthesiaPage` documents a summary. Rebuilding it on
        // read meant every record the portal wrote was "unreadable": the
        // reconstruction failed on `missing field record_id` and the endpoint
        // answered 500. The typed columns are the record; the payload carries
        // the rest.
        Ok(entity) => HttpResponse::Ok().json(entity),
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
        // Same reasoning as `get_anesthesia`, plus one more: rebuilding the
        // strict type per row made a SINGLE unreadable record 500 the entire
        // worklist. One bad row must not hide every good one from the
        // anaesthetist who has to work the list.
        Ok(entities) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "records": entities,
        })),
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
    // Server-generated. The page sent `PREFIX-${Date.now()}`; on PostgreSQL a
    // collision was refused, in the in-memory backend it silently replaced the
    // other record. The id is the server's to assign either way.
    order.order_id = format!("RAD-{}", uuid::Uuid::new_v4().simple());
    // Stamp it from the session so the stored record cannot disagree with the
    // authenticated identity even if the check above is ever relaxed.
    order.ordering_provider = caller.wallet_address.clone();
    let owner_id = order.patient_id.clone();

    // Log access
    if let Err(response) = crate::support::require_durable_audit(
        &data,
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
    .await
    {
        return response;
    }

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
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let current_user_id = caller.wallet_address.clone();

    let report = req.into_inner();
    let owner_id = report.patient_id.clone();

    // Log access
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: owner_id.clone(),
            accessor_id: current_user_id,
            accessor_role: caller.role.to_string(),
            access_type: "create_radiology_report".to_string(),
            location: None,
            timestamp: chrono::Utc::now(),
            emergency: false,
        }
        .into(),
    )
    .await
    {
        return response;
    }

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
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };
    let current_user_id = current_user.wallet_address.clone();

    let body = req.into_inner();
    let id = body.specimen_id.clone();
    let owner_id = body.patient_id.clone();

    // Log access
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: owner_id.clone(),
            accessor_id: current_user_id.clone(),
            accessor_role: current_user.role.to_string(),
            access_type: "create_pathology".to_string(),
            location: None,
            timestamp: chrono::Utc::now(),
            emergency: false,
        }
        .into(),
    )
    .await
    {
        return response;
    }

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
                error: "Pathology specimen could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Fields the pathology worklist may add before a report is finalized.
///
/// This deliberately has no patient, specimen, or author field: those are the
/// immutable accession facts. The authenticated clinician is attributed by the
/// server when a report is saved or finalized.
#[derive(Debug, serde::Deserialize)]
pub struct UpdatePathologyReportRequest {
    pub gross_description: String,
    pub microscopic_description: String,
    pub diagnosis: String,
    #[serde(default)]
    pub blocks: Vec<String>,
    #[serde(default)]
    pub slides: Vec<String>,
    #[serde(default, alias = "specialStains")]
    pub special_stains: Vec<String>,
    #[serde(default, alias = "ihcMarkers")]
    pub ihc_markers: Vec<String>,
    #[serde(default, alias = "snomedCode")]
    pub snomed_code: String,
    #[serde(default, alias = "isCritical")]
    pub is_critical: bool,
    #[serde(default, alias = "communicatedTo")]
    pub communicated_to: String,
    /// Only a saved preliminary report or a final report may be produced here.
    pub status: String,
}

/// Persist a preliminary or final pathology report.
///
/// A finalized result is never overwritten. Corrections require an explicit
/// addendum workflow rather than silently replacing a signed diagnostic result.
#[put("/api/surgical/pathology/{id}")]
pub async fn update_pathology_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<UpdatePathologyReportRequest>,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) if user.role.can_edit_medical_records() => user,
        Ok(_) => {
            return HttpResponse::Forbidden().json(ErrorResponse {
                error: "Only clinical record editors may save pathology reports".to_string(),
                code: "FORBIDDEN".to_string(),
            })
        }
        Err(response) => return response,
    };
    let id = path.into_inner();
    let body = req.into_inner();
    if !matches!(body.status.as_str(), "prelim" | "final") {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "Pathology report status must be prelim or final".to_string(),
            code: "INVALID_STATUS".to_string(),
        });
    }
    if body.status == "final"
        && (body.diagnosis.trim().is_empty() || body.microscopic_description.trim().is_empty())
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "A final pathology report requires diagnosis and microscopic description"
                .to_string(),
            code: "FINAL_REPORT_INCOMPLETE".to_string(),
        });
    }

    let mut report = match data.repositories.pathology_reports.get_by_id(&id).await {
        Ok(report) => report,
        Err(crate::repositories::RepositoryError::NotFound(_)) => {
            return HttpResponse::NotFound().finish()
        }
        Err(error) => {
            log::error!("pathology report lookup failed: {error}");
            return HttpResponse::InternalServerError().finish();
        }
    };
    if report.status == "final" {
        return HttpResponse::Conflict().json(ErrorResponse {
            error: "Final pathology reports cannot be overwritten".to_string(),
            code: "PATHOLOGY_REPORT_FINAL".to_string(),
        });
    }

    let now = chrono::Utc::now();
    report.gross_description = body.gross_description;
    report.microscopic_description = body.microscopic_description;
    report.diagnosis = body.diagnosis;
    report.special_stains = Some(serde_json::json!(body.special_stains));
    report.immunohistochemistry = Some(serde_json::json!(body.ihc_markers));
    report.comments = (!body.snomed_code.trim().is_empty()).then_some(body.snomed_code.clone());
    report.status = body.status;
    report.pathologist_id = caller.wallet_address.clone();
    report.report_date = now;
    report.updated_at = now;
    let payload = report.data.as_object_mut();
    if let Some(payload) = payload {
        payload.insert("blocks".into(), serde_json::json!(body.blocks));
        payload.insert("slides".into(), serde_json::json!(body.slides));
        payload.insert(
            "specialStains".into(),
            serde_json::json!(body.special_stains),
        );
        payload.insert("ihcMarkers".into(), serde_json::json!(body.ihc_markers));
        payload.insert("snomedCode".into(), serde_json::json!(report.comments));
        payload.insert("isCritical".into(), serde_json::json!(body.is_critical));
        payload.insert(
            "communicatedTo".into(),
            serde_json::json!(body.communicated_to),
        );
        payload.insert("status".into(), serde_json::json!(report.status));
    }
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: report.patient_id.clone(),
            accessor_id: caller.wallet_address,
            accessor_role: caller.role.to_string(),
            access_type: "update_pathology_report".to_string(),
            location: None,
            timestamp: now,
            emergency: false,
        }
        .into(),
    )
    .await
    {
        return response;
    }
    match data.repositories.pathology_reports.update(report).await {
        Ok(stored) => {
            HttpResponse::Ok().json(serde_json::json!({"success": true, "id": stored.id}))
        }
        Err(error) => {
            log::error!("pathology report update failed: {error}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Pathology report could not be saved".to_string(),
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

/// The anaesthesia record the portal actually writes.
///
/// `create_anesthesia` took `web::Json<AnesthesiaRecord>` -- the COMPLETE
/// anaesthetic record, 38 required fields including five nested structs --
/// while `AnesthesiaPage` documents a summary of about twenty flat camelCase
/// fields. So every submission the portal made failed deserialization with
/// "missing field `record_id`", which the page surfaced as a generic save
/// failure. The feature could not be used at all, on either backend.
///
/// The read half had the mirror of it: both reads rebuilt the strict type from
/// the stored blob, so a record the portal had written came back 500
/// "unreadable" -- and in the list, a single such row failed the whole
/// worklist.
#[cfg(test)]
mod anesthesia_round_trip_tests {
    use crate::{AppState, Role, User};
    use actix_web::{test, web, App};

    fn state_with(role: Role, wallet: &str) -> web::Data<AppState> {
        let state = AppState::new();
        let user = User {
            wallet_address: wallet.to_string(),
            username: None,
            name: "Test".to_string(),
            role,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        };
        state
            .users
            .write()
            .unwrap()
            .insert(wallet.to_string(), user);
        web::Data::new(state)
    }

    /// `AnesthesiaPage`'s payload, field for field -- camelCase, flat, and
    /// carrying no `record_id`.
    fn page_payload(patient_id: &str, procedure: &str) -> serde_json::Value {
        serde_json::json!({
            "id": format!("ANES-{}", 1_700_000_000_000u64),
            "patientId": patient_id,
            "patientName": "Journey Patient",
            "documentedBy": "someone-the-body-claims",
            "documentedAt": "2026-09-15T09:00:00Z",
            "procedure": procedure,
            "asaClass": "II",
            "anesthesiaType": "general",
            "airwayType": "ETT",
            "inductionAgents": ["Propofol"],
            "maintenanceAgents": ["Sevoflurane"],
            "analgesics": ["Fentanyl"],
            "relaxants": ["Rocuronium"],
            "reversals": [],
            "vasoactives": [],
            "antiemetics": ["Ondansetron"],
            "fluidsGiven": [{ "type": "Crystalloid", "volume": 1000 }],
            "bloodProducts": [],
            "ebl": 150,
            "urineOutput": 250,
            "vitals": [],
            "complications": [],
            "notes": "Uneventful.",
        })
    }

    async fn post_then_list(
        data: web::Data<AppState>,
        wallet: &str,
        body: serde_json::Value,
    ) -> (u16, u16, String) {
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::create_anesthesia)
                // Registered in the same order as `routes.rs`: `/list` must
                // come before `/{id}`, or the literal path is captured as an id.
                .service(super::list_anesthesia)
                .service(super::get_anesthesia),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/surgical/anesthesia")
            .insert_header(("X-User-Id", wallet.to_string()))
            .set_json(body)
            .to_request();
        let created = test::call_service(&app, req).await.status().as_u16();

        let req = test::TestRequest::get()
            .uri("/api/surgical/anesthesia/list")
            .insert_header(("X-User-Id", wallet.to_string()))
            .to_request();
        let resp = test::call_service(&app, req).await;
        let listed = resp.status().as_u16();
        let body = test::read_body(resp).await;
        (created, listed, String::from_utf8_lossy(&body).to_string())
    }

    /// The assertion the page needed: its own payload is accepted, and the
    /// record it wrote can be read back.
    #[actix_rt::test]
    async fn the_portals_payload_is_accepted_and_readable() {
        let data = state_with(Role::Admin, "5Anaesthetist");
        let (created, listed, body) = post_then_list(
            data,
            "5Anaesthetist",
            page_payload("PAT-1", "Open reduction and internal fixation"),
        )
        .await;
        assert_eq!(created, 201, "the portal's own payload was refused");
        assert_eq!(listed, 200, "the stored record could not be read back");
        assert!(
            body.contains("Open reduction and internal fixation"),
            "the procedure did not survive the round trip: {body}"
        );
    }

    /// `/list` is a literal path, not an id. Registered after `/{id}` it was
    /// captured as one and answered 404 -- which reads as "no such record"
    /// rather than "this route is shadowed".
    #[actix_rt::test]
    async fn the_list_path_is_not_captured_as_a_record_id() {
        let data = state_with(Role::Admin, "5Anaesthetist");
        let (_, listed, _) =
            post_then_list(data, "5Anaesthetist", page_payload("PAT-1", "Laparotomy")).await;
        assert_ne!(listed, 404, "/list was matched as /{{id}}");
    }

    /// The anaesthetist is whoever is signed in, not whoever the body names.
    #[actix_rt::test]
    async fn the_anaesthetist_is_stamped_from_the_session() {
        let data = state_with(Role::Admin, "5Anaesthetist");
        let (_, _, body) =
            post_then_list(data, "5Anaesthetist", page_payload("PAT-1", "Laparotomy")).await;
        assert!(
            body.contains("5Anaesthetist"),
            "the signed-in anaesthetist was not recorded: {body}"
        );
    }

    #[actix_rt::test]
    async fn a_record_with_no_patient_is_refused() {
        let data = state_with(Role::Admin, "5Anaesthetist");
        let (created, _, _) =
            post_then_list(data, "5Anaesthetist", page_payload("", "Laparotomy")).await;
        assert_eq!(created, 400);
    }

    #[actix_rt::test]
    async fn a_patient_cannot_document_an_anaesthetic() {
        let data = state_with(Role::Patient, "5Patient");
        let (created, _, _) =
            post_then_list(data, "5Patient", page_payload("PAT-1", "Laparotomy")).await;
        assert_eq!(created, 403);
    }

    #[actix_rt::test]
    async fn finalized_pathology_report_is_durable_and_cannot_be_overwritten() {
        let data = state_with(Role::Doctor, "5PathologyDoctor");
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::create_pathology)
                .service(super::update_pathology_report),
        )
        .await;
        let create = test::TestRequest::post()
            .uri("/api/surgical/pathology")
            .insert_header(("X-User-Id", "5PathologyDoctor"))
            .set_json(serde_json::json!({
                "specimen_id": "SP-PATH-1", "patient_id": "PAT-1", "status": "received"
            }))
            .to_request();
        assert_eq!(
            test::call_service(&app, create).await.status().as_u16(),
            201
        );

        let finalise = || {
            test::TestRequest::put()
            .uri("/api/surgical/pathology/SP-PATH-1")
            .insert_header(("X-User-Id", "5PathologyDoctor"))
            .set_json(serde_json::json!({
                "gross_description": "Two tissue fragments", "microscopic_description": "Benign tissue",
                "diagnosis": "Benign lesion", "status": "final"
            }))
            .to_request()
        };
        assert_eq!(
            test::call_service(&app, finalise()).await.status().as_u16(),
            200
        );
        assert_eq!(
            test::call_service(&app, finalise()).await.status().as_u16(),
            409
        );
    }

    #[actix_rt::test]
    async fn final_pathology_requires_a_diagnosis_and_microscopy() {
        let data = state_with(Role::Doctor, "5PathologyDoctor");
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::create_pathology)
                .service(super::update_pathology_report),
        )
        .await;
        let create = test::TestRequest::post()
            .uri("/api/surgical/pathology")
            .insert_header(("X-User-Id", "5PathologyDoctor"))
            .set_json(serde_json::json!({"specimen_id": "SP-PATH-2", "patient_id": "PAT-1"}))
            .to_request();
        assert_eq!(
            test::call_service(&app, create).await.status().as_u16(),
            201
        );
        let incomplete = test::TestRequest::put().uri("/api/surgical/pathology/SP-PATH-2")
            .insert_header(("X-User-Id", "5PathologyDoctor"))
            .set_json(serde_json::json!({"gross_description": "Gross", "microscopic_description": "", "diagnosis": "", "status": "final"}))
            .to_request();
        assert_eq!(
            test::call_service(&app, incomplete).await.status().as_u16(),
            400
        );
    }
}
