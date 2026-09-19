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
    let key = match result {
        Ok(key) => key,
        Err(message) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: message.into(),
                code: "KEY_REGISTRATION_REJECTED".into(),
            })
        }
    };

    // Before this, the 201 above was the whole story: the key lived in process
    // memory and the `organization_keys` table stayed at zero rows. Rolling the
    // in-memory copy back on failure matters more here than the insert does —
    // a registry listing a key the database does not hold is a directory that
    // lies until the next restart, and nobody re-registers a key that is
    // already listed.
    if let Err(error) = persist_registration(&data, &key).await {
        let _ = data.organization_keys.remove(&key.id);
        log::error!("organisation-key registration persistence failed: {error}");
        return key_persistence_failed("the key was not registered");
    }

    HttpResponse::Created().json(key)
}

/// The durable write failed and the in-memory change has been rolled back.
///
/// `what_did_not_happen` names the action, because the two callers fail
/// differently and "the key was not registered" is actively misleading on a
/// revocation that did not take effect -- an administrator who reads it
/// believes the key is still active, which is the opposite of the truth they
/// need.
fn key_persistence_failed(what_did_not_happen: &str) -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        success: false,
        error: format!("Organisation key storage is unavailable; {what_did_not_happen}"),
        code: "KEY_PERSISTENCE_REQUIRED".into(),
    })
}

async fn persist_registration(
    data: &web::Data<AppState>,
    key: &OrganizationPublicKey,
) -> Result<(), String> {
    let Some(pool) = data.db_pool.as_ref() else {
        return Ok(());
    };
    sqlx::query(
        "INSERT INTO organization_keys (id, organization_id, facility_id, key_id, version, \
         purpose, algorithm, public_key, status, proof_of_possession, valid_from, valid_until, \
         retired_at, revoked_at, replaced_by, created_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
    )
    .bind(&key.id)
    .bind(&key.organization_id)
    .bind(&key.facility_id)
    .bind(&key.key_id)
    .bind(key.version)
    .bind(&key.purpose)
    .bind(&key.algorithm)
    .bind(&key.public_key)
    .bind(key.status.as_str())
    .bind(&key.proof_of_possession)
    .bind(key.valid_from)
    .bind(key.valid_until)
    .bind(key.retired_at)
    .bind(key.revoked_at)
    .bind(&key.replaced_by)
    .bind(key.created_at)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

async fn persist_transition(
    data: &web::Data<AppState>,
    key: &OrganizationPublicKey,
) -> Result<(), String> {
    let Some(pool) = data.db_pool.as_ref() else {
        return Ok(());
    };
    let result = sqlx::query(
        "UPDATE organization_keys SET status=$2, retired_at=$3, revoked_at=$4 WHERE id=$1",
    )
    .bind(&key.id)
    .bind(key.status.as_str())
    .bind(key.retired_at)
    .bind(key.revoked_at)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;
    if result.rows_affected() != 1 {
        // The registry held a key the table does not. Saying so is the point:
        // the alternative is a revocation that appears to have worked.
        return Err("organisation key was not persisted before this transition".into());
    }
    Ok(())
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
    // Captured before the transition, because rolling back needs the state the
    // key was in, not the state the failed write was trying to reach.
    let previous = data.organization_keys.find(&organization_id, &key_id);
    let key = match data
        .organization_keys
        .transition(&organization_id, &key_id, body.status)
    {
        Ok(key) => key,
        Err(message) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: message.into(),
                code: "KEY_TRANSITION_REJECTED".into(),
            })
        }
    };

    // A revocation that only happened in memory is the dangerous direction of
    // this defect: the key reads as revoked until the process restarts, and
    // then it is active again.
    if let Err(error) = persist_transition(&data, &key).await {
        if let Some(previous) = previous {
            let _ = data.organization_keys.restore(previous);
        }
        log::error!("organisation-key transition persistence failed: {error}");
        return key_persistence_failed("the key status was NOT changed");
    }

    HttpResponse::Ok().json(key)
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
