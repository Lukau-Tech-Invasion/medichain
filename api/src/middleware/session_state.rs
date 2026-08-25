//! Revoked-session enforcement for Bearer-authenticated requests (ADR-0008).
//!
//! A JWT stays cryptographically valid until it expires. Without this check,
//! signing out would revoke the refresh generation while the access token kept
//! working for the rest of its lifetime -- logout would not actually terminate
//! the authenticated session, and neither would "sign out everywhere" after a
//! device was lost. For a system holding health records, immediate revocation is
//! worth a lookup.
//!
//! The database is authoritative, not the claim. The token asserts a `sid`; this
//! middleware confirms that session still exists, still belongs to the subject
//! the token names, and has not been revoked.
//!
//! It runs *before* `JwtIdentityMiddleware`, so a revoked session never reaches
//! the point where its subject would be injected as a downstream identity.

use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpResponse,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use sqlx::PgPool;
use std::rc::Rc;
use uuid::Uuid;

/// One `auth_login_sessions` row as this middleware reads it: who the session
/// belongs to, and whether it has been revoked.
type SessionRow = (String, Option<chrono::DateTime<chrono::Utc>>);

/// Outcome of checking one request's session claim.
enum SessionVerdict {
    /// No Bearer token, or a token predating ADR-0008 that carries no `sid`.
    /// Nothing to enforce here; the normal authentication path still applies.
    NotApplicable,
    Active,
    /// Revoked, expired, unknown, or bound to a different subject.
    Rejected(&'static str),
}

async fn verify_session(pool: &PgPool, req: &ServiceRequest) -> SessionVerdict {
    let Some(header) = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
    else {
        return SessionVerdict::NotApplicable;
    };
    let Some(claims) = crate::security::jwt::bearer_access_subject(header) else {
        return SessionVerdict::NotApplicable;
    };
    let Some(sid) = claims.sid.as_deref() else {
        return SessionVerdict::NotApplicable;
    };
    let Ok(sid) = Uuid::parse_str(sid) else {
        return SessionVerdict::Rejected("Session is not valid");
    };

    // One query answers both questions: does this session exist and is it live,
    // and does it actually belong to the subject the token claims? Checking the
    // binding matters -- a token must not be able to name someone else's
    // session and inherit its state.
    let row: Result<Option<SessionRow>, _> =
        sqlx::query_as("SELECT wallet_address, revoked_at FROM auth_login_sessions WHERE id = $1")
            .bind(sid)
            .fetch_optional(pool)
            .await;

    match row {
        Ok(Some((wallet, revoked_at))) => {
            if revoked_at.is_some() {
                SessionVerdict::Rejected("This session has ended; sign in again")
            } else if wallet != claims.sub {
                SessionVerdict::Rejected("Session is not valid")
            } else {
                SessionVerdict::Active
            }
        }
        Ok(None) => SessionVerdict::Rejected("This session has ended; sign in again"),
        // Fail closed. If session state cannot be read, the server cannot show
        // that the session is still valid, and a health API should not assume it.
        Err(error) => {
            log::error!("Session state lookup failed: {error}");
            SessionVerdict::Rejected("Authentication is temporarily unavailable")
        }
    }
}

pub struct SessionStateMiddleware;

impl<S, B> Transform<S, ServiceRequest> for SessionStateMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Transform = SessionStateMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(SessionStateMiddlewareService {
            service: Rc::new(service),
        })
    }
}

pub struct SessionStateMiddlewareService<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for SessionStateMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = Rc::clone(&self.service);
        Box::pin(async move {
            // In-memory deployments have no session store to consult, and demo
            // mode never issues a `sid`, so there is nothing to enforce there.
            let pool = req
                .app_data::<actix_web::web::Data<crate::state::AppState>>()
                .and_then(|state| state.db_pool.clone());

            if let Some(pool) = pool {
                if let SessionVerdict::Rejected(message) = verify_session(&pool, &req).await {
                    let response = HttpResponse::Unauthorized().json(
                        crate::middleware::error_handling::error_envelope_json(
                            crate::middleware::error_handling::error_codes::UNAUTHORIZED,
                            message,
                            None,
                        ),
                    );
                    return Ok(req.into_response(response).map_into_right_body());
                }
            }

            let res = service.call(req).await?;
            Ok(res.map_into_left_body())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test as actix_test, web, App, HttpResponse};

    const WALLET: &str = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
    const OTHER: &str = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";

    async fn protected() -> HttpResponse {
        HttpResponse::Ok().body("reached the handler")
    }

    /// Drive a real request through the middleware against a real database, and
    /// report the status the caller would actually receive.
    ///
    /// These are HTTP-level rather than store-level on purpose: the store tests
    /// prove `auth_login_sessions` behaves, but only a request proves that a
    /// revoked session is refused *before* a handler runs.
    async fn status_for(pool: sqlx::PgPool, token: &str) -> u16 {
        let state = crate::state::AppState::new_with_pool(Some(pool));
        let app = actix_test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .wrap(SessionStateMiddleware)
                .route("/protected", web::get().to(protected)),
        )
        .await;
        let request = actix_test::TestRequest::get()
            .uri("/protected")
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_request();
        actix_test::call_service(&app, request)
            .await
            .status()
            .as_u16()
    }

    async fn open_session(pool: &sqlx::PgPool, wallet: &str) -> uuid::Uuid {
        crate::auth_sessions::create(
            pool,
            wallet,
            &format!("http-generation-{}", uuid::Uuid::new_v4()),
            &uuid::Uuid::new_v4().to_string(),
            chrono::Utc::now() + chrono::Duration::hours(1),
        )
        .await
        .expect("open login session")
    }

    async fn cleanup(pool: &sqlx::PgPool, sid: uuid::Uuid) {
        sqlx::query("DELETE FROM auth_sessions WHERE login_session_id = $1")
            .bind(sid)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM auth_login_sessions WHERE id = $1")
            .bind(sid)
            .execute(pool)
            .await
            .ok();
    }

    /// The gap this middleware exists to close: after logout the access token is
    /// still cryptographically valid, and it must stop working anyway.
    #[tokio::test]
    async fn revoked_session_is_refused_on_a_real_request() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let sid = open_session(&pool, WALLET).await;
        let token = crate::security::jwt::issue_access_token(
            WALLET,
            "Doctor",
            false,
            Some(&sid.to_string()),
        )
        .unwrap();

        assert_eq!(
            status_for(pool.clone(), &token).await,
            200,
            "a live session must reach the handler"
        );

        crate::auth_sessions::revoke_session(&pool, sid, "logout")
            .await
            .expect("revoke");

        // Same token, unchanged and unexpired.
        assert_eq!(
            status_for(pool.clone(), &token).await,
            401,
            "logout must stop an access token that is still within its lifetime"
        );

        cleanup(&pool, sid).await;
    }

    /// Signing out everywhere must not depend on the lost device cooperating.
    #[tokio::test]
    async fn logout_all_refuses_every_session_for_the_subject() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let phone = open_session(&pool, WALLET).await;
        let desk = open_session(&pool, WALLET).await;
        let phone_token = crate::security::jwt::issue_access_token(
            WALLET,
            "Doctor",
            false,
            Some(&phone.to_string()),
        )
        .unwrap();
        let desk_token = crate::security::jwt::issue_access_token(
            WALLET,
            "Doctor",
            false,
            Some(&desk.to_string()),
        )
        .unwrap();

        crate::auth_sessions::revoke_all_for_wallet(&pool, WALLET, "logout_all")
            .await
            .expect("logout all");

        assert_eq!(status_for(pool.clone(), &phone_token).await, 401);
        assert_eq!(status_for(pool.clone(), &desk_token).await, 401);

        cleanup(&pool, phone).await;
        cleanup(&pool, desk).await;
    }

    /// A token must not be able to name a session it does not own. The signature
    /// is valid and the session is live -- only the binding is wrong, and that
    /// alone must refuse the request.
    #[tokio::test]
    async fn a_token_cannot_borrow_another_subjects_session() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let victim_session = open_session(&pool, WALLET).await;

        let forged = crate::security::jwt::issue_access_token(
            OTHER,
            "Doctor",
            false,
            Some(&victim_session.to_string()),
        )
        .unwrap();

        assert_eq!(
            status_for(pool.clone(), &forged).await,
            401,
            "a session belongs to one subject and cannot be inherited"
        );

        cleanup(&pool, victim_session).await;
    }

    /// A session id that never existed is refused rather than treated as absent.
    #[tokio::test]
    async fn an_unknown_session_is_refused() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let token = crate::security::jwt::issue_access_token(
            WALLET,
            "Doctor",
            false,
            Some(&uuid::Uuid::new_v4().to_string()),
        )
        .unwrap();

        assert_eq!(status_for(pool, &token).await, 401);
    }

    /// Tokens issued before ADR-0008 carry no `sid`. They must pass through this
    /// middleware untouched -- it enforces session state, it does not become a
    /// second authentication gate for tokens that never claimed one.
    #[tokio::test]
    async fn a_token_without_a_session_claim_is_left_alone() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let legacy =
            crate::security::jwt::issue_access_token(WALLET, "Doctor", false, None).unwrap();

        assert_eq!(
            status_for(pool, &legacy).await,
            200,
            "a pre-ADR-0008 token has no session to check"
        );
    }
}
