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
    // A managed device belongs to an organisation, and `managed_devices` carries
    // a foreign key to `organizations`. Before enrolment was durable, naming an
    // organisation that does not exist was silently accepted -- the device lived
    // in process memory and nothing checked. Now the insert fails, and without
    // this the operator gets an opaque persistence error for what is simply a
    // wrong identifier.
    if let Err(response) = require_known_organization(&data, &body.organization_id).await {
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

/// Refuses an enrolment naming an organisation this deployment does not have.
///
/// Checked against the database rather than the in-process store, because the
/// foreign key that will reject the insert lives there. On the memory backend
/// there is no `organizations` table and no foreign key, so there is nothing to
/// validate against and enrolment proceeds -- the check exists to turn a
/// constraint violation into a comprehensible message, not to add a rule the
/// memory backend would then enforce differently.
async fn require_known_organization(
    data: &web::Data<AppState>,
    organization_id: &str,
) -> Result<(), HttpResponse> {
    let Some(pool) = data.db_pool.as_ref() else {
        return Ok(());
    };
    // `EXISTS` yields a bool, so there is no integer width to get wrong. The
    // first cut of this selected `1` into an `Option<i64>` -- PostgreSQL returns
    // that literal as `i32` -- and the decode error was folded into `None` by an
    // `unwrap_or`, so every organisation looked absent. A query failure and an
    // unknown organisation are different answers and must not share a branch.
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM organizations WHERE id = $1)")
            .bind(organization_id)
            .fetch_one(pool)
            .await;
    match exists {
        Ok(true) => return Ok(()),
        Ok(false) => {}
        Err(error) => {
            log::error!("organisation lookup failed during device enrolment: {error}");
            return Err(device_persistence_failed());
        }
    }
    Err(HttpResponse::BadRequest().json(ErrorResponse {
        success: false,
        error: format!(
            "Unknown organisation '{organization_id}'. Enrol the device against an \
             organisation this deployment holds."
        ),
        code: "ORGANIZATION_NOT_FOUND".to_string(),
    }))
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

/// Every enrolled device in the deployment.
///
/// # Why this exists
///
/// The only device read was `GET /api/devices/compliance`, which by
/// construction returns only *non-compliant* devices -- so a healthy fleet
/// looked identical to no fleet at all, and there was no way to discover the
/// id of a working device. That id is required to issue an emergency grant,
/// which made break-glass access unreachable in practice: the id existed only
/// in the HTTP response of the enrolment call that created it, and nobody
/// keeps that.
///
/// Compliance is refreshed first, so the status shown is the status the access
/// check would apply, not the one last written.
#[get("/api/devices")]
pub async fn list_managed_devices(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    if let Err(response) = require_admin(&data, &req) {
        return response;
    }
    let _ = data.device_lifecycle.refresh_compliance(Utc::now());
    match data.device_lifecycle.list_all() {
        Ok(devices) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "count": devices.len(),
            "devices": devices,
        })),
        Err(error) => {
            log::error!("managed-device listing failed: {error}");
            device_persistence_failed()
        }
    }
}

/// The devices a clinician may actually use, right now.
///
/// # Why this is separate from `GET /api/devices`
///
/// Emergency access is bound to an approved device, and the only way to name
/// one was to type its UUID into a free-text box -- an identifier a paramedic
/// at a bedside has no way to know. The admin listing cannot fill that box: it
/// is administrative data (hardware fingerprints, key ids, revocation reasons)
/// and no clinician should hold it.
///
/// So this returns the narrowest thing that makes the choice possible -- the
/// id, what the device is, and where it lives -- and only for devices that pass
/// the same `can_access` check the grant will apply. A device listed here and
/// refused at issuance would be worse than no list at all.
#[get("/api/devices/available")]
pub async fn list_available_devices(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    let user = match require_registered_caller(&data, &req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !user.role.is_healthcare_provider() && user.role != Role::Admin {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only clinical staff may list usable devices".into(),
            code: "INSUFFICIENT_ROLE".into(),
        });
    }
    let now = Utc::now();
    let _ = data.device_lifecycle.refresh_compliance(now);
    let devices = match data.device_lifecycle.list_all() {
        Ok(devices) => devices,
        Err(error) => {
            log::error!("usable-device listing failed: {error}");
            return device_persistence_failed();
        }
    };
    let usable: Vec<serde_json::Value> = devices
        .into_iter()
        .filter(|device| data.device_lifecycle.can_access(&device.id, now))
        .map(|device| {
            serde_json::json!({
                "id": device.id,
                "device_name": device.device_name,
                "device_type": device.device_type,
                "facility_id": device.facility_id,
            })
        })
        .collect();
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "count": usable.len(),
        "devices": usable,
    }))
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

/// Who may see which devices.
///
/// # Why this table exists
///
/// Two reads were added together and they answer different questions for
/// different people. `GET /api/devices` is the administrative record --
/// hardware fingerprints, key ids, revocation reasons -- and no clinician
/// should hold it. `GET /api/devices/available` is what makes emergency access
/// usable at a bedside, so refusing a clinician there would put the free-text
/// UUID box back.
///
/// The second rule is the one worth a test: a device offered to a clinician
/// must be a device the grant will actually accept. An enrolled device that has
/// never had a credential provisioned cannot open a record, and offering it
/// would send a paramedic into a refusal during an emergency.
#[cfg(test)]
mod device_listing_access_tests {
    use crate::{AppState, Role, User};
    use actix_web::{test, web, App};

    fn state_with(users: &[(Role, &str)]) -> web::Data<AppState> {
        let state = AppState::new();
        for (role, wallet) in users {
            let user = User {
                wallet_address: wallet.to_string(),
                username: None,
                name: "Test".to_string(),
                role: role.clone(),
                created_at: chrono::Utc::now(),
                created_by: None,
                linked_patient_id: None,
                email: None,
                phone: None,
                department: None,
                specialty: None,
                license_number: None,
                status: "active".to_string(),
                last_login: None,
            };
            state
                .users
                .write()
                .unwrap()
                .insert(wallet.to_string(), user);
        }
        web::Data::new(state)
    }

    async fn get(data: web::Data<AppState>, wallet: &str, path: &str) -> (u16, String) {
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::list_managed_devices)
                .service(super::list_available_devices),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(path)
            .insert_header(("X-User-Id", wallet.to_string()))
            .to_request();
        let response = test::call_service(&app, req).await;
        let status = response.status().as_u16();
        let body = test::read_body(response).await;
        (status, String::from_utf8_lossy(&body).to_string())
    }

    #[actix_web::test]
    async fn administrative_device_record_is_admin_only() {
        let data = state_with(&[(Role::Admin, "admin-1"), (Role::Doctor, "doc-1")]);
        assert_eq!(get(data.clone(), "admin-1", "/api/devices").await.0, 200);
        assert_eq!(get(data.clone(), "doc-1", "/api/devices").await.0, 403);
        assert_eq!(get(data, "nobody", "/api/devices").await.0, 401);
    }

    #[actix_web::test]
    async fn a_clinician_may_list_the_devices_they_could_use() {
        let data = state_with(&[(Role::Doctor, "doc-1"), (Role::Patient, "pat-1")]);
        assert_eq!(
            get(data.clone(), "doc-1", "/api/devices/available").await.0,
            200
        );
        // A patient has no device to bind emergency access to.
        assert_eq!(get(data, "pat-1", "/api/devices/available").await.0, 403);
    }

    #[actix_web::test]
    async fn an_enrolled_device_is_not_offered_until_a_credential_exists() {
        let data = state_with(&[(Role::Admin, "admin-1"), (Role::Doctor, "doc-1")]);
        let device = data
            .device_lifecycle
            .enroll(
                "org-1".into(),
                None,
                "ED tablet".into(),
                "tablet".into(),
                "fingerprint-1".into(),
                None,
            )
            .unwrap();

        // Enrolled, never rotated: the administrative record shows it, the
        // clinician's picker must not -- `issue_emergency_grant` would refuse
        // it with DEVICE_NOT_APPROVED.
        let (_, admin_body) = get(data.clone(), "admin-1", "/api/devices").await;
        assert!(admin_body.contains(&device.id));
        let (_, clinical_body) = get(data.clone(), "doc-1", "/api/devices/available").await;
        assert!(!clinical_body.contains(&device.id));

        data.device_lifecycle
            .rotate(&device.id, "key-1".into(), chrono::Utc::now())
            .unwrap();
        let (_, after) = get(data.clone(), "doc-1", "/api/devices/available").await;
        assert!(after.contains(&device.id));

        // And a revoked device disappears from the picker while staying in the
        // administrative record.
        data.device_lifecycle
            .revoke(&device.id, "reported stolen".into(), chrono::Utc::now())
            .unwrap();
        let (_, after_revocation) = get(data.clone(), "doc-1", "/api/devices/available").await;
        assert!(!after_revocation.contains(&device.id));
        let (_, still_administrative) = get(data, "admin-1", "/api/devices").await;
        assert!(still_administrative.contains(&device.id));
    }

    /// The clinician's list must not carry the administrative fields.
    #[actix_web::test]
    async fn the_clinical_listing_withholds_hardware_credentials() {
        let data = state_with(&[(Role::Doctor, "doc-1")]);
        let device = data
            .device_lifecycle
            .enroll(
                "org-1".into(),
                None,
                "ED tablet".into(),
                "tablet".into(),
                "secret-fingerprint".into(),
                None,
            )
            .unwrap();
        data.device_lifecycle
            .rotate(&device.id, "secret-key-id".into(), chrono::Utc::now())
            .unwrap();

        let (status, body) = get(data, "doc-1", "/api/devices/available").await;
        assert_eq!(status, 200);
        assert!(body.contains(&device.id));
        assert!(!body.contains("secret-fingerprint"));
        assert!(!body.contains("secret-key-id"));
    }
}
