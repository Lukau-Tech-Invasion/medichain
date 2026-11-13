//! In-memory repositories for retention policies and retention job runs.

use super::lock_poisoned;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory data retention policy repository
#[derive(Debug, Default)]
pub struct MemoryDataRetentionPolicyRepository {
    records: RwLock<HashMap<String, DataRetentionPolicyEntity>>,
}

impl MemoryDataRetentionPolicyRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl DataRetentionPolicyRepository for MemoryDataRetentionPolicyRepository {
    /// Policies in force today.
    ///
    /// Mirrors the PostgreSQL predicate: active, already effective, and not
    /// past its end date.
    async fn get_due_for_execution(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let today = chrono::Utc::now().date_naive();
        let records = self.records.read().map_err(lock_poisoned)?;
        let mut items: Vec<DataRetentionPolicyEntity> = records
            .values()
            .filter(|p| {
                p.is_active.unwrap_or(false)
                    && p.effective_date <= today
                    && p.end_date.map(|d| d > today).unwrap_or(true)
            })
            .cloned()
            .collect();
        items.sort_by(|a, b| a.policy_name.cmp(&b.policy_name));
        Ok(items)
    }

    async fn create(
        &self,
        policy: DataRetentionPolicyEntity,
    ) -> RepositoryResult<DataRetentionPolicyEntity> {
        let mut records = self.records.write().map_err(lock_poisoned)?;
        records.insert(policy.id.clone(), policy.clone());
        Ok(policy)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DataRetentionPolicyEntity> {
        let records = self.records.read().map_err(lock_poisoned)?;
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Retention policy {} not found", id)))
    }

    async fn get_by_entity_type(
        &self,
        entity_type: &str,
    ) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let records = self.records.read().map_err(lock_poisoned)?;
        let items: Vec<_> = records
            .values()
            .filter(|r| r.entity_type == entity_type)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_active(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let records = self.records.read().map_err(lock_poisoned)?;
        let items: Vec<_> = records
            .values()
            .filter(|r| r.is_active.unwrap_or(false))
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(
        &self,
        policy: DataRetentionPolicyEntity,
    ) -> RepositoryResult<DataRetentionPolicyEntity> {
        let mut records = self.records.write().map_err(lock_poisoned)?;
        if !records.contains_key(&policy.id) {
            return Err(RepositoryError::NotFound(format!(
                "Retention policy {} not found",
                policy.id
            )));
        }
        records.insert(policy.id.clone(), policy.clone());
        Ok(policy)
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<DataRetentionPolicyEntity> {
        let mut records = self.records.write().map_err(lock_poisoned)?;
        let policy = records.get_mut(id).ok_or_else(|| {
            RepositoryError::NotFound(format!("Retention policy {} not found", id))
        })?;
        policy.is_active = Some(false);
        Ok(policy.clone())
    }

    async fn get_due_for_review(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let today = chrono::Utc::now().date_naive();
        let records = self.records.read().map_err(lock_poisoned)?;
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.is_active.unwrap_or(false)
                    && r.last_reviewed_date
                        .and_then(|d| {
                            r.review_frequency_days
                                .map(|f| d + chrono::Duration::days(f as i64))
                        })
                        .map(|next| next <= today)
                        .unwrap_or(true)
            })
            .cloned()
            .collect();
        Ok(items)
    }
}

/// In-memory retention job run repository
#[derive(Debug, Default)]
pub struct MemoryRetentionJobRunRepository {
    records: RwLock<HashMap<String, RetentionJobRunEntity>>,
}

impl MemoryRetentionJobRunRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl RetentionJobRunRepository for MemoryRetentionJobRunRepository {
    async fn get_by_status(&self, status: &str) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let records = self.records.read().map_err(lock_poisoned)?;
        let mut items: Vec<RetentionJobRunEntity> = records
            .values()
            .filter(|r| r.status.as_deref() == Some(status))
            .cloned()
            .collect();
        items.sort_by_key(|r| std::cmp::Reverse(r.started_at));
        Ok(items)
    }

    /// Runs that started and have not finished.
    ///
    /// Keyed on `completed_at` being absent rather than on a status string, so
    /// a run that died without updating its status is still reported as
    /// outstanding instead of silently disappearing from the queue.
    async fn get_in_progress(&self) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let records = self.records.read().map_err(lock_poisoned)?;
        Ok(records
            .values()
            .filter(|r| r.started_at.is_some() && r.completed_at.is_none())
            .cloned()
            .collect())
    }

    async fn create(&self, job: RetentionJobRunEntity) -> RepositoryResult<RetentionJobRunEntity> {
        let mut records = self.records.write().map_err(lock_poisoned)?;
        records.insert(job.id.clone(), job.clone());
        Ok(job)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<RetentionJobRunEntity> {
        let records = self.records.read().map_err(lock_poisoned)?;
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Retention job {} not found", id)))
    }

    async fn get_by_policy(&self, policy_id: &str) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let records = self.records.read().map_err(lock_poisoned)?;
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.policy_id
                    .as_ref()
                    .map(|p| p == policy_id)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_recent(&self, limit: i32) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let records = self.records.read().map_err(lock_poisoned)?;
        let mut items: Vec<_> = records.values().cloned().collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.started_at));
        items.truncate(limit as usize);
        Ok(items)
    }

    async fn update(&self, job: RetentionJobRunEntity) -> RepositoryResult<RetentionJobRunEntity> {
        let mut records = self.records.write().map_err(lock_poisoned)?;
        if !records.contains_key(&job.id) {
            return Err(RepositoryError::NotFound(format!(
                "Retention job {} not found",
                job.id
            )));
        }
        records.insert(job.id.clone(), job.clone());
        Ok(job)
    }

    async fn complete(
        &self,
        id: &str,
        archived: i32,
        deleted: i32,
        skipped: i32,
    ) -> RepositoryResult<RetentionJobRunEntity> {
        let mut records = self.records.write().map_err(lock_poisoned)?;
        let job = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Retention job {} not found", id)))?;
        job.status = Some("completed".to_string());
        job.completed_at = Some(chrono::Utc::now());
        job.records_archived = Some(archived);
        job.records_deleted = Some(deleted);
        job.records_skipped = Some(skipped);
        Ok(job.clone())
    }

    async fn fail(
        &self,
        id: &str,
        error_details: serde_json::Value,
    ) -> RepositoryResult<RetentionJobRunEntity> {
        let mut records = self.records.write().map_err(lock_poisoned)?;
        let job = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Retention job {} not found", id)))?;
        job.status = Some("failed".to_string());
        job.completed_at = Some(chrono::Utc::now());
        job.error_details = Some(error_details);
        Ok(job.clone())
    }
}
