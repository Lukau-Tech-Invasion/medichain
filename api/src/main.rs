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
//! © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.

use actix_cors::Cors;
use actix_web::{web, App, HttpServer};

use crate::middleware::encryption_policy::EncryptionPolicyMiddleware;
use crate::middleware::idempotency::IdempotencyMiddleware;
use crate::middleware::metrics::MetricsMiddleware;
use crate::middleware::rate_limit::RateLimitMiddleware;
use crate::middleware::security_headers::SecurityHeadersMiddleware;
use crate::middleware::session_state::SessionStateMiddleware;
use crate::middleware::versioning::ApiVersionMiddleware;

// Database modules (PostgreSQL integration)
mod db;
mod encryption_keyring;
mod federation_identity;
mod models;
mod repositories;
mod services;

mod actor_directory;
mod attachment_scan;
mod audit_batching;
mod audit_merkle;
mod audit_outbox;
mod audit_seal;
mod auth_sessions;
mod blood_inventory;
mod care_access;
mod clinical;
mod clinical_endpoints;
mod clinical_scoring;
mod credentials;
mod deferred_emergency_audit;
mod device_lifecycle;
mod dispensing_policy;
mod document_intake;
mod emergency_capsule;
mod emergency_grants;
mod governance;
mod ipfs;
mod job_lock;
mod middleware;
mod mobile_records;
mod national_id;
mod nfc_simulator;
mod notifications;
mod organization_keys;
mod pagination;
mod patient_access;
mod patient_name_index;
mod pdf;
mod privacy_logging;
mod refresh_cookie;
mod research_export;
mod retention;
mod security;
mod telehealth;
mod transaction_authorization;
mod websocket;

// API layer modules (split out of the original 10K-line main.rs — Phase 10.2).
mod handlers;
mod routes;
mod startup;
pub mod state;
mod support;
#[cfg(test)]
mod test_fixtures;
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

/// Seconds between runs of the access-audit Merkle batching job (WP8).
const AUDIT_BATCH_INTERVAL_SECS: u64 = 60;

/// Initialize logging (Phase 8.2).
///
/// One pipeline, composed from layers, for every build.
///
/// This used to be two mutually exclusive functions: an `env_logger` builder
/// whose format closure applied `privacy_logging`, and — under
/// `--features tokio-console` — a bare `console_subscriber::init()`. Only one
/// global subscriber can exist, so the console build replaced the redacting one
/// outright and logged account identifiers, bearer tokens and patient
/// identifiers every other build redacts. The control vanished precisely when
/// someone was debugging a live system closely enough to want a task console.
///
/// `console_subscriber` also offers `ConsoleLayer`, so the two compose instead
/// of competing: the registry holds the redacting layer always, and adds the
/// console layer when the feature is on. Console telemetry is preserved and
/// redaction is a property of the pipeline rather than of one configuration.
///
/// The existing `log::` call sites — which is most of the codebase — reach the
/// same pipeline because `tracing-subscriber`'s `init()` installs the
/// `tracing-log` bridge itself. Do NOT also call `LogTracer::init()` here: both
/// set the global `log` logger, and the second one panics the process at
/// startup with `SetLoggerError`. That is not theoretical — it was written that
/// way first, and every build died before binding a port.
///
/// `LOG_FORMAT=json` selects structured output. The console feature still
/// requires `RUSTFLAGS="--cfg tokio_unstable"`.
fn init_logging() {
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;

    let json = std::env::var("LOG_FORMAT")
        .map(|value| value == "json")
        .unwrap_or(false);

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    let registry = tracing_subscriber::registry()
        .with(filter)
        .with(privacy_logging::RedactingLayer::new(std::io::stderr, json));

    #[cfg(feature = "tokio-console")]
    let registry = registry.with(console_subscriber::ConsoleLayer::builder().spawn());

    registry.init();
}

/// Bring up the storage backend the environment names, or say why not.
///
/// Extracted from `main` because startup is four separate decisions -- storage,
/// audit sealing, caches, background jobs -- and reading any one of them meant reading
/// all four. See the register entry on the 60-line rule for the measurement
/// that motivated this.
async fn initialise_storage() -> std::io::Result<Option<sqlx::PgPool>> {
    // Try to connect to PostgreSQL if DATABASE_URL is set
    Ok(match std::env::var("DATABASE_URL") {
        Ok(database_url) => {
            println!("  [DB] Connecting to PostgreSQL database...");

            // Use retry logic for Docker Compose scenarios where DB might not be ready
            let max_retries = std::env::var("DB_MAX_RETRIES")
                .ok()
                .and_then(|v| v.parse().ok());

            match db::create_pool_with_retry(&database_url, max_retries, None).await {
                Ok(pool) => {
                    println!("  [OK] Database connection established");

                    // Run migrations
                    println!("  [DB] Running database migrations...");
                    if let Err(e) = db::run_migrations(&pool).await {
                        log::error!("startup aborted because database migrations failed: {e}");
                        return Err(std::io::Error::other("database migrations failed"));
                    } else {
                        println!("  [OK] Migrations completed");
                    }

                    Some(pool)
                }
                Err(e) => {
                    log::error!("startup aborted because configured database is unreachable: {e}");
                    return Err(std::io::Error::other("database unreachable"));
                }
            }
        }
        Err(_) => {
            // No DATABASE_URL at all. Outside demo mode this is a configuration
            // error, not a default: it silently selects volatile storage.
            if !crate::support::is_demo_mode()
                || crate::repositories::StorageBackend::from_env()
                    == crate::repositories::StorageBackend::Postgres
            {
                eprintln!(
                    "\n[ERROR] STARTUP ABORTED: PostgreSQL is required but DATABASE_URL is unset."
                );
                eprintln!(
                    "        Set DATABASE_URL for persistent storage. In-memory storage is \
                     available only for an explicit demo without PostgreSQL selected."
                );
                return Err(std::io::Error::other(
                    "no DATABASE_URL set outside demo mode",
                ));
            }
            println!("  [INFO] No DATABASE_URL set - using in-memory storage (demo mode)");
            None
        }
    })
}

/// Fill the in-process caches the authorization path reads from.
///
/// A configured PostgreSQL deployment cannot claim readiness with empty auth,
/// patient or security caches, even when its data is synthetic.
async fn hydrate_caches(app_state: &web::Data<AppState>) -> std::io::Result<()> {
    // Load demo users from database into in-memory cache
    if app_state.db_pool.is_some() {
        println!("  [INFO] Loading demo users from database...");
        match app_state.load_demo_users_from_db().await {
            Ok(count) => {
                println!("  [OK] Loaded {} demo users", count);
            }
            Err(e) => {
                return Err(std::io::Error::other(format!(
                    "failed to initialize authorization users: {e}"
                )));
            }
        }

        // Refill the health ID card registry.
        //
        // Not fatal outside demo mode the way the user cache is: a card that
        // cannot be loaded fails a tap, and a tap has a documented fallback
        // (search by name), whereas an empty user cache refuses every
        // authenticated request while reporting healthy.
        println!("  [INFO] Loading health ID cards from database...");
        match app_state.hydrate_card_registry().await {
            Ok(count) => println!("  [OK] Loaded {} health ID cards", count),
            Err(e) => log::warn!("failed to load health ID cards: {e}"),
        }

        // Load demo patients from database into in-memory cache
        println!("  [INFO] Loading demo patients from database...");
        match app_state.load_patients_from_db().await {
            Ok(count) => {
                println!("  [OK] Loaded {} demo patients", count);
            }
            Err(e) => {
                return Err(std::io::Error::other(format!(
                    "failed to initialize patient cache: {e}"
                )));
            }
        }

        // Load persisted MFA enrollments + recent security alerts (Phase 11.3/11.4)
        println!("  [INFO] Loading security state (MFA + alerts) from database...");
        match app_state.load_security_from_db().await {
            Ok(count) => println!("  [OK] Loaded {} MFA enrollments", count),
            Err(e) => {
                return Err(std::io::Error::other(format!(
                    "failed to initialize MFA security state: {e}"
                )));
            }
        }
    }

    Ok(())
}

/// Start the periodic jobs. None of them can fail startup, by design: a
/// reminder that does not fire is not a reason to refuse to serve records.
fn spawn_background_jobs(app_state: &web::Data<AppState>) {
    // One pass, not periodic: every save indexes its own row, so only rows
    // older than the index need this, and a pass leaves none behind.
    {
        let index_state = app_state.clone();
        tokio::spawn(async move {
            match crate::patient_name_index::backfill_missing_name_index(
                index_state.repositories.patients.as_ref(),
                &index_state.encryption_keyring,
            )
            .await
            {
                Ok(report) if report == Default::default() => {}
                Ok(report) => log::info!(
                    "patient name index backfill: {} indexed, {} undecryptable, {} with no indexable name",
                    report.indexed,
                    report.undecryptable,
                    report.nameless
                ),
                Err(error) => log::error!("patient name index backfill failed: {error}"),
            }
        });
    }

    // Seal the audit stream (WP8, ADR-0010): batch, chain, sign and export.
    // PostgreSQL only; a failure is logged and retried, never shown to a request.
    if let Some(pool) = app_state.db_pool.clone() {
        crate::audit_batching::spawn_batching_job(
            pool,
            tokio::time::Duration::from_secs(AUDIT_BATCH_INTERVAL_SECS),
            app_state.audit_seal.clone(),
        );
    }

    // Start medication reminder background task
    {
        let reminder_state = app_state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                crate::job_lock::run_exclusive(
                    reminder_state.db_pool.as_ref(),
                    crate::job_lock::JobKey::MedicationReminders,
                    || {
                        crate::clinical_endpoints::check_and_send_medication_reminders(
                            &reminder_state,
                        )
                    },
                )
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
                crate::job_lock::run_exclusive(
                    reminder_state.db_pool.as_ref(),
                    crate::job_lock::JobKey::AppointmentReminders,
                    || {
                        crate::clinical_endpoints::check_and_send_appointment_reminders(
                            &reminder_state,
                        )
                    },
                )
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
                let Some(assessment) = crate::job_lock::run_exclusive(
                    retention_state.db_pool.as_ref(),
                    crate::job_lock::JobKey::RetentionAssessment,
                    || crate::retention::run_retention_assessment(&retention_state),
                )
                .await
                else {
                    continue;
                };
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

    // The API defaults to 8090 for local development. Inside Docker it binds
    // 8080 in its own namespace, set explicitly as `PORT` in docker-compose.yml.
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
        log::error!("startup aborted: {msg}");
        return Err(std::io::Error::other(msg));
    }

    // Warn (do not block boot) if any national-ID verifier's API key is unset in
    // non-demo mode — that country would silently run on the deterministic stub
    // verifier (Horizon HZ-004).
    warn_missing_national_id_keys();
    warn_if_clinic_offset_unset();

    let db_pool = initialise_storage().await?;

    // Outside demo mode the audit seal needs a signing key and a checkpoint sink.
    let audit_seal = crate::audit_seal::SealRuntime::from_env(crate::support::is_demo_mode())
        .map_err(std::io::Error::other)?;
    if audit_seal.signer.is_none() {
        log::warn!("AUDIT_SEAL_SIGNING_KEY is not set: audit batches are sealed unsigned (demo)");
    }

    // Create shared state with optional database pool (using async version for PostgreSQL support)
    let persistent_storage_requested = db_pool.is_some()
        || crate::repositories::StorageBackend::from_env()
            == crate::repositories::StorageBackend::Postgres;
    let state = AppState::new_with_pool_async(db_pool, audit_seal).await;
    if persistent_storage_requested
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
    }

    hydrate_caches(&app_state).await?;

    match crate::deferred_emergency_audit::EmergencyAuditMode::from_env()
        .map_err(std::io::Error::other)?
    {
        crate::deferred_emergency_audit::EmergencyAuditMode::Deny => {}
        crate::deferred_emergency_audit::EmergencyAuditMode::DurableDefer => {
            crate::deferred_emergency_audit::replay_pending(&app_state)
                .await
                .map_err(std::io::Error::other)?;
            let replay_state = app_state.clone();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
                loop {
                    interval.tick().await;
                    let replayed = crate::job_lock::run_exclusive(
                        replay_state.db_pool.as_ref(),
                        crate::job_lock::JobKey::DeferredEmergencyAudit,
                        || crate::deferred_emergency_audit::replay_pending(&replay_state),
                    )
                    .await;
                    match replayed {
                        Some(Ok(count)) if count > 0 => {
                            log::info!("Reconciled {count} deferred emergency audit event(s)")
                        }
                        Some(Ok(_)) | None => {}
                        Some(Err(error)) => {
                            log::error!("Deferred emergency audit backlog unreconciled: {error}")
                        }
                    }
                }
            });
        }
    }

    spawn_background_jobs(&app_state);

    println!();
    println!("  [OK] Server ready!");
    println!();

    // Start HTTP server
    // ONE limiter for the whole process. See `middleware::rate_limit`.
    let rate_limit = RateLimitMiddleware::default_config();

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
                    actix_web::http::header::HeaderName::from_static("x-request-id"),
                    // Clinician's declared reason for opening a chart (PHI audit).
                    actix_web::http::header::HeaderName::from_static(
                        crate::middleware::phi_access_audit::ACCESS_REASON_HEADER,
                    ),
                    // Server-issued chart access context (WP10).
                    actix_web::http::header::HeaderName::from_static(
                        crate::middleware::phi_access_audit::ACCESS_CONTEXT_HEADER,
                    ),
                    // Sent by the client on every mutation; without it here a
                    // cross-origin write fails its preflight in production.
                    actix_web::http::header::HeaderName::from_static("idempotency-key"),
                ])
                // The HttpOnly refresh cookie (WP12) crosses origins only with
                // credentials allowed. Safe here: origins are listed exactly,
                // and the cookie is SameSite=Strict besides. Demo mode (any
                // origin) deliberately does not allow credentials; its clients
                // reach the API through the same-origin proxy.
                .supports_credentials()
                .max_age(3600);

            for origin in allowed_origins.split(',') {
                cors = cors.allowed_origin(origin.trim());
            }
            cors
        };

        // Cloned from the single instance built before `HttpServer::new`, so
        // every worker shares one set of counters. Constructing it here gave
        // each worker its own and multiplied the effective limit by the worker
        // count.
        let rate_limit = rate_limit.clone();

        let is_demo = std::env::var("IS_DEMO").unwrap_or_else(|_| "false".to_string()) == "true";

        // Configure encryption policy
        let encryption_policy = if !is_demo {
            EncryptionPolicyMiddleware::enabled()
        } else {
            EncryptionPolicyMiddleware::new(false)
        };

        App::new()
            // Innermost on purpose: it must see the matched route and the
            // handler's final status, and its 503 must still get CORS headers.
            .wrap(crate::middleware::phi_access_audit::PhiAccessAuditMiddleware)
            .wrap(cors)
            // Security/HSTS headers on every response (Phase 6.2).
            .wrap(SecurityHeadersMiddleware)
            // Rewrites /api/v1/... → /api/... before routing (Phase 9.1).
            .wrap(ApiVersionMiddleware)
            .wrap(rate_limit)
            // Identity for durable operation claims comes only from the verified JWT.
            .wrap(IdempotencyMiddleware)
            .wrap(SessionStateMiddleware)
            .wrap(encryption_policy)
            .wrap(MetricsMiddleware)
            .app_data(app_state.clone())
            .configure(routes::configure)
    })
    .bind(&bind_addr)?
    .run()
    .await
}
