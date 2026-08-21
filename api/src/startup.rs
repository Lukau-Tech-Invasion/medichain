//! Server startup helpers: banner + production-secret validation.
//!
//! Split out of `main.rs` (Phase 10.2). Re-exported at the crate root.

// ============================================================================
// Production Secret Validation (Phase 6.1)
// ============================================================================

/// Known development/demo secret values that MUST NOT survive into production.
///
/// `ENCRYPTION_KEYS` has no single "demo value" to compare against (each
/// deployment's key is unique), so it uses a sentinel that can never actually
/// match a real env value — this relies on the unset-var branch below to flag
/// it, not the demo-value-equality branch. Unset means the API falls back to
/// an ephemeral, non-persistent key (see `encryption_keyring.rs`), which is
/// unsafe in production the same way a demo JWT/session secret is.
pub const DEMO_SECRET_MARKERS: &[(&str, &str)] = &[
    (
        "JWT_SECRET",
        "medichain-demo-secret-key-change-in-production-2024",
    ),
    (
        "SESSION_SECRET",
        "medichain-dev-secret-change-in-production",
    ),
    ("ENCRYPTION_KEYS", "\0__unset_sentinel_never_matches__\0"),
    (
        // Keys `support::hash_national_id`'s digest (Horizon HZ-005). Unset or
        // left at the dev default means every stored national-ID digest is
        // reversible by exhaustive search against a known/guessed key.
        "NATIONAL_ID_HASH_KEY",
        "medichain-dev-national-id-key-change-in-production",
    ),
    (
        // Verifies the SMS inbound webhook actually came from the configured
        // carrier callback (found during continued remediation, not one of
        // HZ-001..011). Left at the dev default means anyone can spoof a STOP
        // reply for an arbitrary phone number.
        "SMS_INBOUND_WEBHOOK_SECRET",
        "medichain-dev-sms-webhook-secret-change-in-production",
    ),
];

/// Reject contradictory runtime posture before authentication middleware is built.
pub fn validate_runtime_posture(
    app_env: &str,
    is_demo: bool,
    require_signatures: bool,
) -> Result<(), String> {
    let production = matches!(
        app_env.trim().to_ascii_lowercase().as_str(),
        "prod" | "production"
    );
    if production && is_demo {
        return Err(
            "Refusing to start: APP_ENV=production cannot be combined with IS_DEMO=true"
                .to_string(),
        );
    }
    if production && !require_signatures {
        return Err(
            "Refusing to start: APP_ENV=production requires REQUIRE_SIGNATURES=true".to_string(),
        );
    }
    Ok(())
}

/// Validate that the running configuration is not using demo/default secrets.
///
/// Secure by default: `IS_DEMO` is treated as `false` (production) when unset, so a
/// forgotten/misconfigured environment FAILS CLOSED — the server refuses to boot
/// with demo or missing secrets rather than silently running insecure. Only an
/// explicit `IS_DEMO=true` (set by the dev/demo entry points: `.env.example`,
/// base `docker-compose.yml`, `start-server.sh`, `scripts/start-dev.sh`) downgrades
/// to warn-only demo mode. This matches the signature-auth default in `main.rs`.
///
/// - Always logs a warning for each demo/default secret still in effect.
/// - In production mode (`IS_DEMO` unset or `false`) returns `Err`, so the server
///   refuses to start with insecure credentials (defense for ePHI per HIPAA/POPIA).
pub fn validate_production_secrets() -> Result<(), String> {
    // Fail closed: unset IS_DEMO ⇒ production (refuse demo/missing secrets).
    let is_demo = std::env::var("IS_DEMO").unwrap_or_else(|_| "false".to_string()) == "true";
    let require_signatures = std::env::var("REQUIRE_SIGNATURES")
        .map(|value| value == "true")
        .unwrap_or(!is_demo);
    let app_env = std::env::var("APP_ENV")
        .unwrap_or_else(|_| if is_demo { "development" } else { "production" }.to_string());
    validate_runtime_posture(&app_env, is_demo, require_signatures)?;
    validate_telehealth_configuration(&app_env)?;
    validate_identity_verification_configuration(&app_env)?;

    let mut offenders: Vec<String> = Vec::new();

    for (var, demo_value) in DEMO_SECRET_MARKERS {
        match std::env::var(var) {
            // Equal to the known demo value → insecure for production.
            Ok(v) if v == *demo_value => offenders.push((*var).to_string()),
            // Unset in production is also insecure (no signing key configured).
            Err(_) => offenders.push(format!("{} (unset)", var)),
            Ok(_) => {}
        }
    }

    // Database password check (covers DATABASE_URL and POSTGRES_PASSWORD).
    let db_url = std::env::var("DATABASE_URL").unwrap_or_default();
    let pg_pw = std::env::var("POSTGRES_PASSWORD").unwrap_or_default();
    if db_url.contains("medichain_dev_2024") || pg_pw == "medichain_dev_2024" {
        offenders.push("DATABASE_URL/POSTGRES_PASSWORD (demo password)".to_string());
    }

    if offenders.is_empty() {
        return Ok(());
    }

    for offender in &offenders {
        log::warn!("Insecure default secret in use: {}", offender);
    }

    if !is_demo {
        return Err(format!(
            "Refusing to start in production mode (IS_DEMO=false) with {} insecure default \
             secret(s): {}. Set strong values in the environment / .env and restart.",
            offenders.len(),
            offenders.join(", ")
        ));
    }

    log::warn!(
        "Running in DEMO mode with {} default secret(s). Set IS_DEMO=false and strong secrets \
         before any production deployment.",
        offenders.len()
    );
    Ok(())
}

/// Production telehealth must use a private, authenticated provider. Provider
/// failure may not be handled by silently offering a public meeting room.
pub fn validate_telehealth_configuration(app_env: &str) -> Result<(), String> {
    let production = matches!(
        app_env.trim().to_ascii_lowercase().as_str(),
        "prod" | "production"
    );
    if !production || std::env::var("TELEHEALTH_ENABLED").as_deref() == Ok("false") {
        return Ok(());
    }

    let provider = std::env::var("TELEHEALTH_PROVIDER")
        .unwrap_or_else(|_| "jitsi".to_string())
        .to_ascii_lowercase();
    match provider.as_str() {
        "jitsi" => {
            let domain = std::env::var("JITSI_DOMAIN").unwrap_or_default();
            let app_id = std::env::var("JITSI_APP_ID").unwrap_or_default();
            let secret = std::env::var("JITSI_APP_SECRET").unwrap_or_default();
            if domain.is_empty()
                || domain == "meet.jit.si"
                || app_id.is_empty()
                || secret.is_empty()
            {
                return Err(
                    "Refusing production startup: Jitsi must use a non-public self-hosted domain \
                     with JITSI_APP_ID and JITSI_APP_SECRET token authentication"
                        .to_string(),
                );
            }
        }
        "daily" if std::env::var("DAILY_API_KEY").is_err() => {
            return Err(
                "Refusing production startup: DAILY_API_KEY is required for telehealth".into(),
            );
        }
        "twilio"
            if std::env::var("TWILIO_ACCOUNT_SID").is_err()
                || std::env::var("TWILIO_AUTH_TOKEN").is_err() =>
        {
            return Err(
                "Refusing production startup: Twilio telehealth requires account and auth token"
                    .into(),
            );
        }
        "internal" => {
            return Err(
                "Refusing production startup: the internal telehealth provider is not externally qualified"
                    .into(),
            );
        }
        "daily" | "twilio" => {}
        _ => return Err("Refusing production startup: unknown telehealth provider".into()),
    }
    Ok(())
}

/// The deterministic ID verifier is restricted to explicit demo/test use. A
/// production response must never label a non-empty placeholder as verified.
pub fn validate_identity_verification_configuration(app_env: &str) -> Result<(), String> {
    let production = matches!(
        app_env.trim().to_ascii_lowercase().as_str(),
        "prod" | "production"
    );
    if !production {
        return Ok(());
    }
    match std::env::var("NATIONAL_ID_VERIFICATION_MODE") {
        Ok(mode) if mode.eq_ignore_ascii_case("live") => Ok(()),
        _ => Err(
            "Refusing production startup: NATIONAL_ID_VERIFICATION_MODE=live is required; \
             the deterministic stub is demo/test only"
                .into(),
        ),
    }
}

/// Env vars for the 5 national-ID verifiers (Horizon HZ-004). Unlike
/// `DEMO_SECRET_MARKERS`, an unset key here is not necessarily wrong — a soft
/// launch may legitimately not have every country's key yet — so this warns
/// loudly rather than refusing to boot. Before this check existed, a missing key
/// silently degraded that country's identity verification to "any non-empty
/// string is verified" (see `national_id::StubVerifier`) with only an
/// invisible-by-default `log::debug!` line.
pub const NATIONAL_ID_API_KEY_VARS: &[&str] = &[
    "FAYDA_API_KEY",
    "GHANA_CARD_API_KEY",
    "NIN_API_KEY",
    "SMARTID_API_KEY",
    "HUDUMA_API_KEY",
];

/// Warn at startup for every national-ID API key that is unset in non-demo mode.
///
/// Deliberately warn-only (not `validate_production_secrets`'s fail-closed
/// behavior): identity verification degrading to the stub for one missing
/// country is a real gap, but it should not take down verification for every
/// other country by refusing to boot.
pub fn warn_missing_national_id_keys() {
    let is_demo = std::env::var("IS_DEMO").unwrap_or_else(|_| "false".to_string()) == "true";
    if is_demo {
        return;
    }

    let missing: Vec<&str> = NATIONAL_ID_API_KEY_VARS
        .iter()
        .filter(|var| std::env::var(var).is_err())
        .copied()
        .collect();

    if !missing.is_empty() {
        log::warn!(
            "National-ID verification will silently use the deterministic stub for {} \
             country/countries whose API key is unset: {}. Any non-empty ID string will be \
             reported as verified for these countries until the key is configured. Set the \
             corresponding key or accept this explicitly for now.",
            missing.len(),
            missing.join(", ")
        );
    }
}

/// Print the ASCII startup banner and endpoint cheat-sheet.
pub fn print_startup_banner(bind_addr: &str) {
    println!();
    println!("╔══════════════════════════════════════════════════════════════════╗");
    println!("║                                                                  ║");
    println!("║   ███╗   ███╗███████╗██████╗ ██╗ ██████╗██╗  ██╗ █████╗ ██╗███╗  ║");
    println!("║   ████╗ ████║██╔════╝██╔══██╗██║██╔════╝██║  ██║██╔══██╗██║████╗ ║");
    println!("║   ██╔████╔██║█████╗  ██║  ██║██║██║     ███████║███████║██║██╔██╗║");
    println!("║   ██║╚██╔╝██║██╔══╝  ██║  ██║██║██║     ██╔══██║██╔══██║██║██║╚██║");
    println!("║   ██║ ╚═╝ ██║███████╗██████╔╝██║╚██████╗██║  ██║██║  ██║██║██║ ╚█║");
    println!("║   ╚═╝     ╚═╝╚══════╝╚═════╝ ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝ ╚╝║");
    println!("║                                                                  ║");
    println!("║             Blockchain Health ID • Emergency Access              ║");
    println!("║                                                                  ║");
    println!("╚══════════════════════════════════════════════════════════════════╝");
    println!();
    println!("  API Server starting on http://{}", bind_addr);
    println!("  Demo endpoint: http://{}/api/demo", bind_addr);
    println!("  Health check:  http://{}/health", bind_addr);
    println!("  IPFS health:   http://{}/api/ipfs/health", bind_addr);
    println!();
    println!("  IPFS Endpoints:");
    println!("     POST /api/records/upload      - Upload encrypted medical record");
    println!("     POST /api/records/download    - Download decrypted record");
    println!("     GET  /api/records/{{patient}}  - List patient records");
    println!();
    println!("  NFC Simulation Endpoints:");
    println!("     POST /api/nfc/generate        - Generate NFC card for patient");
    println!("     POST /api/nfc/tap             - Simulate NFC card tap");
    println!("     POST /api/nfc/verify-qr       - Verify QR code for emergency");
    println!("     GET  /api/nfc/card/{{patient}} - Get card info by patient");
    println!("     POST /api/nfc/suspend         - Suspend a card (Admin)");
    println!("     GET  /api/nfc/cards           - List all cards (Admin)");
    println!();
    println!("  Clinical Documentation Endpoints:");
    println!("     POST /api/clinical/triage     - Create ESI triage assessment");
    println!("     POST /api/clinical/soap       - Create SOAP note");
    println!("     POST /api/clinical/sample     - Create SAMPLE history");
    println!("     POST /api/clinical/gcs        - Create Glasgow Coma Scale");
    println!("     POST /api/clinical/vitals     - Add vital signs reading");
    println!("     GET  /api/clinical/lab-panels - View lab panel templates");
    println!();
    println!("  Emergency Protocol Endpoints:");
    println!("     POST /api/clinical/code-blue  - Initiate Code Blue/Resuscitation");
    println!("     POST /api/clinical/trauma     - Create Trauma Assessment");
    println!("     POST /api/clinical/stroke     - Create Stroke Assessment (NIHSS)");
    println!("     POST /api/clinical/sepsis     - Create Sepsis Assessment (qSOFA)");
    println!("     GET  /api/clinical/patient/{{id}}/emergency - All emergency records");
    println!();
    println!("  Dashboard & Workflow Endpoints:");
    println!("     GET  /api/dashboard/patient   - Patient home dashboard");
    println!("     GET  /api/dashboard/doctor    - Doctor dashboard (patients, labs)");
    println!("     GET  /api/dashboard/nurse     - Nurse dashboard (tasks, vitals)");
    println!("     GET  /api/dashboard/lab       - Lab tech dashboard (queue, QC)");
    println!("     GET  /api/dashboard/pharmacist - Pharmacist dashboard (Rx, alerts)");
    println!("     GET  /api/dashboard/admin     - Admin system overview");
    println!("     GET  /api/patients/list       - Filtered patient list");
    println!("     GET  /api/order-sets          - Common order bundles");
    println!("     GET  /api/notifications       - User notifications");
    println!("     GET  /api/medication-reminders/{{id}} - Med reminders");
    println!("     GET  /api/tasks/nurse         - Nurse task list");
    println!();
    println!("  Patient Engagement Endpoints:");
    println!("     POST /api/symptoms/log        - Log symptom for tracking");
    println!("     GET  /api/symptoms/{{id}}      - Get symptom history");
    println!("     POST /api/symptoms/analyze    - Analyze symptoms for conditions");
    println!("     POST /api/messages/send       - Send secure message");
    println!("     GET  /api/messages            - Get inbox messages");
    println!();
    println!("  Consent & Compliance Endpoints:");
    println!("     GET  /api/consent/types       - Available consent forms");
    println!("     POST /api/consent/sign        - Sign consent form");
    println!("     GET  /api/consent/patient/{{id}} - Patient's consents");
    println!();
    println!("  Barcode/Sample Tracking Endpoints:");
    println!("     POST /api/barcode/generate    - Generate barcode");
    println!("     POST /api/barcode/scan        - Scan barcode");
    println!("     GET  /api/barcode/track/{{bc}} - Track barcode history");
    println!();
    println!("  Note Templates Endpoints:");
    println!("     GET  /api/templates/notes     - Get note templates");
    println!("     POST /api/templates/notes/use - Create note from template");
    println!();
    println!("  Medical ID Card Endpoints:");
    println!("     GET  /api/medical-id/{{id}}    - Full Medical ID card data");
    println!("     GET  /api/medical-id/{{id}}/qr - QR code for Medical ID");
    println!("     GET  /api/medical-id/{{id}}/emergency - Emergency access view");
    println!("     GET  /api/medical-id/{{id}}/lockscreen - Lock screen format");
    println!("     POST /api/medical-id/{{id}}/preferences - Update preferences");
    println!("     POST /api/medical-id/{{id}}/emergency-notify - Trigger family alert");
    println!();
    println!("  © 2025 Lukau Invasion (Pty) Ltd. Rust Africa Hackathon 2026");
    println!();
}

/// The Substrate well-known development accounts.
///
/// Their secrets are published in the Substrate source and in every tutorial, so
/// anyone at all can sign as one.
const DEV_ACCOUNT_SURIS: [&str; 6] = [
    "//Alice",
    "//Bob",
    "//Charlie",
    "//Dave",
    "//Eve",
    "//Ferdie",
];

/// SS58 addresses of the well-known development accounts, derived rather than
/// hardcoded so the list cannot drift from the keys it is meant to describe.
pub fn dev_account_addresses() -> Vec<String> {
    use sp_core::{crypto::Ss58Codec, sr25519, Pair};
    DEV_ACCOUNT_SURIS
        .iter()
        .filter_map(|suri| sr25519::Pair::from_string(suri, None).ok())
        .map(|pair| pair.public().to_ss58check_with_version(42u8.into()))
        .collect()
}

/// Refuse to start a production instance where a well-known dev key holds a
/// privileged role.
///
/// `blockchain.rs` already refuses to *sign chain extrinsics* as Alice without
/// `SUBSTRATE_ALLOW_DEV_SIGNER`. This closes the other half, which is worse:
/// `//Alice` seeded as an active `Admin` in the `users` table means anyone who
/// has read the Substrate docs can authenticate as an administrator of this
/// deployment — create users, assign roles, read every registry. The key is not
/// secret and never was.
///
/// Demo mode is exempt, deliberately: the dev preset grants `//Alice` Admin
/// because it is the API's default dev signer, and the browser-test fixtures
/// depend on it.
pub async fn validate_no_privileged_dev_accounts(
    pool: &sqlx::PgPool,
    is_demo: bool,
) -> Result<(), String> {
    if is_demo {
        return Ok(());
    }

    let addresses = dev_account_addresses();
    if addresses.is_empty() {
        return Ok(());
    }

    let offenders: Vec<(String, String)> = sqlx::query_as(
        "SELECT wallet_address, role FROM users \
         WHERE wallet_address = ANY($1) \
           AND status = 'active' \
           AND role IN ('Admin', 'Doctor', 'Nurse', 'LabTechnician', 'Pharmacist')",
    )
    .bind(&addresses)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if offenders.is_empty() {
        return Ok(());
    }

    let listed = offenders
        .iter()
        .map(|(wallet, role)| format!("{role} {wallet}"))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Refusing to start: well-known Substrate development account(s) hold privileged roles \
         in this deployment ({listed}). Their private keys are published, so anyone could \
         authenticate as them. Deactivate or delete these users, or set IS_DEMO=true if this \
         is a demonstration instance."
    ))
}

/// Refuse to serve two organisations from one instance (ADR-0007).
///
/// MediChain is federated: each hospital runs its own API, its own PostgreSQL
/// and its own IPFS node (ADR-0006). Clinician worklists and the
/// `/api/platform/list/*` registries are therefore deployment-wide *by design* —
/// a doctor is supposed to see every critical value in their hospital.
///
/// That is only true while a deployment *is* one hospital. Pointing a second
/// organisation at the same database would silently turn every one of those
/// reads into a cross-organisation disclosure, with no error anywhere. The
/// boundary is load-bearing, so it is checked rather than assumed.
///
/// Returns `Err` with an operator-readable message when more than one active
/// organisation is present. A database without the federation tables — or one
/// where the query cannot run — is not treated as a violation: the check exists
/// to catch a misconfiguration, not to block startup on its own failure.
pub async fn validate_single_organisation(pool: &sqlx::PgPool) -> Result<(), String> {
    let count: Option<i64> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM organizations WHERE COALESCE(is_active, true) = true",
    )
    .fetch_one(pool)
    .await
    .ok();

    match count {
        Some(n) if n > 1 => Err(format!(
            "Refusing to start: this database holds {n} active organisations, but a MediChain \
             instance serves exactly one (ADR-0006, ADR-0007). Clinician worklists and the \
             /api/platform/list/* registries are deployment-wide, so a second organisation here \
             would read the first one's records. Split them into separate deployments, or \
             deactivate the extra rows in `organizations`."
        )),
        _ => Ok(()),
    }
}

/// Warn when the facility timezone offset is unset.
///
/// Appointment dates and times are stored as facility wall-clock. Without an
/// offset they are interpreted as UTC, which shifts every scheduled instant —
/// and therefore the telehealth join window and appointment reminders — by the
/// facility's real offset.
pub fn warn_if_clinic_offset_unset() {
    if std::env::var("CLINIC_UTC_OFFSET_MINUTES").is_err() {
        log::warn!(
            "CLINIC_UTC_OFFSET_MINUTES is not set - appointment times are being treated as UTC. \
             Set it to the facility's offset in minutes (e.g. 120 for SAST) or telehealth join \
             windows and reminders will be wrong by that offset."
        );
    }
}

#[cfg(test)]
mod runtime_posture_tests {
    use super::validate_runtime_posture;

    #[test]
    fn production_rejects_demo_mode() {
        let error = validate_runtime_posture("production", true, false).unwrap_err();
        assert!(error.contains("IS_DEMO=true"));
    }

    #[test]
    fn production_rejects_disabled_signatures() {
        let error = validate_runtime_posture("prod", false, false).unwrap_err();
        assert!(error.contains("REQUIRE_SIGNATURES=true"));
    }

    #[test]
    fn production_accepts_secure_posture() {
        assert!(validate_runtime_posture("production", false, true).is_ok());
    }

    #[test]
    fn explicit_development_demo_is_allowed() {
        assert!(validate_runtime_posture("development", true, false).is_ok());
    }
}

#[cfg(test)]
mod dev_account_tests {
    use super::*;

    /// Pins the canonical well-known development addresses.
    ///
    /// `validate_no_privileged_dev_accounts` compares database rows against
    /// these, so a derivation that silently changed would turn the guard into a
    /// no-op — it would look like it was working and match nothing. Alice's
    /// address is the one every Substrate tutorial prints, so a regression is
    /// obvious rather than merely self-consistent.
    #[test]
    fn well_known_dev_addresses_are_the_canonical_ones() {
        let addresses = dev_account_addresses();
        assert_eq!(addresses.len(), 6, "all six dev accounts must derive");
        assert!(
            addresses.contains(&"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY".to_string()),
            "//Alice must derive to her published address, got: {addresses:?}"
        );
        assert!(
            addresses.contains(&"5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty".to_string()),
            "//Bob must derive to his published address, got: {addresses:?}"
        );
    }
}
