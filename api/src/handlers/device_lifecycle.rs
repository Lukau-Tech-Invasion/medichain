//! Admin-only approved-device lifecycle endpoints.

use super::*;
use crate::device_lifecycle::ManagedDevice;

#[derive(Debug, Deserialize)]
pub struct EnrollDeviceRequest {
    pub organization_id: String,
    pub facility_id: Option<String>,
    pub device_name: String,
    pub device_type: String,
    pub hardware_fingerprint: String,
    pub platform: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RotateDeviceRequest {
    pub key_id: String,
}

#[derive(Debug, Deserialize)]
pub struct RevokeDeviceRequest {
    pub reason: String,
}

/// Enroll an approved hospital device; it cannot access clinical data yet.
#[post("/api/devices/enroll")]
pub async fn enroll_managed_device(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<EnrollDeviceRequest>,
) -> impl Responder {
    if let Err(response) = require_admin(&data, &req) {
        return response;
    }
    match data.device_lifecycle.enroll(
        body.organization_id.clone(),
        body.facility_id.clone(),
        body.device_name.clone(),
        body.device_type.clone(),
        body.hardware_fingerprint.clone(),
        body.platform.clone(),
    ) {
        Ok(device) => HttpResponse::Created().json(device),
        Err(error) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: error.into(),
            code: "DEVICE_ENROLLMENT_REJECTED".into(),
        }),
    }
}

/// Provision a new device credential and reset the monthly rotation clock.
#[post("/api/devices/{id}/rotate")]
pub async fn rotate_managed_device(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RotateDeviceRequest>,
) -> impl Responder {
    if let Err(response) = require_admin(&data, &req) {
        return response;
    }
    match data
        .device_lifecycle
        .rotate(&path.into_inner(), body.key_id.clone(), Utc::now())
    {
        Ok(device) => HttpResponse::Ok().json(device),
        Err(error) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: error.into(),
            code: "DEVICE_ROTATION_REJECTED".into(),
        }),
    }
}

/// Permanently prevent a device from using its cached or future credentials.
#[post("/api/devices/{id}/revoke")]
pub async fn revoke_managed_device(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RevokeDeviceRequest>,
) -> impl Responder {
    if let Err(response) = require_admin(&data, &req) {
        return response;
    }
    match data
        .device_lifecycle
        .revoke(&path.into_inner(), body.reason.clone(), Utc::now())
    {
        Ok(device) => {
            if let Err(error) = data
                .audit_outbox
                .record_durable(
                    data.db_pool.as_ref(),
                    "managed_device_revoked".into(),
                    "managed_device".into(),
                    device.id.clone(),
                    serde_json::json!({"organization_id": device.organization_id}),
                    Utc::now(),
                )
                .await
            {
                log::error!("audit outbox write failed: {error}");
            }
            HttpResponse::Ok().json(device)
        }
        Err(error) => HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: error.into(),
            code: "DEVICE_REVOCATION_REJECTED".into(),
        }),
    }
}

/// List devices requiring administrative remediation before they can regain access.
#[get("/api/devices/compliance")]
pub async fn get_device_compliance(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    if let Err(response) = require_admin(&data, &req) {
        return response;
    }
    let _ = data.device_lifecycle.refresh_compliance(Utc::now());
    let devices: Vec<ManagedDevice> = data.device_lifecycle.non_compliant();
    HttpResponse::Ok().json(devices)
}
