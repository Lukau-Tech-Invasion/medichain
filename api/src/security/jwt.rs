//! JWT issuance and verification (Phase 9.4).
//!
//! MediChain authenticates wallets by sr25519 challenge-response. After a wallet
//! proves ownership (see [`crate::middleware::signature_auth`]), the server issues
//! a short-lived **access** JWT plus a longer-lived **refresh** JWT. The access
//! token carries the wallet address (`sub`), role, and whether MFA has been
//! satisfied this session (`mfa`).
//!
//! This is *additive*: [`crate::support::get_current_user_id`] accepts either a
//! `Authorization: Bearer <jwt>` header or the legacy `X-User-Id` header, so no
//! existing handler needs to change to gain JWT support.
//!
//! The signing secret comes from `JWT_SECRET` (falling back to `SESSION_SECRET`,
//! then a clearly-marked dev default). `validate_production_secrets()` at startup
//! aborts when a demo secret is used outside demo mode.

use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

/// Access-token lifetime: 1 hour. Enforces session timeout (Phase 11.3).
pub const ACCESS_TOKEN_TTL_SECS: i64 = 3600;
/// Refresh-token lifetime: 7 days.
pub const REFRESH_TOKEN_TTL_SECS: i64 = 7 * 24 * 3600;

/// Token kind embedded in the `typ` claim to prevent a refresh token from being
/// replayed as an access token.
pub const TYP_ACCESS: &str = "access";
pub const TYP_REFRESH: &str = "refresh";

/// JWT claims for MediChain auth tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject — the SS58 wallet address.
    pub sub: String,
    /// Role string (e.g. "Doctor"); informational, RBAC still re-checks server-side.
    pub role: String,
    /// Whether multi-factor auth was satisfied when this token was issued.
    pub mfa: bool,
    /// Token type: [`TYP_ACCESS`] or [`TYP_REFRESH`].
    pub typ: String,
    /// Issued-at (unix seconds).
    pub iat: i64,
    /// Expiry (unix seconds).
    pub exp: i64,
}

/// Resolve the JWT signing secret from the environment.
///
/// Order: `JWT_SECRET` → `SESSION_SECRET` → dev default. The dev default is
/// rejected in production by `validate_production_secrets()`.
fn jwt_secret() -> String {
    std::env::var("JWT_SECRET")
        .or_else(|_| std::env::var("SESSION_SECRET"))
        .unwrap_or_else(|_| "medichain-dev-secret-change-in-production".to_string())
}

/// Issue a signed token of the given type.
fn issue(
    wallet: &str,
    role: &str,
    mfa: bool,
    typ: &str,
    ttl_secs: i64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = chrono::Utc::now().timestamp();
    let claims = Claims {
        sub: wallet.to_string(),
        role: role.to_string(),
        mfa,
        typ: typ.to_string(),
        iat: now,
        exp: now + ttl_secs,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret().as_bytes()),
    )
}

/// Issue a short-lived access token.
pub fn issue_access_token(
    wallet: &str,
    role: &str,
    mfa: bool,
) -> Result<String, jsonwebtoken::errors::Error> {
    issue(wallet, role, mfa, TYP_ACCESS, ACCESS_TOKEN_TTL_SECS)
}

/// Issue a longer-lived refresh token.
pub fn issue_refresh_token(
    wallet: &str,
    role: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    issue(wallet, role, false, TYP_REFRESH, REFRESH_TOKEN_TTL_SECS)
}

/// Decode and validate a token (signature + expiry). Returns the claims on success.
pub fn decode_token(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    // `Validation::default()` validates the `exp` claim with the HS256 algorithm.
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(jwt_secret().as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}

/// Extract the verified wallet address from an `Authorization: Bearer <jwt>` header.
///
/// Returns `None` when the header is absent, not a Bearer scheme, or fails to
/// decode as a valid **access** token (e.g. it is a legacy session token, an
/// expired token, or a refresh token). Callers fall back to `X-User-Id`.
pub fn bearer_access_subject(auth_header: &str) -> Option<Claims> {
    let token = auth_header.strip_prefix("Bearer ")?.trim();
    let claims = decode_token(token).ok()?;
    if claims.typ != TYP_ACCESS {
        return None;
    }
    Some(claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_token_round_trips() {
        let t = issue_access_token(
            "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
            "Doctor",
            true,
        )
        .unwrap();
        let claims = decode_token(&t).unwrap();
        assert_eq!(
            claims.sub,
            "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
        );
        assert_eq!(claims.role, "Doctor");
        assert!(claims.mfa);
        assert_eq!(claims.typ, TYP_ACCESS);
    }

    #[test]
    fn refresh_token_is_not_accepted_as_access() {
        let t = issue_refresh_token("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", "Nurse")
            .unwrap();
        let header = format!("Bearer {}", t);
        assert!(bearer_access_subject(&header).is_none());
    }

    #[test]
    fn tampered_token_is_rejected() {
        let mut t = issue_access_token("5Grw", "Admin", false).unwrap();
        t.push('x');
        assert!(decode_token(&t).is_err());
    }

    #[test]
    fn bearer_subject_extracts_wallet() {
        let wallet = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
        let t = issue_access_token(wallet, "Patient", false).unwrap();
        let claims = bearer_access_subject(&format!("Bearer {}", t)).unwrap();
        assert_eq!(claims.sub, wallet);
    }
}
