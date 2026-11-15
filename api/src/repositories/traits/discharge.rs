//! Discharge: summaries, instructions, discharge against medical advice.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{PaginatedResult, Pagination, RepositoryResult};

/// Discharge Summary entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct DischargeSummaryEntity {
    pub id: String,
    pub patient_id: String,
    pub encounter_id: String,
    pub attending_physician_id: String,
    /// Absent when nobody recorded it; never the time of discharge.
    pub admission_datetime: Option<DateTime<Utc>>,
    pub discharge_datetime: DateTime<Utc>,
    pub admission_diagnosis: serde_json::Value,
    pub discharge_diagnosis: serde_json::Value,
    pub principal_diagnosis: Option<String>,
    pub secondary_diagnoses: Option<serde_json::Value>,
    pub procedures_performed: Option<serde_json::Value>,
    pub hospital_course: String,
    pub condition_at_discharge: String,
    pub discharge_disposition: String,
    pub discharge_destination: Option<String>,
    pub discharge_medications: serde_json::Value,
    pub medication_changes: Option<String>,
    pub follow_up_appointments: Option<serde_json::Value>,
    pub follow_up_instructions: Option<String>,
    pub diet_instructions: Option<String>,
    pub activity_restrictions: Option<String>,
    pub wound_care_instructions: Option<String>,
    pub warning_signs: Option<String>,
    pub pending_results: Option<serde_json::Value>,
    pub pending_studies: Option<serde_json::Value>,
    pub primary_care_notified: bool,
    pub specialist_follow_up: Option<serde_json::Value>,
    pub durable_medical_equipment: Option<serde_json::Value>,
    pub home_health_orders: Option<serde_json::Value>,
    pub physical_therapy_orders: Option<serde_json::Value>,
    pub dictated_by: Option<String>,
    pub dictated_at: Option<DateTime<Utc>>,
    pub transcribed_by: Option<String>,
    pub signed_by: Option<String>,
    pub signed_at: Option<DateTime<Utc>>,
    pub addendum: Option<String>,
    pub addendum_by: Option<String>,
    pub addendum_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// The summary in the shape the discharge screen composed it.
    ///
    /// NOT `#[sqlx(skip)]` any more: `20260910000003` gave it a column. While
    /// it was skipped, `create` never wrote it, every read served
    /// `Value::Null`, and `update` bound a column that did not exist — which is
    /// why approving a discharge summary was a 500 on PostgreSQL.
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Discharge Instructions entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct DischargeInstructionsEntity {
    pub id: String,
    pub patient_id: String,
    pub discharge_summary_id: Option<String>,
    pub visit_date: chrono::NaiveDate,
    pub diagnosis_summary: String,
    pub medications_list: serde_json::Value,
    pub new_medications: Option<serde_json::Value>,
    pub stopped_medications: Option<serde_json::Value>,
    pub changed_medications: Option<serde_json::Value>,
    pub diet_instructions: Option<String>,
    pub activity_level: Option<String>,
    pub activity_restrictions: Option<serde_json::Value>,
    pub wound_care: Option<String>,
    pub follow_up_appointments: serde_json::Value,
    pub return_precautions: String,
    pub emergency_instructions: String,
    pub contact_numbers: serde_json::Value,
    pub patient_education_materials: Option<serde_json::Value>,
    pub language: String,
    pub reading_level: Option<String>,
    pub special_instructions: Option<String>,
    pub equipment_needed: Option<serde_json::Value>,
    pub home_health_arranged: bool,
    pub transportation_arranged: bool,
    pub pharmacy_notified: bool,
    pub printed_at: Option<DateTime<Utc>>,
    pub emailed_at: Option<DateTime<Utc>>,
    pub patient_portal_posted: bool,
    pub acknowledged_by_patient: bool,
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub witness_signature: Option<String>,
    pub provided_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// The record as the form captured it.
    ///
    /// NOT `#[sqlx(skip)]`: `20260911000001` gave it a column, and the
    /// insert binds it. While it was skipped, PostgreSQL never selected or
    /// wrote this field, so the blob was permanently `Value::Null` there while
    /// holding the whole record in memory — the same endpoint behaving one way
    /// in development and another against a database, with nothing in the
    /// response to say which.
    #[serde(default)]
    pub data: serde_json::Value,
}

/// AMA Discharge entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct AmaDischargeEntity {
    pub id: String,
    pub patient_id: String,
    pub encounter_id: String,
    pub discharge_datetime: DateTime<Utc>,
    pub attending_physician_id: String,
    pub reason_for_leaving: String,
    pub risks_explained: serde_json::Value,
    pub specific_risks_discussed: String,
    pub patient_verbalized_understanding: bool,
    pub decision_making_capacity: bool,
    pub capacity_assessment: Option<String>,
    pub alternatives_offered: Option<serde_json::Value>,
    pub patient_refused_alternatives: bool,
    pub ama_form_signed: bool,
    pub ama_form_refused_reason: Option<String>,
    pub witness_present: bool,
    pub witness_name: Option<String>,
    pub witness_signature: Option<String>,
    /// The patient's own mark, and when it was taken.
    ///
    /// `ama_form_signed` is a boolean and evidences nothing on its own: an AMA
    /// discharge exists to show that the risks were explained and that the
    /// patient, having capacity, accepted them, and it is the first document a
    /// coroner asks for. A refusal to sign is recorded through
    /// `ama_form_refused_reason`, so "not signed yet" and "refused to sign"
    /// stay distinguishable (migration 20260922000005).
    #[serde(default)]
    pub patient_signature: Option<String>,
    #[serde(default)]
    pub patient_signature_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub witness_signature_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub signatures_collected_by: Option<String>,
    pub patient_given_prescriptions: bool,
    pub prescriptions_given: Option<serde_json::Value>,
    pub follow_up_offered: bool,
    pub follow_up_instructions: Option<String>,
    pub patient_contact_info_verified: bool,
    pub emergency_contact_notified: bool,
    pub belongings_returned: bool,
    pub security_escort: bool,
    pub police_notified: bool,
    pub social_work_notified: bool,
    pub documentation_complete: bool,
    pub physician_narrative: String,
    pub nurse_notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// The record as the form captured it.
    ///
    /// NOT `#[sqlx(skip)]`: `20260911000001` gave it a column, and the
    /// insert binds it. While it was skipped, PostgreSQL never selected or
    /// wrote this field, so the blob was permanently `Value::Null` there while
    /// holding the whole record in memory — the same endpoint behaving one way
    /// in development and another against a database, with nothing in the
    /// response to say which.
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Discharge summary repository trait
#[async_trait]
pub trait DischargeSummaryRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        summary: DischargeSummaryEntity,
    ) -> RepositoryResult<DischargeSummaryEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<DischargeSummaryEntity>;
    async fn get_by_encounter(
        &self,
        encounter_id: &str,
    ) -> RepositoryResult<Option<DischargeSummaryEntity>>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<DischargeSummaryEntity>>;
    /// Every summary in the deployment, for the discharge worklist.
    ///
    /// Required, not defaulted. `list_discharges` used to reach this by calling
    /// `get_by_patient("all", ..)` — a literal patient id, which matched
    /// nothing on PostgreSQL and left the worklist permanently empty. A
    /// defaulted body returning `NotImplemented` would have reproduced that
    /// silently on one backend, which is why trait methods here are required.
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<DischargeSummaryEntity>>;
    async fn update(
        &self,
        summary: DischargeSummaryEntity,
    ) -> RepositoryResult<DischargeSummaryEntity>;
}

/// Discharge instructions repository trait
#[async_trait]
pub trait DischargeInstructionsRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        instructions: DischargeInstructionsEntity,
    ) -> RepositoryResult<DischargeInstructionsEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<DischargeInstructionsEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<DischargeInstructionsEntity>>;
    async fn get_by_summary(
        &self,
        summary_id: &str,
    ) -> RepositoryResult<Option<DischargeInstructionsEntity>>;
    async fn update(
        &self,
        instructions: DischargeInstructionsEntity,
    ) -> RepositoryResult<DischargeInstructionsEntity>;
}

/// AMA discharge repository trait
#[async_trait]
pub trait AmaDischargeRepository: Send + Sync + fmt::Debug {
    async fn create(&self, discharge: AmaDischargeEntity) -> RepositoryResult<AmaDischargeEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<AmaDischargeEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AmaDischargeEntity>>;
    async fn get_by_encounter(
        &self,
        encounter_id: &str,
    ) -> RepositoryResult<Option<AmaDischargeEntity>>;
    async fn update(&self, discharge: AmaDischargeEntity) -> RepositoryResult<AmaDischargeEntity>;
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AmaDischargeEntity>>;
}
