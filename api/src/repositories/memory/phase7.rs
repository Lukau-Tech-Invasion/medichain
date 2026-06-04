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
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(items)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<JsonRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data.values().cloned().collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
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
