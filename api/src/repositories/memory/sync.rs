//! In-memory repositories for offline sync conflicts.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory sync conflict repository
#[derive(Debug, Default)]
pub struct MemorySyncConflictRepository {
    records: RwLock<HashMap<String, SyncConflictEntity>>,
}

impl MemorySyncConflictRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl SyncConflictRepository for MemorySyncConflictRepository {
    async fn create(&self, conflict: SyncConflictEntity) -> RepositoryResult<SyncConflictEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(conflict.id.clone(), conflict.clone());
        Ok(conflict)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SyncConflictEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Sync conflict {} not found", id)))
    }

    async fn get_by_operation(
        &self,
        operation_id: &str,
    ) -> RepositoryResult<Vec<SyncConflictEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.sync_operation_id
                    .as_ref()
                    .map(|o| o == operation_id)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_pending(&self) -> RepositoryResult<Vec<SyncConflictEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.status.as_ref().map(|s| s == "pending").unwrap_or(false))
            .cloned()
            .collect();
        Ok(items)
    }

    async fn resolve(
        &self,
        id: &str,
        resolved_value: &str,
        resolved_by: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<SyncConflictEntity> {
        let mut records = self.records.write().unwrap();
        let conflict = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Sync conflict {} not found", id)))?;
        conflict.status = Some("manually_resolved".to_string());
        conflict.resolved_value = Some(resolved_value.to_string());
        conflict.resolved_by = Some(resolved_by.to_string());
        conflict.resolved_at = Some(chrono::Utc::now());
        conflict.resolution_notes = notes.map(|n| n.to_string());
        Ok(conflict.clone())
    }

    async fn get_by_entity(
        &self,
        entity_type: &str,
        entity_id: &str,
    ) -> RepositoryResult<Vec<SyncConflictEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.entity_type == entity_type && r.entity_id == entity_id)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_auto_resolvable(&self) -> RepositoryResult<Vec<SyncConflictEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.status.as_deref() == Some("pending") && r.resolution_strategy.is_some())
            .cloned()
            .collect();
        Ok(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -------- Phase 2.2 coverage: Death/Organ/Sync/External methods --------

    #[tokio::test]
    async fn test_sync_conflict_auto_resolvable() {
        let repo = MemorySyncConflictRepository::new();

        let with_strategy = SyncConflictEntity {
            id: "CF-1".to_string(),
            entity_type: "patient".to_string(),
            entity_id: "p-1".to_string(),
            conflict_type: "field_mismatch".to_string(),
            status: Some("pending".to_string()),
            resolution_strategy: Some("latest_wins".to_string()),
            ..Default::default()
        };
        let no_strategy = SyncConflictEntity {
            id: "CF-2".to_string(),
            entity_type: "patient".to_string(),
            entity_id: "p-2".to_string(),
            conflict_type: "field_mismatch".to_string(),
            status: Some("pending".to_string()),
            resolution_strategy: None,
            ..Default::default()
        };
        let already_resolved = SyncConflictEntity {
            id: "CF-3".to_string(),
            entity_type: "patient".to_string(),
            entity_id: "p-3".to_string(),
            conflict_type: "field_mismatch".to_string(),
            status: Some("manually_resolved".to_string()),
            resolution_strategy: Some("latest_wins".to_string()),
            ..Default::default()
        };
        repo.create(with_strategy).await.unwrap();
        repo.create(no_strategy).await.unwrap();
        repo.create(already_resolved).await.unwrap();

        let resolvable = repo.get_auto_resolvable().await.unwrap();
        assert_eq!(resolvable.len(), 1);
        assert_eq!(resolvable[0].id, "CF-1");
    }
}
