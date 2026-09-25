//! Behavioral contract shared by generic JSON repositories on every backend.

use super::{JsonRecordEntity, JsonRecordRepository};
use chrono::{Duration, Utc};

fn record(id: String, owner: &str, data: serde_json::Value, age_seconds: i64) -> JsonRecordEntity {
    let timestamp = Utc::now() - Duration::seconds(age_seconds);
    JsonRecordEntity {
        id,
        owner_id: owner.to_string(),
        data,
        created_at: timestamp,
        updated_at: timestamp,
    }
}

/// Exercises semantics relied on by state machines, not implementation details.
pub(crate) async fn run_json_record_contract(repo: &dyn JsonRecordRepository, prefix: &str) {
    let base_id = format!("{prefix}-base-{}", uuid::Uuid::new_v4());
    let owner = format!("{prefix}-owner-{}", uuid::Uuid::new_v4());
    let original = record(
        base_id.clone(),
        &owner,
        serde_json::json!({
            "string": "Pending", "number": 7, "boolean": true,
            "null_value": null, "nested": { "status": "Required" }
        }),
        30,
    );
    let created_at = repo.create(original.clone()).await.unwrap().created_at;
    assert!(repo.get_by_id("definitely-absent").await.unwrap().is_none());

    assert_scalar_guards(repo, &base_id, &original).await;
    assert_null_guards(repo, &base_id, &original).await;
    assert_upsert_and_ordering(repo, prefix, &base_id, &owner, &original, created_at).await;

    repo.delete(&base_id).await.unwrap();
    repo.delete(&base_id).await.unwrap();
    assert!(repo.get_by_id(&base_id).await.unwrap().is_none());
}

async fn assert_scalar_guards(
    repo: &dyn JsonRecordRepository,
    id: &str,
    original: &JsonRecordEntity,
) {
    for (field, expected) in [
        ("string", "Pending"),
        ("number", "7"),
        ("boolean", "true"),
        ("nested.status", "Required"),
    ] {
        let mut replacement = original.clone();
        replacement.data["last_guard"] = serde_json::Value::String(field.to_string());
        assert!(repo
            .replace_if_field_eq(id, field, expected, replacement)
            .await
            .unwrap()
            .is_some());
    }
}

async fn assert_null_guards(
    repo: &dyn JsonRecordRepository,
    id: &str,
    original: &JsonRecordEntity,
) {
    for field in ["null_value", "absent", "nested.absent"] {
        assert!(repo
            .replace_if_field_eq(id, field, "null", original.clone())
            .await
            .unwrap()
            .is_none());
    }
}

async fn assert_upsert_and_ordering(
    repo: &dyn JsonRecordRepository,
    prefix: &str,
    id: &str,
    owner: &str,
    original: &JsonRecordEntity,
    created_at: chrono::DateTime<Utc>,
) {
    let mut upsert = original.clone();
    upsert.owner_id = format!("{owner}-moved");
    upsert.data["string"] = serde_json::Value::String("Approved".into());
    let stored = repo.create(upsert).await.unwrap();
    assert_eq!(
        stored.created_at, created_at,
        "upsert must preserve creation time"
    );
    assert_eq!(stored.owner_id, format!("{owner}-moved"));

    let newest_id = format!("{prefix}-newest-{}", uuid::Uuid::new_v4());
    repo.create(record(
        newest_id.clone(),
        owner,
        serde_json::json!({"status": "Pending"}),
        0,
    ))
    .await
    .unwrap();
    let older_id = format!("{prefix}-older-{}", uuid::Uuid::new_v4());
    repo.create(record(
        older_id,
        owner,
        serde_json::json!({"status": "Pending"}),
        60,
    ))
    .await
    .unwrap();
    assert_eq!(repo.get_by_owner(owner).await.unwrap()[0].id, newest_id);

    assert!(repo.get_by_id(id).await.unwrap().is_some());
}

/// Both generic repositories promise the same explicit 1,000-row read bound.
pub(crate) async fn run_json_record_limit_contract(repo: &dyn JsonRecordRepository, prefix: &str) {
    let owner = format!("{prefix}-limit-owner-{}", uuid::Uuid::new_v4());
    for index in 0..1001 {
        repo.create(record(
            format!("{prefix}-limit-{index}-{}", uuid::Uuid::new_v4()),
            &owner,
            serde_json::json!({"index": index}),
            index,
        ))
        .await
        .unwrap();
    }
    assert_eq!(repo.get_by_owner(&owner).await.unwrap().len(), 1000);
    assert_eq!(repo.list_all().await.unwrap().len(), 1000);
}
