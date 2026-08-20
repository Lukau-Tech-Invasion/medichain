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

    // Only doctors, nurses, and admins can upload medical records
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
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
            success: false,
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
                success: false,
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    };
    let patient_account = patient.wallet_address;
    if crate::blockchain::blockchain_enabled() && patient_account.is_none() {
        return HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: "Patient has no wallet bound for blockchain recording".to_string(),
            code: "PATIENT_WALLET_REQUIRED".to_string(),
        });
    }

    // Decode base64 content
    let content = match base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.content_base64,
    ) {
        Ok(c) => c,
        Err(e) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
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
                success: false,
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
            success: false,
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
            success: false,
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
                success: false,
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
                success: false,
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

    // Patients can only download their own records
    // Healthcare providers can download any records
    if !current_user.role.is_healthcare_provider() {
        // Check via repository that this record belongs to the patient
        let owns_record = match data
            .repositories
            .medical_records
            .get_by_ipfs_hash(&req.content_hash)
            .await
        {
            // `patient_id` is a record id (`PAT-…`) and `current_user_id` is an
            // SS58 wallet: comparing them directly can never be true for a real
            // patient account, so this denied every patient their own record.
            // Same namespace bug `caller_owns_patient_record` was written for;
            // these two download sites were missed in that sweep.
            Ok(entity) => crate::support::caller_owns_patient_record(
                &data,
                &current_user_id,
                &entity.patient_id,
            ),
            Err(crate::repositories::traits::RepositoryError::NotFound(_)) => false,
            Err(e) => {
                log::error!("Medical record lookup failed: {}", e);
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Ownership check failed".to_string(),
                    code: "REPO_ERROR".to_string(),
                });
            }
        };

        if !owns_record {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Patients can only download their own medical records".to_string(),
                code: "ACCESS_DENIED".to_string(),
            });
        }
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
                success: false,
                error: format!("Record not found: {}", hash),
                code: "RECORD_NOT_FOUND".to_string(),
            });
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: format!("IPFS download failed: {}", e),
                code: "IPFS_ERROR".to_string(),
            });
        }
    };

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            AccessLogEntry {
                access_id: secure_tokens::generate_access_id(),
                patient_id: download_result.metadata.patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: "download_record".to_string(),
                location: None,
                timestamp: Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

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
fn may_read_patient(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    patient_id: &str,
) -> bool {
    caller.role.is_healthcare_provider()
        || crate::support::caller_owns_patient_record(data, caller_id, patient_id)
}

fn access_denied() -> HttpResponse {
    HttpResponse::Forbidden().json(ErrorResponse {
        success: false,
        error: "Patients can only download their own medical records".to_string(),
        code: "ACCESS_DENIED".to_string(),
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
            log::error!("history and physical {hp_id} lookup failed: {e}");
            return not_found("History and physical");
        }
    };
    if !may_read_patient(data, caller, caller_id, &hp.patient_id) {
        return access_denied();
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
            log::error!("progress note {note_id} lookup failed: {e}");
            return not_found("Progress note");
        }
    };
    if !may_read_patient(data, caller, caller_id, &note.patient_id) {
        return access_denied();
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
            log::error!("wound assessment {wound_id} lookup failed: {e}");
            return not_found("Wound assessment");
        }
    };
    if !may_read_patient(data, caller, caller_id, &wound.patient_id) {
        return access_denied();
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
            log::error!("vital signs {vitals_id} lookup failed: {e}");
            return not_found("Vital signs");
        }
    };
    if !may_read_patient(data, caller, caller_id, &v.patient_id) {
        return access_denied();
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
    body.push_str(&format!("  Blood glucose:  {}\n", num(v.blood_glucose)));
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

fn not_found(kind: &str) -> HttpResponse {
    HttpResponse::NotFound().json(ErrorResponse {
        success: false,
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
            log::error!("soap note {note_id} lookup failed: {e}");
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
    if !may_read_patient(data, caller, caller_id, &patient_id) {
        return access_denied();
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
            log::error!("prescription {prescription_id} lookup failed: {e}");
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
    if !may_read_patient(data, caller, caller_id, &patient_id) {
        return access_denied();
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
            log::error!("triage {assessment_id} lookup failed: {e}");
            return not_found("Triage assessment");
        }
    };
    if !may_read_patient(data, caller, caller_id, &a.patient_id) {
        return access_denied();
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
    body.push_str(&format!("  Blood glucose:    {}\n", num(a.blood_glucose)));
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
                success: false,
                error: "Lab result not found".to_string(),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("lab result {submission_id} lookup failed: {e}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Lookup failed".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };

    let submission: LabResultSubmission = match serde_json::from_value(record.data) {
        Ok(submission) => submission,
        Err(e) => {
            log::error!("lab result {submission_id} did not parse: {e}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
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
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };
    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    let content_hash = path.into_inner();

    // Resolve the record to get its metadata hash and owner.
    // Kinds that live in their own store and were never uploaded to IPFS have
    // no `medical_records` row, so they must be dispatched before the lookup
    // below — which would otherwise 404 them before they were ever resolved.
    // Each helper authorizes against the owning patient itself.
    if let Some(note_id) = content_hash.strip_prefix("soap-") {
        return download_soap_note(&data, &current_user, &current_user_id, note_id).await;
    }
    if let Some(prescription_id) = content_hash.strip_prefix("rx-") {
        return download_prescription(&data, &current_user, &current_user_id, prescription_id)
            .await;
    }
    if let Some(hp_id) = content_hash.strip_prefix("hp-") {
        return download_history_physical(&data, &current_user, &current_user_id, hp_id).await;
    }
    if let Some(note_id) = content_hash.strip_prefix("progress-") {
        return download_progress_note(&data, &current_user, &current_user_id, note_id).await;
    }
    if let Some(wound_id) = content_hash.strip_prefix("wound-") {
        return download_wound(&data, &current_user, &current_user_id, wound_id).await;
    }
    if let Some(vitals_id) = content_hash.strip_prefix("vitals-") {
        return download_vitals(&data, &current_user, &current_user_id, vitals_id).await;
    }
    if let Some(assessment_id) = content_hash.strip_prefix("triage-") {
        return download_triage(&data, &current_user, &current_user_id, assessment_id).await;
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
                success: false,
                error: "Record not found".to_string(),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Medical record lookup failed: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Lookup failed".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };
    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &entity.patient_id)
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Patients can only download their own medical records".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
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
                success: false,
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
                success: false,
                error: format!("Record content not found: {}", hash),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: format!("IPFS download failed: {}", e),
                code: "IPFS_ERROR".to_string(),
            })
        }
    };

    let _ = data
        .repositories
        .access_logs
        .create(
            AccessLogEntry {
                access_id: secure_tokens::generate_access_id(),
                patient_id: result.metadata.patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: "download_record".to_string(),
                location: None,
                timestamp: Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

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

/// List medical records for a patient (paginated)
/// Requires: Healthcare provider role OR patient accessing own records
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

    // Patients can only list their own records
    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Patients can only view their own medical records".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
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
                success: false,
                error: "Failed to list records".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };
    let total_items = result.total as usize;
    let total_pages = result.total_pages as usize;
    let paginated_records: Vec<crate::ipfs::MedicalRecordReference> =
        result.items.into_iter().map(Into::into).collect();

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            AccessLogEntry {
                access_id: secure_tokens::generate_access_id(),
                patient_id: patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: "list_records".to_string(),
                location: None,
                timestamp: Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

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
