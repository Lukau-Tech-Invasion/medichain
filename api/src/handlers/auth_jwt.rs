//! JWT issuance/refresh (Phase 9.4), TOTP MFA enrollment & step-up (Phase 11.3),
//! and security-alert / breach-declaration admin endpoints (Phase 11.4).
//!
//! Inherits shared imports from the parent module via `use super::*`.

use super::*;
use crate::security::{jwt, mfa};

// ============================================================================
// Phase 9.4 — JWT issuance & refresh
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct JwtIssueRequest {
    pub wallet_address: String,
    /// Hex-encoded sr25519 signature over `<timestamp>:<wallet_address>`.
    /// Optional only in demo mode (`IS_DEMO=true`).
    pub signature: Option<String>,
    /// Unix timestamp that was signed.
    pub timestamp: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct JwtIssueResponse {
    pub success: bool,
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
    /// Whether MFA is already satisfied. When false and `mfa_required` is true,
    /// the client must call `/api/auth/mfa/challenge` to step up.
    pub mfa: bool,
    pub mfa_required: bool,
}

/// Issue access + refresh JWTs after verifying a wallet signature challenge.
///
/// POST /api/auth/jwt
///
/// The signed message format matches the challenge from `/api/auth/challenge`:
/// `<timestamp>:<wallet_address>`. In demo mode the signature may be omitted.
#[post("/api/auth/jwt")]
pub async fn issue_jwt(data: web::Data<AppState>, body: web::Json<JwtIssueRequest>) -> impl Responder {
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid wallet address format".to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    let is_demo = std::env::var("IS_DEMO").unwrap_or_else(|_| "false".to_string()) == "true";

    // Verify the wallet signature unless we are in demo mode without one.
    match (&body.signature, body.timestamp) {
        (Some(sig), Some(ts)) => {
            let message = format!("{}:{}", ts, body.wallet_address);
            let now = Utc::now().timestamp();
            if let Err(e) = medichain_crypto::signature::verify_wallet_signature(
                sig,
                &message,
                &body.wallet_address,
                now,
            ) {
                data.security
                    .observe_failed_auth(&data.ws_manager, &body.wallet_address)
                    .await;
                return HttpResponse::Unauthorized().json(ErrorResponse {
                    success: false,
                    error: format!("Signature verification failed: {}", e),
                    code: "SIGNATURE_VERIFICATION_FAILED".to_string(),
                });
            }
        }
        _ if is_demo => { /* demo mode: accept without signature */ }
        _ => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "signature and timestamp are required outside demo mode".to_string(),
                code: "SIGNATURE_REQUIRED".to_string(),
            });
        }
    }

    // The wallet must be a registered user.
    let user = match get_user(&data, &body.wallet_address) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Wallet not registered".to_string(),
                code: "WALLET_NOT_REGISTERED".to_string(),
            });
        }
    };

    issue_token_pair(&data, &body.wallet_address, &user.role.to_string())
}

#[derive(Debug, Deserialize)]
pub struct JwtRefreshRequest {
    pub refresh_token: String,
}

/// Exchange a valid refresh token for a fresh access token.
///
/// POST /api/auth/jwt/refresh
#[post("/api/auth/jwt/refresh")]
pub async fn refresh_jwt(data: web::Data<AppState>, body: web::Json<JwtRefreshRequest>) -> impl Responder {
    let claims = match jwt::decode_token(&body.refresh_token) {
        Ok(c) if c.typ == jwt::TYP_REFRESH => c,
        _ => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Invalid or expired refresh token".to_string(),
                code: "INVALID_REFRESH_TOKEN".to_string(),
            });
        }
    };
    issue_token_pair(&data, &claims.sub, &claims.role)
}

/// Issue an access+refresh pair for a wallet. The access token's `mfa` claim is
/// `true` only when the wallet has *not* enrolled MFA; enrolled wallets receive
/// `mfa=false` and must step up via `/api/auth/mfa/challenge`.
fn issue_token_pair(data: &web::Data<AppState>, wallet: &str, role: &str) -> HttpResponse {
    let mfa_enabled = data.security.mfa_enabled(wallet);
    let mfa_satisfied = !mfa_enabled;

    let access = match jwt::issue_access_token(wallet, role, mfa_satisfied) {
        Ok(t) => t,
        Err(e) => return jwt_error(e),
    };
    let refresh = match jwt::issue_refresh_token(wallet, role) {
        Ok(t) => t,
        Err(e) => return jwt_error(e),
    };

    HttpResponse::Ok().json(JwtIssueResponse {
        success: true,
        access_token: access,
        refresh_token: refresh,
        token_type: "Bearer".to_string(),
        expires_in: jwt::ACCESS_TOKEN_TTL_SECS,
        mfa: mfa_satisfied,
        mfa_required: mfa_enabled,
    })
}

fn jwt_error(e: jsonwebtoken::errors::Error) -> HttpResponse {
    HttpResponse::InternalServerError().json(ErrorResponse {
        success: false,
        error: format!("Failed to issue token: {}", e),
        code: "TOKEN_ISSUE_FAILED".to_string(),
    })
}

// ============================================================================
// Phase 11.3 — TOTP MFA
// ============================================================================

#[derive(Debug, Serialize)]
pub struct MfaEnrollResponse {
    pub success: bool,
    pub secret: String,
    pub otpauth_uri: String,
    /// Base64-encoded PNG QR code of the otpauth URI (no data: prefix).
    pub qr_code_base64: Option<String>,
}

/// Begin MFA enrollment: generate a TOTP secret + provisioning QR.
///
/// POST /api/auth/mfa/enroll
/// The enrollment is not active until a code is confirmed via `/mfa/verify`.
#[post("/api/auth/mfa/enroll")]
pub async fn mfa_enroll(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    let wallet = match get_current_user_id(&req) {
        Some(id) => id,
        None => return unauthorized_missing_user(),
    };

    let secret = mfa::generate_secret_base32();
    let uri = match mfa::provisioning_uri(&secret, &wallet) {
        Ok(u) => u,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: e,
                code: "MFA_ENROLL_FAILED".to_string(),
            })
        }
    };
    let qr = generate_qr_code_base64(&uri);

    if let Ok(mut m) = data.security.mfa.write() {
        m.insert(
            wallet.clone(),
            crate::security::mfa::MfaRecord {
                secret_base32: secret.clone(),
                enabled: false,
                created_at: Utc::now(),
            },
        );
    }
    // Write-through to PostgreSQL (encrypted at rest); no-op on memory backend.
    if let Err(e) = data.persist_mfa_enrollment(&wallet, &secret, false).await {
        log::warn!("Failed to persist MFA enrollment for {}: {}", wallet, e);
    }

    HttpResponse::Ok().json(MfaEnrollResponse {
        success: true,
        secret,
        otpauth_uri: uri,
        qr_code_base64: qr,
    })
}

#[derive(Debug, Deserialize)]
pub struct MfaCodeRequest {
    pub code: String,
}

/// Confirm enrollment by verifying the first TOTP code, activating MFA.
///
/// POST /api/auth/mfa/verify
#[post("/api/auth/mfa/verify")]
pub async fn mfa_verify(data: web::Data<AppState>, req: HttpRequest, body: web::Json<MfaCodeRequest>) -> impl Responder {
    let wallet = match get_current_user_id(&req) {
        Some(id) => id,
        None => return unauthorized_missing_user(),
    };

    let secret = match data.security.mfa.read().ok().and_then(|m| m.get(&wallet).map(|r| r.secret_base32.clone())) {
        Some(s) => s,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "No MFA enrollment in progress. Call /api/auth/mfa/enroll first.".to_string(),
                code: "MFA_NOT_ENROLLED".to_string(),
            })
        }
    };

    if !mfa::verify_code(&secret, &wallet, &body.code) {
        data.security.observe_failed_auth(&data.ws_manager, &wallet).await;
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Invalid MFA code".to_string(),
            code: "MFA_CODE_INVALID".to_string(),
        });
    }

    if let Ok(mut m) = data.security.mfa.write() {
        if let Some(rec) = m.get_mut(&wallet) {
            rec.enabled = true;
        }
    }
    if let Err(e) = data.update_mfa_enabled(&wallet, true).await {
        log::warn!("Failed to persist MFA activation for {}: {}", wallet, e);
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "MFA enabled successfully",
    }))
}

/// Step up an authenticated session to MFA-satisfied by verifying a code.
/// Returns a new access token with `mfa=true`.
///
/// POST /api/auth/mfa/challenge
#[post("/api/auth/mfa/challenge")]
pub async fn mfa_challenge(data: web::Data<AppState>, req: HttpRequest, body: web::Json<MfaCodeRequest>) -> impl Responder {
    let wallet = match get_current_user_id(&req) {
        Some(id) => id,
        None => return unauthorized_missing_user(),
    };

    let secret = match data.security.mfa.read().ok().and_then(|m| {
        m.get(&wallet).filter(|r| r.enabled).map(|r| r.secret_base32.clone())
    }) {
        Some(s) => s,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "MFA is not enabled for this account".to_string(),
                code: "MFA_NOT_ENABLED".to_string(),
            })
        }
    };

    if !mfa::verify_code(&secret, &wallet, &body.code) {
        data.security.observe_failed_auth(&data.ws_manager, &wallet).await;
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Invalid MFA code".to_string(),
            code: "MFA_CODE_INVALID".to_string(),
        });
    }

    let role = get_user(&data, &wallet)
        .map(|u| u.role.to_string())
        .unwrap_or_else(|| "Patient".to_string());

    match jwt::issue_access_token(&wallet, &role, true) {
        Ok(access) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": jwt::ACCESS_TOKEN_TTL_SECS,
            "mfa": true,
        })),
        Err(e) => jwt_error(e),
    }
}

/// Report MFA enrollment status for the current user.
///
/// GET /api/auth/mfa/status
#[get("/api/auth/mfa/status")]
pub async fn mfa_status(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    let wallet = match get_current_user_id(&req) {
        Some(id) => id,
        None => return unauthorized_missing_user(),
    };
    let (enrolled, enabled) = data
        .security
        .mfa
        .read()
        .ok()
        .and_then(|m| m.get(&wallet).map(|r| (true, r.enabled)))
        .unwrap_or((false, false));

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "enrolled": enrolled,
        "enabled": enabled,
    }))
}

/// Disable MFA after verifying a current code.
///
/// POST /api/auth/mfa/disable
#[post("/api/auth/mfa/disable")]
pub async fn mfa_disable(data: web::Data<AppState>, req: HttpRequest, body: web::Json<MfaCodeRequest>) -> impl Responder {
    let wallet = match get_current_user_id(&req) {
        Some(id) => id,
        None => return unauthorized_missing_user(),
    };

    let secret = match data.security.mfa.read().ok().and_then(|m| {
        m.get(&wallet).filter(|r| r.enabled).map(|r| r.secret_base32.clone())
    }) {
        Some(s) => s,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "MFA is not enabled for this account".to_string(),
                code: "MFA_NOT_ENABLED".to_string(),
            })
        }
    };

    if !mfa::verify_code(&secret, &wallet, &body.code) {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Invalid MFA code".to_string(),
            code: "MFA_CODE_INVALID".to_string(),
        });
    }

    if let Ok(mut m) = data.security.mfa.write() {
        m.remove(&wallet);
    }
    if let Err(e) = data.delete_mfa_enrollment(&wallet).await {
        log::warn!("Failed to delete MFA enrollment for {}: {}", wallet, e);
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "MFA disabled",
    }))
}

// ============================================================================
// Phase 11.4 — Security alerts & breach declaration (Admin)
// ============================================================================

/// List recent security alerts (admin only).
///
/// GET /api/admin/security/alerts
#[get("/api/admin/security/alerts")]
pub async fn list_security_alerts(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    match require_admin(&data, &req) {
        Ok(()) => {}
        Err(resp) => return resp,
    }
    let alerts = data.security.recent_alerts(200);
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alerts": alerts,
        "count": alerts.len(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct DeclareBreachRequest {
    pub description: String,
    pub actor: Option<String>,
}

/// Declare a data breach (admin only). Records a critical alert and starts the
/// POPIA 72-hour notification clock.
///
/// POST /api/admin/security/breach
#[post("/api/admin/security/breach")]
pub async fn declare_breach(data: web::Data<AppState>, req: HttpRequest, body: web::Json<DeclareBreachRequest>) -> impl Responder {
    match require_admin(&data, &req) {
        Ok(()) => {}
        Err(resp) => return resp,
    }
    // Sensitive action: enforce MFA step-up for JWT-authenticated admins.
    if let Some(resp) = enforce_mfa_step_up(&req) {
        return resp;
    }

    let alert = data
        .security
        .declare_breach(&data.ws_manager, body.actor.clone(), body.description.clone())
        .await;

    // Automated notification dispatch to the security officer (SMS); best-effort.
    let notified = crate::notifications::dispatch_breach_notification(
        &alert.message,
        alert.notify_deadline,
    )
    .await;

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alert": alert,
        "officers_notified": notified,
        "message": "Breach recorded. Notify affected parties within 72 hours (POPIA).",
    }))
}

// ============================================================================
// Local helpers
// ============================================================================

fn unauthorized_missing_user() -> HttpResponse {
    HttpResponse::Unauthorized().json(ErrorResponse {
        success: false,
        error: "Authentication required (Bearer JWT or X-User-Id)".to_string(),
        code: "UNAUTHORIZED".to_string(),
    })
}

/// Verify the caller is an Admin. Returns the rejection response on failure.
fn require_admin(data: &web::Data<AppState>, req: &HttpRequest) -> Result<(), HttpResponse> {
    let wallet = get_current_user_id(req).ok_or_else(unauthorized_missing_user)?;
    let user = get_user(data, &wallet).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        })
    })?;
    if !user.role.is_admin() {
        return Err(HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Admin role required".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        }));
    }
    Ok(())
}

/// Enforce MFA step-up for sensitive operations.
///
/// Returns `Some(403)` only when the request is JWT-authenticated by a wallet
/// that has MFA enabled but has not stepped up this session. Pure `X-User-Id`
/// requests (no JWT claims) are exempt so demo mode and legacy clients still
/// work — production should run with JWT + `REQUIRE_SIGNATURES=true`.
fn enforce_mfa_step_up(req: &HttpRequest) -> Option<HttpResponse> {
    let claims = get_current_claims(req)?; // None → no JWT → exempt
    if claims.mfa {
        return None;
    }
    Some(HttpResponse::Forbidden().json(ErrorResponse {
        success: false,
        error: "MFA step-up required for this operation. Call /api/auth/mfa/challenge.".to_string(),
        code: "MFA_REQUIRED".to_string(),
    }))
}
