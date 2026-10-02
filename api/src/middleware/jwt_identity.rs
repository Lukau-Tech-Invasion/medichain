//! JWT-to-legacy identity bridge for handlers still reading `X-User-Id`.
//!
//! Some established handlers still read `X-User-Id` directly. Normal browser
//! sessions now send only a Bearer access token, so this middleware inserts the
//! verified JWT subject as that header. A client-supplied identity header is
//! always discarded; otherwise those handlers could trust a forged identity.

use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::header::{HeaderName, HeaderValue},
    Error,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use std::rc::Rc;

const LEGACY_IDENTITY_HEADER: HeaderName = HeaderName::from_static("x-user-id");

/// Replace any client-supplied identity with the verified JWT subject.
/// Invalid or absent tokens leave no identity header for legacy handlers.
fn inject_verified_jwt_subject(req: &mut ServiceRequest) {
    req.headers_mut().remove(&LEGACY_IDENTITY_HEADER);

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

    const USER_ID: &str = "123e4567-e89b-12d3-a456-426614174000";

    #[test]
    fn injects_only_a_verified_access_token_subject() {
        let token =
            crate::security::jwt::issue_access_token(USER_ID, "Doctor", false, None).unwrap();
        let mut request = TestRequest::default()
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_srv_request();

        inject_verified_jwt_subject(&mut request);

        assert_eq!(
            request
                .headers()
                .get(&LEGACY_IDENTITY_HEADER)
                .and_then(|value| value.to_str().ok()),
            Some(USER_ID)
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
    fn replaces_a_client_supplied_legacy_identity() {
        let token =
            crate::security::jwt::issue_access_token(USER_ID, "Doctor", false, None).unwrap();
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
            Some(USER_ID)
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
            crate::security::jwt::issue_access_token(USER_ID, "Doctor", false, None).unwrap();
        let request = TestRequest::get()
            .uri("/identity")
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_request();

        let response = actix_test::call_service(&app, request).await;

        assert!(response.status().is_success());
        assert_eq!(actix_test::read_body(response).await, USER_ID.as_bytes());
    }
}
