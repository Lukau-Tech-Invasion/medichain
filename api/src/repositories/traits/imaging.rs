//! Radiology orders and reports, pathology reports.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{PaginatedResult, Pagination, RepositoryResult};

/// Radiology order entity (imaging study requests)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct RadiologyOrderEntity {
    pub id: String,
    pub patient_id: String,
    pub ordering_provider_id: String,
    pub modality: String,
    pub study_type: String,
    pub body_part: String,
    pub laterality: Option<String>,
    pub priority: String,
    pub status: String,
    pub clinical_indication: String,
    pub diagnosis_codes: Option<serde_json::Value>,
    pub contrast_required: Option<bool>,
    pub contrast_type: Option<String>,
    pub sedation_required: Option<bool>,
    pub patient_prep_instructions: Option<String>,
    pub special_instructions: Option<String>,
    pub scheduled_datetime: Option<DateTime<Utc>>,
    pub completed_datetime: Option<DateTime<Utc>>,
    pub performing_technologist_id: Option<String>,
    pub accession_number: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Full API payload; the typed columns above are the queryable
    /// projection, so the round trip is lossless — the API type carries the full study type,
    /// laterality and contrast-safety checks (creatinine, pregnancy) that the
    /// flat columns flatten or omit.
    /// Column added by migration 20260811000001.
    #[sqlx(rename = "record_json")]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Radiology report entity (imaging interpretation reports)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct RadiologyReportEntity {
    pub id: String,
    pub order_id: String,
    pub patient_id: String,
    pub radiologist_id: String,
    pub study_datetime: Option<DateTime<Utc>>,
    pub report_datetime: DateTime<Utc>,
    pub comparison_studies: Option<String>,
    pub technique: Option<String>,
    pub findings: String,
    pub impression: String,
    pub recommendations: Option<String>,
    pub critical_finding: bool,
    pub critical_finding_communicated: Option<bool>,
    pub communicated_to: Option<String>,
    pub communicated_at: Option<DateTime<Utc>>,
    pub communication_method: Option<String>,
    pub addendum: Option<String>,
    pub addendum_datetime: Option<DateTime<Utc>>,
    pub addendum_by: Option<String>,
    pub status: String,
    pub image_count: Option<i32>,
    pub pacs_study_uid: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Full API payload; the typed columns above are the queryable
    /// projection, so the round trip is lossless — the API type carries `impression` as a list and
    /// the critical-finding read-back as a nested record, neither of which the
    /// flat columns can hold.
    /// Column added by migration 20260811000001.
    #[sqlx(rename = "record_json")]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Pathology report entity (tissue/cytology analysis reports)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct PathologyReportEntity {
    pub id: String,
    pub patient_id: String,
    pub specimen_id: Option<String>,
    pub ordering_provider_id: String,
    pub pathologist_id: String,
    pub specimen_type: String,
    pub specimen_source: String,
    pub collection_date: DateTime<Utc>,
    pub received_date: DateTime<Utc>,
    pub report_date: DateTime<Utc>,
    pub clinical_history: Option<String>,
    pub gross_description: String,
    pub microscopic_description: String,
    pub special_stains: Option<serde_json::Value>,
    pub immunohistochemistry: Option<serde_json::Value>,
    pub molecular_studies: Option<serde_json::Value>,
    pub diagnosis: String,
    pub staging: Option<String>,
    pub tnm_classification: Option<serde_json::Value>,
    pub margin_status: Option<String>,
    pub lymph_node_status: Option<serde_json::Value>,
    pub comments: Option<String>,
    pub addendum: Option<String>,
    pub addendum_datetime: Option<DateTime<Utc>>,
    pub addendum_by: Option<String>,
    pub status: String,
    pub synoptic_report: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Full API payload; the typed columns above are the queryable
    /// projection, so the round trip is lossless — the API type carries special stains,
    /// immunohistochemistry, molecular studies and the synoptic cancer-staging
    /// report as structured lists.
    /// Column added by migration 20260811000001.
    #[sqlx(rename = "record_json")]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Radiology order repository trait
#[async_trait]
pub trait RadiologyOrderRepository: Send + Sync + fmt::Debug {
    async fn create(&self, order: RadiologyOrderEntity) -> RepositoryResult<RadiologyOrderEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<RadiologyOrderEntity>;
    async fn get_by_accession(
        &self,
        accession_number: &str,
    ) -> RepositoryResult<Option<RadiologyOrderEntity>>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RadiologyOrderEntity>>;
    async fn update(&self, order: RadiologyOrderEntity) -> RepositoryResult<RadiologyOrderEntity>;
    async fn get_pending_by_modality(
        &self,
        modality: &str,
    ) -> RepositoryResult<Vec<RadiologyOrderEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<RadiologyOrderEntity>>;
}

/// Radiology report repository trait
#[async_trait]
pub trait RadiologyReportRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        report: RadiologyReportEntity,
    ) -> RepositoryResult<RadiologyReportEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<RadiologyReportEntity>;
    async fn get_by_order(&self, order_id: &str)
        -> RepositoryResult<Option<RadiologyReportEntity>>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RadiologyReportEntity>>;
    async fn update(
        &self,
        report: RadiologyReportEntity,
    ) -> RepositoryResult<RadiologyReportEntity>;
    async fn get_critical_findings(&self) -> RepositoryResult<Vec<RadiologyReportEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<RadiologyReportEntity>>;
}

/// Pathology report repository trait
#[async_trait]
pub trait PathologyReportRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        report: PathologyReportEntity,
    ) -> RepositoryResult<PathologyReportEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<PathologyReportEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PathologyReportEntity>>;
    async fn get_by_specimen(
        &self,
        specimen_id: &str,
    ) -> RepositoryResult<Option<PathologyReportEntity>>;
    async fn update(
        &self,
        report: PathologyReportEntity,
    ) -> RepositoryResult<PathologyReportEntity>;
    async fn list_all(&self) -> RepositoryResult<Vec<PathologyReportEntity>>;
}
