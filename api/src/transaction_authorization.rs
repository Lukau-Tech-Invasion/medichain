//! Session step-up and exact, single-use transaction authorization.
//!
//! The caller's identity always comes from a verified JWT. A factor verifies a
//! server-issued challenge; the eventual mutation must consume that challenge
//! with its original intent. No client-held signing key is involved.

use chrono::{Duration, Utc};
use serde::Serialize;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub const STEP_UP_TTL_SECS: i64 = 600;
pub const TRANSACTION_CHALLENGE_TTL_SECS: i64 = 120;
pub const MAX_LIVE_CHALLENGES_PER_SESSION: i64 = 3;
pub const MAX_CHALLENGES_PER_SESSION: i64 = 10;
pub const CHALLENGE_BUDGET_WINDOW_MINUTES: i64 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Factor {
    Totp,
    Password,
}
impl Factor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Totp => "totp",
            Self::Password => "password",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "totp" => Some(Self::Totp),
            "password" => Some(Self::Password),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityEvent {
    FactorRejected,
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
            Self::FactorRejected => "FACTOR_REJECTED",
            Self::ChallengeReplay => "CHALLENGE_REPLAY",
            Self::ChallengeExpired => "CHALLENGE_EXPIRED",
            Self::SessionRevoked => "SESSION_REVOKED",
            Self::RequestDigestMismatch => "REQUEST_DIGEST_MISMATCH",
            Self::ResourceStateChanged => "RESOURCE_STATE_CHANGED",
            Self::ChallengeRateLimited => "CHALLENGE_RATE_LIMITED",
        }
    }
}

/// What the idempotency middleware buffered for a mutation: the SHA-256 of the
/// exact request bytes and the request's idempotency key. A Class C gate reads
/// this instead of re-serialising the parsed body.
#[derive(Debug, Clone)]
pub struct TransmittedRequest {
    pub body_digest: String,
    pub idempotency_key: String,
}

/// The header carrying a verified Class C authorization id.
pub const AUTHORIZATION_HEADER: &str = "x-transaction-authorization";

pub fn body_digest(body: &[u8]) -> String {
    use sha2::Digest as _;
    format!("{:x}", sha2::Sha256::digest(body))
}

#[derive(Debug, Clone, Serialize)]
pub struct IssuedTransactionChallenge {
    pub challenge_id: String,
    pub expires_in_secs: i64,
    pub required_factor: &'static str,
}
#[derive(Debug, Clone)]
pub struct TransactionIntent {
    pub action: String,
    pub method: String,
    pub path: String,
    pub body_digest: String,
    pub resource_id: Option<String>,
    pub expected_state: Option<String>,
    pub idempotency_key: Option<String>,
}
#[derive(Debug)]
pub enum ChallengeError {
    Database(sqlx::Error),
    SessionNotActive,
    RateLimited,
    TooManyLive,
}

pub async fn required_factor(pool: &PgPool, user_id: Uuid) -> Result<Factor, sqlx::Error> {
    let enrolled: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM user_mfa WHERE user_id = $1 AND enabled = TRUE)",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(if enrolled {
        Factor::Totp
    } else {
        Factor::Password
    })
}

pub async fn issue_transaction_challenge(
    pool: &PgPool,
    user_id: &str,
    login_session_id: Uuid,
    intent: &TransactionIntent,
) -> Result<IssuedTransactionChallenge, ChallengeError> {
    let user_uuid = crate::actor_directory::parse_user_id(user_id).ok_or_else(|| {
        ChallengeError::Database(sqlx::Error::Protocol("user id is not a UUID".into()))
    })?;
    let factor = required_factor(pool, user_uuid)
        .await
        .map_err(ChallengeError::Database)?;
    let mut tx = pool.begin().await.map_err(ChallengeError::Database)?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(login_session_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(ChallengeError::Database)?;
    let active: Option<bool> = sqlx::query_scalar(
        "SELECT revoked_at IS NULL AND user_id = $2 FROM auth_login_sessions WHERE id = $1",
    )
    .bind(login_session_id)
    .bind(user_uuid)
    .fetch_optional(&mut *tx)
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
    .fetch_one(&mut *tx)
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
    .fetch_one(&mut *tx)
    .await
    .map_err(ChallengeError::Database)?;
    if recent >= MAX_CHALLENGES_PER_SESSION {
        return Err(ChallengeError::RateLimited);
    }
    let challenge_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO auth_transaction_challenges
             (id, login_session_id, user_id, action, method, path, body_digest,
              resource_id, expected_state, idempotency_key, required_factor, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    )
    .bind(challenge_id)
    .bind(login_session_id)
    .bind(user_uuid)
    .bind(&intent.action)
    .bind(&intent.method)
    .bind(&intent.path)
    .bind(&intent.body_digest)
    .bind(&intent.resource_id)
    .bind(&intent.expected_state)
    .bind(&intent.idempotency_key)
    .bind(factor.as_str())
    .bind(Utc::now() + Duration::seconds(TRANSACTION_CHALLENGE_TTL_SECS))
    .execute(&mut *tx)
    .await
    .map_err(ChallengeError::Database)?;
    tx.commit().await.map_err(ChallengeError::Database)?;
    Ok(IssuedTransactionChallenge {
        challenge_id: challenge_id.to_string(),
        expires_in_secs: TRANSACTION_CHALLENGE_TTL_SECS,
        required_factor: factor.as_str(),
    })
}

#[derive(Debug, PartialEq, Eq)]
pub enum AuthorizationFailure {
    UnknownChallenge,
    Expired,
    AlreadyConsumed,
    WrongSession,
    WrongSubject,
    IntentMismatch,
    StateChanged,
    FactorRejected,
    NotVerified,
}
impl AuthorizationFailure {
    pub fn security_event(&self) -> SecurityEvent {
        match self {
            Self::UnknownChallenge | Self::AlreadyConsumed | Self::NotVerified => {
                SecurityEvent::ChallengeReplay
            }
            Self::Expired => SecurityEvent::ChallengeExpired,
            Self::WrongSession => SecurityEvent::SessionRevoked,
            Self::WrongSubject | Self::FactorRejected => SecurityEvent::FactorRejected,
            Self::IntentMismatch => SecurityEvent::RequestDigestMismatch,
            Self::StateChanged => SecurityEvent::ResourceStateChanged,
        }
    }
    pub fn client_message(&self) -> &'static str {
        "This authorization is no longer valid. Please confirm the action again."
    }
}

pub async fn record_security_event(
    pool: &PgPool,
    event: SecurityEvent,
    user_id: Option<&str>,
    login_session_id: Option<Uuid>,
    challenge_id: Option<Uuid>,
    action: Option<&str>,
) {
    let recent: Result<i64, _> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM auth_security_events
         WHERE event_type = $1
           AND user_id IS NOT DISTINCT FROM $2::text::uuid
           AND occurred_at >= NOW() - INTERVAL '10 seconds'",
    )
    .bind(event.as_str())
    .bind(user_id)
    .fetch_one(pool)
    .await;
    if matches!(recent, Ok(count) if count >= 5) {
        return;
    }
    let write = sqlx::query(
        "INSERT INTO auth_security_events
             (event_type, user_id, login_session_id, challenge_id, action)
         VALUES ($1, $2::text::uuid, $3, $4, $5)",
    )
    .bind(event.as_str())
    .bind(user_id)
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

pub struct TransactionProof<'a> {
    pub challenge_id: Uuid,
    pub subject: &'a str,
    pub login_session_id: Uuid,
}
#[derive(sqlx::FromRow)]
struct ChallengeRow {
    login_session_id: Uuid,
    user_id: Uuid,
    action: String,
    method: String,
    path: String,
    body_digest: String,
    resource_id: Option<String>,
    expected_state: Option<String>,
    idempotency_key: Option<String>,
    required_factor: String,
    verified_at: Option<chrono::DateTime<Utc>>,
    expires_at: chrono::DateTime<Utc>,
    consumed_at: Option<chrono::DateTime<Utc>>,
}
async fn locked_challenge(
    tx: &mut Transaction<'_, Postgres>,
    challenge_id: Uuid,
) -> Result<ChallengeRow, AuthorizationFailure> {
    sqlx::query_as::<_, ChallengeRow>(
        "SELECT login_session_id, user_id, action, method, path, body_digest,
                resource_id, expected_state, idempotency_key, required_factor,
                verified_at, expires_at, consumed_at
         FROM auth_transaction_challenges WHERE id = $1 FOR UPDATE",
    )
    .bind(challenge_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AuthorizationFailure::UnknownChallenge)?
    .ok_or(AuthorizationFailure::UnknownChallenge)
}
async fn check_challenge(
    tx: &mut Transaction<'_, Postgres>,
    row: &ChallengeRow,
    proof: &TransactionProof<'_>,
) -> Result<(), AuthorizationFailure> {
    if row.consumed_at.is_some() {
        return Err(AuthorizationFailure::AlreadyConsumed);
    }
    if row.expires_at <= Utc::now() {
        return Err(AuthorizationFailure::Expired);
    }
    if row.login_session_id != proof.login_session_id {
        return Err(AuthorizationFailure::WrongSession);
    }
    if row.user_id.to_string() != proof.subject {
        return Err(AuthorizationFailure::WrongSubject);
    }
    let active: Option<bool> = sqlx::query_scalar(
        "SELECT revoked_at IS NULL AND user_id = $2
         FROM auth_login_sessions WHERE id = $1",
    )
    .bind(proof.login_session_id)
    .bind(row.user_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AuthorizationFailure::WrongSession)?;
    if active != Some(true) {
        return Err(AuthorizationFailure::WrongSession);
    }
    Ok(())
}

/// Mark a factor as verified. The mutation must still spend the bound challenge.
pub async fn mark_verified(
    pool: &PgPool,
    proof: TransactionProof<'_>,
    factor: Factor,
) -> Result<(), AuthorizationFailure> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| AuthorizationFailure::UnknownChallenge)?;
    let row = locked_challenge(&mut tx, proof.challenge_id).await?;
    check_challenge(&mut tx, &row, &proof).await?;
    if row.verified_at.is_some() || row.required_factor != factor.as_str() {
        return Err(AuthorizationFailure::FactorRejected);
    }
    let updated = sqlx::query(
        "UPDATE auth_transaction_challenges
         SET verified_at = NOW(), authenticator_type = $2
         WHERE id = $1 AND verified_at IS NULL AND consumed_at IS NULL",
    )
    .bind(proof.challenge_id)
    .bind(factor.as_str())
    .execute(&mut *tx)
    .await
    .map_err(|_| AuthorizationFailure::UnknownChallenge)?;
    if updated.rows_affected() != 1 {
        return Err(AuthorizationFailure::AlreadyConsumed);
    }
    tx.commit()
        .await
        .map_err(|_| AuthorizationFailure::UnknownChallenge)
}

/// Consume a previously verified challenge for exactly the bound mutation.
pub async fn authorize_transaction(
    pool: &PgPool,
    proof: TransactionProof<'_>,
    intent: &TransactionIntent,
) -> Result<(), AuthorizationFailure> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| AuthorizationFailure::UnknownChallenge)?;
    let row = locked_challenge(&mut tx, proof.challenge_id).await?;
    check_challenge(&mut tx, &row, &proof).await?;
    if row.verified_at.is_none() {
        return Err(AuthorizationFailure::NotVerified);
    }
    if row.action != intent.action
        || row.method != intent.method
        || row.path != intent.path
        || row.body_digest != intent.body_digest
        || row.resource_id != intent.resource_id
        || row.idempotency_key != intent.idempotency_key
    {
        return Err(AuthorizationFailure::IntentMismatch);
    }
    if row.expected_state != intent.expected_state {
        return Err(AuthorizationFailure::StateChanged);
    }
    let updated = sqlx::query(
        "UPDATE auth_transaction_challenges SET consumed_at = NOW()
         WHERE id = $1 AND consumed_at IS NULL",
    )
    .bind(proof.challenge_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| AuthorizationFailure::AlreadyConsumed)?;
    if updated.rows_affected() != 1 {
        return Err(AuthorizationFailure::AlreadyConsumed);
    }
    tx.commit()
        .await
        .map_err(|_| AuthorizationFailure::AlreadyConsumed)
}
/// Persist a verified second factor on this active login session.
pub async fn record_step_up(
    pool: &PgPool,
    login_session_id: Uuid,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    let result = sqlx::query(
        "UPDATE auth_login_sessions
         SET step_up_until = NOW() + make_interval(secs => $3)
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    )
    .bind(login_session_id)
    .bind(user_id)
    .bind(STEP_UP_TTL_SECS as f64)
    .execute(pool)
    .await?;
    if result.rows_affected() != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}

pub async fn has_active_step_up(
    pool: &PgPool,
    login_session_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let elevated: Option<bool> = sqlx::query_scalar(
        "SELECT revoked_at IS NULL AND step_up_until IS NOT NULL AND step_up_until > NOW()
         FROM auth_login_sessions WHERE id = $1",
    )
    .bind(login_session_id)
    .fetch_optional(pool)
    .await?;
    Ok(elevated.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn body_digest_binds_the_exact_bytes() {
        assert_eq!(
            body_digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_ne!(
            body_digest(br#"{"a":1,"b":2}"#),
            body_digest(br#"{"b":2,"a":1}"#)
        );
    }
    #[test]
    fn only_supported_factors_parse() {
        assert_eq!(Factor::parse("totp"), Some(Factor::Totp));
        assert_eq!(Factor::parse("password"), Some(Factor::Password));
    }

    fn intent() -> TransactionIntent {
        TransactionIntent {
            action: "patient_access.approve".to_string(),
            method: "POST".to_string(),
            path: "/api/access/requests/req-1/approve".to_string(),
            body_digest: body_digest(b"{}"),
            resource_id: Some("req-1".to_string()),
            expected_state: Some("pending".to_string()),
            idempotency_key: Some("idem-1".to_string()),
        }
    }

    #[tokio::test]
    async fn verified_challenge_is_bound_and_single_use() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let user_id = crate::test_fixtures::insert_pg_user(&pool, "Doctor").await;
        let sid = crate::auth_sessions::create(
            &pool,
            &user_id,
            "transaction-test-generation",
            &Uuid::new_v4().to_string(),
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();
        let original = intent();
        let issued = issue_transaction_challenge(&pool, &user_id, sid, &original)
            .await
            .unwrap();
        assert_eq!(issued.required_factor, "password");
        let challenge_id = Uuid::parse_str(&issued.challenge_id).unwrap();
        let proof = || TransactionProof {
            challenge_id,
            subject: &user_id,
            login_session_id: sid,
        };
        assert_eq!(
            authorize_transaction(&pool, proof(), &original).await,
            Err(AuthorizationFailure::NotVerified),
        );
        mark_verified(&pool, proof(), Factor::Password)
            .await
            .unwrap();
        let mut altered = original.clone();
        altered.body_digest = body_digest(b"{\"changed\":true}");
        assert_eq!(
            authorize_transaction(&pool, proof(), &altered).await,
            Err(AuthorizationFailure::IntentMismatch),
        );
        authorize_transaction(&pool, proof(), &original)
            .await
            .unwrap();
        assert_eq!(
            authorize_transaction(&pool, proof(), &original).await,
            Err(AuthorizationFailure::AlreadyConsumed),
        );
    }

    #[tokio::test]
    async fn revoked_session_cannot_complete_a_challenge() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let user_id = crate::test_fixtures::insert_pg_user(&pool, "Doctor").await;
        let sid = crate::auth_sessions::create(
            &pool,
            &user_id,
            "revocation-test-generation",
            &Uuid::new_v4().to_string(),
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();
        let issued = issue_transaction_challenge(&pool, &user_id, sid, &intent())
            .await
            .unwrap();
        crate::auth_sessions::revoke_session(&pool, sid, "logout")
            .await
            .unwrap();
        let proof = TransactionProof {
            challenge_id: Uuid::parse_str(&issued.challenge_id).unwrap(),
            subject: &user_id,
            login_session_id: sid,
        };
        assert_eq!(
            mark_verified(&pool, proof, Factor::Password).await,
            Err(AuthorizationFailure::WrongSession),
        );
    }
}
