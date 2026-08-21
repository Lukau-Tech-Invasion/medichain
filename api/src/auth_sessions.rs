//! Durable, rotating refresh-token sessions.

use chrono::{DateTime, Utc};
use sha3::{Digest, Sha3_256};
use sqlx::PgPool;
use uuid::Uuid;

fn token_hash(token: &str) -> String {
    format!("{:x}", Sha3_256::digest(token.as_bytes()))
}

pub async fn create(
    pool: &PgPool,
    wallet_address: &str,
    refresh_token: &str,
    refresh_jti: &str,
    expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let session_id = Uuid::new_v4();
    let refresh_jti = Uuid::parse_str(refresh_jti)
        .map_err(|_| sqlx::Error::Protocol("invalid refresh JTI".into()))?;
    sqlx::query(
        "INSERT INTO auth_sessions (id, wallet_address, refresh_token_hash, refresh_jti, expires_at)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(session_id)
    .bind(wallet_address)
    .bind(token_hash(refresh_token))
    .bind(refresh_jti)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Atomically consumes a refresh session. A repeated token cannot be used by
/// two concurrent refreshes or after the first successful rotation.
pub async fn rotate(
    pool: &PgPool,
    wallet_address: &str,
    previous_token: &str,
    previous_jti: &str,
    replacement_token: &str,
    replacement_jti: &str,
    replacement_expires_at: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let (Ok(previous_jti), Ok(replacement_jti)) = (
        Uuid::parse_str(previous_jti),
        Uuid::parse_str(replacement_jti),
    ) else {
        return Ok(false);
    };
    let mut transaction = pool.begin().await?;
    let result = sqlx::query(
        "UPDATE auth_sessions
         SET revoked_at = NOW(), last_used_at = NOW(), revocation_reason = 'rotated'
         WHERE wallet_address = $1
           AND refresh_token_hash = $2
           AND refresh_jti = $3
           AND revoked_at IS NULL
           AND expires_at > NOW()",
    )
    .bind(wallet_address)
    .bind(token_hash(previous_token))
    .bind(previous_jti)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() != 1 {
        transaction.rollback().await?;
        return Ok(false);
    }
    sqlx::query(
        "INSERT INTO auth_sessions (id, wallet_address, refresh_token_hash, refresh_jti, expires_at)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(Uuid::new_v4())
    .bind(wallet_address)
    .bind(token_hash(replacement_token))
    .bind(replacement_jti)
    .bind(replacement_expires_at)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_token_hash_does_not_expose_token() {
        let raw = "refresh-token-value";
        assert_ne!(token_hash(raw), raw);
        assert_eq!(token_hash(raw).len(), 64);
    }
}
