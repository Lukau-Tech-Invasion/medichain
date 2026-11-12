//! Surgery and procedures: pre-op, operative and post-op notes, anaesthesia, intubation, laceration repair, splints and casts.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{DateRange, PaginatedResult, Pagination, RepositoryResult};

/// Pre-op assessment entity (pre-operative evaluations)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct PreOpAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub procedure_name: String,
    pub procedure_code: Option<String>,
    pub scheduled_date: Option<DateTime<Utc>>,
    pub surgeon_id: String,
    pub anesthesiologist_id: Option<String>,
    pub asa_classification: Option<String>,
    pub mallampati_score: Option<i32>,
    pub airway_assessment: Option<serde_json::Value>,
    pub cardiac_assessment: Option<serde_json::Value>,
    pub pulmonary_assessment: Option<serde_json::Value>,
    pub renal_assessment: Option<serde_json::Value>,
    pub hepatic_assessment: Option<serde_json::Value>,
    pub medications_reviewed: Option<serde_json::Value>,
    pub allergies_confirmed: bool,
    pub npo_status: Option<String>,
    pub labs_reviewed: Option<serde_json::Value>,
    pub ekg_reviewed: Option<bool>,
    pub chest_xray_reviewed: Option<bool>,
    pub consent_signed: bool,
    pub blood_type_confirmed: Option<bool>,
    pub risk_score: Option<rust_decimal::Decimal>,
    pub assessment_notes: Option<String>,
    pub assessed_by: String,
    pub assessed_at: DateTime<Utc>,
    pub cleared_for_surgery: bool,
    pub clearance_conditions: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Full API payload. The typed columns above are its queryable
    /// projection; this is what makes the round trip lossless, so the
    /// WHO checklist fields cannot be dropped by persistence.
    /// Column added by migration 20260810000001.
    #[sqlx(rename = "record_json")]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Operative note entity (surgical procedure documentation)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct OperativeNoteEntity {
    pub id: String,
    pub patient_id: String,
    pub pre_op_assessment_id: Option<String>,
    pub procedure_name: String,
    pub procedure_codes: Option<serde_json::Value>,
    pub preoperative_diagnosis: String,
    pub postoperative_diagnosis: String,
    pub surgeon_id: String,
    pub assistant_surgeons: Option<serde_json::Value>,
    pub anesthesiologist_id: Option<String>,
    pub anesthesia_type: String,
    pub scrub_nurse_id: Option<String>,
    pub circulating_nurse_id: Option<String>,
    /// `Option` since migration 20260916000001. `OperativeNotePage` records a
    /// procedure date and no theatre clock times, and a date written at
    /// midnight into both of these is a fabricated operative duration.
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub incision_time: Option<DateTime<Utc>>,
    pub closure_time: Option<DateTime<Utc>>,
    pub estimated_blood_loss_ml: Option<i32>,
    pub fluids_given_ml: Option<i32>,
    pub blood_products_given: Option<serde_json::Value>,
    pub specimens_collected: Option<serde_json::Value>,
    pub implants_used: Option<serde_json::Value>,
    pub drains_placed: Option<serde_json::Value>,
    pub operative_findings: Option<String>,
    pub procedure_description: String,
    pub complications: Option<String>,
    pub disposition: Option<String>,
    pub post_op_orders: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Full API payload. The typed columns above are its queryable
    /// projection; this is what makes the round trip lossless. The API
    /// type carries the full surgical team, specimens, implants and
    /// drains as structured lists that the flat columns cannot hold.
    /// Column added by migration 20260810000001.
    #[sqlx(rename = "record_json")]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Post-op note entity (post-operative follow-up documentation)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct PostOpNoteEntity {
    pub id: String,
    pub patient_id: String,
    /// Nullable since migration 20260810000001: the API type carries no
    /// operative-note link, and a patient transferred in after surgery
    /// elsewhere legitimately has none.
    pub operative_note_id: Option<String>,
    pub post_op_day: i32,
    pub note_date: DateTime<Utc>,
    pub provider_id: String,
    pub pain_level: Option<i32>,
    pub pain_management: Option<String>,
    pub vital_signs: Option<serde_json::Value>,
    pub wound_assessment: Option<serde_json::Value>,
    pub drain_output: Option<serde_json::Value>,
    pub diet_status: Option<String>,
    pub ambulation_status: Option<String>,
    pub voiding_status: Option<String>,
    pub bowel_function: Option<String>,
    pub lab_results_reviewed: Option<serde_json::Value>,
    pub complications: Option<String>,
    pub plan: Option<String>,
    pub discharge_criteria_met: bool,
    pub estimated_discharge_date: Option<chrono::NaiveDate>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Full API payload. The typed columns above are its queryable
    /// projection; this is what makes the round trip lossless. The API
    /// type carries wound status, I/O balance, foley and DVT prophylaxis
    /// detail the columns flatten or omit.
    /// Column added by migration 20260810000001.
    #[sqlx(rename = "record_json")]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Anesthesia record entity (anesthesia administration documentation)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct AnesthesiaRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub operative_note_id: Option<String>,
    pub anesthesiologist_id: String,
    pub crna_id: Option<String>,
    pub anesthesia_type: Option<String>,
    pub asa_classification: Option<String>,
    pub airway_management: Option<serde_json::Value>,
    pub induction_agents: Option<serde_json::Value>,
    pub maintenance_agents: Option<serde_json::Value>,
    pub neuromuscular_blockers: Option<serde_json::Value>,
    pub reversal_agents: Option<serde_json::Value>,
    pub vasopressors: Option<serde_json::Value>,
    pub intraop_fluids: Option<serde_json::Value>,
    pub blood_products: Option<serde_json::Value>,
    pub monitoring: Option<serde_json::Value>,
    pub vital_signs_timeline: Option<serde_json::Value>,
    pub events: Option<serde_json::Value>,
    pub complications: Option<String>,
    pub emergence_time: Option<DateTime<Utc>>,
    pub extubation_time: Option<DateTime<Utc>>,
    pub pacu_arrival_time: Option<DateTime<Utc>>,
    pub pacu_discharge_time: Option<DateTime<Utc>>,
    pub aldrete_score_arrival: Option<i32>,
    pub aldrete_score_discharge: Option<i32>,
    pub post_anesthesia_orders: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Full API payload. The typed columns above are its queryable
    /// projection; this is what makes the round trip lossless. The API
    /// type carries the timed vitals series, medication and fluid logs,
    /// emergence and PACU handoff as structured records.
    /// Column added by migration 20260810000001.
    #[sqlx(rename = "record_json")]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Intubation record entity (airway management documentation)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct IntubationRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub indication: String,
    pub urgency: String,
    pub intubator_id: String,
    pub assistant_id: Option<String>,
    pub pre_oxygenation: bool,
    pub pre_oxygenation_method: Option<String>,
    pub induction_agents: Option<serde_json::Value>,
    pub paralytic_agent: Option<String>,
    pub paralytic_dose: Option<String>,
    pub laryngoscope_type: Option<String>,
    pub blade_size: Option<String>,
    pub ett_size: rust_decimal::Decimal,
    pub ett_depth_cm: Option<rust_decimal::Decimal>,
    pub cuff_pressure_cmh2o: Option<rust_decimal::Decimal>,
    pub attempts: i32,
    pub view_grade: Option<String>,
    pub adjuncts_used: Option<serde_json::Value>,
    pub difficult_airway: bool,
    pub difficult_airway_features: Option<serde_json::Value>,
    pub complications: Option<serde_json::Value>,
    pub verification_methods: Option<serde_json::Value>,
    pub post_intubation_vitals: Option<serde_json::Value>,
    pub performed_at: DateTime<Utc>,
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

/// Laceration repair entity (wound closure documentation)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct LacerationRepairEntity {
    pub id: String,
    pub patient_id: String,
    pub location: String,
    pub length_cm: rust_decimal::Decimal,
    pub depth_cm: Option<rust_decimal::Decimal>,
    pub width_cm: Option<rust_decimal::Decimal>,
    pub mechanism: Option<String>,
    pub contamination_level: Option<String>,
    pub wound_age_hours: Option<rust_decimal::Decimal>,
    pub tetanus_status: Option<String>,
    pub tetanus_given: Option<bool>,
    pub anesthesia_type: String,
    pub anesthetic_agent: Option<String>,
    pub anesthetic_volume_ml: Option<rust_decimal::Decimal>,
    pub irrigation_solution: Option<String>,
    pub irrigation_volume_ml: Option<i32>,
    pub debridement_performed: bool,
    pub closure_technique: String,
    pub suture_material: Option<String>,
    pub suture_size: Option<String>,
    pub number_of_sutures: Option<i32>,
    pub deep_sutures_placed: Option<bool>,
    pub skin_adhesive_used: Option<bool>,
    pub steri_strips_applied: Option<bool>,
    pub dressing_applied: Option<String>,
    pub complications: Option<String>,
    pub aftercare_instructions: Option<String>,
    pub follow_up_date: Option<chrono::NaiveDate>,
    pub suture_removal_date: Option<chrono::NaiveDate>,
    pub performed_by: String,
    pub performed_at: DateTime<Utc>,
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

/// Splint/cast record entity (orthopedic immobilization documentation)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct SplintCastRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub injury_type: String,
    pub injury_location: String,
    pub laterality: Option<String>,
    pub fracture_type: Option<String>,
    pub immobilization_type: String,
    pub material: String,
    pub position: Option<String>,
    pub padding_type: Option<String>,
    pub neurovascular_check_pre: Option<serde_json::Value>,
    pub neurovascular_check_post: Option<serde_json::Value>,
    pub xray_pre: Option<bool>,
    pub xray_post: Option<bool>,
    pub reduction_performed: Option<bool>,
    pub reduction_technique: Option<String>,
    pub anesthesia_type: Option<String>,
    pub complications: Option<String>,
    pub weight_bearing_status: Option<String>,
    pub elevation_instructions: Option<bool>,
    pub ice_instructions: Option<bool>,
    pub follow_up_date: Option<chrono::NaiveDate>,
    pub follow_up_provider: Option<String>,
    pub removal_date: Option<chrono::NaiveDate>,
    pub applied_by: String,
    pub applied_at: DateTime<Utc>,
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

/// Pre-op assessment repository trait
#[async_trait]
pub trait PreOpAssessmentRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        assessment: PreOpAssessmentEntity,
    ) -> RepositoryResult<PreOpAssessmentEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<PreOpAssessmentEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PreOpAssessmentEntity>>;
    async fn get_by_surgeon(
        &self,
        surgeon_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PreOpAssessmentEntity>>;
    async fn update(
        &self,
        assessment: PreOpAssessmentEntity,
    ) -> RepositoryResult<PreOpAssessmentEntity>;
    async fn get_scheduled(
        &self,
        date_range: DateRange,
    ) -> RepositoryResult<Vec<PreOpAssessmentEntity>>;
}

/// Operative note repository trait
#[async_trait]
pub trait OperativeNoteRepository: Send + Sync + fmt::Debug {
    async fn create(&self, note: OperativeNoteEntity) -> RepositoryResult<OperativeNoteEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<OperativeNoteEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<OperativeNoteEntity>>;
    async fn get_by_surgeon(
        &self,
        surgeon_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<OperativeNoteEntity>>;
    async fn update(&self, note: OperativeNoteEntity) -> RepositoryResult<OperativeNoteEntity>;
    async fn list_all(&self) -> RepositoryResult<Vec<OperativeNoteEntity>>;
}

/// Post-op note repository trait
#[async_trait]
pub trait PostOpNoteRepository: Send + Sync + fmt::Debug {
    async fn create(&self, note: PostOpNoteEntity) -> RepositoryResult<PostOpNoteEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<PostOpNoteEntity>;
    async fn get_by_operative_note(
        &self,
        operative_note_id: &str,
    ) -> RepositoryResult<Vec<PostOpNoteEntity>>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PostOpNoteEntity>>;
    async fn update(&self, note: PostOpNoteEntity) -> RepositoryResult<PostOpNoteEntity>;
}

/// Anesthesia record repository trait
#[async_trait]
pub trait AnesthesiaRecordRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        record: AnesthesiaRecordEntity,
    ) -> RepositoryResult<AnesthesiaRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<AnesthesiaRecordEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AnesthesiaRecordEntity>>;
    async fn get_by_provider(
        &self,
        anesthesiologist_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AnesthesiaRecordEntity>>;
    async fn update(
        &self,
        record: AnesthesiaRecordEntity,
    ) -> RepositoryResult<AnesthesiaRecordEntity>;
    async fn list_all(&self) -> RepositoryResult<Vec<AnesthesiaRecordEntity>>;
}

/// Intubation record repository trait
#[async_trait]
pub trait IntubationRecordRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        record: IntubationRecordEntity,
    ) -> RepositoryResult<IntubationRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<IntubationRecordEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IntubationRecordEntity>>;
    async fn get_difficult_airways(&self) -> RepositoryResult<Vec<IntubationRecordEntity>>;
    async fn update(
        &self,
        record: IntubationRecordEntity,
    ) -> RepositoryResult<IntubationRecordEntity>;
    async fn list_all(&self) -> RepositoryResult<Vec<IntubationRecordEntity>>;
}

/// Laceration repair repository trait
#[async_trait]
pub trait LacerationRepairRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        repair: LacerationRepairEntity,
    ) -> RepositoryResult<LacerationRepairEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<LacerationRepairEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LacerationRepairEntity>>;
    async fn get_pending_followups(&self) -> RepositoryResult<Vec<LacerationRepairEntity>>;
    async fn update(
        &self,
        repair: LacerationRepairEntity,
    ) -> RepositoryResult<LacerationRepairEntity>;
    async fn list_all(&self) -> RepositoryResult<Vec<LacerationRepairEntity>>;
}

/// Splint/cast record repository trait
#[async_trait]
pub trait SplintCastRecordRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        record: SplintCastRecordEntity,
    ) -> RepositoryResult<SplintCastRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<SplintCastRecordEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<SplintCastRecordEntity>>;
    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<SplintCastRecordEntity>>;
    async fn update(
        &self,
        record: SplintCastRecordEntity,
    ) -> RepositoryResult<SplintCastRecordEntity>;
    /// Every record in the deployment, for the ward worklist.
    ///
    /// Required, not defaulted. The page that documents these kept its list in
    /// local React state -- `setRecords([newRecord, ...records])` -- so the
    /// screen showed what you typed this session and emptied on reload, while
    /// the record sat in the database. There was no read path at all to wire
    /// it to. A defaulted body returning `NotImplemented` would reproduce that
    /// silently on one backend, which is why trait methods here are required.
    async fn list_all(&self) -> RepositoryResult<Vec<SplintCastRecordEntity>>;
}
