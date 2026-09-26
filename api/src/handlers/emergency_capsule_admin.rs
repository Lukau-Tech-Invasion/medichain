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
fn require_provider(data: &web::Data<AppState>, req: &HttpRequest) -> Result<String, HttpResponse> {
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

/// GET /api/patients/{patient_id}/emergency-capsule
///
/// Which emergency directive is in force, and which ones used to be.
///
/// # Why this exists
///
/// `current()` and `history()` were on the repository from the start and no
/// HTTP route served either. The consequences ran in both directions:
/// publishing was unverifiable (nothing could show that a new version had taken
/// effect), revoking was unreachable (the revoke route takes a version number
/// that existed nowhere a person could read), and the patient — whose blood
/// type, organ-donor status and DNR directive this is — could not see whether
/// their own capsule was current, stale or revoked.
///
/// Readable by a healthcare provider, an administrator, or the patient
/// themself, on the same reasoning as the access log: the data subject asking
/// "is my emergency card up to date" is the question this answers.
///
/// Revoked versions are included. That a DNR directive was in force between two
/// dates is part of the clinical record, and a list that dropped it would hide
/// exactly the history a later reviewer needs. No plaintext leaves here — the
/// encrypted capsule body is `skip_serializing` on the entity, so this serves
/// commitments and metadata only.
#[get("/api/patients/{patient_id}/emergency-capsule")]
pub async fn get_emergency_capsule_versions(
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

    // `caller_owns_patient_record` rather than comparing the ids directly: the
    // caller is an SS58 wallet and `patient_id` is a `PAT-` record id, and the
    // obvious comparison fails closed and locks a patient out of their own
    // emergency directive.
    let is_own_record = crate::support::caller_owns_patient_record(&data, &uid, &patient_id);
    if !user.role.is_healthcare_provider() && user.role != crate::Role::Paramedic && !is_own_record
    {
        return HttpResponse::Forbidden().json(error_envelope_json(
            error_codes::INSUFFICIENT_ROLE,
            "Not permitted to read this patient's emergency capsule",
            None,
        ));
    }

    let versions = match data
        .repositories
        .emergency_capsules
        .history(&patient_id)
        .await
    {
        Ok(entries) => entries,
        Err(e) => {
            log::error!("Capsule history read failed: {e}");
            return HttpResponse::InternalServerError().json(error_envelope_json(
                error_codes::INTERNAL_ERROR,
                "Could not read the emergency capsule history",
                None,
            ));
        }
    };
    // Derived here rather than with a second query: "current" means the newest
    // unrevoked version, and answering it from the same list the caller is
    // shown makes the two incapable of disagreeing.
    let current = versions.iter().find(|entry| entry.is_live()).cloned();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "current": current,
        "count": versions.len(),
        "versions": versions,
    }))
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
        Ok(stored) => {
            let anchoring = if stored.chain_finalized {
                "finalized"
            } else if crate::blockchain::blockchain_enabled() {
                "pending"
            } else {
                "disabled"
            };
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "patient_id": stored.patient_id,
                "version": stored.version,
                "commitment": stored.commitment,
                "anchoring": anchoring,
                "blockchain_tx_hash": stored.chain_tx_hash,
            }))
        }
        Err(e) => {
            log::error!("Capsule publication failed: {e}");
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
            HttpResponse::NotFound().json(error_envelope_json(error_codes::NOT_FOUND, &msg, None))
        }
        Err(e) => {
            log::error!("Capsule revocation failed: {e}");
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
            log::error!("Capsule access-log read failed: {e}");
            HttpResponse::InternalServerError().json(error_envelope_json(
                error_codes::INTERNAL_ERROR,
                "Could not read emergency access log",
                None,
            ))
        }
    }
}

/// Who may read a patient's emergency capsule.
///
/// # Why this table exists
///
/// The capsule holds the values a paramedic is shown in an emergency, and the
/// patient is the data subject. Both of the obvious mistakes are serious:
///
///   * **Refusing the patient is a defect, not a safe default.** `patient_id`
///     is a `PAT-` record id and the caller id is an SS58 wallet, so the
///     obvious comparison fails closed and locks a patient out of their own
///     DNR directive. `caller_owns_patient_record` is what bridges the two
///     namespaces, and this table exists so a refactor cannot quietly drop it.
///   * **Letting another patient read it is a disclosure** of blood type,
///     allergies and end-of-life directives.
#[cfg(test)]
mod capsule_read_access_tests {
    use crate::{AppState, Role, User};
    use actix_web::{test, web, App};

    fn user(role: Role, wallet: &str, linked: Option<&str>) -> User {
        User {
            wallet_address: wallet.to_string(),
            username: None,
            name: "Test".to_string(),
            role,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: linked.map(str::to_string),
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    fn state(users: Vec<User>) -> web::Data<AppState> {
        let state = AppState::new();
        {
            let mut table = state.users.write().unwrap();
            for entry in users {
                table.insert(entry.wallet_address.clone(), entry);
            }
        }
        web::Data::new(state)
    }

    async fn status_for(data: web::Data<AppState>, wallet: &str, patient_id: &str) -> u16 {
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::get_emergency_capsule_versions),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/patients/{patient_id}/emergency-capsule"))
            .insert_header(("X-User-Id", wallet.to_string()))
            .to_request();
        test::call_service(&app, req).await.status().as_u16()
    }

    #[actix_web::test]
    async fn a_patient_may_read_their_own_capsule() {
        let data = state(vec![user(Role::Patient, "wallet-a", Some("PAT-1"))]);
        assert_eq!(status_for(data, "wallet-a", "PAT-1").await, 200);
    }

    #[actix_web::test]
    async fn a_patient_may_not_read_another_patients_capsule() {
        let data = state(vec![
            user(Role::Patient, "wallet-a", Some("PAT-1")),
            user(Role::Patient, "wallet-b", Some("PAT-2")),
        ]);
        assert_eq!(status_for(data, "wallet-b", "PAT-1").await, 403);
    }

    #[actix_web::test]
    async fn clinical_staff_and_administrators_may_read_it() {
        let data = state(vec![
            user(Role::Doctor, "doc-1", None),
            user(Role::Nurse, "nurse-1", None),
            user(Role::Paramedic, "ems-1", None),
            user(Role::Admin, "admin-1", None),
        ]);
        assert_eq!(status_for(data.clone(), "doc-1", "PAT-1").await, 200);
        assert_eq!(status_for(data.clone(), "nurse-1", "PAT-1").await, 200);
        assert_eq!(status_for(data.clone(), "ems-1", "PAT-1").await, 200);
        assert_eq!(status_for(data, "admin-1", "PAT-1").await, 200);
    }

    #[actix_web::test]
    async fn an_unknown_caller_is_refused() {
        let data = state(vec![user(Role::Doctor, "doc-1", None)]);
        assert_eq!(status_for(data, "nobody", "PAT-1").await, 401);
    }
}
