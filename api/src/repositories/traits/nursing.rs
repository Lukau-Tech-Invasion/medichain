//! Nursing care: GCS, care plans, medication records, intake/output, wounds, IV sites, fall risk, shift handoffs.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{DateRange, PaginatedResult, Pagination, RepositoryResult};

/// Glasgow Coma Scale assessment entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct GcsAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub eye_response: i32,
    pub verbal_response: i32,
    pub motor_response: i32,
    pub total_score: i32, // Generated column
    pub interpretation: String,
    pub notes: Option<String>,
    pub pupil_assessment: Option<serde_json::Value>,
    pub assessed_by: String,
    pub assessed_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
}

/// Nursing care plan entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct NursingCarePlanEntity {
    pub id: String,
    pub patient_id: String,
    pub plan_name: String,
    pub care_level: Option<String>,
    pub nursing_diagnoses: serde_json::Value,
    pub goals: serde_json::Value,
    pub interventions: serde_json::Value,
    pub evaluation_notes: Option<String>,
    pub status: Option<String>,
    pub start_date: chrono::NaiveDate,
    pub target_end_date: Option<chrono::NaiveDate>,
    pub actual_end_date: Option<chrono::NaiveDate>,
    pub created_by: String,
    pub updated_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
    pub is_active: bool,
    pub data: serde_json::Value,
}

/// Medication administration record entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct MedicationRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub record_date: chrono::NaiveDate,
    pub scheduled_medications: serde_json::Value,
    pub prn_medications: serde_json::Value,
    pub infusions: serde_json::Value,
    pub completion_status: Option<String>,
    pub completion_percentage: Option<i32>,
    pub primary_nurse: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
    pub is_active: bool,
    pub data: serde_json::Value,
}

/// Intake/Output record entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct IORecordEntity {
    pub id: String,
    pub patient_id: String,
    pub record_date: chrono::NaiveDate,
    pub shift: String,
    pub oral_intake: Option<i32>,
    pub iv_intake: Option<i32>,
    pub tube_feeding: Option<i32>,
    pub other_intake: Option<i32>,
    pub total_intake: i32, // Generated column
    pub urine_output: Option<i32>,
    pub emesis: Option<i32>,
    pub drainage: Option<i32>,
    pub stool: Option<i32>,
    pub other_output: Option<i32>,
    pub total_output: i32, // Generated column
    pub net_balance: i32,  // Generated column
    pub intake_items: Option<serde_json::Value>,
    pub output_items: Option<serde_json::Value>,
    pub notes: Option<String>,
    pub recorded_by: String,
    pub verified_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
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

/// Wound assessment entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct WoundAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub wound_id: String,
    pub wound_location: String,
    pub wound_type: String,
    pub length_cm: Option<rust_decimal::Decimal>,
    pub width_cm: Option<rust_decimal::Decimal>,
    pub depth_cm: Option<rust_decimal::Decimal>,
    pub tissue_type: Option<String>,
    pub drainage_amount: Option<String>,
    pub drainage_type: Option<String>,
    pub periwound_condition: Option<String>,
    pub pain_level: Option<i32>,
    pub treatment_applied: Option<String>,
    pub dressing_type: Option<String>,
    pub notes: Option<String>,
    pub photo_taken: Option<bool>,
    pub assessed_by: String,
    pub assessed_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
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

/// IV site assessment entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct IVAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub site_id: String,
    pub site_location: String,
    pub catheter_type: Option<String>,
    pub catheter_gauge: Option<String>,
    pub insertion_date: Option<chrono::NaiveDate>,
    pub patency: Option<String>,
    pub site_appearance: Option<String>,
    pub infiltration_grade: Option<i32>,
    pub phlebitis_grade: Option<i32>,
    pub current_infusions: Option<serde_json::Value>,
    pub dressing_intact: Option<bool>,
    pub dressing_change_due: Option<chrono::NaiveDate>,
    pub pain_level: Option<i32>,
    pub notes: Option<String>,
    pub actions_taken: Option<String>,
    pub site_discontinued: Option<bool>,
    pub discontinuation_reason: Option<String>,
    pub assessed_by: String,
    pub assessed_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
    /// The record as the form captured it.
    ///
    /// NOT `#[sqlx(skip)]`: `20260910000006` gave it a column. While it was
    /// skipped, PostgreSQL never selected or wrote it, so the blob was always
    /// `Value::Null` there and held the real content in memory — the same
    /// endpoint behaving one way in development and another against a database.
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Fall risk assessment entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct FallRiskAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub assessment_tool: Option<String>,
    pub history_of_falling: Option<i32>,
    pub secondary_diagnosis: Option<i32>,
    pub ambulatory_aid: Option<i32>,
    pub iv_therapy: Option<i32>,
    pub gait_status: Option<i32>,
    pub mental_status: Option<i32>,
    /// Morse total. `GENERATED ALWAYS ... STORED` from the six item columns,
    /// and `Option` because those columns are nullable: a row written before
    /// the items were populated has a NULL total, and PostgreSQL will not
    /// decode that into an `i32`.
    ///
    /// It was `i32`, which meant one legacy row with a null score made
    /// `get_high_risk_patients` fail to decode — and that read is on the nurse
    /// dashboard's critical path, so the entire screen returned 503.
    ///
    /// `None` means "never scored", which is deliberately not the same as 0.
    /// Zero bands as low risk; unscored is a patient nobody has assessed.
    pub total_score: Option<i32>,
    /// Risk band, generated from `total_score`. `None` for the same reason.
    pub risk_level: Option<String>,
    pub additional_factors: Option<serde_json::Value>,
    pub interventions: Option<serde_json::Value>,
    /// Hazards identified at the bedside. Collected by the form since it was
    /// written; had no column until 20260909000001, so it was dropped on save.
    pub environmental_hazards: Option<serde_json::Value>,
    /// Fall-risk-increasing drugs the patient is on. Same history.
    pub medications: Option<serde_json::Value>,
    /// A fall already occurred during this admission.
    pub recent_fall: bool,
    /// Mobility status the prevention plan is built around.
    pub mobility: Option<String>,
    pub notes: Option<String>,
    pub assessed_by: String,
    pub assessed_at: DateTime<Utc>,
    pub next_assessment_due: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
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

/// Glasgow Coma Scale assessment repository trait
#[async_trait]
pub trait GcsAssessmentRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        assessment: GcsAssessmentEntity,
    ) -> RepositoryResult<GcsAssessmentEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<GcsAssessmentEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<GcsAssessmentEntity>>;
    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<GcsAssessmentEntity>>;
    async fn update(
        &self,
        assessment: GcsAssessmentEntity,
    ) -> RepositoryResult<GcsAssessmentEntity>;
    async fn get_critical_scores(
        &self,
        threshold: i32,
    ) -> RepositoryResult<Vec<GcsAssessmentEntity>>;
}

/// Nursing care plan repository trait
#[async_trait]
pub trait NursingCarePlanRepository: Send + Sync + fmt::Debug {
    async fn create(&self, plan: NursingCarePlanEntity) -> RepositoryResult<NursingCarePlanEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<NursingCarePlanEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<NursingCarePlanEntity>>;
    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<NursingCarePlanEntity>>;
    async fn update(&self, plan: NursingCarePlanEntity) -> RepositoryResult<NursingCarePlanEntity>;
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
    async fn get_by_care_level(
        &self,
        care_level: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<NursingCarePlanEntity>>;
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<NursingCarePlanEntity>>;
}

/// Medication record repository trait
#[async_trait]
pub trait MedicationRecordRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        record: MedicationRecordEntity,
    ) -> RepositoryResult<MedicationRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<MedicationRecordEntity>;
    async fn get_by_patient_and_date(
        &self,
        patient_id: &str,
        date: chrono::NaiveDate,
    ) -> RepositoryResult<Option<MedicationRecordEntity>>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        date_range: Option<DateRange>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicationRecordEntity>>;
    async fn update(
        &self,
        record: MedicationRecordEntity,
    ) -> RepositoryResult<MedicationRecordEntity>;
    async fn get_incomplete_records(&self) -> RepositoryResult<Vec<MedicationRecordEntity>>;
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicationRecordEntity>>;
}

/// I/O record repository trait
#[async_trait]
pub trait IORecordRepository: Send + Sync + fmt::Debug {
    async fn create(&self, record: IORecordEntity) -> RepositoryResult<IORecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<IORecordEntity>;
    async fn get_by_patient_date_shift(
        &self,
        patient_id: &str,
        date: chrono::NaiveDate,
        shift: &str,
    ) -> RepositoryResult<Option<IORecordEntity>>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        date_range: Option<DateRange>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IORecordEntity>>;
    async fn update(&self, record: IORecordEntity) -> RepositoryResult<IORecordEntity>;
    async fn get_negative_balance_patients(&self) -> RepositoryResult<Vec<IORecordEntity>>;
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IORecordEntity>>;
}

/// Wound assessment repository trait
#[async_trait]
pub trait WoundAssessmentRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        assessment: WoundAssessmentEntity,
    ) -> RepositoryResult<WoundAssessmentEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<WoundAssessmentEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WoundAssessmentEntity>>;
    async fn get_by_wound_id(
        &self,
        wound_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WoundAssessmentEntity>>;
    async fn update(
        &self,
        assessment: WoundAssessmentEntity,
    ) -> RepositoryResult<WoundAssessmentEntity>;
    async fn get_critical_wounds(&self) -> RepositoryResult<Vec<WoundAssessmentEntity>>;
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WoundAssessmentEntity>>;
}

/// IV assessment repository trait
#[async_trait]
pub trait IVAssessmentRepository: Send + Sync + fmt::Debug {
    async fn create(&self, assessment: IVAssessmentEntity) -> RepositoryResult<IVAssessmentEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<IVAssessmentEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IVAssessmentEntity>>;
    async fn get_by_site_id(
        &self,
        site_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IVAssessmentEntity>>;
    async fn update(&self, assessment: IVAssessmentEntity) -> RepositoryResult<IVAssessmentEntity>;
    async fn get_active_sites_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<IVAssessmentEntity>>;
    async fn get_sites_needing_attention(&self) -> RepositoryResult<Vec<IVAssessmentEntity>>;
}

/// Fall risk assessment repository trait
#[async_trait]
pub trait FallRiskAssessmentRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        assessment: FallRiskAssessmentEntity,
    ) -> RepositoryResult<FallRiskAssessmentEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<FallRiskAssessmentEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<FallRiskAssessmentEntity>>;
    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<FallRiskAssessmentEntity>>;
    async fn update(
        &self,
        assessment: FallRiskAssessmentEntity,
    ) -> RepositoryResult<FallRiskAssessmentEntity>;
    async fn get_high_risk_patients(&self) -> RepositoryResult<Vec<FallRiskAssessmentEntity>>;
    async fn get_assessments_due(&self) -> RepositoryResult<Vec<FallRiskAssessmentEntity>>;
}

/// Shift Handoff entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ShiftHandoffEntity {
    pub id: String,
    pub patient_id: String,
    pub outgoing_provider_id: String,
    pub incoming_provider_id: String,
    pub handoff_datetime: DateTime<Utc>,
    pub handoff_type: String,
    pub location_from: Option<String>,
    pub location_to: Option<String>,
    pub situation: String,
    pub background: String,
    pub assessment: String,
    pub recommendation: String,
    pub pending_tasks: serde_json::Value,
    pub pending_results: Option<serde_json::Value>,
    pub pending_consults: Option<serde_json::Value>,
    pub critical_values: Option<serde_json::Value>,
    pub code_status: Option<String>,
    pub isolation_precautions: Option<serde_json::Value>,
    pub fall_risk_level: Option<String>,
    pub skin_integrity_issues: Option<serde_json::Value>,
    pub iv_access: Option<serde_json::Value>,
    pub drains_tubes: Option<serde_json::Value>,
    pub family_concerns: Option<String>,
    pub anticipated_disposition: Option<String>,
    pub contingency_plans: Option<String>,
    pub questions_asked: Option<serde_json::Value>,
    pub read_back_confirmed: bool,
    pub acknowledged_by_incoming: bool,
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub handoff_tool_used: Option<String>,
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

/// Shift handoff repository trait
#[async_trait]
pub trait ShiftHandoffRepository: Send + Sync + fmt::Debug {
    async fn create(&self, handoff: ShiftHandoffEntity) -> RepositoryResult<ShiftHandoffEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ShiftHandoffEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ShiftHandoffEntity>>;
    /// Handoffs a provider gave or received on or after `since`, newest first.
    ///
    /// Was `get_by_provider(provider, date)`, one day exactly, so the handoff
    /// history screen could never show yesterday's handover -- the one a
    /// clinician starting a shift most often needs to look back at.
    async fn get_by_provider_since(
        &self,
        provider_id: &str,
        since: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<ShiftHandoffEntity>>;
    /// Every row of one handoff.
    ///
    /// A handoff covers a ward, and storage is one row per patient keyed
    /// `{batch}-{patient_id}` — so the batch id `create_shift_handoff` returns
    /// is not the primary key of anything, and `get_by_id` on it was a 404. A
    /// client that stored the id it was handed had stored nothing.
    async fn get_by_batch(&self, batch_id: &str) -> RepositoryResult<Vec<ShiftHandoffEntity>>;
    async fn acknowledge(&self, id: &str) -> RepositoryResult<ShiftHandoffEntity>;
    async fn get_unacknowledged(
        &self,
        incoming_provider_id: &str,
    ) -> RepositoryResult<Vec<ShiftHandoffEntity>>;
}
