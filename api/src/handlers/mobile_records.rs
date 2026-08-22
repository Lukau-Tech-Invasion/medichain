//! Patient-authorised mobile device and protected record capability endpoints.

use super::*;
use crate::mobile_records::{MobileDeviceStatus, MobilePlatform};

#[derive(Debug, Deserialize)]
pub struct RegisterMobileDeviceRequest {
    pub device_label: String,
    pub platform: MobilePlatform,
    pub public_key: String,
}
#[derive(Debug, Deserialize)]
pub struct AuthoriseMobileRecordRequest {
    pub device_id: String,
    pub record_id: String,
    pub encrypted_content_reference: String,
    pub watermark_text: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct RevokeMobileDeviceRequest {
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct LockscreenTokenResponse {
    pub token: String,
    pub token_type: &'static str,
    pub expires_in: i64,
    pub device_id: String,
}

fn authenticated_patient_id(
    data: &web::Data<AppState>,
    req: &HttpRequest,
) -> Result<String, HttpResponse> {
    let user_id = get_current_user_id(req).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Authentication required".into(),
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
    user.linked_patient_id.ok_or_else(|| {
        HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "A patient identity is required for mobile record access".into(),
            code: "PATIENT_CONTEXT_REQUIRED".into(),
        })
    })
}

/// Register a patient-owned public key. Private key material remains on the device.
#[post("/api/mobile/devices/register")]
pub async fn register_patient_mobile_device(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<RegisterMobileDeviceRequest>,
) -> impl Responder {
    let patient_id = match authenticated_patient_id(&data, &req) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match data
        .mobile_records
        .register_device_durable(
            patient_id,
            body.device_label.clone(),
            body.platform,
            body.public_key.clone(),
        )
        .await
    {
        Ok(device) => HttpResponse::Created().json(device),
        Err(error) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: error.into(),
            code: "MOBILE_DEVICE_REGISTRATION_REJECTED".into(),
        }),
    }
}

/// Obtain a short-lived capability for a ciphertext reference, not a plaintext download.
#[post("/api/mobile/records/authorise")]
pub async fn authorise_mobile_record(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<AuthoriseMobileRecordRequest>,
) -> impl Responder {
    let patient_id = match authenticated_patient_id(&data, &req) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match data
        .mobile_records
        .authorise_record_durable(
            &patient_id,
            &body.device_id,
            body.record_id.clone(),
            body.encrypted_content_reference.clone(),
            body.watermark_text.clone(),
            Utc::now(),
        )
        .await
    {
        Ok(session) => HttpResponse::Created().json(session),
        Err(error) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: error.into(),
            code: "MOBILE_RECORD_AUTHORISATION_REJECTED".into(),
        }),
    }
}

/// Issue a short-lived patient-authenticated capability for one active device.
#[post("/api/mobile/devices/{id}/lockscreen-token")]
pub async fn issue_mobile_lockscreen_token(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = match authenticated_patient_id(&data, &req) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let device_id = path.into_inner();
    match data.mobile_records.get_device_durable(&device_id).await {
        Ok(Some(device))
            if device.patient_id == patient_id && device.status == MobileDeviceStatus::Active => {}
        Ok(Some(_)) => {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Mobile device is not active for this patient".into(),
                code: "MOBILE_DEVICE_BINDING_REQUIRED".into(),
            });
        }
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Mobile device not found".into(),
                code: "MOBILE_DEVICE_NOT_FOUND".into(),
            });
        }
        Err(_) => return HttpResponse::ServiceUnavailable().finish(),
    }
    match crate::mobile_records::issue_lockscreen_token(&patient_id, &device_id) {
        Ok(token) => HttpResponse::Ok().json(LockscreenTokenResponse {
            token,
            token_type: "Bearer",
            expires_in: crate::mobile_records::LOCKSCREEN_TOKEN_TTL_SECS,
            device_id,
        }),
        Err(error) => {
            log::error!("Lockscreen token issuance failed: {}", error);
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Lockscreen token could not be issued".into(),
                code: "TOKEN_ISSUE_FAILED".into(),
            })
        }
    }
}

/// Revoke a patient mobile device and invalidate its active content capabilities.
#[post("/api/mobile/devices/{id}/revoke")]
pub async fn revoke_patient_mobile_device(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RevokeMobileDeviceRequest>,
) -> impl Responder {
    let patient_id = match authenticated_patient_id(&data, &req) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let device_id = path.into_inner();
    let existing = match data.mobile_records.get_device_durable(&device_id).await {
        Ok(Some(device)) if device.patient_id == patient_id => device,
        Ok(Some(_)) => {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Mobile device belongs to another patient".into(),
                code: "MOBILE_DEVICE_OWNER_MISMATCH".into(),
            })
        }
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Mobile device not found".into(),
                code: "MOBILE_DEVICE_NOT_FOUND".into(),
            })
        }
        Err(_) => return HttpResponse::ServiceUnavailable().finish(),
    };
    if let Err(error) = data
        .audit_outbox
        .record_durable(
            data.db_pool.as_ref(),
            "patient_mobile_device_revoked".into(),
            "patient_mobile_device".into(),
            existing.id.clone(),
            serde_json::json!({"event":"remote_mobile_device_revocation"}),
            Utc::now(),
        )
        .await
    {
        log::error!("audit outbox write failed: {error}");
        return HttpResponse::ServiceUnavailable().finish();
    }
    match data
        .mobile_records
        .revoke_device_durable(&device_id, body.reason.clone(), Utc::now())
        .await
    {
        Ok(device) => HttpResponse::Ok().json(device),
        Err(error) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: error.into(),
            code: "MOBILE_DEVICE_REVOCATION_REJECTED".into(),
        }),
    }
}
