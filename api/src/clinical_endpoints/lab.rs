//! `clinical_endpoints::lab` — handlers split out of the original 21K-line monolith (Phase 10.1).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// PHASE 7: LABORATORY ENDPOINTS
// ============================================================================

/// Create specimen collection
/// What the specimen collection form actually submits.
///
/// The clinical `SpecimenCollection` type is a much larger structure than a
/// bedside collection screen fills in, and the handler previously populated only
/// the `data` blob via `..Default::default()` — leaving `specimen_type`,
/// `collector_id`, `submission_id` and `collected_at` empty even though all four
/// are NOT NULL. This DTO carries exactly what the form has and the handler fills
/// the typed columns from it.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateSpecimenRequest {
    pub patient_id: String,
    pub specimen_type: String,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub tests_ordered: Option<String>,
    #[serde(default)]
    pub collection_site: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// Pre-collection safety checks the collector confirmed.
    #[serde(default)]
    pub checklist: Vec<String>,
}

#[post("/api/clinical/specimen")]
pub async fn create_specimen(
    data: web::Data<AppState>,
    req: web::Json<CreateSpecimenRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_perform_laboratory_work() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    if record.patient_id.trim().is_empty() || record.specimen_type.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id and specimen_type are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&record.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", record.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    let now = Utc::now();
    let collection_id = format!("SPC-{}", uuid::Uuid::new_v4().simple());

    // `specimen_collections.submission_id` is a NOT NULL foreign key into
    // `lab_submissions`, so a collection cannot stand alone. Raise the submission
    // the collection implies, from the tests the collector listed — that keeps the
    // chain of custody intact and the specimen traceable to an order, rather than
    // weakening the constraint to let orphaned specimens exist.
    let submission_id = format!("LAB-{}", uuid::Uuid::new_v4().simple());
    let tests: Vec<String> = record
        .tests_ordered
        .as_deref()
        .unwrap_or_default()
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let submission = LabSubmissionEntity {
        id: submission_id.clone(),
        patient_id: record.patient_id.clone(),
        ordering_provider_id: current_user.wallet_address.clone(),
        order_date: now,
        priority: record
            .priority
            .clone()
            .unwrap_or_else(|| "routine".to_string()),
        status: "collected".to_string(),
        tests_ordered: serde_json::json!(tests),
        clinical_notes: record.notes.clone(),
        diagnosis_codes: None,
        fasting_required: false,
        collection_instructions: record.collection_site.clone(),
        expected_completion: None,
        created_at: now,
        updated_at: now,
    };
    if let Err(e) = data.repositories.lab_submissions.create(submission).await {
        log::error!("lab submission for specimen collection failed: {e}");
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to raise the lab order for this collection".to_string(),
            code: "REPO_ERROR".to_string(),
        });
    }

    let entity = SpecimenCollectionEntity {
        id: collection_id.clone(),
        patient_id: record.patient_id.clone(),
        submission_id: submission_id.clone(),
        specimen_type: record.specimen_type.clone(),
        collection_site: record.collection_site.clone(),
        collection_method: None,
        collector_id: current_user.wallet_address.clone(),
        collected_at: now,
        received_at: None,
        received_by: None,
        container_type: None,
        volume_ml: None,
        temperature_c: None,
        condition: None,
        barcode: None,
        storage_location: None,
        chain_of_custody: Some(serde_json::json!([{
            "action": "collected",
            "by": current_user.wallet_address,
            "at": now.to_rfc3339(),
            "checklist": record.checklist,
        }])),
        notes: record.notes.clone(),
        created_at: now,
        updated_at: now,
        data: serde_json::to_value(&record).unwrap_or_default(),
    };

    match data.repositories.specimen_collections.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "collection_id": collection_id,
            "submission_id": submission_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("specimen collection persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the specimen collection".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

#[get("/api/clinical/specimen/{collection_id}")]
pub async fn get_specimen(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let collection_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .specimen_collections
        .get_by_id(&collection_id)
        .await
    {
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Specimen collection not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all specimen collections
#[get("/api/clinical/specimens")]
pub async fn list_specimens(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Via repository (was: in-memory data.specimen_collections HashMap).
    // Mirrors get_specimen: each entity carries the full SpecimenCollection in `data`.
    let entities = data
        .repositories
        .specimen_collections
        .list_all()
        .await
        .unwrap_or_default();
    let specimen_list: Vec<serde_json::Value> = entities.into_iter().map(|e| e.data).collect();
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": specimen_list.len(),
        "specimens": specimen_list
    }))
}

/// Create chain of custody
/// What the chain-of-custody form actually submits.
///
/// `ChainOfCustodyPage.tsx` posts camelCase throughout; this handler read
/// snake_case out of an untyped `Value`, so `collected_by`, `seal_number`,
/// `collection_location` and the rest all defaulted. The seal number is the
/// point of a chain of custody, and it was being dropped.
///
/// The page and the table also disagree about what `status` means. The page
/// tracks a **specimen** lifecycle (`collected` -> `in-transit` -> `received`
/// -> `analyzed` -> `stored` -> `released` -> `destroyed`); the column tracks
/// **custody** (`in_custody` / `transferred` / `released` / `destroyed` /
/// `lost`) and its CHECK constraint refused `collected` outright, so every
/// submission was a 500 on PostgreSQL. Both are real and neither is wrong, so
/// the specimen state is mapped onto the custody state for the column and kept
/// verbatim in the blob — the same treatment `create_shift_handoff` gives
/// `shift_direction`.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateChainOfCustodyRequest {
    #[serde(rename = "custodyId", alias = "custody_id", default)]
    pub custody_id: Option<String>,
    #[serde(rename = "patientId", alias = "patient_id", default)]
    pub patient_id: Option<String>,
    #[serde(rename = "patientName", default)]
    pub patient_name: Option<String>,
    #[serde(rename = "specimenType", alias = "evidence_type")]
    pub specimen_type: String,
    #[serde(
        rename = "specimenDescription",
        alias = "evidence_description",
        default
    )]
    pub specimen_description: String,
    #[serde(rename = "collectionDate", default)]
    pub collection_date: Option<String>,
    #[serde(rename = "collectionTime", default)]
    pub collection_time: Option<String>,
    #[serde(rename = "collectedBy", alias = "collected_by", default)]
    pub collected_by: Option<String>,
    #[serde(rename = "collectionLocation", alias = "collection_location", default)]
    pub collection_location: Option<String>,
    #[serde(default)]
    pub purpose: Option<String>,
    #[serde(rename = "caseNumber", alias = "case_number", default)]
    pub case_number: Option<String>,
    #[serde(
        rename = "investigatingAgency",
        alias = "law_enforcement_agency",
        default
    )]
    pub investigating_agency: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(rename = "sealNumber", alias = "seal_number", default)]
    pub seal_number: Option<String>,
    #[serde(rename = "containerType", alias = "packaging_description", default)]
    pub container_type: Option<String>,
    /// Free text on the form ("2 x 4 mL"), an integer in the column.
    #[serde(default)]
    pub quantity: Option<String>,
    #[serde(rename = "currentCustodian", alias = "current_custodian_id", default)]
    pub current_custodian: Option<String>,
    #[serde(rename = "currentLocation", alias = "storage_location", default)]
    pub current_location: Option<String>,
    #[serde(rename = "storageConditions", alias = "storage_requirements", default)]
    pub storage_conditions: Option<String>,
    #[serde(rename = "integrityVerified", default)]
    pub integrity_verified: bool,
    #[serde(default)]
    pub transfers: Vec<serde_json::Value>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// The specimen lifecycle state the page tracks, as a custody state the column
/// permits. Anything the page can produce maps to something the CHECK accepts.
fn custody_status_for(specimen_status: &str) -> &'static str {
    match specimen_status {
        "in-transit" | "in_transit" | "transferred" => "transferred",
        "released" => "released",
        "destroyed" => "destroyed",
        "lost" => "lost",
        // `collected`, `received`, `analyzed`, `stored` and anything unknown:
        // the laboratory still holds it.
        _ => "in_custody",
    }
}

/// The specimen type the page offers, as an evidence type the column permits.
fn evidence_type_for(specimen_type: &str) -> &'static str {
    match specimen_type {
        "blood" | "blood_sample" => "blood_sample",
        "urine" | "urine_sample" => "urine_sample",
        "other-fluid" | "tissue" | "swab" | "biological" => "biological",
        "clothing" => "clothing",
        "personal_effects" => "personal_effects",
        "weapon" => "weapon",
        "document" => "document",
        "electronic_device" => "electronic_device",
        _ => "other",
    }
}

#[post("/api/clinical/chain-of-custody")]
pub async fn create_chain_of_custody(
    data: web::Data<AppState>,
    req: web::Json<CreateChainOfCustodyRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_perform_laboratory_work() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = req.into_inner();
    let now = Utc::now();

    // A chain of custody with no seal number cannot demonstrate an unbroken
    // chain, which is the only thing it is for.
    if body
        .seal_number
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "seal_number is required: a custody record without one cannot show the seal was unbroken".to_string(),
            code: "MISSING_SEAL_NUMBER".to_string(),
        });
    }

    // Server-generated: a client-supplied id lets one submission overwrite another.
    let form_id = format!("COC-{}", uuid::Uuid::new_v4().simple());

    // The wall-clock the collector wrote, not the instant the request arrived.
    let collected_at = match (
        body.collection_date.as_deref(),
        body.collection_time.as_deref(),
    ) {
        (Some(d), Some(t)) if !d.is_empty() => crate::types::appt_to_datetime(d, t),
        (Some(d), None) if !d.is_empty() => crate::types::appt_to_datetime(d, "00:00"),
        _ => now,
    };

    // `quantity` is free text on the form ("2 x 4 mL") and an integer in the
    // column. Take the leading count and keep the text; losing "4 mL" would
    // leave a row claiming two of something unspecified.
    let quantity_count = body
        .quantity
        .as_deref()
        .and_then(|q| {
            q.trim()
                .split(|c: char| !c.is_ascii_digit())
                .find(|p| !p.is_empty())
        })
        .and_then(|n| n.parse::<i32>().ok())
        .unwrap_or(1);

    let specimen_status = body
        .status
        .clone()
        .unwrap_or_else(|| "collected".to_string());

    let entity = ChainOfCustodyEntity {
        id: form_id.clone(),
        patient_id: body.patient_id.clone().filter(|p| !p.is_empty()),
        case_number: body.case_number.clone().filter(|c| !c.is_empty()),
        evidence_type: evidence_type_for(&body.specimen_type).to_string(),
        evidence_description: body.specimen_description.clone(),
        quantity: quantity_count,
        unit_of_measure: body.quantity.clone(),
        collection_datetime: collected_at,
        collection_location: body.collection_location.clone().filter(|l| !l.is_empty()),
        // The collector is the authenticated caller unless one was named.
        collected_by: body
            .collected_by
            .clone()
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| current_user.wallet_address.clone()),
        collection_witnessed_by: None,
        collection_method: None,
        packaging_description: body.container_type.clone().filter(|c| !c.is_empty()),
        seal_number: body.seal_number.clone(),
        storage_location: body.current_location.clone().filter(|l| !l.is_empty()),
        storage_requirements: body.storage_conditions.clone().filter(|c| !c.is_empty()),
        current_custodian_id: body
            .current_custodian
            .clone()
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| current_user.wallet_address.clone()),
        transfers: serde_json::json!(body.transfers),
        law_enforcement_agency: body.investigating_agency.clone().filter(|a| !a.is_empty()),
        law_enforcement_officer: None,
        law_enforcement_badge: None,
        warrant_number: None,
        court_order_number: None,
        released_to: None,
        release_datetime: None,
        release_authorized_by: None,
        release_documentation: None,
        destruction_authorized: false,
        destruction_datetime: None,
        destruction_method: None,
        destruction_witnessed_by: None,
        status: custody_status_for(&specimen_status).to_string(),
        photos_taken: false,
        photo_references: None,
        notes: body.notes.clone().filter(|n| !n.is_empty()),
        created_at: now,
        updated_at: now,
        data: serde_json::json!({
            "custody_id": form_id,
            "client_custody_id": body.custody_id,
            "patient_id": body.patient_id,
            "patient_name": body.patient_name,
            "specimen_type": body.specimen_type,
            "specimen_description": body.specimen_description,
            // The specimen lifecycle state the page tracks, kept beside the
            // custody state the column stores. They are different axes.
            "specimen_status": specimen_status,
            "purpose": body.purpose,
            "seal_number": body.seal_number,
            "container_type": body.container_type,
            "quantity": body.quantity,
            "current_custodian": body.current_custodian,
            "current_location": body.current_location,
            "storage_conditions": body.storage_conditions,
            "integrity_verified": body.integrity_verified,
            "case_number": body.case_number,
            "investigating_agency": body.investigating_agency,
            "collected_by": body.collected_by,
            "collection_datetime": collected_at.to_rfc3339(),
            "notes": body.notes,
        }),
    };

    match data.repositories.chain_of_custody.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "form_id": form_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("chain of custody could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "The chain-of-custody record could not be saved".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    }
}

#[get("/api/clinical/chain-of-custody/{form_id}")]
pub async fn get_chain_of_custody(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let form_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.chain_of_custody.get_by_id(&form_id).await {
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Chain of custody not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// What the QC form actually submits.
///
/// `LabQCPage.tsx` posts `instrument`, `analyte`, `observedValue`,
/// `expectedMean`, `expectedSD` and the Westgard rules that failed. This
/// handler read `instrument_id`, `test_name`, `measured_value`,
/// `expected_value` and `acceptable_range_low/high` from an untyped `Value`,
/// so every one of them fell through to its default. A run recorded on
/// 2026-09-10 read back as `instrument_id: ""`, `test_name: ""`,
/// `expected_value: "0"`, `measured_value: "0"` — a QC record that says the
/// control measured zero on an unnamed analyser.
///
/// That is worse than losing the record. Quality control exists so that patient
/// results are held when a control fails, and a stored run that passes by
/// arithmetic accident (0 within a range of 0 to 0) releases them.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateLabQcRequest {
    #[serde(rename = "testId", alias = "test_id", default)]
    pub test_id: Option<String>,
    /// The analyser. `instrument` on the form.
    #[serde(rename = "instrument", alias = "instrument_name", default)]
    pub instrument: String,
    /// What was measured. `analyte` on the form, `test_name` in the column.
    #[serde(rename = "analyte", alias = "test_name")]
    pub analyte: String,
    #[serde(rename = "level", alias = "qc_level", default)]
    pub level: String,
    #[serde(rename = "lotNumber", alias = "lot_number", default)]
    pub lot_number: Option<String>,
    #[serde(rename = "expiryDate", alias = "expiration_date", default)]
    pub expiry_date: Option<String>,
    /// What the control actually read.
    #[serde(rename = "observedValue", alias = "measured_value")]
    pub observed_value: f64,
    /// The target, and the spread that defines the acceptable window.
    #[serde(rename = "expectedMean", alias = "expected_value")]
    pub expected_mean: f64,
    #[serde(rename = "expectedSD", alias = "expected_sd", default)]
    pub expected_sd: f64,
    #[serde(default)]
    pub unit: String,
    /// `pass` / `fail` / `warning` from the page.
    #[serde(default)]
    pub result: Option<String>,
    #[serde(rename = "violatedRules", default)]
    pub violated_rules: Vec<String>,
    #[serde(rename = "performedBy", alias = "performed_by", default)]
    pub performed_by: Option<String>,
    #[serde(rename = "correctiveAction", alias = "corrective_action", default)]
    pub corrective_action: Option<String>,
    #[serde(default)]
    pub comments: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub time: Option<String>,
}

/// The control level as the `lab_qc_records` CHECK spells it.
///
/// `LabQCPage` offers "Level 1" / "Level 2" / "Level 3"; the constraint permits
/// `level1` / `level2` / `level3`. A space and two capitals were enough to make
/// every quality-control run a `500` on PostgreSQL — and QC is what decides
/// whether patient results are released.
fn canonical_qc_level(level: &str) -> String {
    let compact: String = level
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .collect::<String>()
        .to_ascii_lowercase();
    match compact.as_str() {
        "level1" | "1" | "low" => "level1".to_string(),
        "level2" | "2" | "normal" | "mid" => "level2".to_string(),
        "level3" | "3" | "high" => "level3".to_string(),
        // Unknown levels are refused by the constraint rather than silently
        // filed as level 1, which would claim a control was run at a
        // concentration it was not.
        other => other.to_string(),
    }
}

/// Create lab QC record
#[post("/api/clinical/lab-qc")]
pub async fn create_lab_qc(
    data: web::Data<AppState>,
    req: web::Json<CreateLabQcRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_perform_laboratory_work() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = req.into_inner();
    let now = Utc::now();

    if body.analyte.trim().is_empty() || body.instrument.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "analyte and instrument are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    let qc_id = format!("QC-{}", uuid::Uuid::new_v4().simple());
    let dec = |v: f64| rust_decimal::Decimal::from_f64_retain(v).unwrap_or_default();

    // The acceptable window is mean +/- 2 SD, the conventional Westgard limit.
    // Derived here rather than accepted from the client, for the same reason
    // every other clinical threshold is server-side: the window decides whether
    // patient results are released.
    let low = body.expected_mean - 2.0 * body.expected_sd;
    let high = body.expected_mean + 2.0 * body.expected_sd;

    // `passed` is the server's conclusion, not the page's claim. A run the
    // browser labelled `pass` while sitting outside the window would release
    // results the control says are unreliable.
    let within_window = body.observed_value >= low && body.observed_value <= high;
    let passed = within_window && body.violated_rules.is_empty();

    let deviation = if body.expected_mean.abs() > f64::EPSILON {
        Some(dec((body.observed_value - body.expected_mean)
            / body.expected_mean
            * 100.0))
    } else {
        None
    };

    // A failed control with no corrective action is an audit finding rather
    // than a QC record, so the two are refused together.
    if !passed
        && body
            .corrective_action
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "a failed control requires a corrective action".to_string(),
            code: "CORRECTIVE_ACTION_REQUIRED".to_string(),
        });
    }

    let entity = LabQcRecordEntity {
        id: qc_id.clone(),
        instrument_id: body.instrument.clone(),
        instrument_name: body.instrument.clone(),
        qc_level: canonical_qc_level(&body.level),
        test_code: body.test_id.clone().unwrap_or_default(),
        test_name: body.analyte.clone(),
        expected_value: dec(body.expected_mean),
        measured_value: dec(body.observed_value),
        unit: body.unit.clone(),
        acceptable_range_low: dec(low),
        acceptable_range_high: dec(high),
        passed,
        deviation_percent: deviation,
        corrective_action: body.corrective_action.clone(),
        performed_by: current_user.wallet_address.clone(),
        reviewed_by: None,
        performed_at: now,
        reviewed_at: None,
        lot_number: body.lot_number.clone(),
        expiration_date: body
            .expiry_date
            .as_deref()
            .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()),
        created_at: now,
        data: serde_json::json!({
            "qc_id": qc_id,
            "instrument": body.instrument,
            "analyte": body.analyte,
            "level": body.level,
            "observed_value": body.observed_value,
            "expected_mean": body.expected_mean,
            "expected_sd": body.expected_sd,
            "acceptable_range_low": low,
            "acceptable_range_high": high,
            "unit": body.unit,
            "passed": passed,
            // The rules the run broke, kept verbatim: "1_3s" and "2_2s" mean
            // different things about the analyser and lead to different actions.
            "violated_rules": body.violated_rules,
            "corrective_action": body.corrective_action,
            "comments": body.comments,
            "performed_by": current_user.wallet_address,
            "performed_at": now.to_rfc3339(),
        }),
    };

    match data.repositories.lab_qc_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "qc_id": qc_id,
            "passed": passed,
            "acceptable_range_low": low,
            "acceptable_range_high": high
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("QC run could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "The quality-control run could not be saved".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    }
}

#[get("/api/clinical/lab-qc/{qc_id}")]
pub async fn get_lab_qc(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let qc_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.lab_qc_records.get_by_id(&qc_id).await {
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Lab QC record not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// What the critical-value form actually submits.
///
/// `CriticalValuePage.tsx` posts camelCase and names the measurement `analyte`;
/// this handler used to read `patient_id`, `test_name` and `test_code` out of an
/// untyped `Value` with `unwrap_or_default()` behind each lookup. Nothing
/// matched. The stored row carried an empty patient, an empty test name and an
/// empty reporter — and on PostgreSQL the empty patient violated
/// `critical_values_patient_id_fkey`, so raising a critical potassium answered
/// `500`.
///
/// A critical value exists to be *communicated*. Storing one whose patient and
/// analyte are blank is worse than refusing it, because the regulatory
/// obligation attached to the notification is then recorded as discharged.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateCriticalValueRequest {
    #[serde(rename = "patientId", alias = "patient_id")]
    pub patient_id: String,
    /// The measurement. `analyte` on the form, `test_name` in the column.
    #[serde(rename = "analyte", alias = "test_name")]
    pub analyte: String,
    #[serde(rename = "testCode", alias = "test_code", default)]
    pub test_code: Option<String>,
    pub value: f64,
    #[serde(default)]
    pub unit: String,
    /// `high` / `low` on the form; the column calls it severity.
    #[serde(rename = "criticalLevel", alias = "severity", default)]
    pub critical_level: Option<String>,
    /// The threshold the value crossed, which is what makes it critical.
    #[serde(rename = "thresholdExceeded", default)]
    pub threshold_exceeded: Option<f64>,
    #[serde(rename = "reportedBy", alias = "reported_by", default)]
    pub reported_by: Option<String>,
    #[serde(rename = "reportedAt", default)]
    pub reported_at: Option<String>,
    /// The clinician who must be told. Without it the notification has no
    /// addressee and cannot be chased.
    #[serde(rename = "orderingProvider", alias = "notified_provider_id", default)]
    pub ordering_provider: Option<String>,
    #[serde(rename = "notificationStatus", default)]
    pub notification_status: Option<String>,
    #[serde(rename = "labPanelId", alias = "lab_panel_id", default)]
    pub lab_panel_id: Option<String>,
    #[serde(rename = "patientName", default)]
    pub patient_name: Option<String>,
    #[serde(rename = "notificationId", default)]
    pub notification_id: Option<String>,
}

/// Create critical value notification
#[post("/api/clinical/critical-value")]
pub async fn create_critical_value(
    data: web::Data<AppState>,
    req: web::Json<CreateCriticalValueRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_perform_laboratory_work() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = req.into_inner();
    let now = Utc::now();

    if body.patient_id.trim().is_empty() || body.analyte.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id and analyte are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&body.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", body.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    // Server-generated: a client-supplied id lets one submission overwrite another.
    let notification_id = format!("CRV-{}", uuid::Uuid::new_v4().simple());
    let patient_id = body.patient_id.clone();
    let test_name = body.analyte.clone();
    let unit = body.unit.clone();
    let critical_value_str = body.value.to_string();
    let decimal = |v: f64| rust_decimal::Decimal::from_f64_retain(v);

    // `high` and `low` say which side of the reference range was crossed, so
    // the threshold goes into the matching bound rather than into whichever one
    // happens to be first. A potassium of 6.9 recorded as a critical *low*
    // reads as the opposite emergency.
    let level = body
        .critical_level
        .as_deref()
        .unwrap_or("high")
        .to_ascii_lowercase();
    // `critical-low`, `low`, or `critical_low` — the side, however the form
    // spells it.
    let is_low = level.contains("low");
    let threshold = body.threshold_exceeded.and_then(decimal);

    let entity = CriticalValueEntity {
        id: notification_id.clone(),
        patient_id: patient_id.clone(),
        lab_panel_id: body.lab_panel_id.clone(),
        test_code: body.test_code.clone().unwrap_or_default(),
        test_name: test_name.clone(),
        value: decimal(body.value).unwrap_or_default(),
        unit: unit.clone(),
        reference_low: None,
        reference_high: None,
        critical_low: if is_low { threshold } else { None },
        critical_high: if is_low { None } else { threshold },
        // `critical_values.severity` permits `critical` / `panic` / `alert`.
        // The form's `critical-high` and `critical-low` say which SIDE of the
        // range was crossed, which is a different axis and is already recorded
        // in `critical_low` / `critical_high` above. Sending the side as the
        // severity made every critical value a 500 on PostgreSQL.
        severity: match level.as_str() {
            "panic" => "panic".to_string(),
            "alert" | "warning" => "alert".to_string(),
            _ => "critical".to_string(),
        },
        notified_provider_id: body.ordering_provider.clone(),
        notification_method: body.notification_status.clone(),
        notified_at: body
            .reported_at
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&Utc)),
        acknowledged_at: None,
        acknowledged_by: None,
        action_taken: None,
        // The reporter is the authenticated caller. A client-asserted name on a
        // notification that carries a legal duty to communicate is not evidence
        // of who communicated it.
        reported_by: current_user.wallet_address.clone(),
        created_at: now,
        data: serde_json::json!({
            "notification_id": notification_id,
            "patient_id": patient_id,
            "patient_name": body.patient_name,
            "analyte": test_name,
            "value": body.value,
            "unit": unit,
            "critical_level": level,
            "threshold_exceeded": body.threshold_exceeded,
            "ordering_provider": body.ordering_provider,
            "notification_status": body.notification_status.clone().unwrap_or_else(|| "pending".to_string()),
            "reported_by": current_user.wallet_address,
            "reported_at": now.to_rfc3339(),
        }),
    };

    match data.repositories.critical_values.create(entity).await {
        Ok(_) => {
            // Push real-time SSE notification for critical lab value
            crate::websocket::push_cds_alert(
                &data.ws_manager,
                &patient_id,
                &format!(
                    "Critical Lab Value: {} = {} {}",
                    test_name, critical_value_str, unit
                ),
                "critical",
            );

            HttpResponse::Created().json(serde_json::json!({
                "success": true,
                "notification_id": notification_id
            }))
        }
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("critical value could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "The critical value could not be saved".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    }
}

#[get("/api/clinical/critical-value/{notification_id}")]
pub async fn get_critical_value(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let notification_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .critical_values
        .get_by_id(&notification_id)
        .await
    {
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Critical value notification not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create specimen rejection
#[post("/api/clinical/specimen-rejection")]
pub async fn create_specimen_rejection(
    data: web::Data<AppState>,
    req: web::Json<serde_json::Value>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_perform_laboratory_work() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = req.into_inner();

    // A rejection names the specimen it rejects: `specimen_rejections.specimen_id`
    // is `NOT NULL REFERENCES specimen_collections(id)`, and that is right —
    // rejecting nothing in particular is not a meaningful record. But the value
    // was read with `unwrap_or_default()`, so a missing one became the empty
    // string and the request died on a foreign-key violation reported as a bare
    // 500 DATABASE_ERROR. Say which field is missing, and which specimen was not
    // found, instead of making the caller guess from a database error.
    let specimen_id = match body.get("specimen_id").and_then(|v| v.as_str()) {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "specimen_id is required: a rejection must name the specimen it rejects"
                    .to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    if data
        .repositories
        .specimen_collections
        .get_by_id(&specimen_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!(
                "Specimen '{specimen_id}' has not been collected, so it cannot be rejected"
            ),
            code: "SPECIMEN_NOT_FOUND".to_string(),
        });
    }

    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let rejection_id = format!("REJ-{}", uuid::Uuid::new_v4().simple());
    let entity = SpecimenRejectionEntity {
        id: rejection_id.clone(),
        specimen_id,
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        rejection_reason: body
            .get("rejection_reason")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        rejection_category: body
            .get("rejection_category")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("collection_error")
            .to_string(),
        detailed_notes: body
            .get("detailed_notes")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        rejected_by: body
            .get("rejected_by")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        rejected_at: body
            .get("rejected_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now),
        recollection_required: body
            .get("recollection_required")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        recollection_scheduled: body
            .get("recollection_scheduled")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        notified_ordering_provider: body
            .get("notified_ordering_provider")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        notification_sent_at: body
            .get("notification_sent_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        created_at: now,
        data: body.clone(),
    };

    match data.repositories.specimen_rejections.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "rejection_id": rejection_id
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

/// Tell the ordering provider that their specimen was rejected.
///
/// # Why this endpoint exists
///
/// The Laboratory Dashboard has carried a "Notify" button on every rejected
/// specimen since that panel was built, with no handler and nothing to call.
/// `SpecimenRejectionEntity` has carried `notified_ordering_provider` and
/// `notification_sent_at` for just as long, and nothing set them.
///
/// Nothing clinical had to be invented to finish it. Every piece already
/// existed:
///
///   * **Who to tell** is determined by the data, not by a policy choice.
///     `rejection.specimen_id` -> `SpecimenCollectionEntity.submission_id` ->
///     `LabSubmissionEntity.ordering_provider_id`. `POST /api/clinical/specimen`
///     writes both halves of that chain in one request, so it is always
///     present for a specimen this system collected.
///   * **How to tell them** is `notifications::notify_critical_alert`, which
///     already exists to push an alert to a *provider* about a *patient*.
///   * **What "told" means afterwards** is the two fields above.
///
/// # Role
///
/// The same set `/api/lab/submit` accepts: LabTechnician, Doctor, Nurse,
/// Admin. Deliberately not `can_edit_medical_records()`, which the sibling
/// rejection endpoints use — that excludes LabTechnician, and this control
/// lives on the Laboratory Dashboard, so the role that sees it could never use
/// it. Widening who may *reject* a specimen would be a clinical governance
/// decision; reusing an existing lab-domain predicate for who may pass on the
/// news is not.
///
/// # Exactly once
///
/// The transition is guarded inside the write, so two people pressing Notify
/// at the same moment send one notification between them. A repeat press is
/// answered `ALREADY_NOTIFIED` rather than silently sending again — a provider
/// receiving the same rejection twice has to work out whether it is one
/// specimen or two.
// ============================================================================
// Specimen recollection (SCR-009b)
// ============================================================================
//
// A rejected specimen stays rejected. When the laboratory needs another sample
// that is a NEW act, recorded in `specimen_recollection_requests` and pointing
// back at the rejection it answers, so the chain
//
//     rejected specimen -> recollection request -> replacement specimen
//
// stays navigable and the original failure remains permanently visible. Nothing
// here edits the rejection.
//
// Notify and Recollect stay separate. Telling the ordering provider a specimen
// failed and asking the patient to attend again are different acts, aimed at
// different people, with different consequences.

#[derive(Debug, serde::Deserialize)]
pub struct RequestRecollectionBody {
    /// Why another sample is needed. Free text, recorded verbatim.
    pub reason: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct CompleteRecollectionBody {
    /// The specimen that replaced the rejected one. A different collection, not
    /// an edit of the original.
    pub replacement_specimen_id: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct CancelRecollectionBody {
    pub reason: String,
}

/// Who may act on a recollection.
///
/// The same set the Notify workflow uses: the laboratory that rejected the
/// specimen, the clinicians responsible for the patient, and administrators.
fn may_handle_recollection(role: &crate::Role) -> bool {
    matches!(
        role,
        crate::Role::LabTechnician | crate::Role::Doctor | crate::Role::Nurse | crate::Role::Admin
    )
}

fn recollection_role_refused(role: &crate::Role) -> HttpResponse {
    HttpResponse::Forbidden().json(ErrorResponse {
        success: false,
        error: format!(
            "Role {role} cannot act on a specimen recollection. Required: LabTechnician, Doctor, Nurse, or Admin"
        ),
        code: "INSUFFICIENT_ROLE".to_string(),
    })
}

/// Writes the audit entry for a recollection transition.
///
/// An obligation, not a side effect -- the same stance the Notify handler
/// takes. Asking a patient to give another sample is a clinical instruction,
/// and one nobody can attribute afterwards is not one that happened.
async fn audit_recollection(
    data: &web::Data<AppState>,
    patient_id: &str,
    user: &crate::User,
    action: &str,
    at: chrono::DateTime<Utc>,
) -> Result<(), HttpResponse> {
    data.repositories
        .access_logs
        .create(
            AccessLogEntry {
                access_id: crate::middleware::secure_tokens::generate_access_id(),
                patient_id: patient_id.to_string(),
                accessor_id: user.wallet_address.clone(),
                accessor_role: user.role.to_string(),
                access_type: action.to_string(),
                location: None,
                timestamp: at,
                emergency: false,
            }
            .into(),
        )
        .await
        .map_err(|e| {
            log::error!("Recollection audit failed ({action}): {e}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The recollection could not be audited".to_string(),
                code: "AUDIT_UNAVAILABLE".to_string(),
            })
        })?;
    Ok(())
}

/// Request another sample after a rejection.
#[post("/api/clinical/specimen-rejection/{rejection_id}/recollect")]
pub async fn request_specimen_recollection(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RequestRecollectionBody>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_handle_recollection(&current_user.role) {
        return recollection_role_refused(&current_user.role);
    }

    let rejection_id = path.into_inner();
    let rejection = match data
        .repositories
        .specimen_rejections
        .get_by_id(&rejection_id)
        .await
    {
        Ok(r) => r,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Specimen rejection not found".to_string(),
                code: "REJECTION_NOT_FOUND".to_string(),
            })
        }
    };

    if body.reason.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "A reason is required to ask a patient for another sample".to_string(),
            code: "REASON_REQUIRED".to_string(),
        });
    }

    let now = Utc::now();
    // Best-effort: a recollection is still worth recording for a specimen whose
    // ordering provider cannot be resolved. Notify is the workflow that refuses
    // in that case, because a notification with no recipient is nothing.
    let ordering_provider = resolve_ordering_provider(&data, &rejection.specimen_id).await;

    let request = crate::repositories::traits::SpecimenRecollectionRequestEntity {
        id: format!("RECOL-{}", uuid::Uuid::new_v4()),
        rejection_id: rejection_id.clone(),
        original_specimen_id: rejection.specimen_id.clone(),
        patient_id: rejection.patient_id.clone(),
        ordering_provider_id: ordering_provider,
        requested_by: current_user.wallet_address.clone(),
        reason: body.reason.trim().to_string(),
        status: "requested".to_string(),
        requested_at: now,
        replacement_specimen_id: None,
        completed_at: None,
        cancelled_at: None,
        cancellation_reason: None,
        created_at: now,
        updated_at: now,
    };

    let opened = match data.repositories.specimen_recollections.open(request).await {
        Ok(Some(r)) => r,
        // Two technicians looking at the same rejected specimen will both press
        // this. The guard is a partial unique index, so the loser is told the
        // truth rather than the patient being asked twice.
        Ok(None) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "A recollection is already open for this rejection".to_string(),
                code: "RECOLLECTION_ALREADY_OPEN".to_string(),
            })
        }
        Err(e) => {
            log::error!("Recollection open failed for {rejection_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The recollection request could not be recorded".to_string(),
                code: "RECOLLECTION_UNAVAILABLE".to_string(),
            });
        }
    };

    if let Err(resp) = audit_recollection(
        &data,
        &opened.patient_id,
        &current_user,
        "specimen_recollection_requested",
        now,
    )
    .await
    {
        return resp;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "recollection": opened,
    }))
}

/// Record the replacement specimen and close the request.
#[post("/api/clinical/specimen-recollection/{recollection_id}/complete")]
pub async fn complete_specimen_recollection(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<CompleteRecollectionBody>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_handle_recollection(&current_user.role) {
        return recollection_role_refused(&current_user.role);
    }

    let recollection_id = path.into_inner();
    let replacement = body.replacement_specimen_id.trim().to_string();
    if replacement.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "The replacement specimen must be named".to_string(),
            code: "REPLACEMENT_REQUIRED".to_string(),
        });
    }

    // The replacement must be a different specimen. Naming the rejected one
    // would make the lineage a loop and quietly assert that the failed sample
    // replaced itself.
    let existing = match data
        .repositories
        .specimen_recollections
        .get_by_id(&recollection_id)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Recollection request not found".to_string(),
                code: "RECOLLECTION_NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Recollection lookup failed for {recollection_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The recollection could not be read".to_string(),
                code: "RECOLLECTION_UNAVAILABLE".to_string(),
            });
        }
    };
    if replacement == existing.original_specimen_id {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "The replacement cannot be the specimen that was rejected".to_string(),
            code: "REPLACEMENT_IS_ORIGINAL".to_string(),
        });
    }

    let now = Utc::now();
    let completed = match data
        .repositories
        .specimen_recollections
        .complete(&recollection_id, &replacement, now)
        .await
    {
        Ok(Some(r)) => r,
        // Guarded inside the write, so a retry cannot overwrite the first
        // replacement or revive a cancelled request.
        Ok(None) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "This recollection is no longer open".to_string(),
                code: "RECOLLECTION_NOT_OPEN".to_string(),
            })
        }
        Err(e) => {
            log::error!("Recollection completion failed for {recollection_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The replacement could not be recorded".to_string(),
                code: "RECOLLECTION_UNAVAILABLE".to_string(),
            });
        }
    };

    if let Err(resp) = audit_recollection(
        &data,
        &completed.patient_id,
        &current_user,
        "specimen_recollection_completed",
        now,
    )
    .await
    {
        return resp;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "recollection": completed,
    }))
}

/// Stop asking for another sample.
#[post("/api/clinical/specimen-recollection/{recollection_id}/cancel")]
pub async fn cancel_specimen_recollection(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<CancelRecollectionBody>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_handle_recollection(&current_user.role) {
        return recollection_role_refused(&current_user.role);
    }
    if body.reason.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "A reason is required to cancel a recollection".to_string(),
            code: "REASON_REQUIRED".to_string(),
        });
    }

    let recollection_id = path.into_inner();
    let now = Utc::now();
    let cancelled = match data
        .repositories
        .specimen_recollections
        .cancel(&recollection_id, body.reason.trim(), now)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "This recollection is no longer open".to_string(),
                code: "RECOLLECTION_NOT_OPEN".to_string(),
            })
        }
        Err(e) => {
            log::error!("Recollection cancellation failed for {recollection_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The cancellation could not be recorded".to_string(),
                code: "RECOLLECTION_UNAVAILABLE".to_string(),
            });
        }
    };

    if let Err(resp) = audit_recollection(
        &data,
        &cancelled.patient_id,
        &current_user,
        "specimen_recollection_cancelled",
        now,
    )
    .await
    {
        return resp;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "recollection": cancelled,
    }))
}

/// Every recollection ever raised for a rejection, newest first.
///
/// Cancelled and completed requests are included deliberately: the point of the
/// lineage is that the whole history stays visible, including attempts that
/// were abandoned.
#[get("/api/clinical/specimen-rejection/{rejection_id}/recollections")]
pub async fn list_recollections_for_rejection(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_handle_recollection(&current_user.role) {
        return recollection_role_refused(&current_user.role);
    }
    match data
        .repositories
        .specimen_recollections
        .list_for_rejection(&path.into_inner())
        .await
    {
        Ok(rows) => HttpResponse::Ok().json(serde_json::json!({ "recollections": rows })),
        Err(e) => {
            log::error!("Recollection list failed: {e}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Recollections could not be read".to_string(),
                code: "RECOLLECTION_UNAVAILABLE".to_string(),
            })
        }
    }
}

/// The laboratory's queue of samples still awaited.
#[get("/api/clinical/specimen-recollections/open")]
pub async fn list_open_recollections(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_handle_recollection(&current_user.role) {
        return recollection_role_refused(&current_user.role);
    }
    match data.repositories.specimen_recollections.list_open().await {
        Ok(rows) => HttpResponse::Ok().json(serde_json::json!({ "recollections": rows })),
        Err(e) => {
            log::error!("Open recollection list failed: {e}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Recollections could not be read".to_string(),
                code: "RECOLLECTION_UNAVAILABLE".to_string(),
            })
        }
    }
}

#[post("/api/clinical/specimen-rejection/{rejection_id}/notify")]
pub async fn notify_rejection_ordering_provider(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let rejection_id = path.into_inner();

    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let may_notify = matches!(
        current_user.role,
        crate::Role::LabTechnician | crate::Role::Doctor | crate::Role::Nurse | crate::Role::Admin
    );
    if !may_notify {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot notify an ordering provider. Required: LabTechnician, Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let rejection = match data
        .repositories
        .specimen_rejections
        .get_by_id(&rejection_id)
        .await
    {
        Ok(r) => r,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Specimen rejection not found".to_string(),
                code: "REJECTION_NOT_FOUND".to_string(),
            })
        }
    };

    // Resolve the ordering provider before committing anything. A notification
    // with nobody to send it to is not a notification, and marking the
    // rejection "notified" in that case would be a lie the panel then repeats.
    let ordering_provider =
        match resolve_ordering_provider(&data, &rejection.specimen_id).await {
            Some(p) => p,
            None => return HttpResponse::UnprocessableEntity().json(ErrorResponse {
                success: false,
                error:
                    "This specimen has no ordering provider on record, so there is nobody to notify"
                        .to_string(),
                code: "NO_ORDERING_PROVIDER".to_string(),
            }),
        };

    let now = Utc::now();
    let committed = match data
        .repositories
        .specimen_rejections
        .mark_provider_notified(&rejection_id, now)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "The ordering provider has already been notified about this rejection"
                    .to_string(),
                code: "ALREADY_NOTIFIED".to_string(),
            })
        }
        Err(e) => {
            log::error!("Rejection notification transition failed for {rejection_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The notification could not be recorded".to_string(),
                code: "NOTIFICATION_UNAVAILABLE".to_string(),
            });
        }
    };

    // Audit before delivery, and treat it as an obligation. Telling a clinician
    // their specimen was rejected is a clinical communication; one nobody can
    // later attribute is not one that happened.
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        AccessLogEntry {
            access_id: crate::middleware::secure_tokens::generate_access_id(),
            patient_id: rejection.patient_id.clone(),
            accessor_id: current_user.wallet_address.clone(),
            accessor_role: current_user.role.to_string(),
            access_type: "specimen_rejection_notified".to_string(),
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

    // Delivery last, and best-effort. The record says the provider was told
    // and the audit says who told them; a push gateway outage must not undo a
    // transition the lab has already acted on, and re-pressing Notify would
    // then be refused as a duplicate. Push failure is logged inside
    // `send_push_to_user`.
    {
        let repos = data.repositories.clone();
        let provider = ordering_provider.clone();
        let patient = rejection.patient_id.clone();
        let reason = rejection.rejection_reason.clone();
        tokio::spawn(async move {
            crate::notifications::notify_critical_alert(
                &repos,
                &provider,
                &patient,
                &format!("Specimen rejected: {reason}. A recollection may be required."),
            )
            .await;
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "rejection_id": rejection_id,
        "ordering_provider_id": ordering_provider,
        "notified_at": committed.notification_sent_at,
    }))
}

/// Who ordered the specimen this rejection refers to.
///
/// `SpecimenRejectionEntity` records the specimen, not the order, so the
/// provider is reached through the collection that produced it:
/// specimen -> submission -> ordering provider. Returns `None` when any link
/// is missing, which the caller treats as "nobody to notify" rather than
/// guessing.
async fn resolve_ordering_provider(
    data: &web::Data<crate::AppState>,
    specimen_id: &str,
) -> Option<String> {
    let collection = data
        .repositories
        .specimen_collections
        .get_by_id(specimen_id)
        .await
        .ok()?;

    let submission = data
        .repositories
        .lab_submissions
        .get_by_id(&collection.submission_id)
        .await
        .ok()?;

    let provider = submission.ordering_provider_id;
    if provider.trim().is_empty() {
        return None;
    }
    Some(provider)
}

#[get("/api/clinical/specimen-rejection/{rejection_id}")]
pub async fn get_specimen_rejection(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let rejection_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .specimen_rejections
        .get_by_id(&rejection_id)
        .await
    {
        // Serialise the ENTITY, not `entity.data`.
        //
        // `SpecimenRejectionEntity.data` is `#[sqlx(skip)]`, so on PostgreSQL it
        // is always `null` -- every rejection read returned a bare `null` body
        // with a 200, which reads as "no such rejection" to any caller that
        // checks the payload rather than the status. The typed columns carry the
        // record; `data` is a memory-backend convenience.
        //
        // The Laboratory Dashboard had the identical defect for its rejection
        // panel. Same field, same cause.
        Ok(entity) => HttpResponse::Ok().json(entity),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Specimen rejection not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[cfg(test)]
mod rejection_notification_tests {
    use super::*;
    use actix_web::{test, App};

    fn user(wallet: &str, role: crate::Role) -> crate::User {
        crate::User {
            wallet_address: wallet.to_string(),
            username: None,
            name: format!("Test {wallet}"),
            role,
            created_at: Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    /// A rejection whose specimen traces back to an ordering provider, which is
    /// the only case where there is somebody to notify.
    async fn state_with_chain(link_order: bool) -> crate::AppState {
        let state = crate::AppState::new();
        for (w, r) in [
            ("lab_tech", crate::Role::LabTechnician),
            ("pharm", crate::Role::Pharmacist),
        ] {
            state
                .users
                .write()
                .unwrap()
                .insert(w.to_string(), user(w, r));
        }

        let now = Utc::now();

        if link_order {
            state
                .repositories
                .lab_submissions
                .create(crate::repositories::traits::LabSubmissionEntity {
                    id: "SUB-1".to_string(),
                    patient_id: "PAT-N1".to_string(),
                    ordering_provider_id: "doctor_orderer".to_string(),
                    order_date: now,
                    priority: "routine".to_string(),
                    status: "collected".to_string(),
                    tests_ordered: serde_json::json!(["FBC"]),
                    clinical_notes: None,
                    diagnosis_codes: None,
                    fasting_required: false,
                    collection_instructions: None,
                    expected_completion: None,
                    created_at: now,
                    updated_at: now,
                })
                .await
                .expect("seed lab order");

            state
                .repositories
                .specimen_collections
                .create(crate::repositories::traits::SpecimenCollectionEntity {
                    id: "SPC-N1".to_string(),
                    patient_id: "PAT-N1".to_string(),
                    submission_id: "SUB-1".to_string(),
                    specimen_type: "blood".to_string(),
                    collection_site: None,
                    collection_method: None,
                    collector_id: "lab_tech".to_string(),
                    collected_at: now,
                    received_at: None,
                    received_by: None,
                    container_type: None,
                    volume_ml: None,
                    temperature_c: None,
                    condition: None,
                    barcode: None,
                    storage_location: None,
                    chain_of_custody: None,
                    notes: None,
                    created_at: now,
                    updated_at: now,
                    data: serde_json::Value::Null,
                })
                .await
                .expect("seed specimen collection");
        }

        state
            .repositories
            .specimen_rejections
            .create(crate::repositories::traits::SpecimenRejectionEntity {
                id: "REJ-N1".to_string(),
                specimen_id: "SPC-N1".to_string(),
                patient_id: "PAT-N1".to_string(),
                rejection_reason: "Haemolysed sample".to_string(),
                rejection_category: "collection_error".to_string(),
                detailed_notes: None,
                rejected_by: "lab_tech".to_string(),
                rejected_at: now,
                recollection_required: false,
                recollection_scheduled: None,
                notified_ordering_provider: false,
                notification_sent_at: None,
                created_at: now,
                data: serde_json::Value::Null,
            })
            .await
            .expect("seed rejection");

        state
    }

    fn notify_request(rejection_id: &str, actor: &str) -> test::TestRequest {
        test::TestRequest::post()
            .uri(&format!(
                "/api/clinical/specimen-rejection/{rejection_id}/notify"
            ))
            .insert_header(("x-user-id", actor))
    }

    /// The whole point: the lab tells whoever ordered the specimen, and the
    /// record says so afterwards.
    #[actix_web::test]
    async fn notifying_records_the_provider_and_the_time() {
        let state = state_with_chain(true).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(notify_rejection_ordering_provider),
        )
        .await;

        let resp =
            test::call_service(&app, notify_request("REJ-N1", "lab_tech").to_request()).await;
        assert_eq!(resp.status(), 200);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(
            body["ordering_provider_id"], "doctor_orderer",
            "the provider is resolved through specimen -> submission, got {body}"
        );

        let stored = app_state
            .repositories
            .specimen_rejections
            .get_by_id("REJ-N1")
            .await
            .expect("rejection still present");
        assert!(stored.notified_ordering_provider);
        assert!(stored.notification_sent_at.is_some());
    }

    /// Exactly once. A provider receiving the same rejection twice has to work
    /// out whether it is one specimen or two.
    #[actix_web::test]
    async fn a_second_notification_is_refused() {
        let state = state_with_chain(true).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(notify_rejection_ordering_provider),
        )
        .await;

        let first =
            test::call_service(&app, notify_request("REJ-N1", "lab_tech").to_request()).await;
        assert_eq!(first.status(), 200);

        let second =
            test::call_service(&app, notify_request("REJ-N1", "lab_tech").to_request()).await;
        assert_eq!(second.status(), 409);
        let body: serde_json::Value = test::read_body_json(second).await;
        assert_eq!(body["error"]["code"], "ALREADY_NOTIFIED");
    }

    /// No order, nobody to tell — and crucially the rejection must NOT be
    /// marked notified, or the panel would repeat a lie every time it loads.
    #[actix_web::test]
    async fn a_specimen_with_no_order_is_refused_and_left_unmarked() {
        let state = state_with_chain(false).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(notify_rejection_ordering_provider),
        )
        .await;

        let resp =
            test::call_service(&app, notify_request("REJ-N1", "lab_tech").to_request()).await;
        assert_eq!(resp.status(), 422);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["error"]["code"], "NO_ORDERING_PROVIDER");

        let stored = app_state
            .repositories
            .specimen_rejections
            .get_by_id("REJ-N1")
            .await
            .expect("rejection still present");
        assert!(
            !stored.notified_ordering_provider,
            "a refused notification must not claim the provider was told"
        );
    }

    /// A pharmacist has no part in lab specimen handling.
    #[actix_web::test]
    async fn a_pharmacist_cannot_notify() {
        let state = state_with_chain(true).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(notify_rejection_ordering_provider),
        )
        .await;

        let resp = test::call_service(&app, notify_request("REJ-N1", "pharm").to_request()).await;
        assert_eq!(resp.status(), 403);
        assert!(
            !app_state
                .repositories
                .specimen_rejections
                .get_by_id("REJ-N1")
                .await
                .unwrap()
                .notified_ordering_provider
        );
    }

    /// An unknown rejection is a 404, not a 500 and not a silent success.
    #[actix_web::test]
    async fn an_unknown_rejection_is_not_found() {
        let state = state_with_chain(true).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(notify_rejection_ordering_provider),
        )
        .await;

        let resp = test::call_service(
            &app,
            notify_request("REJ-DOES-NOT-EXIST", "lab_tech").to_request(),
        )
        .await;
        assert_eq!(resp.status(), 404);
    }
}
