use super::*;

// ============================================================================
// RBAC Endpoints
// ============================================================================

/// Assign a role to a user (Admin only)
#[post("/api/roles/assign")]
pub async fn assign_role(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<AssignRoleRequest>,
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
            error: "Only Admin can assign roles".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
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

    // Cannot assign Admin role (must be done directly)
    if role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Cannot assign Admin role via API".to_string(),
            code: "CANNOT_ASSIGN_ADMIN".to_string(),
        });
    }

    // Validate wallet address format
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid wallet address format. Must be SS58 encoded (48 chars starting with 5)"
                .to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    // Create new user with wallet address
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
        status: "active".to_string(),
        last_login: None,
    };

    data.users
        .write()
        .unwrap()
        .insert(body.wallet_address.clone(), user);

    log::info!(
        "Role {} assigned to wallet {} by admin {}",
        role,
        body.wallet_address,
        current_user_id
    );

    HttpResponse::Ok().json(AssignRoleResponse {
        success: true,
        wallet_address: body.wallet_address.clone(),
        role: role.to_string(),
        message: format!("Role {} assigned successfully", role),
    })
}

/// Revoke a user's role (Admin only)
#[delete("/api/roles/revoke")]
pub async fn revoke_role(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<RevokeRoleRequest>,
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
            error: "Only Admin can revoke roles".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Cannot revoke own role
    if body.wallet_address == current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Cannot revoke your own role".to_string(),
            code: "CANNOT_REVOKE_OWN_ROLE".to_string(),
        });
    }

    // Remove user
    let removed = data.users.write().unwrap().remove(&body.wallet_address);

    if removed.is_none() {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        });
    }

    log::info!(
        "Role revoked from user {} by admin {}",
        body.wallet_address,
        current_user_id
    );

    HttpResponse::Ok().json(RevokeRoleResponse {
        success: true,
        wallet_address: body.wallet_address.clone(),
        message: "Role revoked successfully".to_string(),
    })
}
