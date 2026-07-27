//! Grant-bound emergency summary access for approved work devices.

use super::*;
use crate::emergency_grants::EmergencyGrantScope;
use crate::federation_identity::ContextType;

#[derive(Debug, Deserialize)]
pub struct GrantBoundEmergencyAccessRequest {
    pub nfc_tag_id: String,
    pub device_id: String,
    pub work_context_id: String,
    pub reason_code: String,
    pub reason_text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GrantBoundEmergencyAccessResponse {
    pub grant_id: String,
    pub expires_at: chrono::DateTime<Utc>,
    pub emergency_info: EmergencyInfo,
}

/// Return the minimum emergency summary only after validating a live work
/// context, approved device, and newly issued server-side emergency grant.
#[post("/api/emergency/access")]
pub async fn grant_bound_emergency_access(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<GrantBoundEmergencyAccessRequest>,
) -> impl Responder {
    let wallet = match get_current_user_id(&req) {
        Some(value) => value,
        None => {
            return emergency_error(
                HttpResponse::Unauthorized(),
                "Authentication required",
                "UNAUTHORIZED",
            )
        }
    };
    let context = match data
        .identity_contexts
        .active_context(&body.work_context_id, &wallet)
    {
        Some(value) if value.context_type == ContextType::Professional => value,
        _ => {
            return emergency_error(
                HttpResponse::Forbidden(),
                "An active professional work context is required",
                "WORK_CONTEXT_REQUIRED",
            )
        }
    };
    let organization_id = match context.organization_id.clone() {
        Some(value) => value,
        None => {
            return emergency_error(
                HttpResponse::Forbidden(),
                "Work context has no organisation binding",
                "ORGANIZATION_CONTEXT_REQUIRED",
            )
        }
    };
    let facility_id = context.facility_id.clone();
    let device = match data.device_lifecycle.get(&body.device_id) {
        Some(value) => value,
        None => {
            return emergency_error(
                HttpResponse::NotFound(),
                "Approved device not found",
                "DEVICE_NOT_FOUND",
            )
        }
    };
    if !data
        .device_lifecycle
        .can_access(&body.device_id, Utc::now())
    {
        return emergency_error(
            HttpResponse::Forbidden(),
            "Device is not approved for emergency access",
            "DEVICE_NOT_APPROVED",
        );
    }
    if device.organization_id != organization_id || device.facility_id != facility_id {
        return emergency_error(
            HttpResponse::Forbidden(),
            "Device does not match the active work context",
            "DEVICE_CONTEXT_MISMATCH",
        );
    }
    let patient_id = match data.repositories.nfc_tags.get_by_id(&body.nfc_tag_id).await {
        Ok(tag) => tag.patient_id,
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return emergency_error(
                HttpResponse::NotFound(),
                "NFC tag not found",
                "NFC_NOT_FOUND",
            )
        }
        Err(error) => {
            log::error!("Grant-bound NFC lookup failed: {error}");
            return emergency_error(
                HttpResponse::InternalServerError(),
                "Emergency lookup unavailable",
                "EMERGENCY_LOOKUP_FAILED",
            );
        }
    };
    let entity = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(value) => value,
        Err(_) => {
            return emergency_error(
                HttpResponse::NotFound(),
                "Patient record not found",
                "PATIENT_NOT_FOUND",
            )
        }
    };
    let emergency_info = match patient_entity_to_profile(&entity, &data.encryption_keyring) {
        Some(profile) => profile.emergency_info,
        None => {
            return emergency_error(
                HttpResponse::NotFound(),
                "Patient emergency summary not found",
                "EMERGENCY_SUMMARY_NOT_FOUND",
            )
        }
    };
    let grant = match data.emergency_grants.issue(
        patient_id,
        wallet,
        organization_id,
        facility_id,
        body.device_id.clone(),
        body.reason_code.clone(),
        body.reason_text.clone(),
        vec![
            EmergencyGrantScope::EmergencySummary,
            EmergencyGrantScope::DownloadProhibited,
            EmergencyGrantScope::OfflineProhibited,
        ],
        Utc::now(),
    ) {
        Ok(value) => value,
        Err(error) => {
            return emergency_error(
                HttpResponse::BadRequest(),
                error,
                "EMERGENCY_GRANT_REJECTED",
            )
        }
    };
    let _ = data.audit_outbox.record(
        "emergency_grant_issued".into(),
        "emergency_grant".into(),
        grant.id.clone(),
        serde_json::json!({"organization_id": grant.organization_id, "device_id": grant.device_id}),
        Utc::now(),
    );
    HttpResponse::Ok().json(GrantBoundEmergencyAccessResponse {
        grant_id: grant.id,
        expires_at: grant.expires_at,
        emergency_info,
    })
}

fn emergency_error(
    mut builder: actix_web::HttpResponseBuilder,
    error: &str,
    code: &str,
) -> HttpResponse {
    builder.json(ErrorResponse {
        success: false,
        error: error.into(),
        code: code.into(),
    })
}
