//! Offline sync conflicts.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::common::RepositoryResult;

/// Sync conflict entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct SyncConflictEntity {
    pub id: String,
    pub sync_operation_id: Option<String>,
    pub entity_type: String,
    pub entity_id: String,
    pub patient_id: Option<String>,
    pub conflict_type: String,
    pub field_name: Option<String>,
    pub local_value: Option<String>,
    pub remote_value: Option<String>,
    pub local_timestamp: Option<chrono::DateTime<chrono::Utc>>,
    pub remote_timestamp: Option<chrono::DateTime<chrono::Utc>>,
    pub local_version: Option<i32>,
    pub remote_version: Option<i32>,
    pub status: Option<String>,
    pub resolution_strategy: Option<String>,
    pub resolved_value: Option<String>,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<chrono::DateTime<chrono::Utc>>,
    pub resolution_notes: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Sync conflict repository trait
#[async_trait]
pub trait SyncConflictRepository: Send + Sync {
    async fn create(&self, conflict: SyncConflictEntity) -> RepositoryResult<SyncConflictEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<SyncConflictEntity>;
    async fn get_by_operation(
        &self,
        operation_id: &str,
    ) -> RepositoryResult<Vec<SyncConflictEntity>>;
    async fn get_pending(&self) -> RepositoryResult<Vec<SyncConflictEntity>>;
    async fn resolve(
        &self,
        id: &str,
        resolved_value: &str,
        resolved_by: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<SyncConflictEntity>;
    async fn get_by_entity(
        &self,
        entity_type: &str,
        entity_id: &str,
    ) -> RepositoryResult<Vec<SyncConflictEntity>>;

    /// Get conflicts that can be auto-resolved
    async fn get_auto_resolvable(&self) -> RepositoryResult<Vec<SyncConflictEntity>>;
}
