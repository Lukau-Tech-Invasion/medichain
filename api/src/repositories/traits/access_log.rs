//! The access log and grant usage.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{DateRange, PaginatedResult, Pagination, RepositoryResult};

/// Aggregate of retained disclosure rows attributed to one patient's exact grant.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PatientGrantUsage {
    pub grant_id: String,
    pub access_count: i64,
    pub last_accessed: DateTime<Utc>,
}

/// Access log entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AccessLogEntity {
    pub id: String,
    pub accessor_id: String,
    pub accessor_role: String,
    pub patient_id: Option<String>,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub action: String,
    pub access_reason: Option<String>,
    pub is_emergency_access: bool,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub accessed_at: DateTime<Utc>,
    pub facility_id: Option<String>,
    /// What authorised this access (WP9): `self`, `guardian`, `admin`,
    /// `patient_grant`, `care_relationship`, `break_glass` or
    /// `emergency_token`. `None` on rows written before it was recorded, and
    /// on acts that are not disclosures.
    #[serde(default)]
    #[sqlx(default)]
    pub authority_type: Option<String>,
    /// The id of that authority (the grant, relationship or break-glass
    /// record), so the patient can be told "via referral from Dr X".
    #[serde(default)]
    #[sqlx(default)]
    pub authority_id: Option<String>,
}

/// Access log repository trait
#[async_trait]
pub trait AccessLogRepository: Send + Sync + fmt::Debug {
    /// Count retained disclosures by exact grant authority, excluding legacy/unlinked rows.
    async fn patient_grant_usage(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<PatientGrantUsage>>;

    /// Create access log entry
    async fn create(&self, log: AccessLogEntity) -> RepositoryResult<AccessLogEntity>;

    /// Get logs by accessor. `accessor_ids` is every key the person is known by
    /// (`actor_directory::actor_keys_for`), which is their `users.id` text form.
    async fn get_by_accessor(
        &self,
        accessor_ids: &[String],
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>>;

    /// Get logs for a patient
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>>;

    /// Get logs within date range
    async fn get_by_date_range(
        &self,
        range: DateRange,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>>;

    /// Get emergency access logs
    async fn get_emergency_accesses(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>>;

    /// List all logs
    async fn list(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>>;

    /// Search logs
    async fn search(
        &self,
        query: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>>;

    /// `(total_entries, entries_in_a_sealed_batch)`.
    ///
    /// This is the measurement behind the compliance dashboard's audit-coverage
    /// figure, which used to be the string literal `"100%"`. In a system whose
    /// central claim is a tamper-evident access trail, the share of access
    /// records actually sealed is the property an auditor is asking about, and
    /// asserting it without counting is the assertion most likely to be taken at
    /// face value. The memory backend seals nothing, so its second count is 0.
    ///
    /// Both counts come from one call so they cannot disagree.
    async fn count_sealed(&self) -> RepositoryResult<(u64, u64)>;
}
