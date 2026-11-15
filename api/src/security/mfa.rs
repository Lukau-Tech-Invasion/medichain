//! TOTP-based multi-factor authentication (Phase 11.3 — Zero Trust & MFA).
//!
//! HIPAA's 2025 Security Rule update mandates MFA for ePHI access. MediChain's
//! first factor is the password proof; the second is a RFC-6238 TOTP
//! (6 digits, 30-second step, SHA-1 — the algorithm every authenticator app
//! supports). Enrollment generates a base32 shared secret and an `otpauth://`
//! provisioning URI that the frontend renders as a QR code.
//!
//! Enrollment records live in [`super::SecurityState::mfa`], keyed by user id,
//! and are persisted encrypted at rest in `user_mfa`. The secret never leaves the
//! server after enrollment except inside the one-time provisioning URI.
//!
//! A code is accepted once. [`matching_step`] says which 30-second step a code
//! belongs to, and the caller refuses any step at or before the last one used
//! (`user_mfa.last_used_step`), so a code seen over a shoulder cannot be replayed.

use chrono::{DateTime, Utc};
use totp_rs::{Algorithm, Secret, TOTP};

/// Issuer label shown in authenticator apps.
pub const TOTP_ISSUER: &str = "MediChain";

/// A user's MFA enrollment.
#[derive(Debug, Clone)]
pub struct MfaRecord {
    /// Base32-encoded TOTP shared secret.
    pub secret_base32: String,
    /// `true` once the user has proven possession by verifying a code.
    pub enabled: bool,
    /// When enrollment began.
    pub created_at: DateTime<Utc>,
    /// The 30-second step of the last code accepted, if any. A code from this
    /// step or an earlier one is a replay.
    pub last_used_step: Option<i64>,
}

/// Seconds in one TOTP step.
pub const TOTP_STEP_SECS: u64 = 30;

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
/// This answers "is the code right", not "has it been used": callers that
/// authenticate with it go through [`matching_step`] and the replay guard.
#[cfg(test)]
pub fn verify_code(secret_base32: &str, account: &str, code: &str) -> bool {
    matching_step(secret_base32, account, code, unix_now()).is_some()
}

#[cfg(test)]
fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// The 30-second step `code` belongs to at `now_secs`, allowing one step of
/// clock drift either way, or `None` when it matches none of them.
///
/// All three candidates are always computed, so the answer does not reveal which
/// step matched by how long it took.
pub fn matching_step(secret_base32: &str, account: &str, code: &str, now_secs: u64) -> Option<i64> {
    let totp = build_totp(secret_base32, account).ok()?;
    let current = now_secs / TOTP_STEP_SECS;
    let mut matched = None;
    for step in [current.saturating_sub(1), current, current + 1] {
        let expected = totp.generate(step * TOTP_STEP_SECS);
        if medichain_crypto::constant_time_eq(expected.as_bytes(), code.as_bytes()) {
            matched = Some(step as i64);
        }
    }
    matched
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_generates_and_builds_uri() {
        let secret = generate_secret_base32();
        assert!(!secret.is_empty());
        let uri = provisioning_uri(&secret, "account-1").unwrap();
        assert!(uri.starts_with("otpauth://totp/"));
        assert!(uri.contains("MediChain"));
    }

    #[test]
    fn current_code_verifies_and_wrong_code_fails() {
        let secret = generate_secret_base32();
        let totp = build_totp(&secret, "account-1").unwrap();
        let code = totp.generate_current().unwrap();
        assert!(verify_code(&secret, "account-1", &code));
        assert!(!verify_code(&secret, "account-1", "000000"));
    }

    #[test]
    fn a_code_names_the_step_it_belongs_to() {
        let secret = generate_secret_base32();
        let totp = build_totp(&secret, "account-1").unwrap();
        let now = 1_800_000_030u64;
        let step = (now / TOTP_STEP_SECS) as i64;
        let this_step = totp.generate(now);
        assert_eq!(
            matching_step(&secret, "account-1", &this_step, now),
            Some(step)
        );
        // One step of drift either way is tolerated and named as such.
        let previous = totp.generate(now - TOTP_STEP_SECS);
        assert_eq!(
            matching_step(&secret, "account-1", &previous, now),
            Some(step - 1)
        );
        let next = totp.generate(now + TOTP_STEP_SECS);
        assert_eq!(
            matching_step(&secret, "account-1", &next, now),
            Some(step + 1)
        );
        // Two steps away is not.
        let stale = totp.generate(now - 2 * TOTP_STEP_SECS);
        assert_eq!(matching_step(&secret, "account-1", &stale, now), None);
    }
}
