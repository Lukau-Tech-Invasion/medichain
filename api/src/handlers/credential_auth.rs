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

/// Setting a password sends it, once, so the server can refuse a weak one
/// (`password_policy`); the server then derives the sign-in proof itself.
/// A client that still sends only a proof is told so: accepting a proof here
/// would let any client skip the strength rules.
#[derive(Debug, Deserialize)]
pub struct RedeemCredentialRequest {
    pub identifier: String,
    pub code: String,
    #[serde(default)]
    pub password: Option<String>,
    pub username: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_auth_proof: String,
    #[serde(default)]
    pub new_password: Option<String>,
}

fn password_required() -> HttpResponse {
    HttpResponse::BadRequest().json(ErrorResponse {
        error: "Send the new password so its strength can be checked".to_string(),
        code: "PASSWORD_REQUIRED".to_string(),
    })
}

fn weak_password(rejection: crate::password_policy::Rejection) -> HttpResponse {
    HttpResponse::UnprocessableEntity().json(ErrorResponse {
        error: rejection.message.to_string(),
        code: rejection.code.to_string(),
    })
}

/// Check a new password and return the verifier to store for it, or the
/// response that refuses it. The password is dropped (and zeroed) here.
async fn verifier_for_new_password(
    password: String,
    login_id: &str,
    name: &str,
) -> Result<String, HttpResponse> {
    let password = zeroize::Zeroizing::new(password);
    crate::password_policy::check(&password, login_id, name)
        .await
        .map_err(weak_password)?;
    let login_id = login_id.to_string();
    // PBKDF2 (210,000 rounds) and Argon2id are deliberately slow: off the executor.
    let derived = web::block(move || {
        let proof = zeroize::Zeroizing::new(medichain_crypto::auth_proof::derive_auth_proof(
            &password, &login_id,
        ));
        medichain_crypto::password::hash_secret(&proof)
    })
    .await;
    match derived {
        Ok(Ok(verifier)) => Ok(verifier),
        Ok(Err(error)) => {
            log::error!("Credential hashing failed: {error}");
            Err(storage_error())
        }
        Err(error) => {
            log::error!("Credential hashing task failed: {error}");
            Err(storage_error())
        }
    }
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
    let body = body.into_inner();
    let Some(password) = body.password else {
        return password_required();
    };
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
    let name = account.name.clone().unwrap_or_default();
    let verifier = match verifier_for_new_password(password, &login_id, &name).await {
        Ok(value) => value,
        Err(response) => return response,
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
    let body = body.into_inner();
    if !credentials::is_valid_auth_proof(&body.current_auth_proof) {
        return credential_error();
    }
    let Some(new_password) = body.new_password else {
        return password_required();
    };
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
    let row: Option<(Option<String>, Option<String>, Option<String>)> = match sqlx::query_as(
        "SELECT credential_verifier, login_id, name FROM users WHERE id = $1 AND status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            log::error!("Current credential lookup failed: {error}");
            return storage_error();
        }
    };
    let (stored, login_id, name) = row.unwrap_or_default();
    let verifier = stored.unwrap_or_else(|| credentials::timing_equaliser().to_string());
    if !medichain_crypto::password::verify_secret(&body.current_auth_proof, &verifier) {
        return credential_error();
    }
    let Some(login_id) = login_id else {
        return credential_error();
    };
    let new_verifier =
        match verifier_for_new_password(new_password, &login_id, &name.unwrap_or_default()).await {
            Ok(value) => value,
            Err(response) => return response,
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

#[cfg(test)]
mod password_setting_tests {
    use super::*;

    /// A weak password is refused with its reason, before any network call.
    #[actix_web::test]
    async fn a_weak_password_is_refused_with_its_reason() {
        let response =
            verifier_for_new_password("Password2026!!!!".into(), "bt.nurse", "Lerato Mokoena")
                .await
                .expect_err("a common password");
        assert_eq!(
            response.status(),
            actix_web::http::StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    /// What the server stores for a password set on it accepts the proof the
    /// browser derives at sign-in, so the account can actually sign in.
    #[test]
    fn a_server_set_password_signs_in_with_the_browser_proof() {
        let password = "violet kettle moves north";
        let proof = medichain_crypto::auth_proof::derive_auth_proof(password, "Bt.Nurse ");
        let verifier = medichain_crypto::password::hash_secret(&proof).unwrap();
        let browser = medichain_crypto::auth_proof::derive_auth_proof(password, "bt.nurse");
        assert!(medichain_crypto::password::verify_secret(
            &browser, &verifier
        ));
        let wrong = medichain_crypto::auth_proof::derive_auth_proof(
            "violet kettle moves south",
            "bt.nurse",
        );
        assert!(!medichain_crypto::password::verify_secret(
            &wrong, &verifier
        ));
    }
}
