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
pub async fn consume(
    pool: &PgPool,
    wallet_address: &str,
    refresh_token: &str,
    refresh_jti: &str,
) -> Result<bool, sqlx::Error> {
    let Ok(refresh_jti) = Uuid::parse_str(refresh_jti) else {
        return Ok(false);
    };
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
    .bind(token_hash(refresh_token))
    .bind(refresh_jti)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
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
