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

    if !current_user.role.can_edit_medical_records() {
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
        priority: record.priority.clone().unwrap_or_else(|| "routine".to_string()),
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
        Ok(entity) => HttpResponse::Ok().json(entity.data),
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
#[post("/api/clinical/chain-of-custody")]
pub async fn create_chain_of_custody(
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = req.into_inner();
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let form_id = format!("COC-{}", uuid::Uuid::new_v4().simple());
    let entity = ChainOfCustodyEntity {
        id: form_id.clone(),
        patient_id: body.get("patient_id").and_then(|v| v.as_str()).map(str::to_string),
        case_number: body.get("case_number").and_then(|v| v.as_str()).map(str::to_string),
        evidence_type: body.get("evidence_type").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("blood_sample").to_string(),
        evidence_description: body.get("evidence_description").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        quantity: body.get("quantity").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        unit_of_measure: body.get("unit_of_measure").and_then(|v| v.as_str()).map(str::to_string),
        collection_datetime: body.get("collection_datetime").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)).unwrap_or(now),
        collection_location: body.get("collection_location").and_then(|v| v.as_str()).map(str::to_string),
        collected_by: body.get("collected_by").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        collection_witnessed_by: body.get("collection_witnessed_by").and_then(|v| v.as_str()).map(str::to_string),
        collection_method: body.get("collection_method").and_then(|v| v.as_str()).map(str::to_string),
        packaging_description: body.get("packaging_description").and_then(|v| v.as_str()).map(str::to_string),
        seal_number: body.get("seal_number").and_then(|v| v.as_str()).map(str::to_string),
        storage_location: body.get("storage_location").and_then(|v| v.as_str()).map(str::to_string),
        storage_requirements: body.get("storage_requirements").and_then(|v| v.as_str()).map(str::to_string),
        current_custodian_id: body.get("current_custodian_id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        transfers: body.get("transfers").cloned().unwrap_or_else(|| serde_json::json!({})),
        law_enforcement_agency: body.get("law_enforcement_agency").and_then(|v| v.as_str()).map(str::to_string),
        law_enforcement_officer: body.get("law_enforcement_officer").and_then(|v| v.as_str()).map(str::to_string),
        law_enforcement_badge: body.get("law_enforcement_badge").and_then(|v| v.as_str()).map(str::to_string),
        warrant_number: body.get("warrant_number").and_then(|v| v.as_str()).map(str::to_string),
        court_order_number: body.get("court_order_number").and_then(|v| v.as_str()).map(str::to_string),
        released_to: body.get("released_to").and_then(|v| v.as_str()).map(str::to_string),
        release_datetime: body.get("release_datetime").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)),
        release_authorized_by: body.get("release_authorized_by").and_then(|v| v.as_str()).map(str::to_string),
        release_documentation: body.get("release_documentation").and_then(|v| v.as_str()).map(str::to_string),
        destruction_authorized: body.get("destruction_authorized").and_then(|v| v.as_bool()).unwrap_or(false),
        destruction_datetime: body.get("destruction_datetime").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)),
        destruction_method: body.get("destruction_method").and_then(|v| v.as_str()).map(str::to_string),
        destruction_witnessed_by: body.get("destruction_witnessed_by").and_then(|v| v.as_str()).map(str::to_string),
        status: body.get("status").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("in_custody").to_string(),
        photos_taken: body.get("photos_taken").and_then(|v| v.as_bool()).unwrap_or(false),
        photo_references: body.get("photo_references").cloned(),
        notes: body.get("notes").and_then(|v| v.as_str()).map(str::to_string),
        created_at: now,
        updated_at: now,
        data: body.clone(),
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
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
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
        Ok(entity) => HttpResponse::Ok().json(entity.data),
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

/// Create lab QC record
#[post("/api/clinical/lab-qc")]
pub async fn create_lab_qc(
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = req.into_inner();
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let qc_id = format!("QC-{}", uuid::Uuid::new_v4().simple());
    let entity = LabQcRecordEntity {
        id: qc_id.clone(),
        instrument_id: body.get("instrument_id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        instrument_name: body.get("instrument_name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        qc_level: body.get("qc_level").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("level1").to_string(),
        test_code: body.get("test_code").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        test_name: body.get("test_name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        expected_value: body.get("expected_value").and_then(|v| v.as_f64()).and_then(rust_decimal::Decimal::from_f64_retain).unwrap_or_default(),
        measured_value: body.get("measured_value").and_then(|v| v.as_f64()).and_then(rust_decimal::Decimal::from_f64_retain).unwrap_or_default(),
        unit: body.get("unit").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        acceptable_range_low: body.get("acceptable_range_low").and_then(|v| v.as_f64()).and_then(rust_decimal::Decimal::from_f64_retain).unwrap_or_default(),
        acceptable_range_high: body.get("acceptable_range_high").and_then(|v| v.as_f64()).and_then(rust_decimal::Decimal::from_f64_retain).unwrap_or_default(),
        passed: body.get("passed").and_then(|v| v.as_bool()).unwrap_or(false),
        deviation_percent: body.get("deviation_percent").and_then(|v| v.as_f64()).and_then(rust_decimal::Decimal::from_f64_retain),
        corrective_action: body.get("corrective_action").and_then(|v| v.as_str()).map(str::to_string),
        performed_by: body.get("performed_by").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        reviewed_by: body.get("reviewed_by").and_then(|v| v.as_str()).map(str::to_string),
        performed_at: body.get("performed_at").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)).unwrap_or(now),
        reviewed_at: body.get("reviewed_at").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)),
        lot_number: body.get("lot_number").and_then(|v| v.as_str()).map(str::to_string),
        expiration_date: body.get("expiration_date").and_then(|v| v.as_str()).and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()),
        created_at: now,
        data: body.clone(),
    };

    match data.repositories.lab_qc_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "qc_id": qc_id
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
        Ok(entity) => HttpResponse::Ok().json(entity.data),
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

/// Create critical value notification
#[post("/api/clinical/critical-value")]
pub async fn create_critical_value(
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = req.into_inner();
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let notification_id = format!("CRV-{}", uuid::Uuid::new_v4().simple());
    // The SSE alert below needs these after the entity is moved into the
    // repository, so read them from the body first.
    let patient_id = body
        .get("patient_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let test_name = body
        .get("test_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let unit = body
        .get("unit")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let critical_value_str = body
        .get("value")
        .map(|v| v.to_string())
        .unwrap_or_else(|| "-".to_string());

    let entity = CriticalValueEntity {
        id: notification_id.clone(),
        patient_id: body.get("patient_id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        lab_panel_id: body.get("lab_panel_id").and_then(|v| v.as_str()).map(str::to_string),
        test_code: body.get("test_code").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        test_name: body.get("test_name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        value: body.get("value").and_then(|v| v.as_f64()).and_then(rust_decimal::Decimal::from_f64_retain).unwrap_or_default(),
        unit: body.get("unit").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        reference_low: body.get("reference_low").and_then(|v| v.as_f64()).and_then(rust_decimal::Decimal::from_f64_retain),
        reference_high: body.get("reference_high").and_then(|v| v.as_f64()).and_then(rust_decimal::Decimal::from_f64_retain),
        critical_low: body.get("critical_low").and_then(|v| v.as_f64()).and_then(rust_decimal::Decimal::from_f64_retain),
        critical_high: body.get("critical_high").and_then(|v| v.as_f64()).and_then(rust_decimal::Decimal::from_f64_retain),
        severity: body.get("severity").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("critical").to_string(),
        notified_provider_id: body.get("notified_provider_id").and_then(|v| v.as_str()).map(str::to_string),
        notification_method: body.get("notification_method").and_then(|v| v.as_str()).map(str::to_string),
        notified_at: body.get("notified_at").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)),
        acknowledged_at: body.get("acknowledged_at").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)),
        acknowledged_by: body.get("acknowledged_by").and_then(|v| v.as_str()).map(str::to_string),
        action_taken: body.get("action_taken").and_then(|v| v.as_str()).map(str::to_string),
        reported_by: body.get("reported_by").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        created_at: now,
        data: body.clone(),
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
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
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
        Ok(entity) => HttpResponse::Ok().json(entity.data),
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = req.into_inner();
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let rejection_id = format!("REJ-{}", uuid::Uuid::new_v4().simple());
    let entity = SpecimenRejectionEntity {
        id: rejection_id.clone(),
        specimen_id: body.get("specimen_id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        patient_id: body.get("patient_id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        rejection_reason: body.get("rejection_reason").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        rejection_category: body.get("rejection_category").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("collection_error").to_string(),
        detailed_notes: body.get("detailed_notes").and_then(|v| v.as_str()).map(str::to_string),
        rejected_by: body.get("rejected_by").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        rejected_at: body.get("rejected_at").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)).unwrap_or(now),
        recollection_required: body.get("recollection_required").and_then(|v| v.as_bool()).unwrap_or(false),
        recollection_scheduled: body.get("recollection_scheduled").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)),
        notified_ordering_provider: body.get("notified_ordering_provider").and_then(|v| v.as_bool()).unwrap_or(false),
        notification_sent_at: body.get("notification_sent_at").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)),
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
        Ok(entity) => HttpResponse::Ok().json(entity.data),
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
