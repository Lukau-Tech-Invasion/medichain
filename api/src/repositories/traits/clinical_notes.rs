//! Clinical notes: progress notes, history and physical, consultations.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{PaginatedResult, Pagination, RepositoryResult};

/// Progress note entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct ProgressNoteEntity {
    pub id: String,
    pub patient_id: String,
    pub note_type: String,
    pub subjective: Option<String>,
    pub objective: Option<String>,
    pub assessment: Option<String>,
    pub plan_content: Option<String>,
    pub addendum: Option<String>,
    pub cosigned_by: Option<String>,
    pub cosigned_at: Option<DateTime<Utc>>,
    pub visit_type: Option<String>,
    pub encounter_id: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
    pub status: String,
    pub is_active: bool,
    pub data: serde_json::Value,
}

/// History and physical entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct HistoryPhysicalEntity {
    pub id: String,
    pub patient_id: String,
    pub chief_complaint: String,
    pub history_present_illness: String,
    pub past_medical_history: Option<String>,
    pub family_history: Option<String>,
    pub social_history: Option<String>,
    pub medications: Option<String>,
    pub allergies: Option<String>,
    pub review_of_systems: Option<serde_json::Value>,
    pub physical_exam: serde_json::Value,
    pub vital_signs: Option<serde_json::Value>,
    pub assessment: String,
    pub plan_content: String,
    pub exam_type: Option<String>,
    pub performed_by: String,
    pub performed_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
    pub is_active: bool,
    pub data: serde_json::Value,
}

/// Consultation note entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct ConsultationNoteEntity {
    pub id: String,
    pub patient_id: String,
    pub consultation_type: String,
    pub requesting_provider: String,
    pub consulting_provider: String,
    pub reason_for_consultation: String,
    pub clinical_question: Option<String>,
    pub pertinent_history: Option<String>,
    pub examination_findings: Option<String>,
    pub recommendations: String,
    pub follow_up_plan: Option<String>,
    pub urgency: Option<String>,
    pub status: Option<String>,
    pub requested_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
    pub is_active: bool,
    pub data: serde_json::Value,
}

/// Progress note repository trait
#[async_trait]
pub trait ProgressNoteRepository: Send + Sync + fmt::Debug {
    async fn create(&self, note: ProgressNoteEntity) -> RepositoryResult<ProgressNoteEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ProgressNoteEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ProgressNoteEntity>>;
    async fn get_by_encounter(
        &self,
        encounter_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ProgressNoteEntity>>;
    async fn update(&self, note: ProgressNoteEntity) -> RepositoryResult<ProgressNoteEntity>;
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
    async fn search_by_type(
        &self,
        note_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ProgressNoteEntity>>;
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ProgressNoteEntity>>;
}

/// History and physical repository trait
#[async_trait]
pub trait HistoryPhysicalRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        history: HistoryPhysicalEntity,
    ) -> RepositoryResult<HistoryPhysicalEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<HistoryPhysicalEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<HistoryPhysicalEntity>>;
    async fn update(
        &self,
        history: HistoryPhysicalEntity,
    ) -> RepositoryResult<HistoryPhysicalEntity>;
    /// Replace the record only if nobody has written it since it was read.
    ///
    /// Compare-and-set on `updated_at`: `Ok(None)` means another write landed
    /// first and the caller's copy is stale. A signed H&P is immutable, so an
    /// unconditional read-check-write could turn a record signed in between
    /// back into a draft, or drop one of two concurrent addenda.
    async fn update_if_unchanged(
        &self,
        history: HistoryPhysicalEntity,
        expected_updated_at: DateTime<Utc>,
    ) -> RepositoryResult<Option<HistoryPhysicalEntity>>;
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
    async fn get_by_exam_type(
        &self,
        exam_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<HistoryPhysicalEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<HistoryPhysicalEntity>>;
}

/// Consultation note repository trait
#[async_trait]
pub trait ConsultationNoteRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        consultation: ConsultationNoteEntity,
    ) -> RepositoryResult<ConsultationNoteEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ConsultationNoteEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ConsultationNoteEntity>>;
    async fn get_by_provider(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ConsultationNoteEntity>>;
    async fn update(
        &self,
        consultation: ConsultationNoteEntity,
    ) -> RepositoryResult<ConsultationNoteEntity>;
    async fn get_by_status(
        &self,
        status: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ConsultationNoteEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<ConsultationNoteEntity>>;
}
