//! Cryptographic validation for emergency / lock-screen medical-ID access (C2, C3).
//!
//! First-responder access to a patient's emergency PHI is gated by one of two
//! verifiable proofs — never by the mere *presence* of a query parameter:
//!
//! 1. **Signed emergency token** — a time-limited MAC over `(patient_id, expiry)`
//!    keyed with the server secret. SHA3-256 is length-extension resistant, so a
//!    secret-prefix construction (`SHA3-256(secret || patient_id || expiry)`) is a
//!    secure MAC without pulling in an HMAC dependency. A forged or expired token
//!    fails verification.
//! 2. **NFC card hash** — the value tapped from the patient's physical card must
//!    match the SHA3-256 `tag_uid` of one of the patient's active registered NFC
//!    tags (see `nfc_simulator::card_hash` and `types::conversions`).

use sha3::{Digest, Sha3_256};

use crate::repositories::traits::NfcTagEntity;

/// Resolve the server secret used to key emergency tokens.
///
/// Order mirrors `security::jwt`: `JWT_SECRET` → `SESSION_SECRET` → dev default.
/// The dev default is rejected in production by `validate_production_secrets()`.
fn emergency_secret() -> String {
    std::env::var("JWT_SECRET")
        .or_else(|_| std::env::var("SESSION_SECRET"))
        .unwrap_or_else(|_| "medichain-dev-secret-change-in-production".to_string())
}

/// Compute the hex MAC tag binding `patient_id` to an `expiry` instant.
fn mac_tag(patient_id: &str, expiry: i64) -> String {
    let mut h = Sha3_256::new();
    h.update(emergency_secret().as_bytes());
    h.update(b":emergency:");
    h.update(patient_id.as_bytes());
    h.update(b":");
    h.update(expiry.to_string().as_bytes());
    hex::encode(h.finalize())
}

/// Constant-time byte comparison to avoid leaking MAC bytes via timing.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Issue a time-limited, server-signed emergency access token for `patient_id`.
///
/// Format: `"<expiry_unix>.<hex_mac>"`. Intended to be minted for an
/// authenticated first responder, then presented to the emergency endpoint.
#[allow(dead_code)]
pub fn issue_emergency_token(patient_id: &str, ttl_secs: i64) -> String {
    let expiry = chrono::Utc::now().timestamp() + ttl_secs;
    format!("{}.{}", expiry, mac_tag(patient_id, expiry))
}

/// Verify a signed emergency token for `patient_id`.
///
/// Returns `true` only when the token is well-formed, unexpired, and its MAC
/// matches the server secret. Forged/expired/cross-patient tokens return `false`.
pub fn verify_emergency_token(token: &str, patient_id: &str) -> bool {
    let (exp_str, tag) = match token.split_once('.') {
        Some(parts) => parts,
        None => return false,
    };
    let expiry: i64 = match exp_str.parse() {
        Ok(e) => e,
        Err(_) => return false,
    };
    if chrono::Utc::now().timestamp() > expiry {
        return false;
    }
    ct_eq(mac_tag(patient_id, expiry).as_bytes(), tag.as_bytes())
}

/// Whether `provided` matches the `tag_uid` of one of the patient's active NFC tags.
///
/// `tag_uid` stores the SHA3-256 NFC card hash, so this is a cryptographic
/// binding to the physical card — an arbitrary string cannot match.
pub fn nfc_hash_matches(provided: &str, tags: &[NfcTagEntity]) -> bool {
    !provided.is_empty()
        && tags
            .iter()
            .any(|t| t.is_active && ct_eq(t.tag_uid.as_bytes(), provided.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn tag(uid: &str, active: bool) -> NfcTagEntity {
        NfcTagEntity {
            id: "tag-1".to_string(),
            tag_uid: uid.to_string(),
            patient_id: "PAT-1".to_string(),
            tag_type: "emergency".to_string(),
            is_active: active,
            pin_hash: None,
            issued_at: Utc::now(),
            expires_at: None,
            last_used_at: None,
            use_count: 0,
            issued_by: None,
        }
    }

    #[test]
    fn valid_token_verifies() {
        let t = issue_emergency_token("PAT-1", 300);
        assert!(verify_emergency_token(&t, "PAT-1"));
    }

    #[test]
    fn token_is_patient_bound() {
        let t = issue_emergency_token("PAT-1", 300);
        assert!(!verify_emergency_token(&t, "PAT-2"));
    }

    #[test]
    fn forged_token_rejected() {
        assert!(!verify_emergency_token("9999999999.deadbeef", "PAT-1"));
        assert!(!verify_emergency_token("not-a-token", "PAT-1"));
        assert!(!verify_emergency_token("", "PAT-1"));
    }

    #[test]
    fn expired_token_rejected() {
        // Negative TTL → already expired.
        let t = issue_emergency_token("PAT-1", -10);
        assert!(!verify_emergency_token(&t, "PAT-1"));
    }

    #[test]
    fn nfc_hash_matches_active_tag_only() {
        let tags = vec![tag("abc123hash", true)];
        assert!(nfc_hash_matches("abc123hash", &tags));
        assert!(!nfc_hash_matches("wronghash", &tags));
        assert!(!nfc_hash_matches("", &tags));

        let inactive = vec![tag("abc123hash", false)];
        assert!(!nfc_hash_matches("abc123hash", &inactive));
    }
}
