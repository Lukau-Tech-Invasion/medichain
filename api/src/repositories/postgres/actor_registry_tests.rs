//! The actor-column registry (`actor_column_registry`, migration 20260930000001).
//!
//! `users.id` is the only identifier of a user, and every column that can hold
//! one has to be known to the identity migration: a column nobody declared is a
//! column whose pre-account identifiers nobody remapped. These tests fail when a new
//! migration adds an actor-like column, or any JSONB column, without declaring it.
//! `scripts/check-actor-columns.py` is the same rule applied to the migration
//! files before a database exists.

use super::tests::get_test_pool;

/// The same pattern `scripts/check-actor-columns.py` uses. A column whose name
/// matches is presumed to hold an actor until the registry or the allowlist below
/// says otherwise.
const ACTOR_LIKE: &str = "(_by$|_by_[a-z]+$|provider_id$|^provider$|_provider$|clinician_id$|owner_id$|^actor$|accessor_id$|user_id$|physician_id$|pathologist_id$|radiologist_id$|surgeon_id$|anesthesiologist_id$|psychiatrist_id$|crna_id$|prescriber_id$|collector_id$|technologist_id$|custodian_id$|assistant_id$|intubator_id$|reporter_id$|primary_nurse$|scrub_nurse_id$|circulating_nurse_id$|requesting_provider$|requesting_person_id$|^subject$|assigned_to$|nurse$|_nurse_id$|doctor$|_doctor_id$|recorded_by|performed_by)";

/// Columns the pattern catches that are not actors, each with the reason.
const NOT_ACTORS: [(&str, &str, &str); 8] = [
    (
        "adherence_logs",
        "reported_by",
        "'patient' or 'caregiver', a kind of reporter",
    ),
    ("device_keys", "replaced_by", "a device key id"),
    (
        "guardian_relationships",
        "authority_verified_by_role",
        "a role name",
    ),
    (
        "immunization_records",
        "administered_by_name",
        "a display name",
    ),
    ("key_envelopes", "superseded_by", "an envelope id"),
    (
        "obstetric_emergencies",
        "prenatal_care_provider",
        "a free-text provider name",
    ),
    ("organization_keys", "replaced_by", "an organisation key id"),
    (
        "splint_cast_records",
        "follow_up_provider",
        "a free-text provider name",
    ),
];

/// Columns that look like actors or hold JSON and are not in the registry.
async fn unregistered(pool: &sqlx::PgPool) -> Vec<(String, String)> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT c.table_name::text, c.column_name::text
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          AND t.table_type = 'BASE TABLE'
         WHERE c.table_schema = current_schema()
           AND ((c.data_type IN ('text', 'character varying', 'uuid') AND c.column_name ~ $1)
                OR c.data_type = 'jsonb')
           AND NOT EXISTS (SELECT 1 FROM actor_column_registry g
                           WHERE g.table_name = c.table_name AND g.column_name = c.column_name)
         ORDER BY 1, 2",
    )
    .bind(ACTOR_LIKE)
    .fetch_all(pool)
    .await
    .expect("read schema");
    rows.into_iter()
        .filter(|(table, column)| !NOT_ACTORS.iter().any(|(t, c, _)| t == table && c == column))
        .collect()
}

#[tokio::test]
async fn every_actor_like_column_is_in_the_registry() {
    let pool = get_test_pool().await;
    let missing = unregistered(&pool).await;
    assert!(
        missing.is_empty(),
        "actor-like or JSONB columns missing from actor_column_registry: {missing:?}. \
         Declare each in a migration (or, if it holds no actor, in NOT_ACTORS with the reason)."
    );
    pool.close().await;
}

#[tokio::test]
async fn every_registry_row_names_a_real_column() {
    let pool = get_test_pool().await;
    let dangling: Vec<(String, String)> = sqlx::query_as(
        "SELECT g.table_name::text, g.column_name::text FROM actor_column_registry g
         WHERE NOT EXISTS (
             SELECT 1 FROM information_schema.columns c
             WHERE c.table_schema = current_schema()
               AND c.table_name = g.table_name AND c.column_name = g.column_name)",
    )
    .fetch_all(&pool)
    .await
    .expect("read registry");
    assert!(
        dangling.is_empty(),
        "registry rows with no column: {dangling:?}"
    );
    pool.close().await;
}

#[tokio::test]
async fn sealed_history_is_registered_as_sealed() {
    let pool = get_test_pool().await;
    for (table, column) in [
        ("access_logs", "accessor_id"),
        ("audit_events", "payload"),
        ("emergency_capsules", "capsule_encrypted"),
    ] {
        let sealed: Option<bool> = sqlx::query_scalar(
            "SELECT sealed FROM actor_column_registry WHERE table_name = $1 AND column_name = $2",
        )
        .bind(table)
        .bind(column)
        .fetch_optional(&pool)
        .await
        .expect("read registry");
        assert_eq!(
            sealed,
            Some(true),
            "{table}.{column} must never be rewritten"
        );
    }
    pool.close().await;
}

#[tokio::test]
async fn a_registry_row_that_names_a_foreign_key_has_one() {
    let pool = get_test_pool().await;
    let unenforced: Vec<(String, String)> = sqlx::query_as(
        "SELECT g.table_name::text, g.column_name::text FROM actor_column_registry g
         WHERE g.fk IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM pg_constraint con
             JOIN pg_class rel ON rel.oid = con.conrelid
             JOIN pg_namespace ns ON ns.oid = rel.relnamespace
             JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
             WHERE con.contype = 'f' AND ns.nspname = current_schema()
               AND rel.relname = g.table_name AND att.attname = g.column_name)",
    )
    .fetch_all(&pool)
    .await
    .expect("read constraints");
    assert!(
        unenforced.is_empty(),
        "declared foreign keys that do not exist: {unenforced:?}"
    );
    pool.close().await;
}

#[tokio::test]
async fn the_directory_resolves_only_current_user_ids() {
    let pool = get_test_pool().await;
    let user = crate::test_fixtures::insert_pg_user(&pool, "Doctor").await;
    let unknown = format!("5Legacy{}", uuid::Uuid::new_v4().simple());

    let by_id = crate::actor_directory::resolve(&pool, &user).await.unwrap();
    assert_eq!(by_id.map(|id| id.to_string()), Some(user.clone()));
    let by_old_key = crate::actor_directory::resolve(&pool, &unknown)
        .await
        .unwrap();
    assert_eq!(by_old_key, None, "a non-account key names nobody");

    let keys = crate::actor_directory::actor_keys_for(&pool, &user)
        .await
        .unwrap();
    assert_eq!(keys, vec![user.clone()]);
    let mapped = crate::actor_directory::user_ids_for_keys(&pool, &[user.clone(), unknown])
        .await
        .unwrap();
    assert_eq!(mapped.len(), 1);
    assert_eq!(mapped.get(&user), Some(&user));
    pool.close().await;
}

#[tokio::test]
async fn a_migrated_database_has_no_seeded_or_legacy_identity_state() {
    let pool = get_test_pool().await;
    let relations: Vec<String> = sqlx::query_scalar(
        "SELECT c.relname::text FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema()
           AND c.relname IN ('actor_directory', 'bootstrap_legacy_demo_seeds')",
    )
    .fetch_all(&pool)
    .await
    .expect("read relations");
    assert!(relations.is_empty(), "{relations:?}");
    let login_fn: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = current_schema() AND p.proname = 'update_login_info')",
    )
    .fetch_one(&pool)
    .await
    .expect("read functions");
    assert!(!login_fn, "the retired login function must not exist");
    let seeded: i64 = sqlx::query_scalar(
        "SELECT (SELECT count(*) FROM users
                 WHERE login_id IS NULL AND credential_verifier IS NULL
                   AND username = ANY(ARRAY['admin', 'judge', 'dr.mbeki', 'dr.khumalo',
                     'dr.nkosi', 'nurse.dlamini', 'nurse.molefe', 'lab.mokoena',
                     'pharm.sithole', 'patient.zulu', 'patient.mkhize', 'patient.ndaba']))
              + (SELECT count(*) FROM patients WHERE id LIKE 'PAT-%-DEMO')
              + (SELECT count(*) FROM medical_id_issuances WHERE medical_id LIKE 'MCHI-%-DEMO')",
    )
    .fetch_one(&pool)
    .await
    .expect("count seeded identities");
    assert_eq!(
        seeded, 0,
        "migrations must not seed accounts, patients or medical IDs"
    );
    pool.close().await;
}

#[tokio::test]
async fn an_access_log_is_found_through_the_persons_user_id() {
    use crate::repositories::traits::{AccessLogEntity, Pagination};
    let pool = get_test_pool().await;
    let repositories = crate::repositories::RepositoryContainer::new_postgres(pool.clone())
        .await
        .unwrap();
    let user = crate::test_fixtures::insert_pg_user(&pool, "Doctor").await;

    let mut ids = Vec::new();
    for accessor in [&user, &user] {
        let id = format!("AUD-{}", uuid::Uuid::new_v4());
        ids.push(id.clone());
        repositories
            .access_logs
            .create(AccessLogEntity {
                id,
                accessor_id: accessor.clone(),
                accessor_role: "Doctor".into(),
                patient_id: None,
                resource_type: "medical_record".into(),
                resource_id: None,
                action: "prescription_dispensed".to_string(),
                access_reason: None,
                is_emergency_access: false,
                ip_address: None,
                user_agent: None,
                accessed_at: chrono::Utc::now(),
                facility_id: None,
                authority_type: None,
                authority_id: None,
            })
            .await
            .unwrap();
    }

    let keys = crate::actor_directory::actor_keys_for(&pool, &user)
        .await
        .unwrap();
    let found = repositories
        .access_logs
        .get_by_accessor(&keys, Pagination::new(0, 50))
        .await
        .unwrap();
    let mut found_ids: Vec<String> = found.items.into_iter().map(|log| log.id).collect();
    found_ids.sort();
    ids.sort();
    assert_eq!(
        found_ids, ids,
        "every row written under the person's user id is found"
    );
    pool.close().await;
}
