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
#[derive(Debug, Deserialize, Serialize)]
pub struct InboundSmsPayload {
    pub from: String,
    pub text: String,
}

/// Constant-time byte comparison, matching the pattern already reviewed and
/// used in `clinical_endpoints::emergency_access::ct_eq`.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// The shared secret AT is configured to append to the callback URL
/// (`?secret=...`), verifying the request actually came from the configured
/// webhook, not an arbitrary caller. Resolution order mirrors other
/// project secrets: required in production, a fixed dev-only fallback that
/// `validate_production_secrets` rejects outside demo mode.
fn sms_inbound_webhook_secret() -> String {
    std::env::var("SMS_INBOUND_WEBHOOK_SECRET")
        .unwrap_or_else(|_| "medichain-dev-sms-webhook-secret-change-in-production".to_string())
}

/// Inbound SMS webhook — honors a real "reply STOP" from the carrier.
///
/// Configure this URL, **including the `secret` query parameter**, as the
/// account's inbound-messages callback in the Africa's Talking dashboard:
/// `https://<host>/api/notifications/sms/inbound?secret=<SMS_INBOUND_WEBHOOK_SECRET>`.
///
/// Horizon finding (surfaced during remediation, not one of HZ-001..011):
/// this endpoint previously had **no verification at all** that a request
/// actually came from the SMS provider — `from` and `text` were both taken
/// as attacker-controlled with zero authentication, so anyone could opt out
/// an arbitrary phone number from medication/appointment-reminder SMS by
/// posting a spoofed `from` + a STOP keyword. A carrier webhook cannot sign
/// with a wallet signature (there is no user session), so this uses a
/// shared secret in the callback URL instead — the same class of mitigation
/// most webhook providers without built-in request signing rely on.
///
/// Always returns 200 regardless of secret validity so AT doesn't retry-storm
/// on our logic — an invalid secret is silently dropped (does not run the
/// opt-out logic), not reported via status code, so a prober cannot use the
/// response to tell a valid secret from an invalid one.
#[post("/api/notifications/sms/inbound")]
pub async fn sms_inbound_webhook(
    data: web::Data<AppState>,
    query: web::Query<std::collections::HashMap<String, String>>,
    req: web::Form<InboundSmsPayload>,
) -> impl Responder {
    let secret_ok = query
        .get("secret")
        .map(|provided| ct_eq(provided.as_bytes(), sms_inbound_webhook_secret().as_bytes()))
        .unwrap_or(false);

    if secret_ok && crate::notifications::is_sms_stop_keyword(&req.text) {
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

#[cfg(test)]
mod hz_webhook_regression_tests {
    use super::*;
    use actix_web::test;

    #[actix_web::test]
    async fn missing_secret_does_not_opt_out_the_spoofed_number() {
        std::env::set_var("SMS_INBOUND_WEBHOOK_SECRET", "real-secret");
        let state = crate::AppState::new();
        let app_state = web::Data::new(state);
        let app = actix_web::App::new()
            .app_data(app_state.clone())
            .service(sms_inbound_webhook);
        let app = test::init_service(app).await;

        let req = test::TestRequest::post()
            .uri("/api/notifications/sms/inbound")
            .set_form(&InboundSmsPayload {
                from: "+27000000000".to_string(),
                text: "STOP".to_string(),
            })
            .to_request();
        let resp = test::call_service(&app, req).await;
        // Always 200 (no retry-storm signal) ...
        assert!(resp.status().is_success());
        // ... but the spoofed number must NOT actually be opted out.
        let opted_out = app_state
            .repositories
            .sms_opt_outs
            .is_opted_out("+27000000000")
            .await
            .unwrap_or(false);
        assert!(!opted_out, "an unauthenticated caller must not be able to opt out an arbitrary number");
        std::env::remove_var("SMS_INBOUND_WEBHOOK_SECRET");
    }

    #[actix_web::test]
    async fn correct_secret_honors_a_real_stop_reply() {
        std::env::set_var("SMS_INBOUND_WEBHOOK_SECRET", "real-secret");
        let state = crate::AppState::new();
        let app_state = web::Data::new(state);
        let app = actix_web::App::new()
            .app_data(app_state.clone())
            .service(sms_inbound_webhook);
        let app = test::init_service(app).await;

        let req = test::TestRequest::post()
            .uri("/api/notifications/sms/inbound?secret=real-secret")
            .set_form(&InboundSmsPayload {
                from: "+27111111111".to_string(),
                text: "STOP".to_string(),
            })
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let opted_out = app_state
            .repositories
            .sms_opt_outs
            .is_opted_out("+27111111111")
            .await
            .unwrap_or(false);
        assert!(opted_out, "a correctly authenticated STOP reply must still work");
        std::env::remove_var("SMS_INBOUND_WEBHOOK_SECRET");
    }
}
