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
        if existing.data.get(field).and_then(|v| v.as_str()) != Some(expected) {
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
