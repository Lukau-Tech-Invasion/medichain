use super::*;

// ============================================================================
// Session Token Endpoints
// ============================================================================

#[post("/api/notifications/register-device")]
pub async fn register_device(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<DeviceRegistrationRequest>,
) -> impl Responder {
    let user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let entity = crate::repositories::traits::DeviceTokenEntity {
        id: Uuid::new_v4().to_string(),
        user_id: user_id.to_string(),
        token: req.token.clone(),
        device_type: req.device_type.clone(),
        device_name: req.device_name.clone(),
        last_seen_at: Utc::now(),
        created_at: Utc::now(),
    };

    match data.repositories.device_tokens.register(entity).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "status": "registered"
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "REPOSITORY_ERROR".to_string(),
        }),
    }
}
