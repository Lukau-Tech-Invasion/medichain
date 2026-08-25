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
