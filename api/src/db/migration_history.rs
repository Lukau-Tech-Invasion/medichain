//! Adoption of the schema baseline by a database that applied the full history.
//!
//! On 2026-10-19 the 143 historical migrations were replaced by one baseline
//! (`migrations/20261019000000_baseline.sql`), generated from a database built
//! by all of them and checked object by object against it. A new database runs
//! only the baseline. A database that already applied the history holds exactly
//! what the baseline produces, but its `_sqlx_migrations` table names 143
//! versions this binary no longer ships, and SQLx refuses to start on that.
//!
//! So such a database has its migration table rewritten to the single baseline
//! row -- but only when it applied the *complete* history, because only then
//! does it hold the baseline's schema. A database part-way through the history
//! is left untouched and SQLx stops on it: upgrade it with a build from before
//! the baseline first, then with this one.
use sqlx::migrate::Migrator;
use sqlx::PgConnection;

/// The baseline migration's version.
pub const BASELINE_VERSION: i64 = 20261019000000;
/// The last migration of the history the baseline replaces.
pub const LAST_HISTORICAL_VERSION: i64 = 20261018000001;
/// How many migrations that history had.
pub const HISTORICAL_COUNT: i64 = 143;

/// Constraints whose names the baseline spells differently from the history.
/// Renamed so an adopted database matches a new one exactly.
const CONSTRAINT_RENAMES: [(&str, &str, &str); 5] = [
    (
        "audit_seal_batch_members",
        "audit_anchor_batch_members_leaf_hash_check",
        "audit_seal_batch_members_leaf_hash_check",
    ),
    (
        "audit_seal_batch_members",
        "audit_anchor_batch_members_leaf_index_check",
        "audit_seal_batch_members_leaf_index_check",
    ),
    (
        "audit_seal_batches",
        "audit_anchor_batches_leaf_count_check",
        "audit_seal_batches_leaf_count_check",
    ),
    (
        "audit_seal_batches",
        "audit_anchor_batches_merkle_root_check",
        "audit_seal_batches_merkle_root_check",
    ),
    (
        "audit_seal_batch_members",
        "audit_anchor_batch_members_batch_id_fkey",
        "audit_seal_batch_members_batch_id_fkey",
    ),
];

/// What the migration table says about this database.
#[derive(Debug, PartialEq, Eq)]
pub enum History {
    /// No migration table: a new database.
    Fresh,
    /// Already on the baseline.
    Baseline,
    /// Applied the complete history: adopt the baseline.
    Complete,
    /// Part-way through the history, or something else: leave it to SQLx.
    Other,
}

/// Classify the database by its migration table.
pub async fn history(conn: &mut PgConnection) -> Result<History, sqlx::Error> {
    let table: Option<String> = sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations')::text")
        .fetch_one(&mut *conn)
        .await?;
    if table.is_none() {
        return Ok(History::Fresh);
    }
    let (on_baseline, applied, last): (bool, i64, Option<i64>) = sqlx::query_as(
        "SELECT bool_or(version = $1), count(*) FILTER (WHERE success AND version <= $2), \
                max(version) FILTER (WHERE version <= $2) \
         FROM _sqlx_migrations",
    )
    .bind(BASELINE_VERSION)
    .bind(LAST_HISTORICAL_VERSION)
    .fetch_one(&mut *conn)
    .await
    .map(|(b, c, m): (Option<bool>, i64, Option<i64>)| (b.unwrap_or(false), c, m))?;
    Ok(classify(on_baseline, applied, last))
}

/// The decision, separated from the query so it can be tested without a database.
pub fn classify(
    on_baseline: bool,
    applied_historical: i64,
    last_historical: Option<i64>,
) -> History {
    if on_baseline {
        History::Baseline
    } else if applied_historical == HISTORICAL_COUNT
        && last_historical == Some(LAST_HISTORICAL_VERSION)
    {
        History::Complete
    } else if applied_historical == 0 {
        History::Fresh
    } else {
        History::Other
    }
}

/// Replace a complete history with the baseline row. Returns whether it did.
pub async fn adopt_baseline(
    conn: &mut PgConnection,
    migrator: &Migrator,
) -> Result<bool, sqlx::Error> {
    if history(&mut *conn).await? != History::Complete {
        return Ok(false);
    }
    let baseline = migrator
        .iter()
        .find(|m| m.version == BASELINE_VERSION)
        .ok_or_else(|| sqlx::Error::Protocol("the baseline migration is not shipped".into()))?;
    let mut tx = sqlx::Connection::begin(&mut *conn).await?;
    for (table, old, new) in CONSTRAINT_RENAMES {
        let present: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid \
             WHERE t.relname = $1 AND c.conname = $2 AND t.relnamespace = current_schema()::regnamespace)",
        )
        .bind(table)
        .bind(old)
        .fetch_one(&mut *tx)
        .await?;
        if present {
            // Identifiers cannot be bound; these are the fixed names above.
            sqlx::query(&format!(
                "ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new}"
            ))
            .execute(&mut *tx)
            .await?;
        }
    }
    sqlx::query("DELETE FROM _sqlx_migrations")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
         VALUES ($1, $2, true, $3, 0)",
    )
    .bind(BASELINE_VERSION)
    .bind(baseline.description.as_ref())
    .bind(baseline.checksum.to_vec())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_baseline_is_shipped_and_is_the_first_migration() {
        let migrator = sqlx::migrate!("./migrations");
        let first = migrator.iter().next().expect("a migration is shipped");
        assert_eq!(first.version, BASELINE_VERSION);
        assert!(migrator.iter().all(|m| m.version >= BASELINE_VERSION));
    }

    /// Run the startup migration against a named database that applied the full
    /// history, and require it to end on the baseline with nothing left to run.
    /// Opt-in: `MEDICHAIN_ADOPTION_TEST_URL=postgres://... cargo test ... -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn a_complete_history_database_adopts_the_baseline() {
        let Ok(url) = std::env::var("MEDICHAIN_ADOPTION_TEST_URL") else {
            return;
        };
        let pool = sqlx::PgPool::connect(&url).await.expect("connect");
        crate::db::run_migrations(&pool)
            .await
            .expect("startup migration");
        let mut conn = pool.acquire().await.expect("acquire");
        assert_eq!(
            history(&mut conn).await.expect("history"),
            History::Baseline
        );
        let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations")
            .fetch_one(&mut *conn)
            .await
            .expect("count");
        assert_eq!(rows, 1);
    }

    #[test]
    fn only_a_complete_history_is_adopted() {
        assert_eq!(classify(true, 0, None), History::Baseline);
        assert_eq!(
            classify(false, HISTORICAL_COUNT, Some(LAST_HISTORICAL_VERSION)),
            History::Complete
        );
        assert_eq!(classify(false, 0, None), History::Fresh);
        // Part-way through the history: never adopted.
        assert_eq!(
            classify(false, HISTORICAL_COUNT - 1, Some(LAST_HISTORICAL_VERSION)),
            History::Other
        );
        assert_eq!(classify(false, 120, Some(20260930000001)), History::Other);
    }
}
