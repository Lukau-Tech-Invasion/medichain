//! Medical records.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{DateRange, PaginatedResult, Pagination, RepositoryResult};

/// Medical record entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MedicalRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub record_type: String,
    pub category: Option<String>,
    pub ipfs_content_hash: Option<String>,
    pub ipfs_metadata_hash: Option<String>,
    pub content_checksum: Option<String>,
    #[serde(skip_serializing)]
    pub summary_encrypted: Option<Vec<u8>>,
    pub record_date: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub created_by: String,
    pub last_modified_by: String,
    pub facility_id: Option<String>,
    pub is_active: bool,
    pub is_locked: bool,
}

/// Medical record repository trait
#[async_trait]
pub trait MedicalRecordRepository: Send + Sync + fmt::Debug {
    /// Create a new medical record
    async fn create(&self, record: MedicalRecordEntity) -> RepositoryResult<MedicalRecordEntity>;

    /// Get record by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<MedicalRecordEntity>;

    /// Get all records for a patient
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicalRecordEntity>>;

    /// Get records by type for a patient
    async fn get_by_patient_and_type(
        &self,
        patient_id: &str,
        record_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicalRecordEntity>>;

    /// Get record by IPFS hash
    async fn get_by_ipfs_hash(&self, ipfs_hash: &str) -> RepositoryResult<MedicalRecordEntity>;
    /// Total records across all patients — the administrator analytics count.
    /// Deliberately has no default implementation; see the note on
    /// `list_all` for why a failing default is worse than none.
    async fn count(&self) -> RepositoryResult<u64>;

    /// Update record
    async fn update(&self, record: MedicalRecordEntity) -> RepositoryResult<MedicalRecordEntity>;

    /// Delete record (soft delete)
    async fn delete(&self, id: &str) -> RepositoryResult<()>;

    /// Lock record (prevent modifications)
    async fn lock(&self, id: &str) -> RepositoryResult<()>;

    /// Get records created within date range
    async fn get_by_date_range(
        &self,
        patient_id: &str,
        range: DateRange,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicalRecordEntity>>;
}
