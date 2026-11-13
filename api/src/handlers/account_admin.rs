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
    pub phone: Option<String>,
    pub department: Option<String>,
    pub specialty: Option<String>,
    pub license_number: Option<String>,
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
        Err(CreateError::LoginIdTaken) => login_id_taken(),
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
    if body
        .phone
        .as_ref()
        .is_some_and(|v| v.trim().chars().count() > 32)
        || body
            .department
            .as_ref()
            .is_some_and(|v| v.trim().chars().count() > 100)
        || body
            .specialty
            .as_ref()
            .is_some_and(|v| v.trim().chars().count() > 100)
        || body
            .license_number
            .as_ref()
            .is_some_and(|v| v.trim().chars().count() > 50)
    {
        return HttpResponse::BadRequest().finish();
    }
    let account = new_staff_user(&body, role.clone(), &admin.id);
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
        Err(CreateError::LoginIdTaken) => login_id_taken(),
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

/// Copy the registration profile into the account committed with its grant.
fn new_staff_user(body: &RegisterStaffRequest, role: Role, admin_id: &str) -> User {
    let mut user = new_user(
        body.name.trim(),
        role,
        "pending",
        Some(admin_id.to_string()),
        body.email.clone(),
    );
    user.phone = body
        .phone
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    user.department = body.department.as_ref().map(|v| v.trim().to_string());
    user.specialty = body.specialty.as_ref().map(|v| v.trim().to_string());
    user.license_number = body.license_number.as_ref().map(|v| v.trim().to_string());
    user
}

#[derive(Debug)]
enum CreateError {
    AlreadyBootstrapped,
    /// Another account already holds this login ID (case-insensitive).
    LoginIdTaken,
    Failed(String),
}

/// A unique-key violation on the login ID: a conflict to report, not an outage.
fn insert_user_error(error: sqlx::Error) -> CreateError {
    let taken = error
        .as_database_error()
        .and_then(|db| db.constraint())
        .is_some_and(|name| name.starts_with("users_login_id"));
    if taken {
        CreateError::LoginIdTaken
    } else {
        CreateError::Failed(error.to_string())
    }
}

fn login_id_taken() -> HttpResponse {
    HttpResponse::Conflict().json(ErrorResponse {
        error: "That employee ID or username is already in use".to_string(),
        code: "LOGIN_ID_TAKEN".to_string(),
    })
}

/// A bootstrap is allowed only before any non-system account exists.
async fn has_bootstrap_blocker(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM users WHERE id <> $1)")
        .bind(crate::actor_directory::SYSTEM_USER_ID)
        .fetch_one(&mut **tx)
        .await
}

/// Commit a minimal account-creation audit record with the new user and grant.
async fn insert_provisioning_audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user: &User,
    bootstrap: bool,
) -> Result<(), CreateError> {
    let event_type = if bootstrap {
        "account.bootstrap_provisioned"
    } else {
        "account.staff_provisioned"
    };
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        event_type.to_string(),
        "user".to_string(),
        user.id.clone(),
        serde_json::json!({ "role": user.role.to_string() }),
        Utc::now(),
    )
    .map_err(|error| CreateError::Failed(error.to_string()))?;
    crate::audit_outbox::insert_event(&mut **tx, &event)
        .await
        .map_err(|error| CreateError::Failed(error.to_string()))
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
        let exists = has_bootstrap_blocker(&mut tx)
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
    .map_err(insert_user_error)?;
    data.persist_user_profile_in(&mut tx, user_id, user)
        .await
        .map_err(CreateError::Failed)?;
    let grant = credentials::issue_in(&mut tx, user_id, GrantPurpose::Activation, issuer)
        .await
        .map_err(|e| CreateError::Failed(format!("{e:?}")))?;
    insert_provisioning_audit(&mut tx, user, bootstrap).await?;
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

#[cfg(all(test, feature = "postgres"))]
mod bootstrap_tests {
    use super::*;

    /// The portal's registration fields must survive request decoding and mapping.
    #[test]
    fn staff_registration_keeps_professional_and_contact_fields() {
        let request: RegisterStaffRequest = serde_json::from_value(serde_json::json!({
            "name": "Nurse Example", "role": "Nurse", "login_id": "nurse.example",
            "email": "nurse@example.invalid", "phone": "+27 11 555 0199",
            "department": "Emergency", "specialty": "Trauma", "license_number": "LIC-1"
        }))
        .unwrap();
        let user = new_staff_user(&request, Role::Nurse, "admin-id");
        assert_eq!(user.phone.as_deref(), Some("+27 11 555 0199"));
        assert_eq!(user.department.as_deref(), Some("Emergency"));
        assert_eq!(user.specialty.as_deref(), Some("Trauma"));
        assert_eq!(user.license_number.as_deref(), Some("LIC-1"));
    }

    /// An account event is durable in the transaction and carries no name/code.
    #[actix_web::test]
    async fn provisioning_audit_contains_only_role_and_account_id() {
        let url = crate::repositories::postgres::tests::test_database_url();
        let pool = sqlx::PgPool::connect(&url)
            .await
            .expect("PostgreSQL test pool");
        let mut tx = pool.begin().await.expect("test transaction");
        sqlx::query("SET LOCAL search_path = pg_temp, public")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("CREATE TEMP TABLE audit_events (id TEXT, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT, payload_hash TEXT, payload JSONB, occurred_at TIMESTAMPTZ) ON COMMIT DROP")
            .execute(&mut *tx)
            .await
            .unwrap();
        let account = new_user("Private Name", Role::Admin, "active", None, None);
        insert_provisioning_audit(&mut tx, &account, true)
            .await
            .unwrap();
        let row: (String, String, serde_json::Value) =
            sqlx::query_as("SELECT event_type, aggregate_id, payload FROM audit_events")
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert_eq!(row.0, "account.bootstrap_provisioned");
        assert_eq!(row.1, account.id);
        assert_eq!(row.2, serde_json::json!({ "role": "Admin" }));
        tx.rollback().await.unwrap();
    }

    /// Check the exact post-cleanup guard with a session-local user table.
    #[actix_web::test]
    async fn any_non_system_account_blocks_bootstrap() {
        let url = crate::repositories::postgres::tests::test_database_url();
        let pool = sqlx::PgPool::connect(&url)
            .await
            .expect("PostgreSQL test pool");
        let mut tx = pool.begin().await.expect("test transaction");
        sqlx::query("SET LOCAL search_path = pg_temp, public")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("CREATE TEMP TABLE users (id UUID PRIMARY KEY) ON COMMIT DROP")
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(!has_bootstrap_blocker(&mut tx).await.unwrap());

        sqlx::query("INSERT INTO users (id) VALUES ($1)")
            .bind(crate::actor_directory::SYSTEM_USER_ID)
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(!has_bootstrap_blocker(&mut tx).await.unwrap());

        sqlx::query("INSERT INTO users (id) VALUES ($1)")
            .bind(Uuid::from_u128(2))
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(has_bootstrap_blocker(&mut tx).await.unwrap());
        tx.rollback().await.unwrap();
    }

    /// A login ID already in use is a conflict, not "temporarily unavailable":
    /// retrying it can never succeed.
    #[actix_web::test]
    async fn a_taken_login_id_is_reported_as_taken() {
        let url = crate::repositories::postgres::tests::test_database_url();
        let pool = sqlx::PgPool::connect(&url)
            .await
            .expect("PostgreSQL test pool");
        let mut tx = pool.begin().await.expect("test transaction");
        sqlx::query("SET LOCAL search_path = pg_temp, public")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("CREATE TEMP TABLE users (login_id TEXT) ON COMMIT DROP")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("CREATE UNIQUE INDEX users_login_id_lower_key ON users (lower(login_id))")
            .execute(&mut *tx)
            .await
            .unwrap();
        let insert = "INSERT INTO users (login_id) VALUES ($1)";
        sqlx::query(insert)
            .bind("bt.doctor")
            .execute(&mut *tx)
            .await
            .unwrap();
        let error = sqlx::query(insert)
            .bind("BT.Doctor")
            .execute(&mut *tx)
            .await
            .expect_err("a second account with the same login ID");
        assert!(matches!(
            insert_user_error(error),
            CreateError::LoginIdTaken
        ));
        tx.rollback().await.unwrap();
    }
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

/// Replace an unspent patient activation code for the registering clinician or an administrator.
#[post("/api/patients/{patient_id}/activation-code")]
pub async fn reissue_patient_activation_code(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> HttpResponse {
    let actor = match require_registered_caller(&data, &req) {
        Ok(user) if matches!(user.role, Role::Admin | Role::Doctor | Role::Nurse) => user,
        Ok(_) => return HttpResponse::Forbidden().finish(),
        Err(response) => return response,
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return provisioning_error();
    };
    let Ok(mut tx) = pool.begin().await else {
        return provisioning_error();
    };
    let account: Option<(Uuid, Option<String>, Option<String>)> = match sqlx::query_as(
        "SELECT id, created_by, credential_verifier FROM users
         WHERE role = 'Patient' AND linked_patient_id = $1 FOR UPDATE",
    )
    .bind(path.as_str())
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(error) => {
            log::error!("Patient activation account lookup failed: {error}");
            return provisioning_error();
        }
    };
    let Some((user_id, created_by, verifier)) = account else {
        return HttpResponse::NotFound().finish();
    };
    if !actor.role.is_admin() && created_by.as_deref() != Some(actor.id.as_str()) {
        return HttpResponse::Forbidden().finish();
    }
    if verifier.is_some() {
        return HttpResponse::Conflict().json(ErrorResponse {
            error: "This patient account is already active".to_string(),
            code: "ALREADY_ACTIVATED".to_string(),
        });
    }
    let issuer = crate::actor_directory::parse_user_id(&actor.id);
    let grant =
        match credentials::issue_in(&mut tx, user_id, GrantPurpose::Activation, issuer).await {
            Ok(grant) => grant,
            Err(error) => {
                log::error!("Patient activation reissue failed: {error:?}");
                return provisioning_error();
            }
        };
    if let Err(error) = tx.commit().await {
        log::error!("Patient activation reissue commit failed: {error}");
        return provisioning_error();
    }
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "activation_code": grant.code,
        "activation_expires_at": grant.expires_at,
    }))
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
    match sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)")
        .bind(user_id)
        .fetch_one(pool)
        .await
    {
        Ok(true) => {}
        Ok(false) => return HttpResponse::NotFound().finish(),
        Err(error) => {
            log::error!("MFA reset account lookup failed: {error}");
            return provisioning_error();
        }
    }
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
