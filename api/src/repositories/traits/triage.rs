//! Triage assessments.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{PaginatedResult, Pagination, RepositoryResult};

/// Triage assessment entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TriageAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub esi_level: i32,
    pub chief_complaint: String,
    pub heart_rate: Option<i32>,
    pub respiratory_rate: Option<i32>,
    pub blood_pressure_systolic: Option<i32>,
    pub blood_pressure_diastolic: Option<i32>,
    pub temperature: Option<f64>,
    pub oxygen_saturation: Option<i32>,
    pub pain_scale: Option<i32>,
    pub gcs_score: Option<i32>,
    /// mmol/L.
    pub blood_glucose: Option<f64>,
    pub weight: Option<f64>,
    pub is_critical: bool,
    pub requires_isolation: bool,
    /// Where the patient went. NOT the triage note — the queue used to read
    /// this in the note's place, and the create path never sets it.
    pub disposition: Option<String>,
    pub assigned_bed: Option<String>,
    /// The free-text triage note, which had no column at all until
    /// `20260910000002`. `CreateTriageRequest` has always carried it and the
    /// handler has always validated its length; both then dropped it.
    #[serde(default)]
    pub notes: Option<String>,
    pub triage_time: DateTime<Utc>,
    pub seen_by_provider_at: Option<DateTime<Utc>>,
    pub performed_by: String,
    pub facility_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Triage assessment repository trait
#[async_trait]
pub trait TriageAssessmentRepository: Send + Sync + fmt::Debug {
    /// Create new triage assessment
    async fn create(
        &self,
        assessment: TriageAssessmentEntity,
    ) -> RepositoryResult<TriageAssessmentEntity>;

    /// Get assessment by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<TriageAssessmentEntity>;

    /// Get assessments for a patient
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TriageAssessmentEntity>>;

    /// Get latest assessment for a patient
    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<TriageAssessmentEntity>>;

    /// Update assessment
    async fn update(
        &self,
        assessment: TriageAssessmentEntity,
    ) -> RepositoryResult<TriageAssessmentEntity>;

    /// Get critical triages (ESI 1-2) from last 24 hours
    async fn get_critical(&self) -> RepositoryResult<Vec<TriageAssessmentEntity>>;

    /// Get ED dashboard (last 24 hours)
    async fn get_ed_dashboard(&self) -> RepositoryResult<Vec<TriageAssessmentEntity>>;
}
