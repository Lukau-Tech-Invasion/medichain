//! Class B step-up and Class C exact transaction authorization (ADR-0008).
//!
//! Three security properties are kept apart here, because conflating them is
//! what made the original design wrong:
//!
//! * a Bearer token answers *which authenticated session is calling*;
//! * a wallet proof answers *does that subject still control the registered key*;
//! * a transaction signature answers *did they authorize this exact mutation*.
//!
//! Nothing in this module takes identity from the request. The subject comes
//! from the verified JWT and the wallet is resolved from that subject, so a
//! caller cannot select the key whose signature is trusted.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sha3::{Digest, Sha3_256};
use sqlx::PgPool;
use uuid::Uuid;

/// Class B elevation lifetime. Long enough to complete a privileged workflow,
/// short enough that walking away from a terminal does not leave it elevated.
pub const STEP_UP_TTL_SECS: i64 = 600;

/// Class C challenge lifetime. This is a human confirming one action, not a
/// session: it should outlive a wallet prompt and nothing more.
pub const TRANSACTION_CHALLENGE_TTL_SECS: i64 = 120;

/// At most this many unconsumed challenges may exist for one session. Without a
/// cap an authenticated client can cheaply create unbounded authorization
/// objects.
pub const MAX_LIVE_CHALLENGES_PER_SESSION: i64 = 3;

/// Issuance budget per session. A human cannot meaningfully approve dozens of
/// high-risk transactions a minute; past that the signature is theatre. Separate
/// from the anonymous login-challenge budget, which defends a different resource
/// and has entirely different user behaviour.
pub const MAX_CHALLENGES_PER_SESSION: i64 = 10;
pub const CHALLENGE_BUDGET_WINDOW_MINUTES: i64 = 5;

/// Rejected authorization proofs. Recorded separately from the business audit
/// trail: a rejected proof is often the only trace an attack leaves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityEvent {
    SignatureSubjectMismatch,
    ChallengeReplay,
    ChallengeExpired,
    SessionRevoked,
    RequestDigestMismatch,
    ResourceStateChanged,
    ChallengeRateLimited,
}

impl SecurityEvent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SignatureSubjectMismatch => "SIGNATURE_SUBJECT_MISMATCH",
            Self::ChallengeReplay => "CHALLENGE_REPLAY",
            Self::ChallengeExpired => "CHALLENGE_EXPIRED",
            Self::SessionRevoked => "SESSION_REVOKED",
            Self::RequestDigestMismatch => "REQUEST_DIGEST_MISMATCH",
            Self::ResourceStateChanged => "RESOURCE_STATE_CHANGED",
            Self::ChallengeRateLimited => "CHALLENGE_RATE_LIMITED",
        }
    }
}

/// How the signature was produced. A valid sr25519 signature proves a key signed
/// some bytes; it does not prove a human approved them. The extension prompts,
/// a password-unlocked keystore may not, so the distinction is recorded rather
/// than assumed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticatorType {
    /// Prompts the user for each signature: evidence of authentication intent.
    PolkadotExtension,
    /// Can sign without further interaction once unlocked: key possession only.
    EncryptedKeystore,
}

impl AuthenticatorType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PolkadotExtension => "polkadot_extension",
            Self::EncryptedKeystore => "encrypted_keystore",
        }
    }

    /// Whether this authenticator demonstrates a deliberate human act. Class C
    /// actions whose purpose is explicit confirmation require `true`; a silently
    /// unlocked keystore satisfies possession but not intent.
    ///
    /// This is evidence of the mechanism used, not cryptographic proof that a
    /// prompt was displayed and read. It is still materially better than
    /// treating every signature as equivalent.
    pub fn is_interactive(self) -> bool {
        matches!(self, Self::PolkadotExtension)
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "polkadot_extension" => Some(Self::PolkadotExtension),
            "encrypted_keystore" => Some(Self::EncryptedKeystore),
            _ => None,
        }
    }
}

fn nonce_digest(value: &str) -> String {
    format!("{:x}", Sha3_256::digest(value.as_bytes()))
}

/// SHA-256 over the exact bytes the client transmits.
///
/// Never hash a re-serialisation of a parsed value: `JSON.stringify` output
/// depends on property insertion order, so reordering a struct literal silently
/// changes the digest and the failure is intermittent. A request with no body
/// hashes the empty byte string, defined here rather than left implicit.
pub fn body_digest(body: &[u8]) -> String {
    use sha2::Digest as _;
    format!("{:x}", sha2::Sha256::digest(body))
}

/// A challenge as handed to the client. The nonce is returned once; only its
/// digest is stored, so a leaked table cannot replay it.
#[derive(Debug, Clone, Serialize)]
pub struct IssuedTransactionChallenge {
    pub challenge_id: String,
    pub nonce: String,
    /// The canonical string the wallet signs.
    pub message: String,
    pub expires_in_secs: i64,
}

/// What the mutation is bound to. Every field is covered by the signed message.
#[derive(Debug, Clone)]
pub struct TransactionIntent {
    pub action: String,
    pub method: String,
    pub path: String,
    pub body_digest: String,
    pub resource_id: Option<String>,
    /// Terminal status for a state-machine row, or `xmin` for an ordinary row.
    pub expected_state: Option<String>,
    pub idempotency_key: Option<String>,
}

/// The canonical representation the wallet signs.
///
/// Every field the server will re-check appears here, so a signature obtained
/// for one request cannot be replayed against another: a different path, body,
/// resource state or session all produce a different message.
pub fn challenge_message(
    challenge_id: &str,
    subject: &str,
    session_id: &str,
    intent: &TransactionIntent,
    nonce: &str,
    expires_at: DateTime<Utc>,
) -> String {
    let mut message = String::with_capacity(320);
    message.push_str("medichain-txn-v1\n");
    message.push_str("aud:medichain-api\n");
    message.push_str(&format!("sub:{subject}\n"));
    message.push_str(&format!("sid:{session_id}\n"));
    message.push_str(&format!("cid:{challenge_id}\n"));
    message.push_str(&format!("action:{}\n", intent.action));
    message.push_str(&format!("method:{}\n", intent.method));
    message.push_str(&format!("path:{}\n", intent.path));
    message.push_str(&format!("body:{}\n", intent.body_digest));
    message.push_str(&format!(
        "resource:{}\n",
        intent.resource_id.as_deref().unwrap_or("-")
    ));
    message.push_str(&format!(
        "state:{}\n",
        intent.expected_state.as_deref().unwrap_or("-")
    ));
    message.push_str(&format!(
        "idem:{}\n",
        intent.idempotency_key.as_deref().unwrap_or("-")
    ));
    message.push_str(&format!("nonce:{nonce}\n"));
    message.push_str(&format!("expires:{}", expires_at.timestamp()));
    message
}

#[derive(Debug)]
pub enum ChallengeError {
    Database(sqlx::Error),
    SessionNotActive,
    RateLimited,
    TooManyLive,
}

/// Issue a Class C challenge for one exact mutation.
///
/// The server generates it, never the browser: a challenge the client composes
/// is a challenge the client can choose.
pub async fn issue_transaction_challenge(
    pool: &PgPool,
    wallet_address: &str,
    login_session_id: Uuid,
    intent: &TransactionIntent,
) -> Result<IssuedTransactionChallenge, ChallengeError> {
    let challenge_id = Uuid::new_v4();
    let nonce = Uuid::new_v4().to_string();
    let expires_at = Utc::now() + Duration::seconds(TRANSACTION_CHALLENGE_TTL_SECS);

    let mut transaction = pool.begin().await.map_err(ChallengeError::Database)?;

    // Serialise issuance for this session across replicas. The generic IP
    // limiter is process-local and cannot enforce a per-session budget when the
    // API runs more than once.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(login_session_id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(ChallengeError::Database)?;

    // The session must still be live. Elevation and authorization both hang off
    // it, so a revoked login must not be able to mint new authority.
    let active: Option<bool> =
        sqlx::query_scalar("SELECT revoked_at IS NULL FROM auth_login_sessions WHERE id = $1")
            .bind(login_session_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(ChallengeError::Database)?;
    if active != Some(true) {
        return Err(ChallengeError::SessionNotActive);
    }

    let live: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM auth_transaction_challenges
         WHERE login_session_id = $1 AND consumed_at IS NULL AND expires_at > NOW()",
    )
    .bind(login_session_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(ChallengeError::Database)?;
    if live >= MAX_LIVE_CHALLENGES_PER_SESSION {
        return Err(ChallengeError::TooManyLive);
    }

    let recent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM auth_transaction_challenges
         WHERE login_session_id = $1
           AND created_at >= NOW() - make_interval(mins => $2)",
    )
    .bind(login_session_id)
    .bind(CHALLENGE_BUDGET_WINDOW_MINUTES as i32)
    .fetch_one(&mut *transaction)
    .await
    .map_err(ChallengeError::Database)?;
    if recent >= MAX_CHALLENGES_PER_SESSION {
        return Err(ChallengeError::RateLimited);
    }

    sqlx::query(
        "INSERT INTO auth_transaction_challenges
             (id, login_session_id, wallet_address, action, method, path, body_digest,
              resource_id, expected_state, idempotency_key, nonce_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(challenge_id)
    .bind(login_session_id)
    .bind(wallet_address)
    .bind(&intent.action)
    .bind(&intent.method)
    .bind(&intent.path)
    .bind(&intent.body_digest)
    .bind(&intent.resource_id)
    .bind(&intent.expected_state)
    .bind(&intent.idempotency_key)
    .bind(nonce_digest(&nonce))
    .bind(expires_at)
    .execute(&mut *transaction)
    .await
    .map_err(ChallengeError::Database)?;

    transaction
        .commit()
        .await
        .map_err(ChallengeError::Database)?;

    Ok(IssuedTransactionChallenge {
        message: challenge_message(
            &challenge_id.to_string(),
            wallet_address,
            &login_session_id.to_string(),
            intent,
            &nonce,
            expires_at,
        ),
        challenge_id: challenge_id.to_string(),
        nonce,
        expires_in_secs: TRANSACTION_CHALLENGE_TTL_SECS,
    })
}

/// Why an authorization was refused. Each maps to a security event, because the
/// refusals are the interesting half of this protocol.
#[derive(Debug, PartialEq, Eq)]
pub enum AuthorizationFailure {
    UnknownChallenge,
    Expired,
    AlreadyConsumed,
    WrongSession,
    WrongSubject,
    IntentMismatch,
    StateChanged,
    BadSignature,
    /// The action demands a deliberate human act and the authenticator cannot
    /// evidence one.
    NonInteractiveAuthenticator,
}

impl AuthorizationFailure {
    pub fn security_event(&self) -> SecurityEvent {
        match self {
            Self::UnknownChallenge | Self::AlreadyConsumed => SecurityEvent::ChallengeReplay,
            Self::Expired => SecurityEvent::ChallengeExpired,
            Self::WrongSession => SecurityEvent::SessionRevoked,
            Self::WrongSubject | Self::BadSignature | Self::NonInteractiveAuthenticator => {
                SecurityEvent::SignatureSubjectMismatch
            }
            Self::IntentMismatch => SecurityEvent::RequestDigestMismatch,
            Self::StateChanged => SecurityEvent::ResourceStateChanged,
        }
    }

    /// Deliberately uniform and uninformative. A caller probing the protocol
    /// learns that the authorization failed, not which check caught it.
    pub fn client_message(&self) -> &'static str {
        "This authorization is no longer valid. Please confirm the action again."
    }
}

/// Record a rejected authorization proof.
///
/// Carries no raw token, signature, request body or patient detail -- only the
/// event kind and safe references. Failures here are logged and swallowed: a
/// security-event write must never be the reason a request that was already
/// being refused turns into a 500.
pub async fn record_security_event(
    pool: &PgPool,
    event: SecurityEvent,
    wallet_address: Option<&str>,
    login_session_id: Option<Uuid>,
    challenge_id: Option<Uuid>,
    action: Option<&str>,
) {
    // Deduplicate within a short window so an attacker cannot turn invalid
    // signatures into unbounded log volume. Logging must not itself become the
    // resource-exhaustion vector.
    let recent: Result<i64, _> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM auth_security_events
         WHERE event_type = $1
           AND wallet_address IS NOT DISTINCT FROM $2
           AND occurred_at >= NOW() - make_interval(secs => 10)",
    )
    .bind(event.as_str())
    .bind(wallet_address)
    .fetch_one(pool)
    .await;

    if matches!(recent, Ok(count) if count >= 5) {
        return;
    }

    let write = sqlx::query(
        "INSERT INTO auth_security_events
             (event_type, wallet_address, login_session_id, challenge_id, action)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(event.as_str())
    .bind(wallet_address)
    .bind(login_session_id)
    .bind(challenge_id)
    .bind(action)
    .execute(pool)
    .await;

    if let Err(error) = write {
        log::error!(
            "Security event {} could not be recorded: {error}",
            event.as_str()
        );
    }
}

/// Verify a Class C authorization and consume the challenge.
///
/// Verification order matters, and consumption is last: a challenge is only
/// spent once every check has passed, so a failed attempt cannot burn a
/// legitimate user's authorization.
///
/// `require_interactive` is set by the action, not the caller: operations whose
/// purpose is explicit human confirmation refuse an authenticator that can sign
/// silently.
#[allow(clippy::too_many_arguments)]
pub async fn authorize_transaction(
    pool: &PgPool,
    challenge_id: Uuid,
    subject: &str,
    login_session_id: Uuid,
    intent: &TransactionIntent,
    nonce: &str,
    signature_hex: &str,
    authenticator: AuthenticatorType,
    require_interactive: bool,
) -> Result<(), AuthorizationFailure> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| AuthorizationFailure::UnknownChallenge)?;

    // Lock the challenge row so two concurrent submissions of the same
    // authorization cannot both pass their checks before either consumes it.
    #[allow(clippy::type_complexity)]
    let row: Option<(
        Uuid,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        DateTime<Utc>,
        Option<DateTime<Utc>>,
    )> = sqlx::query_as(
        "SELECT login_session_id, wallet_address, action, method, path, body_digest,
                resource_id, expected_state, idempotency_key, nonce_hash,
                expires_at, consumed_at
         FROM auth_transaction_challenges
         WHERE id = $1
         FOR UPDATE",
    )
    .bind(challenge_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|_| AuthorizationFailure::UnknownChallenge)?;

    let Some((
        stored_session,
        stored_wallet,
        stored_action,
        stored_method,
        stored_path,
        stored_body,
        stored_resource,
        stored_state,
        stored_idem,
        stored_nonce_hash,
        expires_at,
        consumed_at,
    )) = row
    else {
        return Err(AuthorizationFailure::UnknownChallenge);
    };

    if consumed_at.is_some() {
        return Err(AuthorizationFailure::AlreadyConsumed);
    }
    if expires_at <= Utc::now() {
        return Err(AuthorizationFailure::Expired);
    }
    // The challenge belongs to one login and one subject. A token naming a
    // different session must not be able to complete someone else's
    // authorization.
    if stored_session != login_session_id {
        return Err(AuthorizationFailure::WrongSession);
    }
    if stored_wallet != subject {
        return Err(AuthorizationFailure::WrongSubject);
    }

    // The session must still be live at the moment of use, not merely when the
    // challenge was issued.
    let session_active: Option<bool> =
        sqlx::query_scalar("SELECT revoked_at IS NULL FROM auth_login_sessions WHERE id = $1")
            .bind(login_session_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|_| AuthorizationFailure::WrongSession)?;
    if session_active != Some(true) {
        return Err(AuthorizationFailure::WrongSession);
    }

    // The request presented now must be the request that was authorized.
    if stored_action != intent.action
        || stored_method != intent.method
        || stored_path != intent.path
        || stored_body != intent.body_digest
        || stored_resource != intent.resource_id
        || stored_idem != intent.idempotency_key
    {
        return Err(AuthorizationFailure::IntentMismatch);
    }
    // Approval of state N does not authorize state N+1.
    if stored_state != intent.expected_state {
        return Err(AuthorizationFailure::StateChanged);
    }

    if stored_nonce_hash != nonce_digest(nonce) {
        return Err(AuthorizationFailure::BadSignature);
    }

    if require_interactive && !authenticator.is_interactive() {
        return Err(AuthorizationFailure::NonInteractiveAuthenticator);
    }

    // The signature is verified against the wallet resolved from the stored
    // subject, never against an address supplied with the request.
    let message = challenge_message(
        &challenge_id.to_string(),
        &stored_wallet,
        &login_session_id.to_string(),
        intent,
        nonce,
        expires_at,
    );
    if medichain_crypto::signature::verify_wallet_message_signature(
        signature_hex,
        &message,
        &stored_wallet,
    )
    .is_err()
    {
        return Err(AuthorizationFailure::BadSignature);
    }

    // Consume last, and only on the row that is still unconsumed, so a race
    // between two valid submissions still yields exactly one authorization.
    let consumed = sqlx::query(
        "UPDATE auth_transaction_challenges
         SET consumed_at = NOW(), authenticator_type = $2
         WHERE id = $1 AND consumed_at IS NULL",
    )
    .bind(challenge_id)
    .bind(authenticator.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(|_| AuthorizationFailure::AlreadyConsumed)?;
    if consumed.rows_affected() != 1 {
        return Err(AuthorizationFailure::AlreadyConsumed);
    }

    transaction
        .commit()
        .await
        .map_err(|_| AuthorizationFailure::AlreadyConsumed)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Class B - session step-up
// ---------------------------------------------------------------------------

/// Record a successful wallet step-up against the login session.
///
/// Elevation lives on the parent session precisely so a refresh-token rotation
/// underneath it neither extends nor drops it.
pub async fn record_step_up(
    pool: &PgPool,
    login_session_id: Uuid,
    authenticator: AuthenticatorType,
) -> Result<bool, sqlx::Error> {
    let updated = sqlx::query(
        "UPDATE auth_login_sessions
         SET step_up_until = NOW() + make_interval(secs => $2),
             step_up_method = $3,
             last_authenticated_at = NOW()
         WHERE id = $1 AND revoked_at IS NULL",
    )
    .bind(login_session_id)
    .bind(STEP_UP_TTL_SECS as i32)
    .bind(authenticator.as_str())
    .execute(pool)
    .await?;
    Ok(updated.rows_affected() == 1)
}

/// Whether this session currently holds a valid Class B elevation.
///
/// Revocation is checked in the same statement: step-up state must not survive
/// logout, logout-all, or session revocation, so it is never read independently
/// of the session's own liveness.
pub async fn has_active_step_up(
    pool: &PgPool,
    login_session_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let elevated: Option<bool> = sqlx::query_scalar(
        "SELECT revoked_at IS NULL AND step_up_until IS NOT NULL AND step_up_until > NOW()
         FROM auth_login_sessions
         WHERE id = $1",
    )
    .bind(login_session_id)
    .fetch_optional(pool)
    .await?;
    Ok(elevated.unwrap_or(false))
}

/// Drop any elevation on this session without ending it.
///
/// ADR-0008 requires step-up state not to survive wallet credential revocation.
/// Session revocation already clears it implicitly, because `has_active_step_up`
/// reads elevation and liveness in one statement -- but credential revocation is
/// the case where the login legitimately continues while the proof that
/// justified elevated access no longer holds.
///
/// No caller yet: this codebase has no credential-revocation handler to call it
/// from. Kept rather than deleted so the requirement has an implementation
/// waiting when that handler is written, instead of being rediscovered then.
#[cfg_attr(not(test), allow(dead_code))]
pub async fn clear_step_up(pool: &PgPool, login_session_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE auth_login_sessions
         SET step_up_until = NULL, step_up_method = NULL
         WHERE id = $1",
    )
    .bind(login_session_id)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intent() -> TransactionIntent {
        TransactionIntent {
            action: "patient_access.approve".to_string(),
            method: "POST".to_string(),
            path: "/api/access/requests/123/approve".to_string(),
            body_digest: body_digest(b"{\"expiry\":\"2026-09-01\"}"),
            resource_id: Some("request-123".to_string()),
            expected_state: Some("pending".to_string()),
            idempotency_key: Some("idem-1".to_string()),
        }
    }

    fn message_for(intent: &TransactionIntent) -> String {
        challenge_message(
            "cid-1",
            "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
            "sid-1",
            intent,
            "nonce-1",
            DateTime::from_timestamp(1_800_000_000, 0).unwrap(),
        )
    }

    /// The empty body has a stated digest rather than an implicit one, so a
    /// bodyless request is authorized as deliberately as any other.
    #[test]
    fn empty_body_digest_is_defined_and_stable() {
        assert_eq!(
            body_digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    /// The digest covers bytes, so any change to the transmitted payload changes
    /// it -- including a reordering that a re-serialisation would have hidden.
    #[test]
    fn body_digest_distinguishes_reordered_payloads() {
        let a = body_digest(br#"{"a":1,"b":2}"#);
        let b = body_digest(br#"{"b":2,"a":1}"#);
        assert_ne!(
            a, b,
            "hashing transmitted bytes must not silently treat two encodings as one"
        );
    }

    /// Everything the server re-checks is inside the signed message. Each of
    /// these mutations must produce a different message, or a signature obtained
    /// for one request could be replayed against another.
    #[test]
    fn every_bound_field_changes_the_signed_message() {
        let base = message_for(&intent());

        let mut different_action = intent();
        different_action.action = "patient_access.deny".to_string();
        assert_ne!(base, message_for(&different_action), "action must be bound");

        let mut different_method = intent();
        different_method.method = "DELETE".to_string();
        assert_ne!(base, message_for(&different_method), "method must be bound");

        let mut different_path = intent();
        different_path.path = "/api/access/requests/456/approve".to_string();
        assert_ne!(base, message_for(&different_path), "path must be bound");

        let mut different_body = intent();
        different_body.body_digest = body_digest(b"{}");
        assert_ne!(base, message_for(&different_body), "body must be bound");

        let mut different_resource = intent();
        different_resource.resource_id = Some("request-456".to_string());
        assert_ne!(
            base,
            message_for(&different_resource),
            "resource must be bound"
        );

        // Approval of state N must not authorize state N+1.
        let mut different_state = intent();
        different_state.expected_state = Some("approved".to_string());
        assert_ne!(
            base,
            message_for(&different_state),
            "resource state must be bound"
        );

        let mut different_idem = intent();
        different_idem.idempotency_key = Some("idem-2".to_string());
        assert_ne!(
            base,
            message_for(&different_idem),
            "idempotency key must be bound"
        );
    }

    /// Subject, session and challenge identity are bound too, so one person's
    /// signature cannot complete another's authorization or another session's.
    #[test]
    fn subject_session_and_challenge_are_bound() {
        let intent = intent();
        let expires = DateTime::from_timestamp(1_800_000_000, 0).unwrap();
        let base = challenge_message("cid-1", "alice", "sid-1", &intent, "nonce-1", expires);

        assert_ne!(
            base,
            challenge_message("cid-1", "bob", "sid-1", &intent, "nonce-1", expires),
            "subject must be bound"
        );
        assert_ne!(
            base,
            challenge_message("cid-1", "alice", "sid-2", &intent, "nonce-1", expires),
            "session must be bound"
        );
        assert_ne!(
            base,
            challenge_message("cid-2", "alice", "sid-1", &intent, "nonce-1", expires),
            "challenge id must be bound"
        );
        assert_ne!(
            base,
            challenge_message("cid-1", "alice", "sid-1", &intent, "nonce-2", expires),
            "nonce must be bound"
        );
    }

    /// A version prefix means a future message format cannot be mistaken for
    /// this one by a verifier that has not been updated.
    #[test]
    fn signed_message_carries_a_version_and_audience() {
        let message = message_for(&intent());
        assert!(message.starts_with("medichain-txn-v1\n"));
        assert!(message.contains("aud:medichain-api"));
    }

    /// Only an authenticator that prompts a human evidences intent. A
    /// password-unlocked keystore proves key possession and nothing more.
    #[test]
    fn only_the_prompting_authenticator_evidences_intent() {
        assert!(AuthenticatorType::PolkadotExtension.is_interactive());
        assert!(!AuthenticatorType::EncryptedKeystore.is_interactive());
        assert_eq!(
            AuthenticatorType::parse("polkadot_extension"),
            Some(AuthenticatorType::PolkadotExtension)
        );
        assert_eq!(AuthenticatorType::parse("something_else"), None);
    }

    /// Every refusal maps to a recordable security event: the rejected proofs
    /// are the half of this protocol that leaves no other trace.
    #[test]
    fn every_failure_maps_to_a_security_event() {
        for failure in [
            AuthorizationFailure::UnknownChallenge,
            AuthorizationFailure::Expired,
            AuthorizationFailure::AlreadyConsumed,
            AuthorizationFailure::WrongSession,
            AuthorizationFailure::WrongSubject,
            AuthorizationFailure::IntentMismatch,
            AuthorizationFailure::StateChanged,
            AuthorizationFailure::BadSignature,
            AuthorizationFailure::NonInteractiveAuthenticator,
        ] {
            assert!(!failure.security_event().as_str().is_empty());
        }
    }

    /// The client message is uniform, so probing the protocol reveals that the
    /// authorization failed but not which check caught it.
    #[test]
    fn refusals_do_not_leak_which_check_failed() {
        let messages: std::collections::HashSet<&str> = [
            AuthorizationFailure::UnknownChallenge.client_message(),
            AuthorizationFailure::Expired.client_message(),
            AuthorizationFailure::WrongSubject.client_message(),
            AuthorizationFailure::BadSignature.client_message(),
            AuthorizationFailure::StateChanged.client_message(),
        ]
        .into_iter()
        .collect();
        assert_eq!(messages.len(), 1, "refusals must be indistinguishable");
    }
}
