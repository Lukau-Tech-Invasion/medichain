//! Durable, single-use wallet-login challenges.
//!
//! Challenges are issued without consulting the user store so the pre-login
//! response cannot disclose whether a wallet is registered.

use chrono::{Duration, Utc};
use serde::Serialize;
use sha3::{Digest, Sha3_256};
use sqlx::PgPool;
use uuid::Uuid;

pub const CHALLENGE_TTL_SECS: i64 = 300;
pub const MAX_CHALLENGES_PER_WALLET_PER_MINUTE: i64 = 5;

#[derive(Debug, Clone, Serialize)]
pub struct IssuedAuthChallenge {
    pub challenge_id: String,
    pub nonce: String,
    pub message: String,
    pub expires_in_secs: i64,
}

#[derive(Debug)]
pub enum IssueError {
    Database(sqlx::Error),
    RateLimited,
}

pub fn login_message(challenge_id: &str, wallet_address: &str, nonce: &str) -> String {
    format!("MediChain login:{challenge_id}:{wallet_address}:{nonce}")
}

fn nonce_hash(nonce: &str) -> String {
    format!("{:x}", Sha3_256::digest(nonce.as_bytes()))
}

pub async fn issue(pool: &PgPool, wallet_address: &str) -> Result<IssuedAuthChallenge, IssueError> {
    let challenge_id = Uuid::new_v4();
    let nonce = Uuid::new_v4().to_string();
    let expires_at = Utc::now() + Duration::seconds(CHALLENGE_TTL_SECS);
    let mut transaction = pool.begin().await.map_err(IssueError::Database)?;

    // Serialize issuance for this wallet across all API instances. The generic
    // IP limiter remains useful for broad DoS, but it is process-local and
    // cannot safely enforce a per-wallet authentication budget under replicas.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(wallet_address)
        .execute(&mut *transaction)
        .await
        .map_err(IssueError::Database)?;
    let recent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM auth_challenges WHERE wallet_address = $1 \
         AND created_at >= NOW() - INTERVAL '1 minute'",
    )
    .bind(wallet_address)
    .fetch_one(&mut *transaction)
    .await
    .map_err(IssueError::Database)?;
    if recent >= MAX_CHALLENGES_PER_WALLET_PER_MINUTE {
        return Err(IssueError::RateLimited);
    }

    sqlx::query(
        "INSERT INTO auth_challenges (id, wallet_address, nonce_hash, expires_at) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(challenge_id)
    .bind(wallet_address)
    .bind(nonce_hash(&nonce))
    .bind(expires_at)
    .execute(&mut *transaction)
    .await
    .map_err(IssueError::Database)?;

    transaction.commit().await.map_err(IssueError::Database)?;

    Ok(IssuedAuthChallenge {
        message: login_message(&challenge_id.to_string(), wallet_address, &nonce),
        challenge_id: challenge_id.to_string(),
        nonce,
        expires_in_secs: CHALLENGE_TTL_SECS,
    })
}

/// Atomically consumes a challenge. Only one concurrent verifier can succeed.
pub async fn consume(
    pool: &PgPool,
    challenge_id: &str,
    wallet_address: &str,
    nonce: &str,
) -> Result<bool, sqlx::Error> {
    let Ok(challenge_id) = Uuid::parse_str(challenge_id) else {
        return Ok(false);
    };

    let consumed = sqlx::query(
        "UPDATE auth_challenges
         SET used_at = NOW()
         WHERE id = $1
           AND wallet_address = $2
           AND nonce_hash = $3
           AND used_at IS NULL
           AND expires_at > NOW()",
    )
    .bind(challenge_id)
    .bind(wallet_address)
    .bind(nonce_hash(nonce))
    .execute(pool)
    .await?;

    Ok(consumed.rows_affected() == 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_message_binds_challenge_wallet_and_nonce() {
        assert_eq!(
            login_message("challenge-1", "wallet-1", "nonce-1"),
            "MediChain login:challenge-1:wallet-1:nonce-1"
        );
    }

    #[test]
    fn nonce_is_not_persisted_in_cleartext() {
        assert_ne!(nonce_hash("nonce-1"), "nonce-1");
    }
}
