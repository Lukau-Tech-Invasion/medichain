use super::*;

// =============================================================================
// AUTH CHALLENGE ENDPOINT (SEC-005)
// =============================================================================

/// Request body for auth challenge
#[derive(Debug, Deserialize)]
pub struct AuthChallengeRequest {
    pub wallet_address: String,
}

/// Get a one-time wallet-ownership challenge to sign with your wallet.
///
/// Proves wallet ownership at a point in time (suited to a login-style
/// exchange, e.g. `/api/auth/jwt`). This is **not** sufficient on its own to
/// authenticate a specific subsequent mutating request:
/// `SignatureAuthMiddleware` requires a signature bound to that request's own
/// method, path, and body (Horizon HZ-007) — see
/// `middleware::signature_auth::generate_auth_challenge`'s doc comment.
#[post("/api/auth/challenge")]
pub async fn get_auth_challenge(body: web::Json<AuthChallengeRequest>) -> impl Responder {
    // Validate wallet address format
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid wallet address format".to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    let challenge = generate_auth_challenge(&body.wallet_address);

    log::info!(
        "Auth challenge generated for wallet {}: timestamp={}",
        body.wallet_address,
        challenge.timestamp
    );

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "challenge": challenge,
        "instructions": {
            "step1": "Sign the 'message' field with your wallet's sr25519 private key",
            "step2": "Include X-User-Id header with your wallet address",
            "step3": "Include X-Signature header with hex-encoded signature",
            "step4": "Include X-Timestamp header with the timestamp value",
            "note": format!("Challenge expires in {} seconds", challenge.expires_in_secs)
        }
    }))
}

/// Login with wallet address - validates wallet exists and returns user info
#[post("/api/auth/login")]
pub async fn wallet_login(
    data: web::Data<AppState>,
    body: web::Json<WalletLoginRequest>,
) -> impl Responder {
    // Validate wallet address format
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid wallet address format".to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    // Look up user by wallet address
    let user = match get_user(&data, &body.wallet_address) {
        Some(u) => u,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Wallet not registered. Contact admin for registration.".to_string(),
                code: "WALLET_NOT_REGISTERED".to_string(),
            });
        }
    };

    log::info!(
        "User logged in: wallet={}, name={}, role={}",
        user.wallet_address,
        user.name,
        user.role
    );

    HttpResponse::Ok().json(WalletLoginResponse {
        success: true,
        user: Some(WalletUserInfo {
            wallet_address: user.wallet_address.clone(),
            name: user.name.clone(),
            role: user.role.to_string(),
            username: user.username.clone(),
            linked_patient_id: user.linked_patient_id.clone(),
        }),
        message: "Login successful".to_string(),
    })
}

/// Login with wallet address (GET version for frontend compatibility)
#[get("/api/auth/login/{address}")]
pub async fn wallet_login_get(
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    let wallet_address = path.into_inner();

    // Validate wallet address format
    if !is_valid_wallet_address(&wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid wallet address format".to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    // Look up user by wallet address
    let user = match get_user(&data, &wallet_address) {
        Some(u) => u,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Wallet not registered. Contact admin for registration.".to_string(),
                code: "WALLET_NOT_REGISTERED".to_string(),
            });
        }
    };

    log::info!(
        "User logged in (GET): wallet={}, name={}, role={}",
        user.wallet_address,
        user.name,
        user.role
    );

    HttpResponse::Ok().json(WalletLoginResponse {
        success: true,
        user: Some(WalletUserInfo {
            wallet_address: user.wallet_address.clone(),
            name: user.name.clone(),
            role: user.role.to_string(),
            username: user.username.clone(),
            linked_patient_id: user.linked_patient_id.clone(),
        }),
        message: "Login successful".to_string(),
    })
}

/// Get all staff members (non-patient users) - paginated
/// Requires: Authenticated user with Admin role
/// Query params: ?page=1&limit=20
#[get("/api/staff/all")]
pub async fn get_all_staff(
    data: web::Data<AppState>,
    req: HttpRequest,
    query: web::Query<PaginationQuery>,
) -> impl Responder {
    // Get current user from header
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    // Check if current user is admin
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

    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can view all staff".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let users = data.users.read().unwrap();

    let staff: Vec<serde_json::Value> = users
        .values()
        .filter(|u| u.role != Role::Patient)
        .map(|u| {
            serde_json::json!({
                "wallet_address": u.wallet_address,
                "name": u.name,
                "role": u.role.to_string(),
                "username": u.username,
                "created_at": u.created_at,
            })
        })
        .collect();

    let (paginated_staff, pagination) = paginate(&staff, query.page, query.limit);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "staff": paginated_staff,
        "count": pagination.total_items,
        "pagination": pagination,
    }))
}

/// Get list of healthcare providers (doctors, nurses, etc.) for selection
/// Requires: Any authenticated healthcare worker
/// Query params: ?role=Doctor (optional filter by role)
#[get("/api/providers")]
pub async fn get_providers(
    data: web::Data<AppState>,
    req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    // Get current user from header
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    // Check if current user is a healthcare worker
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

    // Any healthcare worker can view providers list
    if !current_user.role.is_healthcare_provider() && !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare workers can view provider list".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let users = data.users.read().unwrap();
    let role_filter = query.get("role").map(|s| s.as_str());

    let providers: Vec<serde_json::Value> = users
        .values()
        .filter(|u| {
            // Filter to only healthcare providers (not patients)
            let is_provider = matches!(
                u.role,
                Role::Doctor | Role::Nurse | Role::LabTechnician | Role::Pharmacist | Role::Admin
            );

            // Apply role filter if specified
            if let Some(filter) = role_filter {
                is_provider && u.role.to_string().to_lowercase() == filter.to_lowercase()
            } else {
                is_provider
            }
        })
        .map(|u| {
            serde_json::json!({
                "wallet_address": u.wallet_address,
                "name": u.name,
                "role": u.role.to_string(),
                "username": u.username,
                "specialty": u.specialty,
            })
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "providers": providers,
        "count": providers.len(),
    }))
}

/// Lookup wallet address - returns user info if wallet is registered
/// Used by frontend to validate wallet before setting up session
#[get("/api/auth/wallet/{address}")]
pub async fn wallet_lookup(data: web::Data<AppState>, path: web::Path<String>) -> impl Responder {
    let wallet_address = path.into_inner();

    // Validate wallet address format
    if !is_valid_wallet_address(&wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid wallet address format".to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    // Look up user by wallet address
    let user = match get_user(&data, &wallet_address) {
        Some(u) => u,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Wallet not registered".to_string(),
                code: "WALLET_NOT_REGISTERED".to_string(),
            });
        }
    };

    // Return user info in format expected by frontend
    HttpResponse::Ok().json(serde_json::json!({
        "address": user.wallet_address,
        "name": user.name,
        "role": user.role.to_string(),
        "username": user.username,
        "linked_patient_id": user.linked_patient_id,
    }))
}

/// Get current user info from wallet address
#[get("/api/auth/me")]
pub async fn get_current_user_info(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    let wallet_address = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let user = match get_user(&data, &wallet_address) {
        Some(u) => u,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(WalletUserInfo {
        wallet_address: user.wallet_address.clone(),
        name: user.name.clone(),
        role: user.role.to_string(),
        username: user.username.clone(),
        linked_patient_id: user.linked_patient_id.clone(),
    })
}

/// Get user with full profile by wallet address (Admin or self only)
#[get("/api/users/{wallet_address}")]
pub async fn get_user_with_profile(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let wallet_address = path.into_inner();

    // Get current user
    let current_user_id = match get_current_user_id(&req) {
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

    // RBAC: Only admins or the user themselves can view full profile
    if current_user.role != Role::Admin && current_user_id != wallet_address {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied - can only view own profile".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get user
    let user = match get_user(&data, &wallet_address) {
        Some(u) => u,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Try to get profile data from database if db_pool is available
    let mut user_with_profile = user.clone();

    if let Some(pool) = &data.db_pool {
        // Query user profile by wallet address (join with users table to get user_id)
        let profile_result: Result<Option<crate::models::user::DbUserProfile>, _> = sqlx::query_as(
            r#"
            SELECT up.* FROM user_profiles up
            INNER JOIN users u ON up.user_id = u.id
            WHERE u.wallet_address = $1
            "#,
        )
        .bind(&wallet_address)
        .fetch_optional(pool)
        .await;

        if let Ok(Some(profile)) = profile_result {
            user_with_profile.phone = profile.phone;
            user_with_profile.department = profile.department;
            user_with_profile.specialty = profile.specialty;
            user_with_profile.license_number = profile.license_number;
        }
    }

    HttpResponse::Ok().json(user_with_profile)
}

/// List all users (Admin only) - paginated
/// Query params: ?page=1&limit=20
#[get("/api/users")]
pub async fn list_users(
    data: web::Data<AppState>,
    req: HttpRequest,
    query: web::Query<PaginationQuery>,
) -> impl Responder {
    // Get current user from header
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    // Check if current user is admin
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

    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can list users".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Collect users first, then release the lock before async operations
    let users_snapshot: Vec<User> = {
        let users = data.users.read().unwrap();
        users.values().cloned().collect()
    };

    let mut user_list: Vec<User> = Vec::new();

    // Fetch profile data for each user if database is available
    if let Some(pool) = &data.db_pool {
        for user in users_snapshot {
            let mut user_with_profile = user.clone();

            // Try to get profile data from database
            let profile_result: Result<Option<crate::models::user::DbUserProfile>, _> =
                sqlx::query_as(
                    r#"
                SELECT up.* FROM user_profiles up
                INNER JOIN users u ON up.user_id = u.id
                WHERE u.wallet_address = $1
                "#,
                )
                .bind(&user.wallet_address)
                .fetch_optional(pool)
                .await;

            if let Ok(Some(profile)) = profile_result {
                user_with_profile.phone = profile.phone;
                user_with_profile.department = profile.department;
                user_with_profile.specialty = profile.specialty;
                user_with_profile.license_number = profile.license_number;
            }

            user_list.push(user_with_profile);
        }
    } else {
        // No database, just return users as-is
        user_list = users_snapshot;
    }

    let (paginated_users, pagination) = paginate(&user_list, query.page, query.limit);

    HttpResponse::Ok().json(PaginatedResponse {
        data: paginated_users,
        pagination,
    })
}

/// Get a single user by wallet address with full profile (Admin only)
#[get("/api/users/{wallet_address}")]
pub async fn get_user_details(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let wallet_address = path.into_inner();

    // Get current user from header
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    // Check if current user is admin or the same user
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

    // Allow admin to view any user, or users to view themselves
    if !current_user.role.is_admin() && current_user_id != wallet_address {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can view other user details".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get the requested user
    let user = match get_user(&data, &wallet_address) {
        Some(u) => u,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Return user with all profile fields
    HttpResponse::Ok().json(serde_json::json!({
        "wallet_address": user.wallet_address,
        "username": user.username,
        "name": user.name,
        "role": user.role.to_string(),
        "created_at": user.created_at,
        "created_by": user.created_by,
        "linked_patient_id": user.linked_patient_id,
        "email": user.email,
        "phone": user.phone,
        "department": user.department,
        "specialty": user.specialty,
        "license_number": user.license_number,
        "status": user.status,
        "last_login": user.last_login,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateUserProfileRequest {
    pub email: Option<String>,
    pub phone: Option<String>,
    pub department: Option<String>,
    pub specialty: Option<String>,
    pub license_number: Option<String>,
    pub status: Option<String>,
    pub name: Option<String>,
}

fn apply_profile_update(
    mut user: User,
    body: &UpdateUserProfileRequest,
) -> Result<User, (&'static str, &'static str)> {
    if body.phone.is_some() {
        return Err((
            "PHONE_UPDATE_UNAVAILABLE",
            "Phone updates are disabled until encrypted profile storage is available",
        ));
    }
    if let Some(email) = &body.email {
        if email.len() > 254 || !email.contains('@') {
            return Err(("INVALID_EMAIL", "A valid email address is required"));
        }
        user.email = Some(email.trim().to_string());
    }
    if let Some(value) = &body.department {
        user.department = Some(value.trim().to_string());
    }
    if let Some(value) = &body.specialty {
        user.specialty = Some(value.trim().to_string());
    }
    if let Some(value) = &body.license_number {
        user.license_number = Some(value.trim().to_string());
    }
    if let Some(value) = &body.name {
        if value.trim().is_empty() || value.len() > 200 {
            return Err(("INVALID_NAME", "Name must be between 1 and 200 characters"));
        }
        user.name = value.trim().to_string();
    }
    if let Some(value) = &body.status {
        if !crate::state::USER_STATUSES.contains(&value.as_str()) {
            return Err(("INVALID_STATUS", "Unsupported user account status"));
        }
        user.status = value.clone();
    }
    Ok(user)
}

/// Update user profile (Admin or self). Status changes are admin-only and
/// require the same MFA step-up as role changes.
#[put("/api/users/{wallet_address}")]
pub async fn update_user_profile(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<UpdateUserProfileRequest>,
) -> impl Responder {
    let wallet_address = path.into_inner();

    // Get current user from header
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    // Check if current user is admin or the same user
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

    // Allow admin to update any user, or users to update themselves
    if !current_user.role.is_admin() && current_user_id != wallet_address {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can update other user profiles".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    if body.status.is_some() && !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can change account status".to_string(),
            code: "STATUS_CHANGE_FORBIDDEN".to_string(),
        });
    }
    if body.status.is_some() {
        if let Some(response) = require_privileged_assurance(&data, &req) {
            return response;
        }
    }

    let existing = match data
        .users
        .read()
        .ok()
        .and_then(|users| users.get(&wallet_address).cloned())
    {
        Some(user) => user,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    let updated_user = match apply_profile_update(existing, &body) {
        Ok(user) => user,
        Err((code, message)) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: message.to_string(),
                code: code.to_string(),
            })
        }
    };

    if let Err(e) = data.persist_then_cache_user(updated_user).await {
        log::error!(
            "Failed to persist profile update for {}: {}",
            wallet_address,
            e
        );
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Profile update could not be persisted".to_string(),
            code: "USER_PERSISTENCE_UNAVAILABLE".to_string(),
        });
    }

    log::info!(
        "User profile updated: {} by {}",
        wallet_address,
        current_user_id
    );

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "wallet_address": wallet_address,
        "message": "User profile updated successfully"
    }))
}

/// Get patient's own records (Patient role)
#[get("/api/my-records")]
pub async fn get_my_records(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    // Get current user from header
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    // Get current user
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

    // Find patient record via repository (was: in-memory data.patients HashMap)
    // For patients, they can only see their own records
    // For healthcare providers, they can see all records
    if current_user.role == Role::Patient {
        // Try to find by linked_patient_id first, then by wallet_address
        let patient_id = current_user
            .linked_patient_id
            .as_ref()
            .unwrap_or(&current_user.wallet_address);

        match data.repositories.patients.get_by_id(patient_id).await {
            Ok(entity) => match patient_entity_to_profile(&entity, &data.encryption_keyring) {
                Some(profile) => HttpResponse::Ok().json(profile),
                None => HttpResponse::NotFound().json(ErrorResponse {
                    success: false,
                    error: "No medical records found for your account".to_string(),
                    code: "RECORD_NOT_FOUND".to_string(),
                }),
            },
            Err(_) => HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "No medical records found for your account".to_string(),
                code: "RECORD_NOT_FOUND".to_string(),
            }),
        }
    } else {
        // Healthcare providers can see all (capped at one page, like other lists)
        let entities = data
            .repositories
            .patients
            .list(crate::repositories::Pagination::new(0, 100))
            .await
            .map(|r| r.items)
            .unwrap_or_default();
        let all: Vec<PatientProfile> = entities
            .iter()
            .filter_map(|e| patient_entity_to_profile(e, &data.encryption_keyring))
            .collect();
        HttpResponse::Ok().json(all)
    }
}

const MAX_SETTINGS_BYTES: usize = 64 * 1024;

fn settings_storage_error(operation: &str) -> HttpResponse {
    log::error!("User settings storage failed during {operation}");
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        success: false,
        error: "Settings storage is temporarily unavailable".to_string(),
        code: "STORAGE_UNAVAILABLE".to_string(),
    })
}

async fn load_settings(
    data: &web::Data<AppState>,
    wallet_address: &str,
) -> Result<serde_json::Value, HttpResponse> {
    if let Some(pool) = &data.db_pool {
        let result = sqlx::query_scalar::<_, serde_json::Value>(
            r#"
            SELECT COALESCE(up.preferences, '{}'::jsonb)
            FROM user_profiles up
            INNER JOIN users u ON u.id = up.user_id
            WHERE u.wallet_address = $1
            "#,
        )
        .bind(wallet_address)
        .fetch_optional(pool)
        .await
        .map_err(|_| settings_storage_error("read"))?;
        return Ok(result.unwrap_or_else(|| serde_json::json!({})));
    }

    // Non-PostgreSQL deployments read through the repository rather than a
    // process-memory `AppState` map, so this path has the same durability
    // story as every other store instead of being the one exception.
    let record = data
        .repositories
        .user_setting_records
        .get_by_id(wallet_address)
        .await
        .map_err(|_| settings_storage_error("read"))?;
    Ok(record
        .map(|record| record.data)
        .unwrap_or_else(|| serde_json::json!({})))
}

async fn persist_settings(
    data: &web::Data<AppState>,
    wallet_address: &str,
    settings: serde_json::Value,
) -> Result<(), HttpResponse> {
    if let Some(pool) = &data.db_pool {
        let result = sqlx::query(
            r#"
            INSERT INTO user_profiles (user_id, preferences)
            SELECT id, $2 FROM users WHERE wallet_address = $1
            ON CONFLICT (user_id) DO UPDATE SET
                preferences = EXCLUDED.preferences,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(wallet_address)
        .bind(settings)
        .execute(pool)
        .await
        .map_err(|_| settings_storage_error("write"))?;
        if result.rows_affected() != 1 {
            return Err(settings_storage_error("account lookup"));
        }
        return Ok(());
    }

    let now = chrono::Utc::now();
    let record = crate::repositories::traits::JsonRecordEntity {
        id: wallet_address.to_string(),
        owner_id: wallet_address.to_string(),
        data: settings,
        created_at: now,
        updated_at: now,
    };
    data.repositories
        .user_setting_records
        .create(record)
        .await
        .map_err(|_| settings_storage_error("write"))?;
    Ok(())
}

/// Load user settings (notifications, security, display preferences).
#[get("/api/settings")]
pub async fn get_settings(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let user = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    match load_settings(&data, &user.wallet_address).await {
        Ok(settings) => HttpResponse::Ok().json(settings),
        Err(response) => response,
    }
}

/// Save user settings (notifications, security, display preferences).
#[post("/api/settings")]
pub async fn save_settings(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<serde_json::Value>,
) -> impl Responder {
    let user = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let settings = req.into_inner();
    let encoded_size = serde_json::to_vec(&settings).map(|value| value.len());
    if !settings.is_object()
        || encoded_size.is_err()
        || encoded_size.unwrap_or(0) > MAX_SETTINGS_BYTES
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Settings must be a JSON object no larger than 64 KiB".to_string(),
            code: "INVALID_SETTINGS".to_string(),
        });
    }
    if let Err(response) = persist_settings(&data, &user.wallet_address, settings).await {
        return response;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Settings saved successfully",
        "user_id": user.wallet_address,
    }))
}
