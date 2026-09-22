use super::*;

// ============================================================================
// NFC Card Management Endpoints
// ============================================================================

/// The national ID types a caller may name when issuing a card.
///
/// Published in the refusal so a client that sends the wrong word is told which
/// words are right. The short forms are what the existing callers send; the
/// `display_name()` spellings are what a reader gets back from
/// `GET /api/nfc/card/{patient_id}`, and a client that echoes what it read must
/// not be refused for it.
pub(crate) const NATIONAL_ID_TYPE_VOCABULARY: [&str; 6] =
    ["fayda", "ghana", "nin", "smartid", "huduma", "other"];

/// Resolve a national ID type, or `None` if it is not one.
pub(crate) fn parse_national_id_type(raw: &str) -> Option<NationalIdType> {
    match raw.trim().to_lowercase().as_str() {
        "fayda" | "faydaid" | "ethiopia" | "fayda id (ethiopia)" => Some(NationalIdType::FaydaId),
        "ghana" | "ghanacard" | "ghana card" => Some(NationalIdType::GhanaCard),
        "nin" | "nigeria" | "nin (nigeria)" => Some(NationalIdType::NigeriaNIN),
        "smartid" | "southafrica" | "smart id (south africa)" => {
            Some(NationalIdType::SouthAfricaSmartId)
        }
        "huduma" | "kenya" | "huduma namba (kenya)" => Some(NationalIdType::KenyaHuduma),
        "other" | "other id" => Some(NationalIdType::Other),
        _ => None,
    }
}

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

    if !current_user.role.may_issue_identity_credentials() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only a doctor, nurse or administrator can issue a health ID card".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // A card must name a patient who exists.
    //
    // Nothing checked, so a typo minted a real, tappable credential bound to an
    // id no chart will ever match: the tap resolves, the capsule lookup finds
    // nothing, and the card is indistinguishable from a revoked one at exactly
    // the moment it matters.
    if let Err(response) =
        crate::clinical_endpoints::require_known_patient(&data, &body.patient_id).await
    {
        return response;
    }

    // Refused, not defaulted.
    //
    // `_ => Other` turned every unrecognised value into a generic card,
    // including a misspelt "ghanacrd" -- so a Ghana Card was issued as "Other
    // ID", and the national ID system it should have been verified against was
    // never consulted. `Other` is a real choice a clinician can make; it is not
    // a place to put a typo.
    let national_id_type = match parse_national_id_type(&body.national_id_type) {
        Some(kind) => kind,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: format!(
                    "Unknown national ID type '{}'. Expected one of: {}",
                    body.national_id_type,
                    NATIONAL_ID_TYPE_VOCABULARY.join(", ")
                ),
                code: "UNKNOWN_NATIONAL_ID_TYPE".to_string(),
            });
        }
    };

    // Create NFC card
    let card = NFCCard::new(body.patient_id.clone(), national_id_type);
    let card_id = card.card_id.clone();
    let card_hash = card.card_hash.clone();

    // Generate QR code
    let qr_data = card.generate_qr_data();
    let qr_base64 = crate::nfc_simulator::generate_qr_image(&qr_data).ok();

    // Register the card in the in-process index first: it is what enforces
    // one-card-per-patient and a full registry, and both of those are refusals
    // rather than storage failures.
    if let Err(e) = data.card_registry.register_card(card.clone()) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e,
            code: "CARD_REGISTRATION_FAILED".to_string(),
        });
    }

    // Then durably, and refuse the whole request if that fails.
    //
    // A card is a physical object handed to a patient. Reporting one issued
    // when nothing was stored produces a card that works until the next restart
    // and then reads as revoked -- so the cache entry is rolled back and the
    // caller is told to try again rather than being handed plastic that will
    // stop working.
    if let Err(e) = data.persist_card(&card).await {
        log::error!("health ID card {card_id} could not be stored: {e}");
        let _ = data.card_registry.forget_card(&card_hash);
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "The card could not be stored, so none was issued.".to_string(),
            code: "CARD_STORAGE_UNAVAILABLE".to_string(),
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
        let audit = AccessLogEntry {
            access_id: secure_tokens::generate_access_id(),
            patient_id: tap_result.patient_id.clone(),
            accessor_id: current_user_id.clone(),
            accessor_role: current_user.role.to_string(),
            access_type: "nfc_tap".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: true,
        };
        if let Err(response) = crate::support::require_durable_audit(&data, audit.into()).await {
            return response;
        }

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

/// Request body for a patient verifying their own physical NFC card.
#[derive(Debug, Deserialize)]
pub struct VerifyMyCardRequest {
    /// The card_hash read off the physical card via NFC (not looked up by
    /// patient_id — this is what makes it a genuine tap-verification rather
    /// than just "show my card's status").
    pub card_hash: String,
}

/// Response for a patient's own card-verification tap.
#[derive(Debug, Serialize)]
pub struct VerifyMyCardResponse {
    pub success: bool,
    pub status: Option<String>,
    pub last_used_at: Option<u64>,
    pub message: String,
}

/// A patient taps their own physical NFC card to confirm it's genuinely
/// theirs and still active — e.g. right after a clinic issues a new card, or
/// periodically to catch a suspended/revoked card before an emergency.
///
/// Deliberately patient-only and self-scoped: `nfc_tap` (above) is the
/// provider-only emergency-read path for tapping ANOTHER patient's card;
/// this is the self-service counterpart a patient's own phone can actually
/// use, mirroring the QR-scanning scope split already made for the mobile
/// app (see `mobile-examples/expo-starter`'s `FamilyScreen` doc comment).
#[post("/api/nfc/verify-mine")]
pub async fn verify_my_nfc_card(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<VerifyMyCardRequest>,
) -> impl Responder {
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

    if current_user.role != Role::Patient {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only patients can self-verify a card; providers use /api/nfc/tap".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let card = match data.card_registry.get_card(&body.card_hash) {
        Some(c) => c,
        None => {
            return HttpResponse::Ok().json(VerifyMyCardResponse {
                success: false,
                status: None,
                last_used_at: None,
                message: "This card isn't registered in MediChain.".to_string(),
            });
        }
    };

    // The card_hash is a valid registered card, but does it belong to the
    // patient holding the phone? Reject silently-wrong or cloned cards.
    if card.patient_id != current_user_id {
        return HttpResponse::Ok().json(VerifyMyCardResponse {
            success: false,
            status: None,
            last_used_at: None,
            message: "This card is registered to a different account.".to_string(),
        });
    }

    let audit = AccessLogEntry {
        access_id: secure_tokens::generate_access_id(),
        patient_id: current_user_id.clone(),
        accessor_id: current_user_id.clone(),
        accessor_role: current_user.role.to_string(),
        access_type: "nfc_self_verify".to_string(),
        location: None,
        timestamp: Utc::now(),
        emergency: false,
    };
    if let Err(response) = crate::support::require_durable_audit(&data, audit.into()).await {
        return response;
    }

    HttpResponse::Ok().json(VerifyMyCardResponse {
        success: true,
        status: Some(card.status.to_string()),
        last_used_at: card.last_used_at,
        message: "Card verified — this is your active MediChain card.".to_string(),
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

    let audit = AccessLogEntry {
        access_id: secure_tokens::generate_access_id(),
        patient_id: qr_data.patient_id.clone(),
        accessor_id: current_user_id.clone(),
        accessor_role: current_user.role.to_string(),
        access_type: "qr_verification".to_string(),
        location: None,
        timestamp: Utc::now(),
        emergency: true,
    };
    if let Err(response) = crate::support::require_durable_audit(&data, audit.into()).await {
        return response;
    }

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
    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get card
    let card = match data.card_registry.get_card_by_patient(&patient_id) {
        Some(c) => c,
        // The patient exists but has not yet been issued a card. That is an
        // expected issuance state, not a missing endpoint or a failed lookup.
        // A 404 made the Health ID screen log an error before it could decide
        // whether to offer issuance.
        None => return HttpResponse::Ok().json(serde_json::Value::Null),
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

    // A suspension that lives only in memory is undone by the next restart,
    // which is the worst possible direction for this particular failure: a card
    // reported stolen would quietly start working again.
    match data.card_registry.get_card(&card_hash) {
        Some(card) => {
            if let Err(e) = data.persist_card(&card).await {
                log::error!("suspension of card {card_hash} was not stored: {e}");
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    success: false,
                    error: "The suspension could not be stored and has not taken effect."
                        .to_string(),
                    code: "CARD_STORAGE_UNAVAILABLE".to_string(),
                });
            }
        }
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Card not found".to_string(),
                code: "CARD_NOT_FOUND".to_string(),
            })
        }
    }

    log::info!("NFC card suspended by an administrator");

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
