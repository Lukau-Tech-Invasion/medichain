//! Password-proof sign-in and one-time credential activation.
//!
//! Authentication is tied to `users.id`; clinical identities and medical IDs
//! are separate. No account can obtain a token without a durable login session.

use super::*;
use crate::credentials::{self, ApplyError, RedeemError};
use crate::state::{TotpOutcome, TotpScope};

#[derive(Debug, Deserialize)]
pub struct PasswordLoginRequest {
    pub identifier: String,
    pub auth_proof: String,
    pub totp_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RedeemCredentialRequest {
    pub identifier: String,
    pub code: String,
    pub auth_proof: String,
    pub username: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_auth_proof: String,
    pub new_auth_proof: String,
}

fn credential_error() -> HttpResponse {
    HttpResponse::Unauthorized().json(ErrorResponse {
        error: "The sign-in details are not correct".to_string(),
        code: "INVALID_CREDENTIALS".to_string(),
    })
}

fn storage_error() -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        error: "Sign-in is temporarily unavailable".to_string(),
        code: "AUTH_STORAGE_REQUIRED".to_string(),
    })
}

fn locked_error() -> HttpResponse {
    HttpResponse::TooManyRequests().json(ErrorResponse {
        error: "This account is temporarily locked. Try again later.".to_string(),
        code: "ACCOUNT_LOCKED".to_string(),
    })
}

/// Sign in as a staff member or patient using the same account namespace.
#[post("/api/auth/login")]
pub async fn password_login(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<PasswordLoginRequest>,
) -> HttpResponse {
    let key = credentials::throttle_key(&body.identifier);
    if key.is_empty() || key.len() > 254 || !credentials::is_valid_auth_proof(&body.auth_proof) {
        return credential_error();
    }
    if credentials::is_locked_out(&key) {
        return locked_error();
    }
    let Some(pool) = data.db_pool.as_ref() else {
        return storage_error();
    };
    let account = match credentials::find_for_sign_in(pool, &key).await {
        Ok(account) => account,
        Err(error) => {
            log::error!("Credential lookup failed: {error}");
            return storage_error();
        }
    };
    let verifier = account
        .as_ref()
        .and_then(|account| account.credential_verifier.as_deref())
        .unwrap_or(credentials::timing_equaliser());
    let proof_ok = medichain_crypto::password::verify_secret(&body.auth_proof, verifier);
    let Some(account) = account.filter(|account| proof_ok && account.status == "active") else {
        credentials::record_failure(&key);
        return credential_error();
    };
    let user_id = account.id.to_string();
    let mfa_verified = if data.security.mfa_enabled(&user_id) {
        let Some(code) = body.totp_code.as_deref() else {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Enter your authenticator code to finish signing in".to_string(),
                code: "MFA_REQUIRED".to_string(),
            });
        };
        match data.verify_totp(&user_id, code, TotpScope::Enabled).await {
            TotpOutcome::Accepted => true,
            TotpOutcome::Unavailable => return storage_error(),
            _ => {
                credentials::record_failure(&key);
                return credential_error();
            }
        }
    } else {
        false
    };
    let Some(user) = get_user(&data, &user_id) else {
        return credential_error();
    };
    credentials::clear_failures(&key);
    super::auth_jwt::issue_token_pair(
        &data,
        &req,
        &user_id,
        &user.role.to_string(),
        None,
        mfa_verified,
    )
    .await
}

/// Spend a one-time activation or reset code and choose a password proof.
#[post("/api/auth/credentials/redeem")]
pub async fn redeem_credential(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<RedeemCredentialRequest>,
) -> HttpResponse {
    if !credentials::is_valid_auth_proof(&body.auth_proof) {
        return invalid_grant();
    }
    let Some(code) = credentials::normalize_code(&body.code) else {
        return invalid_grant();
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return storage_error();
    };
    let account = match credentials::find_for_grant(pool, body.identifier.trim()).await {
        Ok(Some(account)) => account,
        Ok(None) => return invalid_grant(),
        Err(error) => {
            log::error!("Credential-grant lookup failed: {error}");
            return storage_error();
        }
    };
    let grant = match credentials::match_code(pool, account.id, &code).await {
        Ok(grant) => grant,
        Err(RedeemError::Database(error)) => {
            log::error!("Credential-grant check failed: {error}");
            return storage_error();
        }
        Err(_) => return invalid_grant(),
    };
    let proposed = body.username.as_deref().or(account.login_id.as_deref());
    let Some(login_id) = proposed.and_then(credentials::validate_login_id) else {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "Choose a valid username to activate this account".to_string(),
            code: "INVALID_LOGIN_ID".to_string(),
        });
    };
    if account
        .login_id
        .as_deref()
        .is_some_and(|existing| !existing.eq_ignore_ascii_case(&login_id))
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "Use this account's existing login ID when resetting its password".to_string(),
            code: "INVALID_LOGIN_ID".to_string(),
        });
    }
    let verifier = match medichain_crypto::password::hash_secret(&body.auth_proof) {
        Ok(value) => value,
        Err(error) => {
            log::error!("Credential hashing failed: {error}");
            return storage_error();
        }
    };
    match credentials::apply_redemption(pool, grant, account.id, &login_id, &verifier).await {
        Ok(()) => {}
        Err(ApplyError::LoginIdTaken) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                error: "That username is already taken".to_string(),
                code: "LOGIN_ID_TAKEN".to_string(),
            });
        }
        Err(ApplyError::GrantGone) => return invalid_grant(),
        Err(ApplyError::Database(error)) => {
            log::error!("Credential activation failed: {error}");
            return storage_error();
        }
    }
    if account.status != "active" {
        return HttpResponse::Accepted().json(serde_json::json!({
            "success": true,
            "activation_pending_approval": true,
        }));
    }
    if data.security.mfa_enabled(&account.id.to_string()) {
        return HttpResponse::Ok().json(serde_json::json!({
            "success": true, "mfa": false, "mfa_required": true,
        }));
    }
    super::auth_jwt::issue_token_pair(
        &data,
        &req,
        &account.id.to_string(),
        &account.role,
        None,
        false,
    )
    .await
}

fn invalid_grant() -> HttpResponse {
    HttpResponse::Unauthorized().json(ErrorResponse {
        error: "That activation code is invalid or has expired".to_string(),
        code: "INVALID_GRANT".to_string(),
    })
}

/// Change one's password after proving the current one; end other sessions.
#[post("/api/auth/credentials/change")]
pub async fn change_password(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<ChangePasswordRequest>,
) -> HttpResponse {
    if !credentials::is_valid_auth_proof(&body.current_auth_proof)
        || !credentials::is_valid_auth_proof(&body.new_auth_proof)
    {
        return credential_error();
    }
    let Some(claims) = get_current_claims(&req) else {
        return credential_error();
    };
    let Some(session_id) = claims.sid.as_deref().and_then(|s| Uuid::parse_str(s).ok()) else {
        return credential_error();
    };
    let Some(user_id) = crate::actor_directory::parse_user_id(&claims.sub) else {
        return credential_error();
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return storage_error();
    };
    let verifier: Option<String> = match sqlx::query_scalar(
        "SELECT credential_verifier FROM users WHERE id = $1 AND status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    {
        Ok(value) => value.flatten(),
        Err(error) => {
            log::error!("Current credential lookup failed: {error}");
            return storage_error();
        }
    };
    let verifier = verifier.unwrap_or_else(|| credentials::timing_equaliser().to_string());
    if !medichain_crypto::password::verify_secret(&body.current_auth_proof, &verifier) {
        return credential_error();
    }
    let new_verifier = match medichain_crypto::password::hash_secret(&body.new_auth_proof) {
        Ok(value) => value,
        Err(error) => {
            log::error!("Credential hashing failed: {error}");
            return storage_error();
        }
    };
    match credentials::replace_verifier(pool, user_id, &verifier, &new_verifier, Some(session_id))
        .await
    {
        Ok(true) => HttpResponse::Ok().json(serde_json::json!({ "success": true })),
        Ok(false) => credential_error(),
        Err(error) => {
            log::error!("Credential replacement failed: {error}");
            storage_error()
        }
    }
}
