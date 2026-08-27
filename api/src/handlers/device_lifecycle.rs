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
    let device = match data.device_lifecycle.enroll(
        body.organization_id.clone(),
        body.facility_id.clone(),
        body.device_name.clone(),
        body.device_type.clone(),
        body.hardware_fingerprint.clone(),
        body.platform.clone(),
    ) {
        Ok(device) => device,
        Err(error) => return device_rejected(error, "DEVICE_ENROLLMENT_REJECTED"),
    };
    if let Err(error) = persist_enrollment(&data, &device).await {
        let _ = data.device_lifecycle.remove(&device.id);
        log::error!("Managed-device enrollment persistence failed: {error}");
        return device_persistence_failed();
    }
    HttpResponse::Created().json(device)
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
    let device_id = path.into_inner();
    let Some(previous) = data.device_lifecycle.get(&device_id) else {
        return device_rejected("Device not found", "DEVICE_ROTATION_REJECTED");
    };
    let device = match data
        .device_lifecycle
        .rotate(&device_id, body.key_id.clone(), Utc::now())
    {
        Ok(device) => device,
        Err(error) => return device_rejected(error, "DEVICE_ROTATION_REJECTED"),
    };
    if let Err(error) = persist_rotation(&data, &device).await {
        let _ = data.device_lifecycle.restore(previous);
        log::error!("Managed-device rotation persistence failed: {error}");
        return device_persistence_failed();
    }
    HttpResponse::Ok().json(device)
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
    let device_id = path.into_inner();
    let existing = match data.device_lifecycle.get(&device_id) {
        Some(device) => device,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Device not found".into(),
                code: "DEVICE_NOT_FOUND".into(),
            })
        }
    };
    if let Err(error) = data
        .audit_outbox
        .record_durable(
            data.db_pool.as_ref(),
            "managed_device_revoked".into(),
            "managed_device".into(),
            existing.id.clone(),
            serde_json::json!({"organization_id": existing.organization_id}),
            Utc::now(),
        )
        .await
    {
        log::error!("audit outbox write failed: {error}");
        return HttpResponse::ServiceUnavailable().finish();
    }
    let previous = existing.clone();
    let device = match data
        .device_lifecycle
        .revoke(&device_id, body.reason.clone(), Utc::now())
    {
        Ok(device) => device,
        Err(error) => return device_rejected(error, "DEVICE_REVOCATION_REJECTED"),
    };
    if let Err(error) = persist_revocation(&data, &device).await {
        let _ = data.device_lifecycle.restore(previous);
        log::error!("Managed-device revocation persistence failed: {error}");
        return device_persistence_failed();
    }
    HttpResponse::Ok().json(device)
}

fn device_rejected(error: &'static str, code: &'static str) -> HttpResponse {
    HttpResponse::BadRequest().json(ErrorResponse {
        success: false,
        error: error.into(),
        code: code.into(),
    })
}

fn device_persistence_failed() -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        success: false,
        error: "Managed-device storage is unavailable".into(),
        code: "DEVICE_PERSISTENCE_REQUIRED".into(),
    })
}

async fn persist_enrollment(
    data: &web::Data<AppState>,
    device: &ManagedDevice,
) -> Result<(), String> {
    let Some(pool) = data.db_pool.as_ref() else {
        return Ok(());
    };
    sqlx::query("INSERT INTO managed_devices (id, organization_id, facility_id, device_name, device_type, hardware_fingerprint, platform, status, compliance_state, next_rotation_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'enrolled','pending',$8)")
        .bind(&device.id).bind(&device.organization_id).bind(&device.facility_id)
        .bind(&device.device_name).bind(&device.device_type).bind(&device.hardware_fingerprint)
        .bind(&device.platform).bind(device.next_rotation_at).execute(pool).await
        .map_err(|error| error.to_string())?;
    Ok(())
}

async fn persist_rotation(
    data: &web::Data<AppState>,
    device: &ManagedDevice,
) -> Result<(), String> {
    let Some(pool) = data.db_pool.as_ref() else {
        return Ok(());
    };
    let result = sqlx::query("UPDATE managed_devices SET status='active', compliance_state='compliant', current_key_id=$2, last_rotation_at=$3, next_rotation_at=$4 WHERE id=$1")
        .bind(&device.id).bind(&device.current_key_id).bind(device.last_rotation_at)
        .bind(device.next_rotation_at).execute(pool).await
        .map_err(|error| error.to_string())?;
    if result.rows_affected() != 1 {
        return Err("Managed device was not persisted before rotation".into());
    }
    Ok(())
}

async fn persist_revocation(
    data: &web::Data<AppState>,
    device: &ManagedDevice,
) -> Result<(), String> {
    let Some(pool) = data.db_pool.as_ref() else {
        return Ok(());
    };
    let result = sqlx::query("UPDATE managed_devices SET status='revoked', compliance_state='non_compliant', current_key_id=NULL, revoked_at=$2, revocation_reason=$3 WHERE id=$1")
        .bind(&device.id).bind(device.revoked_at).bind(&device.revocation_reason)
        .execute(pool).await.map_err(|error| error.to_string())?;
    if result.rows_affected() != 1 {
        return Err("Managed device was not persisted before revocation".into());
    }
    Ok(())
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
