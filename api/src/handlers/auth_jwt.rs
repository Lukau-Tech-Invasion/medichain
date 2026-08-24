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
    pub challenge_id: String,
    pub nonce: String,
    /// Hex-encoded sr25519 signature over the issued login challenge message.
    pub signature: String,
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

fn valid_login_proof(challenge_id: &str, nonce: &str, signature: &str) -> bool {
    !challenge_id.trim().is_empty() && !nonce.trim().is_empty() && !signature.trim().is_empty()
}

/// Issue access + refresh JWTs after verifying a durable single-use challenge.
///
/// POST /api/auth/jwt
///
/// Demo mode does not bypass wallet ownership or replay protection.
#[post("/api/auth/jwt")]
pub async fn issue_jwt(
    data: web::Data<AppState>,
    body: web::Json<JwtIssueRequest>,
) -> impl Responder {
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid wallet address format".to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    if !valid_login_proof(&body.challenge_id, &body.nonce, &body.signature) {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Invalid authentication challenge".to_string(),
            code: "INVALID_AUTH_CHALLENGE".to_string(),
        });
    }
    let message = crate::auth_challenges::login_message(
        &body.challenge_id,
        &body.wallet_address,
        &body.nonce,
    );
    if let Err(error) = medichain_crypto::signature::verify_wallet_message_signature(
        &body.signature,
        &message,
        &body.wallet_address,
    ) {
        data.security
            .observe_failed_auth(&data.ws_manager, &body.wallet_address)
            .await;
        log::warn!("JWT wallet signature verification failed: {error}");
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Invalid authentication challenge".to_string(),
            code: "INVALID_AUTH_CHALLENGE".to_string(),
        });
    }
    let Some(pool) = data.db_pool.as_ref() else {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Authentication is temporarily unavailable".to_string(),
            code: "AUTH_STORAGE_REQUIRED".to_string(),
        });
    };
    match crate::auth_challenges::consume(
        pool,
        &body.challenge_id,
        &body.wallet_address,
        &body.nonce,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Invalid authentication challenge".to_string(),
                code: "INVALID_AUTH_CHALLENGE".to_string(),
            });
        }
        Err(error) => {
            log::error!("Could not consume authentication challenge: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Authentication is temporarily unavailable".to_string(),
                code: "AUTH_CHALLENGE_UNAVAILABLE".to_string(),
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

    issue_token_pair(&data, &body.wallet_address, &user.role.to_string(), None).await
}

#[cfg(test)]
mod jwt_issue_tests {
    use super::valid_login_proof;

    #[test]
    fn wallet_challenge_fields_are_mandatory_even_for_demo_runtime_configuration() {
        assert!(!valid_login_proof("", "nonce", "signature"));
        assert!(!valid_login_proof("challenge", "", "signature"));
        assert!(!valid_login_proof("challenge", "nonce", ""));
        assert!(valid_login_proof("challenge", "nonce", "signature"));
    }
}

#[derive(Debug, Deserialize)]
pub struct JwtRefreshRequest {
    pub refresh_token: String,
}

/// Exchange a valid refresh token for a fresh access token.
///
/// POST /api/auth/jwt/refresh
#[post("/api/auth/jwt/refresh")]
pub async fn refresh_jwt(
    data: web::Data<AppState>,
    body: web::Json<JwtRefreshRequest>,
) -> impl Responder {
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
    let user = match get_user(&data, &claims.sub) {
        Some(user) => user,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Account is inactive or no longer registered".to_string(),
                code: "ACCOUNT_INACTIVE".to_string(),
            });
        }
    };
    issue_token_pair(
        &data,
        &claims.sub,
        &user.role.to_string(),
        Some((&body.refresh_token, &claims.jti)),
    )
    .await
}

/// Issue an access+refresh pair for a wallet. The access token's `mfa` claim is
/// `true` only when the wallet has *not* enrolled MFA; enrolled wallets receive
/// `mfa=false` and must step up via `/api/auth/mfa/challenge`.
async fn issue_token_pair(
    data: &web::Data<AppState>,
    wallet: &str,
    role: &str,
    previous_refresh: Option<(&str, &str)>,
) -> HttpResponse {
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
    let refresh_claims = match jwt::decode_token(&refresh) {
        Ok(claims) => claims,
        Err(error) => return jwt_error(error),
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Authentication is temporarily unavailable".to_string(),
            code: "AUTH_STORAGE_REQUIRED".to_string(),
        });
    };
    let expires_at = match chrono::DateTime::from_timestamp(refresh_claims.exp, 0) {
        Some(time) => time,
        None => return jwt_error(jsonwebtoken::errors::ErrorKind::InvalidToken.into()),
    };
    let persisted = match previous_refresh {
        Some((token, jti)) => crate::auth_sessions::rotate(
            pool,
            wallet,
            token,
            jti,
            &refresh,
            &refresh_claims.jti,
            expires_at,
        )
        .await
        .and_then(|rotated| {
            if rotated {
                Ok(())
            } else {
                Err(sqlx::Error::Protocol(
                    "refresh session is no longer active".into(),
                ))
            }
        }),
        None => {
            crate::auth_sessions::create(pool, wallet, &refresh, &refresh_claims.jti, expires_at)
                .await
        }
    };
    if let Err(error) = persisted {
        log::error!("Refresh-session persistence failed: {error}");
        let mut status = if previous_refresh.is_some() {
            HttpResponse::Unauthorized()
        } else {
            HttpResponse::ServiceUnavailable()
        };
        return status.json(ErrorResponse {
            success: false,
            error: if previous_refresh.is_some() {
                "Invalid or expired refresh token".to_string()
            } else {
                "Authentication is temporarily unavailable".to_string()
            },
            code: if previous_refresh.is_some() {
                "INVALID_REFRESH_TOKEN".to_string()
            } else {
                "AUTH_SESSION_UNAVAILABLE".to_string()
            },
        });
    }

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
    log::error!("JWT issuance failed: {}", e);
    HttpResponse::InternalServerError().json(ErrorResponse {
        success: false,
        error: "Failed to issue authentication token".to_string(),
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
    let wallet = match crate::support::require_registered_caller(&data, &req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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

    // Persist before publishing the enrollment into the runtime cache. A
    // success response for a memory-only enrollment would disappear on restart
    // and make server-side assurance checks disagree across replicas.
    if let Err(error) = data.persist_mfa_enrollment(&wallet, &secret, false).await {
        log::error!("Failed to persist MFA enrollment: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "MFA enrollment is temporarily unavailable".to_string(),
            code: "MFA_PERSISTENCE_REQUIRED".to_string(),
        });
    }
    let record = crate::security::mfa::MfaRecord {
        secret_base32: secret.clone(),
        enabled: false,
        created_at: Utc::now(),
    };
    match data.security.mfa.write() {
        Ok(mut enrollments) => {
            enrollments.insert(wallet.clone(), record);
        }
        Err(_) => {
            log::error!("MFA cache is unavailable after persisting enrollment");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error:
                    "MFA enrollment was stored but cannot be activated until the service recovers"
                        .to_string(),
                code: "MFA_CACHE_UNAVAILABLE".to_string(),
            });
        }
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
pub async fn mfa_verify(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<MfaCodeRequest>,
) -> impl Responder {
    let wallet = match crate::support::require_registered_caller(&data, &req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let secret = match data
        .security
        .mfa
        .read()
        .ok()
        .and_then(|m| m.get(&wallet).map(|r| r.secret_base32.clone()))
    {
        Some(s) => s,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "No MFA enrollment in progress. Call /api/auth/mfa/enroll first."
                    .to_string(),
                code: "MFA_NOT_ENROLLED".to_string(),
            })
        }
    };

    if !mfa::verify_code(&secret, &wallet, &body.code) {
        data.security
            .observe_failed_auth(&data.ws_manager, &wallet)
            .await;
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Invalid MFA code".to_string(),
            code: "MFA_CODE_INVALID".to_string(),
        });
    }

    if let Err(error) = data.update_mfa_enabled(&wallet, true).await {
        log::error!("Failed to persist MFA activation: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "MFA activation is temporarily unavailable".to_string(),
            code: "MFA_PERSISTENCE_REQUIRED".to_string(),
        });
    }
    match data.security.mfa.write() {
        Ok(mut enrollments) => match enrollments.get_mut(&wallet) {
            Some(record) => record.enabled = true,
            None => {
                log::error!("Persisted MFA activation has no cache record");
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    success: false,
                    error: "MFA was stored but cannot be used until the service recovers"
                        .to_string(),
                    code: "MFA_CACHE_UNAVAILABLE".to_string(),
                });
            }
        },
        Err(_) => {
            log::error!("MFA cache is unavailable after activation");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "MFA was stored but cannot be used until the service recovers".to_string(),
                code: "MFA_CACHE_UNAVAILABLE".to_string(),
            });
        }
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
pub async fn mfa_challenge(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<MfaCodeRequest>,
) -> impl Responder {
    let wallet = match crate::support::require_registered_caller(&data, &req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let secret = match data.security.mfa.read().ok().and_then(|m| {
        m.get(&wallet)
            .filter(|r| r.enabled)
            .map(|r| r.secret_base32.clone())
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
        data.security
            .observe_failed_auth(&data.ws_manager, &wallet)
            .await;
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
    let wallet = match crate::support::require_registered_caller(&data, &req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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
pub async fn mfa_disable(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<MfaCodeRequest>,
) -> impl Responder {
    let wallet = match crate::support::require_registered_caller(&data, &req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let secret = match data.security.mfa.read().ok().and_then(|m| {
        m.get(&wallet)
            .filter(|r| r.enabled)
            .map(|r| r.secret_base32.clone())
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

    if let Err(error) = data.delete_mfa_enrollment(&wallet).await {
        log::error!("Failed to delete MFA enrollment: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "MFA could not be disabled because the durable record is unavailable"
                .to_string(),
            code: "MFA_PERSISTENCE_REQUIRED".to_string(),
        });
    }
    match data.security.mfa.write() {
        Ok(mut enrollments) => {
            enrollments.remove(&wallet);
        }
        Err(_) => {
            log::error!("MFA cache is unavailable after disabling enrollment");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "MFA was disabled but the local session cache has not recovered".to_string(),
                code: "MFA_CACHE_UNAVAILABLE".to_string(),
            });
        }
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
pub async fn declare_breach(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<DeclareBreachRequest>,
) -> impl Responder {
    match require_admin(&data, &req) {
        Ok(()) => {}
        Err(resp) => return resp,
    }
    // Sensitive action: privileged operations require an MFA-enrolled caller
    // with verified step-up (H2 / issue #8).
    if let Some(resp) = require_privileged_assurance(&data, &req) {
        return resp;
    }

    let alert = data
        .security
        .declare_breach(
            &data.ws_manager,
            body.actor.clone(),
            body.description.clone(),
        )
        .await;

    // Automated notification dispatch: security officer (SMS) + regulator/
    // data-subject (email); best-effort, per-channel.
    let notified = crate::notifications::dispatch_breach_notification(
        &data.repositories,
        &alert.message,
        alert.notify_deadline,
    )
    .await;

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alert": alert,
        "officers_notified": notified.security_officers_notified,
        "regulator_emails_notified": notified.regulator_emails_notified,
        "message": "Breach recorded. Notify affected parties within 72 hours (POPIA).",
    }))
}

// ============================================================================
// Local helpers
// ============================================================================

pub(crate) fn unauthorized_missing_user() -> HttpResponse {
    HttpResponse::Unauthorized().json(ErrorResponse {
        success: false,
        error: "Authentication required (Bearer JWT or X-User-Id)".to_string(),
        code: "UNAUTHORIZED".to_string(),
    })
}

/// Verify the caller is an Admin. Returns the rejection response on failure.
pub(crate) fn require_admin(
    data: &web::Data<AppState>,
    req: &HttpRequest,
) -> Result<(), HttpResponse> {
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

/// What a caller has actually demonstrated on **this** request.
///
/// Deliberately separate from *how* they authenticated. The H2 bypass existed
/// because the old control keyed off credential type ("is there an
/// `Authorization` header?") rather than assurance, so a caller carrying no
/// JWT skipped the check entirely instead of failing it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CallerAssurance {
    /// No caller could be resolved at all.
    Anonymous,
    /// Identity established — a JWT subject, or an `X-User-Id` the signature
    /// middleware has verified — but no step-up proven on this request.
    Identified,
    /// Identity established *and* step-up verified.
    SteppedUp,
}

/// Why a privileged operation was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AssuranceDenial {
    /// No resolvable caller → 401.
    NoCaller,
    /// Caller is not MFA-enrolled, so cannot reach a privileged route at all.
    EnrollmentRequired,
    /// Caller is enrolled but has not stepped up on this request.
    StepUpRequired,
}

/// The privileged-operation policy, as a **pure function**.
///
/// Posture and enrollment are parameters rather than globals for two reasons:
/// it makes the decision exhaustively testable without mutating process-global
/// `IS_DEMO` (which races other tests — see `DEMO_ENV_GUARD` in `support.rs`),
/// and it keeps the security rule readable as one expression instead of being
/// spread across environment lookups.
///
/// The property this encodes (owner decision, 2026-08-08):
///
/// > No **production** privileged route may be executed without a caller who is
/// > MFA-enrolled **and** has verified step-up.
///
/// Note the ordering: `Anonymous` is refused *before* the demo exemption is
/// considered, so demo mode never turns a privileged route into an open one.
pub(crate) fn privileged_assurance_decision(
    is_demo: bool,
    enrolled: bool,
    assurance: CallerAssurance,
) -> Result<(), AssuranceDenial> {
    if assurance == CallerAssurance::Anonymous {
        return Err(AssuranceDenial::NoCaller);
    }
    // Demo mode trusts `X-User-Id` by design and warns so at startup; demo
    // admins have no MFA enrollment, so enforcing here would only break the
    // demo without protecting anything real.
    if is_demo {
        return Ok(());
    }
    if !enrolled {
        return Err(AssuranceDenial::EnrollmentRequired);
    }
    match assurance {
        CallerAssurance::SteppedUp => Ok(()),
        _ => Err(AssuranceDenial::StepUpRequired),
    }
}

/// Resolve what the request actually proves.
///
/// An expired or malformed JWT yields no claims, and `get_current_user_id`
/// then falls back to `X-User-Id` (`support.rs:227-233`). That fallback must
/// downgrade the caller to `Identified` — never leave them stepped-up on the
/// strength of a claim that is no longer valid.
fn caller_assurance(req: &HttpRequest) -> CallerAssurance {
    match get_current_claims(req) {
        Some(claims) if stepped_up_claim_is_fresh(&claims, chrono::Utc::now().timestamp()) => {
            CallerAssurance::SteppedUp
        }
        Some(_) => CallerAssurance::Identified,
        None => match req.headers().get("X-User-Id") {
            Some(_) => CallerAssurance::Identified,
            None => CallerAssurance::Anonymous,
        },
    }
}

/// A boolean MFA flag alone is not step-up proof: the verification must be
/// recent and must not claim a time in the future.
pub(crate) fn stepped_up_claim_is_fresh(claims: &jwt::Claims, now: i64) -> bool {
    let Some(auth_time) = claims.auth_time else {
        return false;
    };
    claims.mfa && auth_time <= now && now.saturating_sub(auth_time) <= jwt::MFA_STEP_UP_TTL_SECS
}

/// Whether `wallet` has a durable, enabled MFA enrollment.
///
/// Read per request from server-side state (`user_mfa` → `security.mfa`), which
/// is what makes the policy work for callers who present no JWT: enrollment is
/// keyed by wallet, not by credential.
/// Gate a privileged operation on caller assurance.
///
/// This is the single policy every sensitive endpoint consumes. It replaces
/// `enforce_mfa_step_up`, which exempted any caller without a JWT — issue #8
/// (H2). Returns `Some(response)` when the operation must be refused.
pub(crate) fn require_privileged_assurance(
    data: &web::Data<AppState>,
    req: &HttpRequest,
) -> Option<HttpResponse> {
    let assurance = caller_assurance(req);
    // Enrollment is read per request from durable server-side state
    // (`user_mfa` → `security.mfa`). That is what makes this work for callers
    // presenting no JWT: enrollment is keyed by wallet, not by credential.
    let enrolled = get_current_user_id(req)
        .map(|wallet| data.security.mfa_enabled(&wallet))
        .unwrap_or(false);

    match privileged_assurance_decision(crate::support::is_demo_mode(), enrolled, assurance) {
        Ok(()) => None,
        Err(AssuranceDenial::NoCaller) => Some(HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Authentication required for this operation.".to_string(),
            code: "UNAUTHORIZED".to_string(),
        })),
        Err(AssuranceDenial::EnrollmentRequired) => Some(
            HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "This operation requires MFA. Enroll via /api/auth/mfa/enroll, then \
                        step up via /api/auth/mfa/challenge."
                    .to_string(),
                code: "MFA_ENROLLMENT_REQUIRED".to_string(),
            }),
        ),
        Err(AssuranceDenial::StepUpRequired) => Some(
            HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "MFA step-up required for this operation. Call /api/auth/mfa/challenge."
                    .to_string(),
                code: "MFA_REQUIRED".to_string(),
            }),
        ),
    }
}
