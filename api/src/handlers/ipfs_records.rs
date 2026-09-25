use super::*;

// ============================================================================
// IPFS Medical Record Endpoints
// ============================================================================

/// Check IPFS connection status
#[get("/api/ipfs/health")]
pub async fn ipfs_health_check(data: web::Data<AppState>) -> impl Responder {
    let connected = data.ipfs_client.health_check().await.unwrap_or(false);

    // Report the *configured* endpoints, not hardcoded strings — this endpoint is
    // used to diagnose IPFS connectivity, and echoing constants that may not match
    // IPFS_API_URL/IPFS_GATEWAY_URL actively misleads that diagnosis.
    HttpResponse::Ok().json(IpfsHealthResponse {
        ipfs_connected: connected,
        api_url: data.ipfs_client.api_url().to_string(),
        gateway_url: data.ipfs_client.gateway_url().to_string(),
    })
}

/// Upload encrypted medical document to IPFS
/// Requires: Healthcare provider role (Doctor, Nurse, Admin)
#[post("/api/records/upload")]
pub async fn upload_medical_record(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<UploadMedicalRecordRequest>,
) -> impl Responder {
    // RBAC: Check if caller can edit medical records
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only doctors, nurses, and admins can upload medical records
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: format!(
                "Role '{}' cannot upload medical records. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Encryption policy enforcement: reject any request that explicitly sets encrypted=false.
    // All medical document uploads MUST be encrypted with ChaCha20-Poly1305.
    if !req.encrypted {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "Unencrypted document uploads are not permitted. \
                    All medical records must be encrypted (encrypted=true)."
                .to_string(),
            code: "ENCRYPTION_REQUIRED".to_string(),
        });
    }

    // Verify patient exists and resolve its on-chain account once.
    let patient = match data.repositories.patients.get_by_id(&req.patient_id).await {
        Ok(patient) => patient,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    };
    let patient_account = patient.wallet_address;
    if crate::blockchain::blockchain_enabled() && patient_account.is_none() {
        return HttpResponse::Conflict().json(ErrorResponse {
            error: "Patient has no wallet bound for blockchain recording".to_string(),
            code: "PATIENT_WALLET_REQUIRED".to_string(),
        });
    }

    if let Some(response) =
        patient_read_denial(&data, &current_user, &current_user_id, &req.patient_id).await
    {
        return response;
    }

    // Decode base64 content
    let content = match base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.content_base64,
    ) {
        Ok(c) => c,
        Err(e) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: format!("Invalid base64 content: {}", e),
                code: "INVALID_CONTENT".to_string(),
            });
        }
    };

    // Create metadata
    let metadata = EncryptedMetadata {
        filename: req.filename.clone(),
        content_type: req.content_type.clone(),
        uploaded_at: Utc::now().timestamp(),
        patient_id: req.patient_id.clone(),
        uploaded_by: current_user_id.clone(),
        record_type: req.record_type.clone(),
        key_version: "1.0".to_string(),
    };

    // Calculate content checksum (convert to hex string)
    let content_checksum = hex::encode(medichain_crypto::sha256(&content));

    // Upload to IPFS with encryption
    let upload_result = match data
        .ipfs_client
        .upload_encrypted(&content, metadata, &data.encryption_keyring)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: format!("IPFS upload failed: {}", e),
                code: "IPFS_ERROR".to_string(),
            });
        }
    };

    // Create record reference for on-chain storage
    let record_ref = MedicalRecordReference {
        content_hash: upload_result.ipfs_hash.clone(),
        metadata_hash: upload_result.metadata_hash.clone(),
        record_type: req.record_type.clone(),
        uploaded_at: Utc::now().timestamp(),
        content_checksum,
    };

    let mut record_entity: crate::repositories::traits::MedicalRecordEntity =
        (req.patient_id.clone(), record_ref.clone()).into();
    record_entity.created_by = current_user_id.clone();
    record_entity.last_modified_by = current_user_id.clone();
    let record_id = record_entity.id.clone();
    if let Err(error) = data
        .repositories
        .medical_records
        .create(record_entity)
        .await
    {
        log::error!("Medical record persistence failed: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "The encrypted content was uploaded, but its medical-record reference could not be saved."
                .to_string(),
            code: "RECORD_PERSISTENCE_REQUIRED".to_string(),
        });
    }

    let access_id = secure_tokens::generate_access_id();
    let access_log: crate::repositories::AccessLogEntity = AccessLogEntry {
        access_id: access_id.clone(),
        patient_id: req.patient_id.clone(),
        accessor_id: current_user_id.clone(),
        accessor_role: current_user.role.to_string(),
        access_type: "upload_record".to_string(),
        location: None,
        timestamp: Utc::now(),
        emergency: false,
    }
    .into();
    if let Err(error) = data
        .repositories
        .record_access_atomic(&req.patient_id, access_log)
        .await
    {
        log::error!("Medical-record upload audit persistence failed: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error:
                "The medical record was saved, but its required access audit could not be recorded."
                    .to_string(),
            code: "AUDIT_PERSISTENCE_REQUIRED".to_string(),
        });
    }

    let patient_account = patient_account.as_deref().unwrap_or_default();
    let record_chain = match crate::audit_outbox::anchor_medical_record_or_queue(
        &data,
        &record_id,
        patient_account,
        &upload_result.ipfs_hash,
        &req.record_type,
        &current_user_id,
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            log::error!("Medical-record chain anchor could not be finalized or queued: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The record was saved, but its blockchain anchor could not be queued."
                    .to_string(),
                code: "CHAIN_ANCHOR_UNAVAILABLE".to_string(),
            });
        }
    };
    let access_chain = match crate::audit_outbox::anchor_access_or_queue(
        &data,
        "medical_record_access",
        &access_id,
        patient_account,
        &current_user_id,
        "UPLOAD_RECORD",
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            log::error!("Upload access chain audit could not be finalized or queued: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The record was saved, but its blockchain access audit could not be queued."
                    .to_string(),
                code: "CHAIN_AUDIT_UNAVAILABLE".to_string(),
            });
        }
    };

    HttpResponse::Created().json(UploadMedicalRecordResponse {
        success: true,
        ipfs_hash: upload_result.ipfs_hash,
        metadata_hash: upload_result.metadata_hash,
        record_reference: record_ref,
        record_chain_status: record_chain.status,
        record_blockchain_tx_hash: record_chain.transaction_hash,
        access_chain_status: access_chain.status,
        access_blockchain_tx_hash: access_chain.transaction_hash,
        message: "Medical record uploaded and encrypted successfully".to_string(),
    })
}

/// Download and decrypt medical document from IPFS
/// Requires: Healthcare provider role OR patient accessing own records
#[post("/api/records/download")]
pub async fn download_medical_record(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<DownloadMedicalRecordRequest>,
) -> impl Responder {
    // RBAC: Check caller permissions
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    let record = match data
        .repositories
        .medical_records
        .get_by_ipfs_hash(&req.content_hash)
        .await
    {
        Ok(record) => record,
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return access_denied();
        }
        Err(error) => {
            log::error!("Medical record lookup failed: {error}");
            return access_check_unavailable();
        }
    };
    if let Some(response) =
        patient_read_denial(&data, &current_user, &current_user_id, &record.patient_id).await
    {
        return response;
    }

    // Download and decrypt from IPFS
    let download_result = match data
        .ipfs_client
        .download_decrypted(
            &req.content_hash,
            &req.metadata_hash,
            &data.encryption_keyring,
        )
        .await
    {
        Ok(r) => r,
        Err(IpfsError::NotFound(hash)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: format!("Record not found: {}", hash),
                code: "RECORD_NOT_FOUND".to_string(),
            });
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: format!("IPFS download failed: {}", e),
                code: "IPFS_ERROR".to_string(),
            });
        }
    };

    let audit = AccessLogEntry {
        access_id: secure_tokens::generate_access_id(),
        patient_id: download_result.metadata.patient_id.clone(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        access_type: "download_record".to_string(),
        location: None,
        timestamp: Utc::now(),
        emergency: false,
    };
    if let Err(response) = crate::support::require_durable_audit(&data, audit.into()).await {
        return response;
    }

    // Encode content as base64 for JSON response
    let content_base64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &download_result.content,
    );

    HttpResponse::Ok().json(DownloadMedicalRecordResponse {
        success: true,
        content_base64,
        filename: download_result.metadata.filename,
        content_type: download_result.metadata.content_type,
        record_type: download_result.metadata.record_type,
        uploaded_by: download_result.metadata.uploaded_by,
        uploaded_at: download_result.metadata.uploaded_at,
    })
}

/// Download a medical record's decrypted bytes by its content hash.
///
/// The patient-app MyRecordsPage links each record by its `content_hash` and
/// expects a raw file blob it can save directly — unlike the base64-JSON
/// `POST /api/records/download` above. Same ownership rule: a patient may only
/// download their own records; a provider may download any.
/// A patient may download only their own record; any healthcare provider may.
///
/// The IPFS path gets this from the `medical_records` row; these kinds have no
/// such row, so they check the owning patient themselves.
async fn may_read_patient(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    patient_id: &str,
) -> Result<bool, &'static str> {
    if crate::support::caller_owns_patient_record(data, caller_id, patient_id) {
        return Ok(true);
    }
    if !caller.role.is_healthcare_provider() {
        return Ok(false);
    }
    data.patient_access
        .provider_has_active_grant(patient_id, caller_id, Utc::now())
        .await
}

async fn patient_read_denial(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    patient_id: &str,
) -> Option<HttpResponse> {
    match may_read_patient(data, caller, caller_id, patient_id).await {
        Ok(true) => None,
        Ok(false) => Some(access_denied()),
        Err(_) => Some(access_check_unavailable()),
    }
}

fn access_denied() -> HttpResponse {
    HttpResponse::Forbidden().json(ErrorResponse {
        error: "Patients can only download their own medical records".to_string(),
        code: "ACCESS_DENIED".to_string(),
    })
}

fn access_check_unavailable() -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        error: "Patient consent records are temporarily unavailable".to_string(),
        code: "CONSENT_CHECK_UNAVAILABLE".to_string(),
    })
}

/// Render a stored timestamp, which these records hold as unix seconds.
///
/// A string-only read renders every date as "-", because the field is a JSON
/// number rather than an ISO string.
fn timestamp_text(object: &serde_json::Value, key: &str) -> String {
    let value = match object.get(key) {
        Some(v) => v,
        None => return "-".to_string(),
    };
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    value
        .as_i64()
        .and_then(|secs| chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0))
        .map(|dt| dt.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_else(|| "-".to_string())
}

/// A History & Physical as a readable document.
async fn download_history_physical(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    hp_id: &str,
) -> HttpResponse {
    let hp = match data.repositories.history_physicals.get_by_id(hp_id).await {
        Ok(hp) => hp,
        Err(e) => {
            log::error!("history and physical lookup failed: {e}");
            return not_found("History and physical");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &hp.patient_id).await {
        return response;
    }
    let some = |value: &Option<String>| value.clone().unwrap_or_else(|| "-".to_string());
    let json_lines = |value: &Option<serde_json::Value>| match value {
        Some(serde_json::Value::Object(map)) if !map.is_empty() => map
            .iter()
            .map(|(k, v)| {
                let detail = v
                    .get("findings")
                    .and_then(|f| f.as_str())
                    .filter(|f| !f.is_empty())
                    .map(|f| format!(" - {f}"))
                    .unwrap_or_default();
                let status = v
                    .get("status")
                    .and_then(|st| st.as_str())
                    .unwrap_or_else(|| v.as_str().unwrap_or("recorded"));
                format!("  {k:<18}{status}{detail}")
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => "  (none recorded)".to_string(),
    };

    let mut body = format!("History and physical {hp_id}\n\n");
    body.push_str(&format!("Patient:      {}\n", hp.patient_id));
    body.push_str(&format!("Exam type:    {}\n", some(&hp.exam_type)));
    body.push_str(&format!("Performed by: {}\n", hp.performed_by));
    body.push_str(&format!(
        "Performed:    {}\n\n",
        hp.performed_at.format("%Y-%m-%d %H:%M UTC")
    ));
    body.push_str(&format!("Chief complaint:\n  {}\n\n", hp.chief_complaint));
    body.push_str(&format!(
        "History of present illness:\n  {}\n\n",
        hp.history_present_illness
    ));
    body.push_str(&format!(
        "Past medical history:\n  {}\n\n",
        some(&hp.past_medical_history)
    ));
    body.push_str(&format!("Medications:\n  {}\n\n", some(&hp.medications)));
    body.push_str(&format!("Allergies:\n  {}\n\n", some(&hp.allergies)));
    body.push_str(&format!(
        "Family history:\n  {}\n\n",
        some(&hp.family_history)
    ));
    body.push_str("Review of systems\n");
    body.push_str(&json_lines(&hp.review_of_systems));
    body.push_str("\n\nPhysical examination\n");
    body.push_str(&json_lines(&Some(hp.physical_exam.clone())));
    body.push_str(&format!("\n\nAssessment:\n  {}\n\n", hp.assessment));
    body.push_str(&format!("Plan:\n  {}\n", hp.plan_content));
    text_document(hp_id, body)
}

/// A progress note as a readable document.
async fn download_progress_note(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    note_id: &str,
) -> HttpResponse {
    let note = match data.repositories.progress_notes.get_by_id(note_id).await {
        Ok(note) => note,
        Err(e) => {
            log::error!("progress note lookup failed: {e}");
            return not_found("Progress note");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &note.patient_id).await {
        return response;
    }
    let mut body = format!("Progress note {note_id}\n\n");
    body.push_str(&format!("Patient:    {}\n", note.patient_id));
    body.push_str(&format!("Type:       {}\n", note.note_type));
    body.push_str(&format!("Status:     {}\n", note.status));
    body.push_str(&format!("Author:     {}\n", note.created_by));
    body.push_str(&format!(
        "Recorded:   {}\n\n",
        note.created_at.format("%Y-%m-%d %H:%M UTC")
    ));
    let section = |value: &Option<String>| value.clone().unwrap_or_else(|| "-".to_string());
    body.push_str(&format!("SUBJECTIVE\n  {}\n\n", section(&note.subjective)));
    body.push_str(&format!("OBJECTIVE\n  {}\n\n", section(&note.objective)));
    body.push_str(&format!("ASSESSMENT\n  {}\n\n", section(&note.assessment)));
    body.push_str(&format!("PLAN\n  {}\n", section(&note.plan_content)));
    text_document(note_id, body)
}

/// A wound assessment as a readable document.
async fn download_wound(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    wound_id: &str,
) -> HttpResponse {
    let wound = match data
        .repositories
        .wound_assessments
        .get_by_id(wound_id)
        .await
    {
        Ok(wound) => wound,
        Err(e) => {
            log::error!("wound assessment lookup failed: {e}");
            return not_found("Wound assessment");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &wound.patient_id).await {
        return response;
    }
    let cm = |v: &Option<rust_decimal::Decimal>| {
        v.map(|d| format!("{d} cm"))
            .unwrap_or_else(|| "-".to_string())
    };
    let some = |v: &Option<String>| v.clone().unwrap_or_else(|| "-".to_string());
    let mut body = format!("Wound assessment {wound_id}\n\n");
    body.push_str(&format!("Patient:      {}\n", wound.patient_id));
    body.push_str(&format!("Assessed by:  {}\n", wound.assessed_by));
    body.push_str(&format!(
        "Assessed:     {}\n\n",
        wound.assessed_at.format("%Y-%m-%d %H:%M UTC")
    ));
    body.push_str(&format!("Wound type:   {}\n", wound.wound_type));
    body.push_str(&format!("Location:     {}\n\n", wound.wound_location));
    body.push_str("MEASUREMENTS\n");
    body.push_str(&format!("  Length:     {}\n", cm(&wound.length_cm)));
    body.push_str(&format!("  Width:      {}\n", cm(&wound.width_cm)));
    body.push_str(&format!("  Depth:      {}\n\n", cm(&wound.depth_cm)));
    body.push_str(&format!("Tissue type:  {}\n", some(&wound.tissue_type)));
    body.push_str(&format!("Exudate:      {}\n", some(&wound.drainage_amount)));
    body.push_str(&format!(
        "Pain level:   {}\n\n",
        wound
            .pain_level
            .map(|p| format!("{p}/10"))
            .unwrap_or_else(|| "-".to_string())
    ));
    body.push_str(&format!("Notes:\n  {}\n", some(&wound.notes)));
    text_document(wound_id, body)
}

/// A vital-signs reading as a readable document.
async fn download_vitals(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    vitals_id: &str,
) -> HttpResponse {
    let v = match data.repositories.vital_signs.get_by_id(vitals_id).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("vital-signs lookup failed: {e}");
            return not_found("Vital signs");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &v.patient_id).await {
        return response;
    }
    let num = |value: Option<i32>| {
        value
            .map(|n| n.to_string())
            .unwrap_or_else(|| "-".to_string())
    };
    let dec = |value: Option<f64>| {
        value
            .map(|n| format!("{n:.1}"))
            .unwrap_or_else(|| "-".to_string())
    };
    let bp = match (v.blood_pressure_systolic, v.blood_pressure_diastolic) {
        (Some(s), Some(d)) => format!("{s}/{d}"),
        _ => "-".to_string(),
    };
    let mut body = format!("Vital signs {vitals_id}\n\n");
    body.push_str(&format!("Patient:          {}\n", v.patient_id));
    body.push_str(&format!("Recorded by:      {}\n", v.recorded_by));
    body.push_str(&format!(
        "Recorded:         {}\n",
        v.recorded_at.format("%Y-%m-%d %H:%M UTC")
    ));
    body.push_str(&format!(
        "Critical:         {}\n\n",
        if v.is_critical { "YES" } else { "no" }
    ));
    body.push_str(&format!("  Heart rate:     {}\n", num(v.heart_rate)));
    body.push_str(&format!("  Respiratory:    {}\n", num(v.respiratory_rate)));
    body.push_str(&format!("  Blood pressure: {bp}\n"));
    body.push_str(&format!("  Temperature:    {} C\n", dec(v.temperature)));
    body.push_str(&format!("  O2 saturation:  {}\n", num(v.oxygen_saturation)));
    body.push_str(&format!("  Pain scale:     {}\n", num(v.pain_scale)));
    body.push_str(&format!("  GCS score:      {}\n", num(v.gcs_score)));
    body.push_str(&format!(
        "  Blood glucose:  {} mmol/L\n",
        dec(v.blood_glucose)
    ));
    body.push_str(&format!("  Weight:         {} kg\n", dec(v.weight_kg)));
    body.push_str(&format!("  Height:         {} cm\n", dec(v.height_cm)));
    text_document(vitals_id, body)
}

/// Wrap a rendered report in the download response every record kind shares.
fn text_document(filename: &str, body: String) -> HttpResponse {
    HttpResponse::Ok()
        .content_type("text/plain; charset=utf-8")
        .insert_header((
            "Content-Disposition",
            format!("attachment; filename=\"{filename}.txt\""),
        ))
        .body(body)
}

/// Render a structured, repository-backed clinical record without pretending it
/// was an IPFS object. The caller has already been authorized for the patient.
fn json_document<T: serde::Serialize>(filename: &str, kind: &str, record: &T) -> HttpResponse {
    match serde_json::to_string_pretty(record) {
        Ok(json) => text_document(filename, format!("{kind}\n\n{json}\n")),
        Err(error) => {
            log::error!("could not render {kind} {filename}: {error}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Could not render record".to_string(),
                code: "RENDER_ERROR".to_string(),
            })
        }
    }
}

fn not_found(kind: &str) -> HttpResponse {
    HttpResponse::NotFound().json(ErrorResponse {
        error: format!("{kind} not found"),
        code: "RECORD_NOT_FOUND".to_string(),
    })
}

/// A SOAP note as a readable document.
///
/// SOAP notes live in a JSON record repository and were never uploaded to IPFS,
/// so the patient portal listed them and then 404'd on both View and Download.
async fn download_soap_note(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    note_id: &str,
) -> HttpResponse {
    let record = match data.repositories.soap_note_records.get_by_id(note_id).await {
        Ok(Some(record)) => record,
        Ok(None) => return not_found("SOAP note"),
        Err(e) => {
            log::error!("SOAP-note lookup failed: {e}");
            return not_found("SOAP note");
        }
    };
    let v = record.data;
    let text = |object: &serde_json::Value, key: &str| -> String {
        object
            .get(key)
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("—")
            .to_string()
    };
    let patient_id = text(&v, "patient_id");
    if let Some(response) = patient_read_denial(data, caller, caller_id, &patient_id).await {
        return response;
    }

    // The four SOAP sections are nested objects, each with its own fields — a
    // flat read of "subjective"/"objective"/... yields nothing but placeholders.
    let empty = serde_json::Value::Null;
    let section = |name: &str| v.get(name).unwrap_or(&empty).clone();
    let (s, o, a, pl) = (
        section("subjective"),
        section("objective"),
        section("assessment"),
        section("plan"),
    );

    let mut body = format!("SOAP note {note_id}\n\n");
    body.push_str(&format!("Patient:    {patient_id}\n"));
    body.push_str(&format!("Author:     {}\n", text(&v, "author_id")));
    body.push_str(&format!("Encounter:  {}\n", text(&v, "encounter_type")));
    body.push_str(&format!(
        "Recorded:   {}\n",
        timestamp_text(&v, "created_at")
    ));
    body.push_str(&format!("Status:     {}\n\n", text(&v, "status")));

    body.push_str("SUBJECTIVE\n");
    body.push_str(&format!(
        "  Chief complaint: {}\n",
        text(&s, "chief_complaint")
    ));
    body.push_str(&format!(
        "  History:         {}\n",
        text(&s, "history_of_present_illness")
    ));
    body.push_str(&format!(
        "  Duration:        {}\n\n",
        text(&s, "symptom_duration")
    ));

    body.push_str("OBJECTIVE\n");
    body.push_str(&format!(
        "  Appearance:      {}\n",
        text(&o, "general_appearance")
    ));
    body.push_str(&format!(
        "  Exam:            {}\n",
        text(&o, "physical_exam")
    ));
    body.push_str(&format!(
        "  Labs:            {}\n\n",
        text(&o, "lab_results")
    ));

    body.push_str("ASSESSMENT\n");
    // A diagnosis is a structured object ({description, icd10_code, status}),
    // not a bare string — reading it flat rendered every note's diagnosis as "-".
    let diagnosis = a.get("primary_diagnosis").unwrap_or(&empty);
    let code = diagnosis
        .get("icd10_code")
        .and_then(|c| c.as_str())
        .map(|c| format!(" [{c}]"))
        .unwrap_or_default();
    body.push_str(&format!(
        "  Diagnosis:       {}{code}\n",
        text(diagnosis, "description")
    ));
    let secondary: Vec<String> = a
        .get("secondary_diagnoses")
        .and_then(|d| d.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|d| d.get("description").and_then(|x| x.as_str()))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if !secondary.is_empty() {
        body.push_str(&format!("  Also:            {}\n", secondary.join(", ")));
    }
    body.push_str(&format!("  Severity:        {}\n", text(&a, "severity")));
    body.push_str(&format!(
        "  Summary:         {}\n\n",
        text(&a, "clinical_summary")
    ));

    body.push_str("PLAN\n");
    body.push_str(&format!(
        "  Treatment:       {}\n",
        text(&pl, "treatment_plan")
    ));
    body.push_str(&format!("  Follow-up:       {}\n", text(&pl, "follow_up")));
    body.push_str(&format!(
        "  Education:       {}\n",
        text(&pl, "patient_education")
    ));
    text_document(note_id, body)
}

/// A prescription as a readable document.
async fn download_prescription(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    prescription_id: &str,
) -> HttpResponse {
    // The e-signature flow writes to `e_prescriptions_v2` (a JSON record repo),
    // not the typed `e_prescriptions` table, so that is where the prescriptions
    // the patient portal lists actually live.
    let record = match data
        .repositories
        .e_prescriptions_v2
        .get_by_id(prescription_id)
        .await
    {
        Ok(Some(record)) => record,
        Ok(None) => return not_found("Prescription"),
        Err(e) => {
            log::error!("prescription lookup failed: {e}");
            return not_found("Prescription");
        }
    };
    let v = record.data;
    // The drug and pharmacy details are nested objects, not root fields — a flat
    // read rendered every line as "—".
    let text = |object: &serde_json::Value, key: &str| -> String {
        object
            .get(key)
            .and_then(|x| x.as_str())
            .unwrap_or("—")
            .to_string()
    };
    let patient_id = text(&v, "patient_id");
    if let Some(response) = patient_read_denial(data, caller, caller_id, &patient_id).await {
        return response;
    }
    let empty = serde_json::Value::Null;
    let med = v.get("medication").unwrap_or(&empty);
    let pharmacy = v.get("pharmacy").unwrap_or(&empty);
    let quantity = med
        .get("quantity")
        .map(|q| q.to_string())
        .unwrap_or_else(|| "—".to_string());
    let days = med
        .get("days_supply")
        .map(|q| q.to_string())
        .unwrap_or_else(|| "—".to_string());

    let mut body = format!("Prescription {prescription_id}\n\n");
    body.push_str(&format!("Patient:      {patient_id}\n"));
    body.push_str(&format!("Prescriber:   {}\n", text(&v, "prescriber_name")));
    body.push_str(&format!("Status:       {}\n\n", text(&v, "status")));
    body.push_str(&format!("Medication:   {}\n", text(med, "name")));
    body.push_str(&format!("Generic:      {}\n", text(med, "generic_name")));
    body.push_str(&format!("Strength:     {}\n", text(med, "strength")));
    body.push_str(&format!("Form:         {}\n", text(med, "form")));
    body.push_str(&format!(
        "Quantity:     {quantity} {}\n",
        text(med, "quantity_unit")
    ));
    body.push_str(&format!("Days supply:  {days}\n\n"));
    body.push_str(&format!("Directions:   {}\n", text(med, "directions")));
    body.push_str(&format!(
        "Instructions: {}\n\n",
        text(&v, "patient_instructions")
    ));
    body.push_str(&format!("Pharmacy:     {}\n", text(pharmacy, "name")));
    body.push_str(&format!("              {}\n", text(pharmacy, "address")));
    body.push_str(&format!("              {}\n", text(pharmacy, "phone")));
    text_document(prescription_id, body)
}

/// A triage assessment as a readable document.
async fn download_triage(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    assessment_id: &str,
) -> HttpResponse {
    let a = match data
        .repositories
        .triage_assessments
        .get_by_id(assessment_id)
        .await
    {
        Ok(a) => a,
        Err(e) => {
            log::error!("triage lookup failed: {e}");
            return not_found("Triage assessment");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &a.patient_id).await {
        return response;
    }

    let num = |v: Option<i32>| v.map(|n| n.to_string()).unwrap_or_else(|| "-".into());
    let dec = |v: Option<f64>| v.map(|n| format!("{n:.1}")).unwrap_or_else(|| "-".into());
    let bp = match (a.blood_pressure_systolic, a.blood_pressure_diastolic) {
        (Some(s), Some(d)) => format!("{s}/{d}"),
        _ => "-".to_string(),
    };
    let wait = match a.esi_level {
        1 => "Immediate (0 minutes)",
        2 => "Immediate to 10 minutes",
        3 => "Up to 30 minutes",
        4 => "Up to 60 minutes",
        _ => "Up to 120 minutes or next available",
    };

    let mut body = format!("Triage assessment {}\n\n", a.id);
    body.push_str(&format!("Patient:           {}\n", a.patient_id));
    body.push_str(&format!("ESI level:         {} ({wait})\n", a.esi_level));
    body.push_str(&format!(
        "Triaged:           {}\n",
        a.triage_time.format("%Y-%m-%d %H:%M UTC")
    ));
    body.push_str(&format!("Triaged by:        {}\n", a.performed_by));
    body.push_str(&format!(
        "Critical vitals:   {}\n",
        if a.is_critical { "YES" } else { "no" }
    ));
    body.push_str(&format!(
        "Isolation:         {}\n",
        if a.requires_isolation {
            "required"
        } else {
            "not required"
        }
    ));
    body.push_str(&format!("\nChief complaint:   {}\n", a.chief_complaint));

    body.push_str("\nVITALS\n");
    body.push_str(&format!("  Heart rate:       {}\n", num(a.heart_rate)));
    body.push_str(&format!(
        "  Respiratory rate: {}\n",
        num(a.respiratory_rate)
    ));
    body.push_str(&format!("  Blood pressure:   {bp}\n"));
    body.push_str(&format!("  Temperature:      {} C\n", dec(a.temperature)));
    body.push_str(&format!(
        "  O2 saturation:    {}\n",
        num(a.oxygen_saturation)
    ));
    body.push_str(&format!("  Pain scale:       {}\n", num(a.pain_scale)));
    body.push_str(&format!("  GCS score:        {}\n", num(a.gcs_score)));
    body.push_str(&format!(
        "  Blood glucose:    {} mmol/L\n",
        dec(a.blood_glucose)
    ));
    body.push_str(&format!("  Weight:           {} kg\n", dec(a.weight)));

    if a.disposition.is_some() || a.assigned_bed.is_some() {
        body.push_str("\nDISPOSITION\n");
        body.push_str(&format!(
            "  Disposition:      {}\n",
            a.disposition.as_deref().unwrap_or("-")
        ));
        body.push_str(&format!(
            "  Assigned bed:     {}\n",
            a.assigned_bed.as_deref().unwrap_or("-")
        ));
    }
    text_document(&a.id, body)
}

/// Render an approved lab submission as a downloadable report.
///
/// Plain text rather than the raw stored JSON: this is handed to a patient as a
/// file, and a wall of JSON is not a lab result they can read. Values, units and
/// reference ranges are kept together so an out-of-range figure is interpretable
/// away from the app.
async fn download_lab_result(data: &web::Data<AppState>, submission_id: &str) -> HttpResponse {
    let record = match data
        .repositories
        .lab_result_submissions
        .get_by_id(submission_id)
        .await
    {
        Ok(Some(record)) => record,
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Lab result not found".to_string(),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("lab-result lookup failed: {e}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Lookup failed".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };

    let submission: LabResultSubmission = match serde_json::from_value(record.data) {
        Ok(submission) => submission,
        Err(e) => {
            log::error!("lab-result stored payload did not parse: {e}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Lab result could not be read".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };

    let mut report = String::new();
    report.push_str(&format!("Lab report: {}\n", submission.test_name));
    report.push_str(&format!("Category:   {}\n", submission.test_category));
    report.push_str(&format!("Patient:    {}\n", submission.patient_id));
    report.push_str(&format!(
        "Collected:  {}\n",
        submission.submitted_at.format("%Y-%m-%d %H:%M UTC")
    ));
    report.push_str(&format!("Status:     {}\n\n", submission.status));
    for result in &submission.results {
        let flag = result.flag.as_deref().unwrap_or("");
        report.push_str(&format!(
            "{:<28} {:>12} {:<10} (ref {}){}\n",
            result.parameter,
            result.value,
            result.unit,
            result.reference_range,
            if flag.is_empty() {
                String::new()
            } else {
                format!("  [{flag}]")
            }
        ));
    }
    if let Some(notes) = &submission.notes {
        report.push_str(&format!("\nNotes: {notes}\n"));
    }

    HttpResponse::Ok()
        .content_type("text/plain; charset=utf-8")
        .insert_header((
            "Content-Disposition",
            format!("attachment; filename=\"{submission_id}.txt\""),
        ))
        .body(report)
}

/// Render a patient's discharge summary as a readable document.
async fn download_discharge_summary(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    summary_id: &str,
) -> HttpResponse {
    let summary = match data
        .repositories
        .discharge_summaries
        .get_by_id(summary_id)
        .await
    {
        Ok(summary) => summary,
        Err(error) => {
            log::error!("discharge summary lookup failed: {error}");
            return not_found("Discharge summary");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &summary.patient_id).await
    {
        return response;
    }

    let json_text = |value: &serde_json::Value| match value {
        serde_json::Value::Null => "-".to_string(),
        serde_json::Value::String(text) => text.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_else(|_| "-".to_string()),
    };
    let optional = |value: &Option<String>| value.clone().unwrap_or_else(|| "-".to_string());
    let mut body = format!("Discharge summary {summary_id}\n\n");
    body.push_str(&format!("Patient:      {}\n", summary.patient_id));
    body.push_str(&format!(
        "Attending:    {}\n",
        summary.attending_physician_id
    ));
    body.push_str(&format!(
        "Admitted:     {}\nDischarged:  {}\n\n",
        summary.admission_datetime.format("%Y-%m-%d %H:%M UTC"),
        summary.discharge_datetime.format("%Y-%m-%d %H:%M UTC")
    ));
    body.push_str(&format!(
        "Principal diagnosis:\n  {}\n\n",
        optional(&summary.principal_diagnosis)
    ));
    body.push_str(&format!(
        "Discharge diagnosis:\n{}\n\n",
        json_text(&summary.discharge_diagnosis)
    ));
    body.push_str(&format!(
        "Hospital course:\n{}\n\n",
        summary.hospital_course
    ));
    body.push_str(&format!(
        "Condition at discharge: {}\n",
        summary.condition_at_discharge
    ));
    body.push_str(&format!(
        "Disposition:            {}\n\n",
        summary.discharge_disposition
    ));
    body.push_str(&format!(
        "Discharge medications:\n{}\n\n",
        json_text(&summary.discharge_medications)
    ));
    body.push_str(&format!(
        "Follow-up instructions:\n{}\n\n",
        optional(&summary.follow_up_instructions)
    ));
    body.push_str(&format!(
        "Warning signs:\n{}\n",
        optional(&summary.warning_signs)
    ));
    text_document(summary_id, body)
}

async fn download_radiology_order(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    id: &str,
) -> HttpResponse {
    let record = match data.repositories.radiology_orders.get_by_id(id).await {
        Ok(record) => record,
        Err(error) => {
            log::error!("radiology order lookup failed: {error}");
            return not_found("Radiology order");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &record.patient_id).await {
        return response;
    }
    json_document(id, "Radiology order", &record)
}

async fn download_radiology_report(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    id: &str,
) -> HttpResponse {
    let record = match data.repositories.radiology_reports.get_by_id(id).await {
        Ok(record) => record,
        Err(error) => {
            log::error!("radiology report lookup failed: {error}");
            return not_found("Radiology report");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &record.patient_id).await {
        return response;
    }
    json_document(id, "Radiology report", &record)
}

async fn download_pathology_report(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    id: &str,
) -> HttpResponse {
    let record = match data.repositories.pathology_reports.get_by_id(id).await {
        Ok(record) => record,
        Err(error) => {
            log::error!("pathology report lookup failed: {error}");
            return not_found("Pathology report");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &record.patient_id).await {
        return response;
    }
    json_document(id, "Pathology report", &record)
}

async fn download_consultation(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    id: &str,
) -> HttpResponse {
    let record = match data.repositories.consultation_notes.get_by_id(id).await {
        Ok(record) => record,
        Err(error) => {
            log::error!("consultation lookup failed: {error}");
            return not_found("Consultation");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &record.patient_id).await {
        return response;
    }
    json_document(id, "Consultation", &record)
}

async fn download_care_plan(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    id: &str,
) -> HttpResponse {
    let record = match data.repositories.nursing_care_plans.get_by_id(id).await {
        Ok(record) => record,
        Err(error) => {
            log::error!("care plan lookup failed: {error}");
            return not_found("Care plan");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &record.patient_id).await {
        return response;
    }
    json_document(id, "Nursing care plan", &record)
}

async fn download_discharge_instructions(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    id: &str,
) -> HttpResponse {
    let record = match data.repositories.discharge_instructions.get_by_id(id).await {
        Ok(record) => record,
        Err(error) => {
            log::error!("discharge instructions lookup failed: {error}");
            return not_found("Discharge instructions");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &record.patient_id).await {
        return response;
    }
    json_document(id, "Discharge instructions", &record)
}

/// A record kept in one of the JSON stores, rendered for its patient.
///
/// The blood-type-screen and transfusion downloads read the typed
/// `blood_type_screens` and `transfusion_records` repositories, which nothing
/// has written to since their handlers moved to the JSON stores below. The
/// patient's own list reads the JSON stores, so a patient could see a
/// transfusion listed and be told "not found" on opening it -- for every
/// transfusion ever recorded.
async fn download_json_record(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    id: &str,
    store: &dyn crate::repositories::traits::JsonRecordRepository,
    kind: &str,
) -> HttpResponse {
    let record = match store.get_by_id(id).await {
        Ok(Some(record)) => record,
        Ok(None) => return not_found(kind),
        Err(error) => {
            log::error!("{kind} lookup failed: {error}");
            return not_found(kind);
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &record.owner_id).await {
        return response;
    }
    json_document(id, kind, &record.data)
}

async fn download_blood_type_screen(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    id: &str,
) -> HttpResponse {
    let store = data.repositories.blood_type_screen_records.as_ref();
    download_json_record(data, caller, caller_id, id, store, "Blood type screen").await
}

async fn download_transfusion_record(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    id: &str,
) -> HttpResponse {
    let store = data.repositories.transfusion_event_records.as_ref();
    download_json_record(data, caller, caller_id, id, store, "Transfusion record").await
}

async fn download_ama_discharge(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    id: &str,
) -> HttpResponse {
    let record = match data.repositories.ama_discharges.get_by_id(id).await {
        Ok(record) => record,
        Err(error) => {
            log::error!("AMA discharge lookup failed: {error}");
            return not_found("AMA discharge");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &record.patient_id).await {
        return response;
    }
    json_document(id, "Discharge against medical advice", &record)
}

async fn download_gcs_assessment(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    id: &str,
) -> HttpResponse {
    let record = match data.repositories.gcs_assessments.get_by_id(id).await {
        Ok(record) => record,
        Err(error) => {
            log::error!("GCS assessment lookup failed: {error}");
            return not_found("GCS assessment");
        }
    };
    if let Some(response) = patient_read_denial(data, caller, caller_id, &record.patient_id).await {
        return response;
    }
    json_document(id, "Glasgow Coma Scale assessment", &record)
}

async fn download_procedure(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    kind: &str,
    id: &str,
) -> HttpResponse {
    macro_rules! render_procedure {
        ($repository:ident, $label:literal) => {{
            let record = match data.repositories.$repository.get_by_id(id).await {
                Ok(record) => record,
                Err(error) => {
                    log::error!(concat!($label, " lookup failed: {}"), error);
                    return not_found($label);
                }
            };
            if let Some(response) =
                patient_read_denial(data, caller, caller_id, &record.patient_id).await
            {
                return response;
            }
            json_document(id, $label, &record)
        }};
    }
    match kind {
        "intubations" => render_procedure!(intubation_records, "Intubation"),
        "laceration_repairs" => render_procedure!(laceration_repairs, "Laceration repair"),
        "splints_and_casts" => render_procedure!(splint_cast_records, "Splint or cast"),
        "burn_assessments" => render_procedure!(burn_assessments, "Burn assessment"),
        "anesthesia_records" => render_procedure!(anesthesia_records, "Anaesthesia record"),
        _ => HttpResponse::BadRequest().json(ErrorResponse {
            error: "Unsupported procedure document type".to_string(),
            code: "UNSUPPORTED_RECORD_TYPE".to_string(),
        }),
    }
}

/// Serve a document kept in its own clinical store rather than in IPFS.
///
/// Kinds that were never uploaded have no `medical_records` row, so they must be
/// resolved before the IPFS lookup, which would otherwise 404 them before they
/// were ever reached. `None` means the reference names no such kind. Each
/// helper authorizes against the owning patient itself.
async fn download_structured_document(
    data: &web::Data<AppState>,
    current_user: &crate::types::User,
    current_user_id: &str,
    content_hash: &str,
) -> Option<HttpResponse> {
    if let Some(note_id) = content_hash.strip_prefix("soap-") {
        return Some(download_soap_note(data, current_user, current_user_id, note_id).await);
    }
    if let Some(prescription_id) = content_hash.strip_prefix("rx-") {
        return Some(
            download_prescription(data, current_user, current_user_id, prescription_id).await,
        );
    }
    if let Some(hp_id) = content_hash.strip_prefix("hp-") {
        return Some(download_history_physical(data, current_user, current_user_id, hp_id).await);
    }
    if let Some(note_id) = content_hash.strip_prefix("progress-") {
        return Some(download_progress_note(data, current_user, current_user_id, note_id).await);
    }
    if let Some(wound_id) = content_hash.strip_prefix("wound-") {
        return Some(download_wound(data, current_user, current_user_id, wound_id).await);
    }
    if let Some(vitals_id) = content_hash.strip_prefix("vitals-") {
        return Some(download_vitals(data, current_user, current_user_id, vitals_id).await);
    }
    if let Some(assessment_id) = content_hash.strip_prefix("triage-") {
        return Some(download_triage(data, current_user, current_user_id, assessment_id).await);
    }
    // Test the longer discharge-instructions prefix first: it also begins with
    // `discharge-`, and routing it to a summary lookup would make a valid
    // instruction document appear missing.
    if let Some(instructions_id) = content_hash.strip_prefix("discharge-instructions-") {
        return Some(
            download_discharge_instructions(data, current_user, current_user_id, instructions_id)
                .await,
        );
    }
    if let Some(summary_id) = content_hash.strip_prefix("discharge-") {
        return Some(
            download_discharge_summary(data, current_user, current_user_id, summary_id).await,
        );
    }
    if let Some(report_id) = content_hash.strip_prefix("imaging-report-") {
        return Some(
            download_radiology_report(data, current_user, current_user_id, report_id).await,
        );
    }
    if let Some(order_id) = content_hash.strip_prefix("imaging-order-") {
        return Some(download_radiology_order(data, current_user, current_user_id, order_id).await);
    }
    if let Some(report_id) = content_hash.strip_prefix("pathology-") {
        return Some(
            download_pathology_report(data, current_user, current_user_id, report_id).await,
        );
    }
    if let Some(consultation_id) = content_hash.strip_prefix("consult-") {
        return Some(
            download_consultation(data, current_user, current_user_id, consultation_id).await,
        );
    }
    if let Some(plan_id) = content_hash.strip_prefix("care-plan-") {
        return Some(download_care_plan(data, current_user, current_user_id, plan_id).await);
    }
    if let Some(screen_id) = content_hash.strip_prefix("blood-screen-") {
        return Some(
            download_blood_type_screen(data, current_user, current_user_id, screen_id).await,
        );
    }
    if let Some(transfusion_id) = content_hash.strip_prefix("transfusion-") {
        return Some(
            download_transfusion_record(data, current_user, current_user_id, transfusion_id).await,
        );
    }
    if let Some(procedure_ref) = content_hash.strip_prefix("procedure-") {
        let Some((kind, procedure_id)) = procedure_ref.split_once('-') else {
            return Some(HttpResponse::BadRequest().json(ErrorResponse {
                error: "Procedure document reference is incomplete".to_string(),
                code: "INVALID_RECORD_REFERENCE".to_string(),
            }));
        };
        return Some(
            download_procedure(data, current_user, current_user_id, kind, procedure_id).await,
        );
    }
    if let Some(ama_id) = content_hash.strip_prefix("ama-") {
        return Some(download_ama_discharge(data, current_user, current_user_id, ama_id).await);
    }
    if let Some(assessment_id) = content_hash.strip_prefix("gcs-") {
        return Some(
            download_gcs_assessment(data, current_user, current_user_id, assessment_id).await,
        );
    }
    None
}

#[get("/api/records/{content_hash}/download")]
pub async fn download_medical_record_by_hash(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };
    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    let content_hash = path.into_inner();

    // Resolve the record to get its metadata hash and owner, unless the
    // reference names a document that lives in its own store.
    if let Some(response) =
        download_structured_document(&data, &current_user, &current_user_id, &content_hash).await
    {
        return response;
    }

    let entity = match data
        .repositories
        .medical_records
        .get_by_ipfs_hash(&content_hash)
        .await
    {
        Ok(e) => e,
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Record not found".to_string(),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Medical record lookup failed: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Lookup failed".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };
    if let Some(response) =
        patient_read_denial(&data, &current_user, &current_user_id, &entity.patient_id).await
    {
        return response;
    }
    // A record reference is a pointer, and not every pointer is an IPFS CID.
    // Approving a lab result files it in the patient's records with a synthetic
    // `lab-<submission id>` hash (see `handlers/lab.rs`), because the result
    // lives in the lab repository as structured data and was never uploaded to
    // IPFS. Handing that string to the IPFS client produced
    // "Invalid IPFS hash: lab-LAB-..." as a 500, so approved lab results
    // appeared in the record list and then refused to download - the
    // "some records download, some don't" the portals were showing.
    //
    // Resolve it from its real home instead. Authorization above has already
    // run, so this is reached only by someone entitled to the record.
    if let Some(submission_id) = content_hash.strip_prefix("lab-") {
        return download_lab_result(&data, submission_id).await;
    }

    let metadata_hash = match entity.ipfs_metadata_hash {
        Some(h) => h,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Record has no metadata reference".to_string(),
                code: "METADATA_MISSING".to_string(),
            })
        }
    };

    let result = match data
        .ipfs_client
        .download_decrypted(&content_hash, &metadata_hash, &data.encryption_keyring)
        .await
    {
        Ok(r) => r,
        Err(IpfsError::NotFound(hash)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: format!("Record content not found: {}", hash),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: format!("IPFS download failed: {}", e),
                code: "IPFS_ERROR".to_string(),
            })
        }
    };

    let audit = AccessLogEntry {
        access_id: secure_tokens::generate_access_id(),
        patient_id: result.metadata.patient_id.clone(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        access_type: "download_record".to_string(),
        location: None,
        timestamp: Utc::now(),
        emergency: false,
    };
    if let Err(response) = crate::support::require_durable_audit(&data, audit.into()).await {
        return response;
    }

    let filename = result.metadata.filename.clone();
    let content_type = if result.metadata.content_type.trim().is_empty() {
        "application/octet-stream".to_string()
    } else {
        result.metadata.content_type.clone()
    };
    HttpResponse::Ok()
        .content_type(content_type)
        .insert_header((
            "Content-Disposition",
            format!("attachment; filename=\"{}\"", filename),
        ))
        .body(result.content)
}

#[cfg(test)]
mod structured_document_download_tests {
    use super::*;
    use crate::{repositories::traits::GcsAssessmentEntity, Role, User};
    use actix_web::{body::to_bytes, test, web, App};

    fn state_with_linked_patient(wallet: &str, linked_patient_id: &str) -> web::Data<AppState> {
        let state = AppState::new();
        state.users.write().unwrap().insert(
            wallet.to_string(),
            User {
                wallet_address: wallet.to_string(),
                username: None,
                name: "Test patient".to_string(),
                role: Role::Patient,
                created_at: Utc::now(),
                created_by: None,
                linked_patient_id: Some(linked_patient_id.to_string()),
                email: None,
                phone: None,
                department: None,
                specialty: None,
                license_number: None,
                status: "active".to_string(),
                last_login: None,
            },
        );
        web::Data::new(state)
    }

    #[actix_rt::test]
    async fn a_patient_can_download_their_own_structured_gcs_document() {
        let data = state_with_linked_patient("5Patient", "PAT-1");
        data.repositories
            .gcs_assessments
            .create(GcsAssessmentEntity {
                id: "GCS-1".to_string(),
                patient_id: "PAT-1".to_string(),
                eye_response: 4,
                verbal_response: 5,
                motor_response: 6,
                total_score: 0,
                interpretation: "Normal neurological function".to_string(),
                notes: None,
                pupil_assessment: None,
                assessed_by: "5Clinician".to_string(),
                assessed_at: Utc::now(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                facility_id: None,
            })
            .await
            .expect("GCS record should be storable");
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::download_medical_record_by_hash),
        )
        .await;
        let request = test::TestRequest::get()
            .uri("/api/records/gcs-GCS-1/download")
            .insert_header(("X-User-Id", "5Patient"))
            .to_request();
        let response = test::call_service(&app, request).await;

        assert_eq!(response.status(), actix_web::http::StatusCode::OK);
        let body = to_bytes(response.into_body()).await.unwrap();
        let text = std::str::from_utf8(&body).unwrap();
        assert!(text.contains("Normal neurological function"));
        assert!(text.contains("\"total_score\": 15"));
    }

    #[actix_rt::test]
    async fn a_patient_cannot_download_another_patients_structured_document() {
        let data = state_with_linked_patient("5OtherPatient", "PAT-2");
        data.repositories
            .gcs_assessments
            .create(GcsAssessmentEntity {
                id: "GCS-2".to_string(),
                patient_id: "PAT-1".to_string(),
                eye_response: 4,
                verbal_response: 5,
                motor_response: 6,
                total_score: 0,
                interpretation: "Normal neurological function".to_string(),
                notes: None,
                pupil_assessment: None,
                assessed_by: "5Clinician".to_string(),
                assessed_at: Utc::now(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                facility_id: None,
            })
            .await
            .expect("GCS record should be storable");
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::download_medical_record_by_hash),
        )
        .await;
        let request = test::TestRequest::get()
            .uri("/api/records/gcs-GCS-2/download")
            .insert_header(("X-User-Id", "5OtherPatient"))
            .to_request();

        assert_eq!(
            test::call_service(&app, request).await.status(),
            actix_web::http::StatusCode::FORBIDDEN
        );
    }

    /// Both used to read typed repositories nothing writes, so every recorded
    /// transfusion and screen answered "not found" to the patient it is about.
    #[actix_rt::test]
    async fn a_patient_can_open_their_own_transfusion_and_blood_screen() {
        let data = state_with_linked_patient("5Patient", "PAT-1");
        let now = Utc::now();
        for (store, id, payload) in [
            (
                data.repositories.transfusion_event_records.clone(),
                "TX-1",
                serde_json::json!({ "transfusion_id": "TX-1", "product_type": "packed_red_cells" }),
            ),
            (
                data.repositories.blood_type_screen_records.clone(),
                "BTS-1",
                serde_json::json!({ "screen_id": "BTS-1", "abo_group": "O" }),
            ),
        ] {
            store
                .create(crate::repositories::traits::JsonRecordEntity {
                    id: id.to_string(),
                    owner_id: "PAT-1".to_string(),
                    data: payload,
                    created_at: now,
                    updated_at: now,
                })
                .await
                .expect("record should be storable");
        }
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::download_medical_record_by_hash),
        )
        .await;

        for (hash, expected) in [
            ("transfusion-TX-1", "packed_red_cells"),
            ("blood-screen-BTS-1", "\"abo_group\": \"O\""),
        ] {
            let request = test::TestRequest::get()
                .uri(&format!("/api/records/{hash}/download"))
                .insert_header(("X-User-Id", "5Patient"))
                .to_request();
            let response = test::call_service(&app, request).await;
            assert_eq!(response.status(), actix_web::http::StatusCode::OK, "{hash}");
            let body = to_bytes(response.into_body()).await.unwrap();
            assert!(
                std::str::from_utf8(&body).unwrap().contains(expected),
                "{hash}"
            );
        }
    }
}

/// List medical records for a patient (paginated)
/// Requires: active patient consent OR patient accessing own records
/// Query params: ?page=1&limit=20
#[get("/api/records/{patient_id}")]
pub async fn list_patient_records(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<PaginationQuery>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // RBAC: Check caller permissions
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if let Some(response) =
        patient_read_denial(&data, &current_user, &current_user_id, &patient_id).await
    {
        return response;
    }

    // Get patient records via repository (paginated)
    // `Pagination::new(page, per_page)` takes a 0-indexed PAGE, not an offset.
    // These arguments were swapped: `limit` was passed as the page and the
    // computed offset as `per_page`, so on the default first page `per_page`
    // was `(1 - 1) * 20 == 0`. `limit()` then returned 0 and this endpoint
    // handed back an empty `records` array alongside a non-zero `total` — every
    // patient's document list, in both portals, was permanently empty.
    let pg = crate::repositories::traits::Pagination::new(
        query.page.saturating_sub(1) as u32,
        query.limit as u32,
    );
    let result = match data
        .repositories
        .medical_records
        .get_by_patient(&patient_id, pg)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::error!("List medical records failed: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Failed to list records".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };
    let total_items = result.total as usize;
    let total_pages = result.total_pages as usize;
    let paginated_records: Vec<crate::ipfs::MedicalRecordReference> =
        result.items.into_iter().map(Into::into).collect();

    let audit = AccessLogEntry {
        access_id: secure_tokens::generate_access_id(),
        patient_id: patient_id.clone(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        access_type: "list_records".to_string(),
        location: None,
        timestamp: Utc::now(),
        emergency: false,
    };
    if let Err(response) = crate::support::require_durable_audit(&data, audit.into()).await {
        return response;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "records": paginated_records,
        "total": total_items,
        "pagination": {
            "page": query.page,
            "limit": query.limit,
            "total_items": total_items,
            "total_pages": total_pages,
            "has_next": query.page < total_pages,
            "has_prev": query.page > 1,
        }
    }))
}
