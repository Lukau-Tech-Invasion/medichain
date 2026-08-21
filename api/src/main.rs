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
//! © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.

use actix_cors::Cors;
use actix_web::{web, App, HttpServer};

use crate::middleware::encryption_policy::EncryptionPolicyMiddleware;
use crate::middleware::idempotency::IdempotencyMiddleware;
use crate::middleware::metrics::MetricsMiddleware;
use crate::middleware::rate_limit::RateLimitMiddleware;
use crate::middleware::security_headers::SecurityHeadersMiddleware;
use crate::middleware::signature_auth::SignatureAuthMiddleware;
use crate::middleware::versioning::ApiVersionMiddleware;

// Database modules (PostgreSQL integration)
mod db;
mod encryption_keyring;
mod federation_identity;
mod models;
mod repositories;
mod services;

mod audit_outbox;
mod blockchain;
mod clinical;
mod clinical_endpoints;
mod device_lifecycle;
mod emergency_capsule;
mod emergency_grants;
mod ipfs;
mod middleware;
mod mobile_records;
mod national_id;
mod nfc_simulator;
mod notifications;
mod organization_keys;
mod pagination;
mod patient_access;
mod pdf;
mod retention;
mod security;
mod telehealth;
mod telehealth_retention;
mod websocket;

// API layer modules (split out of the original 10K-line main.rs — Phase 10.2).
mod handlers;
mod routes;
mod startup;
pub mod state;
mod support;
mod types;

#[cfg(test)]
mod api_tests;

#[cfg(test)]
mod property_tests;

#[cfg(test)]
mod stepup_matrix_tests;

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
///
/// Built with `--features tokio-console` (and `RUSTFLAGS="--cfg tokio_unstable"`,
/// required for tokio's task-tracking instrumentation), this installs the
/// `tokio-console` subscriber instead so async task state can be inspected live
/// with the `tokio-console` CLI (Phase 12.1) — mutually exclusive with the two
/// paths above, since only one global `tracing` subscriber can be active.
#[cfg(feature = "tokio-console")]
fn init_logging() {
    console_subscriber::init();
}

#[cfg(not(feature = "tokio-console"))]
fn init_logging() {
    let json = std::env::var("LOG_FORMAT")
        .map(|v| v == "json")
        .unwrap_or(false);
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

    // Start the uptime clock before anything else can take time, so the
    // operations dashboard reports how long the process has been up rather than
    // the hardcoded availability figure it used to print.
    crate::middleware::metrics::mark_process_start();

    // Default 8090, NOT 8080: port 8080 is the IPFS (kubo) gateway's port, which
    // docker-compose publishes on the host. When the API bound 8080 it stole that
    // port, and its own `IPFS_GATEWAY_URL` (default `localhost:8080`) then
    // resolved back to the API itself — every encrypted-record download fetched
    // the API, got a 404, and surfaced as a misleading "Record content not found".
    // Inside Docker the API keeps 8080 (its own container namespace; nginx proxies
    // to `api:8080`), set explicitly as `PORT` in docker-compose.yml.
    let port = std::env::var("PORT").unwrap_or_else(|_| "8090".to_string());
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
        eprintln!("\n[ERROR] STARTUP ABORTED: {}\n", msg);
        return Err(std::io::Error::other(msg));
    }

    // Warn (do not block boot) if any national-ID verifier's API key is unset in
    // non-demo mode — that country would silently run on the deterministic stub
    // verifier (Horizon HZ-004).
    warn_missing_national_id_keys();
    warn_if_clinic_offset_unset();

    // Try to connect to PostgreSQL if DATABASE_URL is set
    let db_pool = match std::env::var("DATABASE_URL") {
        Ok(database_url) => {
            println!("  [DB] Connecting to PostgreSQL database...");

            // Use retry logic for Docker Compose scenarios where DB might not be ready
            let max_retries = std::env::var("DB_MAX_RETRIES")
                .ok()
                .and_then(|v| v.parse().ok());

            // Fail-closed outside demo mode. Previously a migration failure was a
            // warning and a connection failure silently fell back to volatile
            // in-memory storage, so the API could report "ready" while running on
            // an incompatible schema — or while every clinical write was destined
            // to vanish on restart. A health application must not advertise
            // readiness in either state. In demo mode the fallback is retained
            // deliberately: that profile is synthetic-data-only by definition.
            let demo = crate::support::is_demo_mode();
            match db::create_pool_with_retry(&database_url, max_retries, None).await {
                Ok(pool) => {
                    println!("  [OK] Database connection established");

                    // Run migrations
                    println!("  [DB] Running database migrations...");
                    if let Err(e) = db::run_migrations(&pool).await {
                        if demo {
                            // Demo mode still starts, but the previous message
                            // ("Migration warning: ...", then a healthy boot)
                            // was indistinguishable from success in a scrolling
                            // log. It hid a database sitting 31 migrations
                            // behind the code — 8 of 39 applied — because sqlx
                            // halts the ENTIRE chain when one already-applied
                            // migration's checksum changes. Endpoints then fail
                            // on missing tables that look like ordinary bugs.
                            let applied = db::applied_migration_count(&pool).await;
                            let on_disk = db::available_migration_count();
                            eprintln!("\n=================================================");
                            eprintln!("  [WARN] DATABASE MIGRATIONS DID NOT APPLY");
                            eprintln!("  {e}");
                            match (applied, on_disk) {
                                (Some(a), Some(d)) if d > a => eprintln!(
                                    "  Schema is STALE: {a} of {d} migrations applied — {} missing.\n  \
                                     Tables added by the missing {} will not exist, and any endpoint \
                                     touching them will fail at runtime.",
                                    d - a, d - a
                                ),
                                _ => eprintln!(
                                    "  Schema state is unknown; assume it does not match the code."
                                ),
                            }
                            eprintln!(
                                "  Starting anyway because IS_DEMO=true. This would ABORT startup \
                                 in any non-demo deployment."
                            );
                            eprintln!("=================================================\n");
                        } else {
                            eprintln!("\n[ERROR] STARTUP ABORTED: database migrations failed: {e}");
                            eprintln!(
                                "        Starting now would serve clinical traffic against an \
                                 unknown schema. Fix the migration, or set IS_DEMO=true for a \
                                 synthetic-data demo."
                            );
                            return Err(std::io::Error::other(format!(
                                "database migrations failed: {e}"
                            )));
                        }
                    } else {
                        println!("  [OK] Migrations completed");
                    }

                    Some(pool)
                }
                Err(e) => {
                    if demo {
                        // Loud on purpose. This branch silently turned a
                        // postgres-configured deployment into an EMPTY in-memory
                        // one while /health still answered "healthy", so the
                        // first symptom was every demo login failing with
                        // "Wallet not registered" on a stack that looked green.
                        // The two-line warning it used to print was lost among
                        // the startup banner and the demo-secret warnings.
                        eprintln!("\n============================================================");
                        eprintln!("  [DEGRADED] DATABASE_URL was set, but the database is");
                        eprintln!("             unreachable: {}", e);
                        eprintln!();
                        eprintln!("  Falling back to EMPTY in-memory storage (demo mode).");
                        eprintln!("  No seeded users, patients or records exist in this mode:");
                        eprintln!("  every login will fail with WALLET_NOT_REGISTERED.");
                        eprintln!();
                        eprintln!("  If the database is merely slow to start (WAL replay after");
                        eprintln!("  an unclean shutdown can exceed two minutes), restart the");
                        eprintln!("  API once it is accepting connections, or raise");
                        eprintln!("  DB_MAX_RETRIES.");
                        eprintln!("============================================================\n");
                        None
                    } else {
                        eprintln!(
                            "\n[ERROR] STARTUP ABORTED: DATABASE_URL is set but the \
                                   database is unreachable: {e}"
                        );
                        eprintln!(
                            "        Refusing to fall back to volatile in-memory storage: \
                             clinical writes would be lost on restart while the API reported \
                             healthy. Fix connectivity, or set IS_DEMO=true for a \
                             synthetic-data demo."
                        );
                        return Err(std::io::Error::other(format!("database unreachable: {e}")));
                    }
                }
            }
        }
        Err(_) => {
            // No DATABASE_URL at all. Outside demo mode this is a configuration
            // error, not a default: it silently selects volatile storage.
            if !crate::support::is_demo_mode() {
                eprintln!(
                    "\n[ERROR] STARTUP ABORTED: no DATABASE_URL set and IS_DEMO is not true."
                );
                eprintln!(
                    "        In-memory storage is a demo-only profile. Set DATABASE_URL for a \
                     persistent deployment, or IS_DEMO=true to run on synthetic data."
                );
                return Err(std::io::Error::other(
                    "no DATABASE_URL set outside demo mode",
                ));
            }
            println!("  [INFO] No DATABASE_URL set - using in-memory storage (demo mode)");
            None
        }
    };

    crate::blockchain::validate_blockchain_configuration(crate::support::is_demo_mode())
        .map_err(std::io::Error::other)?;

    // Initialize Substrate blockchain client if SUBSTRATE_WS_URL is set
    let substrate_client = match crate::blockchain::SubstrateClient::from_env() {
        Some(ws_url) => {
            println!("  [CHAIN] Connecting to Substrate node at {}...", ws_url);
            match crate::blockchain::SubstrateClient::new(&ws_url).await {
                Ok(client) => {
                    let connected = client.health_check().await;
                    if connected && client.is_ready() {
                        println!("  [OK] Blockchain node connected");
                    } else if crate::blockchain::blockchain_enabled() {
                        return Err(std::io::Error::other(
                            "blockchain is enabled but the node/subxt client is not ready",
                        ));
                    } else {
                        println!("  [WARN] Blockchain node not reachable - will retry on requests");
                    }
                    Some(std::sync::Arc::new(client))
                }
                Err(e) => {
                    if crate::blockchain::blockchain_enabled() {
                        return Err(std::io::Error::other(format!(
                            "blockchain client initialization failed: {e}"
                        )));
                    }
                    eprintln!("  [WARN] Blockchain client init failed: {}", e);
                    None
                }
            }
        }
        None => {
            println!("  [INFO] No SUBSTRATE_WS_URL set - blockchain features disabled");
            None
        }
    };

    // Create shared state with optional database pool (using async version for PostgreSQL support)
    let state = AppState::new_with_pool_async(db_pool, substrate_client).await;
    if !crate::support::is_demo_mode()
        && state.repositories.backend != crate::repositories::StorageBackend::Postgres
    {
        return Err(std::io::Error::other(
            "persistent PostgreSQL repositories failed to initialize",
        ));
    }
    let app_state = web::Data::new(state);

    // The federation boundary is the deployment, not a column (ADR-0007), so a
    // second organisation in this database would silently widen every
    // deployment-wide read into a cross-organisation disclosure.
    if let Some(pool) = app_state.db_pool.as_ref() {
        startup::validate_single_organisation(pool)
            .await
            .map_err(std::io::Error::other)?;
        // A published development key holding an Admin role is an open door,
        // and nothing else checks for it — `blockchain.rs` guards only the
        // chain signer.
        startup::validate_no_privileged_dev_accounts(pool, crate::support::is_demo_mode())
            .await
            .map_err(std::io::Error::other)?;
    }

    // Load demo users from database into in-memory cache
    if app_state.db_pool.is_some() {
        println!("  [INFO] Loading demo users from database...");
        match app_state.load_demo_users_from_db().await {
            Ok(count) => {
                println!("  [OK] Loaded {} demo users", count);
            }
            Err(e) if !crate::support::is_demo_mode() => {
                return Err(std::io::Error::other(format!(
                    "failed to initialize authorization users: {e}"
                )));
            }
            Err(e) => eprintln!("  [WARN] Failed to load demo users: {}", e),
        }

        // Load demo patients from database into in-memory cache
        println!("  [INFO] Loading demo patients from database...");
        match app_state.load_patients_from_db().await {
            Ok(count) => {
                println!("  [OK] Loaded {} demo patients", count);
            }
            Err(e) if !crate::support::is_demo_mode() => {
                return Err(std::io::Error::other(format!(
                    "failed to initialize patient cache: {e}"
                )));
            }
            Err(e) => eprintln!("  [WARN] Failed to load demo patients: {}", e),
        }

        // Load persisted MFA enrollments + recent security alerts (Phase 11.3/11.4)
        println!("  [INFO] Loading security state (MFA + alerts) from database...");
        match app_state.load_security_from_db().await {
            Ok(count) => println!("  [OK] Loaded {} MFA enrollments", count),
            Err(e) if !crate::support::is_demo_mode() => {
                return Err(std::io::Error::other(format!(
                    "failed to initialize MFA security state: {e}"
                )));
            }
            Err(e) => eprintln!("  [WARN] Failed to load security state: {}", e),
        }
    }

    if let (Some(pool), Some(client)) = (
        app_state.db_pool.clone(),
        app_state.substrate_client.clone(),
    ) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                match crate::audit_outbox::deliver_pending_chain_events(&pool, &client).await {
                    Ok(count) if count > 0 => {
                        log::info!("Delivered {} pending blockchain operation(s)", count)
                    }
                    Ok(_) => {}
                    Err(error) => log::error!("Blockchain outbox delivery failed: {}", error),
                }
            }
        });
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
        println!("  [INFO] Medication reminder task started (checks every 60s)");
    }

    // Start appointment reminder background task (Phase 5.2 FCM)
    {
        let reminder_state = app_state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(300));
            loop {
                interval.tick().await;
                crate::clinical_endpoints::check_and_send_appointment_reminders(&reminder_state)
                    .await;
            }
        });
        println!("  [INFO] Appointment reminder task started (checks every 5m)");
    }

    // Start data-retention assessment task.
    //
    // REPORT-ONLY: this evaluates retention policies and records what *would*
    // be eligible for disposal. It does not delete, archive, or modify any
    // record — see `crate::retention` for why the deletion half is deliberately
    // absent. Retention boundaries move a day at a time, so it runs daily.
    {
        let retention_state = app_state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
                crate::retention::job::RETENTION_ASSESSMENT_INTERVAL_SECS,
            ));
            loop {
                interval.tick().await;
                let assessment = crate::retention::run_retention_assessment(&retention_state).await;
                if assessment.total_due > 0 || assessment.total_held > 0 {
                    log::info!(
                        "retention assessment {}: {} due, {} held, 0 deleted (report-only)",
                        assessment.assessed_on,
                        assessment.total_due,
                        assessment.total_held
                    );
                }
            }
        });
        println!("  [INFO] Retention assessment task started (daily, report-only — never deletes)");
    }

    println!();
    println!("  [OK] Server ready!");
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
        // SECURE BY DEFAULT: verification is ENABLED unless the operator explicitly
        // opts out via IS_DEMO=true or REQUIRE_SIGNATURES=false. IS_DEMO defaults to
        // "false" here (matches the CORS block above) so a misconfigured/forgotten
        // env never silently trusts the unauthenticated X-User-Id header.
        // Precedence: REQUIRE_SIGNATURES (when set) overrides the IS_DEMO-derived default.
        let is_demo = std::env::var("IS_DEMO").unwrap_or_else(|_| "false".to_string()) == "true";
        let require_signatures = match std::env::var("REQUIRE_SIGNATURES") {
            Ok(val) => val == "true",
            Err(_) => !is_demo, // Default: on in production, off only when IS_DEMO=true
        };
        let signature_auth = if require_signatures {
            log::info!("Signature authentication ENABLED - all authenticated requests require a wallet signature");
            SignatureAuthMiddleware::enabled()
        } else {
            log::warn!(
                "Signature verification DISABLED — X-User-Id is NOT cryptographically verified. \
                 Do NOT use in production. (Set IS_DEMO=false and unset REQUIRE_SIGNATURES to enable.)"
            );
            SignatureAuthMiddleware::disabled()
        };

        // Configure encryption policy
        let encryption_policy = if !is_demo {
            EncryptionPolicyMiddleware::enabled()
        } else {
            EncryptionPolicyMiddleware::new(false)
        };

        App::new()
            .wrap(cors)
            // Security/HSTS headers on every response (Phase 6.2).
            .wrap(SecurityHeadersMiddleware)
            // Rewrites /api/v1/... → /api/... before routing (Phase 9.1).
            .wrap(ApiVersionMiddleware)
            .wrap(rate_limit)
            .wrap(signature_auth)
            .wrap(encryption_policy)
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
