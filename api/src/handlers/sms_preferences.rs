//! SMS opt-in/opt-out preference endpoints (Phase 5.3).
//!
//! `SmsOptOutRepository` (persistent, memory + PostgreSQL) and its
//! `is_opted_out` check in `notifications::send_sms_with_retry` already
//! existed, but nothing ever called `add_opt_out`/`remove_opt_out` — the STOP
//! keyword footer told patients how to opt out with no working mechanism
//! behind it. This adds that mechanism: a self-service endpoint pair, plus an
//! inbound-SMS webhook for real "reply STOP" handling from Africa's Talking
//! (payload format per AT's inbound-messages callback; unverified against a
//! live AT account in this environment, same class of limitation as the rest
//! of the AT integration).

use super::*;

#[derive(Debug, Deserialize)]
pub struct SmsOptPreferenceRequest {
    pub phone_number: String,
}

/// Opt a phone number out of SMS notifications
#[post("/api/notifications/sms/opt-out")]
pub async fn sms_opt_out(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<SmsOptPreferenceRequest>,
) -> impl Responder {
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }

    let entity = crate::repositories::traits::SmsOptOutEntity {
        phone_number: req.phone_number.clone(),
        opted_out_at: Utc::now(),
        source: Some("patient_self_service".to_string()),
        reason: None,
    };
    match data.repositories.sms_opt_outs.add_opt_out(entity).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Opted out of SMS notifications"
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Opt a phone number back in to SMS notifications
#[post("/api/notifications/sms/opt-in")]
pub async fn sms_opt_in(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<SmsOptPreferenceRequest>,
) -> impl Responder {
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }

    match data
        .repositories
        .sms_opt_outs
        .remove_opt_out(&req.phone_number)
        .await
    {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Opted back in to SMS notifications"
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Whether a phone number is currently opted out
#[get("/api/notifications/sms/opt-out/{phone_number}")]
pub async fn get_sms_opt_out_status(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }

    let phone_number = path.into_inner();
    let opted_out = data
        .repositories
        .sms_opt_outs
        .is_opted_out(&phone_number)
        .await
        .unwrap_or(false);

    HttpResponse::Ok().json(serde_json::json!({
        "phone_number": phone_number,
        "opted_out": opted_out
    }))
}

/// Africa's Talking inbound-SMS callback payload (subset used here).
/// AT posts `application/x-www-form-urlencoded` with `from`/`to`/`text`/`id`/`date`.
#[derive(Debug, Deserialize)]
pub struct InboundSmsPayload {
    pub from: String,
    pub text: String,
}

/// Inbound SMS webhook — honors a real "reply STOP" from the carrier.
/// Configure this URL as the account's inbound-messages callback in the
/// Africa's Talking dashboard. No auth (carrier-to-server webhook, not a
/// user action); always returns 200 so AT doesn't retry-storm on our logic.
#[post("/api/notifications/sms/inbound")]
pub async fn sms_inbound_webhook(
    data: web::Data<AppState>,
    req: web::Form<InboundSmsPayload>,
) -> impl Responder {
    if crate::notifications::is_sms_stop_keyword(&req.text) {
        let entity = crate::repositories::traits::SmsOptOutEntity {
            phone_number: req.from.clone(),
            opted_out_at: Utc::now(),
            source: Some("sms_stop_reply".to_string()),
            reason: Some(req.text.clone()),
        };
        let _ = data.repositories.sms_opt_outs.add_opt_out(entity).await;
    }
    HttpResponse::Ok().finish()
}
