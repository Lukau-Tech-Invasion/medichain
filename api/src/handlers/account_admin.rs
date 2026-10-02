//! Account creation and recovery for password-based identities.

use super::*;
use crate::credentials::{self, GrantPurpose, IssueError};

#[derive(Debug, Deserialize)]
pub struct BootstrapRequest {
    pub name: String,
    pub login_id: String,
    pub secret_key: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterStaffRequest {
    pub name: String,
    pub role: String,
    pub login_id: String,
    pub email: Option<String>,
}

fn provisioning_error() -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        error: "Account provisioning is temporarily unavailable".to_string(),
        code: "ACCOUNT_PROVISIONING_UNAVAILABLE".to_string(),
    })
}

fn grant_response(grant: credentials::IssuedGrant) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "credential_code": grant.code,
        "expires_at": grant.expires_at,
    }))
}

fn valid_name(name: &str) -> bool {
    (2..=120).contains(&name.trim().chars().count())
}

/// Provision the first administrator using an operator-supplied secret.
#[post("/api/auth/bootstrap")]
pub async fn bootstrap_account(
    data: web::Data<AppState>,
    body: web::Json<BootstrapRequest>,
) -> HttpResponse {
    let Ok(expected) = std::env::var("MEDICHAIN_BOOTSTRAP_KEY") else {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Bootstrap is not configured".to_string(),
            code: "BOOTSTRAP_DISABLED".to_string(),
        });
    };
    if expected.len() < 32
        || !medichain_crypto::constant_time_eq(expected.as_bytes(), body.secret_key.as_bytes())
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Bootstrap is not authorised".to_string(),
            code: "BOOTSTRAP_REFUSED".to_string(),
        });
    }
    let Some(login_id) = credentials::validate_login_id(&body.login_id) else {
        return invalid_login_id();
    };
    if !valid_name(&body.name) {
        return invalid_name();
    }
    let Some(pool) = data.db_pool.as_ref() else {
        return provisioning_error();
    };
    let account = new_user(body.name.trim(), Role::Admin, "active", None, None);
    match create_account_with_grant(pool, &data, &account, &login_id, None, true).await {
        Ok(grant) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "user_id": account.id,
            "login_id": login_id,
            "credential_code": grant.code,
            "credential_expires_at": grant.expires_at,
        })),
        Err(CreateError::AlreadyBootstrapped) => HttpResponse::Conflict().json(ErrorResponse {
            error: "An administrator already exists".to_string(),
            code: "BOOTSTRAP_NOT_ALLOWED".to_string(),
        }),
        Err(CreateError::Failed(error)) => {
            log::error!("Bootstrap account write failed: {error}");
            provisioning_error()
        }
    }
}

/// Create a pending staff account and display its one-time code once.
#[post("/api/auth/register")]
pub async fn register_staff_account(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<RegisterStaffRequest>,
) -> HttpResponse {
    let admin = match require_registered_caller(&data, &req) {
        Ok(user) if user.role.is_admin() => user,
        Ok(_) => return HttpResponse::Forbidden().finish(),
        Err(response) => return response,
    };
    if let Some(response) = super::auth_jwt::require_privileged_assurance(&data, &req) {
        return response;
    }
    let Some(login_id) = credentials::validate_login_id(&body.login_id) else {
        return invalid_login_id();
    };
    if !valid_name(&body.name) {
        return invalid_name();
    }
    let Ok(role) = parse_role(&body.role) else {
        return HttpResponse::BadRequest().finish();
    };
    if role.is_admin() || role == Role::Patient {
        return HttpResponse::Forbidden().finish();
    }
    let Some(pool) = data.db_pool.as_ref() else {
        return provisioning_error();
    };
    let account = new_user(
        body.name.trim(),
        role.clone(),
        "pending",
        Some(admin.id.clone()),
        body.email.clone(),
    );
    let issuer = crate::actor_directory::parse_user_id(&admin.id);
    match create_account_with_grant(pool, &data, &account, &login_id, issuer, false).await {
        Ok(grant) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "user_id": account.id,
            "role": role.to_string(),
            "status": "pending",
            "activation_required": true,
            "credential_code": grant.code,
            "credential_expires_at": grant.expires_at,
        })),
        Err(error) => {
            log::error!("Staff account write failed: {error:?}");
            provisioning_error()
        }
    }
}

fn invalid_login_id() -> HttpResponse {
    HttpResponse::BadRequest().json(ErrorResponse {
        error: "The employee ID or username is invalid".to_string(),
        code: "INVALID_LOGIN_ID".to_string(),
    })
}

fn invalid_name() -> HttpResponse {
    HttpResponse::BadRequest().json(ErrorResponse {
        error: "Enter the person's name".to_string(),
        code: "INVALID_NAME".to_string(),
    })
}

fn new_user(
    name: &str,
    role: Role,
    status: &str,
    created_by: Option<String>,
    email: Option<String>,
) -> User {
    User {
        id: Uuid::new_v4().to_string(),
        username: None,
        name: name.to_string(),
        role,
        created_at: Utc::now(),
        created_by,
        linked_patient_id: None,
        email,
        phone: None,
        department: None,
        specialty: None,
        license_number: None,
        status: status.to_string(),
        last_login: None,
    }
}

#[derive(Debug)]
enum CreateError {
    AlreadyBootstrapped,
    Failed(String),
}

/// Keep the account and its one-time code in one durable transaction. The
/// bootstrap advisory lock serializes the first-account check across replicas.
async fn create_account_with_grant(
    pool: &sqlx::PgPool,
    data: &web::Data<AppState>,
    user: &User,
    login_id: &str,
    issuer: Option<Uuid>,
    bootstrap: bool,
) -> Result<credentials::IssuedGrant, CreateError> {
    let user_id = crate::actor_directory::parse_user_id(&user.id)
        .ok_or_else(|| CreateError::Failed("Invalid account ID".to_string()))?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| CreateError::Failed(e.to_string()))?;
    if bootstrap {
        sqlx::query("SELECT pg_advisory_xact_lock(481027009214)")
            .execute(&mut *tx)
            .await
            .map_err(|e| CreateError::Failed(e.to_string()))?;
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id <> $1)")
            .bind(crate::actor_directory::SYSTEM_USER_ID)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| CreateError::Failed(e.to_string()))?;
        if exists {
            return Err(CreateError::AlreadyBootstrapped);
        }
    }
    sqlx::query(
        "INSERT INTO users
         (id, role, name, email, created_by, is_active, status, login_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(user_id)
    .bind(user.role.to_string())
    .bind(&user.name)
    .bind(&user.email)
    .bind(&user.created_by)
    .bind(user.status == "active")
    .bind(&user.status)
    .bind(login_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| CreateError::Failed(e.to_string()))?;
    let grant = credentials::issue_in(&mut tx, user_id, GrantPurpose::Activation, issuer)
        .await
        .map_err(|e| CreateError::Failed(format!("{e:?}")))?;
    tx.commit()
        .await
        .map_err(|e| CreateError::Failed(e.to_string()))?;
    if user.status == "active" {
        data.users
            .write()
            .map_err(|_| CreateError::Failed("User cache unavailable".to_string()))?
            .insert(user.id.clone(), user.clone());
    }
    Ok(grant)
}

fn authorized_admin(data: &web::Data<AppState>, req: &HttpRequest) -> Result<User, HttpResponse> {
    let admin = require_registered_caller(data, req)?;
    if !admin.role.is_admin() {
        return Err(HttpResponse::Forbidden().finish());
    }
    if let Some(response) = super::auth_jwt::require_privileged_assurance(data, req) {
        return Err(response);
    }
    Ok(admin)
}

/// End an account's sessions and issue a one-time password reset code.
#[post("/api/admin/users/{user_id}/credential-reset")]
pub async fn reset_user_credential(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> HttpResponse {
    let admin = match authorized_admin(&data, &req) {
        Ok(admin) => admin,
        Err(response) => return response,
    };
    let (Some(pool), Some(target), Some(issuer)) = (
        data.db_pool.as_ref(),
        crate::actor_directory::parse_user_id(&path),
        crate::actor_directory::parse_user_id(&admin.id),
    ) else {
        return provisioning_error();
    };
    match credentials::reset_credential(pool, target, issuer).await {
        Ok(Some(grant)) => grant_response(grant),
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(IssueError::Database(error)) => {
            log::error!("Credential reset failed: {error}");
            provisioning_error()
        }
        Err(IssueError::Randomness) => provisioning_error(),
    }
}

/// Remove a lost authenticator and revoke sessions before re-enrollment.
#[post("/api/admin/users/{user_id}/mfa-reset")]
pub async fn reset_user_mfa(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> HttpResponse {
    if let Err(response) = authorized_admin(&data, &req) {
        return response;
    }
    let Some(pool) = data.db_pool.as_ref() else {
        return provisioning_error();
    };
    let Some(user_id) = crate::actor_directory::parse_user_id(&path) else {
        return HttpResponse::NotFound().finish();
    };
    if let Err(error) = data.delete_mfa_enrollment(&user_id.to_string()).await {
        log::error!("MFA reset failed: {error}");
        return provisioning_error();
    }
    if let Err(error) =
        crate::auth_sessions::revoke_all_for_user(pool, &user_id.to_string(), "mfa_reset").await
    {
        log::error!("MFA reset could not revoke sessions: {error}");
        return provisioning_error();
    }
    if let Ok(mut records) = data.security.mfa.write() {
        records.remove(&user_id.to_string());
    } else {
        return provisioning_error();
    }
    HttpResponse::Ok().json(serde_json::json!({ "success": true }))
}
