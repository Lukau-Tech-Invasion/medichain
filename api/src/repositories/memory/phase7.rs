//! In-memory repositories for Phase-7 generic JSON-record feature domains.
//!
//! A single `MemoryJsonRecordRepository` type backs every Phase-7 domain; the
//! `RepositoryContainer` holds one independent instance per domain (each with its
//! own HashMap). See `traits::JsonRecordRepository`.

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::{
    JsonRecordEntity, JsonRecordRepository, RepositoryError, RepositoryResult,
};

/// In-memory JSON-record repository (one instance per Phase-7 domain).
#[derive(Debug, Default)]
pub struct MemoryJsonRecordRepository {
    data: RwLock<HashMap<String, JsonRecordEntity>>,
}

impl MemoryJsonRecordRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Renders a JSON value the way PostgreSQL's `->>` operator does.
///
/// The guard in `replace_if_field_eq` compares a JSON field against a string,
/// and the PostgreSQL implementation gets that string from `data ->> $4`, which
/// yields the TEXT form of any scalar: the number 0 becomes "0", `true` becomes
/// "true", and only JSON null yields NULL.
///
/// This used to be `v.as_str()`, which returns `None` for anything that is not
/// a JSON string. Guarding on a string field therefore worked and guarding on a
/// numeric one silently never matched -- the two backends disagreed about a
/// primitive whose entire purpose is atomic state transition.
///
/// It surfaced when dispensing began guarding on `dispensed_quantity`: every
/// fill on the memory backend was refused as a race that had not happened,
/// while PostgreSQL was correct. Parity here is not cosmetic; the memory
/// backend is the documented default for dev and demo.
fn json_field_as_text(value: Option<&serde_json::Value>) -> Option<String> {
    match value? {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

#[async_trait]
impl JsonRecordRepository for MemoryJsonRecordRepository {
    async fn create(&self, mut record: JsonRecordEntity) -> RepositoryResult<JsonRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        record.updated_at = Utc::now();
        // Upsert by id: re-inserting the same id replaces (preserves original created_at).
        if let Some(existing) = data.get(&record.id) {
            record.created_at = existing.created_at;
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<JsonRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.get(id).cloned())
    }

    async fn get_by_owner(&self, owner_id: &str) -> RepositoryResult<Vec<JsonRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.owner_id == owner_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.created_at));
        Ok(items)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<JsonRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data.values().cloned().collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.created_at));
        Ok(items)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.remove(id);
        Ok(())
    }

    async fn replace_if_field_eq(
        &self,
        id: &str,
        field: &str,
        expected: &str,
        mut record: JsonRecordEntity,
    ) -> RepositoryResult<Option<JsonRecordEntity>> {
        // Read the guard and perform the write under one write lock, so this
        // matches the PostgreSQL statement's atomicity rather than merely its
        // return type. Taking a read lock first would reintroduce exactly the
        // read-modify-write race the method exists to remove.
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;

        let Some(existing) = data.get(id) else {
            return Ok(None);
        };
        if json_field_as_text(existing.data.get(field)).as_deref() != Some(expected) {
            return Ok(None);
        }

        record.id = id.to_string();
        record.created_at = existing.created_at;
        record.updated_at = Utc::now();
        data.insert(record.id.clone(), record.clone());
        Ok(Some(record))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The guard must work on numbers, not only strings.
    ///
    /// PostgreSQL's `->>` renders any scalar as text, so guarding on a numeric
    /// field is legitimate and the dispensing workflow depends on it: the
    /// running dispensed quantity is what makes concurrent fills safe. The
    /// memory implementation used `as_str()`, which returns None for a number,
    /// so every guarded numeric transition failed as a race that never
    /// happened -- on the backend that is the documented dev/demo default.
    #[tokio::test]
    async fn the_field_guard_matches_numbers_the_way_postgres_does() {
        let repo = MemoryJsonRecordRepository::new();
        let mut e = entity("rx-1", "pat-1");
        e.data = json!({ "dispensed_quantity": 0, "status": "InProgress" });
        repo.create(e.clone()).await.unwrap();

        let mut updated = e.clone();
        updated.data = json!({ "dispensed_quantity": 5, "status": "PartialFill" });

        // "0" is what `data ->> 'dispensed_quantity'` yields for the number 0.
        let ok = repo
            .replace_if_field_eq("rx-1", "dispensed_quantity", "0", updated.clone())
            .await
            .unwrap();
        assert!(
            ok.is_some(),
            "a numeric guard must match its text rendering"
        );

        // And the stale value must now fail, which is what makes it a guard.
        let stale = repo
            .replace_if_field_eq("rx-1", "dispensed_quantity", "0", updated)
            .await
            .unwrap();
        assert!(
            stale.is_none(),
            "the guard must refuse a stale expected value"
        );
    }

    #[tokio::test]
    async fn the_field_guard_still_matches_strings_and_booleans() {
        let repo = MemoryJsonRecordRepository::new();
        let mut e = entity("rx-2", "pat-1");
        e.data = json!({ "status": "Signed", "controlled": true });
        repo.create(e.clone()).await.unwrap();

        assert!(
            repo.replace_if_field_eq("rx-2", "status", "Signed", e.clone())
                .await
                .unwrap()
                .is_some(),
            "string fields must keep working"
        );
        assert!(
            repo.replace_if_field_eq("rx-2", "controlled", "true", e)
                .await
                .unwrap()
                .is_some(),
            "booleans render as their literal, as `->>` does"
        );
    }

    fn entity(id: &str, owner: &str) -> JsonRecordEntity {
        JsonRecordEntity {
            id: id.to_string(),
            owner_id: owner.to_string(),
            data: json!({ "hello": "world" }),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn create_get_and_upsert() {
        let repo = MemoryJsonRecordRepository::new();
        repo.create(entity("a", "user1")).await.unwrap();

        // Upsert: re-inserting the same id replaces the payload.
        let mut e2 = entity("a", "user1");
        e2.data = json!({ "hello": "again" });
        repo.create(e2).await.unwrap();

        let got = repo.get_by_id("a").await.unwrap().unwrap();
        assert_eq!(got.data["hello"], "again");
        assert!(repo.get_by_id("missing").await.unwrap().is_none());
    }

    /// The interleaving that a read-modify-write cannot survive.
    ///
    /// Both callers read the record while it says `Pending` -- that is the
    /// whole point, and it is what two concurrent HTTP requests do. Whichever
    /// writes second must lose. With the plain `create` upsert both writes
    /// succeed and the later one silently replaces the earlier decision, so
    /// this test fails against that implementation.
    #[tokio::test]
    async fn second_writer_loses_when_both_read_the_same_state() {
        let repo = MemoryJsonRecordRepository::new();
        let mut pending = entity("sub-1", "PAT-1");
        pending.data = json!({ "status": "Pending", "reviewed_by": null });
        repo.create(pending.clone()).await.unwrap();

        // Both callers hold a copy taken while the stored status was Pending.
        let mut approval = pending.clone();
        approval.data = json!({ "status": "Approved", "reviewed_by": "doctor_b" });
        let mut rejection = pending.clone();
        rejection.data = json!({ "status": "Rejected", "reviewed_by": "doctor_c" });

        let first = repo
            .replace_if_field_eq("sub-1", "status", "Pending", approval)
            .await
            .unwrap();
        assert!(first.is_some(), "the first writer commits");

        let second = repo
            .replace_if_field_eq("sub-1", "status", "Pending", rejection)
            .await
            .unwrap();
        assert!(second.is_none(), "the second writer must lose");

        let stored = repo.get_by_id("sub-1").await.unwrap().unwrap();
        assert_eq!(stored.data["status"], "Approved");
        assert_eq!(stored.data["reviewed_by"], "doctor_b");
    }

    /// A guard that does not hold must leave the record byte-for-byte alone,
    /// not merely report failure.
    #[tokio::test]
    async fn a_failed_guard_writes_nothing() {
        let repo = MemoryJsonRecordRepository::new();
        let mut approved = entity("sub-2", "PAT-1");
        approved.data = json!({ "status": "Approved" });
        repo.create(approved).await.unwrap();

        let mut attempt = entity("sub-2", "PAT-1");
        attempt.data = json!({ "status": "Rejected" });
        assert!(repo
            .replace_if_field_eq("sub-2", "status", "Pending", attempt)
            .await
            .unwrap()
            .is_none());

        assert_eq!(
            repo.get_by_id("sub-2").await.unwrap().unwrap().data["status"],
            "Approved"
        );

        // A missing record is a failed guard, not an insert.
        let mut ghost = entity("sub-absent", "PAT-1");
        ghost.data = json!({ "status": "Approved" });
        assert!(repo
            .replace_if_field_eq("sub-absent", "status", "Pending", ghost)
            .await
            .unwrap()
            .is_none());
        assert!(repo.get_by_id("sub-absent").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn get_by_owner_and_list_all() {
        let repo = MemoryJsonRecordRepository::new();
        repo.create(entity("a", "user1")).await.unwrap();
        repo.create(entity("b", "user1")).await.unwrap();
        repo.create(entity("c", "user2")).await.unwrap();

        assert_eq!(repo.get_by_owner("user1").await.unwrap().len(), 2);
        assert_eq!(repo.get_by_owner("user2").await.unwrap().len(), 1);
        assert_eq!(repo.list_all().await.unwrap().len(), 3);
    }
}
