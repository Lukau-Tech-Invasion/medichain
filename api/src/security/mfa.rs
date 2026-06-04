//! TOTP-based multi-factor authentication (Phase 11.3 — Zero Trust & MFA).
//!
//! HIPAA's 2025 Security Rule update mandates MFA for ePHI access. MediChain's
//! first factor is the wallet sr25519 signature; the second is a RFC-6238 TOTP
//! (6 digits, 30-second step, SHA-1 — the algorithm every authenticator app
//! supports). Enrollment generates a base32 shared secret and an `otpauth://`
//! provisioning URI that the frontend renders as a QR code.
//!
//! Enrollment records live in [`super::SecurityState::mfa`], alongside the
//! in-memory `users` store (the auth subsystem is intentionally not part of the
//! Phase 2.1 DB migration). Persisting enrollments encrypted-at-rest is a tracked
//! follow-up; the secret never leaves the server after enrollment except inside
//! the one-time provisioning URI.

use chrono::{DateTime, Utc};
use totp_rs::{Algorithm, Secret, TOTP};

/// Issuer label shown in authenticator apps.
pub const TOTP_ISSUER: &str = "MediChain";

/// A wallet's MFA enrollment.
#[derive(Debug, Clone)]
pub struct MfaRecord {
    /// Base32-encoded TOTP shared secret.
    pub secret_base32: String,
    /// `true` once the wallet has proven possession by verifying a code.
    pub enabled: bool,
    /// When enrollment began.
    pub created_at: DateTime<Utc>,
}

/// Build a configured [`TOTP`] for the given secret/account, or an error string.
fn build_totp(secret_base32: &str, account: &str) -> Result<TOTP, String> {
    let secret = Secret::Encoded(secret_base32.to_string())
        .to_bytes()
        .map_err(|e| format!("invalid TOTP secret: {e:?}"))?;
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret,
        Some(TOTP_ISSUER.to_string()),
        account.to_string(),
    )
    .map_err(|e| format!("TOTP construction failed: {e}"))
}

/// Generate a fresh random base32 TOTP secret.
pub fn generate_secret_base32() -> String {
    match Secret::generate_secret().to_encoded() {
        Secret::Encoded(s) => s,
        // `to_encoded()` always yields the Encoded variant; this arm is unreachable.
        Secret::Raw(bytes) => Secret::Raw(bytes).to_encoded().to_string(),
    }
}

/// Build the `otpauth://totp/...` provisioning URI for a secret + account.
pub fn provisioning_uri(secret_base32: &str, account: &str) -> Result<String, String> {
    Ok(build_totp(secret_base32, account)?.get_url())
}

/// Verify a 6-digit code against the secret using the current time window.
///
/// A `skew` of 1 accepts the adjacent 30-second windows to tolerate clock drift.
pub fn verify_code(secret_base32: &str, account: &str, code: &str) -> bool {
    match build_totp(secret_base32, account) {
        Ok(totp) => totp.check_current(code).unwrap_or(false),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_generates_and_builds_uri() {
        let secret = generate_secret_base32();
        assert!(!secret.is_empty());
        let uri = provisioning_uri(&secret, "5Grw").unwrap();
        assert!(uri.starts_with("otpauth://totp/"));
        assert!(uri.contains("MediChain"));
    }

    #[test]
    fn current_code_verifies_and_wrong_code_fails() {
        let secret = generate_secret_base32();
        let totp = build_totp(&secret, "5Grw").unwrap();
        let code = totp.generate_current().unwrap();
        assert!(verify_code(&secret, "5Grw", &code));
        assert!(!verify_code(&secret, "5Grw", "000000"));
    }
}
