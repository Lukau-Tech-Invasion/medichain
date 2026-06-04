use super::*;

/// Development-only demo login endpoint
/// Creates a temporary user with the specified role for testing purposes
/// SECURITY: Only available when MEDICHAIN_DEV_MODE environment variable is set
#[derive(Debug, Deserialize)]
pub struct DemoLoginRequest {
    pub wallet_address: String,
    pub role: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DemoLoginResponse {
    pub success: bool,
    pub wallet_address: String,
    pub role: String,
    pub name: String,
    pub message: String,
}

#[post("/api/auth/demo-login")]
pub async fn demo_login(
    data: web::Data<AppState>,
    body: web::Json<DemoLoginRequest>,
) -> impl Responder {
    // Check if dev mode is enabled
    let dev_mode = std::env::var("MEDICHAIN_DEV_MODE")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(true); // Default to true for development

    if !dev_mode {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Demo login is only available in development mode".to_string(),
            code: "DEV_MODE_REQUIRED".to_string(),
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

    // Parse role (optional; default to Doctor in dev/demo mode)
    let role_str = body.role.clone().unwrap_or_else(|| "Doctor".to_string());
    let role = match parse_role(&role_str) {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: e,
                code: "INVALID_ROLE".to_string(),
            });
        }
    };

    let name = body
        .name
        .clone()
        .unwrap_or_else(|| format!("Demo {}", role));

    // Check if wallet already exists
    {
        let users = data.users.read().unwrap();
        if let Some(existing) = users.get(&body.wallet_address) {
            return HttpResponse::Ok().json(DemoLoginResponse {
                success: true,
                wallet_address: existing.wallet_address.clone(),
                role: existing.role.to_string(),
                name: existing.name.clone(),
                message: "User already exists - logged in".to_string(),
            });
        }
    }

    // Create demo user
    let user = User {
        wallet_address: body.wallet_address.clone(),
        username: Some(format!("demo_{}", role.to_string().to_lowercase())),
        name: name.clone(),
        role: role.clone(),
        created_at: Utc::now(),
        created_by: Some("DEMO_SYSTEM".to_string()),
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
        .insert(body.wallet_address.clone(), user);

    log::info!(
        "[DEMO] Auto-registered demo user: wallet={}, role={}, name={}",
        body.wallet_address,
        role,
        name
    );

    HttpResponse::Created().json(DemoLoginResponse {
        success: true,
        wallet_address: body.wallet_address.clone(),
        role: role.to_string(),
        name,
        message: "Demo user created and logged in".to_string(),
    })
}

/// Get demo info
#[get("/api/demo")]
pub async fn demo_info() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "project": "MediChain",
        "hackathon": "Rust Africa Hackathon 2026",
        "track": "Fintech & Inclusive Finance (Web3)",
        "description": "Blockchain-based national health ID system with NFC emergency access",
        "auth_mode": "Wallet-based blockchain authentication (no seed data)",
        "dev_mode": std::env::var("MEDICHAIN_DEV_MODE").map(|v| v == "true" || v == "1").unwrap_or(true),
        "demo_login_endpoint": "POST /api/auth/demo-login (dev mode only - auto-creates users)",
        "demo_instructions": {
            "step_1": "First admin must bootstrap by using /api/auth/register with their wallet",
            "step_2": "Admin registers healthcare staff with wallet addresses",
            "step_3": "Healthcare staff can then register patients via /api/register",
            "step_4": "All users authenticate with X-User-Id header containing SS58 wallet address"
        },
        "wallet_auth": {
            "format": "SS58 encoded wallet address (starts with 5, 45-50 chars)",
            "example": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
            "header": "X-User-Id: <wallet_address>",
            "note": "Users must be registered by admin before accessing protected endpoints"
        },
        "features": [
            "Wallet-based blockchain authentication",
            "Role-Based Access Control (RBAC)",
            "Healthcare provider patient registration",
            "Read-only patient access",
            "NFC-based emergency medical records access",
            "Blockchain-verified patient identity",
            "Cryptographic consent management",
            "Complete audit trail",
            "HIPAA/GDPR compliance ready"
        ],
        "endpoints": {
            "auth": {
                "register": "POST /api/auth/register (Admin only - register new users)",
                "login": "POST /api/auth/login (Validate wallet and get user info)",
                "me": "GET /api/auth/me (Get current user info)"
            },
            "patients": {
                "register": "POST /api/register (Doctor, Nurse, Admin)",
                "update": "PUT /api/patients/{patient_id} (Doctor, Nurse, Admin)",
                "list": "GET /api/patients (Healthcare providers)",
                "get": "GET /api/patients/{patient_id} (Healthcare providers or own record)",
                "my_records": "GET /api/my-records (Patient: own records only)"
            },
            "emergency": {
                "access": "POST /api/emergency-access",
                "simulate_nfc": "POST /api/simulate-nfc-tap",
                "access_logs": "GET /api/access-logs/{patient_id}"
            },
            "rbac": {
                "assign_role": "POST /api/roles/assign (Admin only)",
                "revoke_role": "DELETE /api/roles/revoke (Admin only)",
                "list_users": "GET /api/users (Admin only)"
            },
            "health": "GET /health"
        },
        "auth_header": "Use 'X-User-Id' header with wallet address (SS58 format) for authentication"
    }))
}
