//! Retention policies and retention job runs.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::common::RepositoryResult;

/// Data retention policy entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct DataRetentionPolicyEntity {
    pub id: String,
    pub policy_name: String,
    pub entity_type: String,
    pub retention_period_days: i32,
    /// Retention period in whole years — the value the evaluator uses.
    /// `retention_period_days` cannot express a legally-defined period like
    /// "6 years" exactly once leap years are involved (migration
    /// 20260729000003).
    pub retention_period_years: Option<i32>,
    /// `RetentionRule` discriminant: `years_from_last_entry`,
    /// `years_from_event`, `later_of_age_or_years_from_last_entry`, `lifetime`.
    pub retention_rule_kind: Option<String>,
    /// Age threshold for age-based rules (e.g. 21 for "until the 21st birthday").
    pub minimum_age_years: Option<i32>,
    /// Human-readable citation for the period.
    pub legal_source: Option<String>,
    pub retention_period_type: Option<String>,
    pub archive_after_days: Option<i32>,
    pub delete_after_days: Option<i32>,
    pub applies_to_status: Option<serde_json::Value>,
    pub department: Option<String>,
    pub exceptions: Option<serde_json::Value>,
    pub legal_hold_override: Option<bool>,
    pub regulatory_basis: Option<String>,
    pub review_frequency_days: Option<i32>,
    pub last_reviewed_date: Option<chrono::NaiveDate>,
    pub reviewed_by: Option<String>,
    pub is_active: Option<bool>,
    pub effective_date: chrono::NaiveDate,
    pub end_date: Option<chrono::NaiveDate>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Data retention policy repository trait
#[async_trait]
pub trait DataRetentionPolicyRepository: Send + Sync {
    async fn create(
        &self,
        policy: DataRetentionPolicyEntity,
    ) -> RepositoryResult<DataRetentionPolicyEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<DataRetentionPolicyEntity>;
    async fn get_by_entity_type(
        &self,
        entity_type: &str,
    ) -> RepositoryResult<Vec<DataRetentionPolicyEntity>>;
    async fn get_active(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>>;
    async fn update(
        &self,
        policy: DataRetentionPolicyEntity,
    ) -> RepositoryResult<DataRetentionPolicyEntity>;
    async fn deactivate(&self, id: &str) -> RepositoryResult<DataRetentionPolicyEntity>;

    /// Get policies due for review
    async fn get_due_for_review(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>>;

    /// Get policies due for execution
    async fn get_due_for_execution(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>>;
}

/// Retention job run entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct RetentionJobRunEntity {
    pub id: String,
    pub policy_id: Option<String>,
    pub job_type: String,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub entity_type: String,
    pub date_threshold: chrono::NaiveDate,
    pub status: Option<String>,
    pub records_evaluated: Option<i32>,
    pub records_archived: Option<i32>,
    pub records_deleted: Option<i32>,
    pub records_skipped: Option<i32>,
    pub error_count: Option<i32>,
    pub error_details: Option<serde_json::Value>,
    pub run_by: Option<String>,
    pub dry_run: Option<bool>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Retention job run repository trait
#[async_trait]
pub trait RetentionJobRunRepository: Send + Sync {
    async fn create(&self, job: RetentionJobRunEntity) -> RepositoryResult<RetentionJobRunEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<RetentionJobRunEntity>;
    async fn get_by_policy(&self, policy_id: &str) -> RepositoryResult<Vec<RetentionJobRunEntity>>;
    async fn get_recent(&self, limit: i32) -> RepositoryResult<Vec<RetentionJobRunEntity>>;
    async fn update(&self, job: RetentionJobRunEntity) -> RepositoryResult<RetentionJobRunEntity>;

    /// Complete a job run
    async fn complete(
        &self,
        id: &str,
        archived: i32,
        deleted: i32,
        skipped: i32,
    ) -> RepositoryResult<RetentionJobRunEntity>;

    /// Mark a job as failed
    async fn fail(
        &self,
        id: &str,
        error_details: serde_json::Value,
    ) -> RepositoryResult<RetentionJobRunEntity>;

    /// Get jobs by status
    async fn get_by_status(&self, status: &str) -> RepositoryResult<Vec<RetentionJobRunEntity>>;

    /// Get jobs currently in progress
    async fn get_in_progress(&self) -> RepositoryResult<Vec<RetentionJobRunEntity>>;
}
