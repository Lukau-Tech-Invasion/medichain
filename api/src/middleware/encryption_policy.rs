//! Middleware to enforce encryption policies for specific API routes.
//! Ensures that sensitive clinical data is never transmitted over unencrypted
//! channels and supports key-rotation policies.

use actix_web::{
    body::{EitherBody, MessageBody},
    dev::{Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpResponse,
};
use futures_util::future::LocalBoxFuture;
use std::future::{ready, Ready};

/// Routes exempt from the encryption-required check: infra probes hit directly
/// by container orchestration (bypassing the TLS-terminating reverse proxy) and
/// the pre-auth challenge endpoint, mirroring `signature_auth::BYPASS_ROUTES`.
///
/// Deliberately a small deny-list rather than an allow-list of "sensitive"
/// prefixes: an allow-list silently stops covering new clinical routes unless
/// remembered on every addition (which is exactly how this policy previously
/// missed `/api/surgical`, `/api/platform`, `/api/patients`, `/api/fhir`,
/// `/api/lab*`, `/api/wearables`, `/api/insurance`, `/api/telehealth`,
/// `/api/e-prescriptions`, `/api/family`, `/api/records`, `/api/medical-id`,
/// and `/api/consent` — all PHI-bearing). Defaulting to "requires encryption"
/// means newly-added routes are covered automatically.
const HTTP_EXEMPT_ROUTES: &[&str] = &[
    "/health",
    "/api/health",
    "/api/metrics",
    "/api/version",
    "/api/auth/challenge",
    "/api/fhir/r4/metadata",
];

/// Exemptions are endpoint identities, not path prefixes. Prefix matching
/// would accidentally exempt a future protected route such as
/// `/api/metrics-private` from the HTTPS policy.
fn is_http_exempt_route(path: &str) -> bool {
    HTTP_EXEMPT_ROUTES.contains(&path)
}

pub struct EncryptionPolicyMiddleware {
    enabled: bool,
}

impl EncryptionPolicyMiddleware {
    pub fn new(enabled: bool) -> Self {
        Self { enabled }
    }

    pub fn enabled() -> Self {
        Self::new(true)
    }
}

impl<S, B> Transform<S, ServiceRequest> for EncryptionPolicyMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Transform = EncryptionPolicyMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(EncryptionPolicyMiddlewareService {
            service,
            enabled: self.enabled,
        }))
    }
}

pub struct EncryptionPolicyMiddlewareService<S> {
    service: S,
    enabled: bool,
}

impl<S, B> Service<ServiceRequest> for EncryptionPolicyMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(
        &self,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        self.service.poll_ready(cx)
    }

    fn call(&self, req: ServiceRequest) -> Self::Future {
        if !self.enabled {
            let fut = self.service.call(req);
            return Box::pin(async move { fut.await.map(ServiceResponse::map_into_left_body) });
        }

        // Every /api/ route carries PHI or auth material unless explicitly
        // exempted above — see HTTP_EXEMPT_ROUTES for why this is a deny-list.
        let path = req.path();
        let is_sensitive = path.starts_with("/api/") && !is_http_exempt_route(path);

        if is_sensitive && req.connection_info().scheme() != "https" {
            // In development, we might allow http, so we check an env var
            let allow_http = std::env::var("ALLOW_HTTP_SENSITIVE")
                .map(|v| v == "true")
                .unwrap_or(false);

            if !allow_http {
                let (http_req, _payload) = req.into_parts();
                let res = HttpResponse::Forbidden()
                    .json(crate::middleware::error_handling::error_envelope_json(
                        crate::middleware::error_handling::error_codes::ENCRYPTION_REQUIRED,
                        "Encryption required. This endpoint only accepts HTTPS connections.",
                        None,
                    ))
                    .map_into_right_body();
                return Box::pin(ready(Ok(ServiceResponse::new(http_req, res))));
            }
        }

        let fut = self.service.call(req);
        Box::pin(async move { fut.await.map(ServiceResponse::map_into_left_body) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{http::StatusCode, test, web, App, HttpResponse};

    async fn ok_handler() -> HttpResponse {
        HttpResponse::Ok().finish()
    }

    #[actix_web::test]
    async fn exempt_routes_bypass_the_https_check() {
        let app = test::init_service(
            App::new()
                .wrap(EncryptionPolicyMiddleware::enabled())
                .route("/api/health", web::get().to(ok_handler))
                .route("/health", web::get().to(ok_handler)),
        )
        .await;

        for path in ["/api/health", "/health"] {
            let req = test::TestRequest::get().uri(path).to_request();
            let resp = test::call_service(&app, req).await;
            assert!(
                resp.status().is_success(),
                "{path} should bypass the policy"
            );
        }
    }

    #[actix_web::test]
    async fn public_prefix_lookalike_requires_https() {
        let app = test::init_service(
            App::new()
                .wrap(EncryptionPolicyMiddleware::enabled())
                .route("/api/metrics-private", web::get().to(ok_handler)),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/metrics-private")
            .to_request();
        let response = test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    /// These prefixes carry PHI but were NOT covered by the old allow-list
    /// (`/api/clinical`, `/api/emergency` only) — this is the bug this pass fixes.
    #[actix_web::test]
    async fn previously_uncovered_phi_prefixes_now_require_https() {
        let app = test::init_service(
            App::new()
                .wrap(EncryptionPolicyMiddleware::enabled())
                .route("/api/surgical/notes", web::get().to(ok_handler))
                .route("/api/patients/{id}", web::get().to(ok_handler))
                .route("/api/fhir/r4/Patient", web::get().to(ok_handler)),
        )
        .await;

        for path in [
            "/api/surgical/notes",
            "/api/patients/123",
            "/api/fhir/r4/Patient",
        ] {
            let req = test::TestRequest::get().uri(path).to_request();
            let resp = test::call_service(&app, req).await;
            assert_eq!(
                resp.status(),
                StatusCode::FORBIDDEN,
                "{path} must require HTTPS now that the policy defaults to requiring encryption"
            );
        }
    }

    #[actix_web::test]
    async fn forwarded_https_requests_are_allowed_through() {
        let app = test::init_service(
            App::new()
                .wrap(EncryptionPolicyMiddleware::enabled())
                .route("/api/patients/{id}", web::get().to(ok_handler)),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/patients/123")
            .insert_header(("X-Forwarded-Proto", "https"))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    #[actix_web::test]
    async fn disabled_policy_allows_everything() {
        let app = test::init_service(
            App::new()
                .wrap(EncryptionPolicyMiddleware::new(false))
                .route("/api/patients/{id}", web::get().to(ok_handler)),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/patients/123")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }
}
