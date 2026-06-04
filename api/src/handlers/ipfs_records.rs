use super::*;

// ============================================================================
// IPFS Medical Record Endpoints
// ============================================================================

/// Check IPFS connection status
#[get("/api/ipfs/health")]
pub async fn ipfs_health_check(data: web::Data<AppState>) -> impl Responder {
    let connected = data.ipfs_client.health_check().await.unwrap_or(false);

    HttpResponse::Ok().json(IpfsHealthResponse {
        ipfs_connected: connected,
        api_url: "http://localhost:5001".to_string(),
        gateway_url: "http://localhost:8080".to_string(),
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

    // Verify patient exists
    {
        if data
            .repositories
            .patients
            .get_by_id(&req.patient_id)
            .await
            .is_err()
        {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
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
    };

    // Calculate content checksum (convert to hex string)
    let content_checksum = hex::encode(medichain_crypto::sha256(&content));

    // Upload to IPFS with encryption
    let upload_result = match data
        .ipfs_client
        .upload_encrypted(&content, metadata, &data.encryption_key)
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

    // Store reference via repository (in production: also on blockchain)
    {
        let entity: crate::repositories::traits::MedicalRecordEntity =
            (req.patient_id.clone(), record_ref.clone()).into();
        let mut entity = entity;
        entity.created_by = current_user_id.clone();
        entity.last_modified_by = current_user_id.clone();
        if let Err(e) = data.repositories.medical_records.create(entity).await {
            log::error!("Medical record persistence failed: {}", e);
        }
    }

    // Fire-and-forget blockchain IPFS hash recording (non-fatal)
    {
        let patient_id_clone = req.patient_id.clone();
        let ipfs_hash_clone = upload_result.ipfs_hash.clone();
        let record_type_clone = req.record_type.clone();
        let uploader_clone = current_user_id.clone();
        if let Some(ref client) = data.substrate_client {
            let client = client.clone();
            tokio::spawn(async move {
                match client
                    .record_ipfs_hash_on_chain(
                        &patient_id_clone,
                        &ipfs_hash_clone,
                        &record_type_clone,
                        &uploader_clone,
                    )
                    .await
                {
                    Ok(tx_hash) => log::info!("IPFS hash recorded on chain: {}", tx_hash),
                    Err(e) => log::warn!("Blockchain IPFS recording failed (non-fatal): {}", e),
                }
            });
        }
    }

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            AccessLogEntry {
                access_id: secure_tokens::generate_access_id(),
                patient_id: req.patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: "upload_record".to_string(),
                location: None,
                timestamp: Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    HttpResponse::Created().json(UploadMedicalRecordResponse {
        success: true,
        ipfs_hash: upload_result.ipfs_hash,
        metadata_hash: upload_result.metadata_hash,
        record_reference: record_ref,
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
            Ok(entity) => entity.patient_id == current_user_id,
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
        .download_decrypted(&req.content_hash, &req.metadata_hash, &data.encryption_key)
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
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Patients can only view their own medical records".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient records via repository (paginated)
    let pg = crate::repositories::traits::Pagination::new(
        query.limit as u32,
        ((query.page.saturating_sub(1)) * query.limit) as u32,
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
