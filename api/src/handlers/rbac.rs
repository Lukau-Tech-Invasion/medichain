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

    // Sensitive action: enforce MFA step-up for JWT-authenticated admins.
    if let Some(resp) = require_privileged_assurance(&data, &req) {
        return resp;
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

    if let Err(e) = data.persist_then_cache_user(user).await {
        log::error!(
            "Failed to persist role assignment for {}: {}",
            body.wallet_address,
            e
        );
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Role assignment could not be persisted".to_string(),
            code: "USER_PERSISTENCE_UNAVAILABLE".to_string(),
        });
    }

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

    // Sensitive action: enforce MFA step-up for JWT-authenticated admins.
    if let Some(resp) = require_privileged_assurance(&data, &req) {
        return resp;
    }

    // Cannot revoke own role
    if body.wallet_address == current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Cannot revoke your own role".to_string(),
            code: "CANNOT_REVOKE_OWN_ROLE".to_string(),
        });
    }

    let exists = data
        .users
        .read()
        .ok()
        .is_some_and(|users| users.contains_key(&body.wallet_address));
    if !exists {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        });
    }
    if let Err(e) = data.deactivate_then_evict_user(&body.wallet_address).await {
        log::error!(
            "Failed to persist role revocation for {}: {}",
            body.wallet_address,
            e
        );
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Role revocation could not be persisted".to_string(),
            code: "USER_PERSISTENCE_UNAVAILABLE".to_string(),
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

/// Verify a guardian relationship (Admin only) — Horizon HZ-008, extended for
/// the pediatric/guardian identity architecture with granular, time-limited
/// permissions in place of a single boolean "is guardian" flag.
///
/// Records that `guardian_wallet` may exercise specific capabilities
/// (`permissions`) on behalf of `ward_patient_id`, optionally expiring at
/// `expires_at` (e.g. a foster-care placement). This is an admin
/// *verification*, not a self-declaration: an admin attests they reviewed
/// real guardianship evidence, the same division of authority as
/// `assign_role` above (only Admin can grant, and never to themselves for
/// their own benefit).
#[derive(Debug, serde::Deserialize)]
pub struct VerifyGuardianRequest {
    pub guardian_wallet: String,
    pub ward_patient_id: String,
    pub relationship_type: crate::repositories::traits::GuardianRelationshipType,
    pub permissions: Vec<crate::repositories::traits::GuardianPermission>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,

    // --- Legal-authority evidence (POPIA review §3) ---
    // Optional at the type level so a `parent_or_guardian` relationship stays
    // easy to record, but *required* for the proxy types — see the validation
    // in the handler.
    pub authority_evidence_type: Option<crate::repositories::traits::GuardianAuthorityEvidence>,
    pub authority_evidence_reference: Option<String>,
    pub authority_issuing_authority: Option<String>,
    /// Role/title of the verifying operator, e.g. "Records Officer".
    pub authority_verified_by_role: Option<String>,
    pub next_reverification_due: Option<chrono::DateTime<chrono::Utc>>,

    // --- Child participation (Children's Act) ---
    pub child_assent_status: Option<crate::repositories::traits::ChildAssentStatus>,
    pub child_assent_notes: Option<String>,

    /// The relationship this one replaces (custody transfer).
    pub supersedes_relationship_id: Option<String>,
}

#[post("/api/guardians/verify")]
pub async fn verify_guardian_relationship(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<VerifyGuardianRequest>,
) -> impl Responder {
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

    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can verify guardian relationships".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    if body.guardian_wallet == current_user_id {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "An admin cannot verify a guardian relationship naming themselves".to_string(),
            code: "GUARDIAN_VERIFICATION_REJECTED".to_string(),
        });
    }

    if body.guardian_wallet.trim().is_empty() || body.ward_patient_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "guardian_wallet and ward_patient_id are required".to_string(),
            code: "GUARDIAN_VERIFICATION_REJECTED".to_string(),
        });
    }

    // A legal-proxy or power-of-attorney relationship derives its authority
    // from a specific document. Recording one without citing that document
    // leaves "verified" as an unfalsifiable assertion — the exact gap the
    // 2026-07-28 POPIA review flagged (see docs/PRODUCTION_READINESS_GATES.md
    // §3). `parent_or_guardian` is deliberately not held to this: parenthood is
    // commonly established without a court document.
    let needs_documentary_evidence = matches!(
        body.relationship_type,
        crate::repositories::traits::GuardianRelationshipType::LegalProxy
            | crate::repositories::traits::GuardianRelationshipType::PowerOfAttorney
    );
    let has_evidence = body.authority_evidence_type.is_some()
        && body
            .authority_evidence_reference
            .as_ref()
            .map(|r| !r.trim().is_empty())
            .unwrap_or(false);

    if needs_documentary_evidence && !has_evidence {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!(
                "relationship_type '{}' requires authority_evidence_type and \
                 authority_evidence_reference identifying the document that establishes \
                 this authority",
                body.relationship_type.as_str()
            ),
            code: "GUARDIAN_AUTHORITY_EVIDENCE_REQUIRED".to_string(),
        });
    }

    if let Some(resp) = require_privileged_assurance(&data, &req) {
        return resp;
    }

    let now = Utc::now();
    let relationship = crate::repositories::traits::GuardianRelationshipEntity {
        id: uuid::Uuid::new_v4().to_string(),
        guardian_wallet: body.guardian_wallet.clone(),
        ward_patient_id: body.ward_patient_id.clone(),
        relationship_type: body.relationship_type.as_str().to_string(),
        permissions: body
            .permissions
            .iter()
            .map(|p| p.as_str().to_string())
            .collect(),
        verified_by: current_user_id.clone(),
        verified_at: now,
        active: true,
        expires_at: body.expires_at,
        revoked_at: None,
        revoked_reason: None,
        authority_evidence_type: body.authority_evidence_type.map(|e| e.as_str().to_string()),
        authority_evidence_reference: body.authority_evidence_reference.clone(),
        authority_issuing_authority: body.authority_issuing_authority.clone(),
        authority_verified_by_role: body.authority_verified_by_role.clone(),
        authority_evidence_recorded_at: has_evidence.then_some(now),
        next_reverification_due: body.next_reverification_due,
        child_assent_status: body.child_assent_status.map(|s| s.as_str().to_string()),
        child_assent_recorded_at: body.child_assent_status.map(|_| now),
        child_assent_notes: body.child_assent_notes.clone(),
        supersedes_relationship_id: body.supersedes_relationship_id.clone(),
        // Newly-verified relationships are not disputed; a dispute is raised
        // later through its own flow, not asserted at creation time.
        dispute_flag: false,
        dispute_notes: None,
    };

    match data
        .repositories
        .guardian_relationships
        .create(relationship)
        .await
    {
        Ok(created) => {
            if let Err(error) = data
                .audit_outbox
                .record_durable(
                    data.db_pool.as_ref(),
                    "guardian_relationship_verified".into(),
                    "guardian_relationship".into(),
                    created.id.clone(),
                    serde_json::json!({
                        "guardian_wallet": created.guardian_wallet,
                        "ward_patient_id": created.ward_patient_id,
                        "permissions": created.permissions,
                        "verified_by": created.verified_by,
                    }),
                    now,
                )
                .await
            {
                log::error!("audit outbox write failed: {error}");
            }
            HttpResponse::Created().json(created)
        }
        Err(e) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "GUARDIAN_VERIFICATION_REJECTED".to_string(),
        }),
    }
}

/// Adjust an existing guardian relationship's permission set and/or expiry
/// in-place (Admin only) — e.g. narrowing a step-parent's access, or turning
/// a temporary foster placement into an indefinite one — without revoking and
/// re-verifying the relationship from scratch.
#[derive(Debug, serde::Deserialize)]
pub struct UpdateGuardianPermissionsRequest {
    pub permissions: Vec<crate::repositories::traits::GuardianPermission>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[put("/api/guardians/{id}/permissions")]
pub async fn update_guardian_permissions(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<UpdateGuardianPermissionsRequest>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => return unauthorized_missing_user(),
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
    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can update guardian permissions".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }
    if let Some(resp) = require_privileged_assurance(&data, &req) {
        return resp;
    }

    let relationship_id = path.into_inner();
    let permissions: Vec<String> = body
        .permissions
        .iter()
        .map(|p| p.as_str().to_string())
        .collect();

    match data
        .repositories
        .guardian_relationships
        .update_permissions(&relationship_id, permissions.clone(), body.expires_at)
        .await
    {
        Ok(updated) => {
            if let Err(error) = data
                .audit_outbox
                .record_durable(
                    data.db_pool.as_ref(),
                    "guardian_relationship_permissions_updated".into(),
                    "guardian_relationship".into(),
                    updated.id.clone(),
                    serde_json::json!({
                        "updated_by": current_user_id,
                        "permissions": permissions,
                    }),
                    Utc::now(),
                )
                .await
            {
                log::error!("audit outbox write failed: {error}");
            }
            HttpResponse::Ok().json(updated)
        }
        Err(e) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "GUARDIAN_PERMISSIONS_UPDATE_REJECTED".to_string(),
        }),
    }
}

/// Revoke a guardian relationship (Admin only).
#[derive(Debug, serde::Deserialize)]
pub struct RevokeGuardianRequest {
    pub relationship_id: String,
    pub reason: Option<String>,
}

#[post("/api/guardians/revoke")]
pub async fn revoke_guardian_relationship(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<RevokeGuardianRequest>,
) -> impl Responder {
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

    // Admin, or the ward themselves once they control their own identity
    // (adulthood transition — see `handlers::identity_claim`): a patient who
    // has claimed their own record may revoke a guardian's access without
    // needing Admin involvement.
    let relationship = data
        .repositories
        .guardian_relationships
        .get_by_id(&body.relationship_id)
        .await
        .ok()
        .flatten();
    let is_own_record = relationship
        .as_ref()
        .map(|r| current_user.linked_patient_id.as_deref() == Some(r.ward_patient_id.as_str()))
        .unwrap_or(false);

    if !current_user.role.is_admin() && !is_own_record {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin or the patient themselves can revoke guardian relationships"
                .to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let now = Utc::now();
    let event = match crate::audit_outbox::AuditOutbox::prepare_event(
        "guardian_relationship_revoked".into(),
        "guardian_relationship".into(),
        body.relationship_id.clone(),
        serde_json::json!({"revoked_by": current_user_id, "reason": body.reason}),
        now,
    ) {
        Ok(event) => event,
        Err(_) => return HttpResponse::ServiceUnavailable().finish(),
    };
    match data
        .repositories
        .guardian_relationships
        .revoke_with_audit(&body.relationship_id, body.reason.clone(), event.clone())
        .await
    {
        Ok(()) => {
            if data.db_pool.is_none() && data.audit_outbox.record_prepared(event).is_err() {
                return HttpResponse::ServiceUnavailable().finish();
            }
            HttpResponse::Ok().json(serde_json::json!({ "success": true }))
        }
        Err(e) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "GUARDIAN_REVOCATION_REJECTED".to_string(),
        }),
    }
}
