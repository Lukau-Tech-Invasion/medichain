//! The refresh token as an HttpOnly cookie (WP12).
//!
//! Browser clients keep only the short-lived access token, in memory. The
//! refresh token lives in a cookie script cannot read (`HttpOnly`), that is
//! sent only over HTTPS (`Secure`), only to the auth routes (`Path=/api/auth`)
//! and never on a cross-site request (`SameSite=Strict`, which is also what
//! makes the refresh endpoint safe from CSRF). So a reload can restore the
//! session without any token ever sitting in JavaScript-readable storage.
//!
//! Written by hand rather than through actix-web's `cookies` feature, which
//! this crate builds without (it would pull in another dependency for one
//! header in each direction).

use actix_web::http::header::{HeaderValue, COOKIE};
use actix_web::HttpRequest;

use crate::security::jwt::REFRESH_TOKEN_TTL_SECS;

/// The cookie's name.
pub const REFRESH_COOKIE: &str = "medichain_refresh";
/// Header a non-browser client sends to receive the refresh token in the JSON
/// body instead (it has no cookie jar); browsers never send it.
pub const BODY_TRANSPORT_HEADER: &str = "x-refresh-transport";

/// Attributes every refresh cookie carries.
const ATTRIBUTES: &str = "Path=/api/auth; HttpOnly; Secure; SameSite=Strict";

/// The `Set-Cookie` value that stores `token` for the refresh lifetime.
pub fn set_value(token: &str) -> String {
    format!("{REFRESH_COOKIE}={token}; Max-Age={REFRESH_TOKEN_TTL_SECS}; {ATTRIBUTES}")
}

/// The `Set-Cookie` value that removes the cookie (sign-out, failed refresh).
pub fn clear_value() -> String {
    format!("{REFRESH_COOKIE}=; Max-Age=0; {ATTRIBUTES}")
}

/// The refresh token from the request's cookies, if one is there.
pub fn read(req: &HttpRequest) -> Option<String> {
    req.headers()
        .get_all(COOKIE)
        .filter_map(|value: &HeaderValue| value.to_str().ok())
        .flat_map(|header| header.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, value)| *name == REFRESH_COOKIE && !value.is_empty())
        .map(|(_, value)| value.to_string())
}

/// Whether the caller asked for the refresh token in the body (non-browser).
pub fn body_transport_requested(req: &HttpRequest) -> bool {
    req.headers()
        .get(BODY_TRANSPORT_HEADER)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("body"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test::TestRequest;

    #[test]
    fn the_cookie_is_http_only_secure_strict_and_scoped_to_auth() {
        let value = set_value("abc.def.ghi");
        for attribute in ["HttpOnly", "Secure", "SameSite=Strict", "Path=/api/auth"] {
            assert!(
                value.contains(attribute),
                "{attribute} missing from {value}"
            );
        }
        assert!(clear_value().contains("Max-Age=0"));
    }

    #[test]
    fn the_token_is_read_from_among_other_cookies() {
        let req = TestRequest::default()
            .insert_header((COOKIE, "theme=dark; medichain_refresh=abc.def.ghi; lang=zu"))
            .to_http_request();
        assert_eq!(read(&req).as_deref(), Some("abc.def.ghi"));
        let none = TestRequest::default()
            .insert_header((COOKIE, "medichain_refresh=; theme=dark"))
            .to_http_request();
        assert_eq!(read(&none), None);
    }
}
