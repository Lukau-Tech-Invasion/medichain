//! Laboratory: submissions, quality control, critical values, specimens.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{DateRange, PaginatedResult, Pagination, RepositoryResult};

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
    /// The record as the form captured it.
    ///
    /// NOT `#[sqlx(skip)]`: `20260910000006` gave it a column. While it was
    /// skipped, PostgreSQL never selected or wrote it, so the blob was always
    /// `Value::Null` there and held the real content in memory — the same
    /// endpoint behaving one way in development and another against a database.
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
    /// The record as the form captured it.
    ///
    /// NOT `#[sqlx(skip)]`: `20260910000006` gave it a column. While it was
    /// skipped, PostgreSQL never selected or wrote it, so the blob was always
    /// `Value::Null` there and held the real content in memory — the same
    /// endpoint behaving one way in development and another against a database.
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

/// A request for a fresh sample after a specimen was rejected (SCR-009b).
///
/// Separate from `SpecimenRejectionEntity` on purpose. The rejection is a
/// permanent historical fact and is never edited to look as though the specimen
/// was fine; obtaining another sample is a new act, with its own requester,
/// timing, outcome and audit trail, and it points back at the rejection it
/// answers.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SpecimenRecollectionRequestEntity {
    pub id: String,
    pub rejection_id: String,
    pub original_specimen_id: String,
    pub patient_id: String,
    pub ordering_provider_id: Option<String>,
    pub requested_by: String,
    pub reason: String,
    /// `requested` -> `collected` | `cancelled`. Terminal states are terminal.
    pub status: String,
    pub requested_at: DateTime<Utc>,
    /// The specimen that replaced the rejected one. Null until completion, and
    /// the database refuses a `collected` row without it.
    pub replacement_specimen_id: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancellation_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

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
    async fn list_all(&self) -> RepositoryResult<Vec<LabQcRecordEntity>>;
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
    /// Close an open notification -- acknowledged, or cancelled as entered in
    /// error -- exactly once.
    ///
    /// Conditional on `acknowledged_at IS NULL`: `Ok(None)` means it was
    /// already closed. The unconditional update this replaces could overwrite
    /// one read-back record with another, and nothing called it.
    async fn close(
        &self,
        id: &str,
        closure: CriticalValueClosure,
    ) -> RepositoryResult<Option<CriticalValueEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<CriticalValueEntity>>;
}

/// What closing a critical-value notification records.
#[derive(Debug, Clone)]
pub struct CriticalValueClosure {
    /// Who documented the acknowledgment or the cancellation.
    pub closed_by: String,
    pub action_taken: String,
    pub notified_provider_id: Option<String>,
    pub notification_method: Option<String>,
    pub notified_at: Option<DateTime<Utc>>,
    /// The whole record document after closing.
    pub data: serde_json::Value,
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
    async fn list_all(&self) -> RepositoryResult<Vec<SpecimenCollectionEntity>>;
}

/// Specimen rejection repository trait
#[async_trait]
/// Recollection requests raised against rejected specimens (SCR-009b).
///
/// Every state change is a single conditional statement rather than a read
/// followed by a write. Two technicians acting on one rejected specimen is the
/// ordinary case, and a check-then-write would send the patient two
/// appointments.
#[async_trait]
pub trait SpecimenRecollectionRepository: Send + Sync + fmt::Debug {
    /// Opens a request.
    ///
    /// Returns `Ok(None)` when one is already open for this rejection, so the
    /// caller can say so rather than creating a duplicate. On PostgreSQL the
    /// guarantee is a partial unique index, so it holds under concurrency
    /// regardless of interleaving.
    async fn open(
        &self,
        request: SpecimenRecollectionRequestEntity,
    ) -> RepositoryResult<Option<SpecimenRecollectionRequestEntity>>;

    async fn get_by_id(
        &self,
        id: &str,
    ) -> RepositoryResult<Option<SpecimenRecollectionRequestEntity>>;

    async fn list_for_rejection(
        &self,
        rejection_id: &str,
    ) -> RepositoryResult<Vec<SpecimenRecollectionRequestEntity>>;

    /// Every request still awaiting a replacement sample.
    async fn list_open(&self) -> RepositoryResult<Vec<SpecimenRecollectionRequestEntity>>;

    /// Records the replacement specimen and closes the request.
    ///
    /// Returns `Ok(None)` when the request was not open -- already completed,
    /// already cancelled, or absent -- so a retry cannot complete it twice or
    /// resurrect a cancelled one.
    async fn complete(
        &self,
        id: &str,
        replacement_specimen_id: &str,
        completed_at: DateTime<Utc>,
    ) -> RepositoryResult<Option<SpecimenRecollectionRequestEntity>>;

    /// Closes the request without a replacement.
    ///
    /// Returns `Ok(None)` under the same conditions as `complete`.
    async fn cancel(
        &self,
        id: &str,
        reason: &str,
        cancelled_at: DateTime<Utc>,
    ) -> RepositoryResult<Option<SpecimenRecollectionRequestEntity>>;
}

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
    async fn list_all(&self) -> RepositoryResult<Vec<SpecimenRejectionEntity>>;

    /// Record that the ordering provider has been told about this rejection.
    ///
    /// Returns `Ok(None)` when they had already been told. The guard lives
    /// inside the write, so two clinicians pressing Notify at the same moment
    /// send one notification between them rather than two — the same shape as
    /// `RetentionExecutionRepository::decide_approval` and the lab-review
    /// transition.
    async fn mark_provider_notified(
        &self,
        id: &str,
        notified_at: DateTime<Utc>,
    ) -> RepositoryResult<Option<SpecimenRejectionEntity>>;
}
