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

        // List of endpoints that REQUIRE encryption (usually POST/PUT for clinical data)
        let path = req.path();
        let is_sensitive = path.starts_with("/api/clinical") || path.starts_with("/api/emergency");

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
