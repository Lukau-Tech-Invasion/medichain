//! Emergency-grant issuance and lifecycle endpoints.
//!
//! These routes are additive. The legacy NFC demonstration route remains
//! available until every consumer moves to grant-bound emergency summaries.

use super::*;
use crate::emergency_grants::EmergencyGrantScope;

#[derive(Debug, Deserialize)]
pub struct IssueEmergencyGrantRequest {
    pub patient_id: String,
    pub device_id: String,
    pub reason_code: String,
    pub reason_text: Option<String>,
    #[serde(default = "default_emergency_scopes")]
    pub scopes: Vec<EmergencyGrantScope>,
}

#[derive(Debug, Deserialize)]
pub struct RevokeEmergencyGrantRequest {
    pub reason: String,
}

fn default_emergency_scopes() -> Vec<EmergencyGrantScope> {
    vec![
        EmergencyGrantScope::EmergencySummary,
        EmergencyGrantScope::DownloadProhibited,
        EmergencyGrantScope::OfflineProhibited,
    ]
}

fn provider_and_device(
    data: &web::Data<AppState>,
    req: &HttpRequest,
    device_id: &str,
) -> Result<(String, String, Option<String>), HttpResponse> {
    let user_id = get_current_user_id(req).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Authentication required for emergency access".into(),
            code: "UNAUTHORIZED".into(),
        })
    })?;
    let user = get_user(data, &user_id).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "User not found".into(),
            code: "USER_NOT_FOUND".into(),
        })
    })?;
    if !user.role.is_healthcare_provider() {
        return Err(HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can request emergency access".into(),
            code: "INSUFFICIENT_ROLE".into(),
        }));
    }
    let device = data.device_lifecycle.get(device_id).ok_or_else(|| {
        HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Approved device not found".into(),
            code: "DEVICE_NOT_FOUND".into(),
        })
    })?;
    if !data.device_lifecycle.can_access(device_id, Utc::now()) {
        return Err(HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Device is not approved for emergency access".into(),
            code: "DEVICE_NOT_APPROVED".into(),
        }));
    }
    Ok((user_id, device.organization_id, device.facility_id))
}

/// Issue a fixed 15-minute grant after checking the clinician and managed device.
#[post("/api/emergency/grants")]
pub async fn issue_emergency_grant(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<IssueEmergencyGrantRequest>,
) -> impl Responder {
    let (person_id, organization_id, facility_id) =
        match provider_and_device(&data, &req, &body.device_id) {
            Ok(values) => values,
            Err(response) => return response,
        };
    match data
        .emergency_grants
        .issue_with_audit(
            crate::emergency_grants::EmergencyGrantBinding {
                patient_id: body.patient_id.clone(),
                person_id,
                organization_id,
                facility_id,
                device_id: body.device_id.clone(),
            },
            crate::emergency_grants::AuditedEmergencyGrantRequest {
                reason_code: body.reason_code.clone(),
                reason_text: body.reason_text.clone(),
                scopes: body.scopes.clone(),
                event_type: "emergency_grant_issued".into(),
                payload: serde_json::json!({"device_id": body.device_id}),
                now: Utc::now(),
            },
        )
        .await
    {
        Ok((grant, event)) => {
            if data.db_pool.is_none() && data.audit_outbox.record_prepared(event).is_err() {
                return HttpResponse::ServiceUnavailable().finish();
            }
            HttpResponse::Created().json(grant)
        }
        Err(error) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: error.into(),
            code: "EMERGENCY_GRANT_REJECTED".into(),
        }),
    }
}

/// Return grant state only to the requesting professional; clinical data stays elsewhere.
#[get("/api/emergency/grants/{id}")]
pub async fn get_emergency_grant(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let user_id = match get_current_user_id(&req) {
        Some(value) => value,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Authentication required".into(),
                code: "UNAUTHORIZED".into(),
            })
        }
    };
    match data.emergency_grants.get(&path.into_inner()).await {
        Ok(Some(grant)) if grant.requesting_person_id == user_id => HttpResponse::Ok().json(grant),
        Ok(Some(_)) => HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Emergency grant belongs to another professional".into(),
            code: "GRANT_OWNER_MISMATCH".into(),
        }),
        Ok(None) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Emergency grant not found".into(),
            code: "GRANT_NOT_FOUND".into(),
        }),
        Err(_) => HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Emergency grant store is unavailable".into(),
            code: "STORE_UNAVAILABLE".into(),
        }),
    }
}

/// Revoke a grant; only its requesting professional or an administrator may do so.
#[post("/api/emergency/grants/{id}/revoke")]
pub async fn revoke_emergency_grant(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RevokeEmergencyGrantRequest>,
) -> impl Responder {
    let user_id = match get_current_user_id(&req) {
        Some(value) => value,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Authentication required".into(),
                code: "UNAUTHORIZED".into(),
            })
        }
    };
    let existing = match data.emergency_grants.get(&path.into_inner()).await {
        Ok(Some(grant)) => grant,
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Emergency grant not found".into(),
                code: "GRANT_NOT_FOUND".into(),
            })
        }
        Err(_) => {
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Emergency grant store is unavailable".into(),
                code: "STORE_UNAVAILABLE".into(),
            })
        }
    };
    let is_admin = get_user(&data, &user_id)
        .map(|user| user.role == Role::Admin)
        .unwrap_or(false);
    if existing.requesting_person_id != user_id && !is_admin {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only the grant owner or an administrator can revoke this grant".into(),
            code: "GRANT_REVOKE_FORBIDDEN".into(),
        });
    }
    match data
        .emergency_grants
        .revoke_with_audit(
            &existing.id,
            body.reason.clone(),
            "emergency_grant_revoked".into(),
            serde_json::json!({"organization_id": existing.organization_id, "device_id": existing.device_id}),
            Utc::now(),
        )
        .await
    {
        Ok((grant, event)) => {
            if data.db_pool.is_none() && data.audit_outbox.record_prepared(event).is_err() {
                return HttpResponse::ServiceUnavailable().finish();
            }
            HttpResponse::Ok().json(grant)
        }
        Err(error) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: error.into(),
            code: "GRANT_REVOCATION_REJECTED".into(),
        }),
    }
}
