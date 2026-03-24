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

/// Creates a PostgreSQL connection pool with retry logic
///
/// Useful when starting with Docker Compose where the database container
/// might not be ready immediately. Uses exponential backoff.
///
/// # Arguments
/// * `database_url` - PostgreSQL connection URL
/// * `max_retries` - Maximum number of connection attempts (default: 5)
/// * `initial_delay_ms` - Initial delay between retries in milliseconds (default: 1000)
pub async fn create_pool_with_retry(
    database_url: &str,
    max_retries: Option<u32>,
    initial_delay_ms: Option<u64>,
) -> Result<PgPool, String> {
    let max_retries = max_retries.unwrap_or(5);
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
