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

/// The devices this patient has registered.
///
/// # Why this exists
///
/// Four mobile endpoints existed and every one of them writes. A device id is
/// returned exactly once — in the response to the registration that created it
/// — so a patient who lost a phone had no way to name the device they wanted
/// revoked, and `POST /api/mobile/devices/{id}/revoke` was unreachable in
/// practice.
///
/// Scoped to the caller, not to a `{patient_id}` in the path: the screen asking
/// this is "my devices", the caller has no id to send, and a path parameter
/// would invite passing somebody else's.
///
/// Revoked devices are listed and marked. Someone who has just lost a phone
/// needs to see that the revocation took effect.
#[get("/api/mobile/devices")]
pub async fn list_patient_mobile_devices(
    data: web::Data<AppState>,
    req: HttpRequest,
) -> impl Responder {
    let patient_id = match authenticated_patient_id(&data, &req) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match data.mobile_records.list_devices_durable(&patient_id).await {
        Ok(devices) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "count": devices.len(),
            "devices": devices,
        })),
        Err(error) => {
            log::error!("mobile device listing failed: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: error.into(),
                code: "MOBILE_DEVICE_STORE_UNAVAILABLE".into(),
            })
        }
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

/// Whose devices a caller sees.
///
/// # Why this table exists
///
/// This listing is caller-scoped rather than `{patient_id}`-scoped, so its
/// boundary is not a 403 on somebody else's URL — there is no URL to try. The
/// only way it can leak is by returning a row belonging to another patient, and
/// the only way it can break is by refusing a caller who has a patient
/// identity. Both are asserted here.
#[cfg(test)]
mod mobile_device_listing_tests {
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

    async fn list(data: web::Data<AppState>, wallet: &str) -> (u16, String) {
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::list_patient_mobile_devices),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/mobile/devices")
            .insert_header(("X-User-Id", wallet.to_string()))
            .to_request();
        let response = test::call_service(&app, req).await;
        let status = response.status().as_u16();
        let body = test::read_body(response).await;
        (status, String::from_utf8_lossy(&body).to_string())
    }

    #[actix_web::test]
    async fn a_patient_sees_only_their_own_devices() {
        let data = state(vec![
            user(Role::Patient, "wallet-a", Some("PAT-1")),
            user(Role::Patient, "wallet-b", Some("PAT-2")),
        ]);
        let mine = data
            .mobile_records
            .register_device_durable(
                "PAT-1".into(),
                "Patient A phone".into(),
                crate::mobile_records::MobilePlatform::Android,
                "pk-a".into(),
            )
            .await
            .unwrap();
        let theirs = data
            .mobile_records
            .register_device_durable(
                "PAT-2".into(),
                "Patient B phone".into(),
                crate::mobile_records::MobilePlatform::Android,
                "pk-b".into(),
            )
            .await
            .unwrap();

        let (status, body) = list(data.clone(), "wallet-a").await;
        assert_eq!(status, 200);
        assert!(body.contains(&mine.id));
        assert!(!body.contains(&theirs.id));

        let (_, other) = list(data, "wallet-b").await;
        assert!(other.contains(&theirs.id));
        assert!(!other.contains(&mine.id));
    }

    /// A revoked device stays in the list. Someone who has just lost a phone
    /// needs to see that the revocation took effect, and an entry that
    /// disappears looks the same as one that was never there.
    #[actix_web::test]
    async fn a_revoked_device_is_still_listed() {
        let data = state(vec![user(Role::Patient, "wallet-a", Some("PAT-1"))]);
        let device = data
            .mobile_records
            .register_device_durable(
                "PAT-1".into(),
                "Lost phone".into(),
                crate::mobile_records::MobilePlatform::Android,
                "pk-a".into(),
            )
            .await
            .unwrap();
        data.mobile_records
            .revoke_device_durable(&device.id, "reported lost".into(), chrono::Utc::now())
            .await
            .unwrap();

        let (status, body) = list(data, "wallet-a").await;
        assert_eq!(status, 200);
        assert!(body.contains(&device.id));
        assert!(body.contains("revoked"));
    }

    /// A clinician has no patient identity, so there is no "my devices" for
    /// them to ask about — and the refusal must not be mistaken for an empty
    /// list.
    #[actix_web::test]
    async fn a_caller_without_a_patient_identity_is_refused() {
        let data = state(vec![user(Role::Doctor, "doc-1", None)]);
        assert_eq!(list(data.clone(), "doc-1").await.0, 403);
        assert_eq!(list(data, "nobody").await.0, 401);
    }
}
