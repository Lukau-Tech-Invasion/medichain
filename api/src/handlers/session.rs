use super::*;

// ============================================================================
// Session Token Endpoints
// ============================================================================

/// Generate a short-lived session token for a wallet address.
///
/// POST /api/auth/session
///
/// Body: { "wallet_address": "5Grw...", "signature": "...", "challenge": "..." }
///
/// The token is stateless: it is an HMAC-SHA3-256 digest of
/// `<secret>:<wallet_address>:<timestamp_secs>` encoded as lowercase hex,
/// combined into the format `<hex_hmac>.<timestamp_secs>.<wallet_address>`.
/// The verifier can re-derive the digest and check expiry without a database.
///
/// Token lifetime: 3600 seconds (1 hour).
/// Set SESSION_SECRET env var in production; a default is used for development.
#[post("/api/auth/session")]
pub async fn create_session_token(body: web::Json<SessionCreateRequest>) -> impl Responder {
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid wallet address format".to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    let secret = std::env::var("SESSION_SECRET")
        .unwrap_or_else(|_| "medichain-dev-secret-change-in-production".to_string());

    let now_secs = Utc::now().timestamp();
    let expires_at = now_secs + 3600;

    // Derive token: SHA3-256(secret:wallet_address:timestamp)
    let payload = format!("{}:{}:{}", secret, body.wallet_address, now_secs);
    let digest = Sha3_256::digest(payload.as_bytes());
    let hex_digest: String = digest.iter().map(|b| format!("{:02x}", b)).collect();

    // Embed timestamp and wallet in the token so /api/auth/verify is stateless
    let token = format!("{}.{}.{}", hex_digest, now_secs, body.wallet_address);

    log::info!(
        "Session token issued for wallet={} expires_at={}",
        body.wallet_address,
        expires_at
    );

    HttpResponse::Ok().json(SessionCreateResponse {
        success: true,
        token,
        expires_at,
        wallet_address: body.wallet_address.clone(),
    })
}

#[post("/api/notifications/register-device")]
pub async fn register_device(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<DeviceRegistrationRequest>,
) -> impl Responder {
    let user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let entity = crate::repositories::traits::DeviceTokenEntity {
        id: Uuid::new_v4().to_string(),
        user_id: user_id.to_string(),
        token: req.token.clone(),
        device_type: req.device_type.clone(),
        device_name: req.device_name.clone(),
        last_seen_at: Utc::now(),
        created_at: Utc::now(),
    };

    match data.repositories.device_tokens.register(entity).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "status": "registered"
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "REPOSITORY_ERROR".to_string(),
        }),
    }
}

/// Verify a session token supplied as a Bearer token.
///
/// GET /api/auth/verify
/// Authorization: Bearer <hex_hmac>.<timestamp_secs>.<wallet_address>
///
/// Returns 200 with wallet_address and expires_at if the token is valid and
/// has not expired. Returns 401 otherwise.
#[get("/api/auth/verify")]
pub async fn verify_session_token(req: HttpRequest) -> impl Responder {
    let auth_header = match req.headers().get("Authorization") {
        Some(h) => match h.to_str() {
            Ok(s) => s.to_owned(),
            Err(_) => {
                return HttpResponse::Unauthorized().json(ErrorResponse {
                    success: false,
                    error: "Invalid Authorization header encoding".to_string(),
                    code: "INVALID_AUTH_HEADER".to_string(),
                });
            }
        },
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing Authorization header".to_string(),
                code: "MISSING_AUTH_HEADER".to_string(),
            });
        }
    };

    let token = if auth_header.starts_with("Bearer ") {
        auth_header["Bearer ".len()..].trim().to_owned()
    } else {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Authorization header must use Bearer scheme".to_string(),
            code: "INVALID_AUTH_SCHEME".to_string(),
        });
    };

    // splitn(3) preserves the wallet address even if it contains dots
    let parts: Vec<&str> = token.splitn(3, '.').collect();

    if parts.len() != 3 {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Malformed token: expected <hmac>.<timestamp>.<wallet>".to_string(),
            code: "MALFORMED_TOKEN".to_string(),
        });
    }

    let hex_hmac = parts[0];
    let ts_str = parts[1];
    let wallet_address = parts[2].to_owned();

    let issued_at: i64 = match ts_str.parse() {
        Ok(v) => v,
        Err(_) => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Malformed token timestamp".to_string(),
                code: "MALFORMED_TOKEN".to_string(),
            });
        }
    };

    let expires_at = issued_at + 3600;
    let now_secs = Utc::now().timestamp();

    if now_secs > expires_at {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Token has expired".to_string(),
            code: "TOKEN_EXPIRED".to_string(),
        });
    }

    if !is_valid_wallet_address(&wallet_address) {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Token contains invalid wallet address".to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    let secret = std::env::var("SESSION_SECRET")
        .unwrap_or_else(|_| "medichain-dev-secret-change-in-production".to_string());

    let payload = format!("{}:{}:{}", secret, wallet_address, issued_at);
    let digest = Sha3_256::digest(payload.as_bytes());
    let expected_hex: String = digest.iter().map(|b| format!("{:02x}", b)).collect();

    if hex_hmac != expected_hex {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Token signature is invalid".to_string(),
            code: "INVALID_TOKEN_SIGNATURE".to_string(),
        });
    }

    HttpResponse::Ok().json(SessionVerifyResponse {
        success: true,
        wallet_address,
        expires_at,
    })
}

