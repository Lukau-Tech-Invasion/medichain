//! Cryptographic validation for emergency / lock-screen medical-ID access (C2, C3).
//!
//! First-responder access to a patient's emergency PHI is gated by one of two
//! verifiable proofs — never by the mere *presence* of a query parameter:
//!
//! 1. **Signed emergency token** — a one-time HS256 JWT bound to the patient,
//!    approved device, authenticated responder, purpose, issuer and audience.
//! 2. **NFC card hash** — the value tapped from the patient's physical card must
//!    match the SHA3-256 `tag_uid` of one of the patient's active registered NFC
//!    tags (see `nfc_simulator::card_hash` and `types::conversions`).

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

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

const EMERGENCY_ISSUER: &str = "medichain-api";
const EMERGENCY_AUDIENCE: &str = "medichain-emergency";
const EMERGENCY_SCOPE: &str = "emergency_medical_id:read";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmergencyClaims {
    pub iss: String,
    pub aud: String,
    pub sub: String,
    pub patient_id: String,
    pub device_id: String,
    pub reason_code: String,
    pub scope: String,
    pub jti: String,
    pub iat: i64,
    pub nbf: i64,
    pub exp: i64,
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

/// Verify signature, registered claims, purpose and patient binding.
pub fn verify_emergency_token(
    token: &str,
    patient_id: &str,
) -> Result<EmergencyClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&[EMERGENCY_ISSUER]);
    validation.set_audience(&[EMERGENCY_AUDIENCE]);
    validation.validate_nbf = true;
    validation.leeway = 0;
    let claims = decode::<EmergencyClaims>(
        token,
        &DecodingKey::from_secret(emergency_secret().as_bytes()),
        &validation,
    )?
    .claims;
    if claims.patient_id != patient_id || claims.scope != EMERGENCY_SCOPE {
        return Err(jsonwebtoken::errors::Error::from(
            jsonwebtoken::errors::ErrorKind::InvalidToken,
        ));
    }
    Ok(claims)
}

/// Whether `provided` matches the `tag_uid` of one of the patient's active NFC tags.
///
/// `tag_uid` stores the SHA3-256 NFC card hash, so this is a cryptographic
/// binding to the physical card — an arbitrary string cannot match.
///
/// This check alone is **not** sufficient to gate PHI release: `tag_uid` never
/// rotates for the lifetime of the card, so a value that matches once matches
/// forever. Callers must exchange a match here for a short-lived
/// [`issue_emergency_token`] via the `/api/emergency/nfc-token` endpoint and
/// gate actual data release on [`verify_emergency_token`], not on this
/// function's result directly (Horizon HZ-001).
pub fn nfc_hash_matches(provided: &str, tags: &[NfcTagEntity]) -> bool {
    !provided.is_empty()
        && tags
            .iter()
            .any(|t| t.is_active && ct_eq(t.tag_uid.as_bytes(), provided.as_bytes()))
}

/// Issue a signed, time-limited emergency token for `patient_id`.
///
/// Format: `"<expiry_unix>.<hex_mac>"`, verified by [`verify_emergency_token`].
/// This is the *only* sanctioned way to turn a one-time proof (a signed
/// challenge, or — via `/api/emergency/nfc-token` — a validated NFC tap) into
/// something the PHI-releasing endpoints will accept, precisely because it
/// carries a short, enforced expiry that a static NFC hash does not (HZ-001).
pub fn issue_emergency_token(
    patient_id: &str,
    responder_id: &str,
    device_id: &str,
    reason_code: &str,
    ttl_secs: i64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = chrono::Utc::now().timestamp();
    let claims = EmergencyClaims {
        iss: EMERGENCY_ISSUER.to_string(),
        aud: EMERGENCY_AUDIENCE.to_string(),
        sub: responder_id.to_string(),
        patient_id: patient_id.to_string(),
        device_id: device_id.to_string(),
        reason_code: reason_code.to_string(),
        scope: EMERGENCY_SCOPE.to_string(),
        jti: uuid::Uuid::new_v4().to_string(),
        iat: now,
        nbf: now,
        exp: now + ttl_secs,
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(emergency_secret().as_bytes()),
    )
}

/// Reject replay of an already-spent one-time emergency token.
///
/// The spent-token set is **durable** (migration 20260811000002). It used to be
/// a process-memory map, which meant a restart — or a crash, or a rolling
/// deploy — silently made every previously redeemed emergency token valid
/// again, against PHI. That is why this is async: the check has to reach the
/// repository, not a `RwLock`.
///
/// Spend is recorded before the claims are returned, so a caller that never
/// reaches the PHI response has still burned the token. Failing closed on a
/// repository error is deliberate: if we cannot prove a token is unspent, we
/// must not treat it as unspent.
pub async fn consume_emergency_token(
    state: &crate::AppState,
    token: &str,
    patient_id: &str,
) -> Result<EmergencyClaims, &'static str> {
    let claims = verify_emergency_token(token, patient_id).map_err(|_| "invalid token")?;

    match state
        .repositories
        .used_emergency_tokens
        .get_by_id(&claims.jti)
        .await
    {
        Ok(Some(_)) => return Err("token already used"),
        Ok(None) => {}
        Err(_) => return Err("token replay store unavailable"),
    }

    let now = chrono::Utc::now();
    let record = crate::repositories::traits::JsonRecordEntity {
        id: claims.jti.clone(),
        owner_id: claims.patient_id.clone(),
        // Recorded so a replay attempt is auditable, not just refused.
        data: serde_json::json!({
            "responder_id": claims.sub,
            "device_id": claims.device_id,
            "reason_code": claims.reason_code,
            "expires_at": claims.exp,
            "spent_at": now.timestamp(),
        }),
        created_at: now,
        updated_at: now,
    };
    state
        .repositories
        .used_emergency_tokens
        .create(record)
        .await
        .map_err(|_| "token replay store unavailable")?;

    Ok(claims)
}

/// Default validity window for a token issued via the NFC exchange endpoint.
/// Short enough that a leaked query-string value (e.g. via a proxy or access
/// log) is only replayable for a couple of minutes, not indefinitely.
pub const NFC_EXCHANGE_TOKEN_TTL_SECS: i64 = 120;

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
        let t = issue_emergency_token("PAT-1", "responder", "device", "trauma", 300).unwrap();
        assert!(verify_emergency_token(&t, "PAT-1").is_ok());
    }

    #[test]
    fn token_is_patient_bound() {
        let t = issue_emergency_token("PAT-1", "responder", "device", "trauma", 300).unwrap();
        assert!(verify_emergency_token(&t, "PAT-2").is_err());
    }

    #[test]
    fn forged_token_rejected() {
        assert!(verify_emergency_token("9999999999.deadbeef", "PAT-1").is_err());
        assert!(verify_emergency_token("not-a-token", "PAT-1").is_err());
        assert!(verify_emergency_token("", "PAT-1").is_err());
    }

    #[test]
    fn expired_token_rejected() {
        // Negative TTL → already expired.
        let t = issue_emergency_token("PAT-1", "responder", "device", "trauma", -10).unwrap();
        assert!(verify_emergency_token(&t, "PAT-1").is_err());
    }

    #[tokio::test]
    async fn token_is_one_time() {
        let state = crate::AppState::new();
        let token = issue_emergency_token("PAT-1", "responder", "device", "trauma", 300).unwrap();
        assert!(consume_emergency_token(&state, &token, "PAT-1")
            .await
            .is_ok());
        assert_eq!(
            consume_emergency_token(&state, &token, "PAT-1")
                .await
                .unwrap_err(),
            "token already used"
        );
    }

    /// The spend must outlive the process. Before migration 20260811000002 the
    /// spent-token set was a `RwLock<HashMap>`, so a restart silently made every
    /// redeemed emergency token valid again against PHI. A fresh `AppState` over
    /// the same repository stands in for that restart.
    #[tokio::test]
    async fn spent_token_stays_spent_across_a_restart() {
        let state = crate::AppState::new();
        let token = issue_emergency_token("PAT-9", "responder", "device", "trauma", 300).unwrap();
        assert!(consume_emergency_token(&state, &token, "PAT-9")
            .await
            .is_ok());

        // Simulate a restart: new AppState, same repository container.
        let restarted = crate::AppState {
            repositories: state.repositories.clone(),
            ..crate::AppState::new()
        };
        assert_eq!(
            consume_emergency_token(&restarted, &token, "PAT-9")
                .await
                .unwrap_err(),
            "token already used",
            "a redeemed emergency token became replayable after restart"
        );
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
