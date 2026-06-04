//! MediChain REST API Server
//!
//! This API server provides emergency medical records access for first responders
//! and healthcare providers. It simulates NFC tap interactions and provides
//! endpoints for patient registration, emergency access, and consent management.
//!
//! **RBAC Enforcement:**
//! - Only healthcare providers (Doctor, Nurse, LabTechnician, Pharmacist) can register patients
//! - Only Doctor and Nurse can edit medical records
//! - Patients can only read their own records
//! - Admin can assign/revoke roles
//!
//! **PostgreSQL Integration:**
//! - If DATABASE_URL is set, persistent storage with demo users
//! - Falls back to in-memory storage if no database configured
//!
//! © 2025 Trustware. All rights reserved.

use actix_cors::Cors;
use actix_web::{web, App, HttpServer};

use crate::middleware::idempotency::IdempotencyMiddleware;
use crate::middleware::metrics::MetricsMiddleware;
use crate::middleware::versioning::ApiVersionMiddleware;
use crate::middleware::rate_limit::RateLimitMiddleware;
use crate::middleware::security_headers::SecurityHeadersMiddleware;
use crate::middleware::signature_auth::SignatureAuthMiddleware;

// Database modules (PostgreSQL integration)
mod db;
mod models;
mod repositories;
mod services;

mod blockchain;
mod clinical;
mod clinical_endpoints;
mod ipfs;
mod middleware;
mod national_id;
mod nfc_simulator;
mod notifications;
mod pagination;
mod pdf;
mod security;
mod telehealth;
mod websocket;

// API layer modules (split out of the original 10K-line main.rs — Phase 10.2).
mod handlers;
mod routes;
mod startup;
mod state;
mod support;
mod types;

#[cfg(test)]
mod api_tests;

#[cfg(test)]
mod property_tests;

// Re-export the moved items at the crate root so that existing `crate::<item>`
// paths (clinical_endpoints, api_tests, route registration) keep resolving.
#[cfg(test)]
pub(crate) use handlers::*;
pub(crate) use startup::*;
pub(crate) use state::*;
pub(crate) use support::*;
pub(crate) use types::*;

/// Initialize logging (Phase 8.2).
///
/// `LOG_FORMAT=json` installs a `tracing` JSON subscriber and bridges existing
/// `log::` records into it (structured logs for aggregation). Otherwise the
/// human-readable `env_logger` is used. Both honor `RUST_LOG`.
fn init_logging() {
    let json = std::env::var("LOG_FORMAT").map(|v| v == "json").unwrap_or(false);
    if json {
        use tracing_subscriber::{fmt, EnvFilter};
        // Route `log::` macros (used throughout the codebase) into `tracing`.
        let _ = tracing_log::LogTracer::init();
        let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
        let subscriber = fmt().json().with_env_filter(filter).finish();
        let _ = tracing::subscriber::set_global_default(subscriber);
    } else {
        env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize logging (Phase 8.2). LOG_FORMAT=json emits structured JSON logs
    // via `tracing` (with a `log` bridge so existing `log::` calls are captured);
    // otherwise the human-readable `env_logger` is used.
    init_logging();

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let bind_addr = format!("{}:{}", host, port);

    print_startup_banner(&bind_addr);
    // =========================================================================
    // PostgreSQL Database Initialization (for persistent demo users)
    // =========================================================================

    // Load environment variables from .env file if present
    let _ = dotenvy::dotenv();

    // Fail fast if a production deployment is configured with demo/default
    // secrets; warn (but continue) in demo mode. (Phase 6.1)
    if let Err(msg) = validate_production_secrets() {
        eprintln!("\n❌ STARTUP ABORTED: {}\n", msg);
        return Err(std::io::Error::new(std::io::ErrorKind::Other, msg));
    }

    // Try to connect to PostgreSQL if DATABASE_URL is set
    let db_pool = match std::env::var("DATABASE_URL") {
        Ok(database_url) => {
            println!("  🗄️  Connecting to PostgreSQL database...");

            // Use retry logic for Docker Compose scenarios where DB might not be ready
            let max_retries = std::env::var("DB_MAX_RETRIES")
                .ok()
                .and_then(|v| v.parse().ok());

            match db::create_pool_with_retry(&database_url, max_retries, None).await {
                Ok(pool) => {
                    println!("  ✅ Database connection established");

                    // Run migrations
                    println!("  📋 Running database migrations...");
                    if let Err(e) = db::run_migrations(&pool).await {
                        eprintln!("  ⚠️  Migration warning: {}", e);
                        eprintln!("       (Demo users may need manual setup)");
                    } else {
                        println!("  ✅ Migrations completed");
                    }

                    Some(pool)
                }
                Err(e) => {
                    eprintln!("  ⚠️  Database connection failed: {}", e);
                    eprintln!("       Falling back to in-memory storage");
                    eprintln!("       (Demo users will be lost on restart)");
                    None
                }
            }
        }
        Err(_) => {
            println!("  ℹ️  No DATABASE_URL set - using in-memory storage");
            println!("       Set DATABASE_URL for persistent demo users");
            None
        }
    };

    // Initialize Substrate blockchain client if SUBSTRATE_WS_URL is set
    let substrate_client = match crate::blockchain::SubstrateClient::from_env() {
        Some(ws_url) => {
            println!("  ⛓️  Connecting to Substrate node at {}...", ws_url);
            match crate::blockchain::SubstrateClient::new(&ws_url).await {
                Ok(client) => {
                    let connected = client.health_check().await;
                    if connected {
                        println!("  ✅ Blockchain node connected");
                    } else {
                        println!("  ⚠️  Blockchain node not reachable - will retry on requests");
                    }
                    Some(std::sync::Arc::new(client))
                }
                Err(e) => {
                    eprintln!("  ⚠️  Blockchain client init failed: {}", e);
                    None
                }
            }
        }
        None => {
            println!("  ℹ️  No SUBSTRATE_WS_URL set - blockchain features disabled");
            None
        }
    };

    // Create shared state with optional database pool (using async version for PostgreSQL support)
    let app_state = web::Data::new(AppState::new_with_pool_async(db_pool, substrate_client).await);

    // Load demo users from database into in-memory cache
    if app_state.db_pool.is_some() {
        println!("  👥 Loading demo users from database...");
        match app_state.load_demo_users_from_db().await {
            Ok(count) => {
                println!("  ✅ Loaded {} demo users", count);
            }
            Err(e) => {
                eprintln!("  ⚠️  Failed to load demo users: {}", e);
            }
        }

        // Load demo patients from database into in-memory cache
        println!("  🏥 Loading demo patients from database...");
        match app_state.load_patients_from_db().await {
            Ok(count) => {
                println!("  ✅ Loaded {} demo patients", count);
            }
            Err(e) => {
                eprintln!("  ⚠️  Failed to load demo patients: {}", e);
            }
        }

        // Load persisted MFA enrollments + recent security alerts (Phase 11.3/11.4)
        println!("  🔐 Loading security state (MFA + alerts) from database...");
        match app_state.load_security_from_db().await {
            Ok(count) => println!("  ✅ Loaded {} MFA enrollments", count),
            Err(e) => eprintln!("  ⚠️  Failed to load security state: {}", e),
        }
    }

    // Start medication reminder background task
    {
        let reminder_state = app_state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                crate::clinical_endpoints::check_and_send_medication_reminders(&reminder_state)
                    .await;
            }
        });
        println!("  ⏰ Medication reminder task started (checks every 60s)");
    }

    println!();
    println!("  🚀 Server ready!");
    println!();

    // Start HTTP server
    HttpServer::new(move || {
        // Configure CORS - restrictive for production, permissive for demo
        let is_demo = std::env::var("IS_DEMO").unwrap_or_else(|_| "false".to_string()) == "true";
        let cors = if is_demo {
            // Demo mode: allow any origin for testing
            Cors::default()
                .allow_any_origin()
                .allow_any_method()
                .allow_any_header()
                .max_age(3600)
        } else {
            // Production mode: restrict origins
            let allowed_origins = std::env::var("ALLOWED_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:5173,http://localhost:5174".to_string());

            let mut cors = Cors::default()
                .allowed_methods(vec!["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
                .allowed_headers(vec![
                    actix_web::http::header::AUTHORIZATION,
                    actix_web::http::header::ACCEPT,
                    actix_web::http::header::CONTENT_TYPE,
                    actix_web::http::header::HeaderName::from_static("x-user-id"),
                    actix_web::http::header::HeaderName::from_static("x-request-id"),
                    // SEC-005: Wallet signature authentication headers
                    actix_web::http::header::HeaderName::from_static("x-signature"),
                    actix_web::http::header::HeaderName::from_static("x-timestamp"),
                ])
                .max_age(3600);

            for origin in allowed_origins.split(',') {
                cors = cors.allowed_origin(origin.trim());
            }
            cors
        };

        // Configure rate limiting
        let rate_limit = RateLimitMiddleware::default_config();

        // Configure signature authentication (SEC-005)
        // Default: disabled in demo mode (IS_DEMO=true), enabled otherwise
        // Override: REQUIRE_SIGNATURES=true/false
        let is_demo = std::env::var("IS_DEMO").unwrap_or_else(|_| "true".to_string()) == "true";
        let require_signatures = match std::env::var("REQUIRE_SIGNATURES") {
            Ok(val) => val == "true",
            Err(_) => !is_demo, // Default: on in production, off in demo
        };
        let signature_auth = if require_signatures {
            log::info!("Signature authentication ENABLED - all authenticated requests require wallet signature");
            SignatureAuthMiddleware::enabled()
        } else {
            log::info!("Signature authentication DISABLED - set REQUIRE_SIGNATURES=true to enable");
            SignatureAuthMiddleware::disabled()
        };

        App::new()
            .wrap(cors)
            // Security/HSTS headers on every response (Phase 6.2).
            .wrap(SecurityHeadersMiddleware)
            // Rewrites /api/v1/... → /api/... before routing (Phase 9.1).
            .wrap(ApiVersionMiddleware)
            .wrap(rate_limit)
            .wrap(signature_auth)
            .wrap(MetricsMiddleware)
            // Innermost: captures handler responses for idempotent replay (Phase 9.2).
            .wrap(IdempotencyMiddleware)
            .app_data(app_state.clone())
            .configure(routes::configure)
    })
    .bind(&bind_addr)?
    .run()
    .await
}
