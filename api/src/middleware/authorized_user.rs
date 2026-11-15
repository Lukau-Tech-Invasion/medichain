//! `AuthorizedUser` — a typed extractor collapsing the repeated
//! authenticate-then-look-up-the-user boilerplate found across handlers.
//!
//! Horizon finding HZ-010: authorization is not enforced at a chokepoint — only
//! authentication (via `SignatureAuthMiddleware`) is centralized. Every handler
//! independently decides whether to call `get_current_user_id`/`get_user` at
//! all, which is exactly how `HZ-009`'s confirmed unauthenticated IDOR happened
//! (a handler that simply never called either). This extractor does not
//! retrofit every existing handler — that is a separate, larger initiative,
//! tracked as its own ledger row — but it gives *new* code (and the handlers
//! `HZ-009` fixes) a single, hard-to-forget way to require an authenticated,
//! known caller.
//!
//! © 2025-2026 Trustware. All rights reserved.

use actix_web::{
    dev::Payload, error::ResponseError, http::StatusCode, web, FromRequest, HttpRequest,
    HttpResponse,
};
use std::future::{ready, Ready};

use crate::middleware::error_handling::{error_codes, error_envelope_json};
use crate::state::AppState;
use crate::types::User;

/// An authenticated caller whose identity resolved to a known server-side user
/// record. Add this as a handler parameter to require both in one step:
///
/// ```ignore
/// pub async fn my_handler(user: AuthorizedUser, ...) -> impl Responder {
///     if user.id != requested_id && !user.role().is_admin() { ... }
/// }
/// ```
#[derive(Debug, Clone)]
pub struct AuthorizedUser {
    pub user: User,
    pub user_id: String,
}

impl AuthorizedUser {
    /// Convenience accessor — the caller's role, straight from the server-side
    /// user record (never a client-supplied header; see `support::get_user`'s
    /// documented invariant).
    pub fn role(&self) -> &crate::types::Role {
        &self.user.role
    }
}

/// Why extraction failed. Both cases are `401` — this extractor establishes
/// *authentication*, not per-resource authorization; a handler still decides
/// its own ownership/role checks on top of the resolved identity.
#[derive(Debug)]
pub enum AuthorizedUserError {
    /// No valid access token on the request at all.
    MissingIdentity,
    /// An identity was presented but does not match any known server-side user.
    UnknownUser,
}

impl std::fmt::Display for AuthorizedUserError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthorizedUserError::MissingIdentity => write!(f, "Authentication required"),
            AuthorizedUserError::UnknownUser => write!(f, "User not found"),
        }
    }
}

impl ResponseError for AuthorizedUserError {
    fn status_code(&self) -> StatusCode {
        StatusCode::UNAUTHORIZED
    }

    fn error_response(&self) -> HttpResponse {
        HttpResponse::Unauthorized().json(error_envelope_json(
            error_codes::UNAUTHORIZED,
            &self.to_string(),
            None,
        ))
    }
}

impl FromRequest for AuthorizedUser {
    type Error = AuthorizedUserError;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        let outcome = (|| {
            let user_id = crate::support::get_current_user_id(req)
                .ok_or(AuthorizedUserError::MissingIdentity)?;

            // `app_data` absence here would mean the app was built without
            // `AppState` at all — a startup-config bug, not a caller error, but
            // still surfaced as 401 rather than panicking, since this extractor
            // has no lower-level fallback path to try.
            let data = req
                .app_data::<web::Data<AppState>>()
                .ok_or(AuthorizedUserError::UnknownUser)?;

            let user =
                crate::support::get_user(data, &user_id).ok_or(AuthorizedUserError::UnknownUser)?;

            Ok(AuthorizedUser { user, user_id })
        })();

        ready(outcome)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test::TestRequest;

    #[actix_web::test]
    async fn missing_header_yields_missing_identity() {
        let req = TestRequest::default().to_http_request();
        let mut payload = Payload::None;
        let result = AuthorizedUser::from_request(&req, &mut payload).await;
        assert!(matches!(result, Err(AuthorizedUserError::MissingIdentity)));
    }

    #[actix_web::test]
    async fn unknown_user_id_yields_unknown_user() {
        let state = web::Data::new(AppState::new());
        let req = TestRequest::default()
            .insert_header(crate::test_fixtures::as_user("5UnknownUser"))
            .app_data(state)
            .to_http_request();
        let mut payload = Payload::None;
        let result = AuthorizedUser::from_request(&req, &mut payload).await;
        assert!(matches!(result, Err(AuthorizedUserError::UnknownUser)));
    }
}
