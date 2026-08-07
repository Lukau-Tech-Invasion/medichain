//! Database connection pool and utilities for MediChain API
//!
//! Provides PostgreSQL connection pooling using SQLx with optimized settings
//! for a healthcare application.

use sqlx::{postgres::PgPoolOptions, Error, PgPool};
use std::time::Duration;
use tokio::time::sleep;

/// Creates a PostgreSQL connection pool with optimized settings
///
/// # Configuration (via environment variables)
/// - `DB_MAX_CONNECTIONS`: Maximum pool size (default: 20)
/// - `DB_MIN_CONNECTIONS`: Minimum idle connections (default: 5)
/// - `DB_ACQUIRE_TIMEOUT_SECS`: Connection acquire timeout (default: 3)
/// - `DB_IDLE_TIMEOUT_SECS`: Idle connection timeout (default: 600)
/// - `DB_MAX_LIFETIME_SECS`: Maximum connection lifetime (default: 1800)
pub async fn create_pool(database_url: &str) -> Result<PgPool, Error> {
    let max_connections = std::env::var("DB_MAX_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20);

    let min_connections = std::env::var("DB_MIN_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);

    let acquire_timeout = std::env::var("DB_ACQUIRE_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3);

    let idle_timeout = std::env::var("DB_IDLE_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(600);

    let max_lifetime = std::env::var("DB_MAX_LIFETIME_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1800);

    log::info!(
        "Creating database pool: max={}, min={}, acquire_timeout={}s",
        max_connections,
        min_connections,
        acquire_timeout
    );

    PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(min_connections)
        .acquire_timeout(Duration::from_secs(acquire_timeout))
        .idle_timeout(Some(Duration::from_secs(idle_timeout)))
        .max_lifetime(Some(Duration::from_secs(max_lifetime)))
        .test_before_acquire(true)
        .connect(database_url)
        .await
}

/// Default connection attempts. See `DEFAULT_MAX_RETRIES` rationale below.
const DEFAULT_MAX_RETRIES: u32 = 12;

/// Creates a PostgreSQL connection pool with retry logic
///
/// Useful when starting with Docker Compose where the database container
/// might not be ready immediately. Uses exponential backoff.
///
/// # Why the default is 12 and not 5
///
/// The old default of 5 gave a total budget of roughly 30 seconds (1+2+4+8s of
/// backoff plus five 3s acquire timeouts). That is comfortably enough for a
/// *warm* container and comfortably short of the case this function was written
/// for.
///
/// A PostgreSQL container recovering after an unclean shutdown replays WAL and
/// fsyncs its data directory before accepting any connection at all; on this
/// project's own dev volume that was measured at **over 100 seconds**, logging
/// `FATAL: the database system is starting up` to every attempt in the meantime.
/// The API gave up at ~30s and — in demo mode — fell back to empty in-memory
/// storage while still reporting healthy, so every login failed with
/// "Wallet not registered" on a stack that looked entirely green.
///
/// `depends_on: condition: service_healthy` does not save you here: Compose
/// applies it to `compose up`, not to containers the daemon restarts under a
/// `restart:` policy, which is exactly the machine-reboot case.
///
/// 12 attempts with the 10s backoff cap gives ~2 minutes, which covers an
/// observed recovery with margin. Override with `DB_MAX_RETRIES` when a
/// deployment needs to fail faster.
///
/// # Arguments
/// * `database_url` - PostgreSQL connection URL
/// * `max_retries` - Maximum number of connection attempts (default: 12)
/// * `initial_delay_ms` - Initial delay between retries in milliseconds (default: 1000)
pub async fn create_pool_with_retry(
    database_url: &str,
    max_retries: Option<u32>,
    initial_delay_ms: Option<u64>,
) -> Result<PgPool, String> {
    let max_retries = max_retries.unwrap_or(DEFAULT_MAX_RETRIES);
    let initial_delay = initial_delay_ms.unwrap_or(1000);

    let mut attempt = 0;
    let mut delay = initial_delay;

    loop {
        attempt += 1;

        match create_pool(database_url).await {
            Ok(pool) => {
                if attempt > 1 {
                    log::info!("Database connection established after {} attempts", attempt);
                }
                return Ok(pool);
            }
            Err(e) => {
                if attempt >= max_retries {
                    return Err(format!(
                        "Failed to connect to database after {} attempts: {}",
                        attempt, e
                    ));
                }

                log::warn!(
                    "Database connection attempt {} failed: {}. Retrying in {}ms...",
                    attempt,
                    e,
                    delay
                );

                sleep(Duration::from_millis(delay)).await;

                // Exponential backoff with max delay of 10 seconds
                delay = (delay * 2).min(10000);
            }
        }
    }
}

/// Health check for database connection
pub async fn check_health(pool: &PgPool) -> bool {
    sqlx::query("SELECT 1").execute(pool).await.is_ok()
}

/// Run database migrations
pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    log::info!("Running database migrations...");
    sqlx::migrate!("./migrations").run(pool).await?;
    log::info!("Database migrations completed successfully");
    Ok(())
}

/// How many migrations this binary ships, and how many the database has applied.
///
/// sqlx aborts the ENTIRE migration chain if one already-applied migration's
/// checksum has changed, so a single edited file can leave the schema many
/// migrations behind while the process still starts. Reporting both numbers
/// turns "Migration warning: ..." into a statement of how stale the schema
/// actually is — the difference between a log line and an actionable one.
pub fn available_migration_count() -> Option<usize> {
    Some(sqlx::migrate!("./migrations").migrations.len())
}

/// Count of successfully applied migrations, or `None` if it cannot be read
/// (e.g. the migrations table does not exist yet on a fresh database).
pub async fn applied_migration_count(pool: &PgPool) -> Option<usize> {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM _sqlx_migrations WHERE success")
        .fetch_one(pool)
        .await
        .ok()
        .map(|n| n as usize)
}

/// Check if database is empty (no users exist)
pub async fn is_database_empty(pool: &PgPool) -> Result<bool, Error> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    Ok(count.0 == 0)
}

/// Database statistics for monitoring
#[derive(Debug, serde::Serialize)]
pub struct DbStats {
    pub pool_size: u32,
    pub idle_connections: u32,
    pub active_connections: u32,
}

/// Get current database pool statistics
pub fn get_pool_stats(pool: &PgPool) -> DbStats {
    DbStats {
        pool_size: pool.size(),
        idle_connections: pool.num_idle() as u32,
        active_connections: pool.size() - pool.num_idle() as u32,
    }
}
