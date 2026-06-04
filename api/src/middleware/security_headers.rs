//! Security response headers (Phase 6.2).
//!
//! Adds HSTS and hardening headers to every response. TLS itself is terminated
//! by the reverse proxy (Caddy/Nginx — see `docs/TLS.md`); these headers enforce
//! the browser side: HSTS pins clients to HTTPS, and the rest mitigate MIME
//! sniffing, clickjacking, and referrer leakage of ePHI URLs.
//!
//! HSTS is only meaningful over HTTPS, so it is emitted only when the request
//! arrived over TLS (per `X-Forwarded-Proto: https` from the proxy) — this avoids
//! pinning plain-HTTP dev origins.

use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::header::{HeaderName, HeaderValue},
    Error,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use std::rc::Rc;

pub struct SecurityHeadersMiddleware;

impl<S, B> Transform<S, ServiceRequest> for SecurityHeadersMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Transform = SecurityHeadersService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(SecurityHeadersService {
            service: Rc::new(service),
        })
    }
}

pub struct SecurityHeadersService<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for SecurityHeadersService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        // Detect TLS via the proxy's forwarded-proto header.
        let is_https = req
            .headers()
            .get("X-Forwarded-Proto")
            .and_then(|v| v.to_str().ok())
            .map(|p| p.eq_ignore_ascii_case("https"))
            .unwrap_or(false);

        let fut = self.service.call(req);
        Box::pin(async move {
            let mut res = fut.await?;
            let headers = res.headers_mut();
            let mut set = |name: HeaderName, value: &'static str| {
                headers.insert(name, HeaderValue::from_static(value));
            };
            if is_https {
                set(
                    HeaderName::from_static("strict-transport-security"),
                    "max-age=31536000; includeSubDomains",
                );
            }
            set(HeaderName::from_static("x-content-type-options"), "nosniff");
            set(HeaderName::from_static("x-frame-options"), "DENY");
            set(
                HeaderName::from_static("referrer-policy"),
                "strict-origin-when-cross-origin",
            );
            Ok(res)
        })
    }
}
