//! Emergency protocols: code blue, trauma, stroke, cardiac events, sepsis.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{PaginatedResult, Pagination, RepositoryResult};

/// Code Blue record entity for repository storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeBlueEntity {
    pub id: String,
    pub patient_id: String,
    /// `Option` throughout for the fields `CodeBluePage` does not collect.
    /// A resuscitation record that says the initial rhythm was `""` or that
    /// the arrest was un-witnessed, when nobody was asked, is asserting a
    /// clinical finding of its own (Rule 12). Stored as JSONB in
    /// `ep_code_blue_records.record_json`, so this needs no migration.
    pub location: Option<String>,
    pub code_called_at: i64,
    pub team_arrived_at: Option<i64>,
    pub initial_rhythm: Option<String>,
    pub witnessed: Option<bool>,
    pub outcome: String,
    pub code_leader: Option<String>,
    pub documented_by: String,
    pub documented_at: i64,
    pub data: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Trauma assessment entity for repository storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraumaAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub mechanism: String,
    pub gcs: Option<u8>,
    pub trauma_level: Option<u8>,
    pub mtp_activated: Option<bool>,
    pub disposition: Option<String>,
    pub assessed_by: String,
    pub assessed_at: i64,
    pub data: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Stroke assessment entity for repository storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrokeAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub nihss_total: Option<u8>,
    /// `StrokePage` records a CT *interpretation* in free text; it never asks
    /// whether there is blood on the scan. Deriving `hemorrhage` from that
    /// string would be the API inventing a radiology finding.
    pub stroke_type: Option<String>,
    pub tpa_eligible: Option<bool>,
    pub tpa_given: Option<bool>,
    pub hemorrhage: Option<bool>,
    pub lvo_suspected: Option<bool>,
    pub assessed_by: String,
    pub assessed_at: i64,
    pub data: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Cardiac event entity for repository storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardiacEventEntity {
    pub id: String,
    pub patient_id: String,
    pub event_type: String,
    pub cath_lab_activated: bool,
    pub pci_performed: bool,
    pub door_to_balloon_minutes: Option<u32>,
    pub documented_by: String,
    pub documented_at: i64,
    pub data: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Sepsis assessment entity for repository storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SepsisAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub severity: String,
    pub suspected_source: String,
    pub qsofa_score: u8,
    pub sofa_score: Option<u8>,
    pub vasopressors_required: bool,
    pub icu_admission: bool,
    pub assessed_by: String,
    pub assessed_at: i64,
    pub data: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Code Blue repository trait
#[async_trait]
pub trait CodeBlueRepository: Send + Sync + fmt::Debug {
    /// Create a new code blue record
    async fn create(&self, record: CodeBlueEntity) -> RepositoryResult<CodeBlueEntity>;
    /// Get a code blue record by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<CodeBlueEntity>;
    /// Get code blue records by patient
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CodeBlueEntity>>;
    /// Update a code blue record
    async fn update(&self, record: CodeBlueEntity) -> RepositoryResult<CodeBlueEntity>;
    /// Delete a code blue record
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
    /// List all code blue records
    async fn list_all(&self) -> RepositoryResult<Vec<CodeBlueEntity>>;
    /// Every record of this kind, across all patients: the admin dashboard's
    /// count, which must not be bounded by how many patients it could walk.
    async fn count_all(&self) -> RepositoryResult<u64>;
}

/// Trauma assessment repository trait
#[async_trait]
pub trait TraumaAssessmentRepository: Send + Sync + fmt::Debug {
    /// Create a new trauma assessment
    async fn create(
        &self,
        assessment: TraumaAssessmentEntity,
    ) -> RepositoryResult<TraumaAssessmentEntity>;
    /// Get a trauma assessment by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<TraumaAssessmentEntity>;
    /// Get trauma assessments by patient
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TraumaAssessmentEntity>>;
    /// Update a trauma assessment
    async fn update(
        &self,
        assessment: TraumaAssessmentEntity,
    ) -> RepositoryResult<TraumaAssessmentEntity>;
    /// Delete a trauma assessment
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
    /// Every record of this kind, across all patients: the admin dashboard's
    /// count, which must not be bounded by how many patients it could walk.
    async fn count_all(&self) -> RepositoryResult<u64>;
}

/// Stroke assessment repository trait
#[async_trait]
pub trait StrokeAssessmentRepository: Send + Sync + fmt::Debug {
    /// Create a new stroke assessment
    async fn create(
        &self,
        assessment: StrokeAssessmentEntity,
    ) -> RepositoryResult<StrokeAssessmentEntity>;
    /// Get a stroke assessment by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<StrokeAssessmentEntity>;
    /// Get stroke assessments by patient
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<StrokeAssessmentEntity>>;
    /// Update a stroke assessment
    async fn update(
        &self,
        assessment: StrokeAssessmentEntity,
    ) -> RepositoryResult<StrokeAssessmentEntity>;
    /// Delete a stroke assessment
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
    /// Every record of this kind, across all patients: the admin dashboard's
    /// count, which must not be bounded by how many patients it could walk.
    async fn count_all(&self) -> RepositoryResult<u64>;
}

/// Cardiac event repository trait
#[async_trait]
pub trait CardiacEventRepository: Send + Sync + fmt::Debug {
    /// Create a new cardiac event
    async fn create(&self, event: CardiacEventEntity) -> RepositoryResult<CardiacEventEntity>;
    /// Get a cardiac event by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<CardiacEventEntity>;
    /// Get cardiac events by patient
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CardiacEventEntity>>;
    /// Update a cardiac event
    async fn update(&self, event: CardiacEventEntity) -> RepositoryResult<CardiacEventEntity>;
    /// Delete a cardiac event
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
    /// Every record of this kind, across all patients: the admin dashboard's
    /// count, which must not be bounded by how many patients it could walk.
    async fn count_all(&self) -> RepositoryResult<u64>;
}

/// Sepsis assessment repository trait
#[async_trait]
pub trait SepsisAssessmentRepository: Send + Sync + fmt::Debug {
    /// Create a new sepsis assessment
    async fn create(
        &self,
        assessment: SepsisAssessmentEntity,
    ) -> RepositoryResult<SepsisAssessmentEntity>;
    /// Get a sepsis assessment by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<SepsisAssessmentEntity>;
    /// Get sepsis assessments by patient
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<SepsisAssessmentEntity>>;
    /// Update a sepsis assessment
    async fn update(
        &self,
        assessment: SepsisAssessmentEntity,
    ) -> RepositoryResult<SepsisAssessmentEntity>;
    /// Delete a sepsis assessment
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
    /// Every record of this kind, across all patients: the admin dashboard's
    /// count, which must not be bounded by how many patients it could walk.
    async fn count_all(&self) -> RepositoryResult<u64>;
}
