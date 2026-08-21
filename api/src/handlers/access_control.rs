//! Patient-controlled access grants and provider access requests.
//!
//! Backs the patient-app Consent Management page. Providers request access;
//! the patient (or their guardian/an admin) approves — minting a standing
//! grant — or denies, and revokes grants at will. Authorization reuses
//! [`crate::support::resolve_patient_access`] exactly as `sign_consent` does,
//! so "who may act for this patient" cannot drift between the two features.
//! See [`crate::patient_access`] for the store and the state machine.

use super::*;
use crate::patient_access::{AccessType, RequestingProvider, STORE_UNAVAILABLE};
use crate::repositories::traits::GuardianPermission;

#[derive(Debug, Deserialize)]
pub struct CreateAccessRequestBody {
    pub reason: String,
}

fn unauthorized(error: &str, code: &str) -> HttpResponse {
    HttpResponse::Unauthorized().json(ErrorResponse {
        success: false,
        error: error.to_string(),
        code: code.to_string(),
    })
}

fn forbidden(error: &str) -> HttpResponse {
    HttpResponse::Forbidden().json(ErrorResponse {
        success: false,
        error: error.to_string(),
        code: "ACCESS_FORBIDDEN".to_string(),
    })
}

fn not_found(error: &str) -> HttpResponse {
    HttpResponse::NotFound().json(ErrorResponse {
        success: false,
        error: error.to_string(),
        code: "NOT_FOUND".to_string(),
    })
}

fn bad_request(error: &str) -> HttpResponse {
    HttpResponse::BadRequest().json(ErrorResponse {
        success: false,
        error: error.to_string(),
        code: "ACCESS_REQUEST_REJECTED".to_string(),
    })
}

fn unavailable() -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        success: false,
        error: STORE_UNAVAILABLE.to_string(),
        code: "PATIENT_ACCESS_UNAVAILABLE".to_string(),
    })
}

/// A state-machine refusal is the caller's fault (400); an unreachable store is
/// not (503). Consent screens must never render a storage outage as "no grants".
fn transition_error(error: &'static str) -> HttpResponse {
    if error == STORE_UNAVAILABLE {
        unavailable()
    } else {
        bad_request(error)
    }
}

/// Resolve the authenticated caller, or the 401 to return.
fn authed_user(data: &web::Data<AppState>, req: &HttpRequest) -> Result<User, HttpResponse> {
    let user_id = get_current_user_id(req)
        .ok_or_else(|| unauthorized("Authentication required", "UNAUTHORIZED"))?;
    get_user(data, &user_id).ok_or_else(|| unauthorized("User not found", "USER_NOT_FOUND"))
}

/// List the patient's standing access grants. Patient/guardian/admin only.
#[get("/api/access/patient/{patient_id}/grants")]
pub async fn list_patient_access_grants(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let user = match authed_user(&data, &req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let patient_id = path.into_inner();
    let access =
        resolve_patient_access(&data, &user, &patient_id, GuardianPermission::ViewRecords).await;
    if !access.is_permitted() {
        return forbidden("You may not view this patient's access grants");
    }
    match data
        .patient_access
        .list_grants_by_patient(&patient_id, Utc::now())
        .await
    {
        Ok(grants) => HttpResponse::Ok().json(serde_json::json!({ "grants": grants })),
        Err(_) => unavailable(),
    }
}

/// List the patient's access requests (pending and decided). Same authorization.
#[get("/api/access/patient/{patient_id}/requests")]
pub async fn list_patient_access_requests(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let user = match authed_user(&data, &req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let patient_id = path.into_inner();
    let access =
        resolve_patient_access(&data, &user, &patient_id, GuardianPermission::ViewRecords).await;
    if !access.is_permitted() {
        return forbidden("You may not view this patient's access requests");
    }
    match data
        .patient_access
        .list_requests_by_patient(&patient_id)
        .await
    {
        Ok(requests) => HttpResponse::Ok().json(serde_json::json!({ "requests": requests })),
        Err(_) => unavailable(),
    }
}

/// A healthcare provider requests standing access to a patient's records.
/// This is the provider-initiated half of the loop; the patient decides.
#[post("/api/access/patient/{patient_id}/requests")]
pub async fn create_patient_access_request(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<CreateAccessRequestBody>,
) -> impl Responder {
    let user = match authed_user(&data, &req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !user.role.is_healthcare_provider() {
        return forbidden("Only healthcare providers can request access");
    }
    let patient_id = path.into_inner();
    let provider = RequestingProvider {
        provider_id: user.wallet_address.clone(),
        provider_name: user.name.clone(),
        provider_role: user.role.to_string(),
        organization: user
            .department
            .clone()
            .unwrap_or_else(|| "Unaffiliated".to_string()),
        reason: body.reason.clone(),
    };
    match data
        .patient_access
        .create_request(patient_id, provider, Utc::now())
        .await
    {
        Ok(request) => {
            if let Err(error) = data
                .audit_outbox
                .record_durable(
                    data.db_pool.as_ref(),
                    "access_request_created".into(),
                    "access_request".into(),
                    request.id.clone(),
                    serde_json::json!({"provider_id": request.provider_id}),
                    Utc::now(),
                )
                .await
            {
                log::error!("audit outbox write failed: {error}");
            }
            HttpResponse::Created().json(serde_json::json!({ "request": request }))
        }
        Err(e) => transition_error(e),
    }
}

/// Patient approves a pending request, minting an active grant.
#[post("/api/access/requests/{id}/approve")]
pub async fn approve_access_request(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let user = match authed_user(&data, &req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let request_id = path.into_inner();
    let existing = match data.patient_access.get_request(&request_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return not_found("Access request not found"),
        Err(_) => return unavailable(),
    };
    let access = resolve_patient_access(
        &data,
        &user,
        &existing.patient_id,
        GuardianPermission::ConsentToDataProcessing,
    )
    .await;
    if !access.is_permitted() {
        return forbidden("Only the patient may decide this access request");
    }
    match data
        .patient_access
        .approve_request(&request_id, AccessType::Limited, None, Utc::now())
        .await
    {
        Ok((request, grant)) => {
            if let Err(error) = data
                .audit_outbox
                .record_durable(
                    data.db_pool.as_ref(),
                    "access_request_approved".into(),
                    "access_grant".into(),
                    grant.id.clone(),
                    serde_json::json!({"request_id": request.id, "provider_id": grant.provider_id}),
                    Utc::now(),
                )
                .await
            {
                log::error!("audit outbox write failed: {error}");
            }
            HttpResponse::Ok().json(serde_json::json!({ "request": request, "grant": grant }))
        }
        Err(e) => transition_error(e),
    }
}

/// Patient denies a pending request.
#[post("/api/access/requests/{id}/deny")]
pub async fn deny_access_request(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let user = match authed_user(&data, &req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let request_id = path.into_inner();
    let existing = match data.patient_access.get_request(&request_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return not_found("Access request not found"),
        Err(_) => return unavailable(),
    };
    let access = resolve_patient_access(
        &data,
        &user,
        &existing.patient_id,
        GuardianPermission::ConsentToDataProcessing,
    )
    .await;
    if !access.is_permitted() {
        return forbidden("Only the patient may decide this access request");
    }
    match data.patient_access.deny_request(&request_id).await {
        Ok(request) => {
            if let Err(error) = data
                .audit_outbox
                .record_durable(
                    data.db_pool.as_ref(),
                    "access_request_denied".into(),
                    "access_request".into(),
                    request.id.clone(),
                    serde_json::json!({"provider_id": request.provider_id}),
                    Utc::now(),
                )
                .await
            {
                log::error!("audit outbox write failed: {error}");
            }
            HttpResponse::Ok().json(serde_json::json!({ "request": request }))
        }
        Err(e) => transition_error(e),
    }
}

/// Patient revokes an active grant.
#[post("/api/access/grants/{id}/revoke")]
pub async fn revoke_access_grant(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let user = match authed_user(&data, &req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let grant_id = path.into_inner();
    let existing = match data.patient_access.get_grant(&grant_id).await {
        Ok(Some(g)) => g,
        Ok(None) => return not_found("Access grant not found"),
        Err(_) => return unavailable(),
    };
    let access = resolve_patient_access(
        &data,
        &user,
        &existing.patient_id,
        GuardianPermission::ConsentToDataProcessing,
    )
    .await;
    if !access.is_permitted() {
        return forbidden("Only the patient may revoke this grant");
    }
    match data
        .patient_access
        .revoke_grant(&grant_id, Utc::now())
        .await
    {
        Ok(grant) => {
            if let Err(error) = data
                .audit_outbox
                .record_durable(
                    data.db_pool.as_ref(),
                    "access_grant_revoked".into(),
                    "access_grant".into(),
                    grant.id.clone(),
                    serde_json::json!({"provider_id": grant.provider_id}),
                    Utc::now(),
                )
                .await
            {
                log::error!("audit outbox write failed: {error}");
            }
            HttpResponse::Ok().json(serde_json::json!({ "grant": grant }))
        }
        Err(e) => transition_error(e),
    }
}
