//! Chain of custody for forensic specimens, and custody transfers.

use crate::clinical_endpoints::*;

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
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_perform_laboratory_work() {
        return HttpResponse::Forbidden().json(ErrorResponse {
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
            .unwrap_or_else(|| current_user.id.clone()),
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
            .unwrap_or_else(|| current_user.id.clone()),
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
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("chain of custody could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
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
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
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
            error: "Chain of custody not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// What the custody-transfer form submits.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferCustodyRequest {
    /// Who is taking custody.
    pub transferred_to: String,
    /// Where the hand-over happened.
    pub location: String,
    /// The specimen's condition as the receiver found it.
    #[serde(default)]
    pub condition: String,
    /// Whether the tamper seal was unbroken at hand-over.
    pub seal_intact: bool,
    /// A witness's name. A name, not a signature: nothing here captures one.
    #[serde(default, alias = "witnessSignature")]
    pub witness: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn custody_error(status: actix_web::http::StatusCode, error: &str, code: &str) -> HttpResponse {
    HttpResponse::build(status).json(ErrorResponse {
        error: error.to_string(),
        code: code.to_string(),
    })
}

/// The hand-over as stored: the page's own keys, plus who recorded it.
///
/// The page used to invent `signature: "<name>-SIG"` for both parties. There is
/// no signature capture, so the record says who entered the transfer -- the
/// authenticated caller -- and names the witness as a name.
fn custody_transfer_entry(
    req: &TransferCustodyRequest,
    from: &str,
    recorded_by: &str,
    now: chrono::DateTime<Utc>,
) -> serde_json::Value {
    serde_json::json!({
        "transferredFrom": from,
        "transferredTo": req.transferred_to.trim(),
        "transferredAt": now.to_rfc3339(),
        "location": req.location.trim(),
        "condition": req.condition.trim(),
        "sealIntact": req.seal_intact,
        "witness": req.witness.as_deref().map(str::trim).filter(|w| !w.is_empty()),
        "notes": req.notes.as_deref().map(str::trim).filter(|n| !n.is_empty()),
        "recordedBy": recorded_by,
    })
}

/// Record a specimen hand-over.
///
/// "From" is whoever holds the specimen when the write lands, not what the
/// screen last showed, and the write is conditional on the record being
/// unchanged since it was read -- so two people recording hand-overs at once
/// cannot both succeed and leave a transfer out of the chain. A broken seal is
/// recorded and marks the specimen's integrity as compromised; it is not
/// refused, because the break is exactly what the chain must show.
#[post("/api/clinical/chain-of-custody/{form_id}/transfers")]
pub async fn transfer_chain_of_custody(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<TransferCustodyRequest>,
) -> impl Responder {
    use actix_web::http::StatusCode;
    let user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !(user.role.can_perform_laboratory_work() || user.role.can_edit_medical_records()) {
        return custody_error(
            StatusCode::FORBIDDEN,
            "Only staff who handle specimens record a custody transfer",
            "INSUFFICIENT_ROLE",
        );
    }
    let req = body.into_inner();
    if req.transferred_to.trim().is_empty() || req.location.trim().is_empty() {
        return custody_error(
            StatusCode::BAD_REQUEST,
            "Who took custody and where the hand-over happened are both required",
            "VALIDATION_ERROR",
        );
    }
    let form_id = path.into_inner();
    let record = match data.repositories.chain_of_custody.get_by_id(&form_id).await {
        Ok(record) => record,
        Err(RepositoryError::NotFound(_)) => {
            return custody_error(
                StatusCode::NOT_FOUND,
                "Custody record not found",
                "NOT_FOUND",
            )
        }
        Err(error) => {
            log::error!("custody record read failed: {error}");
            return custody_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The custody record could not be read",
                "REPO_ERROR",
            );
        }
    };
    if matches!(record.status.as_str(), "released" | "destroyed" | "lost") {
        return custody_error(
            StatusCode::CONFLICT,
            "A released, destroyed or lost specimen cannot be handed over",
            "CUSTODY_CLOSED",
        );
    }
    let now = Utc::now();
    let from = record
        .data
        .get("current_custodian")
        .and_then(|value| value.as_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(&record.current_custodian_id)
        .to_string();
    let entry = custody_transfer_entry(&req, &from, &user.id, now);
    let mut document = record.data.clone();
    if let Some(doc) = document.as_object_mut() {
        doc.insert("current_custodian".into(), req.transferred_to.trim().into());
        doc.insert("current_location".into(), req.location.trim().into());
        doc.insert("specimen_status".into(), "in-transit".into());
        if !req.seal_intact {
            doc.insert("integrity_verified".into(), false.into());
        }
    }
    let transfer = CustodyTransfer {
        new_custodian: req.transferred_to.trim().to_string(),
        location: req.location.trim().to_string(),
        status: custody_status_for("in-transit").to_string(),
        entry,
        data: document,
    };
    let updated = match data
        .repositories
        .chain_of_custody
        .transfer(&form_id, record.updated_at, transfer)
        .await
    {
        Ok(Some(updated)) => updated,
        Ok(None) => {
            return custody_error(
                StatusCode::CONFLICT,
                "This record changed while the transfer was being recorded. Reload it and record the hand-over again.",
                "CUSTODY_CHANGED",
            )
        }
        Err(error) => {
            log::error!("custody transfer failed: {error}");
            return custody_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The transfer could not be recorded",
                "REPO_ERROR",
            );
        }
    };
    if let Some(patient_id) = updated.patient_id.clone() {
        let audit = AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id,
            accessor_id: user.id.clone(),
            accessor_role: user.role.to_string(),
            access_type: "custody_transferred".to_string(),
            location: None,
            timestamp: now,
            emergency: false,
        };
        if let Err(response) = crate::support::require_durable_audit(&data, audit.into()).await {
            return response;
        }
    }
    HttpResponse::Ok().json(serde_json::json!({ "success": true, "record": updated }))
}

#[cfg(test)]
mod custody_transfer_tests {
    use super::*;
    use crate::test_fixtures::{register, seed_patient};
    use actix_web::{http::StatusCode, test, App};

    async fn state_with_record() -> (web::Data<AppState>, String) {
        let state = AppState::new();
        register(&state, "lab_tech", crate::Role::LabTechnician);
        register(&state, "pharmacist", crate::Role::Pharmacist);
        seed_patient(&state, "PAT-COC-1").await;
        let now = Utc::now();
        state
            .repositories
            .chain_of_custody
            .create(ChainOfCustodyEntity {
                id: "COC-1".to_string(),
                patient_id: Some("PAT-COC-1".to_string()),
                evidence_type: "blood_sample".to_string(),
                evidence_description: "Blood alcohol".to_string(),
                quantity: 1,
                collection_datetime: now,
                collected_by: "lab_tech".to_string(),
                seal_number: Some("SEAL-1".to_string()),
                current_custodian_id: "lab_tech".to_string(),
                transfers: serde_json::json!([]),
                status: "in_custody".to_string(),
                created_at: now,
                updated_at: now,
                data: serde_json::json!({ "custody_id": "COC-1", "current_custodian": "Jane (lab)" }),
                ..Default::default()
            })
            .await
            .unwrap();
        (web::Data::new(state), "COC-1".to_string())
    }

    fn hand_over(to: &str, seal_intact: bool) -> serde_json::Value {
        serde_json::json!({
            "transferredTo": to, "location": "Courier bay", "condition": "cold, sealed",
            "sealIntact": seal_intact, "witnessSignature": "Officer Dube"
        })
    }

    #[actix_web::test]
    async fn successive_hand_overs_all_land_in_order_from_the_current_holder() {
        let (state, id) = state_with_record().await;
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(transfer_chain_of_custody),
        )
        .await;

        for to in ["Courier A", "Forensic lab"] {
            let resp = test::call_service(
                &app,
                test::TestRequest::post()
                    .uri(&format!("/api/clinical/chain-of-custody/{id}/transfers"))
                    .insert_header(crate::test_fixtures::as_user("lab_tech"))
                    .set_json(hand_over(to, true))
                    .to_request(),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::OK, "hand-over to {to}");
        }

        let stored = state
            .repositories
            .chain_of_custody
            .get_by_id(&id)
            .await
            .unwrap();
        let transfers = stored.transfers.as_array().unwrap();
        assert_eq!(transfers.len(), 2);
        assert_eq!(transfers[0]["transferredFrom"], "Jane (lab)");
        assert_eq!(transfers[1]["transferredFrom"], "Courier A");
        assert_eq!(transfers[1]["recordedBy"], "lab_tech");
        assert_eq!(transfers[1]["witness"], "Officer Dube");
        assert!(transfers[1].get("signature").is_none());
        assert_eq!(stored.current_custodian_id, "Forensic lab");
    }

    #[actix_web::test]
    async fn a_broken_seal_is_recorded_and_marks_integrity_compromised() {
        let (state, id) = state_with_record().await;
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(transfer_chain_of_custody),
        )
        .await;
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/clinical/chain-of-custody/{id}/transfers"))
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(hand_over("Courier A", false))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let stored = state
            .repositories
            .chain_of_custody
            .get_by_id(&id)
            .await
            .unwrap();
        assert_eq!(stored.data["integrity_verified"], false);
    }

    #[actix_web::test]
    async fn a_pharmacist_cannot_record_a_hand_over() {
        let (state, id) = state_with_record().await;
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(transfer_chain_of_custody),
        )
        .await;
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/clinical/chain-of-custody/{id}/transfers"))
                .insert_header(crate::test_fixtures::as_user("pharmacist"))
                .set_json(hand_over("Courier A", true))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }
}
