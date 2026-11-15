//! The key a person is known by in actor columns (ADR-0010).
//!
//! `users.id` is the only identifier of a user, and every actor column holds its
//! text form (`users.id_text`). Migration `20261006000002` removed the mapping
//! from pre-credential keys, so a key that is not a current user id names nobody.

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

/// The user an actor key belongs to, if any.
#[cfg_attr(not(test), allow(dead_code))] // no production caller resolves one key yet
pub async fn resolve(pool: &PgPool, key: &str) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM users WHERE id_text = $1")
        .bind(key)
        .fetch_optional(pool)
        .await
}

/// Every key a user's rows may carry: exactly the user's id. Queries over
/// history use these with `= ANY($n)` (`AccessLogRepository::get_by_accessor`
/// takes exactly this list). A string that is not a user id is its own only key.
#[cfg_attr(not(test), allow(dead_code))] // no screen lists one clinician's own reads yet
pub async fn actor_keys_for(pool: &PgPool, user_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let Some(user_uuid) = parse_user_id(user_id) else {
        return Ok(vec![user_id.to_string()]);
    };
    let known: Option<String> = sqlx::query_scalar("SELECT id_text FROM users WHERE id = $1")
        .bind(user_uuid)
        .fetch_optional(pool)
        .await?;
    Ok(vec![known.unwrap_or_else(|| user_uuid.to_string())])
}

/// The user id behind each of `keys` that names an account. Keys that name no
/// account are absent from the result.
pub async fn user_ids_for_keys(
    pool: &PgPool,
    keys: &[String],
) -> Result<std::collections::HashMap<String, String>, sqlx::Error> {
    let rows: Vec<(String, Uuid)> =
        sqlx::query_as("SELECT id_text, id FROM users WHERE id_text = ANY($1)")
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
