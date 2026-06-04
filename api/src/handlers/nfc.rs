use super::*;

// ============================================================================
// NFC Card Management Endpoints
// ============================================================================

/// Request body for generating a new NFC card
#[derive(Debug, Deserialize)]
pub struct GenerateNFCCardRequest {
    pub patient_id: String,
    pub national_id_type: String,
}

/// Response for NFC card generation
#[derive(Debug, Serialize)]
pub struct GenerateNFCCardResponse {
    pub success: bool,
    pub card_id: String,
    pub card_hash: String,
    pub qr_code_base64: Option<String>,
    pub message: String,
}

/// Response for NFC tap simulation
#[derive(Debug, Serialize)]
pub struct NFCTapResponse {
    pub success: bool,
    pub patient_id: Option<String>,
    pub card_hash: String,
    pub timestamp: u64,
    pub error: Option<String>,
}

/// Response for card info
#[derive(Debug, Clone, Serialize)]
pub struct CardInfoResponse {
    pub card_id: String,
    pub patient_id: String,
    pub card_hash: String,
    pub national_id_type: String,
    pub status: String,
    pub created_at: u64,
    pub last_used_at: Option<u64>,
}

/// Generate a new NFC card for a patient
#[post("/api/nfc/generate")]
pub async fn generate_nfc_card(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<GenerateNFCCardRequest>,
) -> impl Responder {
    // RBAC: Only healthcare providers can generate cards
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

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can generate NFC cards".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Parse national ID type
    let national_id_type = match body.national_id_type.to_lowercase().as_str() {
        "fayda" | "faydaid" | "ethiopia" => NationalIdType::FaydaId,
        "ghana" | "ghanacard" => NationalIdType::GhanaCard,
        "nin" | "nigeria" => NationalIdType::NigeriaNIN,
        "smartid" | "southafrica" => NationalIdType::SouthAfricaSmartId,
        "huduma" | "kenya" => NationalIdType::KenyaHuduma,
        _ => NationalIdType::Other,
    };

    // Create NFC card
    let card = NFCCard::new(body.patient_id.clone(), national_id_type);
    let card_id = card.card_id.clone();
    let card_hash = card.card_hash.clone();

    // Generate QR code
    let qr_data = card.generate_qr_data();
    let qr_base64 = crate::nfc_simulator::generate_qr_image(&qr_data).ok();

    // Register the card
    if let Err(e) = data.card_registry.register_card(card) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e,
            code: "CARD_REGISTRATION_FAILED".to_string(),
        });
    }

    log::info!(
        "NFC card generated for patient {} by {}",
        body.patient_id,
        current_user_id
    );

    HttpResponse::Created().json(GenerateNFCCardResponse {
        success: true,
        card_id,
        card_hash,
        qr_code_base64: qr_base64,
        message: "NFC card generated successfully".to_string(),
    })
}

/// Simulate an NFC card tap (for demo purposes)
#[post("/api/nfc/tap")]
pub async fn nfc_tap(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    // RBAC: Only healthcare providers can use NFC tap
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

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can use NFC tap".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get card_hash from body
    let card_hash = match body.get("card_hash").and_then(|v| v.as_str()) {
        Some(h) => h.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Missing card_hash in request body".to_string(),
                code: "MISSING_FIELD".to_string(),
            });
        }
    };

    // Simulate the tap
    let tap_result = match data.card_registry.tap_card(&card_hash) {
        Ok(result) => result,
        Err(e) => {
            return HttpResponse::NotFound().json(NFCTapResponse {
                success: false,
                patient_id: None,
                card_hash,
                timestamp: chrono::Utc::now().timestamp() as u64,
                error: Some(e),
            });
        }
    };

    if tap_result.success {
        // Log the access via repository
        let _ = data.repositories.access_logs.create(AccessLogEntry {
            access_id: secure_tokens::generate_access_id(),
            patient_id: tap_result.patient_id.clone(),
            accessor_id: current_user_id.clone(),
            accessor_role: current_user.role.to_string(),
            access_type: "nfc_tap".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: true,
        }.into()).await;

        log::info!(
            "NFC tap successful for patient {} by {}",
            tap_result.patient_id,
            current_user_id
        );
    }

    HttpResponse::Ok().json(NFCTapResponse {
        success: tap_result.success,
        patient_id: if tap_result.success {
            Some(tap_result.patient_id)
        } else {
            None
        },
        card_hash: tap_result.card_hash,
        timestamp: tap_result.timestamp,
        error: tap_result.error,
    })
}

/// Verify a QR code for emergency access
#[post("/api/nfc/verify-qr")]
pub async fn verify_qr_code(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    // RBAC: Only healthcare providers can verify QR codes
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

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can verify QR codes".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get QR data from body
    let qr_json = match body.get("qr_data").and_then(|v| v.as_str()) {
        Some(d) => d.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Missing qr_data in request body".to_string(),
                code: "MISSING_FIELD".to_string(),
            });
        }
    };

    // Decode QR data
    let qr_data = match QRCodeData::decode(&qr_json) {
        Ok(d) => d,
        Err(e) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: e,
                code: "INVALID_QR_DATA".to_string(),
            });
        }
    };

    // Check expiration
    if qr_data.is_expired() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "QR code has expired".to_string(),
            code: "QR_EXPIRED".to_string(),
        });
    }

    // Verify card exists and matches
    let card = match data.card_registry.get_card(&qr_data.card_hash) {
        Some(c) => c,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Card not found".to_string(),
                code: "CARD_NOT_FOUND".to_string(),
            });
        }
    };

    // Verify patient ID matches
    if card.patient_id != qr_data.patient_id {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "QR data mismatch".to_string(),
            code: "QR_MISMATCH".to_string(),
        });
    }

    // Log the access via repository
    let _ = data.repositories.access_logs.create(AccessLogEntry {
        access_id: secure_tokens::generate_access_id(),
        patient_id: qr_data.patient_id.clone(),
        accessor_id: current_user_id.clone(),
        accessor_role: current_user.role.to_string(),
        access_type: "qr_verification".to_string(),
        location: None,
        timestamp: Utc::now(),
        emergency: true,
    }.into()).await;

    log::info!(
        "QR code verified for patient {} by {}",
        qr_data.patient_id,
        current_user_id
    );

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": qr_data.patient_id,
        "card_hash": qr_data.card_hash,
        "verified": true,
        "message": "QR code verified successfully"
    }))
}

/// Get card information by patient ID
#[get("/api/nfc/card/{patient_id}")]
pub async fn get_card_info(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // RBAC: Healthcare providers or the patient themselves
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

    // Patients can only view their own card
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get card
    let card = match data.card_registry.get_card_by_patient(&patient_id) {
        Some(c) => c,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "No card found for this patient".to_string(),
                code: "CARD_NOT_FOUND".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(CardInfoResponse {
        card_id: card.card_id,
        patient_id: card.patient_id,
        card_hash: card.card_hash,
        national_id_type: card.national_id_type.to_string(),
        status: card.status.to_string(),
        created_at: card.created_at,
        last_used_at: card.last_used_at,
    })
}

/// Suspend a card (e.g., if reported stolen)
#[post("/api/nfc/suspend")]
pub async fn suspend_card(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    // RBAC: Only Admin can suspend cards
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

    if current_user.role != Role::Admin {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can suspend cards".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get card_hash from body
    let card_hash = match body.get("card_hash").and_then(|v| v.as_str()) {
        Some(h) => h.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Missing card_hash in request body".to_string(),
                code: "MISSING_FIELD".to_string(),
            });
        }
    };

    // Suspend the card
    if let Err(e) = data.card_registry.suspend_card(&card_hash) {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: e,
            code: "CARD_NOT_FOUND".to_string(),
        });
    }

    log::info!("Card {} suspended by Admin {}", card_hash, current_user_id);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "card_hash": card_hash,
        "message": "Card suspended successfully"
    }))
}

/// List all NFC cards (Admin only) - paginated
/// Query params: ?page=1&limit=20
#[get("/api/nfc/cards")]
pub async fn list_nfc_cards(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<PaginationQuery>,
) -> impl Responder {
    // RBAC: Only Admin can list all cards
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

    if current_user.role != Role::Admin {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can list all cards".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let cards = data.card_registry.list_cards();
    let card_infos: Vec<CardInfoResponse> = cards
        .into_iter()
        .map(|c| CardInfoResponse {
            card_id: c.card_id,
            patient_id: c.patient_id,
            card_hash: c.card_hash,
            national_id_type: c.national_id_type.to_string(),
            status: c.status.to_string(),
            created_at: c.created_at,
            last_used_at: c.last_used_at,
        })
        .collect();

    let (paginated_cards, pagination) = paginate(&card_infos, query.page, query.limit);

    HttpResponse::Ok().json(serde_json::json!({
        "cards": paginated_cards,
        "total": pagination.total_items,
        "pagination": pagination
    }))
}

