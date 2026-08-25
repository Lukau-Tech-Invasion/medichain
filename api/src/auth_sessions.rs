//! Durable login sessions and the rotating refresh-token generations beneath
//! them (ADR-0008).
//!
//! Two lifetimes live here and they are deliberately separate rows:
//!
//! * a **login session** (`auth_login_sessions`) is created once per successful
//!   authentication and ends at logout or revocation. Its id is the `sid` claim,
//!   and it owns step-up elevation state.
//! * a **refresh generation** (`auth_sessions`) is replaced on every rotation.
//!   Revoking the predecessor and inserting a successor is what proves two
//!   concurrent uses of one refresh token yield exactly one valid successor, so
//!   that history is kept rather than collapsed into an in-place update.
//!
//! `sid` therefore survives refresh, which is what lets a step-up elevation and
//! a transaction-authorization challenge outlive a token rotation.

use chrono::{DateTime, Utc};
use sha3::{Digest, Sha3_256};
use sqlx::PgPool;
use uuid::Uuid;

fn token_hash(token: &str) -> String {
    format!("{:x}", Sha3_256::digest(token.as_bytes()))
}

/// Open a login session and its first refresh generation, returning the `sid`
/// the access token should carry.
///
/// Both rows commit together: a token must never be returned for a session that
/// did not persist, so the caller mints the access token only after this returns.
pub async fn create(
    pool: &PgPool,
    wallet_address: &str,
    refresh_token: &str,
    refresh_jti: &str,
    expires_at: DateTime<Utc>,
) -> Result<Uuid, sqlx::Error> {
    let login_session_id = Uuid::new_v4();
    let generation_id = Uuid::new_v4();
    let refresh_jti = Uuid::parse_str(refresh_jti)
        .map_err(|_| sqlx::Error::Protocol("invalid refresh JTI".into()))?;

    let mut transaction = pool.begin().await?;
    sqlx::query("INSERT INTO auth_login_sessions (id, wallet_address) VALUES ($1, $2)")
        .bind(login_session_id)
        .bind(wallet_address)
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "INSERT INTO auth_sessions
             (id, wallet_address, refresh_token_hash, refresh_jti, expires_at, login_session_id)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(generation_id)
    .bind(wallet_address)
    .bind(token_hash(refresh_token))
    .bind(refresh_jti)
    .bind(expires_at)
    .bind(login_session_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(login_session_id)
}

/// Revoke one login session and, with it, every refresh generation beneath it.
/// Returns false when no active session matched, so logout is not replayable.
pub async fn revoke_session(
    pool: &PgPool,
    login_session_id: Uuid,
    reason: &str,
) -> Result<bool, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    // Same lock order as `rotate`: parent first. A rotation already holding this
    // row blocks here until it commits, and then finds the parent revoked.
    let existing: Option<Option<DateTime<Utc>>> =
        sqlx::query_scalar("SELECT revoked_at FROM auth_login_sessions WHERE id = $1 FOR UPDATE")
            .bind(login_session_id)
            .fetch_optional(&mut *transaction)
            .await?;
    if !matches!(existing, Some(None)) {
        transaction.rollback().await?;
        return Ok(false);
    }
    sqlx::query(
        "UPDATE auth_login_sessions
         SET revoked_at = NOW(), revocation_reason = $2
         WHERE id = $1",
    )
    .bind(login_session_id)
    .bind(reason)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE auth_sessions
         SET revoked_at = NOW(), revocation_reason = $2
         WHERE login_session_id = $1 AND revoked_at IS NULL",
    )
    .bind(login_session_id)
    .bind(reason)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(true)
}

/// Revoke every active login session for one wallet ("log out everywhere").
/// Returns how many sessions were ended.
pub async fn revoke_all_for_wallet(
    pool: &PgPool,
    wallet_address: &str,
    reason: &str,
) -> Result<u64, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    // Lock every parent for this wallet before touching any generation, in a
    // deterministic id order so two concurrent logout-alls cannot deadlock each
    // other. Rotation locks a single parent, so it serializes against this too.
    sqlx::query(
        "SELECT id FROM auth_login_sessions
         WHERE wallet_address = $1 AND revoked_at IS NULL
         ORDER BY id
         FOR UPDATE",
    )
    .bind(wallet_address)
    .fetch_all(&mut *transaction)
    .await?;
    let parents = sqlx::query(
        "UPDATE auth_login_sessions
         SET revoked_at = NOW(), revocation_reason = $2
         WHERE wallet_address = $1 AND revoked_at IS NULL",
    )
    .bind(wallet_address)
    .bind(reason)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE auth_sessions
         SET revoked_at = NOW(), revocation_reason = $2
         WHERE wallet_address = $1 AND revoked_at IS NULL",
    )
    .bind(wallet_address)
    .bind(reason)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(parents.rows_affected())
}

/// True when this login session is still usable. Revocation is authoritative in
/// the database, not in the token: an access token stays cryptographically valid
/// until it expires, so anything gated on session state must ask here.
///
/// Not yet called from a request path -- `SessionStateMiddleware` reads the row
/// directly because it also needs the subject binding in the same query. This is
/// the accessor the Class B step-up work will use, and the session tests already
/// assert through it, so it stays rather than being deleted and rewritten.
#[cfg_attr(not(test), allow(dead_code))]
pub async fn is_session_active(pool: &PgPool, login_session_id: Uuid) -> Result<bool, sqlx::Error> {
    let active: Option<bool> =
        sqlx::query_scalar("SELECT revoked_at IS NULL FROM auth_login_sessions WHERE id = $1")
            .bind(login_session_id)
            .fetch_optional(pool)
            .await?;
    Ok(active.unwrap_or(false))
}

/// Atomically consume a refresh generation and open its successor, returning the
/// login session both belong to.
///
/// A repeated token cannot be used by two concurrent refreshes or after the first
/// successful rotation. `Ok(None)` means the token was not usable -- already
/// rotated, expired, or belonging to a login that has since been revoked.
pub async fn rotate(
    pool: &PgPool,
    wallet_address: &str,
    previous_token: &str,
    previous_jti: &str,
    replacement_token: &str,
    replacement_jti: &str,
    replacement_expires_at: DateTime<Utc>,
) -> Result<Option<Uuid>, sqlx::Error> {
    let (Ok(previous_jti), Ok(replacement_jti)) = (
        Uuid::parse_str(previous_jti),
        Uuid::parse_str(replacement_jti),
    ) else {
        return Ok(None);
    };
    let mut transaction = pool.begin().await?;

    // Take the parent lock FIRST, and only then touch the generation. Reading
    // the parent's state in the same statement that retires the generation is
    // not enough: a concurrent logout could revoke the parent between that read
    // and the successor INSERT, leaving a live generation under a dead login.
    // `FOR UPDATE OF s` makes the parent row the serialization point, so logout
    // and rotation cannot interleave.
    //
    // Every path in this module locks parent -> generation, never the reverse.
    // Mixing the order would reintroduce the race as a deadlock instead.
    let parent: Option<(Uuid, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT s.id, s.revoked_at
         FROM auth_login_sessions AS s
         JOIN auth_sessions AS g ON g.login_session_id = s.id
         WHERE g.wallet_address = $1
           AND g.refresh_token_hash = $2
           AND g.refresh_jti = $3
         FOR UPDATE OF s",
    )
    .bind(wallet_address)
    .bind(token_hash(previous_token))
    .bind(previous_jti)
    .fetch_optional(&mut *transaction)
    .await?;

    // No such generation, or its login has already ended. A refresh token that
    // is still cryptographically intact must not reopen a session someone
    // deliberately closed.
    let Some((login_session_id, revoked_at)) = parent else {
        transaction.rollback().await?;
        return Ok(None);
    };
    if revoked_at.is_some() {
        transaction.rollback().await?;
        return Ok(None);
    }

    // With the parent held, retiring the generation decides the concurrent-reuse
    // race: exactly one caller can match a row that is still active.
    let retired = sqlx::query(
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
    if retired.rows_affected() != 1 {
        transaction.rollback().await?;
        return Ok(None);
    }

    sqlx::query(
        "INSERT INTO auth_sessions
             (id, wallet_address, refresh_token_hash, refresh_jti, expires_at, login_session_id)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(wallet_address)
    .bind(token_hash(replacement_token))
    .bind(replacement_jti)
    .bind(replacement_expires_at)
    .bind(login_session_id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("UPDATE auth_login_sessions SET last_authenticated_at = NOW() WHERE id = $1")
        .bind(login_session_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(Some(login_session_id))
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
