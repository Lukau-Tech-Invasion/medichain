//! The actor-column registry (`actor_column_registry`, migration 20260930000001).
//!
//! `users.id` is the only identifier of a user, and every column that can hold
//! one has to be known to the identity migration: a column nobody declared is a
//! column whose old wallet strings nobody remapped. These tests fail when a new
//! migration adds an actor-like column, or any JSONB column, without declaring it.
//! `scripts/check-actor-columns.py` is the same rule applied to the migration
//! files before a database exists.

use super::tests::get_test_pool;

/// The same pattern `scripts/check-actor-columns.py` uses. A column whose name
/// matches is presumed to hold an actor until the registry or the allowlist below
/// says otherwise.
const ACTOR_LIKE: &str = "(_by$|_by_[a-z]+$|provider_id$|^provider$|_provider$|clinician_id$|owner_id$|^actor$|accessor_id$|user_id$|wallet|physician_id$|pathologist_id$|radiologist_id$|surgeon_id$|anesthesiologist_id$|psychiatrist_id$|crna_id$|prescriber_id$|collector_id$|technologist_id$|custodian_id$|assistant_id$|intubator_id$|reporter_id$|primary_nurse$|scrub_nurse_id$|circulating_nurse_id$|requesting_provider$|requesting_person_id$|^subject$|assigned_to$|nurse$|_nurse_id$|doctor$|_doctor_id$|recorded_by|performed_by)";

/// Columns the pattern catches that are not actors, each with the reason.
const NOT_ACTORS: [(&str, &str, &str); 10] = [
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
        "legacy_wallet_identities",
        "user_id",
        "the mapping's own target",
    ),
    (
        "legacy_wallet_identities",
        "wallet_address",
        "the mapping's own key",
    ),
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
async fn the_directory_resolves_current_and_legacy_keys_to_one_person() {
    let pool = get_test_pool().await;
    let user = crate::test_fixtures::insert_pg_user(&pool, "Doctor").await;
    let wallet = format!("5Legacy{}", uuid::Uuid::new_v4().simple());
    sqlx::query(
        "INSERT INTO legacy_wallet_identities (wallet_address, user_id, kind) VALUES ($1, $2::uuid, 'wallet')",
    )
    .bind(&wallet)
    .bind(&user)
    .execute(&pool)
    .await
    .expect("seed historical identity");

    let by_id = crate::actor_directory::resolve(&pool, &user).await.unwrap();
    let by_wallet = crate::actor_directory::resolve(&pool, &wallet)
        .await
        .unwrap();
    assert_eq!(by_id, by_wallet);
    assert_eq!(by_id.map(|id| id.to_string()), Some(user.clone()));

    let keys = crate::actor_directory::actor_keys_for(&pool, &user)
        .await
        .unwrap();
    assert_eq!(keys, vec![user, wallet]);
    pool.close().await;
}

#[tokio::test]
async fn a_pre_migration_access_log_is_found_through_the_persons_legacy_key() {
    use crate::repositories::traits::{AccessLogEntity, Pagination};
    let pool = get_test_pool().await;
    let repositories = crate::repositories::RepositoryContainer::new_postgres(pool.clone())
        .await
        .unwrap();
    let user = crate::test_fixtures::insert_pg_user(&pool, "Doctor").await;
    let wallet = format!("5Legacy{}", uuid::Uuid::new_v4().simple());
    sqlx::query(
        "INSERT INTO legacy_wallet_identities (wallet_address, user_id, kind) VALUES ($1, $2::uuid, 'wallet')",
    )
    .bind(&wallet)
    .bind(&user)
    .execute(&pool)
    .await
    .expect("seed historical identity");

    let mut ids = Vec::new();
    for accessor in [&wallet, &user] {
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
        "both the sealed wallet row and the new row are this person's"
    );
    pool.close().await;
}
