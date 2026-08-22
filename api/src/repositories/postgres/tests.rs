//! PostgreSQL repository integration tests.

use crate::repositories::postgres::{
    PgAllergyRepository, PgMedicalRecordRepository, PgPatientRepository,
};
use crate::repositories::{
    AllergyEntity, AllergyRepository, MedicalRecordEntity, MedicalRecordRepository, Pagination,
    PatientEntity, PatientRepository,
};
use chrono::Utc;
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::env;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_SCHEMA_ID: AtomicU64 = AtomicU64::new(0);

async fn get_test_pool() -> PgPool {
    create_test_pool().await
}

async fn create_test_pool() -> PgPool {
    dotenvy::dotenv().ok();
    let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgres://medichain:medichain_dev_2024@localhost:5432/medichain".to_string()
    });
    let schema = format!(
        "medichain_test_{}_{}_{}",
        std::process::id(),
        Utc::now().timestamp_millis(),
        NEXT_SCHEMA_ID.fetch_add(1, Ordering::Relaxed)
    );

    let admin_pool = create_admin_pool(&database_url).await;
    // Pool setup includes extension initialization and the stale-schema sweep.
    // Keep one database-scoped advisory lock across both and schema creation:
    // parallel tests otherwise discover the same stale schema then contend on
    // `DROP SCHEMA`, leaving the entire suite blocked on object locks.
    sqlx::query("SELECT pg_advisory_lock(812_940_171)")
        .execute(&admin_pool)
        .await
        .expect("Failed to lock PostgreSQL extension setup");
    sqlx::query("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")
        .execute(&admin_pool)
        .await
        .expect("Failed to enable uuid-ossp for test database migrations");
    // Sweep stale test schemas before creating a new one.
    //
    // These schemas were never dropped. On a developer machine that had run
    // this suite regularly, 239 of them had accumulated — roughly 28,000 tables
    // — and that broke something that mattered: `pg_dump` takes a LOCK on every
    // table in one transaction, so the documented backup procedure died with
    // "out of shared memory / increase max_locks_per_transaction". The rollback
    // path was unusable, and nobody knew because nobody had run it.
    //
    // A sweep rather than per-test teardown: tests take a `PgPool` and have no
    // natural drop hook, so adding one would mean restructuring every test.
    // Each run cleaning up after previous runs is self-healing and needs no
    // cooperation from the tests themselves.
    //
    // Only schemas older than two hours are dropped, so a concurrent run on the
    // same database is never touched — a test takes seconds, not hours. The
    // timestamp is the millisecond field of the schema name.
    // Select-then-drop in Rust rather than a PL/pgSQL DO block: sqlx sends
    // statements over the extended protocol, and a `DO $$ … $$` body did not
    // execute — silently, because the result was discarded. A sweep that
    // quietly does nothing is the same failure mode as the leak it fixes, so
    // this version is verifiable and logs what it removed.
    let stale: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT nspname::TEXT FROM pg_namespace
        WHERE nspname LIKE 'medichain\_test\_%'
          AND split_part(nspname, '_', 4) ~ '^[0-9]+$'
          AND split_part(nspname, '_', 4)::BIGINT
              < (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT - 7200000
        "#,
    )
    .fetch_all(&admin_pool)
    .await
    .unwrap_or_default();

    for s in &stale {
        if let Err(e) = sqlx::query(&format!("DROP SCHEMA {} CASCADE", quote_identifier(s)))
            .execute(&admin_pool)
            .await
        {
            // Not fatal: another runner may have dropped it first. Reported
            // rather than swallowed so a sweep that never works is visible.
            eprintln!("test-schema sweep: could not drop {s}: {e}");
        }
    }
    if !stale.is_empty() {
        eprintln!("test-schema sweep: dropped {} stale schema(s)", stale.len());
    }

    sqlx::query(&format!("CREATE SCHEMA {}", quote_identifier(&schema)))
        .execute(&admin_pool)
        .await
        .expect("Failed to create isolated test schema");
    sqlx::query("SELECT pg_advisory_unlock(812_940_171)")
        .execute(&admin_pool)
        .await
        .expect("Failed to unlock PostgreSQL test setup");
    admin_pool.close().await;

    let pool = create_schema_pool(&database_url, &schema).await;

    // SQLx keys its normal migration advisory lock to the database name, not
    // the active schema. These pools use a freshly-created, unique schema, so
    // their migrations cannot conflict; retaining the database-wide lock
    // serializes every parallel test for no safety benefit. Production keeps
    // `db::run_migrations`, including its lock, unchanged.
    let mut migrator = sqlx::migrate!("./migrations");
    migrator.set_locking(false);
    migrator
        .run(&pool)
        .await
        .expect("Failed to run isolated test schema migrations");

    pool
}

async fn create_admin_pool(database_url: &str) -> PgPool {
    PgPoolOptions::new()
        .max_connections(1)
        .min_connections(0)
        .connect(database_url)
        .await
        .expect("Failed to create admin test database pool")
}

async fn create_schema_pool(database_url: &str, schema: &str) -> PgPool {
    let search_path = format!("SET search_path TO {}, public", quote_identifier(schema));

    PgPoolOptions::new()
        .max_connections(4)
        .min_connections(0)
        .after_connect(move |conn, _meta| {
            let search_path = search_path.clone();
            Box::pin(async move {
                sqlx::query(&search_path).execute(conn).await?;
                Ok(())
            })
        })
        .connect(database_url)
        .await
        .expect("Failed to create isolated test database pool")
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn create_test_patient(id: &str) -> PatientEntity {
    PatientEntity {
        id: id.to_string(),
        health_id: health_id_for(id),
        national_id_hash: format!("hash-{}", id),
        national_id_type: "FaydaID".to_string(),
        first_name_encrypted: None,
        last_name_encrypted: None,
        date_of_birth_encrypted: None,
        gender: Some("Male".to_string()),
        blood_type: Some("O+".to_string()),
        phone_encrypted: None,
        email_encrypted: None,
        address_encrypted: None,
        emergency_contact_name_encrypted: None,
        emergency_contact_phone_encrypted: None,
        emergency_contact_relationship: None,
        organ_donor: false,
        dnr_status: false,
        dnr_verified_by: None,
        dnr_verified_at: None,
        dnr_document_ref: None,
        primary_provider_id: None,
        wallet_address: Some(format!("0x{}", id)),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        registered_by: None,
        is_verified: false,
        is_active: true,
        profile_extras_encrypted: None,
        key_version: 1,
    }
}

fn health_id_for(id: &str) -> String {
    let suffix_len = id.len().min(28);
    format!("HID-{}", &id[id.len() - suffix_len..])
}

#[tokio::test]
async fn test_pg_patient_repository() {
    let pool = get_test_pool().await;
    let repo = PgPatientRepository::new(pool.clone());

    let patient_id = format!("TEST-PAT-{}", Utc::now().timestamp_millis());
    let patient = create_test_patient(&patient_id);

    // Test Create
    let created = repo
        .create(patient)
        .await
        .expect("Failed to create patient");
    assert_eq!(created.id, patient_id);

    // Test Get by ID
    let fetched = repo
        .get_by_id(&patient_id)
        .await
        .expect("Failed to get patient by ID");
    assert_eq!(fetched.health_id, health_id_for(&patient_id));

    // Test Get by Wallet
    let fetched_wallet = repo
        .get_by_wallet(&format!("0x{}", patient_id))
        .await
        .expect("Failed to get by wallet");
    assert_eq!(fetched_wallet.id, patient_id);

    // Test Update
    let mut updated_patient = fetched.clone();
    updated_patient.blood_type = Some("A-".to_string());
    let updated = repo
        .update(updated_patient)
        .await
        .expect("Failed to update patient");
    assert_eq!(updated.blood_type, Some("A-".to_string()));

    // Test List
    let list = repo
        .list(Pagination::new(0, 10))
        .await
        .expect("Failed to list patients");
    assert!(list.total >= 1);
    assert!(list.items.iter().any(|p| p.id == patient_id));

    // Test Search
    let search_results = repo
        .search(&patient_id, Pagination::new(0, 10))
        .await
        .expect("Failed to search");
    assert_eq!(search_results.total, 1);
    assert_eq!(search_results.items[0].id, patient_id);

    // Test Delete (Soft Delete)
    repo.delete(&patient_id)
        .await
        .expect("Failed to delete patient");

    // Should NOT be found by get_by_id (as it filters by is_active = true)
    let result = repo.get_by_id(&patient_id).await;
    assert!(result.is_err());

    // Cleanup (hard delete)
    sqlx::query("DELETE FROM patients WHERE id = $1")
        .bind(&patient_id)
        .execute(&pool)
        .await
        .expect("Failed to cleanup test patient");
    pool.close().await;
}

#[tokio::test]
async fn test_pg_allergy_repository() {
    let pool = get_test_pool().await;
    let patient_repo = PgPatientRepository::new(pool.clone());
    let allergy_repo = PgAllergyRepository::new(pool.clone());

    let patient_id = format!("TEST-PAT-ALLERGY-{}", Utc::now().timestamp_millis());
    let patient = create_test_patient(&patient_id);
    patient_repo
        .create(patient)
        .await
        .expect("Failed to create patient");

    let allergy = AllergyEntity {
        id: format!("ALL-{}", Utc::now().timestamp_millis()),
        patient_id: patient_id.clone(),
        allergen: "Peanuts".to_string(),
        allergen_type: "Food".to_string(),
        reaction: Some("Anaphylaxis".to_string()),
        severity: "Severe".to_string(),
        onset_date: None,
        last_occurrence: None,
        verified: true,
        verified_by: Some("Dr. Smith".to_string()),
        verified_at: Some(Utc::now()),
        source: Some("Patient reported".to_string()),
        created_by: "Dr. Smith".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        is_active: true,
    };

    // Test Create
    let created = allergy_repo
        .create(allergy.clone())
        .await
        .expect("Failed to create allergy");
    assert_eq!(created.allergen, "Peanuts");

    // Test Get by Patient
    let allergies = allergy_repo
        .get_by_patient(&patient_id)
        .await
        .expect("Failed to get allergies");
    assert_eq!(allergies.len(), 1);
    assert_eq!(allergies[0].allergen, "Peanuts");

    // Test Has Allergen
    let has = allergy_repo
        .has_allergen(&patient_id, "Peanuts")
        .await
        .expect("Failed has_allergen");
    assert!(has);

    // Test Update
    let mut updated_allergy = created.clone();
    updated_allergy.severity = "LifeThreatening".to_string();
    let updated = allergy_repo
        .update(updated_allergy)
        .await
        .expect("Failed to update");
    assert_eq!(updated.severity, "LifeThreatening");

    // Test Delete
    allergy_repo
        .delete(&created.id)
        .await
        .expect("Failed to delete");
    let active = allergy_repo
        .get_active_by_patient(&patient_id)
        .await
        .expect("Failed to get active");
    assert_eq!(active.len(), 0);

    // Cleanup
    sqlx::query("DELETE FROM allergies WHERE patient_id = $1")
        .bind(&patient_id)
        .execute(&pool)
        .await
        .ok();
    pool.close().await;
    sqlx::query("DELETE FROM patients WHERE id = $1")
        .bind(&patient_id)
        .execute(&pool)
        .await
        .ok();
}

#[tokio::test]
async fn test_pg_medical_record_repository() {
    let pool = get_test_pool().await;
    let patient_repo = PgPatientRepository::new(pool.clone());
    let record_repo = PgMedicalRecordRepository::new(pool.clone());

    let patient_id = format!("TEST-PAT-REC-{}", Utc::now().timestamp_millis());
    let patient = create_test_patient(&patient_id);
    patient_repo
        .create(patient)
        .await
        .expect("Failed to create patient");

    let record = MedicalRecordEntity {
        id: format!("REC-{}", Utc::now().timestamp_millis()),
        patient_id: patient_id.clone(),
        record_type: "LabResult".to_string(),
        category: Some("Lab".to_string()),
        ipfs_content_hash: Some("QmTest123".to_string()),
        ipfs_metadata_hash: None,
        content_checksum: Some("abc123def".to_string()),
        on_chain_hash: None,
        blockchain_tx_hash: None,
        summary_encrypted: None,
        record_date: Utc::now(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        created_by: "DOC-001".to_string(),
        last_modified_by: "DOC-001".to_string(),
        facility_id: Some("FAC-001".to_string()),
        is_active: true,
        is_locked: false,
    };

    // Test Create
    let created = record_repo
        .create(record.clone())
        .await
        .expect("Failed to create record");
    assert_eq!(created.ipfs_content_hash, Some("QmTest123".to_string()));

    // Test Get by Patient
    let records = record_repo
        .get_by_patient(&patient_id, Pagination::new(0, 10))
        .await
        .expect("Failed to get records");
    assert_eq!(records.items.len(), 1);

    // Test Get by IPFS Hash
    let fetched = record_repo
        .get_by_ipfs_hash("QmTest123")
        .await
        .expect("Failed to get by IPFS");
    assert_eq!(fetched.id, created.id);

    // Test Delete
    record_repo
        .delete(&created.id)
        .await
        .expect("Failed to delete");
    let records_after = record_repo
        .get_by_patient(&patient_id, Pagination::new(0, 10))
        .await
        .expect("Failed to get records");
    assert!(records_after.items.iter().all(|r| !r.is_active));

    // Cleanup
    sqlx::query("DELETE FROM medical_records WHERE patient_id = $1")
        .bind(&patient_id)
        .execute(&pool)
        .await
        .ok();
    pool.close().await;
    sqlx::query("DELETE FROM patients WHERE id = $1")
        .bind(&patient_id)
        .execute(&pool)
        .await
        .ok();
}

/// C1: emergency-protocol records must persist across a restart under Postgres.
///
/// A fresh repository instance reading the same database (simulating a process
/// restart) must return the previously-written record, with all unsigned-int
/// fields surviving the JSONB round-trip.
#[tokio::test]
async fn test_pg_code_blue_round_trip_survives_restart() {
    use crate::repositories::postgres::PgCodeBlueRepository;
    use crate::repositories::traits::{CodeBlueEntity, CodeBlueRepository};

    let pool = get_test_pool().await;
    let id = format!("CB-{}", Utc::now().timestamp_millis());
    let patient_id = format!("PAT-CB-{}", Utc::now().timestamp_millis());

    let record = CodeBlueEntity {
        id: id.clone(),
        patient_id: patient_id.clone(),
        location: "ED Bay 3".to_string(),
        code_called_at: 1_700_000_000,
        team_arrived_at: Some(1_700_000_120),
        initial_rhythm: "VF".to_string(),
        witnessed: true,
        outcome: "ROSC".to_string(),
        code_leader: "DR-001".to_string(),
        documented_by: "NURSE-007".to_string(),
        documented_at: 1_700_000_300,
        data: serde_json::json!({ "rounds": 3, "shocks": 2 }),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    // Write through the first repository instance.
    let writer = PgCodeBlueRepository::new(pool.clone());
    writer.create(record.clone()).await.expect("create failed");

    // Simulate a restart: a brand-new repository instance over the same DB.
    let reader = PgCodeBlueRepository::new(pool.clone());
    let fetched = reader.get_by_id(&id).await.expect("record lost on restart");
    assert_eq!(fetched.id, id);
    assert_eq!(fetched.outcome, "ROSC");
    assert!(fetched.witnessed);
    assert_eq!(fetched.team_arrived_at, Some(1_700_000_120));
    assert_eq!(fetched.data["rounds"], serde_json::json!(3));

    // And it is queryable by patient.
    let by_patient = reader
        .get_by_patient(&patient_id, Pagination::new(0, 10))
        .await
        .expect("get_by_patient failed");
    assert_eq!(by_patient.total, 1);
    assert_eq!(by_patient.items.len(), 1);
    assert_eq!(by_patient.items[0].id, id);

    // Cleanup.
    reader.delete(&id).await.ok();
    pool.close().await;
}

#[tokio::test]
async fn test_pg_trauma_round_trip_survives_restart() {
    use crate::repositories::postgres::PgTraumaAssessmentRepository;
    use crate::repositories::traits::{TraumaAssessmentEntity, TraumaAssessmentRepository};
    let pool = get_test_pool().await;
    let id = format!("TRAUMA-{}", uuid::Uuid::new_v4());
    let record = TraumaAssessmentEntity {
        id: id.clone(),
        patient_id: "PAT-TRAUMA-RESTART".into(),
        mechanism: "motor_vehicle_collision".into(),
        gcs: 12,
        trauma_level: Some(1),
        mtp_activated: true,
        disposition: "operating_theatre".into(),
        assessed_by: "DR-1".into(),
        assessed_at: 1_700_000_001,
        data: serde_json::json!({"airway":"secured"}),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    PgTraumaAssessmentRepository::new(pool.clone())
        .create(record)
        .await
        .expect("create failed");
    let reader = PgTraumaAssessmentRepository::new(pool.clone());
    let fetched = reader.get_by_id(&id).await.expect("record lost on restart");
    assert_eq!(fetched.gcs, 12);
    assert_eq!(fetched.trauma_level, Some(1));
    assert!(fetched.mtp_activated);
    reader.delete(&id).await.ok();
    pool.close().await;
}

#[tokio::test]
async fn test_pg_stroke_round_trip_survives_restart() {
    use crate::repositories::postgres::PgStrokeAssessmentRepository;
    use crate::repositories::traits::{StrokeAssessmentEntity, StrokeAssessmentRepository};
    let pool = get_test_pool().await;
    let id = format!("STROKE-{}", uuid::Uuid::new_v4());
    let record = StrokeAssessmentEntity {
        id: id.clone(),
        patient_id: "PAT-STROKE-RESTART".into(),
        nihss_total: 18,
        stroke_type: "ischemic".into(),
        tpa_eligible: true,
        tpa_given: true,
        hemorrhage: false,
        lvo_suspected: true,
        assessed_by: "DR-2".into(),
        assessed_at: 1_700_000_002,
        data: serde_json::json!({"last_known_well":"08:30"}),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    PgStrokeAssessmentRepository::new(pool.clone())
        .create(record)
        .await
        .expect("create failed");
    let reader = PgStrokeAssessmentRepository::new(pool.clone());
    let fetched = reader.get_by_id(&id).await.expect("record lost on restart");
    assert_eq!(fetched.nihss_total, 18);
    assert!(fetched.tpa_given);
    assert!(fetched.lvo_suspected);
    reader.delete(&id).await.ok();
    pool.close().await;
}

#[tokio::test]
async fn test_pg_cardiac_round_trip_survives_restart() {
    use crate::repositories::postgres::PgCardiacEventRepository;
    use crate::repositories::traits::{CardiacEventEntity, CardiacEventRepository};
    let pool = get_test_pool().await;
    let id = format!("CARDIAC-{}", uuid::Uuid::new_v4());
    let record = CardiacEventEntity {
        id: id.clone(),
        patient_id: "PAT-CARDIAC-RESTART".into(),
        event_type: "stemi".into(),
        cath_lab_activated: true,
        pci_performed: true,
        door_to_balloon_minutes: Some(62),
        documented_by: "DR-3".into(),
        documented_at: 1_700_000_003,
        data: serde_json::json!({"territory":"anterior"}),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    PgCardiacEventRepository::new(pool.clone())
        .create(record)
        .await
        .expect("create failed");
    let reader = PgCardiacEventRepository::new(pool.clone());
    let fetched = reader.get_by_id(&id).await.expect("record lost on restart");
    assert_eq!(fetched.door_to_balloon_minutes, Some(62));
    assert!(fetched.pci_performed);
    reader.delete(&id).await.ok();
    pool.close().await;
}

#[tokio::test]
async fn test_pg_sepsis_round_trip_survives_restart() {
    use crate::repositories::postgres::PgSepsisAssessmentRepository;
    use crate::repositories::traits::{SepsisAssessmentEntity, SepsisAssessmentRepository};
    let pool = get_test_pool().await;
    let id = format!("SEPSIS-{}", uuid::Uuid::new_v4());
    let record = SepsisAssessmentEntity {
        id: id.clone(),
        patient_id: "PAT-SEPSIS-RESTART".into(),
        severity: "septic_shock".into(),
        suspected_source: "pneumonia".into(),
        qsofa_score: 3,
        sofa_score: Some(11),
        vasopressors_required: true,
        icu_admission: true,
        assessed_by: "DR-4".into(),
        assessed_at: 1_700_000_004,
        data: serde_json::json!({"lactate":4.8}),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    PgSepsisAssessmentRepository::new(pool.clone())
        .create(record)
        .await
        .expect("create failed");
    let reader = PgSepsisAssessmentRepository::new(pool.clone());
    let fetched = reader.get_by_id(&id).await.expect("record lost on restart");
    assert_eq!(fetched.sofa_score, Some(11));
    assert!(fetched.vasopressors_required);
    assert!(fetched.icu_admission);
    reader.delete(&id).await.ok();
    pool.close().await;
}

// =============================================================================
// H1 (issue #7) — the logical user survives a restart intact
// =============================================================================
// Not "the upsert lists more columns". These tests persist a complete logical
// user, DESTROY the in-memory state, reload from PostgreSQL, and compare field
// by field — asserting explicitly which fields must survive and which are known
// not to, so a field added to `User` without a persistence decision fails here
// instead of silently joining the drift.
//
// See .horizon/evidence-private/HZ-H1-PERSISTENCE/inventory.md
// =============================================================================

/// A synthetic SS58-shaped wallet; the `valid_wallet` constraint requires
/// >= 45 chars starting with '5'.
fn synthetic_wallet(suffix: &str) -> String {
    let base = "5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw";
    format!("{}{}", &base[..base.len() - suffix.len()], suffix)
}

/// A fully-populated staff user — every optional field set, so anything that
/// fails to round-trip surfaces as a concrete difference rather than a silent
/// `None`.
fn complete_staff_user(wallet: &str) -> crate::User {
    crate::User {
        wallet_address: wallet.to_string(),
        username: Some("dr_round_trip".to_string()),
        name: "Dr Round Trip".to_string(),
        role: crate::Role::Doctor,
        created_at: Utc::now(),
        created_by: Some("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY".to_string()),
        linked_patient_id: None,
        email: Some("round.trip@example.test".to_string()),
        phone: Some("+27115550000".to_string()),
        department: Some("Cardiology".to_string()),
        specialty: Some("Interventional Cardiology".to_string()),
        license_number: Some("MP-778899".to_string()),
        status: "active".to_string(),
        last_login: None,
    }
}

#[tokio::test]
async fn test_logical_user_round_trips_across_restart() {
    let pool = get_test_pool().await;
    let wallet = synthetic_wallet("aa01");

    // --- write through one AppState ---
    let before = crate::AppState::new_with_pool(Some(pool.clone()));
    let original = complete_staff_user(&wallet);
    before
        .persist_user(&original)
        .await
        .expect("persist_user failed");

    // --- simulate a restart: a new AppState whose in-memory state is empty ---
    let after = crate::AppState::new_with_pool(Some(pool.clone()));
    assert!(
        after.users.read().unwrap().is_empty(),
        "precondition: reloaded state must start empty, or this test proves nothing"
    );
    after
        .load_demo_users_from_db()
        .await
        .expect("load_demo_users_from_db failed");

    let reloaded = after
        .users
        .read()
        .unwrap()
        .get(&wallet)
        .cloned()
        .expect("user was lost across the restart");

    // --- fields that MUST survive ---
    assert_eq!(reloaded.wallet_address, original.wallet_address);
    assert_eq!(reloaded.username, original.username);
    assert_eq!(reloaded.name, original.name);
    assert_eq!(reloaded.role, original.role, "role must survive");
    assert_eq!(reloaded.email, original.email);
    assert_eq!(reloaded.created_by, original.created_by);
    assert_eq!(reloaded.status, "active");

    // The fields issue #7 is actually about. These previously did not survive,
    // because `persist_user` never wrote `user_profiles` at all.
    assert_eq!(
        reloaded.department, original.department,
        "H1: department must survive a restart"
    );
    assert_eq!(
        reloaded.specialty, original.specialty,
        "H1: specialty must survive a restart"
    );
    assert_eq!(
        reloaded.license_number, original.license_number,
        "H1: license_number must survive a restart"
    );

    // --- the field KNOWN not to survive, asserted rather than left implicit ---
    // HZ-014 forbids a write path to `user_profiles.phone` until it is
    // encrypted the way patient fields already are. Pinning it here means that
    // the day someone adds that write path, this fails and forces the
    // encryption question to be answered rather than skipped.
    assert_eq!(
        reloaded.phone, None,
        "phone must NOT round-trip: HZ-014 requires encryption before any write \
         path to user_profiles.phone. If this fails, confirm the value is \
         encrypted at rest before updating this assertion."
    );

    pool.close().await;
}

/// D-1, the security-relevant defect: `persist_user` previously wrote
/// `is_active = (status != "inactive")`, so a SUSPENDED account persisted as
/// active and returned **active** after a restart — silently reversing an
/// administrator access-control decision.
#[tokio::test]
async fn test_suspended_account_is_not_resurrected_as_active() {
    let pool = get_test_pool().await;
    let wallet = synthetic_wallet("bb02");

    let before = crate::AppState::new_with_pool(Some(pool.clone()));
    let mut suspended = complete_staff_user(&wallet);
    suspended.status = "suspended".to_string();
    before
        .persist_user(&suspended)
        .await
        .expect("persist_user failed");

    // The stored row must record the suspension, not a boolean that loses it.
    let (stored_status, stored_active): (String, bool) =
        sqlx::query_as("SELECT status, is_active FROM users WHERE wallet_address = $1")
            .bind(&wallet)
            .fetch_one(&pool)
            .await
            .expect("suspended user row missing");
    assert_eq!(stored_status, "suspended", "status must persist as itself");
    assert!(
        !stored_active,
        "a suspended account must not be stored as active — this is the D-1 defect"
    );

    // After a restart it must not be usable as an active account.
    let after = crate::AppState::new_with_pool(Some(pool.clone()));
    after.load_demo_users_from_db().await.expect("load failed");
    let reloaded = after.users.read().unwrap().get(&wallet).cloned();
    assert!(
        reloaded.as_ref().is_none_or(|u| u.status != "active"),
        "D-1: a suspended account came back ACTIVE after a restart"
    );

    pool.close().await;
}

/// A `pending` account — registered but not yet approved — must not be promoted
/// to active by a restart either. Same defect, different value.
#[tokio::test]
async fn test_pending_account_is_not_promoted_by_restart() {
    let pool = get_test_pool().await;
    let wallet = synthetic_wallet("cc03");

    let state = crate::AppState::new_with_pool(Some(pool.clone()));
    let mut pending = complete_staff_user(&wallet);
    pending.status = "pending".to_string();
    state.persist_user(&pending).await.expect("persist failed");

    let (stored_status, stored_active): (String, bool) =
        sqlx::query_as("SELECT status, is_active FROM users WHERE wallet_address = $1")
            .bind(&wallet)
            .fetch_one(&pool)
            .await
            .expect("pending user row missing");
    assert_eq!(stored_status, "pending");
    assert!(
        !stored_active,
        "a pending account must not be stored active"
    );

    pool.close().await;
}

/// Role revocation must keep `status` and `is_active` in step — the
/// `users_status_is_active_agree` constraint rejects a disagreeing row, so this
/// also proves `deactivate_user_in_db` was updated alongside the schema.
#[tokio::test]
async fn test_deactivate_keeps_status_and_is_active_consistent() {
    let pool = get_test_pool().await;
    let wallet = synthetic_wallet("dd04");

    let state = crate::AppState::new_with_pool(Some(pool.clone()));
    state
        .persist_user(&complete_staff_user(&wallet))
        .await
        .expect("persist failed");
    state
        .deactivate_user_in_db(&wallet)
        .await
        .expect("deactivate failed");

    let (status, is_active): (String, bool) =
        sqlx::query_as("SELECT status, is_active FROM users WHERE wallet_address = $1")
            .bind(&wallet)
            .fetch_one(&pool)
            .await
            .expect("row missing after deactivate");
    assert_eq!(status, "inactive");
    assert!(!is_active);

    pool.close().await;
}

/// An unrecognised in-memory status must coerce to `inactive`, never `active`:
/// a value this code cannot interpret must not grant access, and must not fail
/// the whole upsert against the CHECK constraint.
#[tokio::test]
async fn test_unknown_status_coerces_to_inactive_not_active() {
    let pool = get_test_pool().await;
    let wallet = synthetic_wallet("ee05");

    let state = crate::AppState::new_with_pool(Some(pool.clone()));
    let mut odd = complete_staff_user(&wallet);
    odd.status = "banana".to_string();
    state
        .persist_user(&odd)
        .await
        .expect("an unknown status must not fail the upsert");

    let (status, is_active): (String, bool) =
        sqlx::query_as("SELECT status, is_active FROM users WHERE wallet_address = $1")
            .bind(&wallet)
            .fetch_one(&pool)
            .await
            .expect("row missing");
    assert_eq!(status, "inactive", "unknown status must fail safe");
    assert!(!is_active);

    pool.close().await;
}

// =============================================================================
// Patient-controlled access requests and grants
//
// A consent decision is the patient exercising a legal right. These tests exist
// because the previous implementation kept grants in a process-lifetime map:
// every assertion below passed in-process and silently failed after a restart.
// =============================================================================

fn pg_patient_access(pool: &PgPool) -> crate::patient_access::PatientAccessService {
    use crate::repositories::postgres::PgPatientAccessRepository;
    crate::patient_access::PatientAccessService::new(std::sync::Arc::new(
        PgPatientAccessRepository::new(pool.clone()),
    ))
}

fn test_provider() -> crate::patient_access::RequestingProvider {
    crate::patient_access::RequestingProvider {
        provider_id: "5DoctorWallet".to_string(),
        provider_name: "Dr Synthetic".to_string(),
        provider_role: "Doctor".to_string(),
        organization: "Synthetic General Hospital".to_string(),
        reason: "Follow-up consultation".to_string(),
    }
}

async fn seed_emergency_grant_dependencies(
    pool: &PgPool,
    suffix: &str,
) -> (String, String, String) {
    let organization_id = format!("ORG-EG-{suffix}");
    let facility_id = format!("FAC-EG-{suffix}");
    let device_id = format!("DEV-EG-{suffix}");
    sqlx::query("INSERT INTO organizations (id, name, organization_type, status) VALUES ($1,$2,'hospital','active')")
        .bind(&organization_id)
        .bind(format!("Emergency Test Organization {suffix}"))
        .execute(pool).await.expect("seed emergency organization");
    sqlx::query("INSERT INTO facilities (id, organization_id, name, facility_type, status) VALUES ($1,$2,$3,'hospital','active')")
        .bind(&facility_id).bind(&organization_id).bind(format!("Emergency Test Facility {suffix}"))
        .execute(pool).await.expect("seed emergency facility");
    sqlx::query("INSERT INTO managed_devices (id, organization_id, facility_id, device_name, device_type, status, compliance_state) VALUES ($1,$2,$3,$4,'tablet','approved','compliant')")
        .bind(&device_id).bind(&organization_id).bind(&facility_id).bind(format!("Emergency Test Device {suffix}"))
        .execute(pool).await.expect("seed emergency device");
    (organization_id, facility_id, device_id)
}

#[tokio::test]
async fn test_pg_guardian_revocation_rolls_back_when_audit_outbox_insert_fails() {
    use crate::repositories::postgres::PgGuardianRelationshipRepository;
    use crate::repositories::traits::GuardianRelationshipRepository;

    let pool = get_test_pool().await;
    let relationship_id = format!("GR-AUDIT-{}", uuid::Uuid::new_v4());
    sqlx::query("INSERT INTO guardian_relationships (id, guardian_wallet, ward_patient_id, relationship_type, permissions, verified_by, verified_at, active) VALUES ($1,$2,$3,'parent_or_guardian',$4,$5,$6,TRUE)")
        .bind(&relationship_id)
        .bind("guardian-audit")
        .bind("ward-audit")
        .bind(vec!["view_records"])
        .bind("admin-audit")
        .bind(Utc::now())
        .execute(&pool)
        .await
        .expect("seed active guardian relationship");
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        "guardian_relationship_revoked".into(),
        "guardian_relationship".into(),
        relationship_id.clone(),
        serde_json::json!({"revoked_by":"admin-audit"}),
        Utc::now(),
    )
    .expect("prepare audit event");
    sqlx::query("INSERT INTO audit_outbox_events (id, event_type, aggregate_type, aggregate_id, payload_hash, payload, occurred_at, delivery_attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,0)")
        .bind(&event.id)
        .bind(&event.event_type)
        .bind(&event.aggregate_type)
        .bind(&event.aggregate_id)
        .bind(&event.payload_hash)
        .bind(&event.payload)
        .bind(event.occurred_at)
        .execute(&pool)
        .await
        .expect("reserve audit event ID");

    let repository = PgGuardianRelationshipRepository::new(pool.clone());
    assert!(repository
        .revoke_with_audit(&relationship_id, Some("ended".into()), event)
        .await
        .is_err());
    let active: bool =
        sqlx::query_scalar("SELECT active FROM guardian_relationships WHERE id = $1")
            .bind(&relationship_id)
            .fetch_one(&pool)
            .await
            .expect("read relationship");
    assert!(
        active,
        "delegated authority must remain active when audit insert fails"
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_guardian_creation_rolls_back_when_audit_outbox_insert_fails() {
    use crate::repositories::postgres::PgGuardianRelationshipRepository;
    use crate::repositories::traits::{GuardianRelationshipEntity, GuardianRelationshipRepository};

    let pool = get_test_pool().await;
    let relationship_id = format!("GR-AUDIT-{}", uuid::Uuid::new_v4());
    let relationship = GuardianRelationshipEntity {
        id: relationship_id.clone(),
        guardian_wallet: "guardian-audit".into(),
        ward_patient_id: "ward-audit".into(),
        relationship_type: "parent_or_guardian".into(),
        permissions: vec!["view_records".into()],
        verified_by: "admin-audit".into(),
        verified_at: Utc::now(),
        active: true,
        expires_at: None,
        revoked_at: None,
        revoked_reason: None,
        authority_evidence_type: None,
        authority_evidence_reference: None,
        authority_issuing_authority: None,
        authority_verified_by_role: None,
        authority_evidence_recorded_at: None,
        next_reverification_due: None,
        child_assent_status: None,
        child_assent_recorded_at: None,
        child_assent_notes: None,
        supersedes_relationship_id: None,
        dispute_flag: false,
        dispute_notes: None,
    };
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        "guardian_relationship_verified".into(),
        "guardian_relationship".into(),
        relationship_id.clone(),
        serde_json::json!({"verified_by":"admin-audit"}),
        Utc::now(),
    )
    .expect("prepare audit event");
    sqlx::query("INSERT INTO audit_outbox_events (id, event_type, aggregate_type, aggregate_id, payload_hash, payload, occurred_at, delivery_attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,0)")
        .bind(&event.id).bind(&event.event_type).bind(&event.aggregate_type).bind(&event.aggregate_id)
        .bind(&event.payload_hash).bind(&event.payload).bind(event.occurred_at).execute(&pool).await
        .expect("reserve audit event ID");

    let repository = PgGuardianRelationshipRepository::new(pool.clone());
    assert!(repository
        .create_with_audit(relationship, event)
        .await
        .is_err());
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM guardian_relationships WHERE id = $1")
            .bind(&relationship_id)
            .fetch_one(&pool)
            .await
            .expect("count relationships");
    assert_eq!(
        count, 0,
        "relationship creation must roll back with audit failure"
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_guardian_permission_update_rolls_back_when_audit_outbox_insert_fails() {
    use crate::repositories::postgres::PgGuardianRelationshipRepository;
    use crate::repositories::traits::GuardianRelationshipRepository;

    let pool = get_test_pool().await;
    let relationship_id = format!("GR-AUDIT-{}", uuid::Uuid::new_v4());
    sqlx::query("INSERT INTO guardian_relationships (id, guardian_wallet, ward_patient_id, relationship_type, permissions, verified_by, verified_at, active) VALUES ($1,$2,$3,'parent_or_guardian',$4,$5,$6,TRUE)")
        .bind(&relationship_id).bind("guardian-audit").bind("ward-audit")
        .bind(vec!["view_records"]).bind("admin-audit").bind(Utc::now())
        .execute(&pool).await.expect("seed guardian relationship");
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        "guardian_relationship_permissions_updated".into(),
        "guardian_relationship".into(),
        relationship_id.clone(),
        serde_json::json!({"updated_by":"admin-audit"}),
        Utc::now(),
    )
    .expect("prepare audit event");
    sqlx::query("INSERT INTO audit_outbox_events (id, event_type, aggregate_type, aggregate_id, payload_hash, payload, occurred_at, delivery_attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,0)")
        .bind(&event.id).bind(&event.event_type).bind(&event.aggregate_type).bind(&event.aggregate_id)
        .bind(&event.payload_hash).bind(&event.payload).bind(event.occurred_at).execute(&pool).await
        .expect("reserve audit event ID");

    let repository = PgGuardianRelationshipRepository::new(pool.clone());
    assert!(repository
        .update_permissions_with_audit(&relationship_id, vec!["give_consent".into()], None, event,)
        .await
        .is_err());
    let permissions: Vec<String> =
        sqlx::query_scalar("SELECT permissions FROM guardian_relationships WHERE id = $1")
            .bind(&relationship_id)
            .fetch_one(&pool)
            .await
            .expect("read permissions");
    assert_eq!(
        permissions,
        vec!["view_records"],
        "permission update must roll back with audit failure"
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_emergency_grant_survives_restart_and_enforces_bindings() {
    use crate::emergency_grants::{
        EmergencyGrantBinding, EmergencyGrantScope, EmergencyGrantStore,
    };

    let pool = get_test_pool().await;
    let suffix = uuid::Uuid::new_v4().to_string();
    let (organization_id, facility_id, device_id) =
        seed_emergency_grant_dependencies(&pool, &suffix).await;
    let now = Utc::now();
    let binding = EmergencyGrantBinding {
        patient_id: format!("PAT-EG-{suffix}"),
        person_id: format!("PERSON-EG-{suffix}"),
        organization_id,
        facility_id: Some(facility_id),
        device_id,
    };
    let writer = EmergencyGrantStore::with_pool(pool.clone());
    let grant = writer
        .issue(
            binding.clone(),
            "life_threatening".into(),
            None,
            vec![
                EmergencyGrantScope::EmergencySummary,
                EmergencyGrantScope::DownloadProhibited,
            ],
            now,
        )
        .await
        .expect("persist emergency grant");

    let restarted = EmergencyGrantStore::with_pool(pool.clone());
    let loaded = restarted
        .get(&grant.id)
        .await
        .expect("load grant")
        .expect("grant exists");
    assert_eq!(loaded.id, grant.id);
    assert_eq!(
        loaded.status,
        crate::emergency_grants::EmergencyGrantStatus::Active
    );
    restarted
        .validate(
            &grant.id,
            &binding,
            EmergencyGrantScope::EmergencySummary,
            now,
        )
        .await
        .expect("validate persisted grant");
    let revoked = restarted
        .revoke(&grant.id, "completed handover".into(), now)
        .await
        .expect("revoke persisted grant");
    assert_eq!(
        revoked.status,
        crate::emergency_grants::EmergencyGrantStatus::Revoked
    );
    assert_eq!(
        restarted
            .validate(
                &grant.id,
                &binding,
                EmergencyGrantScope::EmergencySummary,
                now
            )
            .await
            .unwrap_err(),
        "Emergency grant has been revoked"
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_emergency_grant_and_audit_commit_together() {
    use crate::emergency_grants::{
        EmergencyGrantBinding, EmergencyGrantScope, EmergencyGrantStore,
    };

    let pool = get_test_pool().await;
    let suffix = uuid::Uuid::new_v4().to_string();
    let (organization_id, facility_id, device_id) =
        seed_emergency_grant_dependencies(&pool, &suffix).await;
    let store = EmergencyGrantStore::with_pool(pool.clone());
    let (grant, event) = store
        .issue_with_audit(
            EmergencyGrantBinding {
                patient_id: format!("PAT-EG-{suffix}"),
                person_id: format!("PERSON-EG-{suffix}"),
                organization_id,
                facility_id: Some(facility_id),
                device_id,
            },
            "life_threatening".into(),
            None,
            vec![EmergencyGrantScope::EmergencySummary],
            "emergency_grant_issued".into(),
            serde_json::json!({"test": true}),
            Utc::now(),
        )
        .await
        .expect("grant and audit must commit");
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_outbox_events WHERE id = $1 AND aggregate_id = $2",
    )
    .bind(&event.id)
    .bind(&grant.id)
    .fetch_one(&pool)
    .await
    .expect("read audit event");
    assert_eq!(
        count, 1,
        "committed grant must have its durable audit event"
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_emergency_grant_rolls_back_when_audit_insert_fails() {
    use crate::emergency_grants::{
        EmergencyGrantBinding, EmergencyGrantScope, EmergencyGrantStore,
    };

    let pool = get_test_pool().await;
    sqlx::query("CREATE FUNCTION reject_emergency_grant_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END; $$")
        .execute(&pool).await.expect("install isolated audit failure function");
    sqlx::query("CREATE TRIGGER reject_emergency_grant_audit BEFORE INSERT ON audit_outbox_events FOR EACH ROW EXECUTE FUNCTION reject_emergency_grant_audit()")
        .execute(&pool).await.expect("install isolated audit failure trigger");
    let suffix = uuid::Uuid::new_v4().to_string();
    let (organization_id, facility_id, device_id) =
        seed_emergency_grant_dependencies(&pool, &suffix).await;
    let patient_id = format!("PAT-EG-{suffix}");
    let store = EmergencyGrantStore::with_pool(pool.clone());
    assert!(store
        .issue_with_audit(
            EmergencyGrantBinding {
                patient_id: patient_id.clone(),
                person_id: format!("PERSON-EG-{suffix}"),
                organization_id,
                facility_id: Some(facility_id),
                device_id
            },
            "life_threatening".into(),
            None,
            vec![EmergencyGrantScope::EmergencySummary],
            "emergency_grant_issued".into(),
            serde_json::json!({"test": true}),
            Utc::now(),
        )
        .await
        .is_err());
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM emergency_access_grants WHERE patient_id = $1")
            .bind(&patient_id)
            .fetch_one(&pool)
            .await
            .expect("count grants after failed transaction");
    assert_eq!(
        count, 0,
        "grant must roll back when mandatory audit persistence fails"
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_emergency_grant_revocation_rolls_back_when_audit_insert_fails() {
    use crate::emergency_grants::{
        EmergencyGrantBinding, EmergencyGrantScope, EmergencyGrantStatus, EmergencyGrantStore,
    };

    let pool = get_test_pool().await;
    let suffix = uuid::Uuid::new_v4().to_string();
    let (organization_id, facility_id, device_id) =
        seed_emergency_grant_dependencies(&pool, &suffix).await;
    let store = EmergencyGrantStore::with_pool(pool.clone());
    let grant = store
        .issue(
            EmergencyGrantBinding {
                patient_id: format!("PAT-EG-{suffix}"),
                person_id: format!("PERSON-EG-{suffix}"),
                organization_id,
                facility_id: Some(facility_id),
                device_id,
            },
            "life_threatening".into(),
            None,
            vec![EmergencyGrantScope::EmergencySummary],
            Utc::now(),
        )
        .await
        .expect("seed active grant");
    sqlx::query("CREATE FUNCTION reject_emergency_grant_revoke_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END; $$")
        .execute(&pool).await.expect("install isolated audit failure function");
    sqlx::query("CREATE TRIGGER reject_emergency_grant_revoke_audit BEFORE INSERT ON audit_outbox_events FOR EACH ROW EXECUTE FUNCTION reject_emergency_grant_revoke_audit()")
        .execute(&pool).await.expect("install isolated audit failure trigger");
    assert!(store
        .revoke_with_audit(
            &grant.id,
            "handover complete".into(),
            "emergency_grant_revoked".into(),
            serde_json::json!({"test": true}),
            Utc::now(),
        )
        .await
        .is_err());
    let status: String =
        sqlx::query_scalar("SELECT status FROM emergency_access_grants WHERE id = $1")
            .bind(&grant.id)
            .fetch_one(&pool)
            .await
            .expect("read grant after failed transaction");
    assert_eq!(
        status, "active",
        "grant must remain active when mandatory revocation audit fails"
    );
    assert_eq!(
        store
            .get(&grant.id)
            .await
            .expect("load grant")
            .expect("grant exists")
            .status,
        EmergencyGrantStatus::Active
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_identity_claim_rolls_back_when_audit_insert_fails() {
    let pool = get_test_pool().await;
    let wallet = format!("PAT-claim-{}", uuid::Uuid::new_v4());
    let patient_id = format!("claim-patient-{}", uuid::Uuid::new_v4());
    sqlx::query("INSERT INTO users (wallet_address, role, name, username, email, is_active, status, created_at) VALUES ($1,'Patient',$2,$3,$4,TRUE,'active',NOW())")
        .bind(&wallet).bind("Claim Test").bind(&wallet).bind(format!("{wallet}@example.test"))
        .execute(&pool).await.expect("seed claim user");
    sqlx::query("CREATE FUNCTION reject_identity_claim_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END; $$")
        .execute(&pool).await.expect("install audit failure function");
    sqlx::query("CREATE TRIGGER reject_identity_claim_audit BEFORE INSERT ON audit_outbox_events FOR EACH ROW EXECUTE FUNCTION reject_identity_claim_audit()")
        .execute(&pool).await.expect("install audit failure trigger");
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        "medical_identity_claimed".into(),
        "patient".into(),
        patient_id.clone(),
        serde_json::json!({"claimed_by": wallet}),
        Utc::now(),
    )
    .expect("prepare event");
    let mut transaction = pool.begin().await.expect("begin transaction");
    assert!(
        crate::link_user_with_audit(&mut transaction, &wallet, &patient_id, &event,)
            .await
            .is_err()
    );
    drop(transaction);
    let linked: Option<String> =
        sqlx::query_scalar("SELECT linked_patient_id FROM users WHERE wallet_address = $1")
            .bind(&wallet)
            .fetch_one(&pool)
            .await
            .expect("read claim user");
    assert_eq!(
        linked, None,
        "identity link must roll back when required audit persistence fails"
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_mobile_device_authority_survives_restart_and_revocation() {
    use crate::mobile_records::{MobileDeviceStatus, MobilePlatform, MobileRecordStore};

    let pool = get_test_pool().await;
    let patient_id = format!("PAT-mobile-{}", uuid::Uuid::new_v4());
    let first = MobileRecordStore::with_pool(pool.clone());
    let device = first
        .register_device_durable(
            patient_id.clone(),
            "Audit phone".into(),
            MobilePlatform::Android,
            "public-key".into(),
        )
        .await
        .expect("persist mobile device");
    let restarted = MobileRecordStore::with_pool(pool.clone());
    assert_eq!(
        restarted
            .get_device_durable(&device.id)
            .await
            .expect("load device")
            .expect("device exists")
            .patient_id,
        patient_id
    );
    let session = restarted
        .authorise_record_durable(
            &patient_id,
            &device.id,
            "record-1".into(),
            "ciphertext://record-1".into(),
            None,
            Utc::now(),
        )
        .await
        .expect("persist protected session");
    let session_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM protected_mobile_record_sessions WHERE id = $1")
            .bind(&session.id)
            .fetch_one(&pool)
            .await
            .expect("read protected session");
    assert_eq!(session_count, 1);
    restarted
        .revoke_device_durable(&device.id, "phone lost".into(), Utc::now())
        .await
        .expect("revoke device");
    let after_restart = MobileRecordStore::with_pool(pool.clone());
    assert_eq!(
        after_restart
            .get_device_durable(&device.id)
            .await
            .expect("reload device")
            .expect("device exists")
            .status,
        MobileDeviceStatus::Revoked
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_access_request_rolls_back_when_audit_outbox_insert_fails() {
    let pool = get_test_pool().await;
    let now = Utc::now();
    let request_id = format!("REQ-AUDIT-{}", uuid::Uuid::new_v4());
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        "access_request_created".into(),
        "access_request".into(),
        request_id.clone(),
        serde_json::json!({"provider_id": "5DoctorWallet"}),
        now,
    )
    .expect("valid audit event");

    // Reserve the event ID. The transactional method must then reject its
    // duplicate outbox insert and roll back the preceding request insert.
    sqlx::query("INSERT INTO audit_outbox_events (id, event_type, aggregate_type, aggregate_id, payload_hash, payload, occurred_at, delivery_attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,0)")
        .bind(&event.id)
        .bind(&event.event_type)
        .bind(&event.aggregate_type)
        .bind(&event.aggregate_id)
        .bind(&event.payload_hash)
        .bind(&event.payload)
        .bind(event.occurred_at)
        .execute(&pool)
        .await
        .expect("reserve audit event ID");

    let result = pg_patient_access(&pool)
        .create_request_with_audit(
            format!("PAT-AUDIT-{}", uuid::Uuid::new_v4()),
            test_provider(),
            event,
            now,
        )
        .await;
    assert!(
        result.is_err(),
        "duplicate audit event must fail the mutation"
    );

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM patient_access_requests WHERE id = $1")
            .bind(&request_id)
            .fetch_one(&pool)
            .await
            .expect("count access requests");
    assert_eq!(
        count, 0,
        "business insert must roll back with audit failure"
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_access_approval_rolls_back_when_audit_outbox_insert_fails() {
    use crate::patient_access::AccessType;

    let pool = get_test_pool().await;
    let now = Utc::now();
    let service = pg_patient_access(&pool);
    let request = service
        .create_request(
            format!("PAT-AUDIT-{}", uuid::Uuid::new_v4()),
            test_provider(),
            now,
        )
        .await
        .expect("create pending request");
    let grant_id = format!("GRANT-AUDIT-{}", uuid::Uuid::new_v4());
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        "access_request_approved".into(),
        "access_grant".into(),
        grant_id.clone(),
        serde_json::json!({"request_id": request.id, "provider_id": request.provider_id}),
        now,
    )
    .expect("valid audit event");
    sqlx::query("INSERT INTO audit_outbox_events (id, event_type, aggregate_type, aggregate_id, payload_hash, payload, occurred_at, delivery_attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,0)")
        .bind(&event.id)
        .bind(&event.event_type)
        .bind(&event.aggregate_type)
        .bind(&event.aggregate_id)
        .bind(&event.payload_hash)
        .bind(&event.payload)
        .bind(event.occurred_at)
        .execute(&pool)
        .await
        .expect("reserve audit event ID");

    assert!(
        service
            .approve_request_with_audit(&request.id, AccessType::Limited, None, event, now)
            .await
            .is_err(),
        "duplicate audit event must fail the approval"
    );
    let status: String =
        sqlx::query_scalar("SELECT status FROM patient_access_requests WHERE id = $1")
            .bind(&request.id)
            .fetch_one(&pool)
            .await
            .expect("read request status");
    let grant_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM patient_access_grants WHERE id = $1")
            .bind(&grant_id)
            .fetch_one(&pool)
            .await
            .expect("count grants");
    assert_eq!(
        status, "pending",
        "approval must roll back with audit failure"
    );
    assert_eq!(
        grant_count, 0,
        "grant insert must roll back with audit failure"
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_access_approval_with_audit_commits_grant_and_event() {
    use crate::patient_access::AccessType;

    let pool = get_test_pool().await;
    let now = Utc::now();
    let service = pg_patient_access(&pool);
    let request = service
        .create_request(
            format!("PAT-AUDIT-{}", uuid::Uuid::new_v4()),
            test_provider(),
            now,
        )
        .await
        .expect("create pending request");
    let grant_id = format!("GRANT-AUDIT-{}", uuid::Uuid::new_v4());
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        "access_request_approved".into(),
        "access_grant".into(),
        grant_id.clone(),
        serde_json::json!({"request_id": request.id, "provider_id": request.provider_id}),
        now,
    )
    .expect("valid audit event");
    let event_id = event.id.clone();

    let (approved, grant) = service
        .approve_request_with_audit(&request.id, AccessType::Limited, None, event, now)
        .await
        .expect("approve with audit");
    assert_eq!(approved.status, "approved");
    assert_eq!(grant.id, grant_id);
    let event_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM audit_outbox_events WHERE id = $1")
            .bind(&event_id)
            .fetch_one(&pool)
            .await
            .expect("count audit events");
    assert_eq!(event_count, 1, "approval must commit its audit event");
    pool.close().await;
}

#[tokio::test]
async fn test_pg_access_denial_rolls_back_when_audit_outbox_insert_fails() {
    let pool = get_test_pool().await;
    let now = Utc::now();
    let service = pg_patient_access(&pool);
    let request = service
        .create_request(
            format!("PAT-AUDIT-{}", uuid::Uuid::new_v4()),
            test_provider(),
            now,
        )
        .await
        .expect("create pending request");
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        "access_request_denied".into(),
        "access_request".into(),
        request.id.clone(),
        serde_json::json!({"provider_id": request.provider_id}),
        now,
    )
    .expect("valid audit event");
    sqlx::query("INSERT INTO audit_outbox_events (id, event_type, aggregate_type, aggregate_id, payload_hash, payload, occurred_at, delivery_attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,0)")
        .bind(&event.id)
        .bind(&event.event_type)
        .bind(&event.aggregate_type)
        .bind(&event.aggregate_id)
        .bind(&event.payload_hash)
        .bind(&event.payload)
        .bind(event.occurred_at)
        .execute(&pool)
        .await
        .expect("reserve audit event ID");

    assert!(
        service
            .deny_request_with_audit(&request.id, event)
            .await
            .is_err(),
        "duplicate audit event must fail the denial"
    );
    let status: String =
        sqlx::query_scalar("SELECT status FROM patient_access_requests WHERE id = $1")
            .bind(&request.id)
            .fetch_one(&pool)
            .await
            .expect("read request status");
    assert_eq!(
        status, "pending",
        "denial must roll back with audit failure"
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_access_denial_with_audit_commits_request_and_event() {
    let pool = get_test_pool().await;
    let now = Utc::now();
    let service = pg_patient_access(&pool);
    let request = service
        .create_request(
            format!("PAT-AUDIT-{}", uuid::Uuid::new_v4()),
            test_provider(),
            now,
        )
        .await
        .expect("create pending request");
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        "access_request_denied".into(),
        "access_request".into(),
        request.id.clone(),
        serde_json::json!({"provider_id": request.provider_id}),
        now,
    )
    .expect("valid audit event");
    let event_id = event.id.clone();

    let denied = service
        .deny_request_with_audit(&request.id, event)
        .await
        .expect("deny with audit");
    assert_eq!(denied.status, "denied");
    let event_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM audit_outbox_events WHERE id = $1")
            .bind(&event_id)
            .fetch_one(&pool)
            .await
            .expect("count audit events");
    assert_eq!(event_count, 1, "denial must commit its audit event");
    pool.close().await;
}

#[tokio::test]
async fn test_pg_access_revocation_rolls_back_when_audit_outbox_insert_fails() {
    use crate::patient_access::AccessType;

    let pool = get_test_pool().await;
    let now = Utc::now();
    let service = pg_patient_access(&pool);
    let request = service
        .create_request(
            format!("PAT-AUDIT-{}", uuid::Uuid::new_v4()),
            test_provider(),
            now,
        )
        .await
        .expect("create pending request");
    let (_, grant) = service
        .approve_request(&request.id, AccessType::Limited, None, now)
        .await
        .expect("create active grant");
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        "access_grant_revoked".into(),
        "access_grant".into(),
        grant.id.clone(),
        serde_json::json!({"provider_id": grant.provider_id}),
        now,
    )
    .expect("valid audit event");
    sqlx::query("INSERT INTO audit_outbox_events (id, event_type, aggregate_type, aggregate_id, payload_hash, payload, occurred_at, delivery_attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,0)")
        .bind(&event.id)
        .bind(&event.event_type)
        .bind(&event.aggregate_type)
        .bind(&event.aggregate_id)
        .bind(&event.payload_hash)
        .bind(&event.payload)
        .bind(event.occurred_at)
        .execute(&pool)
        .await
        .expect("reserve audit event ID");

    assert!(
        service
            .revoke_grant_with_audit(&grant.id, now, event)
            .await
            .is_err(),
        "duplicate audit event must fail the revocation"
    );
    let status: String =
        sqlx::query_scalar("SELECT status FROM patient_access_grants WHERE id = $1")
            .bind(&grant.id)
            .fetch_one(&pool)
            .await
            .expect("read grant status");
    assert_eq!(
        status, "active",
        "revocation must roll back with audit failure"
    );
    pool.close().await;
}

#[tokio::test]
async fn test_pg_access_revocation_with_audit_commits_grant_and_event() {
    use crate::patient_access::AccessType;

    let pool = get_test_pool().await;
    let now = Utc::now();
    let service = pg_patient_access(&pool);
    let request = service
        .create_request(
            format!("PAT-AUDIT-{}", uuid::Uuid::new_v4()),
            test_provider(),
            now,
        )
        .await
        .expect("create pending request");
    let (_, grant) = service
        .approve_request(&request.id, AccessType::Limited, None, now)
        .await
        .expect("create active grant");
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        "access_grant_revoked".into(),
        "access_grant".into(),
        grant.id.clone(),
        serde_json::json!({"provider_id": grant.provider_id}),
        now,
    )
    .expect("valid audit event");
    let event_id = event.id.clone();

    let revoked = service
        .revoke_grant_with_audit(&grant.id, now, event)
        .await
        .expect("revoke with audit");
    assert_eq!(revoked.status, "revoked");
    let event_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM audit_outbox_events WHERE id = $1")
            .bind(&event_id)
            .fetch_one(&pool)
            .await
            .expect("count audit events");
    assert_eq!(event_count, 1, "revocation must commit its audit event");
    pool.close().await;
}

#[tokio::test]
async fn test_pg_patient_access_grant_survives_restart() {
    use crate::patient_access::AccessType;

    let pool = get_test_pool().await;
    let patient_id = format!("PAT-ACC-{}", Utc::now().timestamp_millis());
    let now = Utc::now();

    // Write through the first service instance.
    let writer = pg_patient_access(&pool);
    let request = writer
        .create_request(patient_id.clone(), test_provider(), now)
        .await
        .expect("create_request failed");
    let (_, grant) = writer
        .approve_request(&request.id, AccessType::Limited, None, now)
        .await
        .expect("approve_request failed");

    // Simulate a restart: a brand-new service over the same database.
    let reader = pg_patient_access(&pool);
    let grants = reader
        .list_grants_by_patient(&patient_id, now)
        .await
        .expect("grant lost on restart");
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].id, grant.id);
    assert_eq!(grants[0].status, "active");
    assert_eq!(grants[0].provider_name, "Dr Synthetic");
    assert_eq!(grants[0].access_type, "limited");
    assert_eq!(
        grants[0].source_request_id.as_deref(),
        Some(request.id.as_str()),
        "the grant must record the request it was minted from"
    );

    let requests = reader
        .list_requests_by_patient(&patient_id)
        .await
        .expect("request lost on restart");
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].status, "approved");

    pool.close().await;
}

/// The failure this guards against is the one that matters most: a patient
/// revokes access, the process restarts, and the provider is quietly allowed
/// back in.
#[tokio::test]
async fn test_pg_revocation_survives_restart() {
    use crate::patient_access::AccessType;

    let pool = get_test_pool().await;
    let patient_id = format!("PAT-REV-{}", Utc::now().timestamp_millis());
    let now = Utc::now();

    let writer = pg_patient_access(&pool);
    let request = writer
        .create_request(patient_id.clone(), test_provider(), now)
        .await
        .expect("create_request failed");
    let (_, grant) = writer
        .approve_request(&request.id, AccessType::Full, None, now)
        .await
        .expect("approve_request failed");
    writer
        .revoke_grant(&grant.id, now)
        .await
        .expect("revoke_grant failed");

    let reader = pg_patient_access(&pool);
    let stored = reader
        .get_grant(&grant.id)
        .await
        .expect("lookup failed")
        .expect("grant lost on restart");
    assert_eq!(
        stored.status, "revoked",
        "a revoked grant must stay revoked across a restart"
    );
    assert!(!stored.is_effective(now));

    // And revoking again is still refused after the restart.
    assert_eq!(
        reader.revoke_grant(&grant.id, now).await.unwrap_err(),
        "Access grant is not active"
    );

    pool.close().await;
}

/// Two approvals of one request must mint exactly one grant. In-process this
/// was guaranteed by holding a write lock; here it is the conditional UPDATE
/// plus the unique index on `source_request_id`.
#[tokio::test]
async fn test_pg_approve_is_not_replayable() {
    use crate::patient_access::AccessType;

    let pool = get_test_pool().await;
    let patient_id = format!("PAT-DUP-{}", Utc::now().timestamp_millis());
    let now = Utc::now();

    let svc = pg_patient_access(&pool);
    let request = svc
        .create_request(patient_id.clone(), test_provider(), now)
        .await
        .expect("create_request failed");
    svc.approve_request(&request.id, AccessType::Limited, None, now)
        .await
        .expect("first approve failed");

    assert_eq!(
        svc.approve_request(&request.id, AccessType::Limited, None, now)
            .await
            .unwrap_err(),
        "Access request has already been decided"
    );

    let grants = svc
        .list_grants_by_patient(&patient_id, now)
        .await
        .expect("list failed");
    assert_eq!(grants.len(), 1, "a replayed approval minted a second grant");

    pool.close().await;
}

/// A denied request stays denied, and never mints a grant.
#[tokio::test]
async fn test_pg_denial_survives_restart() {
    use crate::patient_access::AccessType;

    let pool = get_test_pool().await;
    let patient_id = format!("PAT-DENY-{}", Utc::now().timestamp_millis());
    let now = Utc::now();

    let writer = pg_patient_access(&pool);
    let request = writer
        .create_request(patient_id.clone(), test_provider(), now)
        .await
        .expect("create_request failed");
    writer
        .deny_request(&request.id)
        .await
        .expect("deny_request failed");

    let reader = pg_patient_access(&pool);
    let requests = reader
        .list_requests_by_patient(&patient_id)
        .await
        .expect("request lost on restart");
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].status, "denied");
    assert!(reader
        .list_grants_by_patient(&patient_id, now)
        .await
        .expect("list failed")
        .is_empty());

    // A denied request cannot later be approved, even by a fresh process.
    assert_eq!(
        reader
            .approve_request(&request.id, AccessType::Limited, None, now)
            .await
            .unwrap_err(),
        "Access request has already been decided"
    );

    pool.close().await;
}

/// Expiry is persisted on read, and a lapsed grant cannot be "revoked" —
/// reporting success would tell the patient they had withdrawn access that had
/// already ended on its own.
#[tokio::test]
async fn test_pg_expiry_is_applied_and_lapsed_grants_are_not_revocable() {
    use crate::patient_access::AccessType;

    let pool = get_test_pool().await;
    let patient_id = format!("PAT-EXP-{}", Utc::now().timestamp_millis());
    let now = Utc::now();

    let svc = pg_patient_access(&pool);
    let request = svc
        .create_request(patient_id.clone(), test_provider(), now)
        .await
        .expect("create_request failed");
    let (_, grant) = svc
        .approve_request(
            &request.id,
            AccessType::Limited,
            Some(now + chrono::Duration::hours(1)),
            now,
        )
        .await
        .expect("approve_request failed");

    let later = now + chrono::Duration::hours(2);
    let grants = svc
        .list_grants_by_patient(&patient_id, later)
        .await
        .expect("list failed");
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].status, "expired");

    // The sweep is persisted, not computed per caller.
    let fresh = pg_patient_access(&pool);
    let stored = fresh
        .get_grant(&grant.id)
        .await
        .expect("lookup failed")
        .expect("grant missing");
    assert_eq!(stored.status, "expired");

    assert_eq!(
        fresh.revoke_grant(&grant.id, later).await.unwrap_err(),
        "Access grant is not active"
    );

    pool.close().await;
}

// =============================================================================
// Peri-operative documentation
// =============================================================================

/// The assessment must come back whole, not just present.
///
/// Before migration 20260810000001 the entity's payload field was
/// `#[sqlx(skip)]` — written nowhere, read nowhere — so this round trip would
/// have succeeded in the memory backend and returned an assessment with its
/// WHO Surgical Safety Checklist fields silently reset against PostgreSQL.
/// `site_verified` and `site_marked` are asserted explicitly for that reason:
/// they are the wrong-site-surgery safeguards.
#[tokio::test]
async fn test_pg_pre_op_assessment_survives_restart_with_checklist_intact() {
    use crate::clinical::{ASAClassification, MallampatiScore, NPOStatus, PreOperativeAssessment};
    use crate::repositories::postgres::PgPreOpAssessmentRepository;
    use crate::repositories::traits::{PreOpAssessmentEntity, PreOpAssessmentRepository};

    let pool = get_test_pool().await;

    // pre_op_assessments.patient_id is a foreign key to patients(id).
    let patient_id = format!("TEST-PAT-PREOP-{}", Utc::now().timestamp_millis());
    PgPatientRepository::new(pool.clone())
        .create(create_test_patient(&patient_id))
        .await
        .expect("failed to create the patient the assessment hangs off");

    let id = format!("PREOP-{}", Utc::now().timestamp_millis());
    let assessment = PreOperativeAssessment {
        assessment_id: id.clone(),
        patient_id: patient_id.clone(),
        scheduled_procedure: "Left inguinal hernia repair".to_string(),
        procedure_datetime: "2026-08-12T09:00:00Z".to_string(),
        surgeon: "5SurgeonWallet".to_string(),
        anesthesiologist: Some("5AnaesthetistWallet".to_string()),
        npo_status: NPOStatus {
            last_solid: Some("2026-08-11T20:00:00Z".to_string()),
            last_liquid: Some("2026-08-12T05:00:00Z".to_string()),
            npo_since: Some(1_754_985_600),
            compliant: true,
        },
        // The two fields this test exists for.
        site_verified: true,
        site_marked: true,
        consent_signed: true,
        blood_type_confirmed: true,
        blood_available: true,
        allergies_reviewed: true,
        medications_reviewed: true,
        medications_held: vec!["warfarin".to_string(), "metformin".to_string()],
        labs_reviewed: true,
        imaging_reviewed: true,
        asa_class: ASAClassification::ASA3,
        airway_assessment: MallampatiScore::Class2,
        cardiac_risk: Some("RCRI 1".to_string()),
        dvt_prophylaxis: true,
        antibiotic_prophylaxis: Some("cefazolin 2g".to_string()),
        special_equipment: vec!["laparoscopic tower".to_string()],
        pre_op_vitals: "BP 128/76, HR 72, SpO2 98%".to_string(),
        iv_access: true,
        checklist_complete: true,
        notes: Some("Patient counselled; consent witnessed.".to_string()),
        assessed_by: "5SurgeonWallet".to_string(),
        assessed_at: 1_754_982_000,
    };

    // Write through the first repository instance.
    let writer = PgPreOpAssessmentRepository::new(pool.clone());
    let entity: PreOpAssessmentEntity = assessment.clone().into();
    writer.create(entity).await.expect("create failed");

    // Simulate a restart: a brand-new repository over the same database.
    let reader = PgPreOpAssessmentRepository::new(pool.clone());
    let stored = reader
        .get_by_id(&id)
        .await
        .expect("assessment lost on restart");

    // The typed projection is queryable...
    assert_eq!(stored.patient_id, patient_id);
    assert_eq!(stored.procedure_name, "Left inguinal hernia repair");
    assert_eq!(stored.surgeon_id, "5SurgeonWallet");
    assert_eq!(stored.asa_classification.as_deref(), Some("III"));
    assert_eq!(stored.mallampati_score, Some(2));
    assert_eq!(stored.npo_status.as_deref(), Some("compliant"));

    // ...and the payload round-trips whole.
    let back =
        PreOperativeAssessment::try_from(stored).expect("stored payload could not be read back");
    assert!(back.site_verified, "surgical site verification was lost");
    assert!(back.site_marked, "surgical site marking was lost");
    assert!(back.checklist_complete);
    assert!(back.blood_available);
    assert!(back.iv_access);
    assert!(back.dvt_prophylaxis);
    assert_eq!(back.medications_held, vec!["warfarin", "metformin"]);
    assert_eq!(back.special_equipment, vec!["laparoscopic tower"]);
    assert_eq!(back.antibiotic_prophylaxis.as_deref(), Some("cefazolin 2g"));
    assert_eq!(back.cardiac_risk.as_deref(), Some("RCRI 1"));
    assert_eq!(back.pre_op_vitals, "BP 128/76, HR 72, SpO2 98%");
    assert!(back.npo_status.compliant);
    assert_eq!(back.assessed_at, 1_754_982_000);

    // And it is listed for the patient.
    let page = reader
        .get_by_patient(&patient_id, Pagination::new(0, 10))
        .await
        .expect("get_by_patient failed");
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, id);

    pool.close().await;
}

/// An operative note must come back whole, not just present.
///
/// The typed columns carry a lossy projection — diagnoses are joined into one
/// text field, the team is split across `surgeon_id`/`assistant_surgeons` — so
/// the assertions below deliberately check the *reconstructed* API type, not
/// just the row. Implant lot/serial numbers are asserted explicitly: they are
/// the recall-traceability fields.
#[tokio::test]
async fn test_pg_operative_note_survives_restart_with_implants_intact() {
    use crate::clinical::{
        AnesthesiaType, OperativeNote, SurgicalDrain, SurgicalImplant, SurgicalRole,
        SurgicalSpecimen, SurgicalTeamMember,
    };
    use crate::repositories::postgres::PgOperativeNoteRepository;
    use crate::repositories::traits::{OperativeNoteEntity, OperativeNoteRepository};

    let pool = get_test_pool().await;

    let patient_id = format!("TEST-PAT-OPNOTE-{}", Utc::now().timestamp_millis());
    PgPatientRepository::new(pool.clone())
        .create(create_test_patient(&patient_id))
        .await
        .expect("failed to create the patient the note hangs off");

    let id = format!("OPNOTE-{}", Utc::now().timestamp_millis());
    let note = OperativeNote {
        note_id: id.clone(),
        patient_id: patient_id.clone(),
        surgery_date: "2026-08-12".to_string(),
        pre_op_diagnosis: vec![
            "Cholelithiasis".to_string(),
            "Chronic cholecystitis".to_string(),
        ],
        post_op_diagnosis: vec!["Acute on chronic cholecystitis".to_string()],
        procedure_performed: "Laparoscopic cholecystectomy".to_string(),
        cpt_codes: vec!["47562".to_string()],
        surgeons: vec![
            SurgicalTeamMember {
                name: "Dr Mokoena".to_string(),
                role: SurgicalRole::PrimarySurgeon,
                npi: Some("1234567890".to_string()),
            },
            SurgicalTeamMember {
                name: "Dr Naidoo".to_string(),
                role: SurgicalRole::Assistant,
                npi: None,
            },
        ],
        anesthesia_team: vec!["Dr Abrahams".to_string()],
        anesthesia_type: AnesthesiaType::General,
        surgical_approach: "Laparoscopic, four-port".to_string(),
        incision: "Umbilical 12mm, epigastric 5mm, two right subcostal 5mm".to_string(),
        findings: "Distended gallbladder with adhesions to omentum.".to_string(),
        procedure_details: "Critical view of safety obtained before clipping.".to_string(),
        specimens: vec![SurgicalSpecimen {
            specimen_id: "SPEC-1".to_string(),
            description: "Gallbladder".to_string(),
            sent_to_pathology: true,
            pathology_accession: Some("PATH-2026-5541".to_string()),
        }],
        estimated_blood_loss: 25,
        fluids_given: "1200 mL crystalloid".to_string(),
        blood_products: vec![],
        drains: vec![SurgicalDrain {
            drain_type: "Jackson-Pratt".to_string(),
            location: "Gallbladder fossa".to_string(),
            size: Some("10 Fr".to_string()),
        }],
        // The recall-traceability fields this test exists for.
        implants: vec![SurgicalImplant {
            implant_type: "Titanium clip".to_string(),
            manufacturer: "Acme Surgical".to_string(),
            lot_number: "LOT-88213".to_string(),
            serial_number: Some("SN-0099".to_string()),
            location: "Cystic duct".to_string(),
        }],
        wound_closure: "3-0 Monocryl subcuticular".to_string(),
        dressing: "Steri-Strips and dry dressing".to_string(),
        complications: None,
        condition_at_end: "Stable".to_string(),
        disposition: "PACU".to_string(),
        time_in_or: 1_754_985_000,
        time_out_or: 1_754_991_300,
        dictated_by: "Dr Mokoena".to_string(),
        dictation_time: 1_754_991_900,
    };

    let writer = PgOperativeNoteRepository::new(pool.clone());
    let entity: OperativeNoteEntity = note.clone().into();
    writer.create(entity).await.expect("create failed");

    // Simulate a restart: a brand-new repository over the same database.
    let reader = PgOperativeNoteRepository::new(pool.clone());
    let stored = reader
        .get_by_id(&id)
        .await
        .expect("operative note lost on restart");

    assert_eq!(stored.patient_id, patient_id);
    assert_eq!(stored.procedure_name, "Laparoscopic cholecystectomy");
    assert_eq!(stored.surgeon_id, "Dr Mokoena");

    let back = OperativeNote::try_from(stored).expect("stored payload could not be read back");
    assert_eq!(back.implants.len(), 1, "implant record was lost");
    assert_eq!(back.implants[0].lot_number, "LOT-88213");
    assert_eq!(back.implants[0].serial_number.as_deref(), Some("SN-0099"));
    assert_eq!(
        back.pre_op_diagnosis.len(),
        2,
        "diagnosis list was flattened"
    );
    assert_eq!(
        back.specimens[0].pathology_accession.as_deref(),
        Some("PATH-2026-5541")
    );
    assert_eq!(back.drains[0].drain_type, "Jackson-Pratt");
    assert_eq!(back.estimated_blood_loss, 25);
    assert_eq!(back.surgeons.len(), 2);
    assert_eq!(back.dictation_time, 1_754_991_900);

    let page = reader
        .get_by_patient(&patient_id, Pagination::new(0, 10))
        .await
        .expect("get_by_patient failed");
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, id);

    pool.close().await;
}

/// A post-operative note must survive a restart with its wound assessment and
/// pain score intact — `post_op_day` and `pain_score` are `u16`/`u8`, which
/// have no native PostgreSQL column type and so round-trip through the payload.
#[tokio::test]
async fn test_pg_post_op_note_survives_restart_with_wound_assessment_intact() {
    use crate::clinical::{PostOperativeNote, WoundStatus};
    use crate::repositories::postgres::PgPostOpNoteRepository;
    use crate::repositories::traits::{PostOpNoteEntity, PostOpNoteRepository};

    let pool = get_test_pool().await;

    let patient_id = format!("TEST-PAT-POSTOP-{}", Utc::now().timestamp_millis());
    PgPatientRepository::new(pool.clone())
        .create(create_test_patient(&patient_id))
        .await
        .expect("failed to create the patient the note hangs off");

    let id = format!("POSTOP-{}", Utc::now().timestamp_millis());
    let note = PostOperativeNote {
        note_id: id.clone(),
        patient_id: patient_id.clone(),
        surgery_date: "2026-08-12".to_string(),
        procedure: "Laparoscopic cholecystectomy".to_string(),
        post_op_day: 2,
        condition: "Improving".to_string(),
        pain_score: 3,
        pain_management: "Paracetamol 1g QDS, tramadol PRN".to_string(),
        vitals_stable: true,
        diet: "Soft diet tolerated".to_string(),
        activity: "Mobilising independently".to_string(),
        // The infection-surveillance fields this test exists for.
        wound: WoundStatus {
            appearance: "Clean, dry, edges apposed".to_string(),
            drainage: Some("Minimal serous".to_string()),
            signs_of_infection: false,
            dressing_changed: true,
        },
        drain_output: Some("30 mL serosanguinous".to_string()),
        io_balance: Some("+450 mL".to_string()),
        foley: None,
        dvt_prophylaxis: "Enoxaparin 40mg daily".to_string(),
        complications: None,
        labs: Some("FBC normal".to_string()),
        imaging: None,
        plan: vec![
            "Continue analgesia".to_string(),
            "Discharge tomorrow if afebrile".to_string(),
        ],
        estimated_discharge: Some("2026-08-14".to_string()),
        written_by: "Dr Naidoo".to_string(),
        note_time: 1_755_160_000,
    };

    let writer = PgPostOpNoteRepository::new(pool.clone());
    let entity: PostOpNoteEntity = note.clone().into();
    writer.create(entity).await.expect("create failed");

    let reader = PgPostOpNoteRepository::new(pool.clone());
    let stored = reader
        .get_by_id(&id)
        .await
        .expect("post-op note lost on restart");
    assert_eq!(stored.patient_id, patient_id);

    let back = PostOperativeNote::try_from(stored).expect("stored payload could not be read back");
    assert_eq!(back.post_op_day, 2, "post-op day was lost");
    assert_eq!(back.pain_score, 3, "pain score was lost");
    assert!(!back.wound.signs_of_infection);
    assert!(back.wound.dressing_changed);
    assert_eq!(back.wound.appearance, "Clean, dry, edges apposed");
    assert_eq!(back.wound.drainage.as_deref(), Some("Minimal serous"));
    assert_eq!(back.plan.len(), 2);
    assert_eq!(back.note_time, 1_755_160_000);

    let page = reader
        .get_by_patient(&patient_id, Pagination::new(0, 10))
        .await
        .expect("get_by_patient failed");
    assert_eq!(page.items.len(), 1);

    pool.close().await;
}

/// A radiology order must survive a restart with its contrast-safety checks.
///
/// `creatinine_checked` and `pregnancy_checked` have no columns at all — they
/// live only in `record_json`. They are the checks that stop a contrast study
/// harming a patient with renal impairment or an undisclosed pregnancy, so a
/// silent loss here is a safety failure, not a cosmetic one.
#[tokio::test]
async fn test_pg_radiology_order_survives_restart_with_contrast_checks_intact() {
    use crate::clinical::{
        Laterality, OrderPriority, RadiologyOrder, RadiologyOrderStatus, RadiologyStudyType,
    };
    use crate::repositories::postgres::PgRadiologyOrderRepository;
    use crate::repositories::traits::{RadiologyOrderEntity, RadiologyOrderRepository};

    let pool = get_test_pool().await;

    let patient_id = format!("TEST-PAT-RADORD-{}", Utc::now().timestamp_millis());
    PgPatientRepository::new(pool.clone())
        .create(create_test_patient(&patient_id))
        .await
        .expect("failed to create the patient the order hangs off");

    let id = format!("RADORD-{}", Utc::now().timestamp_millis());
    let order = RadiologyOrder {
        order_id: id.clone(),
        patient_id: patient_id.clone(),
        // Exercises the modality mapping: the column cannot express contrast,
        // so this must not be lost.
        study_type: RadiologyStudyType::CTWithContrast,
        body_part: "Abdomen and pelvis".to_string(),
        laterality: Some(Laterality::NA),
        indication: "Right lower quadrant pain, query appendicitis".to_string(),
        // Exercises the widened priority CHECK.
        priority: OrderPriority::Scheduled,
        ordering_provider: "5OrderingDoctorWallet".to_string(),
        order_time: 1_755_000_000,
        contrast: true,
        allergies_reviewed: true,
        // The safety checks this test exists for.
        creatinine_checked: Some(true),
        pregnancy_checked: Some(false),
        special_instructions: Some("Oral contrast 1 hour prior".to_string()),
        // Exercises the widened status CHECK.
        status: RadiologyOrderStatus::Preliminary,
    };

    let writer = PgRadiologyOrderRepository::new(pool.clone());
    let entity: RadiologyOrderEntity = order.clone().into();
    writer.create(entity).await.expect("create failed");

    // Simulate a restart: a brand-new repository over the same database.
    let reader = PgRadiologyOrderRepository::new(pool.clone());
    let stored = reader
        .get_by_id(&id)
        .await
        .expect("radiology order lost on restart");

    assert_eq!(stored.patient_id, patient_id);
    assert_eq!(stored.modality, "ct");
    assert_eq!(stored.priority, "scheduled");
    assert_eq!(stored.status, "preliminary");
    assert_eq!(stored.contrast_required, Some(true));
    assert_eq!(stored.ordering_provider_id, "5OrderingDoctorWallet");

    let back = RadiologyOrder::try_from(stored).expect("stored payload could not be read back");
    assert_eq!(
        back.creatinine_checked,
        Some(true),
        "contrast renal-safety check was lost"
    );
    assert_eq!(
        back.pregnancy_checked,
        Some(false),
        "pregnancy safety check was lost"
    );
    assert!(back.allergies_reviewed);
    assert_eq!(
        back.study_type,
        RadiologyStudyType::CTWithContrast,
        "the contrast distinction the modality column cannot hold was lost"
    );
    assert_eq!(back.order_time, 1_755_000_000);

    pool.close().await;
}

/// A radiology report must survive a restart with its critical-finding
/// read-back intact.
///
/// `critical_communicated` is a nested record — who was told, by whom, when,
/// how, and whether they read the finding back. The flat columns hold only
/// parts of it, so this is exactly the structure `record_json` exists for.
#[tokio::test]
async fn test_pg_radiology_report_survives_restart_with_critical_readback_intact() {
    use crate::clinical::{
        CriticalCommunication, Laterality, OrderPriority, RadiologyOrder, RadiologyOrderStatus,
        RadiologyReport, RadiologyReportStatus, RadiologyStudyType,
    };
    use crate::repositories::postgres::{PgRadiologyOrderRepository, PgRadiologyReportRepository};
    use crate::repositories::traits::{
        RadiologyOrderEntity, RadiologyOrderRepository, RadiologyReportEntity,
        RadiologyReportRepository,
    };

    let pool = get_test_pool().await;

    let patient_id = format!("TEST-PAT-RADREP-{}", Utc::now().timestamp_millis());
    PgPatientRepository::new(pool.clone())
        .create(create_test_patient(&patient_id))
        .await
        .expect("failed to create the patient the report hangs off");

    // radiology_reports.order_id is a foreign key to radiology_orders(id).
    let order_id = format!("RADORD-FOR-REP-{}", Utc::now().timestamp_millis());
    let order = RadiologyOrder {
        order_id: order_id.clone(),
        patient_id: patient_id.clone(),
        study_type: RadiologyStudyType::CT,
        body_part: "Head".to_string(),
        laterality: Some(Laterality::NA),
        indication: "Sudden severe headache".to_string(),
        priority: OrderPriority::Stat,
        ordering_provider: "5EDDoctorWallet".to_string(),
        order_time: 1_755_000_000,
        contrast: false,
        allergies_reviewed: true,
        creatinine_checked: None,
        pregnancy_checked: None,
        special_instructions: None,
        status: RadiologyOrderStatus::Completed,
    };
    let order_entity: RadiologyOrderEntity = order.into();
    PgRadiologyOrderRepository::new(pool.clone())
        .create(order_entity)
        .await
        .expect("failed to create the order the report hangs off");

    let id = format!("RADREP-{}", Utc::now().timestamp_millis());
    let report = RadiologyReport {
        report_id: id.clone(),
        patient_id: patient_id.clone(),
        order_id: order_id.clone(),
        accession_number: "ACC-2026-7781".to_string(),
        study_type: RadiologyStudyType::CT,
        body_part: "Head".to_string(),
        study_datetime: 1_755_003_600,
        technique: "Non-contrast axial CT of the brain".to_string(),
        contrast: None,
        comparison: Some("No prior imaging available".to_string()),
        clinical_history: "Sudden severe headache, worst of life".to_string(),
        findings: "Hyperdense material in the basal cisterns.".to_string(),
        // A list the single `impression` column cannot hold.
        impression: vec![
            "Subarachnoid haemorrhage".to_string(),
            "No midline shift".to_string(),
            "Recommend urgent CT angiography".to_string(),
        ],
        recommendations: Some("Urgent neurosurgical referral".to_string()),
        critical_finding: true,
        // The read-back record this test exists for.
        critical_communicated: Some(CriticalCommunication {
            communicated_to: "5EDDoctorWallet".to_string(),
            communicated_by: "5RadiologistWallet".to_string(),
            communication_time: 1_755_004_200,
            method: "Telephone".to_string(),
            read_back: true,
        }),
        radiologist: "5RadiologistWallet".to_string(),
        status: RadiologyReportStatus::Final,
        preliminary_time: Some(1_755_003_900),
        final_time: Some(1_755_004_500),
        dicom_study_uid: Some("1.2.840.113619.2.55.3.1234".to_string()),
        image_ipfs_hash: None,
    };

    let writer = PgRadiologyReportRepository::new(pool.clone());
    let entity: RadiologyReportEntity = report.clone().into();
    writer.create(entity).await.expect("create failed");

    let reader = PgRadiologyReportRepository::new(pool.clone());
    let stored = reader
        .get_by_id(&id)
        .await
        .expect("radiology report lost on restart");

    assert_eq!(stored.patient_id, patient_id);
    assert!(stored.critical_finding);
    assert_eq!(stored.status, "final");
    assert_eq!(stored.radiologist_id, "5RadiologistWallet");
    // The projection joins the impression list.
    assert!(stored.impression.contains("Subarachnoid haemorrhage"));

    let back = RadiologyReport::try_from(stored).expect("stored payload could not be read back");
    let comms = back
        .critical_communicated
        .as_ref()
        .expect("critical-finding communication record was lost");
    assert!(comms.read_back, "critical-finding read-back flag was lost");
    assert_eq!(comms.communicated_to, "5EDDoctorWallet");
    assert_eq!(comms.communication_time, 1_755_004_200);
    assert_eq!(comms.method, "Telephone");
    assert_eq!(back.impression.len(), 3, "impression list was flattened");
    assert_eq!(back.preliminary_time, Some(1_755_003_900));
    assert_eq!(back.final_time, Some(1_755_004_500));

    pool.close().await;
}

/// A pathology report must survive a restart with its cancer staging intact.
///
/// The synoptic report carries the AJCC stage and TNM classification that
/// oncology treatment decisions are made from, and the immunohistochemistry
/// results that determine targeted-therapy eligibility. Neither survives in the
/// flat columns.
#[tokio::test]
async fn test_pg_pathology_report_survives_restart_with_cancer_staging_intact() {
    use crate::clinical::{
        IHCResult, MolecularResult, PathologyReport, PathologySpecimenType, PathologyStatus,
        SpecialStain, SynopticReport,
    };
    use crate::repositories::postgres::PgPathologyReportRepository;
    use crate::repositories::traits::{PathologyReportEntity, PathologyReportRepository};

    let pool = get_test_pool().await;

    let patient_id = format!("TEST-PAT-PATH-{}", Utc::now().timestamp_millis());
    PgPatientRepository::new(pool.clone())
        .create(create_test_patient(&patient_id))
        .await
        .expect("failed to create the patient the report hangs off");

    let id = format!("PATHREP-{}", Utc::now().timestamp_millis());
    let report = PathologyReport {
        report_id: id.clone(),
        patient_id: patient_id.clone(),
        accession_number: "PATH-2026-1187".to_string(),
        specimen_type: PathologySpecimenType::Resection,
        collection_date: "2026-08-01".to_string(),
        received_date: "2026-08-01".to_string(),
        clinical_history: "Screen-detected right breast mass".to_string(),
        specimen_source: "Right breast, wide local excision".to_string(),
        gross_description: "Fibrofatty tissue containing a firm mass.".to_string(),
        microscopic_description: "Invasive ductal carcinoma, no special type.".to_string(),
        special_stains: vec![SpecialStain {
            stain_name: "Elastic van Gieson".to_string(),
            result: "No lymphovascular invasion".to_string(),
        }],
        // Determines targeted-therapy eligibility.
        ihc: vec![
            IHCResult {
                marker: "ER".to_string(),
                result: "Positive, 90%".to_string(),
                interpretation: "Hormone receptor positive".to_string(),
            },
            IHCResult {
                marker: "HER2".to_string(),
                result: "Score 3+".to_string(),
                interpretation: "HER2 amplified".to_string(),
            },
        ],
        molecular: vec![MolecularResult {
            test_name: "Oncotype DX".to_string(),
            result: "Recurrence score 18".to_string(),
            interpretation: "Low risk".to_string(),
        }],
        diagnosis: vec![
            "Invasive ductal carcinoma".to_string(),
            "Grade 2".to_string(),
        ],
        // The staging this test exists for.
        synoptic: Some(SynopticReport {
            tumor_site: "Right breast, upper outer quadrant".to_string(),
            histologic_type: "Invasive ductal carcinoma".to_string(),
            histologic_grade: "Grade 2".to_string(),
            tumor_size: "22 mm".to_string(),
            margins: "Clear, closest 3 mm".to_string(),
            lymph_nodes: "0 of 3 sentinel nodes involved".to_string(),
            stage_t: "T2".to_string(),
            stage_n: "N0".to_string(),
            stage_m: "M0".to_string(),
            ajcc_stage: "IIA".to_string(),
        }),
        comment: Some("Discussed at breast MDT.".to_string()),
        pathologist: "5PathologistWallet".to_string(),
        report_date: "2026-08-05".to_string(),
        // Exercises the widened status CHECK.
        status: PathologyStatus::Pending,
        addenda: vec![],
    };

    let writer = PgPathologyReportRepository::new(pool.clone());
    let entity: PathologyReportEntity = report.clone().into();
    writer.create(entity).await.expect("create failed");

    let reader = PgPathologyReportRepository::new(pool.clone());
    let stored = reader
        .get_by_id(&id)
        .await
        .expect("pathology report lost on restart");

    assert_eq!(stored.patient_id, patient_id);
    assert_eq!(stored.status, "pending");
    assert_eq!(stored.pathologist_id, "5PathologistWallet");
    // The date columns parsed rather than defaulting to now.
    assert_eq!(
        stored.collection_date.format("%Y-%m-%d").to_string(),
        "2026-08-01"
    );

    let back = PathologyReport::try_from(stored).expect("stored payload could not be read back");
    let synoptic = back.synoptic.as_ref().expect("cancer staging was lost");
    assert_eq!(synoptic.ajcc_stage, "IIA", "AJCC stage was lost");
    assert_eq!(synoptic.stage_t, "T2");
    assert_eq!(synoptic.stage_n, "N0");
    assert_eq!(synoptic.margins, "Clear, closest 3 mm");
    assert_eq!(back.ihc.len(), 2, "immunohistochemistry results were lost");
    assert_eq!(back.ihc[1].marker, "HER2");
    assert_eq!(back.ihc[1].result, "Score 3+");
    assert_eq!(back.molecular[0].test_name, "Oncotype DX");
    assert_eq!(back.diagnosis.len(), 2, "diagnosis list was flattened");
    assert_eq!(back.special_stains[0].stain_name, "Elastic van Gieson");

    pool.close().await;
}

/// Every `action` value the handlers write must satisfy the `access_logs`
/// CHECK constraint.
///
/// This is the test that was missing. `access_logs.action` was created with a
/// seven-value PascalCase CRUD enum, the handlers evolved to record operation
/// names instead, and the two drifted apart until only `'View'` still matched.
/// The in-memory backend has no constraint, so nothing caught it; on PostgreSQL
/// almost every audit insert was rejected, and because the audit path fails
/// closed that surfaced as `503 AUDIT_PERSISTENCE_REQUIRED` on emergency card
/// reads, patient lockscreen reads and record uploads.
///
/// Failing closed is correct for a medical audit trail, so the fix belongs in
/// the schema (migration 20260813000001). This test pins the two together: add
/// a new `action` string in a handler without widening the constraint and this
/// goes red instead of silently blocking access in production.
#[tokio::test]
async fn test_pg_access_log_accepts_every_action_the_handlers_write() {
    let pool = get_test_pool().await;

    // Mirrors the vocabulary in migration 20260813000001. Kept as an explicit
    // list rather than derived, because the point is to notice divergence.
    const ACTIONS: &[&str] = &[
        "View",
        "Create",
        "Update",
        "Delete",
        "Export",
        "Print",
        "EmergencyAccess",
        "view",
        "create",
        "emergency",
        "restricted",
        "upload_record",
        "download_record",
        "list_records",
        "view_medical_id",
        "nfc_tap",
        "nfc_self_verify",
        "qr_verification",
        "log_symptom",
        "lab_submission",
        "add_vital_signs",
        "create_soap_note",
        "create_operative_note",
        "create_pre_op",
        "create_post_op",
        "create_anesthesia",
        "create_pathology",
        "create_radiology_order",
        "create_radiology_report",
        "create_transfusion",
        "create_e_prescription",
        "create_death_certificate",
        "create_autopsy_request",
        "create_autopsy_report",
        "create_trauma_assessment",
        "create_stroke_assessment",
        "create_sepsis_assessment",
        "create_ems_handoff",
        "create_code_blue",
        "create_cardiac_event",
        "telehealth",
        "recording-started",
        "recording-stopped",
        // Client-supplied telehealth lifecycle events. These appear nowhere as
        // Rust literals -- they originate in JitsiMeetComponent and arrive as
        // `event_type` -- so deriving the vocabulary from backend source alone
        // missed them entirely.
        "conference-joined",
        "conference-left",
        "participant-joined",
        "participant-left",
        "error",
    ];

    let mut rejected: Vec<String> = Vec::new();
    for action in ACTIONS {
        let id = format!("audit-vocab-{}", uuid::Uuid::new_v4());
        let result = sqlx::query(
            "INSERT INTO access_logs
                 (id, accessor_id, accessor_role, resource_type, action, is_emergency_access)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(&id)
        .bind("synthetic-accessor")
        .bind("Doctor")
        .bind("synthetic")
        .bind(*action)
        .bind(false)
        .execute(&pool)
        .await;

        if let Err(e) = result {
            rejected.push(format!("{action}: {e}"));
        }
    }

    // `action` is VARCHAR(32); a longer value fails on length, not the CHECK.
    for action in ACTIONS {
        assert!(
            action.len() <= 32,
            "action {action:?} is {} chars and cannot fit access_logs.action",
            action.len()
        );
    }

    pool.close().await;

    assert!(
        rejected.is_empty(),
        "{} action value(s) the handlers write are rejected by the schema:\n  {}",
        rejected.len(),
        rejected.join("\n  ")
    );
}

/// The telehealth endpoint's allowlist and the `access_logs` constraint are two
/// halves of one closed set and must not drift apart.
///
/// `event_type` is caller-supplied and written verbatim into
/// `access_logs.action`. Migration 20260813000001 missed these values because
/// they appear nowhere as Rust literals — they originate in the frontend's
/// `JitsiMeetComponent`. Every telehealth event from the real client would have
/// failed its audit insert on PostgreSQL, and because the audit path fails
/// closed, been refused. No test exercised that endpoint, so nothing caught it.
#[tokio::test]
async fn test_pg_telehealth_event_types_are_all_accepted_by_the_schema() {
    // Both `clinical_support` and `telehealth` are private modules; the constant
    // is reachable only through the chain of `pub use ...::*` re-exports.
    use crate::clinical_endpoints::TELEHEALTH_EVENT_TYPES;

    let pool = get_test_pool().await;
    let mut rejected: Vec<String> = Vec::new();

    for event_type in TELEHEALTH_EVENT_TYPES {
        let id = format!("telehealth-vocab-{}", uuid::Uuid::new_v4());
        let result = sqlx::query(
            "INSERT INTO access_logs
                 (id, accessor_id, accessor_role, resource_type, action, is_emergency_access)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(&id)
        .bind("synthetic-accessor")
        .bind("")
        .bind("telehealth")
        .bind(*event_type)
        .bind(false)
        .execute(&pool)
        .await;

        if let Err(e) = result {
            rejected.push(format!("{event_type}: {e}"));
        }
    }

    pool.close().await;

    assert!(
        rejected.is_empty(),
        "the telehealth endpoint accepts event types the audit schema rejects, so \
         every such event would fail its audit write and be refused:\n  {}",
        rejected.join("\n  ")
    );
}

/// Seed the provider and patient rows an appointment's foreign keys require.
///
/// These tests run against a throwaway schema with migrations freshly applied,
/// so nothing exists yet. `appointments.provider_id` references
/// `users(wallet_address)` and `patient_id` references `patients(id)`.
async fn seed_appointment_fks(pool: &PgPool, provider: &str, filed_by: &str, patient: &str) {
    for wallet in [provider, filed_by] {
        sqlx::query(
            "INSERT INTO users (wallet_address, role, name, status)
             VALUES ($1, 'Doctor', 'Test Provider', 'active')
             ON CONFLICT (wallet_address) DO NOTHING",
        )
        .bind(wallet)
        .execute(pool)
        .await
        .expect("seeding a user failed");
    }
    sqlx::query(
        "INSERT INTO patients (id, health_id, national_id_hash, national_id_type)
         VALUES ($1, $1, 'test-hash', 'SmartID')
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(patient)
    .execute(pool)
    .await
    .expect("seeding a patient failed");
}

/// An appointment must survive a round trip through PostgreSQL.
///
/// # Why this test exists
///
/// It did not, and that absence hid a total feature outage. `provider_id`,
/// `created_by` and `cancelled_by` were `uuid` columns while the application
/// binds SS58 wallet strings, and the status writer emitted Rust `Debug`
/// output ("Scheduled") against a CHECK expecting snake_case ('scheduled'). So
/// **every** booking failed on the production storage backend and
/// `SELECT count(*) FROM appointments` was 0 — while the whole suite stayed
/// green, because the in-memory repository enforces neither types nor CHECK
/// constraints (docs/WORKFLOW_AUDIT.md, WF-030).
///
/// A memory-backend test could never have caught this. Any future change to
/// the appointment column types, the status vocabulary, or the entity
/// conversion has to come through here.
#[tokio::test]
async fn test_pg_appointment_round_trip_survives_restart() {
    use crate::repositories::traits::{AppointmentEntity, AppointmentRepository};
    let pool = get_test_pool().await;
    let id = format!("APT-{}", uuid::Uuid::new_v4());
    let now = Utc::now();

    // A wallet address, not a uuid — the identifier the application actually
    // uses for providers everywhere else.
    let provider = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty".to_string();
    // Distinct from `provider_id`: an administrator scheduling for a colleague.
    let filed_by = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY".to_string();

    let entity = AppointmentEntity {
        id: id.clone(),
        patient_id: "PAT-APPT-RESTART".into(),
        provider_id: provider.clone(),
        appointment_type: "Telehealth".into(),
        scheduled_datetime: now,
        duration_minutes: 30,
        // snake_case, matching appointments_status_check.
        status: "checked_in".into(),
        location: Some("Test Clinic / General".into()),
        room: None,
        reason_for_visit: Some("Round-trip check".into()),
        visit_type: Some("telehealth".into()),
        priority: None,
        recurring: false,
        recurrence_pattern: None,
        parent_appointment_id: None,
        insurance_verified: false,
        copay_amount: None,
        copay_collected: false,
        reminder_sent: false,
        reminder_sent_at: None,
        check_in_time: Some(now),
        check_out_time: None,
        cancelled_at: None,
        cancellation_reason: None,
        cancelled_by: None,
        notes: None,
        created_by: filed_by.clone(),
        created_at: now,
        updated_at: now,
        data: serde_json::json!({"is_telehealth": true}),
    };

    seed_appointment_fks(&pool, &provider, &filed_by, "PAT-APPT-RESTART").await;

    let repo = crate::repositories::postgres::PgAppointmentRepository::new(pool.clone());
    repo.create(entity)
        .await
        .expect("appointment insert failed");

    let fetched = repo
        .get_by_id(&id)
        .await
        .expect("appointment lost on restart");
    assert_eq!(
        fetched.provider_id, provider,
        "provider must survive as a wallet address"
    );
    assert_eq!(
        fetched.created_by, filed_by,
        "the real actor must be retained"
    );
    assert_eq!(fetched.status, "checked_in");
    assert_eq!(fetched.visit_type.as_deref(), Some("telehealth"));

    sqlx::query("DELETE FROM appointments WHERE id = $1")
        .bind(&id)
        .execute(&pool)
        .await
        .ok();
    pool.close().await;
}

/// Every status the domain enum can hold must be storable.
///
/// The CHECK constraint originally listed seven of the nine `AppointmentStatus`
/// variants, so `rescheduled` and `waitlisted` were a latent 500 for whoever
/// first rescheduled an appointment.
#[tokio::test]
async fn test_pg_every_appointment_status_is_accepted_by_the_schema() {
    use crate::clinical::AppointmentStatus as S;
    use crate::repositories::traits::AppointmentRepository;
    let pool = get_test_pool().await;
    let repo = crate::repositories::postgres::PgAppointmentRepository::new(pool.clone());
    let provider = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
    seed_appointment_fks(&pool, provider, provider, "PAT-APPT-STATUS").await;

    for status in [
        S::Scheduled,
        S::Confirmed,
        S::CheckedIn,
        S::InProgress,
        S::Completed,
        S::NoShow,
        S::Cancelled,
        S::Rescheduled,
        S::Waitlisted,
    ] {
        let stored = crate::types::appt_status_storage_str(&status);
        let id = format!("APT-STATUS-{}", uuid::Uuid::new_v4());
        let now = Utc::now();
        let entity = crate::repositories::traits::AppointmentEntity {
            id: id.clone(),
            patient_id: "PAT-APPT-STATUS".into(),
            provider_id: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty".into(),
            appointment_type: "FollowUp".into(),
            scheduled_datetime: now,
            duration_minutes: 15,
            status: stored.to_string(),
            location: None,
            room: None,
            reason_for_visit: None,
            visit_type: Some("in_person".into()),
            priority: None,
            recurring: false,
            recurrence_pattern: None,
            parent_appointment_id: None,
            insurance_verified: false,
            copay_amount: None,
            copay_collected: false,
            reminder_sent: false,
            reminder_sent_at: None,
            check_in_time: None,
            check_out_time: None,
            cancelled_at: None,
            cancellation_reason: None,
            cancelled_by: None,
            notes: None,
            created_by: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty".into(),
            created_at: now,
            updated_at: now,
            data: serde_json::json!({}),
        };
        repo.create(entity)
            .await
            .unwrap_or_else(|e| panic!("status '{stored}' rejected by the schema: {e}"));
        sqlx::query("DELETE FROM appointments WHERE id = $1")
            .bind(&id)
            .execute(&pool)
            .await
            .ok();
    }
    pool.close().await;
}

/// A consultant's answer must survive a restart, and must be visible through
/// the JSON blob the read handler serves — not only through the typed columns.
///
/// `PgConsultationNoteRepository::update` did not bind `data`, so the column
/// kept whatever the consult was *created* with for the rest of its life.
/// `get_consult` serves exactly that column, so a consult could be answered —
/// status, findings and recommendations all written and returned as success —
/// and still read back as an unanswered request to every clinician who opened
/// it. The write went to Postgres; the reader never saw it.
#[tokio::test]

async fn test_pg_consult_response_survives_restart_and_is_visible_in_the_read_blob() {
    use crate::repositories::postgres::PgConsultationNoteRepository;
    use crate::repositories::traits::{ConsultationNoteEntity, ConsultationNoteRepository};

    let pool = get_test_pool().await;

    let patient_id = format!("TEST-PAT-CONSULT-{}", Utc::now().timestamp_millis());
    PgPatientRepository::new(pool.clone())
        .create(create_test_patient(&patient_id))
        .await
        .expect("failed to create the patient the consult hangs off");

    let consult_id = format!("CON-{}", Utc::now().timestamp_millis());
    let now = Utc::now();
    let requested = ConsultationNoteEntity {
        id: consult_id.clone(),
        patient_id: patient_id.clone(),
        consultation_type: "cardiology".to_string(),
        requesting_provider: "5EDDoctorWallet".to_string(),
        consulting_provider: String::new(),
        reason_for_consultation: "Chest pain on exertion".to_string(),
        clinical_question: Some("Is this stable angina?".to_string()),
        pertinent_history: None,
        examination_findings: None,
        recommendations: String::new(),
        follow_up_plan: None,
        urgency: Some("urgent".to_string()),
        // `requested` is the status every new consult is created with. The
        // CHECK constraint used to reject it outright, so this write is also
        // the regression test for `20260820000001_consult_status_vocabulary`.
        status: Some("requested".to_string()),
        requested_at: now,
        completed_at: None,
        created_at: now,
        updated_at: now,
        facility_id: None,
        is_active: true,
        data: serde_json::json!({
            "patient_id": patient_id,
            "status": "requested",
            "reason_for_consultation": "Chest pain on exertion"
        }),
    };

    let repo = PgConsultationNoteRepository::new(pool.clone());
    repo.create(requested)
        .await
        .expect("a consult must be creatable with status 'requested'");

    // The specialist answers, exactly as `respond_to_consult` does: typed
    // columns and the read blob kept in step.
    let mut answered = repo
        .get_by_id(&consult_id)
        .await
        .expect("consult should be readable");
    let completed_at = Utc::now();
    answered.examination_findings = Some("No acute ischaemia; troponin negative.".to_string());
    answered.recommendations = "Outpatient stress test; aspirin 75mg daily.".to_string();
    answered.follow_up_plan = Some("Cardiology clinic in 2 weeks".to_string());
    answered.consulting_provider = "5EDCardiologistWallet".to_string();
    answered.status = Some("completed".to_string());
    answered.completed_at = Some(completed_at);
    if let Some(blob) = answered.data.as_object_mut() {
        blob.insert("status".into(), serde_json::json!("completed"));
        blob.insert(
            "examination_findings".into(),
            serde_json::json!("No acute ischaemia; troponin negative."),
        );
        blob.insert(
            "recommendations".into(),
            serde_json::json!("Outpatient stress test; aspirin 75mg daily."),
        );
        blob.insert(
            "consulting_provider".into(),
            serde_json::json!("5EDCardiologistWallet"),
        );
    }
    repo.update(answered).await.expect("response must persist");

    // Simulate a restart: a brand-new repository instance over the same
    // database, matching the convention the other durability tests use.
    let restarted = PgConsultationNoteRepository::new(pool.clone());
    let reloaded = restarted
        .get_by_id(&consult_id)
        .await
        .expect("the consult must survive a restart");

    assert_eq!(reloaded.status.as_deref(), Some("completed"));
    assert_eq!(
        reloaded.recommendations,
        "Outpatient stress test; aspirin 75mg daily."
    );
    assert_eq!(reloaded.consulting_provider, "5EDCardiologistWallet");
    assert!(reloaded.completed_at.is_some());

    // The blob the read handler serves must agree with the columns. This is the
    // assertion that fails without the `data = ` bind in `update`.
    assert_eq!(
        reloaded.data.get("status").and_then(|v| v.as_str()),
        Some("completed"),
        "the JSON blob `get_consult` serves still reports the consult as unanswered"
    );
    assert_eq!(
        reloaded
            .data
            .get("recommendations")
            .and_then(|v| v.as_str()),
        Some("Outpatient stress test; aspirin 75mg daily.")
    );
}

/// One organisation per instance is a load-bearing security boundary
/// (ADR-0007): the clinician worklists and `/api/platform/list/*` registries are
/// deployment-wide, so a second organisation sharing this database would read
/// the first one's records with no error anywhere.
#[tokio::test]
async fn test_pg_startup_refuses_a_multi_organisation_database() {
    let pool = get_test_pool().await;

    // A fresh schema has no organisations: nothing to conflict, so boot.
    assert!(
        crate::startup::validate_single_organisation(&pool)
            .await
            .is_ok(),
        "an empty organisations table must not block startup"
    );

    let insert = |id: &str, name: &str| {
        let pool = pool.clone();
        let id = id.to_string();
        let name = name.to_string();
        async move {
            sqlx::query(
                "INSERT INTO organizations (id, name, is_active) VALUES ($1, $2, true) \
                 ON CONFLICT (id) DO NOTHING",
            )
            .bind(id)
            .bind(name)
            .execute(&pool)
            .await
        }
    };

    // One organisation is the supported configuration.
    if insert("ORG-SOLO", "Solo Hospital").await.is_err() {
        // The federation tables are not present in this schema; the check is
        // designed to stay quiet in that case rather than block boot, and the
        // assertion above already covers it.
        return;
    }
    assert!(
        crate::startup::validate_single_organisation(&pool)
            .await
            .is_ok(),
        "a single active organisation is the supported configuration"
    );

    // Two is a misconfiguration that must stop the process, not warn.
    insert("ORG-SECOND", "Second Hospital")
        .await
        .expect("second organisation should insert");
    let refused = crate::startup::validate_single_organisation(&pool).await;
    let message = refused.expect_err("two active organisations must refuse startup");
    assert!(
        message.contains("2 active organisations"),
        "the operator needs to be told how many were found, got: {message}"
    );
}

/// A pathology specimen must be accessionable with the workflow status the lab
/// screen actually uses, and without a `specimen_collections` row existing.
///
/// Two separate defects met here, and both were PostgreSQL-only:
///
/// 1. The status CHECK allowed only the *report* lifecycle
///    (`pending|preliminary|final|amended|corrected`), while the screen tracks a
///    *specimen* through `received → grossing → … → addendum`. Every accession
///    was rejected.
/// 2. `specimen_id` is a foreign key into `specimen_collections` — the physical
///    sample the lab logged in — not the accession number. Binding the
///    accession there violated the key on every insert.
///
/// Neither could fail in the in-memory backend, which enforces no CHECK
/// constraints and no foreign keys.
#[tokio::test]
async fn test_pg_pathology_specimen_accessions_with_a_workflow_status() {
    use crate::repositories::postgres::PgPathologyReportRepository;
    use crate::repositories::traits::{PathologyReportEntity, PathologyReportRepository};

    let pool = get_test_pool().await;

    let patient_id = format!("TEST-PAT-PATH-{}", Utc::now().timestamp_millis());
    PgPatientRepository::new(pool.clone())
        .create(create_test_patient(&patient_id))
        .await
        .expect("failed to create the patient the specimen belongs to");

    let accession = format!("S26-{}", Utc::now().timestamp_millis());
    let now = Utc::now();
    let specimen = PathologyReportEntity {
        id: accession.clone(),
        patient_id: patient_id.clone(),
        // Left unset: the lab has not logged a collection record for this
        // accession, which is the ordinary case at booking-in time.
        specimen_id: None,
        ordering_provider_id: "5EDDoctorWallet".to_string(),
        pathologist_id: "5EDPathologistWallet".to_string(),
        specimen_type: "biopsy".to_string(),
        specimen_source: "Left breast".to_string(),
        collection_date: now,
        received_date: now,
        report_date: now,
        clinical_history: Some("Palpable mass, 2cm upper outer quadrant".to_string()),
        gross_description: String::new(),
        microscopic_description: String::new(),
        special_stains: None,
        immunohistochemistry: None,
        molecular_studies: None,
        diagnosis: String::new(),
        staging: None,
        tnm_classification: None,
        margin_status: None,
        lymph_node_status: None,
        comments: None,
        addendum: None,
        addendum_datetime: None,
        addendum_by: None,
        // The state the screen submits. Rejected by the old constraint.
        status: "grossing".to_string(),
        synoptic_report: None,
        created_at: now,
        updated_at: now,
        data: serde_json::json!({
            "specimenId": accession,
            "priority": "urgent",
            "fixative": "10% formalin",
            "container": "Formalin pot",
            "laterality": "left",
            "slides": ["A1 H&E", "A2 H&E"]
        }),
    };

    let repo = PgPathologyReportRepository::new(pool.clone());
    repo.create(specimen)
        .await
        .expect("a specimen must accession with a laboratory workflow status");

    // Simulate a restart: a new repository over the same database.
    let reloaded = PgPathologyReportRepository::new(pool.clone())
        .get_by_id(&accession)
        .await
        .expect("the specimen must survive a restart");

    assert_eq!(reloaded.status, "grossing");
    assert_eq!(reloaded.specimen_source, "Left breast");
    // The tracking fields the typed columns have no home for must come back
    // through the blob the worklist reads.
    assert_eq!(
        reloaded.data.get("fixative").and_then(|v| v.as_str()),
        Some("10% formalin")
    );
    assert_eq!(
        reloaded
            .data
            .get("slides")
            .and_then(|v| v.as_array())
            .map(|a| a.len()),
        Some(2)
    );

    // The rest of the laboratory workflow must also be storable, or a specimen
    // gets stuck partway through.
    for state in [
        "received",
        "processing",
        "embedding",
        "cutting",
        "staining",
        "prelim",
    ] {
        let mut moved = reloaded.clone();
        moved.status = state.to_string();
        repo.update(moved)
            .await
            .unwrap_or_else(|e| panic!("status '{state}' must be storable: {e}"));
    }
}

/// An administrator must be able to find, and undo, a deactivation.
///
/// `GET /api/users` used to serve the admin directory from `AppState.users` —
/// the *authorization* cache, hydrated with `WHERE is_active = true AND status
/// = 'active'`. Correct for deciding who may act; wrong for deciding who
/// exists. The consequence was that deactivating an account removed it from the
/// only list an administrator can see: the "Inactive" filter could never match
/// a row, the Reactivate control was unreachable, and undoing a mistaken
/// deactivation meant hand-written SQL against production.
///
/// This pins the query the directory now runs: every account comes back
/// regardless of status, carrying the `status` an administrator has to act on.
#[tokio::test]
async fn test_pg_user_directory_lists_deactivated_accounts() {
    let pool = get_test_pool().await;

    // `valid_wallet` requires an SS58-shaped address: `5`-prefixed and at least
    // 45 characters. A short fixture is rejected before the test can say
    // anything, so build one the constraint accepts.
    let ss58 = |tag: &str| {
        let raw = format!("5{tag}{}", uuid::Uuid::new_v4().simple());
        format!("{raw:5<48}")
    };
    let active = ss58("Act");
    let gone = ss58("Gone");

    for (wallet, is_active, status) in [(&active, true, "active"), (&gone, false, "inactive")] {
        sqlx::query(
            "INSERT INTO users (id, wallet_address, role, name, is_active, status)
             VALUES ($1, $2, 'Doctor', 'Directory Fixture', $3, $4)",
        )
        .bind(uuid::Uuid::new_v4())
        .bind(wallet)
        .bind(is_active)
        .bind(status)
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("fixture {wallet} must insert: {e}"));
    }

    // The directory query, exactly as `list_users` runs it.
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT u.wallet_address, u.status
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         ORDER BY u.created_at DESC",
    )
    .fetch_all(&pool)
    .await
    .expect("directory query runs");

    let found: std::collections::HashMap<String, String> = rows.into_iter().collect();

    assert_eq!(
        found.get(&active).map(String::as_str),
        Some("active"),
        "an active account is listed"
    );
    assert_eq!(
        found.get(&gone).map(String::as_str),
        Some("inactive"),
        "a DEACTIVATED account must still be listed, and must carry its status --          otherwise deactivation is a one-way door with no path back through the product"
    );

    pool.close().await;
}

/// The audit outbox must survive a restart.
///
/// `AuditOutbox::record` writes to an in-process `RwLock<HashMap>` and nothing
/// else. `record_durable` writes the same event *and* persists it to
/// `audit_outbox_events`. Until 2026-08-20 every one of the 14 call sites --
/// emergency break-glass grants, access-control changes, RBAC changes, device
/// lifecycle, identity claims, mobile record access -- called `record`, and
/// discarded the result with `let _ =`.
///
/// So the audit outbox was entirely in-process: those events vanished on every
/// deploy, and a failed write told nobody. `record_durable` already existed,
/// fully written and correct, with **zero callers**. This test exists so that
/// cannot silently become true again.
#[tokio::test]
async fn test_pg_audit_outbox_event_survives_a_restart() {
    let pool = get_test_pool().await;
    let outbox = crate::audit_outbox::AuditOutbox::new();

    let aggregate_id = format!("grant-{}", uuid::Uuid::new_v4());
    let event = outbox
        .record_durable(
            Some(&pool),
            "emergency_grant_issued".to_string(),
            "emergency_grant".to_string(),
            aggregate_id.clone(),
            serde_json::json!({ "organization_id": "ORG-TEST", "device_id": "DEV-TEST" }),
            chrono::Utc::now(),
        )
        .await
        .expect("durable audit write must succeed against a live schema");

    // A brand-new outbox stands in for the process after a restart: its
    // in-memory map is empty, so anything readable now came from PostgreSQL.
    let after_restart = crate::audit_outbox::AuditOutbox::new();
    assert!(
        after_restart.pending().is_empty(),
        "a fresh outbox starts empty -- otherwise this test proves nothing"
    );

    let (event_type, aggregate_type, payload_hash): (String, String, String) = sqlx::query_as(
        "SELECT event_type, aggregate_type, payload_hash
         FROM audit_outbox_events WHERE id = $1",
    )
    .bind(&event.id)
    .fetch_one(&pool)
    .await
    .expect("the event must be readable from PostgreSQL after the process is gone");

    assert_eq!(event_type, "emergency_grant_issued");
    assert_eq!(aggregate_type, "emergency_grant");
    assert_eq!(
        payload_hash, event.payload_hash,
        "the persisted hash must match the recorded one, or the row cannot          evidence what was actually audited"
    );

    pool.close().await;
}

/// A malformed event is refused rather than silently recorded.
#[tokio::test]
async fn test_pg_audit_outbox_rejects_an_event_with_no_identity() {
    let pool = get_test_pool().await;
    let outbox = crate::audit_outbox::AuditOutbox::new();

    let result = outbox
        .record_durable(
            Some(&pool),
            String::new(),
            "emergency_grant".to_string(),
            "some-id".to_string(),
            serde_json::json!({}),
            chrono::Utc::now(),
        )
        .await;

    assert!(
        result.is_err(),
        "an audit event with no type has no evidentiary value and must be refused"
    );

    pool.close().await;
}
