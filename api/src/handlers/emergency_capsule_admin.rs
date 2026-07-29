//! Emergency capsule lifecycle management (Horizon HZ-003).
//!
//! - `POST /api/patients/{id}/emergency-capsule` — publish a new capsule
//!   version from the patient's current emergency information and anchor its
//!   commitment on-chain.
//! - `POST /api/patients/{id}/emergency-capsule/revoke` — revoke a version.
//! - `GET  /api/patients/{id}/emergency-capsule/access-log` — who read this
//!   patient's emergency data, why, and which fields were revealed.
//!
//! The 2026-07-28 POPIA legal review (docs/PRODUCTION_READINESS_GATES.md §1)
//! required emergency values be "versioned and revocable" and that every access
//! be logged. Publishing and revoking are the write half of that; the access-log
//! endpoint is what makes the read half answerable to the data subject.
//!
//! Inherits shared imports via `use super::*`.

use super::*;
use crate::middleware::error_handling::{error_codes, error_envelope_json};

/// Resolve the caller and require a healthcare-provider role.
///
/// Publishing a capsule is provider-gated for the same reason the pallet gates
/// `set_emergency_capsule_commitment`: the commitment must correspond to a
/// capsule the clinical system actually holds, so an arbitrary authenticated
/// account must not be able to mint one.
fn require_provider(
    data: &web::Data<AppState>,
    req: &HttpRequest,
) -> Result<String, HttpResponse> {
    let uid = get_current_user_id(req).ok_or_else(|| {
        HttpResponse::Unauthorized().json(error_envelope_json(
            error_codes::UNAUTHORIZED,
            "Authentication required",
            None,
        ))
    })?;
    let user = get_user(data, &uid).ok_or_else(|| {
        HttpResponse::Unauthorized().json(error_envelope_json(
            error_codes::USER_NOT_FOUND,
            "User not found",
            None,
        ))
    })?;
    if !user.role.is_healthcare_provider() {
        return Err(HttpResponse::Forbidden().json(error_envelope_json(
            error_codes::INSUFFICIENT_ROLE,
            "Healthcare provider role required",
            None,
        )));
    }
    Ok(uid)
}

/// POST /api/patients/{patient_id}/emergency-capsule
///
/// Publishes a new capsule version from the patient's stored emergency
/// information. Call this after any change to blood type, organ-donor status,
/// or a DNR directive — the previously committed version stays on file but
/// stops being current.
#[post("/api/patients/{patient_id}/emergency-capsule")]
pub async fn publish_emergency_capsule(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match require_provider(&data, &req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    let patient_id = path.into_inner();

    // Publishing a new capsule version is new processing. Emergency *reads* are
    // deliberately not gated on this — a restriction must never stop a
    // paramedic seeing a blood type.
    if let Err(resp) = crate::support::ensure_not_restricted(&data, &patient_id).await {
        return resp;
    }

    let entity = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(value) => value,
        Err(_) => {
            return HttpResponse::NotFound().json(error_envelope_json(
                error_codes::NOT_FOUND,
                "Patient not found",
                None,
            ))
        }
    };
    let Some(profile) = crate::types::patient_entity_to_profile(&entity, &data.encryption_keyring)
    else {
        return HttpResponse::InternalServerError().json(error_envelope_json(
            error_codes::INTERNAL_ERROR,
            "Patient emergency information could not be read",
            None,
        ));
    };

    match crate::emergency_capsule::publish_capsule(&data, &profile.emergency_info, &caller).await {
        Ok(stored) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "patient_id": stored.patient_id,
            "version": stored.version,
            "commitment": stored.commitment,
            // Anchoring is spawned, so it has not completed yet. Reporting it
            // as pending is honest; reporting success would not be.
            "anchoring": "submitted",
        })),
        Err(e) => {
            log::error!("Capsule publication failed for {patient_id}: {e}");
            HttpResponse::InternalServerError().json(error_envelope_json(
                error_codes::INTERNAL_ERROR,
                "Could not publish emergency capsule",
                None,
            ))
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct RevokeCapsuleRequest {
    pub version: i32,
    pub reason: Option<String>,
}

/// POST /api/patients/{patient_id}/emergency-capsule/revoke
///
/// Marks a capsule version revoked. The row is retained: that a directive was
/// in force between two dates is itself part of the clinical record, so
/// revocation is never deletion.
#[post("/api/patients/{patient_id}/emergency-capsule/revoke")]
pub async fn revoke_emergency_capsule(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RevokeCapsuleRequest>,
) -> impl Responder {
    let caller = match require_provider(&data, &req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    let patient_id = path.into_inner();

    match data
        .repositories
        .emergency_capsules
        .revoke(&patient_id, body.version, &caller, body.reason.clone())
        .await
    {
        Ok(capsule) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "patient_id": capsule.patient_id,
            "version": capsule.version,
            "revoked_at": capsule.revoked_at,
            "revoked_by": capsule.revoked_by,
        })),
        Err(crate::repositories::traits::RepositoryError::NotFound(msg)) => {
            HttpResponse::NotFound().json(error_envelope_json(
                error_codes::NOT_FOUND,
                &msg,
                None,
            ))
        }
        Err(e) => {
            log::error!("Capsule revocation failed for {patient_id}: {e}");
            HttpResponse::InternalServerError().json(error_envelope_json(
                error_codes::INTERNAL_ERROR,
                "Could not revoke emergency capsule",
                None,
            ))
        }
    }
}

/// GET /api/patients/{patient_id}/emergency-capsule/access-log
///
/// Every break-glass read of this patient's emergency capsule: who, why, when,
/// under which grant, and which fields were revealed.
///
/// Readable by a healthcare provider or by the patient themself — a data
/// subject asking "who saw my emergency information" is exactly the question
/// this log exists to answer.
#[get("/api/patients/{patient_id}/emergency-capsule/access-log")]
pub async fn get_emergency_capsule_access_log(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let Some(uid) = get_current_user_id(&req) else {
        return HttpResponse::Unauthorized().json(error_envelope_json(
            error_codes::UNAUTHORIZED,
            "Authentication required",
            None,
        ));
    };
    let Some(user) = get_user(&data, &uid) else {
        return HttpResponse::Unauthorized().json(error_envelope_json(
            error_codes::USER_NOT_FOUND,
            "User not found",
            None,
        ));
    };

    let is_own_record = user.linked_patient_id.as_deref() == Some(patient_id.as_str());
    if !user.role.is_healthcare_provider() && !user.role.is_admin() && !is_own_record {
        return HttpResponse::Forbidden().json(error_envelope_json(
            error_codes::INSUFFICIENT_ROLE,
            "Not permitted to read this patient's emergency access log",
            None,
        ));
    }

    match data
        .repositories
        .emergency_capsules
        .access_history(&patient_id, 200)
        .await
    {
        Ok(entries) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "patient_id": patient_id,
            "count": entries.len(),
            "accesses": entries,
        })),
        Err(e) => {
            log::error!("Capsule access-log read failed for {patient_id}: {e}");
            HttpResponse::InternalServerError().json(error_envelope_json(
                error_codes::INTERNAL_ERROR,
                "Could not read emergency access log",
                None,
            ))
        }
    }
}
