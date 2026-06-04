use super::*;

// =============================================================================
// AUTH CHALLENGE ENDPOINT (SEC-005)
// =============================================================================

/// Request body for auth challenge
#[derive(Debug, Deserialize)]
pub struct AuthChallengeRequest {
    pub wallet_address: String,
}

/// Get an authentication challenge to sign with your wallet
///
/// This endpoint returns a message that must be signed by the wallet's private key
/// to prove ownership. The signature should be sent in subsequent requests via:
/// - X-User-Id: wallet_address
/// - X-Signature: hex-encoded sr25519 signature
/// - X-Timestamp: the timestamp from this challenge
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

/// Update user profile (Admin or self)
#[put("/api/users/{wallet_address}")]
pub async fn update_user_profile(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
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

    // Get the user to update
    let mut users = data.users.write().unwrap();
    let user = match users.get_mut(&wallet_address) {
        Some(u) => u,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Update fields from body
    if let Some(email) = body.get("email").and_then(|v| v.as_str()) {
        user.email = Some(email.to_string());
    }
    if let Some(phone) = body.get("phone").and_then(|v| v.as_str()) {
        user.phone = Some(phone.to_string());
    }
    if let Some(department) = body.get("department").and_then(|v| v.as_str()) {
        user.department = Some(department.to_string());
    }
    if let Some(specialty) = body.get("specialty").and_then(|v| v.as_str()) {
        user.specialty = Some(specialty.to_string());
    }
    if let Some(license_number) = body.get("license_number").and_then(|v| v.as_str()) {
        user.license_number = Some(license_number.to_string());
    }
    if let Some(status) = body.get("status").and_then(|v| v.as_str()) {
        user.status = status.to_string();
    }
    if let Some(name) = body.get("name").and_then(|v| v.as_str()) {
        user.name = name.to_string();
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
            Ok(entity) => match patient_entity_to_profile(&entity, &data.encryption_key) {
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
            .filter_map(|e| patient_entity_to_profile(e, &data.encryption_key))
            .collect();
        HttpResponse::Ok().json(all)
    }
}

/// Save user settings (notifications, security, display preferences)
/// Requires: Authenticated user
#[post("/api/settings")]
pub async fn save_settings(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<serde_json::Value>,
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

    // Verify user exists
    match get_user(&data, &current_user_id) {
        Some(_) => {}
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Store settings in memory (in production, this would go to a database)
    // For now, we just acknowledge receipt
    log::info!("Settings saved for user {}: {:?}", current_user_id, req);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Settings saved successfully",
        "user_id": current_user_id,
    }))
}
