//! JWT issuance/refresh (Phase 9.4), TOTP MFA enrollment & step-up (Phase 11.3),
//! and security-alert / breach-declaration admin endpoints (Phase 11.4).
//!
//! Inherits shared imports from the parent module via `use super::*`.

use super::*;
use crate::security::{jwt, mfa};

// ============================================================================
// Phase 9.4 — JWT issuance & refresh
// ============================================================================

#[derive(Debug, Serialize)]
pub struct JwtIssueResponse {
    pub success: bool,
    pub access_token: String,
    /// Only for a non-browser client that asked for it
    /// (`X-Refresh-Transport: body`). Browsers receive the refresh token as an
    /// HttpOnly cookie and never see it (WP12).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub expires_in: i64,
    /// Whether MFA is already satisfied. When false and `mfa_required` is true,
    /// the client must call `/api/auth/mfa/challenge` to step up.
    pub mfa: bool,
    pub mfa_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<CredentialUser>,
}

#[derive(Debug, Serialize)]
pub struct CredentialUser {
    pub user_id: String,
    pub name: String,
    pub role: String,
    pub linked_patient_id: Option<String>,
}

/// Body of a refresh. Browsers send none: their refresh token arrives as the
/// HttpOnly cookie. A non-browser client sends it here.
#[derive(Debug, Default, Deserialize)]
pub struct JwtRefreshRequest {
    #[serde(default)]
    pub refresh_token: Option<String>,
}

/// 401 for an unusable refresh, clearing the cookie so a browser stops
/// presenting a token that will never work again.
fn refresh_refused(message: &str, code: &str) -> HttpResponse {
    HttpResponse::Unauthorized()
        .insert_header((
            actix_web::http::header::SET_COOKIE,
            crate::refresh_cookie::clear_value(),
        ))
        .json(ErrorResponse {
            error: message.to_string(),
            code: code.to_string(),
        })
}

/// Exchange a valid refresh token for a fresh access token.
///
/// POST /api/auth/jwt/refresh
#[post("/api/auth/jwt/refresh")]
pub async fn refresh_jwt(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: Option<web::Json<JwtRefreshRequest>>,
) -> impl Responder {
    let presented = body
        .and_then(|json| json.into_inner().refresh_token)
        .or_else(|| crate::refresh_cookie::read(&http_req));
    let Some(presented) = presented else {
        return refresh_refused("No session to restore; sign in again", "NO_REFRESH_TOKEN");
    };
    let claims = match jwt::decode_token(&presented) {
        Ok(c) if c.typ == jwt::TYP_REFRESH => c,
        _ => return refresh_refused("Invalid or expired refresh token", "INVALID_REFRESH_TOKEN"),
    };
    let Some(user) = get_user(&data, &claims.sub) else {
        return refresh_refused(
            "Account is inactive or no longer registered",
            "ACCOUNT_INACTIVE",
        );
    };
    issue_token_pair(
        &data,
        &http_req,
        &claims.sub,
        &user.role.to_string(),
        Some((&presented, &claims.jti)),
        false,
    )
    .await
}

/// Issue an access+refresh pair for a user_id. The access token's `mfa` claim is
/// `true` only when the user_id has *not* enrolled MFA; enrolled user_ids receive
/// `mfa=false` and must step up via `/api/auth/mfa/challenge`.
pub(super) async fn issue_token_pair(
    data: &web::Data<AppState>,
    http_req: &HttpRequest,
    user_id: &str,
    role: &str,
    previous_refresh: Option<(&str, &str)>,
    mfa_verified: bool,
) -> HttpResponse {
    let mfa_enabled = data.security.mfa_enabled(user_id);
    let mfa_satisfied = !mfa_enabled || mfa_verified;

    // Order matters (ADR-0008). The access token carries the login session's
    // `sid`, so the session has to be persisted before the token can be minted --
    // and a token must never be handed out for a session that failed to persist.
    // The refresh token is minted first only because its digest and JTI are what
    // the generation row stores.
    let refresh = match jwt::issue_refresh_token(user_id, role) {
        Ok(t) => t,
        Err(e) => return jwt_error(e),
    };
    let refresh_claims = match jwt::decode_token(&refresh) {
        Ok(claims) => claims,
        Err(error) => return jwt_error(error),
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "Authentication is temporarily unavailable".to_string(),
            code: "AUTH_STORAGE_REQUIRED".to_string(),
        });
    };
    let expires_at = match chrono::DateTime::from_timestamp(refresh_claims.exp, 0) {
        Some(time) => time,
        None => return jwt_error(jsonwebtoken::errors::ErrorKind::InvalidToken.into()),
    };
    let persisted = match previous_refresh {
        // A rotation continues the existing login: the successor generation
        // inherits the same `sid`, which is the whole point of the split.
        Some((token, jti)) => crate::auth_sessions::rotate(
            pool,
            user_id,
            token,
            jti,
            &refresh,
            &refresh_claims.jti,
            expires_at,
        )
        .await
        .and_then(|rotated| {
            rotated
                .ok_or_else(|| sqlx::Error::Protocol("refresh session is no longer active".into()))
        }),
        None => {
            crate::auth_sessions::create(pool, user_id, &refresh, &refresh_claims.jti, expires_at)
                .await
        }
    };
    let login_session_id = match persisted {
        Ok(id) => id,
        Err(error) => {
            log::error!("Refresh-session persistence failed: {error}");
            if previous_refresh.is_some() {
                return refresh_refused(
                    "Invalid or expired refresh token",
                    "INVALID_REFRESH_TOKEN",
                );
            }
            let mut status = if previous_refresh.is_some() {
                HttpResponse::Unauthorized()
            } else {
                HttpResponse::ServiceUnavailable()
            };
            return status.json(ErrorResponse {
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
    };

    // The session exists now, so the access token can name it. If this fails the
    // caller gets an error and the unused session row simply expires -- that is
    // operational debris, not an issued credential for an unpersisted session.
    let access = match jwt::issue_access_token(
        user_id,
        role,
        mfa_satisfied,
        Some(&login_session_id.to_string()),
    ) {
        Ok(t) => t,
        Err(e) => return jwt_error(e),
    };

    let in_body = crate::refresh_cookie::body_transport_requested(http_req);
    HttpResponse::Ok()
        .insert_header((
            actix_web::http::header::SET_COOKIE,
            crate::refresh_cookie::set_value(&refresh),
        ))
        .json(JwtIssueResponse {
            success: true,
            access_token: access,
            refresh_token: in_body.then_some(refresh),
            token_type: "Bearer".to_string(),
            expires_in: jwt::ACCESS_TOKEN_TTL_SECS,
            mfa: mfa_satisfied,
            mfa_required: mfa_enabled,
            user: get_user(data, user_id).map(|account| CredentialUser {
                user_id: account.id,
                name: account.name,
                role: account.role.to_string(),
                linked_patient_id: account.linked_patient_id,
            }),
        })
}

fn jwt_error(e: jsonwebtoken::errors::Error) -> HttpResponse {
    log::error!("JWT issuance failed: {}", e);
    HttpResponse::InternalServerError().json(ErrorResponse {
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
/// End the caller's current login session.
///
/// ADR-0008 makes the database authoritative for revocation: an access token
/// stays cryptographically valid until it expires, so signing out has to revoke
/// the session rather than merely discard the token client-side. Revoking the
/// parent revokes every refresh generation beneath it, which is what stops a
/// still-intact refresh token from reopening the login.
#[post("/api/auth/logout")]
pub async fn logout(data: web::Data<AppState>, req: HttpRequest) -> HttpResponse {
    let Some(claims) = get_current_claims(&req) else {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            error: "Authentication required".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    };
    // Tokens issued before ADR-0008 carry no session to revoke. Report that
    // plainly rather than returning a success the caller cannot rely on.
    let Some(session_id) = claims.sid.as_deref().and_then(|s| Uuid::parse_str(s).ok()) else {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "This session cannot be ended; sign in again".to_string(),
            code: "SESSION_NOT_REVOCABLE".to_string(),
        });
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "Authentication is temporarily unavailable".to_string(),
            code: "AUTH_STORAGE_REQUIRED".to_string(),
        });
    };
    match crate::auth_sessions::revoke_session(pool, session_id, "logout").await {
        // `false` means the session was already ended. Logging out twice is not
        // an error worth surfacing to a user who wanted to be signed out.
        Ok(_) => HttpResponse::Ok()
            .insert_header((
                actix_web::http::header::SET_COOKIE,
                crate::refresh_cookie::clear_value(),
            ))
            .json(serde_json::json!({
                "success": true,
                "message": "Session ended",
            })),
        Err(error) => {
            log::error!("Session revocation failed: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "Could not end the session".to_string(),
                code: "SESSION_REVOCATION_FAILED".to_string(),
            })
        }
    }
}

/// End every login session for the caller's user_id ("sign out everywhere").
///
/// This is the control a user reaches for after losing a device, so it must not
/// depend on the lost device cooperating: it revokes by subject, not by the
/// session presenting the request.
#[post("/api/auth/logout-all")]
pub async fn logout_all(data: web::Data<AppState>, req: HttpRequest) -> HttpResponse {
    let Some(claims) = get_current_claims(&req) else {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            error: "Authentication required".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "Authentication is temporarily unavailable".to_string(),
            code: "AUTH_STORAGE_REQUIRED".to_string(),
        });
    };
    match crate::auth_sessions::revoke_all_for_user(pool, &claims.sub, "logout_all").await {
        Ok(ended) => HttpResponse::Ok()
            .insert_header((
                actix_web::http::header::SET_COOKIE,
                crate::refresh_cookie::clear_value(),
            ))
            .json(serde_json::json!({
                "success": true,
                "sessions_ended": ended,
            })),
        Err(error) => {
            log::error!("Bulk session revocation failed: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "Could not end the sessions".to_string(),
                code: "SESSION_REVOCATION_FAILED".to_string(),
            })
        }
    }
}

#[post("/api/auth/mfa/enroll")]
pub async fn mfa_enroll(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    let user_id = match crate::support::require_registered_caller(&data, &req) {
        Ok(u) => u.id,
        Err(resp) => return resp,
    };

    let secret = mfa::generate_secret_base32();
    let uri = match mfa::provisioning_uri(&secret, &user_id) {
        Ok(u) => u,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: e,
                code: "MFA_ENROLL_FAILED".to_string(),
            })
        }
    };
    let qr = generate_qr_code_base64(&uri);

    // Persist before publishing the enrollment into the runtime cache. A
    // success response for a memory-only enrollment would disappear on restart
    // and make server-side assurance checks disagree across replicas.
    if let Err(error) = data.persist_mfa_enrollment(&user_id, &secret, false).await {
        log::error!("Failed to persist MFA enrollment: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "MFA enrollment is temporarily unavailable".to_string(),
            code: "MFA_PERSISTENCE_REQUIRED".to_string(),
        });
    }
    let record = crate::security::mfa::MfaRecord {
        secret_base32: secret.clone(),
        enabled: false,
        created_at: Utc::now(),
        last_used_step: None,
    };
    match data.security.mfa.write() {
        Ok(mut enrollments) => {
            enrollments.insert(user_id.clone(), record);
        }
        Err(_) => {
            log::error!("MFA cache is unavailable after persisting enrollment");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
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
    let user_id = match crate::support::require_registered_caller(&data, &req) {
        Ok(u) => u.id,
        Err(resp) => return resp,
    };

    let _secret = match data
        .security
        .mfa
        .read()
        .ok()
        .and_then(|m| m.get(&user_id).map(|r| r.secret_base32.clone()))
    {
        Some(s) => s,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: "No MFA enrollment in progress. Call /api/auth/mfa/enroll first."
                    .to_string(),
                code: "MFA_NOT_ENROLLED".to_string(),
            })
        }
    };

    if data
        .verify_totp(&user_id, &body.code, crate::state::TotpScope::Pending)
        .await
        != crate::state::TotpOutcome::Accepted
    {
        data.security
            .observe_failed_auth(&data.ws_manager, &user_id)
            .await;
        return HttpResponse::Unauthorized().json(ErrorResponse {
            error: "Invalid MFA code".to_string(),
            code: "MFA_CODE_INVALID".to_string(),
        });
    }

    if let Err(error) = data.update_mfa_enabled(&user_id, true).await {
        log::error!("Failed to persist MFA activation: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "MFA activation is temporarily unavailable".to_string(),
            code: "MFA_PERSISTENCE_REQUIRED".to_string(),
        });
    }
    match data.security.mfa.write() {
        Ok(mut enrollments) => match enrollments.get_mut(&user_id) {
            Some(record) => record.enabled = true,
            None => {
                log::error!("Persisted MFA activation has no cache record");
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    error: "MFA was stored but cannot be used until the service recovers"
                        .to_string(),
                    code: "MFA_CACHE_UNAVAILABLE".to_string(),
                });
            }
        },
        Err(_) => {
            log::error!("MFA cache is unavailable after activation");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
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
    let user_id = match crate::support::require_registered_caller(&data, &req) {
        Ok(u) => u.id,
        Err(resp) => return resp,
    };

    let _secret = match data.security.mfa.read().ok().and_then(|m| {
        m.get(&user_id)
            .filter(|r| r.enabled)
            .map(|r| r.secret_base32.clone())
    }) {
        Some(s) => s,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: "MFA is not enabled for this account".to_string(),
                code: "MFA_NOT_ENABLED".to_string(),
            })
        }
    };

    if data
        .verify_totp(&user_id, &body.code, crate::state::TotpScope::Enabled)
        .await
        != crate::state::TotpOutcome::Accepted
    {
        data.security
            .observe_failed_auth(&data.ws_manager, &user_id)
            .await;
        return HttpResponse::Unauthorized().json(ErrorResponse {
            error: "Invalid MFA code".to_string(),
            code: "MFA_CODE_INVALID".to_string(),
        });
    }

    let role = get_user(&data, &user_id)
        .map(|u| u.role.to_string())
        .unwrap_or_else(|| "Patient".to_string());

    // Class B assurance is server-owned. Persist it before minting an elevated
    // token so the token and /api/auth/assurance agree for this login.
    let Some(login_session_id) = get_current_claims(&req).and_then(|claims| claims.sid.clone())
    else {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            error: "A current signed-in session is required".to_string(),
            code: "SESSION_REQUIRED".to_string(),
        });
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "Authorization is temporarily unavailable".to_string(),
            code: "AUTH_STORAGE_REQUIRED".to_string(),
        });
    };
    let session_id = uuid::Uuid::parse_str(&login_session_id).ok();
    let actor_id = uuid::Uuid::parse_str(&user_id).ok();
    let result = match (session_id, actor_id) {
        (Some(session_id), Some(actor_id)) => {
            crate::transaction_authorization::record_step_up(pool, session_id, actor_id).await
        }
        _ => Err(sqlx::Error::RowNotFound),
    };
    match result {
        Ok(()) => {}
        Err(sqlx::Error::RowNotFound) => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "This session has ended; sign in again".to_string(),
                code: "SESSION_REVOKED".to_string(),
            });
        }
        Err(error) => {
            log::error!("MFA step-up storage failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "Authorization is temporarily unavailable".to_string(),
                code: "AUTH_STORAGE_REQUIRED".to_string(),
            });
        }
    }

    match jwt::issue_access_token(&user_id, &role, true, Some(&login_session_id)) {
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
    let user_id = match crate::support::require_registered_caller(&data, &req) {
        Ok(u) => u.id,
        Err(resp) => return resp,
    };
    let (enrolled, enabled) = data
        .security
        .mfa
        .read()
        .ok()
        .and_then(|m| m.get(&user_id).map(|r| (true, r.enabled)))
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
    let user_id = match crate::support::require_registered_caller(&data, &req) {
        Ok(u) => u.id,
        Err(resp) => return resp,
    };

    let _secret = match data.security.mfa.read().ok().and_then(|m| {
        m.get(&user_id)
            .filter(|r| r.enabled)
            .map(|r| r.secret_base32.clone())
    }) {
        Some(s) => s,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: "MFA is not enabled for this account".to_string(),
                code: "MFA_NOT_ENABLED".to_string(),
            })
        }
    };

    if data
        .verify_totp(&user_id, &body.code, crate::state::TotpScope::Enabled)
        .await
        != crate::state::TotpOutcome::Accepted
    {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            error: "Invalid MFA code".to_string(),
            code: "MFA_CODE_INVALID".to_string(),
        });
    }

    if let Err(error) = data.delete_mfa_enrollment(&user_id).await {
        log::error!("Failed to delete MFA enrollment: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "MFA could not be disabled because the durable record is unavailable"
                .to_string(),
            code: "MFA_PERSISTENCE_REQUIRED".to_string(),
        });
    }
    match data.security.mfa.write() {
        Ok(mut enrollments) => {
            enrollments.remove(&user_id);
        }
        Err(_) => {
            log::error!("MFA cache is unavailable after disabling enrollment");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
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
        error: "Sign in is required".to_string(),
        code: "UNAUTHORIZED".to_string(),
    })
}

/// Verify the caller is an Admin. Returns the rejection response on failure.
pub(crate) fn require_admin(
    data: &web::Data<AppState>,
    req: &HttpRequest,
) -> Result<(), HttpResponse> {
    let user_id = get_current_user_id(req).ok_or_else(unauthorized_missing_user)?;
    let user = get_user(data, &user_id).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        })
    })?;
    if !user.role.is_admin() {
        return Err(HttpResponse::Forbidden().json(ErrorResponse {
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
    /// Identity established by a verified access token, but no step-up proven
    /// on this request.
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
    // Synthetic demo admins have no MFA enrollment. The JWT still establishes
    // identity before this exemption can apply.
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
/// An expired or malformed JWT yields no claims, and cannot establish even
/// the identified assurance level.
fn caller_assurance(req: &HttpRequest) -> CallerAssurance {
    match get_current_claims(req) {
        Some(claims) if stepped_up_claim_is_fresh(&claims, chrono::Utc::now().timestamp()) => {
            CallerAssurance::SteppedUp
        }
        Some(_) => CallerAssurance::Identified,
        None => CallerAssurance::Anonymous,
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

/// Whether `user_id` has a durable, enabled MFA enrollment.
///
/// Read per request from server-side state (`user_mfa` → `security.mfa`), which
/// is what makes the policy independent of the login factor.
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
    // (`user_mfa` → `security.mfa`), keyed by the verified JWT subject.
    let enrolled = get_current_user_id(req)
        .map(|user_id| data.security.mfa_enabled(&user_id))
        .unwrap_or(false);

    match privileged_assurance_decision(crate::support::is_demo_mode(), enrolled, assurance) {
        Ok(()) => None,
        Err(AssuranceDenial::NoCaller) => Some(HttpResponse::Unauthorized().json(ErrorResponse {
            error: "Authentication required for this operation.".to_string(),
            code: "UNAUTHORIZED".to_string(),
        })),
        Err(AssuranceDenial::EnrollmentRequired) => Some(
            HttpResponse::Forbidden().json(ErrorResponse {
                error: "This operation requires MFA. Enroll via /api/auth/mfa/enroll, then \
                        step up via /api/auth/mfa/challenge."
                    .to_string(),
                code: "MFA_ENROLLMENT_REQUIRED".to_string(),
            }),
        ),
        Err(AssuranceDenial::StepUpRequired) => Some(
            HttpResponse::Forbidden().json(ErrorResponse {
                error: "MFA step-up required for this operation. Call /api/auth/mfa/challenge."
                    .to_string(),
                code: "MFA_REQUIRED".to_string(),
            }),
        ),
    }
}

#[cfg(all(test, feature = "postgres"))]
mod refresh_cookie_tests {
    use super::*;
    use actix_web::{test, App};

    /// State on PostgreSQL with a registered doctor and one login session,
    /// returning the session's refresh token.
    async fn state_with_session() -> (web::Data<AppState>, String) {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let mut state = AppState::new();
        state.db_pool = Some(pool.clone());
        let user = crate::test_fixtures::insert_pg_user(&pool, "Doctor").await;
        crate::test_fixtures::register(&state, &user, crate::Role::Doctor);
        let token = jwt::issue_refresh_token(&user, "Doctor").unwrap();
        let claims = jwt::decode_token(&token).unwrap();
        crate::auth_sessions::create(
            &pool,
            &user,
            &token,
            &claims.jti,
            chrono::Utc::now() + chrono::Duration::hours(1),
        )
        .await
        .unwrap();
        (web::Data::new(state), token)
    }

    async fn refresh_with_cookie(
        data: &web::Data<AppState>,
        token: &str,
    ) -> actix_web::dev::ServiceResponse {
        let app = test::init_service(App::new().app_data(data.clone()).service(refresh_jwt)).await;
        let request = test::TestRequest::post()
            .uri("/api/auth/jwt/refresh")
            .insert_header((
                actix_web::http::header::COOKIE,
                format!("{}={token}", crate::refresh_cookie::REFRESH_COOKIE),
            ))
            .to_request();
        test::call_service(&app, request).await
    }

    fn set_cookie(response: &actix_web::dev::ServiceResponse) -> String {
        response
            .headers()
            .get(actix_web::http::header::SET_COOKIE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string()
    }

    /// A reload restores the session from the cookie alone, rotating it; the
    /// browser never sees the refresh token in the body.
    #[actix_web::test]
    async fn the_cookie_restores_and_rotates_the_session() {
        let (data, token) = state_with_session().await;
        let response = refresh_with_cookie(&data, &token).await;
        assert_eq!(response.status(), 200);
        let cookie = set_cookie(&response);
        assert!(
            cookie.contains("HttpOnly") && !cookie.contains(&token),
            "rotated: {cookie}"
        );
        let body: serde_json::Value = test::read_body_json(response).await;
        assert!(body["access_token"].is_string());
        assert!(
            body.get("refresh_token").is_none(),
            "never readable by script"
        );
    }

    /// The rotated-away token is refused and the cookie cleared; with no
    /// cookie at all there is nothing to restore.
    #[actix_web::test]
    async fn an_old_or_missing_cookie_is_refused_and_cleared() {
        let (data, token) = state_with_session().await;
        assert_eq!(refresh_with_cookie(&data, &token).await.status(), 200);
        let replay = refresh_with_cookie(&data, &token).await;
        assert_eq!(replay.status(), 401);
        assert!(set_cookie(&replay).contains("Max-Age=0"));

        let app = test::init_service(App::new().app_data(data.clone()).service(refresh_jwt)).await;
        let bare = test::TestRequest::post()
            .uri("/api/auth/jwt/refresh")
            .to_request();
        let response = test::call_service(&app, bare).await;
        assert_eq!(response.status(), 401);
        let body = test::read_body(response).await;
        assert!(
            String::from_utf8_lossy(&body).contains("NO_REFRESH_TOKEN"),
            "{}",
            String::from_utf8_lossy(&body)
        );
    }
}
