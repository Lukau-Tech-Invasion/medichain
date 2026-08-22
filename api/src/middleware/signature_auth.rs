//! Wallet Signature Authentication Middleware (SEC-005)
//!
//! Provides cryptographic verification of wallet ownership via sr25519 signatures.
//! Prevents spoofing of X-User-Id header by requiring a valid signature.
//!
//! **Headers Required:**
//! - `X-User-Id`: SS58-encoded wallet address (e.g., "5Grw...tQY")
//! - `X-Signature`: Hex-encoded sr25519 signature of the message
//! - `X-Timestamp`: Unix timestamp used in the signed message
//!
//! **Message Format:** `<timestamp>:<wallet_address>:<method>:<path>:<body_hash_hex>`
//! (Horizon HZ-007 — previously `<timestamp>:<wallet_address>` only, which meant a
//! captured `(signature, timestamp)` pair authorized *any* request as that wallet
//! for the rest of the 5-minute window, not just the one it was made for.)
//!
//! **Security Properties:**
//! - Replay protection via timestamp validation (5-minute window)
//! - Wallet ownership proof via sr25519 signature verification
//! - The signature is bound to this exact method, path, and request body — a
//!   captured signature cannot be replayed against a different action
//! - Constant-time signature comparison
//!
//! # Trust invariant
//!
//! Handlers downstream may treat the `X-User-Id` header as the caller's identity
//! ONLY because this middleware, **when enabled**, binds that header to a verified
//! sr25519 signature over `<timestamp>:<wallet>:<method>:<path>:<body_hash>` for
//! THIS request. A mutating request that presents `X-User-Id` without a valid
//! `X-Signature`/`X-Timestamp` is rejected.
//!
//! When verification is DISABLED (demo mode), `X-User-Id` is **unauthenticated and
//! spoofable** — it is for local/demo use only and MUST NOT be relied upon for any
//! authorization decision in production. The server logs a loud warning at startup
//! whenever it boots with verification disabled.
//!
//! © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.

use actix_web::http::StatusCode;
use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Payload, Service, ServiceRequest, ServiceResponse, Transform},
    web::{Bytes, BytesMut},
    Error, HttpMessage, HttpResponse,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use futures::StreamExt;
use medichain_crypto::signature::{
    verify_wallet_signature_bound, SignatureError, MAX_TIMESTAMP_DRIFT_SECS,
};
use std::rc::Rc;

/// Routes that bypass signature verification
const BYPASS_ROUTES: &[&str] = &[
    "/api/health",
    "/api/version",
    "/api/auth/challenge", // Returns challenge for signing
    "/api/metrics",
    "/api/fhir/r4/metadata",
];

/// Signature authentication middleware factory
pub struct SignatureAuthMiddleware {
    /// Enable or disable signature verification (for gradual rollout)
    enabled: bool,
}

impl SignatureAuthMiddleware {
    /// Create enabled middleware
    pub fn enabled() -> Self {
        Self { enabled: true }
    }

    /// Create disabled middleware (for backward compatibility during transition)
    pub fn disabled() -> Self {
        Self { enabled: false }
    }
}

impl<S, B> Transform<S, ServiceRequest> for SignatureAuthMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Transform = SignatureAuthMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(SignatureAuthMiddlewareService {
            service: Rc::new(service),
            enabled: self.enabled,
        })
    }
}

pub struct SignatureAuthMiddlewareService<S> {
    service: Rc<S>,
    enabled: bool,
}

impl<S> Clone for SignatureAuthMiddlewareService<S> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            enabled: self.enabled,
        }
    }
}

impl<S, B> Service<ServiceRequest> for SignatureAuthMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, mut req: ServiceRequest) -> Self::Future {
        let service = self.service.clone();
        let enabled = self.enabled;

        Box::pin(async move {
            // Skip verification if disabled
            if !enabled {
                let res = service.call(req).await?;
                return Ok(res.map_into_left_body());
            }

            // Check if route bypasses signature verification
            let path = req.path();
            if BYPASS_ROUTES.iter().any(|r| path.starts_with(r)) {
                let res = service.call(req).await?;
                return Ok(res.map_into_left_body());
            }

            // Only verify on routes that require authentication
            // GET requests to public resources don't need signature
            let method = req.method();
            if method == actix_web::http::Method::OPTIONS {
                let res = service.call(req).await?;
                return Ok(res.map_into_left_body());
            }

            // Extract required headers
            let headers = req.headers();

            let user_id = headers.get("X-User-Id").and_then(|v| v.to_str().ok());

            // If no user ID, let endpoint handle authentication
            let Some(wallet_address) = user_id else {
                let res = service.call(req).await?;
                return Ok(res.map_into_left_body());
            };
            let wallet_address = wallet_address.to_string();

            // For authenticated requests, require signature
            let signature = headers
                .get("X-Signature")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            let timestamp = headers
                .get("X-Timestamp")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<i64>().ok());

            // If signature or timestamp missing, reject
            let (Some(signature), Some(msg_timestamp)) = (signature, timestamp) else {
                let response = HttpResponse::Unauthorized().json(
                    crate::middleware::error_handling::error_envelope_json(
                        crate::middleware::error_handling::error_codes::UNAUTHORIZED,
                        "Authenticated requests require X-Signature and X-Timestamp headers",
                        Some(serde_json::json!({
                            "hint": "Sign message '<timestamp>:<wallet_address>:<method>:<path>:<body_hash>' with your wallet"
                        })),
                    ),
                );
                return Ok(req.into_response(response).map_into_right_body());
            };

            // Capture method + path as owned values before buffering the body,
            // which needs a mutable borrow of `req` (`take_payload`).
            let method_str = req.method().as_str().to_string();
            let path_str = req.path().to_string();

            // Buffer the request body so its hash can be bound into the signed
            // message (Horizon HZ-007), then restore it unchanged so the
            // handler's own extractor (`web::Json<T>`, etc.) still sees it.
            let mut body_bytes = BytesMut::new();
            {
                let mut payload = req.take_payload();
                while let Some(chunk) = payload.next().await {
                    let chunk = chunk?;
                    body_bytes.extend_from_slice(&chunk);
                }
            }
            let body_bytes: Bytes = body_bytes.freeze();
            let body_hash_hex = hex::encode(medichain_crypto::sha256(&body_bytes));
            req.set_payload(Payload::from(body_bytes));

            // Get current timestamp
            let current_timestamp = chrono::Utc::now().timestamp();

            // Construct the message that was signed
            let message = medichain_crypto::signature::create_bound_sign_message(
                msg_timestamp,
                &wallet_address,
                &method_str,
                &path_str,
                &body_hash_hex,
            );

            // Verify signature
            match verify_wallet_signature_bound(
                &signature,
                &message,
                &wallet_address,
                &method_str,
                &path_str,
                &body_hash_hex,
                current_timestamp,
            ) {
                Ok(()) => {
                    // Signature valid, proceed with request
                    let res = service.call(req).await?;
                    Ok(res.map_into_left_body())
                }
                Err(e) => {
                    let (status, error_msg) = match e {
                        SignatureError::TimestampExpired => (
                            StatusCode::UNAUTHORIZED,
                            format!(
                                "Timestamp expired. Must be within {} seconds of current time.",
                                MAX_TIMESTAMP_DRIFT_SECS
                            ),
                        ),
                        SignatureError::VerificationFailed => (
                            StatusCode::FORBIDDEN,
                            "Signature verification failed. Ensure you signed with the correct wallet.".to_string(),
                        ),
                        SignatureError::InvalidSignatureFormat => (
                            StatusCode::BAD_REQUEST,
                            "Invalid signature format. Expected 64-byte hex-encoded sr25519 signature.".to_string(),
                        ),
                        SignatureError::InvalidMessageFormat => (
                            StatusCode::BAD_REQUEST,
                            "Invalid message format. Expected \
                             '<timestamp>:<wallet_address>:<method>:<path>:<body_hash>'."
                                .to_string(),
                        ),
                        _ => (
                            StatusCode::UNAUTHORIZED,
                            format!("Authentication error: {}", e),
                        ),
                    };

                    log::warn!(
                        "Signature verification failed for wallet {}: {}",
                        wallet_address,
                        error_msg
                    );

                    let response = HttpResponse::build(status).json(serde_json::json!({
                        "error": "Signature verification failed",
                        "message": error_msg
                    }));
                    Ok(req.into_response(response).map_into_right_body())
                }
            }
        })
    }
}

/// Generate a one-time wallet-ownership challenge (timestamp + wallet only).
///
/// This message proves wallet ownership at a point in time — suited to a
/// login-style exchange (e.g. `issue_jwt`, which verifies the same
/// `<timestamp>:<wallet>` format), **not** to `SignatureAuthMiddleware`'s
/// per-request signature requirement (Horizon HZ-007). This middleware binds
/// every request's signature to that request's own method, path, and body via
/// `create_bound_sign_message`/`verify_wallet_signature_bound` — a signature
/// over this challenge's plain `<timestamp>:<wallet>` message will not satisfy
/// it. No current client calls this endpoint; if one starts signing live
/// per-request actions from a challenge, it must construct the bound message
/// itself, the same way `client/shared/src/api/client.ts` does inline.
#[allow(dead_code)] // Legacy timestamp challenge; JWT login now uses durable nonce challenges.
pub fn generate_auth_challenge(wallet_address: &str) -> AuthChallenge {
    let timestamp = chrono::Utc::now().timestamp();
    let message = format!("{}:{}", timestamp, wallet_address);

    AuthChallenge {
        wallet: wallet_address.to_string(),
        timestamp,
        message,
        expires_in_secs: MAX_TIMESTAMP_DRIFT_SECS,
    }
}

/// Authentication challenge response
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[allow(dead_code)] // Kept with the legacy helper until downstream clients are migrated.
pub struct AuthChallenge {
    /// Wallet address for the challenge
    pub wallet: String,
    /// Unix timestamp to include in signature
    pub timestamp: i64,
    /// Full message to sign: "<timestamp>:<wallet>"
    pub message: String,
    /// Seconds until this challenge expires
    pub expires_in_secs: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_auth_challenge() {
        let wallet = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
        let challenge = generate_auth_challenge(wallet);

        assert_eq!(challenge.wallet, wallet);
        assert!(challenge.timestamp > 0);
        assert!(challenge.message.contains(wallet));
        assert!(challenge.message.contains(&challenge.timestamp.to_string()));
        assert_eq!(challenge.expires_in_secs, MAX_TIMESTAMP_DRIFT_SECS);
    }

    #[test]
    fn test_bypass_routes_include_health() {
        assert!(BYPASS_ROUTES.contains(&"/api/health"));
    }

    /// SECURE-BY-DEFAULT: a mutating request that supplies `X-User-Id` but no
    /// `X-Signature`/`X-Timestamp` MUST be rejected (401) when the middleware is
    /// enabled — the server must never trust an unverified identity header.
    #[actix_web::test]
    async fn test_enabled_rejects_post_with_user_id_but_no_signature() {
        use actix_web::{test, web, App, HttpResponse};

        let app = test::init_service(App::new().wrap(SignatureAuthMiddleware::enabled()).route(
            "/api/patients/{id}",
            web::post().to(|| async { HttpResponse::Ok().finish() }),
        ))
        .await;

        let req = test::TestRequest::post()
            .uri("/api/patients/PAT-001")
            .insert_header((
                "X-User-Id",
                "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
            ))
            .to_request();
        let resp = test::call_service(&app, req).await;

        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNAUTHORIZED,
            "POST with X-User-Id but no signature must be rejected when verification is enabled"
        );
    }

    /// Counterpart: with the middleware DISABLED (demo mode), the same request is
    /// allowed through — documenting that disabled mode does NOT verify identity.
    #[actix_web::test]
    async fn test_disabled_allows_post_without_signature() {
        use actix_web::{test, web, App, HttpResponse};

        let app = test::init_service(App::new().wrap(SignatureAuthMiddleware::disabled()).route(
            "/api/patients/{id}",
            web::post().to(|| async { HttpResponse::Ok().finish() }),
        ))
        .await;

        let req = test::TestRequest::post()
            .uri("/api/patients/PAT-001")
            .insert_header((
                "X-User-Id",
                "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
            ))
            .to_request();
        let resp = test::call_service(&app, req).await;

        assert!(
            resp.status().is_success(),
            "demo mode (disabled) must let X-User-Id through unverified"
        );
    }
}
