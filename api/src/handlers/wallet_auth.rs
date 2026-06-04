use super::*;

// ============================================================================
// Wallet Authentication Endpoints
// ============================================================================

/// Bootstrap request - for creating first admin
#[derive(Debug, Deserialize)]
pub struct BootstrapAdminRequest {
    pub wallet_address: String,
    pub name: String,
    pub username: Option<String>,
    pub secret_key: String, // Environment variable MEDICHAIN_BOOTSTRAP_KEY must match
}

/// Bootstrap response
#[derive(Debug, Serialize)]
pub struct BootstrapAdminResponse {
    pub success: bool,
    pub admin: WalletUserInfo,
    pub message: String,
}

/// Bootstrap first admin (only works when no users exist)
/// This endpoint allows the first admin to be created without authentication
/// SECURITY: Requires MEDICHAIN_BOOTSTRAP_KEY environment variable to match
/// In production, this key MUST be set via environment variable
#[post("/api/auth/bootstrap")]
pub async fn bootstrap_admin(
    data: web::Data<AppState>,
    body: web::Json<BootstrapAdminRequest>,
) -> impl Responder {
    // Check if running in demo mode
    let is_demo = std::env::var("IS_DEMO")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(true);

    // Check bootstrap key from environment
    // SECURITY: In production (non-demo), require explicit key from environment
    let bootstrap_key = match std::env::var("MEDICHAIN_BOOTSTRAP_KEY") {
        Ok(key) => key,
        Err(_) if is_demo => "medichain-dev-bootstrap-2024".to_string(),
        Err(_) => {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "MEDICHAIN_BOOTSTRAP_KEY environment variable required in production"
                    .to_string(),
                code: "MISSING_BOOTSTRAP_KEY".to_string(),
            });
        }
    };

    if body.secret_key != bootstrap_key {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Invalid bootstrap key".to_string(),
            code: "INVALID_BOOTSTRAP_KEY".to_string(),
        });
    }

    // Check if any users exist
    {
        let users = data.users.read().unwrap();
        if !users.is_empty() {
            return HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "Bootstrap not allowed - users already exist. Use /api/auth/register with admin credentials.".to_string(),
                code: "BOOTSTRAP_NOT_ALLOWED".to_string(),
            });
        }
    }

    // Validate wallet address format
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error:
                "Invalid wallet address format. Must be SS58 encoded (starts with 5, 45-50 chars)"
                    .to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    // Create first admin
    let admin = User {
        wallet_address: body.wallet_address.clone(),
        username: body.username.clone(),
        name: body.name.clone(),
        role: Role::Admin,
        created_at: Utc::now(),
        created_by: None, // Self-created
        linked_patient_id: None,
        email: None,
        phone: None,
        department: None,
        specialty: None,
        license_number: None,
        status: "active".to_string(),
        last_login: None,
    };

    data.users
        .write()
        .unwrap()
        .insert(body.wallet_address.clone(), admin.clone());

    log::info!(
        "Bootstrap: First admin created - wallet={}, name={}",
        body.wallet_address,
        body.name
    );

    HttpResponse::Created().json(BootstrapAdminResponse {
        success: true,
        admin: WalletUserInfo {
            wallet_address: body.wallet_address.clone(),
            name: body.name.clone(),
            role: "Admin".to_string(),
            username: body.username.clone(),
            linked_patient_id: None,
        },
        message: "First admin created successfully. System is now bootstrapped.".to_string(),
    })
}

/// Register a new user with wallet address (Admin only)
/// This creates a new user account linked to a blockchain wallet
#[post("/api/auth/register")]
pub async fn wallet_register(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<WalletRegisterRequest>,
) -> impl Responder {
    // Get current user (must be admin to register new users)
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
                error: "Admin user not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only admin can register new users
    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can register new users".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Validate wallet address format
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error:
                "Invalid wallet address format. Must be SS58 encoded (starts with 5, 45-50 chars)"
                    .to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    // Check if wallet already registered
    {
        let users = data.users.read().unwrap();
        if users.contains_key(&body.wallet_address) {
            return HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "Wallet address already registered".to_string(),
                code: "WALLET_ALREADY_REGISTERED".to_string(),
            });
        }
    }

    // Parse role
    let role = match parse_role(&body.role) {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: e,
                code: "INVALID_ROLE".to_string(),
            });
        }
    };

    // Cannot register Admin role
    if role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Cannot register Admin role via API".to_string(),
            code: "CANNOT_REGISTER_ADMIN".to_string(),
        });
    }

    // Create new user
    let user = User {
        wallet_address: body.wallet_address.clone(),
        username: body.username.clone(),
        name: body.name.clone(),
        role: role.clone(),
        created_at: Utc::now(),
        created_by: Some(current_user_id.clone()),
        linked_patient_id: None,
        email: None,
        phone: None,
        department: None,
        specialty: None,
        license_number: None,
        status: "pending".to_string(),
        last_login: None,
    };

    data.users
        .write()
        .unwrap()
        .insert(body.wallet_address.clone(), user.clone());

    log::info!(
        "New user registered: wallet={}, name={}, role={} by admin={}",
        body.wallet_address,
        body.name,
        role,
        current_user_id
    );

    HttpResponse::Created().json(WalletRegisterResponse {
        success: true,
        wallet_address: body.wallet_address.clone(),
        role: role.to_string(),
        message: "User registered successfully".to_string(),
    })
}

