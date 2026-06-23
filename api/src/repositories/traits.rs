//! Repository trait definitions for MediChain data access.
//!
//! These traits define the contract for data persistence operations,
//! allowing for multiple backend implementations (memory, PostgreSQL).
//!
//! # Design Principles
//!
//! 1. **Async by default** - All operations are async for database compatibility
//! 2. **Result-based** - All operations return Result for error handling
//! 3. **Send + Sync** - Thread-safe for use with Actix-web
//! 4. **Bounded operations** - List operations return bounded results

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;
use thiserror::Error;

/// Default currency for monetary entities: ZAR (South African Rand).
/// Used by `#[serde(default = ...)]` so deserialized records without an explicit
/// currency fall back to the African denomination rather than implicit US dollars.
pub(crate) fn default_currency_zar() -> Option<String> {
    Some("ZAR".to_string())
}

// =============================================================================
// ERROR TYPES
// =============================================================================

/// Repository error types
#[derive(Debug, Error)]
pub enum RepositoryError {
    /// Entity not found
    #[error("Entity not found: {0}")]
    NotFound(String),

    /// Duplicate entity (unique constraint violation)
    #[error("Duplicate entity: {0}")]
    Duplicate(String),

    /// Validation error
    #[error("Validation error: {0}")]
    Validation(String),

    /// Database error
    #[error("Database error: {0}")]
    Database(String),

    /// Configuration error
    #[error("Configuration error: {0}")]
    Configuration(String),

    /// Internal error
    #[error("Internal error: {0}")]
    Internal(String),

    /// Not implemented error - for optional trait methods
    #[error("Not implemented: {0}")]
    NotImplemented(String),
}

impl From<sqlx::Error> for RepositoryError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => RepositoryError::NotFound("Record not found".into()),
            sqlx::Error::Database(ref db_err) => {
                if db_err.code().map(|c| c == "23505").unwrap_or(false) {
                    // Unique violation
                    RepositoryError::Duplicate(db_err.message().to_string())
                } else {
                    RepositoryError::Database(db_err.message().to_string())
                }
            }
            _ => RepositoryError::Database(e.to_string()),
        }
    }
}

/// Result type alias for repository operations
pub type RepositoryResult<T> = Result<T, RepositoryError>;

// =============================================================================
// COMMON TYPES
// =============================================================================

/// Pagination parameters
#[derive(Debug, Clone, Default)]
pub struct Pagination {
    /// Page number (0-indexed)
    pub page: u32,
    /// Items per page (max 100)
    pub per_page: u32,
}

impl Pagination {
    pub const MAX_PER_PAGE: u32 = 100;

    pub fn new(page: u32, per_page: u32) -> Self {
        Self {
            page,
            per_page: per_page.min(Self::MAX_PER_PAGE),
        }
    }

    pub fn offset(&self) -> u32 {
        self.page * self.per_page
    }

    pub fn limit(&self) -> u32 {
        self.per_page.min(Self::MAX_PER_PAGE)
    }
}

/// Paginated result wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResult<T> {
    pub items: Vec<T>,
    pub total: u64,
    pub page: u32,
    pub per_page: u32,
    pub total_pages: u32,
}

impl<T> PaginatedResult<T> {
    pub fn new(items: Vec<T>, total: u64, pagination: &Pagination) -> Self {
        let per_page = pagination.per_page.max(1);
        let total_pages = ((total as f64) / (per_page as f64)).ceil() as u32;
        Self {
            items,
            total,
            page: pagination.page,
            per_page,
            total_pages,
        }
    }
}

/// Date range filter
#[derive(Debug, Clone, Default)]
pub struct DateRange {
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
}

// =============================================================================
// ENTITY MODELS (Database-mapped)
// =============================================================================

/// Patient entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PatientEntity {
    pub id: String,
    pub health_id: String,
    pub national_id_hash: String,
    pub national_id_type: String,

    // Encrypted fields stored as bytes
    #[serde(skip_serializing)]
    pub first_name_encrypted: Option<Vec<u8>>,
    #[serde(skip_serializing)]
    pub last_name_encrypted: Option<Vec<u8>>,
    #[serde(skip_serializing)]
    pub date_of_birth_encrypted: Option<Vec<u8>>,

    pub gender: Option<String>,
    pub blood_type: Option<String>,

    #[serde(skip_serializing)]
    pub phone_encrypted: Option<Vec<u8>>,
    #[serde(skip_serializing)]
    pub email_encrypted: Option<Vec<u8>>,
    #[serde(skip_serializing)]
    pub address_encrypted: Option<Vec<u8>>,

    #[serde(skip_serializing)]
    pub emergency_contact_name_encrypted: Option<Vec<u8>>,
    #[serde(skip_serializing)]
    pub emergency_contact_phone_encrypted: Option<Vec<u8>>,
    pub emergency_contact_relationship: Option<String>,

    pub organ_donor: bool,
    pub dnr_status: bool,

    /// DNR advance-directive verification metadata (typed columns for query/search).
    /// The authoritative copy round-trips losslessly in `profile_extras_encrypted`;
    /// these mirror it so a `DO NOT RESUSCITATE` directive is only treated as
    /// verified when `dnr_verified_by` and `dnr_verified_at` are both present.
    #[serde(default)]
    pub dnr_verified_by: Option<String>,
    #[serde(default)]
    pub dnr_verified_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub dnr_document_ref: Option<String>,

    pub primary_provider_id: Option<String>,
    pub wallet_address: Option<String>,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub registered_by: Option<String>,
    pub is_verified: bool,
    pub is_active: bool,

    /// Full `PatientProfile` (address, insurance, doctors, preferences, advanced
    /// directives, structured emergency_info) serialized to JSON and encrypted
    /// with ChaCha20-Poly1305. Lossless source of truth on read; a real persisted
    /// column so it survives a PostgreSQL round-trip.
    #[serde(skip_serializing)]
    #[serde(default)]
    pub profile_extras_encrypted: Option<Vec<u8>>,
}

/// Allergy entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AllergyEntity {
    pub id: String,
    pub patient_id: String,
    pub allergen: String,
    pub allergen_type: String,
    pub reaction: Option<String>,
    pub severity: String,
    pub onset_date: Option<chrono::NaiveDate>,
    pub last_occurrence: Option<chrono::NaiveDate>,
    pub verified: bool,
    pub verified_by: Option<String>,
    pub verified_at: Option<DateTime<Utc>>,
    pub source: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub created_by: String,
    pub is_active: bool,
}

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
    pub on_chain_hash: Option<String>,
    pub blockchain_tx_hash: Option<String>,
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

/// NFC tag entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct NfcTagEntity {
    pub id: String,
    pub tag_uid: String,
    pub patient_id: String,
    pub tag_type: String,
    pub is_active: bool,
    #[serde(skip_serializing)]
    pub pin_hash: Option<String>,
    pub issued_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub use_count: i32,
    pub issued_by: Option<String>,
}

/// Vital signs entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct VitalSignsEntity {
    pub id: String,
    pub patient_id: String,
    pub heart_rate: Option<i32>,
    pub respiratory_rate: Option<i32>,
    pub blood_pressure_systolic: Option<i32>,
    pub blood_pressure_diastolic: Option<i32>,
    pub mean_arterial_pressure: Option<i32>,
    pub temperature: Option<f64>,
    pub temperature_site: Option<String>,
    pub oxygen_saturation: Option<i32>,
    pub oxygen_delivery: Option<String>,
    pub fio2: Option<i32>,
    pub pain_scale: Option<i32>,
    pub gcs_score: Option<i32>,
    pub gcs_eye: Option<i32>,
    pub gcs_verbal: Option<i32>,
    pub gcs_motor: Option<i32>,
    pub blood_glucose: Option<i32>,
    pub weight_kg: Option<f64>,
    pub height_cm: Option<f64>,
    pub bmi: Option<f64>,
    pub position: Option<String>,
    pub activity_level: Option<String>,
    pub is_critical: bool,
    pub critical_values: Option<serde_json::Value>,
    pub recorded_at: DateTime<Utc>,
    pub recorded_by: String,
    pub facility_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

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
    pub blood_glucose: Option<i32>,
    pub weight: Option<f64>,
    pub is_critical: bool,
    pub requires_isolation: bool,
    pub disposition: Option<String>,
    pub assigned_bed: Option<String>,
    pub triage_time: DateTime<Utc>,
    pub seen_by_provider_at: Option<DateTime<Utc>>,
    pub performed_by: String,
    pub facility_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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
    pub blockchain_tx_hash: Option<String>,
    pub accessed_at: DateTime<Utc>,
    pub facility_id: Option<String>,
}

// =============================================================================
// REPOSITORY TRAITS
// =============================================================================

/// Patient repository trait
#[async_trait]
pub trait PatientRepository: Send + Sync + fmt::Debug {
    /// Create a new patient
    async fn create(&self, patient: PatientEntity) -> RepositoryResult<PatientEntity>;

    /// Get patient by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<PatientEntity>;

    /// Get patient by health ID
    async fn get_by_health_id(&self, health_id: &str) -> RepositoryResult<PatientEntity>;

    /// Get patient by national ID hash
    async fn get_by_national_id_hash(&self, hash: &str) -> RepositoryResult<PatientEntity>;

    /// Get patient by wallet address
    async fn get_by_wallet(&self, wallet: &str) -> RepositoryResult<PatientEntity>;

    /// Update patient
    async fn update(&self, patient: PatientEntity) -> RepositoryResult<PatientEntity>;

    /// Delete patient (soft delete - sets is_active = false)
    async fn delete(&self, id: &str) -> RepositoryResult<()>;

    /// List patients with pagination
    async fn list(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>>;

    /// Search patients by criteria
    async fn search(
        &self,
        query: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>>;

    /// Get patients by provider
    async fn get_by_provider(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>>;

    /// Count total patients
    async fn count(&self) -> RepositoryResult<u64>;
}

/// Allergy repository trait
#[async_trait]
pub trait AllergyRepository: Send + Sync + fmt::Debug {
    /// Create a new allergy
    async fn create(&self, allergy: AllergyEntity) -> RepositoryResult<AllergyEntity>;

    /// Get allergy by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<AllergyEntity>;

    /// Get all allergies for a patient
    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<AllergyEntity>>;

    /// Get active allergies for a patient
    async fn get_active_by_patient(&self, patient_id: &str)
        -> RepositoryResult<Vec<AllergyEntity>>;

    /// Update allergy
    async fn update(&self, allergy: AllergyEntity) -> RepositoryResult<AllergyEntity>;

    /// Delete allergy (soft delete)
    async fn delete(&self, id: &str) -> RepositoryResult<()>;

    /// Check if patient has specific allergen
    async fn has_allergen(&self, patient_id: &str, allergen: &str) -> RepositoryResult<bool>;

    /// Get severe allergies for a patient (Severe or LifeThreatening)
    async fn get_severe_by_patient(&self, patient_id: &str)
        -> RepositoryResult<Vec<AllergyEntity>>;
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

/// NFC tag repository trait
#[async_trait]
pub trait NfcTagRepository: Send + Sync + fmt::Debug {
    /// Create a new NFC tag
    async fn create(&self, tag: NfcTagEntity) -> RepositoryResult<NfcTagEntity>;

    /// Get tag by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<NfcTagEntity>;

    /// Get tag by UID
    async fn get_by_uid(&self, uid: &str) -> RepositoryResult<NfcTagEntity>;

    /// Get tags for a patient
    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<NfcTagEntity>>;

    /// Get active tag for a patient
    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<NfcTagEntity>>;

    /// Update tag
    async fn update(&self, tag: NfcTagEntity) -> RepositoryResult<NfcTagEntity>;

    /// Deactivate tag
    async fn deactivate(&self, id: &str) -> RepositoryResult<()>;

    /// Record tag usage
    async fn record_usage(&self, id: &str) -> RepositoryResult<()>;

    /// List all tags
    async fn list(&self, pagination: Pagination)
        -> RepositoryResult<PaginatedResult<NfcTagEntity>>;
}

/// Vital signs repository trait
#[async_trait]
pub trait VitalSignsRepository: Send + Sync + fmt::Debug {
    /// Create new vital signs record
    async fn create(&self, vitals: VitalSignsEntity) -> RepositoryResult<VitalSignsEntity>;

    /// Get vitals by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<VitalSignsEntity>;

    /// Get latest vitals for a patient
    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<VitalSignsEntity>>;

    /// Get vitals history for a patient
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<VitalSignsEntity>>;

    /// Get vitals within date range
    async fn get_by_date_range(
        &self,
        patient_id: &str,
        range: DateRange,
    ) -> RepositoryResult<Vec<VitalSignsEntity>>;

    /// Get critical vitals (last 24 hours)
    async fn get_critical(&self) -> RepositoryResult<Vec<VitalSignsEntity>>;
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

/// Access log repository trait
#[async_trait]
pub trait AccessLogRepository: Send + Sync + fmt::Debug {
    /// Create access log entry
    async fn create(&self, log: AccessLogEntity) -> RepositoryResult<AccessLogEntity>;

    /// Get logs by accessor
    async fn get_by_accessor(
        &self,
        accessor_id: &str,
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
}

// =============================================================================
// PHASE 2 ENTITY MODELS (Clinical Documentation & Nursing Care)
// =============================================================================

/// Sample history entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SampleHistoryEntity {
    pub id: String,
    pub patient_id: String,
    pub signs_symptoms: serde_json::Value,
    pub past_medical_history: serde_json::Value,
    pub events_leading: String,
    pub last_intake: Option<serde_json::Value>,
    pub medications: serde_json::Value,
    pub allergies_snapshot: serde_json::Value,
    pub collected_by: String,
    pub collected_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
    pub is_active: bool,
}

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
    #[sqlx(skip)]
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
    #[sqlx(skip)]
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
    #[sqlx(skip)]
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
    pub total_score: i32,   // Generated column
    pub risk_level: String, // Generated column
    pub additional_factors: Option<serde_json::Value>,
    pub interventions: Option<serde_json::Value>,
    pub notes: Option<String>,
    pub assessed_by: String,
    pub assessed_at: DateTime<Utc>,
    pub next_assessment_due: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub facility_id: Option<String>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

// =============================================================================
// PHASE 2 REPOSITORY TRAITS
// =============================================================================

/// Sample history repository trait
#[async_trait]
pub trait SampleHistoryRepository: Send + Sync + fmt::Debug {
    async fn create(&self, history: SampleHistoryEntity) -> RepositoryResult<SampleHistoryEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<SampleHistoryEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<SampleHistoryEntity>>;
    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<SampleHistoryEntity>>;
    async fn update(&self, history: SampleHistoryEntity) -> RepositoryResult<SampleHistoryEntity>;
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
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
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
    async fn get_by_exam_type(
        &self,
        exam_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<HistoryPhysicalEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<HistoryPhysicalEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
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
    async fn list_all(&self) -> RepositoryResult<Vec<ConsultationNoteEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
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

// =============================================================================
// EMERGENCY PROTOCOL ENTITIES & REPOSITORIES
// =============================================================================

/// Code Blue record entity for repository storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeBlueEntity {
    pub id: String,
    pub patient_id: String,
    pub location: String,
    pub code_called_at: i64,
    pub team_arrived_at: Option<i64>,
    pub initial_rhythm: String,
    pub witnessed: bool,
    pub outcome: String,
    pub code_leader: String,
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
    pub gcs: u8,
    pub trauma_level: Option<u8>,
    pub mtp_activated: bool,
    pub disposition: String,
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
    pub nihss_total: u8,
    pub stroke_type: String,
    pub tpa_eligible: bool,
    pub tpa_given: bool,
    pub hemorrhage: bool,
    pub lvo_suspected: bool,
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
    async fn list_all(&self) -> RepositoryResult<Vec<CodeBlueEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
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
}

// =============================================================================
// PHASE 3: LAB & DIAGNOSTICS ENTITIES
// =============================================================================

/// Lab submission entity (laboratory test orders)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LabSubmissionEntity {
    pub id: String,
    pub patient_id: String,
    pub ordering_provider_id: String,
    pub order_date: DateTime<Utc>,
    pub priority: String,
    pub status: String,
    pub tests_ordered: serde_json::Value,
    pub clinical_notes: Option<String>,
    pub diagnosis_codes: Option<serde_json::Value>,
    pub fasting_required: bool,
    pub collection_instructions: Option<String>,
    pub expected_completion: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Lab panel entity (groupings of related tests)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LabPanelEntity {
    pub id: String,
    pub submission_id: String,
    pub patient_id: String,
    pub panel_code: String,
    pub panel_name: String,
    pub status: String,
    pub results: Option<serde_json::Value>,
    pub reference_ranges: Option<serde_json::Value>,
    pub abnormal_flags: Option<serde_json::Value>,
    pub performing_lab: Option<String>,
    pub technician_id: Option<String>,
    pub verified_by: Option<String>,
    pub collected_at: Option<DateTime<Utc>>,
    pub resulted_at: Option<DateTime<Utc>>,
    pub verified_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Lab QC record entity (quality control for laboratory)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct LabQcRecordEntity {
    pub id: String,
    pub instrument_id: String,
    pub instrument_name: String,
    pub qc_level: String,
    pub test_code: String,
    pub test_name: String,
    pub expected_value: rust_decimal::Decimal,
    pub measured_value: rust_decimal::Decimal,
    pub unit: String,
    pub acceptable_range_low: rust_decimal::Decimal,
    pub acceptable_range_high: rust_decimal::Decimal,
    pub passed: bool,
    pub deviation_percent: Option<rust_decimal::Decimal>,
    pub corrective_action: Option<String>,
    pub performed_by: String,
    pub reviewed_by: Option<String>,
    pub performed_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub lot_number: Option<String>,
    pub expiration_date: Option<chrono::NaiveDate>,
    pub created_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Critical value entity (abnormal lab results requiring immediate notification)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct CriticalValueEntity {
    pub id: String,
    pub patient_id: String,
    pub lab_panel_id: Option<String>,
    pub test_code: String,
    pub test_name: String,
    pub value: rust_decimal::Decimal,
    pub unit: String,
    pub reference_low: Option<rust_decimal::Decimal>,
    pub reference_high: Option<rust_decimal::Decimal>,
    pub critical_low: Option<rust_decimal::Decimal>,
    pub critical_high: Option<rust_decimal::Decimal>,
    pub severity: String,
    pub notified_provider_id: Option<String>,
    pub notification_method: Option<String>,
    pub notified_at: Option<DateTime<Utc>>,
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub acknowledged_by: Option<String>,
    pub action_taken: Option<String>,
    pub reported_by: String,
    pub created_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Specimen collection entity (physical sample collection tracking)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct SpecimenCollectionEntity {
    pub id: String,
    pub patient_id: String,
    pub submission_id: String,
    pub specimen_type: String,
    pub collection_site: Option<String>,
    pub collection_method: Option<String>,
    pub collector_id: String,
    pub collected_at: DateTime<Utc>,
    pub received_at: Option<DateTime<Utc>>,
    pub received_by: Option<String>,
    pub container_type: Option<String>,
    pub volume_ml: Option<rust_decimal::Decimal>,
    pub temperature_c: Option<rust_decimal::Decimal>,
    pub condition: Option<String>,
    pub barcode: Option<String>,
    pub storage_location: Option<String>,
    pub chain_of_custody: Option<serde_json::Value>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Specimen rejection entity (rejected specimens with reasons)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct SpecimenRejectionEntity {
    pub id: String,
    pub specimen_id: String,
    pub patient_id: String,
    pub rejection_reason: String,
    pub rejection_category: String,
    pub detailed_notes: Option<String>,
    pub rejected_by: String,
    pub rejected_at: DateTime<Utc>,
    pub recollection_required: bool,
    pub recollection_scheduled: Option<DateTime<Utc>>,
    pub notified_ordering_provider: bool,
    pub notification_sent_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Lab trend entity (historical trend data for lab values)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LabTrendEntity {
    pub id: String,
    pub patient_id: String,
    pub test_code: String,
    pub test_name: String,
    pub values_json: serde_json::Value,
    pub unit: String,
    pub reference_low: Option<rust_decimal::Decimal>,
    pub reference_high: Option<rust_decimal::Decimal>,
    pub trend_direction: Option<String>,
    pub percent_change: Option<rust_decimal::Decimal>,
    pub first_value_date: Option<DateTime<Utc>>,
    pub last_value_date: Option<DateTime<Utc>>,
    pub data_points_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// =============================================================================
// PHASE 3: SURGICAL & PROCEDURES ENTITIES
// =============================================================================

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
    #[sqlx(skip)]
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
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
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
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Post-op note entity (post-operative follow-up documentation)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct PostOpNoteEntity {
    pub id: String,
    pub patient_id: String,
    pub operative_note_id: String,
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
    #[sqlx(skip)]
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
    pub anesthesia_type: String,
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
    #[sqlx(skip)]
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
    #[sqlx(skip)]
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
    #[sqlx(skip)]
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
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

// =============================================================================
// PHASE 3: RADIOLOGY & IMAGING ENTITIES
// =============================================================================

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
    #[sqlx(skip)]
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
    pub study_datetime: DateTime<Utc>,
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
    #[sqlx(skip)]
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
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

// =============================================================================
// PHASE 3: BLOOD BANK ENTITIES
// =============================================================================

/// Blood type screen entity (ABO/Rh typing and antibody screens)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct BloodTypeScreenEntity {
    pub id: String,
    pub patient_id: String,
    pub specimen_id: Option<String>,
    pub abo_type: String,
    pub rh_type: String,
    pub abo_confirmation: Option<String>,
    pub rh_confirmation: Option<String>,
    pub weak_d_testing: Option<bool>,
    pub weak_d_result: Option<String>,
    pub antibody_screen_result: String,
    pub antibodies_identified: Option<serde_json::Value>,
    pub antibody_titer: Option<serde_json::Value>,
    pub direct_antiglobulin_test: Option<String>,
    pub dat_specificity: Option<serde_json::Value>,
    pub special_requirements: Option<serde_json::Value>,
    pub historical_records_reviewed: Option<bool>,
    pub discrepancy_notes: Option<String>,
    pub performed_by: String,
    pub verified_by: Option<String>,
    pub performed_at: DateTime<Utc>,
    pub verified_at: Option<DateTime<Utc>>,
    pub expiration_date: Option<chrono::NaiveDate>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Crossmatch record entity (blood compatibility testing)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CrossmatchRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub blood_type_screen_id: String,
    pub unit_number: String,
    pub product_type: String,
    pub product_abo: String,
    pub product_rh: String,
    pub donation_date: Option<chrono::NaiveDate>,
    pub expiration_date: chrono::NaiveDate,
    pub crossmatch_type: String,
    pub result: String,
    pub incompatibility_details: Option<String>,
    pub special_processing: Option<serde_json::Value>,
    pub irradiated: Option<bool>,
    pub leukoreduced: Option<bool>,
    pub washed: Option<bool>,
    pub volume_reduced: Option<bool>,
    pub reserved_until: Option<DateTime<Utc>>,
    pub issued_at: Option<DateTime<Utc>>,
    pub issued_to: Option<String>,
    pub returned_at: Option<DateTime<Utc>>,
    pub return_reason: Option<String>,
    pub performed_by: String,
    pub verified_by: Option<String>,
    pub performed_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Transfusion record entity (blood product administration)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct TransfusionRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub crossmatch_id: String,
    pub unit_number: String,
    pub product_type: String,
    pub volume_ml: i32,
    pub ordering_provider_id: String,
    pub indication: String,
    pub pre_transfusion_vitals: serde_json::Value,
    pub pre_transfusion_labs: Option<serde_json::Value>,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub flow_rate_ml_hr: Option<i32>,
    pub administering_nurse_id: String,
    pub verifying_nurse_id: String,
    pub bedside_verification_time: DateTime<Utc>,
    pub patient_identification_method: String,
    pub vitals_15_min: Option<serde_json::Value>,
    pub vitals_1_hr: Option<serde_json::Value>,
    pub vitals_post: Option<serde_json::Value>,
    pub reaction_occurred: bool,
    pub reaction_type: Option<String>,
    pub reaction_severity: Option<String>,
    pub reaction_symptoms: Option<serde_json::Value>,
    pub reaction_time: Option<DateTime<Utc>>,
    pub reaction_interventions: Option<serde_json::Value>,
    pub transfusion_completed: bool,
    pub volume_transfused_ml: Option<i32>,
    pub reason_not_completed: Option<String>,
    pub post_transfusion_labs: Option<serde_json::Value>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

// =============================================================================
// PHASE 3: PHARMACY & MEDICATIONS ENTITIES
// =============================================================================

/// E-prescription entity (electronic prescription records)
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct EPrescriptionEntity {
    pub id: String,
    pub patient_id: String,
    pub prescriber_id: String,
    pub medication_name: String,
    pub medication_code: Option<String>,
    pub ndc_code: Option<String>,
    pub rxnorm_code: Option<String>,
    pub strength: Option<String>,
    pub strength_unit: Option<String>,
    pub dosage_form: String,
    pub route: String,
    pub frequency: String,
    pub duration_days: Option<i32>,
    pub quantity: i32,
    pub quantity_unit: Option<String>,
    pub refills_authorized: i32,
    pub refills_remaining: i32,
    pub daw_code: Option<String>,
    pub sig: String,
    pub diagnosis_codes: Option<serde_json::Value>,
    pub indication: Option<String>,
    pub is_controlled: bool,
    pub schedule: Option<String>,
    pub prior_authorization_required: Option<bool>,
    pub prior_authorization_number: Option<String>,
    pub pharmacy_id: Option<String>,
    pub pharmacy_name: Option<String>,
    pub pharmacy_npi: Option<String>,
    pub status: String,
    pub sent_at: Option<DateTime<Utc>>,
    pub filled_at: Option<DateTime<Utc>>,
    pub fill_number: Option<i32>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Drug interaction entity (drug-drug and drug-allergy interactions)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DrugInteractionEntity {
    pub id: String,
    pub patient_id: String,
    pub prescription_id: Option<String>,
    pub drug1_name: String,
    pub drug1_code: Option<String>,
    pub drug2_name: Option<String>,
    pub drug2_code: Option<String>,
    pub interaction_type: String,
    pub severity: String,
    pub clinical_significance: String,
    pub mechanism: Option<String>,
    pub management: Option<String>,
    pub documentation_level: Option<String>,
    pub detected_at: DateTime<Utc>,
    pub acknowledged: bool,
    pub acknowledged_by: Option<String>,
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub override_reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Medication reminder entity (patient medication reminder schedules)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MedicationReminderEntity {
    pub id: String,
    pub patient_id: String,
    pub prescription_id: Option<String>,
    pub medication_name: String,
    pub dosage: Option<String>,
    pub scheduled_time: chrono::NaiveTime,
    pub days_of_week: serde_json::Value,
    pub reminder_type: String,
    pub is_active: bool,
    pub snooze_minutes: Option<i32>,
    pub max_snoozes: Option<i32>,
    pub escalation_contact: Option<String>,
    pub start_date: chrono::NaiveDate,
    pub end_date: Option<chrono::NaiveDate>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Extras packed by the legacy `MedicationReminder` model (reminder_times vec,
    /// frequency enum, created_by, notification_prefs). Memory backend round-trips
    /// this; Postgres backend does not persist it (no schema column).
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Adherence log entity (medication adherence tracking)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AdherenceLogEntity {
    pub id: String,
    pub patient_id: String,
    pub reminder_id: Option<String>,
    pub prescription_id: Option<String>,
    pub medication_name: String,
    pub scheduled_time: DateTime<Utc>,
    pub action_taken: String,
    pub actual_time: Option<DateTime<Utc>>,
    pub reported_by: Option<String>,
    pub skip_reason: Option<String>,
    pub side_effects_reported: Option<serde_json::Value>,
    pub notes: Option<String>,
    pub device_id: Option<String>,
    pub location: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

// =============================================================================
// PHASE 3: REPOSITORY TRAITS
// =============================================================================

/// Lab submission repository trait
#[async_trait]
pub trait LabSubmissionRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        submission: LabSubmissionEntity,
    ) -> RepositoryResult<LabSubmissionEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabSubmissionEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabSubmissionEntity>>;
    async fn get_by_provider(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabSubmissionEntity>>;
    async fn update(
        &self,
        submission: LabSubmissionEntity,
    ) -> RepositoryResult<LabSubmissionEntity>;
    async fn get_pending_by_priority(&self) -> RepositoryResult<Vec<LabSubmissionEntity>>;
}

/// Lab panel repository trait
#[async_trait]
pub trait LabPanelRepository: Send + Sync + fmt::Debug {
    async fn create(&self, panel: LabPanelEntity) -> RepositoryResult<LabPanelEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabPanelEntity>;
    async fn get_by_submission(&self, submission_id: &str)
        -> RepositoryResult<Vec<LabPanelEntity>>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabPanelEntity>>;
    async fn update(&self, panel: LabPanelEntity) -> RepositoryResult<LabPanelEntity>;
    async fn get_abnormal_results(&self, patient_id: &str)
        -> RepositoryResult<Vec<LabPanelEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<LabPanelEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

/// Lab QC record repository trait
#[async_trait]
pub trait LabQcRecordRepository: Send + Sync + fmt::Debug {
    async fn create(&self, record: LabQcRecordEntity) -> RepositoryResult<LabQcRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabQcRecordEntity>;
    async fn get_by_instrument(
        &self,
        instrument_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabQcRecordEntity>>;
    async fn get_failed_records(
        &self,
        date_range: Option<DateRange>,
    ) -> RepositoryResult<Vec<LabQcRecordEntity>>;
    async fn update(&self, record: LabQcRecordEntity) -> RepositoryResult<LabQcRecordEntity>;
    async fn list_all(&self) -> RepositoryResult<Vec<LabQcRecordEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

/// Critical value repository trait
#[async_trait]
pub trait CriticalValueRepository: Send + Sync + fmt::Debug {
    async fn create(&self, value: CriticalValueEntity) -> RepositoryResult<CriticalValueEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<CriticalValueEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CriticalValueEntity>>;
    async fn get_unacknowledged(&self) -> RepositoryResult<Vec<CriticalValueEntity>>;
    async fn acknowledge(
        &self,
        id: &str,
        acknowledged_by: &str,
        action_taken: &str,
    ) -> RepositoryResult<CriticalValueEntity>;
    async fn list_all(&self) -> RepositoryResult<Vec<CriticalValueEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

/// Specimen collection repository trait
#[async_trait]
pub trait SpecimenCollectionRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        specimen: SpecimenCollectionEntity,
    ) -> RepositoryResult<SpecimenCollectionEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<SpecimenCollectionEntity>;
    async fn get_by_barcode(
        &self,
        barcode: &str,
    ) -> RepositoryResult<Option<SpecimenCollectionEntity>>;
    async fn get_by_submission(
        &self,
        submission_id: &str,
    ) -> RepositoryResult<Vec<SpecimenCollectionEntity>>;
    async fn update(
        &self,
        specimen: SpecimenCollectionEntity,
    ) -> RepositoryResult<SpecimenCollectionEntity>;
    async fn list_all(&self) -> RepositoryResult<Vec<SpecimenCollectionEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

/// Specimen rejection repository trait
#[async_trait]
pub trait SpecimenRejectionRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        rejection: SpecimenRejectionEntity,
    ) -> RepositoryResult<SpecimenRejectionEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<SpecimenRejectionEntity>;
    async fn get_by_specimen(
        &self,
        specimen_id: &str,
    ) -> RepositoryResult<Vec<SpecimenRejectionEntity>>;
    async fn get_pending_recollections(&self) -> RepositoryResult<Vec<SpecimenRejectionEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<SpecimenRejectionEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

/// Lab trend repository trait
#[async_trait]
pub trait LabTrendRepository: Send + Sync + fmt::Debug {
    async fn create(&self, trend: LabTrendEntity) -> RepositoryResult<LabTrendEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabTrendEntity>;
    async fn get_by_patient_test(
        &self,
        patient_id: &str,
        test_code: &str,
    ) -> RepositoryResult<Option<LabTrendEntity>>;
    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<LabTrendEntity>>;
    async fn update(&self, trend: LabTrendEntity) -> RepositoryResult<LabTrendEntity>;
    async fn list_all(&self) -> RepositoryResult<Vec<LabTrendEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
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
    async fn list_all(&self) -> RepositoryResult<Vec<OperativeNoteEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
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
    async fn list_all(&self) -> RepositoryResult<Vec<AnesthesiaRecordEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
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
    async fn list_all(&self) -> RepositoryResult<Vec<IntubationRecordEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
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
    async fn list_all(&self) -> RepositoryResult<Vec<LacerationRepairEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
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
    async fn list_all(&self) -> RepositoryResult<Vec<RadiologyOrderEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
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
    async fn list_all(&self) -> RepositoryResult<Vec<RadiologyReportEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
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
    async fn list_all(&self) -> RepositoryResult<Vec<PathologyReportEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

/// Blood type screen repository trait
#[async_trait]
pub trait BloodTypeScreenRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        screen: BloodTypeScreenEntity,
    ) -> RepositoryResult<BloodTypeScreenEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<BloodTypeScreenEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BloodTypeScreenEntity>>;
    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<BloodTypeScreenEntity>>;
    async fn update(
        &self,
        screen: BloodTypeScreenEntity,
    ) -> RepositoryResult<BloodTypeScreenEntity>;
    async fn list_all(&self) -> RepositoryResult<Vec<BloodTypeScreenEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

/// Crossmatch record repository trait
#[async_trait]
pub trait CrossmatchRecordRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        record: CrossmatchRecordEntity,
    ) -> RepositoryResult<CrossmatchRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<CrossmatchRecordEntity>;
    async fn get_by_unit(
        &self,
        unit_number: &str,
    ) -> RepositoryResult<Option<CrossmatchRecordEntity>>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CrossmatchRecordEntity>>;
    async fn update(
        &self,
        record: CrossmatchRecordEntity,
    ) -> RepositoryResult<CrossmatchRecordEntity>;
    async fn get_reserved_units(&self) -> RepositoryResult<Vec<CrossmatchRecordEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<CrossmatchRecordEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

/// Transfusion record repository trait
#[async_trait]
pub trait TransfusionRecordRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        record: TransfusionRecordEntity,
    ) -> RepositoryResult<TransfusionRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<TransfusionRecordEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TransfusionRecordEntity>>;
    async fn update(
        &self,
        record: TransfusionRecordEntity,
    ) -> RepositoryResult<TransfusionRecordEntity>;
    async fn get_reactions(
        &self,
        date_range: Option<DateRange>,
    ) -> RepositoryResult<Vec<TransfusionRecordEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<TransfusionRecordEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

/// E-prescription repository trait
#[async_trait]
pub trait EPrescriptionRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        prescription: EPrescriptionEntity,
    ) -> RepositoryResult<EPrescriptionEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<EPrescriptionEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EPrescriptionEntity>>;
    async fn get_by_prescriber(
        &self,
        prescriber_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EPrescriptionEntity>>;
    async fn update(
        &self,
        prescription: EPrescriptionEntity,
    ) -> RepositoryResult<EPrescriptionEntity>;
    async fn get_active_controlled(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<EPrescriptionEntity>>;

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EPrescriptionEntity>>;
}

/// Drug interaction repository trait
#[async_trait]
pub trait DrugInteractionRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        interaction: DrugInteractionEntity,
    ) -> RepositoryResult<DrugInteractionEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<DrugInteractionEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<DrugInteractionEntity>>;
    async fn get_unacknowledged(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<DrugInteractionEntity>>;
    async fn acknowledge(
        &self,
        id: &str,
        acknowledged_by: &str,
        override_reason: Option<&str>,
    ) -> RepositoryResult<DrugInteractionEntity>;
}

/// Medication reminder repository trait
#[async_trait]
pub trait MedicationReminderRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        reminder: MedicationReminderEntity,
    ) -> RepositoryResult<MedicationReminderEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<MedicationReminderEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<MedicationReminderEntity>>;
    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<MedicationReminderEntity>>;
    async fn update(
        &self,
        reminder: MedicationReminderEntity,
    ) -> RepositoryResult<MedicationReminderEntity>;
    async fn deactivate(&self, id: &str) -> RepositoryResult<()>;
    /// Return all active reminders across all patients. Used by the background
    /// notification dispatcher to scan for due times. Default implementation returns
    /// an error so backends opt-in by overriding.
    async fn list_all_active(&self) -> RepositoryResult<Vec<MedicationReminderEntity>> {
        Err(RepositoryError::NotFound(
            "list_all_active not implemented".to_string(),
        ))
    }
}

/// Adherence log repository trait
#[async_trait]
pub trait AdherenceLogRepository: Send + Sync + fmt::Debug {
    async fn create(&self, log: AdherenceLogEntity) -> RepositoryResult<AdherenceLogEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<AdherenceLogEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        date_range: Option<DateRange>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AdherenceLogEntity>>;
    async fn get_by_reminder(
        &self,
        reminder_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AdherenceLogEntity>>;
    async fn get_adherence_rate(
        &self,
        patient_id: &str,
        medication_name: &str,
        days: i32,
    ) -> RepositoryResult<f64>;
}

// =============================================================================
// PHASE 4: SPECIALTY ASSESSMENTS
// =============================================================================

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
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
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
    pub suicidal_ideation: bool,
    pub suicidal_plan: bool,
    pub suicidal_intent: bool,
    pub suicidal_means_access: bool,
    pub homicidal_ideation: bool,
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
    pub risk_level: String,
    pub disposition: Option<String>,
    pub involuntary_hold: bool,
    pub hold_type: Option<String>,
    pub sitter_required: bool,
    pub one_to_one_observation: bool,
    pub psychiatry_consulted: bool,
    pub psychiatrist_id: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
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
    #[sqlx(skip)]
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
    pub age_months: i32,
    pub weight_kg: Option<rust_decimal::Decimal>,
    pub weight_estimated: bool,
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
    pub parent_guardian_present: bool,
    pub parent_guardian_name: Option<String>,
    pub parent_guardian_relationship: Option<String>,
    pub child_protective_concerns: bool,
    pub cps_notified: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
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
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

// =============================================================================
// PHASE 5: ADMINISTRATIVE & SCHEDULING
// =============================================================================

/// Appointment entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct AppointmentEntity {
    pub id: String,
    pub patient_id: String,
    pub provider_id: String,
    pub appointment_type: String,
    pub scheduled_datetime: DateTime<Utc>,
    pub duration_minutes: i32,
    pub status: String,
    pub location: Option<String>,
    pub room: Option<String>,
    pub reason_for_visit: Option<String>,
    pub visit_type: Option<String>,
    pub priority: Option<String>,
    pub recurring: bool,
    pub recurrence_pattern: Option<String>,
    pub parent_appointment_id: Option<String>,
    pub insurance_verified: bool,
    pub copay_amount: Option<rust_decimal::Decimal>,
    pub copay_collected: bool,
    pub reminder_sent: bool,
    pub reminder_sent_at: Option<DateTime<Utc>>,
    pub check_in_time: Option<DateTime<Utc>>,
    pub check_out_time: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancellation_reason: Option<String>,
    pub cancelled_by: Option<String>,
    pub notes: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Physician Order entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct PhysicianOrderEntity {
    pub id: String,
    pub patient_id: String,
    pub ordering_provider_id: String,
    pub order_datetime: DateTime<Utc>,
    pub order_type: String,
    pub priority: String,
    pub status: String,
    pub order_details: serde_json::Value,
    pub indication: Option<String>,
    pub diagnosis_codes: Option<serde_json::Value>,
    pub start_datetime: Option<DateTime<Utc>>,
    pub end_datetime: Option<DateTime<Utc>>,
    pub frequency: Option<String>,
    pub duration: Option<String>,
    pub special_instructions: Option<String>,
    pub requires_cosign: bool,
    pub cosigned_by: Option<String>,
    pub cosigned_at: Option<DateTime<Utc>>,
    pub verified_by: Option<String>,
    pub verified_at: Option<DateTime<Utc>>,
    pub executed_by: Option<String>,
    pub executed_at: Option<DateTime<Utc>>,
    pub discontinued_by: Option<String>,
    pub discontinued_at: Option<DateTime<Utc>>,
    pub discontinue_reason: Option<String>,
    pub linked_order_id: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Discharge Summary entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct DischargeSummaryEntity {
    pub id: String,
    pub patient_id: String,
    pub encounter_id: String,
    pub attending_physician_id: String,
    pub admission_datetime: DateTime<Utc>,
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
    #[sqlx(skip)]
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
    #[sqlx(skip)]
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
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
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
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Incident Report entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct IncidentReportEntity {
    pub id: String,
    pub patient_id: Option<String>,
    pub reporter_id: String,
    pub incident_datetime: DateTime<Utc>,
    pub discovery_datetime: DateTime<Utc>,
    pub incident_type: String,
    pub severity: String,
    pub location: String,
    pub department: Option<String>,
    pub description: String,
    pub immediate_actions_taken: Option<String>,
    pub patient_outcome: Option<String>,
    pub patient_notified: bool,
    pub patient_notified_by: Option<String>,
    pub family_notified: bool,
    pub attending_notified: bool,
    pub supervisor_notified: bool,
    pub risk_management_notified: bool,
    pub witnesses: Option<serde_json::Value>,
    pub contributing_factors: Option<serde_json::Value>,
    pub root_cause: Option<String>,
    pub preventable: Option<bool>,
    pub similar_incidents_prior: bool,
    pub corrective_actions: Option<serde_json::Value>,
    pub follow_up_required: bool,
    pub follow_up_assigned_to: Option<String>,
    pub follow_up_due_date: Option<chrono::NaiveDate>,
    pub follow_up_completed: bool,
    pub follow_up_completed_at: Option<DateTime<Utc>>,
    pub investigation_status: Option<String>,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub review_comments: Option<String>,
    pub regulatory_reportable: bool,
    pub reported_to_agencies: Option<serde_json::Value>,
    pub confidential: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

// =============================================================================
// PHASE 6: EMS & EXTERNAL
// =============================================================================

/// EMS Handoff entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct EmsHandoffEntity {
    pub id: String,
    pub patient_id: Option<String>,
    pub receiving_provider_id: String,
    pub handoff_datetime: DateTime<Utc>,
    pub ems_agency: String,
    pub ems_unit_number: Option<String>,
    pub crew_members: serde_json::Value,
    pub run_number: Option<String>,
    pub dispatch_time: Option<DateTime<Utc>>,
    pub on_scene_time: Option<DateTime<Utc>>,
    pub transport_start_time: Option<DateTime<Utc>>,
    pub arrival_time: DateTime<Utc>,
    pub scene_address: Option<String>,
    pub incident_type: Option<String>,
    pub chief_complaint: String,
    pub mechanism_of_injury: Option<String>,
    pub patient_found: Option<String>,
    pub mental_status_on_scene: Option<String>,
    pub gcs_on_scene: Option<i32>,
    pub vital_signs_on_scene: Option<serde_json::Value>,
    pub vital_signs_transport: Option<serde_json::Value>,
    pub vital_signs_arrival: Option<serde_json::Value>,
    pub interventions_performed: Option<serde_json::Value>,
    pub medications_given: Option<serde_json::Value>,
    pub iv_access_obtained: bool,
    pub iv_details: Option<serde_json::Value>,
    pub airway_management: Option<String>,
    pub cpr_performed: bool,
    pub aed_used: bool,
    pub shocks_delivered: Option<i32>,
    pub spinal_immobilization: bool,
    pub splinting_performed: bool,
    pub tourniquet_applied: bool,
    pub bleeding_controlled: Option<bool>,
    pub patient_belongings: Option<serde_json::Value>,
    pub family_at_scene: bool,
    pub family_contact_info: Option<String>,
    pub police_at_scene: bool,
    pub police_report_number: Option<String>,
    pub trauma_alert: bool,
    pub stroke_alert: bool,
    pub stemi_alert: bool,
    pub sepsis_alert: bool,
    pub report_received_by: Option<String>,
    pub report_received_time: Option<DateTime<Utc>>,
    pub verbal_report_complete: bool,
    pub ems_documentation_received: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// MCI Record entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct MciRecordEntity {
    pub id: String,
    pub incident_id: String,
    pub incident_name: String,
    pub incident_datetime: DateTime<Utc>,
    pub incident_location: String,
    pub incident_type: String,
    pub activation_level: String,
    pub incident_commander: Option<String>,
    pub medical_branch_director: Option<String>,
    pub hospital_incident_command_activated: bool,
    pub patient_id: Option<String>,
    pub triage_tag_number: Option<String>,
    pub triage_category: String,
    pub start_triage_category: Option<String>,
    pub arrival_datetime: Option<DateTime<Utc>>,
    pub arrival_mode: Option<String>,
    pub ems_agency: Option<String>,
    pub treatment_area: Option<String>,
    pub injuries: Option<serde_json::Value>,
    pub mechanism_of_injury: Option<String>,
    pub decontamination_required: bool,
    pub decontamination_completed: bool,
    pub treatments_provided: Option<serde_json::Value>,
    pub disposition: Option<String>,
    pub disposition_datetime: Option<DateTime<Utc>>,
    pub destination: Option<String>,
    pub family_notified: bool,
    pub family_reunification_completed: bool,
    pub patient_tracking_updated: bool,
    pub media_release_authorized: bool,
    pub special_circumstances: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Chain of Custody entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ChainOfCustodyEntity {
    pub id: String,
    pub patient_id: Option<String>,
    pub case_number: Option<String>,
    pub evidence_type: String,
    pub evidence_description: String,
    pub quantity: i32,
    pub unit_of_measure: Option<String>,
    pub collection_datetime: DateTime<Utc>,
    pub collection_location: Option<String>,
    pub collected_by: String,
    pub collection_witnessed_by: Option<String>,
    pub collection_method: Option<String>,
    pub packaging_description: Option<String>,
    pub seal_number: Option<String>,
    pub storage_location: Option<String>,
    pub storage_requirements: Option<String>,
    pub current_custodian_id: String,
    pub transfers: serde_json::Value,
    pub law_enforcement_agency: Option<String>,
    pub law_enforcement_officer: Option<String>,
    pub law_enforcement_badge: Option<String>,
    pub warrant_number: Option<String>,
    pub court_order_number: Option<String>,
    pub released_to: Option<String>,
    pub release_datetime: Option<DateTime<Utc>>,
    pub release_authorized_by: Option<String>,
    pub release_documentation: Option<String>,
    pub destruction_authorized: bool,
    pub destruction_datetime: Option<DateTime<Utc>>,
    pub destruction_method: Option<String>,
    pub destruction_witnessed_by: Option<String>,
    pub status: String,
    pub photos_taken: bool,
    pub photo_references: Option<serde_json::Value>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub data: serde_json::Value,
}

// =============================================================================
// PHASE 4-6: REPOSITORY TRAITS
// =============================================================================

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

/// Appointment repository trait
#[async_trait]
pub trait AppointmentRepository: Send + Sync + fmt::Debug {
    async fn create(&self, appointment: AppointmentEntity) -> RepositoryResult<AppointmentEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<AppointmentEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>>;
    async fn get_by_provider(
        &self,
        provider_id: &str,
        date: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<AppointmentEntity>>;
    async fn update(&self, appointment: AppointmentEntity) -> RepositoryResult<AppointmentEntity>;
    async fn cancel(
        &self,
        id: &str,
        reason: &str,
        cancelled_by: &str,
    ) -> RepositoryResult<AppointmentEntity>;
    async fn get_by_status(
        &self,
        status: &str,
        date: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<AppointmentEntity>>;
    /// List all appointments with pagination (for analytics views)
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>> {
        let _ = pagination;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Get all appointments for a provider (no date filter), paginated
    async fn get_by_provider_all(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>> {
        let _ = (provider_id, pagination);
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
}

/// Physician order repository trait
#[async_trait]
pub trait PhysicianOrderRepository: Send + Sync + fmt::Debug {
    async fn create(&self, order: PhysicianOrderEntity) -> RepositoryResult<PhysicianOrderEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<PhysicianOrderEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PhysicianOrderEntity>>;
    async fn update(&self, order: PhysicianOrderEntity) -> RepositoryResult<PhysicianOrderEntity>;
    async fn get_pending_orders(&self) -> RepositoryResult<Vec<PhysicianOrderEntity>>;
    async fn get_by_type(
        &self,
        order_type: &str,
        patient_id: &str,
    ) -> RepositoryResult<Vec<PhysicianOrderEntity>>;
    async fn discontinue(
        &self,
        id: &str,
        reason: &str,
        discontinued_by: &str,
    ) -> RepositoryResult<PhysicianOrderEntity>;
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
    async fn get_by_provider(
        &self,
        provider_id: &str,
        date: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<ShiftHandoffEntity>>;
    async fn acknowledge(&self, id: &str) -> RepositoryResult<ShiftHandoffEntity>;
    async fn get_unacknowledged(
        &self,
        incoming_provider_id: &str,
    ) -> RepositoryResult<Vec<ShiftHandoffEntity>>;
}

/// Incident report repository trait
#[async_trait]
pub trait IncidentReportRepository: Send + Sync + fmt::Debug {
    async fn create(&self, report: IncidentReportEntity) -> RepositoryResult<IncidentReportEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<IncidentReportEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IncidentReportEntity>>;
    async fn update(&self, report: IncidentReportEntity) -> RepositoryResult<IncidentReportEntity>;
    async fn get_open_investigations(&self) -> RepositoryResult<Vec<IncidentReportEntity>>;
    async fn get_by_severity(&self, severity: &str) -> RepositoryResult<Vec<IncidentReportEntity>>;
    async fn get_by_type(
        &self,
        incident_type: &str,
        date_range: Option<DateRange>,
    ) -> RepositoryResult<Vec<IncidentReportEntity>>;
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IncidentReportEntity>>;
}

/// EMS handoff repository trait
#[async_trait]
pub trait EmsHandoffRepository: Send + Sync + fmt::Debug {
    async fn create(&self, handoff: EmsHandoffEntity) -> RepositoryResult<EmsHandoffEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<EmsHandoffEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EmsHandoffEntity>>;
    async fn update(&self, handoff: EmsHandoffEntity) -> RepositoryResult<EmsHandoffEntity>;
    async fn get_recent(&self, hours: i32) -> RepositoryResult<Vec<EmsHandoffEntity>>;
    async fn get_alerts(&self) -> RepositoryResult<Vec<EmsHandoffEntity>>;
}

/// MCI record repository trait
#[async_trait]
pub trait MciRecordRepository: Send + Sync + fmt::Debug {
    async fn create(&self, record: MciRecordEntity) -> RepositoryResult<MciRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<MciRecordEntity>;
    async fn get_by_incident(&self, incident_id: &str) -> RepositoryResult<Vec<MciRecordEntity>>;
    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<MciRecordEntity>>;
    async fn update(&self, record: MciRecordEntity) -> RepositoryResult<MciRecordEntity>;
    async fn get_active_incidents(&self) -> RepositoryResult<Vec<MciRecordEntity>>;
    async fn get_by_triage_category(
        &self,
        incident_id: &str,
        category: &str,
    ) -> RepositoryResult<Vec<MciRecordEntity>>;
}

/// Chain of custody repository trait
#[async_trait]
pub trait ChainOfCustodyRepository: Send + Sync + fmt::Debug {
    async fn create(&self, record: ChainOfCustodyEntity) -> RepositoryResult<ChainOfCustodyEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ChainOfCustodyEntity>;
    async fn get_by_patient(&self, patient_id: &str)
        -> RepositoryResult<Vec<ChainOfCustodyEntity>>;
    async fn get_by_case(&self, case_number: &str) -> RepositoryResult<Vec<ChainOfCustodyEntity>>;
    async fn update(&self, record: ChainOfCustodyEntity) -> RepositoryResult<ChainOfCustodyEntity>;
    async fn transfer(
        &self,
        id: &str,
        new_custodian_id: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<ChainOfCustodyEntity>;
    async fn get_by_custodian(
        &self,
        custodian_id: &str,
    ) -> RepositoryResult<Vec<ChainOfCustodyEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

// =============================================================================
// PHASE 7-10 ENTITIES: Wearables, Telehealth, CDS, Insurance
// =============================================================================

/// Wearable device entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct WearableDeviceEntity {
    pub id: String,
    pub patient_id: String,
    pub device_type: String,
    pub device_manufacturer: Option<String>,
    pub device_model: Option<String>,
    pub device_serial_number: Option<String>,
    pub firmware_version: Option<String>,
    pub registered_datetime: DateTime<Utc>,
    pub registered_by: String,
    pub last_sync_datetime: Option<DateTime<Utc>>,
    pub sync_frequency_minutes: Option<i32>,
    pub battery_level_percent: Option<i32>,
    pub is_active: bool,
    pub connection_status: Option<String>,
    pub alert_thresholds: Option<serde_json::Value>,
    pub integration_api_key: Option<String>,
    pub integration_endpoint: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Wearable data entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct WearableDataEntity {
    pub id: String,
    pub device_id: String,
    pub patient_id: String,
    pub reading_datetime: DateTime<Utc>,
    pub data_type: String,
    pub value_numeric: Option<rust_decimal::Decimal>,
    pub value_text: Option<String>,
    pub value_json: Option<serde_json::Value>,
    pub unit_of_measure: Option<String>,
    pub quality_score: Option<rust_decimal::Decimal>,
    pub is_valid: Option<bool>,
    pub anomaly_detected: Option<bool>,
    pub anomaly_type: Option<String>,
    pub processed: Option<bool>,
    pub processed_datetime: Option<DateTime<Utc>>,
    pub raw_data: Option<Vec<u8>>,
    pub created_at: DateTime<Utc>,
}

/// Wearable alert entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct WearableAlertEntity {
    pub id: String,
    pub device_id: String,
    pub patient_id: String,
    pub data_reading_id: Option<String>,
    pub alert_datetime: DateTime<Utc>,
    pub alert_type: String,
    pub severity: String,
    pub alert_title: String,
    pub alert_message: String,
    pub threshold_value: Option<rust_decimal::Decimal>,
    pub actual_value: Option<rust_decimal::Decimal>,
    pub acknowledged: Option<bool>,
    pub acknowledged_by: Option<String>,
    pub acknowledged_datetime: Option<DateTime<Utc>>,
    pub escalated: Option<bool>,
    pub escalated_to: Option<String>,
    pub escalated_datetime: Option<DateTime<Utc>>,
    pub resolution_notes: Option<String>,
    pub resolved: Option<bool>,
    pub resolved_datetime: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Wearable integration log entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct WearableIntegrationLogEntity {
    pub id: String,
    pub device_id: String,
    pub patient_id: String,
    pub log_datetime: DateTime<Utc>,
    pub event_type: String,
    pub status: String,
    pub records_synced: Option<i32>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub request_payload: Option<serde_json::Value>,
    pub response_payload: Option<serde_json::Value>,
    pub duration_ms: Option<i32>,
    pub created_at: DateTime<Utc>,
}

/// Telehealth session entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct TelehealthSessionEntity {
    pub id: String,
    pub patient_id: String,
    pub provider_id: String,
    pub appointment_id: Option<String>,
    pub session_type: String,
    pub scheduled_datetime: DateTime<Utc>,
    pub actual_start_datetime: Option<DateTime<Utc>>,
    pub actual_end_datetime: Option<DateTime<Utc>>,
    pub duration_minutes: Option<i32>,
    pub status: String,
    pub platform: Option<String>,
    pub session_url: Option<String>,
    pub session_access_code: Option<String>,
    pub patient_location: Option<String>,
    pub patient_device_type: Option<String>,
    pub provider_location: Option<String>,
    pub connection_quality: Option<String>,
    pub technical_issues: Option<serde_json::Value>,
    pub interpreter_required: Option<bool>,
    pub interpreter_language: Option<String>,
    pub interpreter_present: Option<bool>,
    pub guardian_present: Option<bool>,
    pub guardian_name: Option<String>,
    pub consent_obtained: bool,
    pub consent_datetime: Option<DateTime<Utc>>,
    pub billing_code: Option<String>,
    pub reason_for_visit: Option<String>,
    pub chief_complaint: Option<String>,
    pub follow_up_required: Option<bool>,
    pub follow_up_notes: Option<String>,
    pub recording_available: Option<bool>,
    pub recording_url: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Telehealth note entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct TelehealthNoteEntity {
    pub id: String,
    pub session_id: String,
    pub patient_id: String,
    pub provider_id: String,
    pub note_datetime: DateTime<Utc>,
    pub subjective: Option<String>,
    pub objective: Option<String>,
    pub assessment: Option<String>,
    pub plan: Option<String>,
    pub physical_exam_limitations: Option<String>,
    pub recommendations_for_inperson: Option<String>,
    pub prescriptions_issued: Option<serde_json::Value>,
    pub referrals_made: Option<serde_json::Value>,
    pub lab_orders: Option<serde_json::Value>,
    pub imaging_orders: Option<serde_json::Value>,
    pub patient_education_provided: Option<String>,
    pub patient_understanding_verified: Option<bool>,
    pub follow_up_timeframe: Option<String>,
    pub provider_signature: Option<String>,
    pub signed_datetime: Option<DateTime<Utc>>,
    pub addendum: Option<String>,
    pub addendum_datetime: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Remote patient monitoring entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct RemotePatientMonitoringEntity {
    pub id: String,
    pub patient_id: String,
    pub program_name: String,
    pub enrollment_date: chrono::NaiveDate,
    pub enrolled_by: String,
    pub primary_condition: String,
    pub secondary_conditions: Option<serde_json::Value>,
    pub monitoring_parameters: serde_json::Value,
    pub target_goals: Option<serde_json::Value>,
    pub alert_thresholds: serde_json::Value,
    pub monitoring_frequency: Option<String>,
    pub assigned_care_manager: Option<String>,
    pub care_team_members: Option<serde_json::Value>,
    pub devices_assigned: Option<serde_json::Value>,
    pub billing_eligible: Option<bool>,
    pub insurance_authorization: Option<String>,
    pub authorization_expiry: Option<chrono::NaiveDate>,
    pub status: String,
    pub status_reason: Option<String>,
    pub graduation_criteria: Option<String>,
    pub last_review_date: Option<chrono::NaiveDate>,
    pub next_review_date: Option<chrono::NaiveDate>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// RPM reading entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct RpmReadingEntity {
    pub id: String,
    pub rpm_enrollment_id: String,
    pub patient_id: String,
    pub device_id: Option<String>,
    pub reading_datetime: DateTime<Utc>,
    pub reading_type: String,
    pub systolic: Option<i32>,
    pub diastolic: Option<i32>,
    pub value_numeric: Option<rust_decimal::Decimal>,
    pub unit_of_measure: Option<String>,
    pub measurement_context: Option<String>,
    pub symptoms_reported: Option<String>,
    pub patient_notes: Option<String>,
    pub is_within_target: Option<bool>,
    pub deviation_type: Option<String>,
    pub deviation_severity: Option<String>,
    pub alert_triggered: Option<bool>,
    pub alert_id: Option<String>,
    pub reviewed: Option<bool>,
    pub reviewed_by: Option<String>,
    pub reviewed_datetime: Option<DateTime<Utc>>,
    pub review_notes: Option<String>,
    pub action_taken: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// CDS alert entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct CdsAlertEntity {
    pub id: String,
    pub patient_id: String,
    pub encounter_id: Option<String>,
    pub provider_id: String,
    pub alert_datetime: DateTime<Utc>,
    pub alert_type: String,
    pub alert_category: String,
    pub severity: String,
    pub alert_title: String,
    pub alert_message: String,
    pub clinical_evidence: Option<String>,
    pub recommendation: Option<String>,
    pub source_system: Option<String>,
    pub rule_id: Option<String>,
    pub rule_version: Option<String>,
    pub trigger_data: Option<serde_json::Value>,
    pub related_order_id: Option<String>,
    pub related_medication_id: Option<String>,
    pub related_lab_id: Option<String>,
    pub status: String,
    pub acknowledged_by: Option<String>,
    pub acknowledged_datetime: Option<DateTime<Utc>>,
    pub override_reason: Option<String>,
    pub override_justification: Option<String>,
    pub action_taken: Option<String>,
    pub action_datetime: Option<DateTime<Utc>>,
    pub auto_resolved: Option<bool>,
    pub resolution_reason: Option<String>,
    pub was_helpful: Option<bool>,
    pub feedback_notes: Option<String>,
    pub displayed_duration_seconds: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Insurance record entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct InsuranceRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub insurance_type: String,
    pub payer_name: String,
    pub payer_id: Option<String>,
    pub plan_name: Option<String>,
    pub plan_type: Option<String>,
    pub policy_number: String,
    pub group_number: Option<String>,
    pub subscriber_id: String,
    pub subscriber_name: Option<String>,
    pub subscriber_relationship: Option<String>,
    pub subscriber_dob: Option<chrono::NaiveDate>,
    pub effective_date: chrono::NaiveDate,
    pub termination_date: Option<chrono::NaiveDate>,
    pub is_active: bool,
    pub copay_amount: Option<rust_decimal::Decimal>,
    /// ISO 4217 currency code for all monetary amounts on this record.
    /// Defaults to ZAR (South African Rand) — amounts are NOT US dollars.
    #[serde(default = "default_currency_zar")]
    pub currency: Option<String>,
    pub deductible_amount: Option<rust_decimal::Decimal>,
    pub deductible_met: Option<rust_decimal::Decimal>,
    pub out_of_pocket_max: Option<rust_decimal::Decimal>,
    pub out_of_pocket_met: Option<rust_decimal::Decimal>,
    pub coinsurance_percent: Option<rust_decimal::Decimal>,
    pub coverage_details: Option<serde_json::Value>,
    pub prior_auth_required: Option<bool>,
    pub prior_auth_phone: Option<String>,
    pub claims_address: Option<String>,
    pub claims_phone: Option<String>,
    pub claims_fax: Option<String>,
    pub electronic_claims_eligible: Option<bool>,
    pub verification_status: Option<String>,
    pub last_verified_date: Option<chrono::NaiveDate>,
    pub last_verified_by: Option<String>,
    pub verification_notes: Option<String>,
    pub card_front_image_url: Option<String>,
    pub card_back_image_url: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Billing code entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct BillingCodeEntity {
    pub id: String,
    pub code_type: String,
    pub code: String,
    pub description: String,
    pub short_description: Option<String>,
    pub category: Option<String>,
    pub subcategory: Option<String>,
    pub effective_date: Option<chrono::NaiveDate>,
    pub termination_date: Option<chrono::NaiveDate>,
    pub is_active: bool,
    pub billable: Option<bool>,
    pub requires_modifier: Option<bool>,
    pub common_modifiers: Option<serde_json::Value>,
    pub relative_value_units: Option<rust_decimal::Decimal>,
    pub global_period_days: Option<i32>,
    pub age_restrictions: Option<serde_json::Value>,
    pub gender_restrictions: Option<String>,
    pub place_of_service_restrictions: Option<serde_json::Value>,
    pub requires_prior_auth: Option<bool>,
    pub typical_duration_minutes: Option<i32>,
    pub add_on_code: Option<bool>,
    pub parent_code: Option<String>,
    pub laterality_applicable: Option<bool>,
    pub notes: Option<String>,
    pub last_updated_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// =============================================================================
// PHASE 7-10 REPOSITORY TRAITS
// =============================================================================

/// Wearable device repository trait
#[async_trait]
pub trait WearableDeviceRepository: Send + Sync + fmt::Debug {
    async fn create(&self, device: WearableDeviceEntity) -> RepositoryResult<WearableDeviceEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<WearableDeviceEntity>;
    async fn get_by_patient(&self, patient_id: &str)
        -> RepositoryResult<Vec<WearableDeviceEntity>>;
    async fn update(&self, device: WearableDeviceEntity) -> RepositoryResult<WearableDeviceEntity>;
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
    async fn get_active(&self) -> RepositoryResult<Vec<WearableDeviceEntity>>;
    async fn update_sync_status(
        &self,
        id: &str,
        last_sync: DateTime<Utc>,
    ) -> RepositoryResult<WearableDeviceEntity>;
}

/// Wearable data repository trait
#[async_trait]
pub trait WearableDataRepository: Send + Sync + fmt::Debug {
    async fn create(&self, data: WearableDataEntity) -> RepositoryResult<WearableDataEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<WearableDataEntity>;
    async fn get_by_device(
        &self,
        device_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableDataEntity>>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        data_type: Option<&str>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableDataEntity>>;
    async fn get_anomalies(&self, patient_id: &str) -> RepositoryResult<Vec<WearableDataEntity>>;
    async fn get_unprocessed(&self, limit: i32) -> RepositoryResult<Vec<WearableDataEntity>>;
    async fn mark_processed(&self, id: &str) -> RepositoryResult<WearableDataEntity>;
}

/// Wearable alert repository trait
#[async_trait]
pub trait WearableAlertRepository: Send + Sync + fmt::Debug {
    async fn create(&self, alert: WearableAlertEntity) -> RepositoryResult<WearableAlertEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<WearableAlertEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableAlertEntity>>;
    async fn get_unacknowledged(&self) -> RepositoryResult<Vec<WearableAlertEntity>>;
    async fn acknowledge(
        &self,
        id: &str,
        acknowledged_by: &str,
    ) -> RepositoryResult<WearableAlertEntity>;
    async fn escalate(&self, id: &str, escalated_to: &str)
        -> RepositoryResult<WearableAlertEntity>;
    async fn resolve(
        &self,
        id: &str,
        resolution_notes: Option<&str>,
    ) -> RepositoryResult<WearableAlertEntity>;
}

/// Wearable integration log repository trait
#[async_trait]
pub trait WearableIntegrationLogRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        log: WearableIntegrationLogEntity,
    ) -> RepositoryResult<WearableIntegrationLogEntity>;
    async fn get_by_device(
        &self,
        device_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableIntegrationLogEntity>>;
    async fn get_failures(&self, hours: i32)
        -> RepositoryResult<Vec<WearableIntegrationLogEntity>>;
}

/// Telehealth session repository trait
#[async_trait]
pub trait TelehealthSessionRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        session: TelehealthSessionEntity,
    ) -> RepositoryResult<TelehealthSessionEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<TelehealthSessionEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TelehealthSessionEntity>>;
    async fn get_by_provider(
        &self,
        provider_id: &str,
        date: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<TelehealthSessionEntity>>;
    async fn update(
        &self,
        session: TelehealthSessionEntity,
    ) -> RepositoryResult<TelehealthSessionEntity>;
    async fn get_upcoming(
        &self,
        provider_id: &str,
    ) -> RepositoryResult<Vec<TelehealthSessionEntity>>;
    async fn start_session(&self, id: &str) -> RepositoryResult<TelehealthSessionEntity>;
    async fn end_session(&self, id: &str) -> RepositoryResult<TelehealthSessionEntity>;
}

/// Telehealth note repository trait
#[async_trait]
pub trait TelehealthNoteRepository: Send + Sync + fmt::Debug {
    async fn create(&self, note: TelehealthNoteEntity) -> RepositoryResult<TelehealthNoteEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<TelehealthNoteEntity>;
    async fn get_by_session(
        &self,
        session_id: &str,
    ) -> RepositoryResult<Option<TelehealthNoteEntity>>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TelehealthNoteEntity>>;
    async fn update(&self, note: TelehealthNoteEntity) -> RepositoryResult<TelehealthNoteEntity>;
    async fn sign(
        &self,
        id: &str,
        provider_signature: &str,
    ) -> RepositoryResult<TelehealthNoteEntity>;
    async fn add_addendum(
        &self,
        id: &str,
        addendum: &str,
    ) -> RepositoryResult<TelehealthNoteEntity>;
}

/// Remote patient monitoring repository trait
#[async_trait]
pub trait RemotePatientMonitoringRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        enrollment: RemotePatientMonitoringEntity,
    ) -> RepositoryResult<RemotePatientMonitoringEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<RemotePatientMonitoringEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<RemotePatientMonitoringEntity>>;
    async fn get_active_by_program(
        &self,
        program_name: &str,
    ) -> RepositoryResult<Vec<RemotePatientMonitoringEntity>>;
    async fn update(
        &self,
        enrollment: RemotePatientMonitoringEntity,
    ) -> RepositoryResult<RemotePatientMonitoringEntity>;
    async fn update_status(
        &self,
        id: &str,
        status: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<RemotePatientMonitoringEntity>;
    async fn get_by_care_manager(
        &self,
        care_manager_id: &str,
    ) -> RepositoryResult<Vec<RemotePatientMonitoringEntity>>;
}

/// RPM reading repository trait
#[async_trait]
pub trait RpmReadingRepository: Send + Sync + fmt::Debug {
    async fn create(&self, reading: RpmReadingEntity) -> RepositoryResult<RpmReadingEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<RpmReadingEntity>;
    async fn get_by_enrollment(
        &self,
        enrollment_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RpmReadingEntity>>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        reading_type: Option<&str>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RpmReadingEntity>>;
    async fn get_unreviewed(&self) -> RepositoryResult<Vec<RpmReadingEntity>>;
    async fn review(
        &self,
        id: &str,
        reviewed_by: &str,
        notes: Option<&str>,
        action: Option<&str>,
    ) -> RepositoryResult<RpmReadingEntity>;
    async fn get_alerts(&self, enrollment_id: &str) -> RepositoryResult<Vec<RpmReadingEntity>>;
}

/// CDS alert repository trait
#[async_trait]
pub trait CdsAlertRepository: Send + Sync + fmt::Debug {
    async fn create(&self, alert: CdsAlertEntity) -> RepositoryResult<CdsAlertEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<CdsAlertEntity>;
    /// Replace an existing alert in its entirety (used to round-trip response payloads
    /// the narrower acknowledge/override_alert methods can't capture).
    async fn update(&self, alert: CdsAlertEntity) -> RepositoryResult<CdsAlertEntity> {
        let _ = alert;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Get alerts by patient with optional active_only filter
    async fn get_by_patient(
        &self,
        patient_id: &str,
        active_only: bool,
    ) -> RepositoryResult<Vec<CdsAlertEntity>>;
    /// Acknowledge an alert with optional reason
    async fn acknowledge(
        &self,
        id: &str,
        by: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<CdsAlertEntity>;
    /// Override an alert with reason
    async fn override_alert(
        &self,
        id: &str,
        by: &str,
        reason: &str,
    ) -> RepositoryResult<CdsAlertEntity>;
    /// Get alerts by encounter ID
    async fn get_by_encounter(&self, encounter_id: &str) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let _ = encounter_id;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Get unacknowledged alerts, optionally filtered by patient
    async fn get_unacknowledged(
        &self,
        patient_id: Option<&str>,
    ) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let _ = patient_id;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Dismiss an alert
    async fn dismiss(&self, id: &str) -> RepositoryResult<CdsAlertEntity> {
        let _ = id;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Get alerts by rule ID with pagination
    async fn get_by_rule(
        &self,
        rule_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CdsAlertEntity>> {
        let _ = (rule_id, pagination);
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Get high severity alerts
    async fn get_high_severity(&self) -> RepositoryResult<Vec<CdsAlertEntity>> {
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// List all alerts with pagination (for admin/analytics views)
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CdsAlertEntity>> {
        let _ = pagination;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
}

/// Insurance record repository trait
#[async_trait]
pub trait InsuranceRecordRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        record: InsuranceRecordEntity,
    ) -> RepositoryResult<InsuranceRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<InsuranceRecordEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<InsuranceRecordEntity>>;
    async fn update(
        &self,
        record: InsuranceRecordEntity,
    ) -> RepositoryResult<InsuranceRecordEntity>;
    /// Get active insurance by patient (default to get_by_patient filtered)
    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<InsuranceRecordEntity>> {
        // Default: use get_active if available
        self.get_active(patient_id).await
    }
    /// Verify insurance record
    async fn verify(
        &self,
        id: &str,
        verified_by: &str,
        _notes: Option<&str>,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        // Default: use verify_eligibility
        self.verify_eligibility(id, verified_by).await
    }
    /// Deactivate insurance record
    async fn deactivate(&self, id: &str) -> RepositoryResult<InsuranceRecordEntity> {
        let _ = id;
        Err(RepositoryError::NotImplemented(
            "deactivate not implemented".into(),
        ))
    }
    /// Get insurance records expiring within days
    async fn get_expiring(&self, days: i32) -> RepositoryResult<Vec<InsuranceRecordEntity>> {
        let _ = days;
        Err(RepositoryError::NotImplemented(
            "get_expiring not implemented".into(),
        ))
    }
    /// Get primary insurance for a patient
    async fn get_primary(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<InsuranceRecordEntity>> {
        let _ = patient_id;
        Err(RepositoryError::NotImplemented(
            "get_primary not implemented".into(),
        ))
    }
    /// Get all active insurance records for a patient
    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<InsuranceRecordEntity>> {
        let _ = patient_id;
        Err(RepositoryError::NotImplemented(
            "get_active not implemented".into(),
        ))
    }
    /// Verify eligibility for an insurance record
    async fn verify_eligibility(
        &self,
        id: &str,
        verified_by: &str,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        let _ = (id, verified_by);
        Err(RepositoryError::NotImplemented(
            "verify_eligibility not implemented".into(),
        ))
    }

    /// Designate an insurance record as primary for the patient
    async fn set_primary(&self, patient_id: &str, record_id: &str) -> RepositoryResult<()> {
        let _ = (patient_id, record_id);
        Err(RepositoryError::NotImplemented(
            "set_primary not implemented".into(),
        ))
    }

    /// Terminate an insurance record (mark inactive and set termination date)
    async fn terminate(
        &self,
        id: &str,
        termination_date: chrono::NaiveDate,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        let _ = (id, termination_date);
        Err(RepositoryError::NotImplemented(
            "terminate not implemented".into(),
        ))
    }
}

/// Billing code repository trait
#[async_trait]
pub trait BillingCodeRepository: Send + Sync + fmt::Debug {
    async fn create(&self, code: BillingCodeEntity) -> RepositoryResult<BillingCodeEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<BillingCodeEntity>;
    async fn get_by_code(
        &self,
        code_type: &str,
        code: &str,
    ) -> RepositoryResult<Option<BillingCodeEntity>>;
    async fn search(
        &self,
        query: &str,
        code_type: Option<&str>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BillingCodeEntity>>;
    async fn update(&self, code: BillingCodeEntity) -> RepositoryResult<BillingCodeEntity>;
    async fn get_by_category(&self, category: &str) -> RepositoryResult<Vec<BillingCodeEntity>>;

    /// Get active billing codes by type
    async fn get_active(&self, code_type: &str) -> RepositoryResult<Vec<BillingCodeEntity>> {
        let _ = code_type;
        Err(RepositoryError::NotImplemented(
            "get_active not implemented".into(),
        ))
    }

    /// Deactivate a billing code
    async fn deactivate(&self, id: &str) -> RepositoryResult<BillingCodeEntity> {
        let _ = id;
        Err(RepositoryError::NotImplemented(
            "deactivate not implemented".into(),
        ))
    }

    /// List billing codes by type with pagination
    async fn list_by_type(
        &self,
        code_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BillingCodeEntity>> {
        let _ = (code_type, pagination);
        Err(RepositoryError::NotImplemented(
            "list_by_type not implemented".into(),
        ))
    }
}

// =============================================================================
// PHASE 5: COMMUNICATION & NOTIFICATIONS
// =============================================================================

/// Device token entity for push notifications
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct DeviceTokenEntity {
    pub id: String,
    pub user_id: String,
    pub token: String,
    pub device_type: Option<String>,
    pub device_name: Option<String>,
    pub last_seen_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

/// Device token repository trait
#[async_trait]
pub trait DeviceTokenRepository: Send + Sync + fmt::Debug {
    async fn register(&self, entity: DeviceTokenEntity) -> RepositoryResult<DeviceTokenEntity>;
    async fn get_by_user(&self, user_id: &str) -> RepositoryResult<Vec<DeviceTokenEntity>>;
    async fn delete(&self, user_id: &str, token: &str) -> RepositoryResult<()>;
    async fn update_last_seen(&self, id: &str) -> RepositoryResult<()>;
}

/// SMS opt-out entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct SmsOptOutEntity {
    pub phone_number: String,
    pub opted_out_at: DateTime<Utc>,
    pub source: Option<String>,
    pub reason: Option<String>,
}

/// SMS opt-out repository trait
#[async_trait]
pub trait SmsOptOutRepository: Send + Sync + fmt::Debug {
    async fn add_opt_out(&self, entity: SmsOptOutEntity) -> RepositoryResult<()>;
    async fn is_opted_out(&self, phone_number: &str) -> RepositoryResult<bool>;
    async fn remove_opt_out(&self, phone_number: &str) -> RepositoryResult<()>;
}

// =============================================================================
// PHASE 11: FAMILY HISTORY & GENETICS
// =============================================================================

/// Family medical history entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct FamilyMedicalHistoryEntity {
    pub id: String,
    pub patient_id: String,
    pub relationship: String,
    pub relationship_type: Option<String>,
    pub relative_name: Option<String>,
    pub relative_dob: Option<chrono::NaiveDate>,
    pub relative_gender: Option<String>,
    pub living_status: Option<String>,
    pub age_at_death: Option<i32>,
    pub cause_of_death: Option<String>,
    pub conditions: Option<serde_json::Value>,
    pub cancer_history: Option<serde_json::Value>,
    pub cardiac_history: Option<serde_json::Value>,
    pub diabetes_history: Option<serde_json::Value>,
    pub mental_health_history: Option<serde_json::Value>,
    pub genetic_conditions: Option<serde_json::Value>,
    pub hereditary_risk_score: Option<i32>,
    pub genetic_testing_recommended: Option<bool>,
    pub genetic_counseling_received: Option<bool>,
    pub notes: Option<String>,
    pub verified: Option<bool>,
    pub verified_by: Option<String>,
    pub verified_date: Option<chrono::NaiveDate>,
    pub source: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    #[cfg_attr(feature = "postgres", sqlx(skip))]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Family medical history repository trait
#[async_trait]
pub trait FamilyMedicalHistoryRepository: Send + Sync {
    async fn create(
        &self,
        history: FamilyMedicalHistoryEntity,
    ) -> RepositoryResult<FamilyMedicalHistoryEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<FamilyMedicalHistoryEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<FamilyMedicalHistoryEntity>>;
    async fn get_by_relationship(
        &self,
        patient_id: &str,
        relationship: &str,
    ) -> RepositoryResult<Vec<FamilyMedicalHistoryEntity>>;
    async fn update(
        &self,
        history: FamilyMedicalHistoryEntity,
    ) -> RepositoryResult<FamilyMedicalHistoryEntity>;
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
    async fn verify(
        &self,
        id: &str,
        verified_by: &str,
    ) -> RepositoryResult<FamilyMedicalHistoryEntity>;
}

/// Genetic test result entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct GeneticTestResultEntity {
    pub id: String,
    pub patient_id: String,
    pub test_type: String,
    pub panel_name: Option<String>,
    pub lab_name: Option<String>,
    pub lab_accession: Option<String>,
    pub ordered_by: Option<String>,
    pub ordered_date: Option<chrono::NaiveDate>,
    pub collected_date: Option<chrono::NaiveDate>,
    pub reported_date: Option<chrono::NaiveDate>,
    pub result_status: String,
    pub variants: Option<serde_json::Value>,
    pub interpretation: Option<String>,
    pub clinical_significance: Option<String>,
    pub recommendations: Option<serde_json::Value>,
    pub follow_up_required: Option<bool>,
    pub genetic_counseling_provided: Option<bool>,
    pub counselor_name: Option<String>,
    pub counseling_date: Option<chrono::NaiveDate>,
    pub report_url: Option<String>,
    pub report_ipfs_hash: Option<String>,
    pub consent_form_signed: Option<bool>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Genetic test result repository trait
#[async_trait]
pub trait GeneticTestResultRepository: Send + Sync {
    async fn create(
        &self,
        result: GeneticTestResultEntity,
    ) -> RepositoryResult<GeneticTestResultEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<GeneticTestResultEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<GeneticTestResultEntity>>;
    async fn get_by_test_type(
        &self,
        patient_id: &str,
        test_type: &str,
    ) -> RepositoryResult<Vec<GeneticTestResultEntity>>;
    async fn update(
        &self,
        result: GeneticTestResultEntity,
    ) -> RepositoryResult<GeneticTestResultEntity>;
    async fn get_pathogenic(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<GeneticTestResultEntity>>;
}

// =============================================================================
// PHASE 12: IMMUNIZATION RECORDS
// =============================================================================

/// Immunization record entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ImmunizationRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub vaccine_type: String,
    pub vaccine_name: String,
    pub manufacturer: Option<String>,
    pub lot_number: Option<String>,
    pub ndc_code: Option<String>,
    pub cvx_code: Option<String>,
    pub mvx_code: Option<String>,
    pub administration_date: chrono::NaiveDate,
    pub administration_time: Option<chrono::NaiveTime>,
    pub administered_by: Option<String>,
    pub administered_by_name: Option<String>,
    pub administration_site: Option<String>,
    pub route: Option<String>,
    pub dose_amount: Option<String>,
    pub dose_unit: Option<String>,
    pub dose_number: Option<i32>,
    pub series_complete: Option<bool>,
    pub facility_id: Option<String>,
    pub facility_name: Option<String>,
    pub facility_address: Option<String>,
    pub vfc_eligibility: Option<String>,
    pub funding_source: Option<String>,
    pub information_source: Option<String>,
    pub documentation_type: Option<String>,
    pub reaction_observed: Option<bool>,
    pub reaction_details: Option<String>,
    pub contraindications_reviewed: Option<bool>,
    pub patient_consent: Option<bool>,
    pub vis_given: Option<bool>,
    pub vis_date: Option<chrono::NaiveDate>,
    pub notes: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Immunization record repository trait
#[async_trait]
pub trait ImmunizationRecordRepository: Send + Sync {
    async fn create(
        &self,
        record: ImmunizationRecordEntity,
    ) -> RepositoryResult<ImmunizationRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ImmunizationRecordEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>>;
    async fn get_by_vaccine_type(
        &self,
        patient_id: &str,
        vaccine_type: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>>;
    async fn update(
        &self,
        record: ImmunizationRecordEntity,
    ) -> RepositoryResult<ImmunizationRecordEntity>;
    async fn get_recent(
        &self,
        patient_id: &str,
        days: i32,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>>;
    async fn get_by_lot_number(
        &self,
        lot_number: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>>;
    /// Return every immunization record across all patients. Used by admin/list
    /// endpoints. Default returns NotFound so backends opt-in.
    async fn list_all(&self) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

/// Immunization schedule entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ImmunizationScheduleEntity {
    pub id: String,
    pub patient_id: String,
    pub vaccine_type: String,
    pub due_date: chrono::NaiveDate,
    pub earliest_date: Option<chrono::NaiveDate>,
    pub latest_date: Option<chrono::NaiveDate>,
    pub dose_number: Option<i32>,
    pub is_overdue: Option<bool>,
    pub status: Option<String>,
    pub completed_immunization_id: Option<String>,
    pub skip_reason: Option<String>,
    pub reminder_sent: Option<bool>,
    pub reminder_date: Option<chrono::NaiveDate>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Immunization schedule repository trait
#[async_trait]
pub trait ImmunizationScheduleRepository: Send + Sync {
    async fn create(
        &self,
        schedule: ImmunizationScheduleEntity,
    ) -> RepositoryResult<ImmunizationScheduleEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ImmunizationScheduleEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ImmunizationScheduleEntity>>;
    async fn get_due(&self, patient_id: &str) -> RepositoryResult<Vec<ImmunizationScheduleEntity>>;
    async fn get_overdue(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ImmunizationScheduleEntity>>;
    async fn update(
        &self,
        schedule: ImmunizationScheduleEntity,
    ) -> RepositoryResult<ImmunizationScheduleEntity>;
    async fn complete(
        &self,
        id: &str,
        immunization_id: &str,
    ) -> RepositoryResult<ImmunizationScheduleEntity>;
    async fn skip(&self, id: &str, reason: &str) -> RepositoryResult<ImmunizationScheduleEntity>;
    async fn list_all(&self) -> RepositoryResult<Vec<ImmunizationScheduleEntity>> {
        Err(RepositoryError::NotFound(
            "list_all not implemented".to_string(),
        ))
    }
}

/// Vaccine inventory entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct VaccineInventoryEntity {
    pub id: String,
    pub facility_id: Option<String>,
    pub vaccine_type: String,
    pub vaccine_name: String,
    pub manufacturer: Option<String>,
    pub lot_number: String,
    pub ndc_code: Option<String>,
    pub quantity_received: i32,
    pub quantity_remaining: i32,
    pub unit_of_measure: Option<String>,
    pub storage_location: Option<String>,
    pub storage_temperature_min: Option<f64>,
    pub storage_temperature_max: Option<f64>,
    pub temperature_monitored: Option<bool>,
    pub received_date: chrono::NaiveDate,
    pub expiration_date: chrono::NaiveDate,
    pub first_use_date: Option<chrono::NaiveDate>,
    pub status: Option<String>,
    pub recall_number: Option<String>,
    pub disposal_date: Option<chrono::NaiveDate>,
    pub disposal_reason: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Vaccine inventory repository trait
#[async_trait]
pub trait VaccineInventoryRepository: Send + Sync {
    async fn create(
        &self,
        inventory: VaccineInventoryEntity,
    ) -> RepositoryResult<VaccineInventoryEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<VaccineInventoryEntity>;
    async fn get_by_facility(
        &self,
        facility_id: &str,
    ) -> RepositoryResult<Vec<VaccineInventoryEntity>>;
    async fn get_available(
        &self,
        facility_id: &str,
        vaccine_type: &str,
    ) -> RepositoryResult<Vec<VaccineInventoryEntity>>;
    async fn update(
        &self,
        inventory: VaccineInventoryEntity,
    ) -> RepositoryResult<VaccineInventoryEntity>;
    async fn decrement_quantity(
        &self,
        id: &str,
        amount: i32,
    ) -> RepositoryResult<VaccineInventoryEntity>;
    async fn get_expiring_soon(&self, days: i32) -> RepositoryResult<Vec<VaccineInventoryEntity>>;
    async fn mark_recalled(
        &self,
        lot_number: &str,
        recall_number: &str,
    ) -> RepositoryResult<Vec<VaccineInventoryEntity>>;
}

// =============================================================================
// PHASE 13: DEATH RECORDS & CERTIFICATION
// =============================================================================

/// Death record entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct DeathRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub date_of_death: chrono::NaiveDate,
    pub time_of_death: Option<chrono::NaiveTime>,
    pub pronounced_datetime: Option<chrono::DateTime<chrono::Utc>>,
    pub pronounced_by: Option<String>,
    pub pronounced_by_name: Option<String>,
    pub place_of_death: Option<String>,
    pub facility_id: Option<String>,
    pub facility_name: Option<String>,
    pub death_address: Option<String>,
    pub county: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
    pub immediate_cause: Option<String>,
    pub immediate_cause_duration: Option<String>,
    pub underlying_cause_a: Option<String>,
    pub underlying_cause_a_duration: Option<String>,
    pub underlying_cause_b: Option<String>,
    pub underlying_cause_b_duration: Option<String>,
    pub underlying_cause_c: Option<String>,
    pub underlying_cause_c_duration: Option<String>,
    pub other_significant_conditions: Option<String>,
    pub manner_of_death: Option<String>,
    pub autopsy_performed: Option<bool>,
    pub autopsy_findings_available: Option<bool>,
    pub autopsy_findings: Option<String>,
    pub medical_examiner_case: Option<bool>,
    pub medical_examiner_number: Option<String>,
    pub certifier_type: Option<String>,
    pub certifier_id: Option<String>,
    pub certifier_name: Option<String>,
    pub certifier_license: Option<String>,
    pub certification_date: Option<chrono::NaiveDate>,
    pub death_certificate_number: Option<String>,
    pub registration_date: Option<chrono::NaiveDate>,
    pub registrar_district: Option<String>,
    pub disposition_method: Option<String>,
    pub disposition_date: Option<chrono::NaiveDate>,
    pub funeral_home: Option<String>,
    pub tobacco_contributed: Option<bool>,
    pub pregnancy_status: Option<String>,
    pub injury_at_work: Option<bool>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    #[cfg_attr(feature = "postgres", sqlx(skip))]
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Death record repository trait
#[async_trait]
pub trait DeathRecordRepository: Send + Sync {
    async fn create(&self, record: DeathRecordEntity) -> RepositoryResult<DeathRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<DeathRecordEntity>;
    async fn get_by_patient(&self, patient_id: &str)
        -> RepositoryResult<Option<DeathRecordEntity>>;
    async fn update(&self, record: DeathRecordEntity) -> RepositoryResult<DeathRecordEntity>;
    async fn get_by_date_range(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> RepositoryResult<Vec<DeathRecordEntity>>;

    /// Certify a death record
    async fn certify(
        &self,
        id: &str,
        certifier_id: &str,
        certifier_name: &str,
    ) -> RepositoryResult<DeathRecordEntity> {
        let _ = (id, certifier_id, certifier_name);
        Err(RepositoryError::NotImplemented(
            "certify not implemented".into(),
        ))
    }

    /// Get pending certification records
    async fn get_pending_certification(&self) -> RepositoryResult<Vec<DeathRecordEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_pending_certification not implemented".into(),
        ))
    }

    /// Get record by certificate number
    async fn get_by_certificate_number(
        &self,
        certificate_number: &str,
    ) -> RepositoryResult<DeathRecordEntity>;

    /// Get medical examiner cases
    async fn get_medical_examiner_cases(&self) -> RepositoryResult<Vec<DeathRecordEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_medical_examiner_cases not implemented".into(),
        ))
    }

    /// Get records pending autopsy
    async fn get_pending_autopsies(&self) -> RepositoryResult<Vec<DeathRecordEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_pending_autopsies not implemented".into(),
        ))
    }
}

/// Organ donation record entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct OrganDonationRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub death_record_id: Option<String>,
    pub registered_donor: Option<bool>,
    pub registry_id: Option<String>,
    pub registration_date: Option<chrono::NaiveDate>,
    pub consent_type: Option<String>,
    pub consenting_party: Option<String>,
    pub consenting_relationship: Option<String>,
    pub consent_datetime: Option<chrono::DateTime<chrono::Utc>>,
    pub donation_type: Option<String>,
    pub organs_donated: Option<serde_json::Value>,
    pub tissues_donated: Option<serde_json::Value>,
    pub opo_name: Option<String>,
    pub opo_contact: Option<String>,
    pub referral_datetime: Option<chrono::DateTime<chrono::Utc>>,
    pub evaluation_datetime: Option<chrono::DateTime<chrono::Utc>>,
    pub recovery_datetime: Option<chrono::DateTime<chrono::Utc>>,
    pub recovery_location: Option<String>,
    pub organs_recovered: Option<i32>,
    pub organs_transplanted: Option<i32>,
    pub tissues_recovered: Option<i32>,
    pub recipients_helped: Option<i32>,
    pub medical_suitability: Option<bool>,
    pub exclusion_reasons: Option<String>,
    pub notes: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Organ donation record repository trait
#[async_trait]
pub trait OrganDonationRecordRepository: Send + Sync {
    async fn create(
        &self,
        record: OrganDonationRecordEntity,
    ) -> RepositoryResult<OrganDonationRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<OrganDonationRecordEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<OrganDonationRecordEntity>>;
    async fn get_by_death_record(
        &self,
        death_record_id: &str,
    ) -> RepositoryResult<Option<OrganDonationRecordEntity>>;
    async fn update(
        &self,
        record: OrganDonationRecordEntity,
    ) -> RepositoryResult<OrganDonationRecordEntity>;
    async fn get_registered_donors(&self) -> RepositoryResult<Vec<OrganDonationRecordEntity>>;

    /// Get records pending organ recovery
    async fn get_pending_recovery(&self) -> RepositoryResult<Vec<OrganDonationRecordEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_pending_recovery not implemented".into(),
        ))
    }

    /// Get records by OPO (Organ Procurement Organization)
    async fn get_by_opo(&self, opo_name: &str) -> RepositoryResult<Vec<OrganDonationRecordEntity>> {
        let _ = opo_name;
        Err(RepositoryError::NotImplemented(
            "get_by_opo not implemented".into(),
        ))
    }
}

// =============================================================================
// PHASE 14: DATA SYNCHRONIZATION & CONFLICT RESOLUTION
// =============================================================================

/// Sync operation entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct SyncOperationEntity {
    pub id: String,
    pub operation_type: String,
    pub source_system: String,
    pub target_system: String,
    pub initiated_by: Option<String>,
    pub initiated_at: Option<chrono::DateTime<chrono::Utc>>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub entity_types: Option<serde_json::Value>,
    pub patient_ids: Option<serde_json::Value>,
    pub date_range_start: Option<chrono::DateTime<chrono::Utc>>,
    pub date_range_end: Option<chrono::DateTime<chrono::Utc>>,
    pub status: Option<String>,
    pub total_records: Option<i32>,
    pub processed_records: Option<i32>,
    pub success_count: Option<i32>,
    pub error_count: Option<i32>,
    pub conflict_count: Option<i32>,
    pub error_details: Option<serde_json::Value>,
    pub sync_summary: Option<serde_json::Value>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Sync operation repository trait
#[async_trait]
pub trait SyncOperationRepository: Send + Sync {
    async fn create(&self, operation: SyncOperationEntity)
        -> RepositoryResult<SyncOperationEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<SyncOperationEntity>;
    async fn get_recent(&self, hours: i32) -> RepositoryResult<Vec<SyncOperationEntity>>;
    async fn get_by_status(&self, status: &str) -> RepositoryResult<Vec<SyncOperationEntity>>;
    async fn update(&self, operation: SyncOperationEntity)
        -> RepositoryResult<SyncOperationEntity>;

    /// Update operation progress
    async fn update_progress(
        &self,
        id: &str,
        processed: i32,
        success: i32,
        errors: i32,
    ) -> RepositoryResult<SyncOperationEntity> {
        let _ = (id, processed, success, errors);
        Err(RepositoryError::NotImplemented(
            "update_progress not implemented".into(),
        ))
    }

    /// Complete an operation
    async fn complete(
        &self,
        id: &str,
        summary: serde_json::Value,
    ) -> RepositoryResult<SyncOperationEntity> {
        let _ = (id, summary);
        Err(RepositoryError::NotImplemented(
            "complete not implemented".into(),
        ))
    }

    /// Mark an operation as failed
    async fn fail(
        &self,
        id: &str,
        error_details: serde_json::Value,
    ) -> RepositoryResult<SyncOperationEntity> {
        let _ = (id, error_details);
        Err(RepositoryError::NotImplemented(
            "fail not implemented".into(),
        ))
    }

    /// Get operations by entity type and id
    async fn get_by_entity(
        &self,
        entity_type: &str,
        entity_id: &str,
    ) -> RepositoryResult<Vec<SyncOperationEntity>>;

    /// Get operations pending retry
    async fn get_pending_retries(&self) -> RepositoryResult<Vec<SyncOperationEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_pending_retries not implemented".into(),
        ))
    }

    /// Get operations in progress
    async fn get_in_progress(&self) -> RepositoryResult<Vec<SyncOperationEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_in_progress not implemented".into(),
        ))
    }
}

/// Sync conflict entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct SyncConflictEntity {
    pub id: String,
    pub sync_operation_id: Option<String>,
    pub entity_type: String,
    pub entity_id: String,
    pub patient_id: Option<String>,
    pub conflict_type: String,
    pub field_name: Option<String>,
    pub local_value: Option<String>,
    pub remote_value: Option<String>,
    pub local_timestamp: Option<chrono::DateTime<chrono::Utc>>,
    pub remote_timestamp: Option<chrono::DateTime<chrono::Utc>>,
    pub local_version: Option<i32>,
    pub remote_version: Option<i32>,
    pub status: Option<String>,
    pub resolution_strategy: Option<String>,
    pub resolved_value: Option<String>,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<chrono::DateTime<chrono::Utc>>,
    pub resolution_notes: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Sync conflict repository trait
#[async_trait]
pub trait SyncConflictRepository: Send + Sync {
    async fn create(&self, conflict: SyncConflictEntity) -> RepositoryResult<SyncConflictEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<SyncConflictEntity>;
    async fn get_by_operation(
        &self,
        operation_id: &str,
    ) -> RepositoryResult<Vec<SyncConflictEntity>>;
    async fn get_pending(&self) -> RepositoryResult<Vec<SyncConflictEntity>>;
    async fn resolve(
        &self,
        id: &str,
        resolved_value: &str,
        resolved_by: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<SyncConflictEntity>;
    async fn get_by_entity(
        &self,
        entity_type: &str,
        entity_id: &str,
    ) -> RepositoryResult<Vec<SyncConflictEntity>>;

    /// Get conflicts that can be auto-resolved
    async fn get_auto_resolvable(&self) -> RepositoryResult<Vec<SyncConflictEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_auto_resolvable not implemented".into(),
        ))
    }
}

/// External ID mapping entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ExternalIdMappingEntity {
    pub id: String,
    pub entity_type: String,
    pub internal_id: String,
    pub external_system: String,
    pub external_id: String,
    pub last_synced_at: Option<chrono::DateTime<chrono::Utc>>,
    pub sync_status: Option<String>,
    pub sync_direction: Option<String>,
    pub external_metadata: Option<serde_json::Value>,
    pub notes: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// External ID mapping repository trait
#[async_trait]
pub trait ExternalIdMappingRepository: Send + Sync {
    async fn create(
        &self,
        mapping: ExternalIdMappingEntity,
    ) -> RepositoryResult<ExternalIdMappingEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ExternalIdMappingEntity>;
    async fn get_by_internal(
        &self,
        entity_type: &str,
        internal_id: &str,
    ) -> RepositoryResult<Vec<ExternalIdMappingEntity>>;
    async fn get_by_external(
        &self,
        external_system: &str,
        external_id: &str,
    ) -> RepositoryResult<Option<ExternalIdMappingEntity>>;
    async fn update(
        &self,
        mapping: ExternalIdMappingEntity,
    ) -> RepositoryResult<ExternalIdMappingEntity>;

    /// Update sync time
    async fn update_sync_time(&self, id: &str) -> RepositoryResult<ExternalIdMappingEntity> {
        let _ = id;
        Err(RepositoryError::NotImplemented(
            "update_sync_time not implemented".into(),
        ))
    }

    /// Delete a mapping
    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let _ = id;
        Err(RepositoryError::NotImplemented(
            "delete not implemented".into(),
        ))
    }

    /// Deactivate a mapping
    async fn deactivate(&self, id: &str) -> RepositoryResult<ExternalIdMappingEntity> {
        let _ = id;
        Err(RepositoryError::NotImplemented(
            "deactivate not implemented".into(),
        ))
    }

    /// Get mappings by external system
    async fn get_by_system(
        &self,
        external_system: &str,
    ) -> RepositoryResult<Vec<ExternalIdMappingEntity>> {
        let _ = external_system;
        Err(RepositoryError::NotImplemented(
            "get_by_system not implemented".into(),
        ))
    }

    /// Get unverified mappings
    async fn get_unverified(&self) -> RepositoryResult<Vec<ExternalIdMappingEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_unverified not implemented".into(),
        ))
    }
}

// =============================================================================
// PHASE 15: ENHANCED AUDIT & COMPLIANCE
// =============================================================================

/// Compliance report entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ComplianceReportEntity {
    pub id: String,
    pub report_type: String,
    pub report_name: String,
    pub reporting_period_start: chrono::NaiveDate,
    pub reporting_period_end: chrono::NaiveDate,
    pub generated_by: Option<String>,
    pub generated_at: Option<chrono::DateTime<chrono::Utc>>,
    pub department: Option<String>,
    pub facility_id: Option<String>,
    pub total_events: Option<i32>,
    pub compliant_count: Option<i32>,
    pub violation_count: Option<i32>,
    pub high_risk_count: Option<i32>,
    pub findings: Option<serde_json::Value>,
    pub recommendations: Option<serde_json::Value>,
    pub status: Option<String>,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub review_notes: Option<String>,
    pub report_url: Option<String>,
    pub report_ipfs_hash: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Compliance report repository trait
#[async_trait]
pub trait ComplianceReportRepository: Send + Sync {
    async fn create(
        &self,
        report: ComplianceReportEntity,
    ) -> RepositoryResult<ComplianceReportEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ComplianceReportEntity>;
    async fn get_by_type(&self, report_type: &str)
        -> RepositoryResult<Vec<ComplianceReportEntity>>;
    async fn update(
        &self,
        report: ComplianceReportEntity,
    ) -> RepositoryResult<ComplianceReportEntity>;

    /// Get reports by period
    async fn get_by_period(
        &self,
        start: chrono::NaiveDate,
        end: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let _ = (start, end);
        Err(RepositoryError::NotImplemented(
            "get_by_period not implemented".into(),
        ))
    }

    /// Approve a report
    async fn approve(
        &self,
        id: &str,
        reviewed_by: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<ComplianceReportEntity> {
        let _ = (id, reviewed_by, notes);
        Err(RepositoryError::NotImplemented(
            "approve not implemented".into(),
        ))
    }

    /// Get pending review reports
    async fn get_pending_review(&self) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_pending_review not implemented".into(),
        ))
    }

    /// Get reports by compliance framework
    async fn get_by_framework(
        &self,
        framework: &str,
    ) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let _ = framework;
        Err(RepositoryError::NotImplemented(
            "get_by_framework not implemented".into(),
        ))
    }

    /// Get reports by status
    async fn get_by_status(&self, status: &str) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let _ = status;
        Err(RepositoryError::NotImplemented(
            "get_by_status not implemented".into(),
        ))
    }

    /// Get reports expiring within specified days
    async fn get_expiring_soon(&self, days: i32) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let _ = days;
        Err(RepositoryError::NotImplemented(
            "get_expiring_soon not implemented".into(),
        ))
    }

    /// Get recently generated reports
    async fn get_recent(&self, days: i32) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let _ = days;
        Err(RepositoryError::NotImplemented(
            "get_recent not implemented".into(),
        ))
    }
}

/// Data retention policy entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct DataRetentionPolicyEntity {
    pub id: String,
    pub policy_name: String,
    pub entity_type: String,
    pub retention_period_days: i32,
    pub retention_period_type: Option<String>,
    pub archive_after_days: Option<i32>,
    pub delete_after_days: Option<i32>,
    pub applies_to_status: Option<serde_json::Value>,
    pub department: Option<String>,
    pub exceptions: Option<serde_json::Value>,
    pub legal_hold_override: Option<bool>,
    pub regulatory_basis: Option<String>,
    pub review_frequency_days: Option<i32>,
    pub last_reviewed_date: Option<chrono::NaiveDate>,
    pub reviewed_by: Option<String>,
    pub is_active: Option<bool>,
    pub effective_date: chrono::NaiveDate,
    pub end_date: Option<chrono::NaiveDate>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Data retention policy repository trait
#[async_trait]
pub trait DataRetentionPolicyRepository: Send + Sync {
    async fn create(
        &self,
        policy: DataRetentionPolicyEntity,
    ) -> RepositoryResult<DataRetentionPolicyEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<DataRetentionPolicyEntity>;
    async fn get_by_entity_type(
        &self,
        entity_type: &str,
    ) -> RepositoryResult<Vec<DataRetentionPolicyEntity>>;
    async fn get_active(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>>;
    async fn update(
        &self,
        policy: DataRetentionPolicyEntity,
    ) -> RepositoryResult<DataRetentionPolicyEntity>;
    async fn deactivate(&self, id: &str) -> RepositoryResult<DataRetentionPolicyEntity>;

    /// Get policies due for review
    async fn get_due_for_review(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_due_for_review not implemented".into(),
        ))
    }

    /// Get policies due for execution
    async fn get_due_for_execution(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_due_for_execution not implemented".into(),
        ))
    }
}

/// Retention job run entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct RetentionJobRunEntity {
    pub id: String,
    pub policy_id: Option<String>,
    pub job_type: String,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub entity_type: String,
    pub date_threshold: chrono::NaiveDate,
    pub status: Option<String>,
    pub records_evaluated: Option<i32>,
    pub records_archived: Option<i32>,
    pub records_deleted: Option<i32>,
    pub records_skipped: Option<i32>,
    pub error_count: Option<i32>,
    pub error_details: Option<serde_json::Value>,
    pub run_by: Option<String>,
    pub dry_run: Option<bool>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Retention job run repository trait
#[async_trait]
pub trait RetentionJobRunRepository: Send + Sync {
    async fn create(&self, job: RetentionJobRunEntity) -> RepositoryResult<RetentionJobRunEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<RetentionJobRunEntity>;
    async fn get_by_policy(&self, policy_id: &str) -> RepositoryResult<Vec<RetentionJobRunEntity>>;
    async fn get_recent(&self, limit: i32) -> RepositoryResult<Vec<RetentionJobRunEntity>>;
    async fn update(&self, job: RetentionJobRunEntity) -> RepositoryResult<RetentionJobRunEntity>;

    /// Complete a job run
    async fn complete(
        &self,
        id: &str,
        archived: i32,
        deleted: i32,
        skipped: i32,
    ) -> RepositoryResult<RetentionJobRunEntity> {
        let _ = (id, archived, deleted, skipped);
        Err(RepositoryError::NotImplemented(
            "complete not implemented".into(),
        ))
    }

    /// Mark a job as failed
    async fn fail(
        &self,
        id: &str,
        error_details: serde_json::Value,
    ) -> RepositoryResult<RetentionJobRunEntity> {
        let _ = (id, error_details);
        Err(RepositoryError::NotImplemented(
            "fail not implemented".into(),
        ))
    }

    /// Get jobs by status
    async fn get_by_status(&self, status: &str) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let _ = status;
        Err(RepositoryError::NotImplemented(
            "get_by_status not implemented".into(),
        ))
    }

    /// Get jobs currently in progress
    async fn get_in_progress(&self) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        Err(RepositoryError::NotImplemented(
            "get_in_progress not implemented".into(),
        ))
    }
}

/// Consent record entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ConsentRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub consent_type: String,
    pub consent_given: bool,
    pub consent_datetime: chrono::DateTime<chrono::Utc>,
    pub expiration_datetime: Option<chrono::DateTime<chrono::Utc>>,
    pub scope_description: Option<String>,
    pub data_types_covered: Option<serde_json::Value>,
    pub purpose: Option<String>,
    pub recipient_organization: Option<String>,
    pub collection_method: Option<String>,
    pub witness_name: Option<String>,
    pub witness_signature: Option<String>,
    pub collector_id: Option<String>,
    pub collector_name: Option<String>,
    pub revoked: Option<bool>,
    pub revoked_datetime: Option<chrono::DateTime<chrono::Utc>>,
    pub revocation_reason: Option<String>,
    pub revoked_by: Option<String>,
    pub document_url: Option<String>,
    pub document_ipfs_hash: Option<String>,
    pub regulatory_requirement: Option<String>,
    pub version: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Consent record repository trait
#[async_trait]
pub trait ConsentRecordRepository: Send + Sync {
    async fn create(&self, consent: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ConsentRecordEntity>;
    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<ConsentRecordEntity>>;
    async fn update(&self, consent: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity>;
    async fn revoke(
        &self,
        id: &str,
        revoked_by: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<ConsentRecordEntity>;
    async fn get_expiring_soon(&self, days: i32) -> RepositoryResult<Vec<ConsentRecordEntity>>;

    /// Get active consent by type
    async fn get_active_by_type(
        &self,
        patient_id: &str,
        consent_type: &str,
    ) -> RepositoryResult<Option<ConsentRecordEntity>> {
        let _ = (patient_id, consent_type);
        Err(RepositoryError::NotImplemented(
            "get_active_by_type not implemented".into(),
        ))
    }

    /// Get all active consents for a patient
    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let _ = patient_id;
        Err(RepositoryError::NotImplemented(
            "get_active not implemented".into(),
        ))
    }

    /// Get all active consents for a patient (alias)
    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        // Default delegates to get_active
        self.get_active(patient_id).await
    }

    /// Get consents by type for a patient
    async fn get_by_type(
        &self,
        patient_id: &str,
        consent_type: &str,
    ) -> RepositoryResult<Vec<ConsentRecordEntity>>;

    /// Check if patient has active consent of specified type and purpose
    async fn check_consent(
        &self,
        patient_id: &str,
        consent_type: &str,
        purpose: &str,
    ) -> RepositoryResult<bool>;
}

// =============================================================================
// PHASE 7 (Round 4): GENERIC JSON-RECORD DOMAINS
// =============================================================================
//
// Several feature domains (language preferences, eligibility checks, satisfaction
// surveys, symptom sessions, family groups, insurance claims, autopsy
// requests/reports, sync-queue items) previously lived only in volatile AppState
// HashMaps and were lost on restart. Their payloads are rich, heterogeneous
// structs whose full shape we want to preserve losslessly. Rather than model each
// with a bespoke column set, they share one JSON-blob entity: the full legacy
// struct is serialized into `data` (JSONB), with `id` + `owner_id` kept as
// queryable columns.

/// Generic JSON-blob record entity shared by the Phase-7 feature domains.
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct JsonRecordEntity {
    /// Primary key (e.g. survey id, claim id, or owner id for singleton records).
    pub id: String,
    /// Owning entity id (patient id, user id, device id, deceased id, ...).
    pub owner_id: String,
    /// Full domain payload, serialized losslessly.
    pub data: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Generic repository for JSON-blob feature records.
///
/// `create` has upsert semantics (insert-or-replace by `id`) so singleton
/// records (e.g. one language preference per user) and status updates both work.
#[async_trait]
pub trait JsonRecordRepository: Send + Sync + fmt::Debug {
    /// Insert or replace a record by `id`.
    async fn create(&self, record: JsonRecordEntity) -> RepositoryResult<JsonRecordEntity>;
    /// Fetch a single record by primary key.
    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<JsonRecordEntity>>;
    /// Fetch all records owned by `owner_id`, newest first.
    async fn get_by_owner(&self, owner_id: &str) -> RepositoryResult<Vec<JsonRecordEntity>>;
    /// Fetch all records, newest first (bounded).
    async fn list_all(&self) -> RepositoryResult<Vec<JsonRecordEntity>>;
    /// Delete a record by id. Idempotent: deleting a missing id is `Ok(())`.
    async fn delete(&self, id: &str) -> RepositoryResult<()>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pagination() {
        let p = Pagination::new(0, 50);
        assert_eq!(p.offset(), 0);
        assert_eq!(p.limit(), 50);

        let p = Pagination::new(2, 25);
        assert_eq!(p.offset(), 50);
        assert_eq!(p.limit(), 25);

        // Max limit enforced
        let p = Pagination::new(0, 200);
        assert_eq!(p.limit(), 100);
    }

    #[test]
    fn test_paginated_result() {
        let items: Vec<i32> = vec![1, 2, 3];
        let pagination = Pagination::new(0, 10);
        let result = PaginatedResult::new(items, 30, &pagination);

        assert_eq!(result.total, 30);
        assert_eq!(result.total_pages, 3);
        assert_eq!(result.items.len(), 3);
    }
}
