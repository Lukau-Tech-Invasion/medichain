use super::*;

/// Verify a national ID number against the appropriate government API.
///
/// Falls back to a deterministic SHA3-256 stub when no real API key is
/// configured for the requested country.
///
/// POST /api/national-id/verify
/// Body: { "id_number": "FAN123456", "country": "Ethiopia" }
#[post("/api/national-id/verify")]
pub async fn verify_national_id(
    data: web::Data<AppState>,
    req: web::Json<crate::national_id::VerifyIdRequest>,
) -> impl Responder {
    let country = crate::national_id::Country::from_str(&req.country);

    if country == crate::national_id::Country::Unknown {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!("Unsupported country: {}", req.country),
            code: "UNSUPPORTED_COUNTRY".to_string(),
        });
    }

    match data
        .national_id_service
        .verify(&req.id_number, &country)
        .await
    {
        Ok(result) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "result": result
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "VERIFICATION_ERROR".to_string(),
        }),
    }
}

/// Simulate NFC tap - generates NFC tag data and QR code
#[post("/api/simulate-nfc-tap")]
pub async fn simulate_nfc_tap(
    data: web::Data<AppState>,
    req: web::Json<SimulateNfcTapRequest>,
) -> impl Responder {
    // Check if patient exists via repository (was: in-memory data.patients HashMap)
    if data
        .repositories
        .patients
        .get_by_id(&req.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(SimulateNfcTapResponse {
            success: false,
            nfc_tag_id: String::new(),
            tag_data: NfcTagData {
                tag_id: String::new(),
                patient_id: String::new(),
                hash: String::new(),
                created_at: Utc::now(),
            },
            qr_code_base64: None,
            message: "Patient not found.".to_string(),
        });
    }

    // Find existing NFC tag for patient via repository
    let existing_tag = match data
        .repositories
        .nfc_tags
        .get_active_by_patient(&req.patient_id)
        .await
    {
        Ok(opt) => opt.map(NfcTagData::from),
        Err(e) => {
            log::error!("NFC lookup failed: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "NFC lookup failed".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };

    let tag_data = match existing_tag {
        Some(tag) => tag,
        None => {
            // Create new tag
            let nfc_tag_id = format!(
                "NFC-{}",
                Uuid::new_v4()
                    .to_string()
                    .split('-')
                    .next()
                    .unwrap_or("000")
            );
            let hash = generate_nfc_hash(&req.patient_id, &nfc_tag_id);
            let tag = NfcTagData {
                tag_id: nfc_tag_id,
                patient_id: req.patient_id.clone(),
                hash,
                created_at: Utc::now(),
            };
            if let Err(e) = data.repositories.nfc_tags.create(tag.clone().into()).await {
                log::error!("NFC tag create failed: {}", e);
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Failed to register NFC tag".to_string(),
                    code: "REPO_ERROR".to_string(),
                });
            }
            tag
        }
    };

    // Generate QR code containing the NFC tag ID
    let qr_data = serde_json::json!({
        "type": "medichain_nfc",
        "tag_id": tag_data.tag_id,
        "hash": &tag_data.hash[..16], // First 16 chars of hash for verification
    });
    let qr_code = generate_qr_code_base64(&qr_data.to_string());

    log::info!("NFC tap simulated for patient: {}", req.patient_id);

    HttpResponse::Ok().json(SimulateNfcTapResponse {
        success: true,
        nfc_tag_id: tag_data.tag_id.clone(),
        tag_data,
        qr_code_base64: qr_code,
        message: "NFC tap simulated. Use the tag_id for emergency access.".to_string(),
    })
}
