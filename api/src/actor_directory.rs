//! Every key a person is known by, current or historical (ADR-0010, phase B).
//!
//! `users.id` is the only identifier of a user, and every actor column written
//! since migration `20260930000001` holds it. Rows written before that hold the
//! user's old key, and some of them are sealed or hashed (access-log rows, audit
//! leaves, capsule commitments) and so were never rewritten. The
//! `legacy_wallet_identities` table maps each old key to its user and the
//! `actor_directory` view unions it with the current ids; this module is the only
//! reader of them, so a caller asking "everything this person did" or "who was
//! `5Grw…`" gets one answer.

use sqlx::PgPool;
use uuid::Uuid;

/// The inactive account the identity migration creates only when historical rows
/// were written by `SYSTEM` / `DEMO_SYSTEM`. It can never sign in.
pub const SYSTEM_USER_ID: Uuid = Uuid::from_u128(1);

/// A user id as the database wants it. `None` for anything that is not a UUID,
/// which is how a legacy key or a fixture string is told apart from a current one.
pub fn parse_user_id(id: &str) -> Option<Uuid> {
    Uuid::parse_str(id).ok()
}

/// The user a key (current id or legacy key) belongs to, if any.
#[cfg_attr(not(test), allow(dead_code))] // retained for historical-key lookups
pub async fn resolve(pool: &PgPool, key: &str) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("SELECT user_id FROM actor_directory WHERE actor_key = $1")
        .bind(key)
        .fetch_optional(pool)
        .await
}

/// Every key a user's rows may carry: the current id first, then each legacy
/// key. Queries over sealed history use these with `= ANY($n)`
/// (`AccessLogRepository::get_by_accessor` takes exactly this list).
#[cfg_attr(not(test), allow(dead_code))] // no screen lists one clinician's own reads yet
pub async fn actor_keys_for(pool: &PgPool, user_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let Some(user_uuid) = parse_user_id(user_id) else {
        return Ok(vec![user_id.to_string()]);
    };
    let legacy: Vec<String> = sqlx::query_scalar(
        "SELECT actor_key FROM actor_directory WHERE user_id = $1 AND legacy ORDER BY actor_key",
    )
    .bind(user_uuid)
    .fetch_all(pool)
    .await?;
    let mut keys = Vec::with_capacity(legacy.len() + 1);
    keys.push(user_uuid.to_string());
    keys.extend(legacy);
    Ok(keys)
}

/// The user id behind each of `keys` that the directory knows (current ids and
/// legacy keys alike). Keys it does not know are absent from the result.
pub async fn user_ids_for_keys(
    pool: &PgPool,
    keys: &[String],
) -> Result<std::collections::HashMap<String, String>, sqlx::Error> {
    let rows: Vec<(String, Uuid)> =
        sqlx::query_as("SELECT actor_key, user_id FROM actor_directory WHERE actor_key = ANY($1)")
            .bind(keys)
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(key, user_id)| (key, user_id.to_string()))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_uuid_is_a_user_id() {
        assert!(parse_user_id("2f2fcb92-96d9-4c87-ad01-aa5f1488da52").is_some());
        assert!(parse_user_id("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY").is_none());
        assert!(parse_user_id("doctor_rx").is_none());
    }

    #[test]
    fn the_system_user_is_the_fixed_migration_row() {
        assert_eq!(
            SYSTEM_USER_ID.to_string(),
            "00000000-0000-0000-0000-000000000001"
        );
    }
}
