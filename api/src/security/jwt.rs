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

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

/// Access-token lifetime: 1 hour. Enforces session timeout (Phase 11.3).
pub const ACCESS_TOKEN_TTL_SECS: i64 = 3600;
/// Refresh-token lifetime: 7 days.
pub const REFRESH_TOKEN_TTL_SECS: i64 = 7 * 24 * 3600;
/// A privileged request must carry MFA proof issued within this window.
pub const MFA_STEP_UP_TTL_SECS: i64 = 15 * 60;

pub const JWT_ISSUER: &str = "medichain-api";
pub const JWT_AUDIENCE: &str = "medichain-clients";

/// Token kind embedded in the `typ` claim to prevent a refresh token from being
/// replayed as an access token.
pub const TYP_ACCESS: &str = "access";
pub const TYP_REFRESH: &str = "refresh";

/// JWT claims for MediChain auth tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Trusted token issuer and intended audience.
    pub iss: String,
    pub aud: String,
    /// Subject — the SS58 wallet address.
    pub sub: String,
    /// Role string (e.g. "Doctor"); informational, RBAC still re-checks server-side.
    pub role: String,
    /// Explicit authorization context. Absent only on legacy tokens issued
    /// before Phase 1; new context tokens are either `patient` or
    /// `professional`.
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub patient_profile_id: Option<String>,
    #[serde(default)]
    pub organization_id: Option<String>,
    #[serde(default)]
    pub facility_id: Option<String>,
    #[serde(default)]
    pub assignment_id: Option<String>,
    /// Whether multi-factor auth was satisfied when this token was issued.
    pub mfa: bool,
    /// Token type: [`TYP_ACCESS`] or [`TYP_REFRESH`].
    pub typ: String,
    /// Issued-at (unix seconds).
    pub iat: i64,
    /// Not valid before (unix seconds).
    pub nbf: i64,
    /// Expiry (unix seconds).
    pub exp: i64,
    /// Unique identifier used for traceability and future revocation support.
    pub jti: String,
    /// Stable login-session identifier (ADR-0008). Identifies one login, not one
    /// token: it survives refresh-token rotation, so step-up elevation and
    /// transaction-authorization challenges can bind to the session rather than
    /// to a token generation that is replaced every few minutes. Absent on
    /// refresh tokens and on tokens issued before ADR-0008.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sid: Option<String>,
    /// Time the second factor was verified. Absent when MFA was not verified.
    #[serde(default)]
    pub auth_time: Option<i64>,
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
    session_id: Option<&str>,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = chrono::Utc::now().timestamp();
    let claims = Claims {
        iss: JWT_ISSUER.to_string(),
        aud: JWT_AUDIENCE.to_string(),
        sub: wallet.to_string(),
        role: role.to_string(),
        context: None,
        patient_profile_id: None,
        organization_id: None,
        facility_id: None,
        assignment_id: None,
        mfa,
        typ: typ.to_string(),
        iat: now,
        nbf: now,
        exp: now + ttl_secs,
        jti: uuid::Uuid::new_v4().to_string(),
        sid: session_id.map(str::to_string),
        auth_time: mfa.then_some(now),
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(jwt_secret().as_bytes()),
    )
}

/// Issue an access token tied to one explicit patient or professional context.
/// Legacy access tokens remain supported during migration, but callers using
/// this function cannot carry professional claims into a patient context.
pub fn issue_context_access_token(
    context: &crate::federation_identity::LoginContext,
    mfa: bool,
    session_id: Option<&str>,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = chrono::Utc::now().timestamp();
    let claims = Claims {
        iss: JWT_ISSUER.to_string(),
        aud: JWT_AUDIENCE.to_string(),
        sub: context.wallet_address.clone(),
        role: context.role.clone().unwrap_or_default(),
        context: Some(
            match context.context_type {
                crate::federation_identity::ContextType::Patient => "patient",
                crate::federation_identity::ContextType::Professional => "professional",
            }
            .to_string(),
        ),
        patient_profile_id: context.patient_profile_id.clone(),
        organization_id: context.organization_id.clone(),
        facility_id: context.facility_id.clone(),
        assignment_id: context.assignment_id.clone(),
        mfa,
        typ: TYP_ACCESS.to_string(),
        iat: now,
        nbf: now,
        exp: now + ACCESS_TOKEN_TTL_SECS,
        jti: uuid::Uuid::new_v4().to_string(),
        sid: session_id.map(str::to_string),
        auth_time: mfa.then_some(now),
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(jwt_secret().as_bytes()),
    )
}

/// Issue a short-lived access token.
///
/// `session_id` is the stable login session this token belongs to. It must
/// already be persisted: a token is never returned for a session that failed to
/// persist, so the caller creates the session first and mints afterwards.
pub fn issue_access_token(
    wallet: &str,
    role: &str,
    mfa: bool,
    session_id: Option<&str>,
) -> Result<String, jsonwebtoken::errors::Error> {
    issue(
        wallet,
        role,
        mfa,
        TYP_ACCESS,
        ACCESS_TOKEN_TTL_SECS,
        session_id,
    )
}

/// Issue a longer-lived refresh token.
///
/// Refresh tokens carry no `sid`. The refresh token *is* the generation, and the
/// session it belongs to is resolved from the stored generation row rather than
/// from a claim the holder presents.
pub fn issue_refresh_token(
    wallet: &str,
    role: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    issue(
        wallet,
        role,
        false,
        TYP_REFRESH,
        REFRESH_TOKEN_TTL_SECS,
        None,
    )
}

/// Decode and validate a token (signature + expiry). Returns the claims on success.
pub fn decode_token(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&[JWT_ISSUER]);
    validation.set_audience(&[JWT_AUDIENCE]);
    validation.validate_nbf = true;
    validation.required_spec_claims.extend(
        ["exp", "nbf", "iss", "aud", "sub"]
            .into_iter()
            .map(str::to_string),
    );
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(jwt_secret().as_bytes()),
        &validation,
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
            None,
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
        assert_eq!(claims.iss, JWT_ISSUER);
        assert_eq!(claims.aud, JWT_AUDIENCE);
        assert!(claims.auth_time.is_some());
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
        let mut t = issue_access_token("5Grw", "Admin", false, None).unwrap();
        t.push('x');
        assert!(decode_token(&t).is_err());
    }

    #[test]
    fn bearer_subject_extracts_wallet() {
        let wallet = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
        let t = issue_access_token(wallet, "Patient", false, None).unwrap();
        let claims = bearer_access_subject(&format!("Bearer {}", t)).unwrap();
        assert_eq!(claims.sub, wallet);
    }
}
