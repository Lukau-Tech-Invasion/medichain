//! Specialty assessments: burn, psychiatric, toxicology, paediatric, obstetric.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{PaginatedResult, Pagination, RepositoryResult};

/// Burn Assessment entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct BurnAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub assessed_by: String,
    pub assessment_datetime: DateTime<Utc>,
    pub mechanism_of_injury: String,
    pub burn_agent: Option<String>,
    pub time_of_injury: Option<DateTime<Utc>>,
    pub tbsa_percentage: rust_decimal::Decimal,
    pub burn_depth: serde_json::Value,
    pub affected_areas: serde_json::Value,
    pub inhalation_injury: bool,
    pub inhalation_symptoms: Option<String>,
    pub airway_status: Option<String>,
    pub circumferential_burns: bool,
    pub circumferential_locations: Option<serde_json::Value>,
    pub escharotomy_needed: bool,
    pub escharotomy_performed: bool,
    pub fluid_resuscitation_started: bool,
    pub parkland_formula_volume: Option<i32>,
    pub urine_output_goal: Option<i32>,
    pub pain_score: Option<i32>,
    pub tetanus_status: Option<String>,
    pub transfer_to_burn_center: bool,
    pub burn_center_notified: bool,
    pub photos_taken: bool,
    pub notes: Option<String>,
    /// Parkland input. A stored fluid volume with no weight beside it cannot be
    /// rechecked against the formula. Added 20260909000002.
    pub weight_kg: Option<rust_decimal::Decimal>,
    /// `minor` / `moderate` / `major`, from `clinical_scoring::burn_severity`.
    pub severity: Option<String>,
    /// The Parkland split. `parkland_formula_volume` is the 24h total; these are
    /// the two blocks it is actually delivered in.
    pub parkland_first_8h_ml: Option<i32>,
    pub parkland_next_16h_ml: Option<i32>,
    pub associated_injuries: serde_json::Value,
    pub interventions: serde_json::Value,
    pub fluid_start_time: Option<DateTime<Utc>>,
    /// Measured output, titrated against `urine_output_goal`.
    pub urine_output_ml_hr: Option<i32>,
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

/// Psychiatric Assessment entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct PsychiatricAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub assessed_by: String,
    pub assessment_datetime: DateTime<Utc>,
    pub chief_complaint: String,
    pub presenting_symptoms: serde_json::Value,
    pub psychiatric_history: Option<String>,
    pub previous_hospitalizations: Option<serde_json::Value>,
    pub current_medications: Option<serde_json::Value>,
    pub substance_use: Option<serde_json::Value>,
    pub suicidal_ideation: Option<bool>,
    pub suicidal_plan: Option<bool>,
    pub suicidal_intent: Option<bool>,
    pub suicidal_means_access: Option<bool>,
    pub homicidal_ideation: Option<bool>,
    pub homicidal_target: Option<String>,
    pub safety_plan: Option<String>,
    pub mental_status_exam: serde_json::Value,
    pub appearance: Option<String>,
    pub behavior: Option<String>,
    pub speech: Option<String>,
    pub mood: Option<String>,
    pub affect: Option<String>,
    pub thought_process: Option<String>,
    pub thought_content: Option<String>,
    pub perceptions: Option<String>,
    pub cognition: Option<String>,
    pub insight: Option<String>,
    pub judgment: Option<String>,
    pub risk_level: Option<String>,
    pub disposition: Option<String>,
    pub involuntary_hold: Option<bool>,
    pub hold_type: Option<String>,
    pub sitter_required: Option<bool>,
    pub one_to_one_observation: Option<bool>,
    pub psychiatry_consulted: Option<bool>,
    pub psychiatrist_id: Option<String>,
    pub notes: Option<String>,
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

/// Toxicology Assessment entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ToxicologyAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub assessed_by: String,
    pub assessment_datetime: DateTime<Utc>,
    pub exposure_type: String,
    pub intentionality: String,
    pub substances: serde_json::Value,
    pub time_of_exposure: Option<DateTime<Utc>>,
    pub amount_if_known: Option<String>,
    pub route_of_exposure: Option<String>,
    pub symptoms: serde_json::Value,
    pub vital_signs_on_arrival: Option<serde_json::Value>,
    pub mental_status: Option<String>,
    pub pupil_size: Option<String>,
    pub pupil_reactivity: Option<String>,
    pub skin_findings: Option<String>,
    pub toxidrome: Option<String>,
    pub decontamination_performed: bool,
    pub decontamination_type: Option<String>,
    pub antidote_given: bool,
    pub antidote_name: Option<String>,
    pub antidote_dose: Option<String>,
    pub activated_charcoal: bool,
    pub whole_bowel_irrigation: bool,
    pub enhanced_elimination: bool,
    pub elimination_method: Option<String>,
    pub poison_control_called: bool,
    pub poison_control_case_number: Option<String>,
    pub lab_results: Option<serde_json::Value>,
    pub drug_screen_results: Option<serde_json::Value>,
    pub serum_levels: Option<serde_json::Value>,
    pub disposition: Option<String>,
    pub icu_admission: bool,
    pub notes: Option<String>,
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

/// Pediatric Assessment entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct PediatricAssessmentEntity {
    pub id: String,
    pub patient_id: String,
    pub assessed_by: String,
    pub assessment_datetime: DateTime<Utc>,
    pub age_months: Option<i32>,
    pub weight_kg: Option<rust_decimal::Decimal>,
    pub weight_estimated: Option<bool>,
    pub length_cm: Option<rust_decimal::Decimal>,
    pub head_circumference_cm: Option<rust_decimal::Decimal>,
    pub broselow_color: Option<String>,
    pub chief_complaint: String,
    pub history_source: Option<String>,
    pub immunizations_up_to_date: Option<bool>,
    pub last_immunization_date: Option<chrono::NaiveDate>,
    pub developmental_milestones: Option<serde_json::Value>,
    pub developmental_concerns: Option<String>,
    pub birth_history: Option<serde_json::Value>,
    pub feeding_pattern: Option<String>,
    pub last_feed_time: Option<DateTime<Utc>>,
    pub wet_diapers_24hr: Option<i32>,
    pub activity_level: Option<String>,
    pub pediatric_triangle: Option<serde_json::Value>,
    pub appearance_score: Option<String>,
    pub work_of_breathing: Option<String>,
    pub circulation_to_skin: Option<String>,
    pub pain_scale_type: Option<String>,
    pub pain_score: Option<i32>,
    pub fontanelle_status: Option<String>,
    pub capillary_refill_seconds: Option<rust_decimal::Decimal>,
    pub skin_turgor: Option<String>,
    pub mucous_membranes: Option<String>,
    pub parent_guardian_present: Option<bool>,
    pub parent_guardian_name: Option<String>,
    pub parent_guardian_relationship: Option<String>,
    pub child_protective_concerns: Option<bool>,
    pub cps_notified: Option<bool>,
    pub notes: Option<String>,
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

/// Obstetric Emergency entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ObstetricEmergencyEntity {
    pub id: String,
    pub patient_id: String,
    pub assessed_by: String,
    pub assessment_datetime: DateTime<Utc>,
    pub gestational_age_weeks: i32,
    pub gestational_age_days: Option<i32>,
    pub gravida: i32,
    pub para: i32,
    pub abortions: Option<i32>,
    pub living_children: Option<i32>,
    pub lmp_date: Option<chrono::NaiveDate>,
    pub edd_date: Option<chrono::NaiveDate>,
    pub prenatal_care: bool,
    pub prenatal_care_provider: Option<String>,
    pub pregnancy_complications: Option<serde_json::Value>,
    pub chief_complaint: String,
    pub contractions: bool,
    pub contraction_frequency_min: Option<i32>,
    pub contraction_duration_sec: Option<i32>,
    pub rupture_of_membranes: bool,
    pub rom_time: Option<DateTime<Utc>>,
    pub fluid_color: Option<String>,
    pub vaginal_bleeding: bool,
    pub bleeding_amount: Option<String>,
    pub cervical_exam_performed: bool,
    pub dilation_cm: Option<i32>,
    pub effacement_percent: Option<i32>,
    pub station: Option<i32>,
    pub presentation: Option<String>,
    pub fetal_heart_rate: Option<i32>,
    pub fetal_heart_variability: Option<String>,
    pub fetal_decelerations: Option<String>,
    pub uterine_tenderness: bool,
    pub fundal_height_cm: Option<i32>,
    pub fetal_movement: Option<String>,
    pub emergency_type: Option<String>,
    pub placenta_previa: bool,
    pub placental_abruption: bool,
    pub cord_prolapse: bool,
    pub eclampsia: bool,
    pub preeclampsia_severe: bool,
    pub blood_pressure_systolic: Option<i32>,
    pub blood_pressure_diastolic: Option<i32>,
    pub proteinuria: Option<String>,
    pub magnesium_sulfate_given: bool,
    pub delivery_imminent: bool,
    pub ob_notified: bool,
    pub ob_physician_id: Option<String>,
    pub nicu_notified: bool,
    pub or_notified: bool,
    pub notes: Option<String>,
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

/// Burn assessment repository trait
#[async_trait]
pub trait BurnAssessmentRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        assessment: BurnAssessmentEntity,
    ) -> RepositoryResult<BurnAssessmentEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<BurnAssessmentEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BurnAssessmentEntity>>;
    async fn update(
        &self,
        assessment: BurnAssessmentEntity,
    ) -> RepositoryResult<BurnAssessmentEntity>;
    async fn get_severe_burns(
        &self,
        min_tbsa: rust_decimal::Decimal,
    ) -> RepositoryResult<Vec<BurnAssessmentEntity>>;
}

/// Psychiatric assessment repository trait
#[async_trait]
pub trait PsychiatricAssessmentRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        assessment: PsychiatricAssessmentEntity,
    ) -> RepositoryResult<PsychiatricAssessmentEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<PsychiatricAssessmentEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PsychiatricAssessmentEntity>>;
    async fn update(
        &self,
        assessment: PsychiatricAssessmentEntity,
    ) -> RepositoryResult<PsychiatricAssessmentEntity>;
    async fn get_high_risk(&self) -> RepositoryResult<Vec<PsychiatricAssessmentEntity>>;
    async fn get_by_risk_level(
        &self,
        risk_level: &str,
    ) -> RepositoryResult<Vec<PsychiatricAssessmentEntity>>;
}

/// Toxicology assessment repository trait
#[async_trait]
pub trait ToxicologyAssessmentRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        assessment: ToxicologyAssessmentEntity,
    ) -> RepositoryResult<ToxicologyAssessmentEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ToxicologyAssessmentEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ToxicologyAssessmentEntity>>;
    async fn update(
        &self,
        assessment: ToxicologyAssessmentEntity,
    ) -> RepositoryResult<ToxicologyAssessmentEntity>;
    async fn get_by_exposure_type(
        &self,
        exposure_type: &str,
    ) -> RepositoryResult<Vec<ToxicologyAssessmentEntity>>;
}

/// Pediatric assessment repository trait
#[async_trait]
pub trait PediatricAssessmentRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        assessment: PediatricAssessmentEntity,
    ) -> RepositoryResult<PediatricAssessmentEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<PediatricAssessmentEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PediatricAssessmentEntity>>;
    async fn update(
        &self,
        assessment: PediatricAssessmentEntity,
    ) -> RepositoryResult<PediatricAssessmentEntity>;
    async fn get_cps_concerns(&self) -> RepositoryResult<Vec<PediatricAssessmentEntity>>;
}

/// Obstetric emergency repository trait
#[async_trait]
pub trait ObstetricEmergencyRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        emergency: ObstetricEmergencyEntity,
    ) -> RepositoryResult<ObstetricEmergencyEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ObstetricEmergencyEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ObstetricEmergencyEntity>>;
    async fn update(
        &self,
        emergency: ObstetricEmergencyEntity,
    ) -> RepositoryResult<ObstetricEmergencyEntity>;
    async fn get_active_emergencies(&self) -> RepositoryResult<Vec<ObstetricEmergencyEntity>>;
}
