//! Server startup helpers: banner + production-secret validation.
//!
//! Split out of `main.rs` (Phase 10.2). Re-exported at the crate root.

// ============================================================================
// Production Secret Validation (Phase 6.1)
// ============================================================================

/// Known development/demo secret values that MUST NOT survive into production.
pub const DEMO_SECRET_MARKERS: &[(&str, &str)] = &[
    (
        "JWT_SECRET",
        "medichain-demo-secret-key-change-in-production-2024",
    ),
    (
        "SESSION_SECRET",
        "medichain-dev-secret-change-in-production",
    ),
];

/// Validate that the running configuration is not using demo/default secrets.
///
/// - Always logs a warning for each demo/default secret still in effect.
/// - In production mode (`IS_DEMO=false`) returns `Err`, so the server refuses
///   to start with insecure credentials (defense for ePHI per HIPAA/POPIA).
pub fn validate_production_secrets() -> Result<(), String> {
    let is_demo = std::env::var("IS_DEMO").unwrap_or_else(|_| "true".to_string()) == "true";

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
        log::warn!("⚠️  Insecure default secret in use: {}", offender);
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
    println!("║           🏥 Blockchain Health ID • Emergency Access 🚑          ║");
    println!("║                                                                  ║");
    println!("╚══════════════════════════════════════════════════════════════════╝");
    println!();
    println!("  📡 API Server starting on http://{}", bind_addr);
    println!("  📋 Demo endpoint: http://{}/api/demo", bind_addr);
    println!("  ❤️  Health check: http://{}/health", bind_addr);
    println!("  📁 IPFS health:   http://{}/api/ipfs/health", bind_addr);
    println!();
    println!("  🔐 IPFS Endpoints:");
    println!("     POST /api/records/upload      - Upload encrypted medical record");
    println!("     POST /api/records/download    - Download decrypted record");
    println!("     GET  /api/records/{{patient}}  - List patient records");
    println!();
    println!("  📲 NFC Simulation Endpoints:");
    println!("     POST /api/nfc/generate        - Generate NFC card for patient");
    println!("     POST /api/nfc/tap             - Simulate NFC card tap");
    println!("     POST /api/nfc/verify-qr       - Verify QR code for emergency");
    println!("     GET  /api/nfc/card/{{patient}} - Get card info by patient");
    println!("     POST /api/nfc/suspend         - Suspend a card (Admin)");
    println!("     GET  /api/nfc/cards           - List all cards (Admin)");
    println!();
    println!("  🏥 Clinical Documentation Endpoints:");
    println!("     POST /api/clinical/triage     - Create ESI triage assessment");
    println!("     POST /api/clinical/soap       - Create SOAP note");
    println!("     POST /api/clinical/sample     - Create SAMPLE history");
    println!("     POST /api/clinical/gcs        - Create Glasgow Coma Scale");
    println!("     POST /api/clinical/vitals     - Add vital signs reading");
    println!("     GET  /api/clinical/lab-panels - View lab panel templates");
    println!();
    println!("  🚨 Emergency Protocol Endpoints:");
    println!("     POST /api/clinical/code-blue  - Initiate Code Blue/Resuscitation");
    println!("     POST /api/clinical/trauma     - Create Trauma Assessment");
    println!("     POST /api/clinical/stroke     - Create Stroke Assessment (NIHSS)");
    println!("     POST /api/clinical/sepsis     - Create Sepsis Assessment (qSOFA)");
    println!("     GET  /api/clinical/patient/{{id}}/emergency - All emergency records");
    println!();
    println!("  📊 Dashboard & Workflow Endpoints:");
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
    println!("  💬 Patient Engagement Endpoints:");
    println!("     POST /api/symptoms/log        - Log symptom for tracking");
    println!("     GET  /api/symptoms/{{id}}      - Get symptom history");
    println!("     POST /api/symptoms/analyze    - Analyze symptoms for conditions");
    println!("     POST /api/messages/send       - Send secure message");
    println!("     GET  /api/messages            - Get inbox messages");
    println!();
    println!("  📝 Consent & Compliance Endpoints:");
    println!("     GET  /api/consent/types       - Available consent forms");
    println!("     POST /api/consent/sign        - Sign consent form");
    println!("     GET  /api/consent/patient/{{id}} - Patient's consents");
    println!();
    println!("  📦 Barcode/Sample Tracking Endpoints:");
    println!("     POST /api/barcode/generate    - Generate barcode");
    println!("     POST /api/barcode/scan        - Scan barcode");
    println!("     GET  /api/barcode/track/{{bc}} - Track barcode history");
    println!();
    println!("  📋 Note Templates Endpoints:");
    println!("     GET  /api/templates/notes     - Get note templates");
    println!("     POST /api/templates/notes/use - Create note from template");
    println!();
    println!("  🆔 Medical ID Card Endpoints:");
    println!("     GET  /api/medical-id/{{id}}    - Full Medical ID card data");
    println!("     GET  /api/medical-id/{{id}}/qr - QR code for Medical ID");
    println!("     GET  /api/medical-id/{{id}}/emergency - Emergency access view");
    println!("     GET  /api/medical-id/{{id}}/lockscreen - Lock screen format");
    println!("     POST /api/medical-id/{{id}}/preferences - Update preferences");
    println!("     POST /api/medical-id/{{id}}/emergency-notify - Trigger family alert");
    println!();
    println!("  © 2025 Trustware. Rust Africa Hackathon 2026");
    println!();
}
