//! JWT-to-legacy identity bridge for the incremental client migration.
//!
//! Some established handlers still read `X-User-Id` directly. Normal browser
//! sessions now send only a Bearer access token, so this middleware inserts the
//! verified JWT subject as that header *after* signature authentication has
//! processed any client-supplied header. This keeps the old handler contract
//! working without transmitting a raw wallet identifier from JWT-authenticated
//! clients.

use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::header::{HeaderName, HeaderValue},
    Error,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use std::rc::Rc;

const LEGACY_IDENTITY_HEADER: HeaderName = HeaderName::from_static("x-user-id");

/// Add a server-derived legacy identity only when the caller supplied no
/// identity header and the Bearer token has already been cryptographically
/// verified. Invalid tokens and client-supplied headers are deliberately left
/// unchanged for the normal downstream policy to handle.
fn inject_verified_jwt_subject(req: &mut ServiceRequest) {
    if req.headers().contains_key(&LEGACY_IDENTITY_HEADER) {
        return;
    }

    let Some(claims) = crate::support::get_current_claims(req.request()) else {
        return;
    };

    let Ok(subject) = HeaderValue::from_str(&claims.sub) else {
        return;
    };
    req.headers_mut().insert(LEGACY_IDENTITY_HEADER, subject);
}

pub struct JwtIdentityMiddleware;

impl<S, B> Transform<S, ServiceRequest> for JwtIdentityMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Transform = JwtIdentityMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(JwtIdentityMiddlewareService {
            service: Rc::new(service),
        })
    }
}

pub struct JwtIdentityMiddlewareService<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for JwtIdentityMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, mut req: ServiceRequest) -> Self::Future {
        inject_verified_jwt_subject(&mut req);
        let future = self.service.call(req);
        Box::pin(future)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test as actix_test, test::TestRequest, web, App, HttpRequest, HttpResponse};

    const WALLET: &str = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

    #[test]
    fn injects_only_a_verified_access_token_subject() {
        let token =
            crate::security::jwt::issue_access_token(WALLET, "Doctor", false, None).unwrap();
        let mut request = TestRequest::default()
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_srv_request();

        inject_verified_jwt_subject(&mut request);

        assert_eq!(
            request
                .headers()
                .get(&LEGACY_IDENTITY_HEADER)
                .and_then(|value| value.to_str().ok()),
            Some(WALLET)
        );
    }

    #[test]
    fn leaves_an_invalid_bearer_token_without_legacy_identity() {
        let mut request = TestRequest::default()
            .insert_header(("Authorization", "Bearer not-a-token"))
            .to_srv_request();

        inject_verified_jwt_subject(&mut request);

        assert!(!request.headers().contains_key(&LEGACY_IDENTITY_HEADER));
    }

    #[test]
    fn never_replaces_a_client_supplied_legacy_identity() {
        let token =
            crate::security::jwt::issue_access_token(WALLET, "Doctor", false, None).unwrap();
        let mut request = TestRequest::default()
            .insert_header(("Authorization", format!("Bearer {token}")))
            .insert_header((LEGACY_IDENTITY_HEADER.clone(), "client-supplied"))
            .to_srv_request();

        inject_verified_jwt_subject(&mut request);

        assert_eq!(
            request
                .headers()
                .get(&LEGACY_IDENTITY_HEADER)
                .and_then(|value| value.to_str().ok()),
            Some("client-supplied")
        );
    }

    #[actix_web::test]
    async fn makes_a_bearer_subject_available_to_a_legacy_handler() {
        let app = actix_test::init_service(App::new().wrap(JwtIdentityMiddleware).route(
            "/identity",
            web::get().to(|req: HttpRequest| async move {
                HttpResponse::Ok().body(
                    req.headers()
                        .get(&LEGACY_IDENTITY_HEADER)
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or_default()
                        .to_string(),
                )
            }),
        ))
        .await;
        let token =
            crate::security::jwt::issue_access_token(WALLET, "Doctor", false, None).unwrap();
        let request = TestRequest::get()
            .uri("/identity")
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_request();

        let response = actix_test::call_service(&app, request).await;

        assert!(response.status().is_success());
        assert_eq!(actix_test::read_body(response).await, WALLET.as_bytes());
    }

    #[actix_web::test]
    async fn bearer_identity_reaches_legacy_handler_after_signature_middleware() {
        let app = actix_test::init_service(
            App::new()
                // This is the production order: signature authentication sees
                // client input before the JWT bridge creates any legacy header.
                .wrap(JwtIdentityMiddleware)
                .wrap(crate::middleware::signature_auth::SignatureAuthMiddleware::enabled())
                .route(
                    "/identity",
                    web::get().to(|req: HttpRequest| async move {
                        HttpResponse::Ok().body(
                            req.headers()
                                .get(&LEGACY_IDENTITY_HEADER)
                                .and_then(|value| value.to_str().ok())
                                .unwrap_or_default()
                                .to_string(),
                        )
                    }),
                ),
        )
        .await;
        let token =
            crate::security::jwt::issue_access_token(WALLET, "Doctor", false, None).unwrap();
        let request = TestRequest::get()
            .uri("/identity")
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_request();

        let response = actix_test::call_service(&app, request).await;

        assert!(response.status().is_success());
        assert_eq!(actix_test::read_body(response).await, WALLET.as_bytes());
    }
}
