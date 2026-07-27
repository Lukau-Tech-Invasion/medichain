//! Admin-managed Phase 2 organisation public-key directory endpoints.

use super::*;
use crate::organization_keys::{OrganizationKeyStatus, OrganizationPublicKey};

#[derive(Debug, Deserialize)]
pub struct RegisterOrganizationKeyRequest {
    pub organization_id: String,
    pub facility_id: Option<String>,
    pub key_id: String,
    pub version: i32,
    pub purpose: String,
    pub algorithm: String,
    pub public_key: String,
    pub proof_of_possession: String,
}

#[derive(Debug, Deserialize)]
pub struct KeyStatusRequest {
    pub status: OrganizationKeyStatus,
}

/// Add a pending public key after proof-of-possession verification.
#[post("/api/organizations/{organization_id}/keys")]
pub async fn register_organization_key(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RegisterOrganizationKeyRequest>,
) -> impl Responder {
    if let Err(response) = require_admin(&data, &req) {
        return response;
    }
    let organization_id = path.into_inner();
    if organization_id != body.organization_id {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Organization path and body must match".into(),
            code: "ORGANIZATION_MISMATCH".into(),
        });
    }
    let result = data.organization_keys.register(OrganizationPublicKey {
        id: String::new(),
        organization_id,
        facility_id: body.facility_id.clone(),
        key_id: body.key_id.clone(),
        version: body.version,
        purpose: body.purpose.clone(),
        algorithm: body.algorithm.clone(),
        public_key: body.public_key.clone(),
        status: OrganizationKeyStatus::Pending,
        proof_of_possession: body.proof_of_possession.clone(),
        valid_from: None,
        valid_until: None,
        retired_at: None,
        revoked_at: None,
        replaced_by: None,
        created_at: Utc::now(),
    });
    match result {
        Ok(key) => HttpResponse::Created().json(key),
        Err(message) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: message.into(),
            code: "KEY_REGISTRATION_REJECTED".into(),
        }),
    }
}

/// Change a key lifecycle state through the registry's guarded transition graph.
#[post("/api/organizations/{organization_id}/keys/{key_id}/status")]
pub async fn transition_organization_key(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<(String, String)>,
    body: web::Json<KeyStatusRequest>,
) -> impl Responder {
    if let Err(response) = require_admin(&data, &req) {
        return response;
    }
    let (organization_id, key_id) = path.into_inner();
    match data
        .organization_keys
        .transition(&organization_id, &key_id, body.status)
    {
        Ok(key) => HttpResponse::Ok().json(key),
        Err(message) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: message.into(),
            code: "KEY_TRANSITION_REJECTED".into(),
        }),
    }
}

/// Resolve the current public wrapping/signing key for a specific purpose.
#[get("/api/organizations/{organization_id}/keys/active")]
pub async fn get_active_organization_key(
    data: web::Data<AppState>,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let purpose = match query.get("purpose") {
        Some(value) if !value.is_empty() => value,
        _ => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "purpose query parameter is required".into(),
                code: "KEY_PURPOSE_REQUIRED".into(),
            })
        }
    };
    match data.organization_keys.active(&path.into_inner(), purpose) {
        Some(key) => HttpResponse::Ok().json(key),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "No active organization key found".into(),
            code: "ACTIVE_KEY_NOT_FOUND".into(),
        }),
    }
}
