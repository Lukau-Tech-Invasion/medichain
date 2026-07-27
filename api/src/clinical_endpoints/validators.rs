//! Shared request-validation helpers for clinical endpoint handlers.
//!
//! `crate::clinical_endpoints::*` grew to ~478 handlers largely by copy/paste, and
//! two request-validation blocks were duplicated verbatim at the top of dozens of
//! them:
//!   1. Extracting the caller's id from the `X-User-Id` header, 401'ing with a
//!      fixed `ErrorResponse` body if absent (60 occurrences across the crate).
//!   2. Looking the id up in `data.users`, 401'ing with a fixed `ErrorResponse`
//!      body if unknown (28 occurrences).
//!
//! These helpers are a pure extraction of that exact duplicated code — same
//! status codes, same JSON bodies, same field values — not a behavior change.
//!
//! `require_x_user_id_header` deliberately checks **only** the legacy
//! `X-User-Id` header, matching what every inlined call site did before this
//! extraction. It does NOT fall back to a JWT bearer token the way
//! `crate::support::get_current_user_id` does; folding JWT support into these
//! call sites would change what a request needs to authenticate and is left
//! for a separate, deliberate pass rather than bundled into this refactor.

use super::*;

/// Extract the caller's wallet address from the legacy `X-User-Id` header, or
/// return the canonical 401 response every handler inlined for a missing header.
///
/// Callers propagate the error with `let id = match require_x_user_id_header(&req) { Ok(id) => id, Err(resp) => return resp };`
pub(crate) fn require_x_user_id_header(req: &HttpRequest) -> Result<String, HttpResponse> {
    match req.headers().get("X-User-Id") {
        Some(id) => Ok(id.to_str().unwrap_or("").to_string()),
        None => Err(HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        })),
    }
}

/// Look up a user record by id in the in-memory user store, or return the
/// canonical 401 "user not found" response every handler inlined for an
/// unknown id.
pub(crate) fn require_known_user(
    data: &web::Data<AppState>,
    user_id: &str,
) -> Result<User, HttpResponse> {
    let users = data.users.read().unwrap();
    match users.get(user_id) {
        Some(u) => Ok(u.clone()),
        None => Err(HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test::TestRequest;

    #[test]
    fn require_x_user_id_header_extracts_present_header() {
        let req = TestRequest::default()
            .insert_header(("X-User-Id", "wallet-123"))
            .to_http_request();
        assert_eq!(require_x_user_id_header(&req).unwrap(), "wallet-123");
    }

    #[test]
    fn require_x_user_id_header_401s_when_missing() {
        let req = TestRequest::default().to_http_request();
        let err = require_x_user_id_header(&req).unwrap_err();
        assert_eq!(err.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }
}
