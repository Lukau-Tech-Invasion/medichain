//! Repository layer for MediChain data persistence.
//!
//! This module provides the repository pattern implementation for abstracting
//! data access from storage backends. It supports both in-memory (HashMap)
//! and PostgreSQL storage, selectable via the `postgres` feature flag.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                      API Endpoints                          │
//! └─────────────────────────────┬───────────────────────────────┘
//!                               │
//!                               ▼
//! ┌─────────────────────────────────────────────────────────────┐
//! │                   Repository Traits                         │
//! │  (PatientRepository, MedicalRecordRepository, etc.)        │
//! └─────────────────────────────┬───────────────────────────────┘
//!                               │
//!            ┌──────────────────┴──────────────────┐
//!            ▼                                     ▼
//! ┌─────────────────────┐             ┌─────────────────────────┐
//! │  Memory Repository  │             │  PostgreSQL Repository  │
//! │  (HashMap-based)    │             │  (sqlx-based)           │
//! └─────────────────────┘             └─────────────────────────┘
//! ```
//!
//! # Usage
//!
//! Set `MEDICHAIN_STORAGE=postgres` environment variable to use PostgreSQL.
//! Default is `memory` for backward compatibility.
//!
//! # NASA Power of 10 Compliance
//!
//! - No recursion in any repository implementation
//! - All loops bounded by MAX constants
//! - All functions under 60 lines
//! - Minimum 2 validation checks per write operation

pub mod blood_units;
pub mod eob_documents;
pub mod message_attachments;
pub mod patient_search;
pub mod refill_requests;
pub mod telehealth_recordings;
pub mod traits;

#[cfg(feature = "postgres")]
pub mod postgres;

pub mod memory;

#[cfg(test)]
mod parity_contract;

// Re-export commonly used items
pub use traits::*;

use std::sync::Arc;

#[derive(Debug, Clone, Copy)]
pub enum PrescriptionEventTarget {
    Dispense,
    Verification,
}

pub struct PrescriptionMutation {
    pub prescription_id: String,
    pub guard_field: String,
    pub expected_value: String,
    pub record: JsonRecordEntity,
    pub events: Vec<(PrescriptionEventTarget, JsonRecordEntity)>,
    pub audit: AccessLogEntity,
}

/// Storage backend type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum StorageBackend {
    /// In-memory HashMap storage (default, volatile)
    #[default]
    Memory,
    /// PostgreSQL database storage (persistent)
    Postgres,
}

impl StorageBackend {
    /// Determine storage backend from environment
    pub fn from_env() -> Self {
        match std::env::var("MEDICHAIN_STORAGE").as_deref() {
            Ok("postgres") | Ok("postgresql") | Ok("pg") => Self::Postgres,
            _ => Self::Memory,
        }
    }
}

/// Repository container holding all repository implementations
///
/// This struct provides access to all repository types through a single
/// unified interface. Use `RepositoryContainer::new()` to create with
/// the storage backend determined by environment variables.
#[derive(Clone)]
pub struct RepositoryContainer {
    pub backend: StorageBackend,
    /// Connection pool, present only for the PostgreSQL backend. Used to run
    /// multi-step writes inside a single transaction (see `create_patient_with_nfc`).
    pub pool: Option<sqlx::PgPool>,
    prescription_workflow_lock: Arc<tokio::sync::Mutex<()>>,
    // Phase 1 repositories
    pub patients: Arc<dyn PatientRepository>,
    pub medical_records: Arc<dyn MedicalRecordRepository>,
    pub nfc_tags: Arc<dyn NfcTagRepository>,
    pub vital_signs: Arc<dyn VitalSignsRepository>,
    pub triage_assessments: Arc<dyn TriageAssessmentRepository>,
    pub access_logs: Arc<dyn AccessLogRepository>,
    /// Blood-unit stock (WP7.5).
    pub blood_units: Arc<dyn blood_units::BloodUnitRepository>,
    /// Explanation-of-benefits documents on insurance claims (WP7.3).
    pub eob_documents: Arc<dyn eob_documents::EobDocumentRepository>,
    /// Consultation recordings (WP7.6).
    pub telehealth_recordings: Arc<dyn telehealth_recordings::TelehealthRecordingRepository>,
    /// Attachments on secure messages (WP7.2).
    pub message_attachments: Arc<dyn message_attachments::MessageAttachmentRepository>,
    /// Prescription refill requests (WP7.1).
    pub refill_requests: Arc<dyn refill_requests::RefillRequestRepository>,
    /// Persistent, permission-granular guardian relationships (supersedes the
    /// Horizon HZ-008 in-memory `guardian_relationships::GuardianRegistry`).
    pub guardian_relationships: Arc<dyn GuardianRelationshipRepository>,
    /// Litigation/regulatory holds that suspend retention-based disposal.
    pub legal_holds: Arc<dyn LegalHoldRepository>,
    /// Off-chain emergency capsules committed to on-chain (Horizon HZ-003).
    pub emergency_capsules: Arc<dyn EmergencyCapsuleRepository>,
    /// Retention approvals, processing restrictions, and the deletion register.
    pub retention_execution: Arc<dyn RetentionExecutionRepository>,
    /// Patient-controlled standing access grants and the provider requests
    /// they are minted from (supersedes the in-process `PatientAccessStore`).
    pub patient_access: Arc<dyn PatientAccessRepository>,

    // Emergency Protocol repositories
    pub code_blue: Arc<dyn CodeBlueRepository>,
    pub trauma_assessments_repo: Arc<dyn TraumaAssessmentRepository>,
    pub stroke_assessments_repo: Arc<dyn StrokeAssessmentRepository>,
    pub cardiac_events_repo: Arc<dyn CardiacEventRepository>,
    pub sepsis_assessments_repo: Arc<dyn SepsisAssessmentRepository>,

    // Phase 2: Clinical Documentation repositories
    pub gcs_assessments: Arc<dyn GcsAssessmentRepository>,
    pub progress_notes: Arc<dyn ProgressNoteRepository>,
    pub history_physicals: Arc<dyn HistoryPhysicalRepository>,
    pub consultation_notes: Arc<dyn ConsultationNoteRepository>,
    pub nursing_care_plans: Arc<dyn NursingCarePlanRepository>,
    pub medication_records: Arc<dyn MedicationRecordRepository>,
    pub io_records: Arc<dyn IORecordRepository>,
    pub wound_assessments: Arc<dyn WoundAssessmentRepository>,
    pub iv_assessments: Arc<dyn IVAssessmentRepository>,
    pub fall_risk_assessments: Arc<dyn FallRiskAssessmentRepository>,

    // Phase 3: Lab & Diagnostics repositories
    pub specimen_collections: Arc<dyn SpecimenCollectionRepository>,
    pub specimen_rejections: Arc<dyn SpecimenRejectionRepository>,
    /// Recollection requests raised against rejected specimens (SCR-009b).
    pub specimen_recollections: Arc<dyn SpecimenRecollectionRepository>,
    pub lab_submissions: Arc<dyn LabSubmissionRepository>,
    pub lab_qc_records: Arc<dyn LabQcRecordRepository>,
    pub critical_values: Arc<dyn CriticalValueRepository>,

    // Phase 3: Surgical & Procedures repositories
    pub pre_op_assessments: Arc<dyn PreOpAssessmentRepository>,
    pub operative_notes: Arc<dyn OperativeNoteRepository>,
    pub post_op_notes: Arc<dyn PostOpNoteRepository>,
    pub anesthesia_records: Arc<dyn AnesthesiaRecordRepository>,
    pub intubation_records: Arc<dyn IntubationRecordRepository>,
    pub laceration_repairs: Arc<dyn LacerationRepairRepository>,
    pub splint_cast_records: Arc<dyn SplintCastRecordRepository>,

    // Phase 3: Radiology repositories
    pub radiology_orders: Arc<dyn RadiologyOrderRepository>,
    pub radiology_reports: Arc<dyn RadiologyReportRepository>,
    pub pathology_reports: Arc<dyn PathologyReportRepository>,

    // Phase 3: Blood Bank repositories

    // Phase 3: Pharmacy repositories
    pub medication_reminders: Arc<dyn MedicationReminderRepository>,
    pub adherence_logs: Arc<dyn AdherenceLogRepository>,

    // Phase 4: Specialty Assessments repositories
    pub burn_assessments: Arc<dyn BurnAssessmentRepository>,
    pub psychiatric_assessments: Arc<dyn PsychiatricAssessmentRepository>,
    pub toxicology_assessments: Arc<dyn ToxicologyAssessmentRepository>,
    pub pediatric_assessments: Arc<dyn PediatricAssessmentRepository>,
    pub obstetric_emergencies: Arc<dyn ObstetricEmergencyRepository>,

    // Phase 5: Administrative & Scheduling repositories
    pub appointments: Arc<dyn AppointmentRepository>,
    pub physician_orders: Arc<dyn PhysicianOrderRepository>,
    pub discharge_summaries: Arc<dyn DischargeSummaryRepository>,
    pub discharge_instructions: Arc<dyn DischargeInstructionsRepository>,
    pub ama_discharges: Arc<dyn AmaDischargeRepository>,
    pub incident_reports: Arc<dyn IncidentReportRepository>,
    pub shift_handoffs: Arc<dyn ShiftHandoffRepository>,
    pub device_tokens: Arc<dyn DeviceTokenRepository>,
    pub sms_opt_outs: Arc<dyn SmsOptOutRepository>,

    // Phase 6: EMS & External repositories
    pub ems_handoffs: Arc<dyn EmsHandoffRepository>,
    pub mci_records: Arc<dyn MciRecordRepository>,
    pub chain_of_custody: Arc<dyn ChainOfCustodyRepository>,

    // Phase 9: Clinical Decision Support repositories
    pub cds_alerts: Arc<dyn CdsAlertRepository>,

    // Phase 10: Insurance & Billing repositories
    pub insurance_records: Arc<dyn InsuranceRecordRepository>,

    // Phase 12: Immunization repositories
    pub immunization_records: Arc<dyn ImmunizationRecordRepository>,

    // Phase 14: Sync & Integration repositories
    pub sync_conflicts: Arc<dyn SyncConflictRepository>,

    // Phase 15: Audit & Compliance repositories
    pub data_retention_policies: Arc<dyn DataRetentionPolicyRepository>,
    pub retention_job_runs: Arc<dyn RetentionJobRunRepository>,
    pub consent_records: Arc<dyn ConsentRecordRepository>,

    // Phase 7 (Round 4): generic JSON-record feature domains
    pub language_preferences: Arc<dyn JsonRecordRepository>,
    /// A provider's weekly working pattern and dated exceptions. Absent for a
    /// provider means the default clinic grid, which the slots endpoint
    /// reports as `slots_source: default_clinic_hours` rather than passing off
    /// as a diary.
    pub provider_schedules: Arc<dyn JsonRecordRepository>,
    pub eligibility_checks: Arc<dyn JsonRecordRepository>,
    pub satisfaction_surveys: Arc<dyn JsonRecordRepository>,
    pub symptom_sessions: Arc<dyn JsonRecordRepository>,
    pub family_groups: Arc<dyn JsonRecordRepository>,
    pub insurance_claims: Arc<dyn JsonRecordRepository>,
    pub insurance_cards: Arc<dyn JsonRecordRepository>,
    pub autopsy_reports: Arc<dyn JsonRecordRepository>,
    pub sync_queue_items: Arc<dyn JsonRecordRepository>,

    // Round 5: wearables + telehealth legacy shapes (JSON-record backed)
    pub wearable_device_records: Arc<dyn JsonRecordRepository>,
    pub wearable_reading_records: Arc<dyn JsonRecordRepository>,
    pub wearable_alert_records: Arc<dyn JsonRecordRepository>,
    pub wearable_alert_rules: Arc<dyn JsonRecordRepository>,
    pub telehealth_session_records: Arc<dyn JsonRecordRepository>,

    // Round 6: shape-mismatch domains (JSON-record backed)
    pub e_prescriptions_v2: Arc<dyn JsonRecordRepository>,
    pub drug_interaction_checks: Arc<dyn JsonRecordRepository>,
    pub lab_result_submissions: Arc<dyn JsonRecordRepository>,

    // Round 7: SOAP clinical notes (JSON-record backed)
    pub soap_note_records: Arc<dyn JsonRecordRepository>,

    // Phase 4.3: per-facility CDS thresholds + CDS audit trail
    pub cds_threshold_configs: Arc<dyn JsonRecordRepository>,
    pub cds_audit_entries: Arc<dyn JsonRecordRepository>,

    // Phase 33: offline-sync device registry (JSON-record backed)
    pub sync_devices: Arc<dyn JsonRecordRepository>,

    // Horizon HZ-023: stores backing features that previously returned
    // fabricated literals. `messages` is owned by the recipient (so an inbox
    // read is `get_by_owner`), `symptom_entries` by the patient, and
    // `barcode_scans` by the user who performed the scan.
    pub messages: Arc<dyn JsonRecordRepository>,
    pub symptom_entries: Arc<dyn JsonRecordRepository>,
    pub barcode_scans: Arc<dyn JsonRecordRepository>,

    /// Append-only laboratory instrument calibration runs. Calibration is not a
    /// QC measurement: it establishes the instrument's measurement curve and
    /// must remain traceable by calibrator lot after a restart.
    pub lab_calibrations: Arc<dyn JsonRecordRepository>,

    /// Clinician-authored note templates, shared across the facility and owned
    /// by their author (`owner_id`). Deactivated, never deleted.
    pub note_templates: Arc<dyn JsonRecordRepository>,
    pub order_sets: Arc<dyn JsonRecordRepository>,
    pub cds_rules: Arc<dyn JsonRecordRepository>,
    /// Pharmacist allergy-dispensing decisions and prescriber queries.
    pub pharmacy_decisions: Arc<dyn JsonRecordRepository>,
    /// One clinician's barcode scanner preferences.
    pub scanner_settings: Arc<dyn JsonRecordRepository>,
    /// Staff profile pictures, keyed by wallet.
    pub user_avatars: Arc<dyn JsonRecordRepository>,
    /// When each user last read their notifications. One row per user.
    pub notification_reads: Arc<dyn JsonRecordRepository>,

    // Final durability sweep (migration 20260811000002): the last of the
    // process-memory clinical maps. `used_emergency_tokens` is the spent-token
    // set behind one-time emergency access — losing it makes a redeemed token
    // replayable, so its durability is a security property.
    pub blood_type_screen_records: Arc<dyn JsonRecordRepository>,
    pub transfusion_event_records: Arc<dyn JsonRecordRepository>,
    /// Pharmacy dispensing events, including corrections (SCR-013).
    /// Append-only by convention: a reversal adds an entry, never removes one.
    pub dispense_events: Arc<dyn JsonRecordRepository>,
    /// Append-only request/decision history for secondary dispensing checks.
    pub prescription_verification_events: Arc<dyn JsonRecordRepository>,
    pub death_certificate_records: Arc<dyn JsonRecordRepository>,
    pub family_history_records: Arc<dyn JsonRecordRepository>,
    pub user_setting_records: Arc<dyn JsonRecordRepository>,
    pub used_emergency_tokens: Arc<dyn JsonRecordRepository>,
    /// Research export runs (WP7.4); their gate is in governance_decisions.
    pub research_export_runs: Arc<dyn JsonRecordRepository>,
}

/// The `[start, end)` instant range an appointment occupies.
fn appointment_time_range(
    appointment: &AppointmentEntity,
) -> (chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>) {
    let start = appointment.scheduled_datetime;
    (start, minutes_end(start, appointment.duration_minutes))
}

fn minutes_end(
    start: chrono::DateTime<chrono::Utc>,
    duration_minutes: i32,
) -> chrono::DateTime<chrono::Utc> {
    start + chrono::Duration::minutes(duration_minutes as i64)
}

/// Two half-open `[start, end)` ranges overlap iff each starts before the other ends.
fn ranges_overlap(
    a_start: chrono::DateTime<chrono::Utc>,
    a_end: chrono::DateTime<chrono::Utc>,
    b_start: chrono::DateTime<chrono::Utc>,
    b_end: chrono::DateTime<chrono::Utc>,
) -> bool {
    a_start < b_end && b_start < a_end
}

/// Whether `existing` (an already-booked, non-cancelled appointment for the
/// same provider) overlaps `candidate`'s requested time slot.
fn appointments_overlap(existing: &AppointmentEntity, candidate: &AppointmentEntity) -> bool {
    if matches!(existing.status.as_str(), "cancelled" | "no_show") {
        return false;
    }
    let (c_start, c_end) = appointment_time_range(candidate);
    let (e_start, e_end) = appointment_time_range(existing);
    ranges_overlap(c_start, c_end, e_start, e_end)
}

fn booking_conflict_error(provider_id: &str) -> RepositoryError {
    RepositoryError::Duplicate(format!(
        "Provider {} already has an appointment overlapping this time slot",
        provider_id
    ))
}

async fn insert_prescription_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    target: PrescriptionEventTarget,
    event: &JsonRecordEntity,
) -> RepositoryResult<()> {
    let sql = match target {
        PrescriptionEventTarget::Dispense => {
            "INSERT INTO dispense_events (id, owner_id, data, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at"
        }
        PrescriptionEventTarget::Verification => {
            "INSERT INTO prescription_verification_events
             (id, owner_id, data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at"
        }
    };
    sqlx::query(sql)
        .bind(&event.id)
        .bind(&event.owner_id)
        .bind(&event.data)
        .bind(event.created_at)
        .bind(event.updated_at)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn insert_access_log(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    log: &AccessLogEntity,
) -> RepositoryResult<()> {
    sqlx::query(
        "INSERT INTO access_logs (
            id, accessor_id, accessor_role, patient_id, resource_type, resource_id,
            action, access_reason, is_emergency_access, ip_address, user_agent,
            blockchain_tx_hash, accessed_at, facility_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    )
    .bind(&log.id)
    .bind(&log.accessor_id)
    .bind(&log.accessor_role)
    .bind(&log.patient_id)
    .bind(&log.resource_type)
    .bind(&log.resource_id)
    .bind(&log.action)
    .bind(&log.access_reason)
    .bind(log.is_emergency_access)
    .bind(&log.ip_address)
    .bind(&log.user_agent)
    .bind(&log.blockchain_tx_hash)
    .bind(log.accessed_at)
    .bind(&log.facility_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_prescription_postgres(
    pool: &sqlx::PgPool,
    mutation: PrescriptionMutation,
) -> RepositoryResult<Option<JsonRecordEntity>> {
    let mut tx = pool.begin().await?;
    let changed = sqlx::query_as::<_, JsonRecordEntity>(
        "UPDATE e_prescription_v2_records
         SET owner_id = $2, data = $3, updated_at = NOW()
         WHERE id = $1 AND data #>> string_to_array($4, '.') = $5
         RETURNING *",
    )
    .bind(&mutation.prescription_id)
    .bind(&mutation.record.owner_id)
    .bind(&mutation.record.data)
    .bind(&mutation.guard_field)
    .bind(&mutation.expected_value)
    .fetch_optional(&mut *tx)
    .await?;
    if changed.is_none() {
        return Ok(None);
    }
    for (target, event) in &mutation.events {
        insert_prescription_event(&mut tx, *target, event).await?;
    }
    insert_access_log(&mut tx, &mutation.audit).await?;
    tx.commit().await?;
    Ok(changed)
}

/// Store a refill request and its audit row as one PostgreSQL transaction.
async fn create_refill_postgres(
    pool: &sqlx::PgPool,
    request: &refill_requests::RefillRequestEntity,
    audit: &AccessLogEntity,
) -> RepositoryResult<refill_requests::RefillRequestEntity> {
    let mut tx = pool.begin().await?;
    let stored = refill_requests::pg::insert_request(&mut tx, request).await?;
    insert_access_log(&mut tx, audit).await?;
    tx.commit().await?;
    Ok(stored)
}

/// Store an attachment row and its audit row as one PostgreSQL transaction.
async fn create_attachment_postgres(
    pool: &sqlx::PgPool,
    row: &message_attachments::MessageAttachmentEntity,
    audit: &AccessLogEntity,
) -> RepositoryResult<message_attachments::MessageAttachmentEntity> {
    let mut tx = pool.begin().await?;
    let stored = message_attachments::pg::insert_attachment(&mut tx, row).await?;
    insert_access_log(&mut tx, audit).await?;
    tx.commit().await?;
    Ok(stored)
}

/// Store an EOB document row and its audit row as one PostgreSQL transaction.
async fn create_eob_postgres(
    pool: &sqlx::PgPool,
    row: &eob_documents::EobDocumentEntity,
    audit: &AccessLogEntity,
) -> RepositoryResult<eob_documents::EobDocumentEntity> {
    let mut tx = pool.begin().await?;
    let stored = eob_documents::pg::insert_document(&mut tx, row).await?;
    insert_access_log(&mut tx, audit).await?;
    tx.commit().await?;
    Ok(stored)
}

/// Store a telehealth recording row and its audit row as one transaction.
async fn create_recording_postgres(
    pool: &sqlx::PgPool,
    row: &telehealth_recordings::TelehealthRecordingEntity,
    audit: &AccessLogEntity,
) -> RepositoryResult<telehealth_recordings::TelehealthRecordingEntity> {
    let mut tx = pool.begin().await?;
    let stored = telehealth_recordings::pg::insert_recording(&mut tx, row).await?;
    insert_access_log(&mut tx, audit).await?;
    tx.commit().await?;
    Ok(stored)
}

/// Store a received blood unit and its audit row as one transaction.
async fn receive_unit_postgres(
    pool: &sqlx::PgPool,
    unit: &blood_units::BloodUnitEntity,
    audit: &AccessLogEntity,
) -> RepositoryResult<blood_units::BloodUnitEntity> {
    let mut tx = pool.begin().await?;
    let stored = blood_units::pg::insert_unit(&mut tx, unit).await?;
    insert_access_log(&mut tx, audit).await?;
    tx.commit().await?;
    Ok(stored)
}

/// Apply a guarded blood-unit transition and its audit row as one
/// transaction. `None`, with nothing written, when the guard refused it.
async fn transition_unit_postgres(
    pool: &sqlx::PgPool,
    id: &str,
    transition: &blood_units::UnitTransition,
    at: chrono::DateTime<chrono::Utc>,
    audit: &AccessLogEntity,
) -> RepositoryResult<Option<blood_units::BloodUnitEntity>> {
    let mut tx = pool.begin().await?;
    let Some(changed) = blood_units::pg::apply_transition(&mut tx, id, transition, at).await?
    else {
        return Ok(None);
    };
    insert_access_log(&mut tx, audit).await?;
    tx.commit().await?;
    Ok(Some(changed))
}

/// Close a refill request and write its audit row as one transaction.
/// `None` (and nothing written) when the request was no longer open.
async fn close_refill_postgres(
    pool: &sqlx::PgPool,
    closure: &refill_requests::RefillClosure,
    audit: &AccessLogEntity,
) -> RepositoryResult<Option<refill_requests::RefillRequestEntity>> {
    let mut tx = pool.begin().await?;
    let Some(closed) = refill_requests::pg::close_request(&mut tx, closure).await? else {
        return Ok(None);
    };
    insert_access_log(&mut tx, audit).await?;
    tx.commit().await?;
    Ok(Some(closed))
}

/// Approve a refill as one transaction: create the new prescription, take one
/// refill off the original (guarded on its current count), close the request
/// and audit. Returns `None`, with nothing written, if the count moved or the
/// request was no longer open.
async fn approve_refill_postgres(
    pool: &sqlx::PgPool,
    approval: &refill_requests::RefillApproval,
) -> RepositoryResult<Option<refill_requests::RefillRequestEntity>> {
    let mut tx = pool.begin().await?;
    let created = &approval.new_prescription;
    sqlx::query(
        "INSERT INTO e_prescription_v2_records (id, owner_id, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&created.id)
    .bind(&created.owner_id)
    .bind(&created.data)
    .bind(created.created_at)
    .bind(created.updated_at)
    .execute(&mut *tx)
    .await?;
    let decremented = sqlx::query_scalar::<_, String>(
        "UPDATE e_prescription_v2_records SET data = $2, updated_at = NOW()
         WHERE id = $1 AND data ->> 'refills_remaining' = $3 RETURNING id",
    )
    .bind(&approval.original_prescription_id)
    .bind(&approval.updated_original.data)
    .bind(&approval.expected_refills_remaining)
    .fetch_optional(&mut *tx)
    .await?;
    if decremented.is_none() {
        return Ok(None);
    }
    let Some(closed) = refill_requests::pg::close_request(&mut tx, &approval.closure).await? else {
        return Ok(None);
    };
    insert_access_log(&mut tx, &approval.audit).await?;
    tx.commit().await?;
    Ok(Some(closed))
}

impl RepositoryContainer {
    /// Create a new repository container with memory backend
    pub fn new_memory() -> Self {
        Self {
            backend: StorageBackend::Memory,
            pool: None,
            prescription_workflow_lock: Arc::new(tokio::sync::Mutex::new(())),
            patients: Arc::new(memory::MemoryPatientRepository::new()),
            medical_records: Arc::new(memory::MemoryMedicalRecordRepository::new()),
            nfc_tags: Arc::new(memory::MemoryNfcTagRepository::new()),
            vital_signs: Arc::new(memory::MemoryVitalSignsRepository::new()),
            triage_assessments: Arc::new(memory::MemoryTriageAssessmentRepository::new()),
            access_logs: Arc::new(memory::MemoryAccessLogRepository::new()),
            refill_requests: Arc::new(refill_requests::MemoryRefillRequestRepository::new()),
            message_attachments: Arc::new(
                message_attachments::MemoryMessageAttachmentRepository::new(),
            ),
            eob_documents: Arc::new(eob_documents::MemoryEobDocumentRepository::new()),
            telehealth_recordings: Arc::new(
                telehealth_recordings::MemoryTelehealthRecordingRepository::new(),
            ),
            blood_units: Arc::new(blood_units::MemoryBloodUnitRepository::new()),
            guardian_relationships: Arc::new(memory::MemoryGuardianRelationshipRepository::new()),
            legal_holds: Arc::new(memory::MemoryLegalHoldRepository::new()),
            emergency_capsules: Arc::new(memory::MemoryEmergencyCapsuleRepository::new()),
            retention_execution: Arc::new(memory::MemoryRetentionExecutionRepository::new()),
            patient_access: Arc::new(memory::MemoryPatientAccessRepository::new()),

            // Emergency Protocol repositories (memory)
            code_blue: Arc::new(memory::MemoryCodeBlueRepository::new()),
            trauma_assessments_repo: Arc::new(memory::MemoryTraumaAssessmentRepository::new()),
            stroke_assessments_repo: Arc::new(memory::MemoryStrokeAssessmentRepository::new()),
            cardiac_events_repo: Arc::new(memory::MemoryCardiacEventRepository::new()),
            sepsis_assessments_repo: Arc::new(memory::MemorySepsisAssessmentRepository::new()),

            // Phase 2: Clinical Documentation repositories (memory)
            gcs_assessments: Arc::new(memory::MemoryGcsAssessmentRepository::new()),
            progress_notes: Arc::new(memory::MemoryProgressNoteRepository::new()),
            history_physicals: Arc::new(memory::MemoryHistoryPhysicalRepository::new()),
            consultation_notes: Arc::new(memory::MemoryConsultationNoteRepository::new()),
            nursing_care_plans: Arc::new(memory::MemoryNursingCarePlanRepository::new()),
            medication_records: Arc::new(memory::MemoryMedicationRecordRepository::new()),
            io_records: Arc::new(memory::MemoryIORecordRepository::new()),
            wound_assessments: Arc::new(memory::MemoryWoundAssessmentRepository::new()),
            iv_assessments: Arc::new(memory::MemoryIVAssessmentRepository::new()),
            fall_risk_assessments: Arc::new(memory::MemoryFallRiskAssessmentRepository::new()),

            // Phase 3: Lab & Diagnostics repositories (memory)
            specimen_collections: Arc::new(memory::MemorySpecimenCollectionRepository::new()),
            specimen_rejections: Arc::new(memory::MemorySpecimenRejectionRepository::new()),
            specimen_recollections: Arc::new(memory::MemorySpecimenRecollectionRepository::new()),
            lab_submissions: Arc::new(memory::MemoryLabSubmissionRepository::new()),
            lab_qc_records: Arc::new(memory::MemoryLabQcRecordRepository::new()),
            critical_values: Arc::new(memory::MemoryCriticalValueRepository::new()),

            // Phase 3: Surgical & Procedures repositories (memory)
            pre_op_assessments: Arc::new(memory::MemoryPreOpAssessmentRepository::new()),
            operative_notes: Arc::new(memory::MemoryOperativeNoteRepository::new()),
            post_op_notes: Arc::new(memory::MemoryPostOpNoteRepository::new()),
            anesthesia_records: Arc::new(memory::MemoryAnesthesiaRecordRepository::new()),
            intubation_records: Arc::new(memory::MemoryIntubationRecordRepository::new()),
            laceration_repairs: Arc::new(memory::MemoryLacerationRepairRepository::new()),
            splint_cast_records: Arc::new(memory::MemorySplintCastRecordRepository::new()),

            // Phase 3: Radiology repositories (memory)
            radiology_orders: Arc::new(memory::MemoryRadiologyOrderRepository::new()),
            radiology_reports: Arc::new(memory::MemoryRadiologyReportRepository::new()),
            pathology_reports: Arc::new(memory::MemoryPathologyReportRepository::new()),

            // Phase 3: Blood Bank repositories (memory)

            // Phase 3: Pharmacy repositories (memory)
            medication_reminders: Arc::new(memory::MemoryMedicationReminderRepository::new()),
            adherence_logs: Arc::new(memory::MemoryAdherenceLogRepository::new()),

            // Phase 4: Specialty Assessments repositories (memory)
            burn_assessments: Arc::new(memory::MemoryBurnAssessmentRepository::new()),
            psychiatric_assessments: Arc::new(memory::MemoryPsychiatricAssessmentRepository::new()),
            toxicology_assessments: Arc::new(memory::MemoryToxicologyAssessmentRepository::new()),
            pediatric_assessments: Arc::new(memory::MemoryPediatricAssessmentRepository::new()),
            obstetric_emergencies: Arc::new(memory::MemoryObstetricEmergencyRepository::new()),

            // Phase 5: Administrative & Scheduling repositories (memory)
            appointments: Arc::new(memory::MemoryAppointmentRepository::new()),
            physician_orders: Arc::new(memory::MemoryPhysicianOrderRepository::new()),
            discharge_summaries: Arc::new(memory::MemoryDischargeSummaryRepository::new()),
            discharge_instructions: Arc::new(memory::MemoryDischargeInstructionsRepository::new()),
            ama_discharges: Arc::new(memory::MemoryAmaDischargeRepository::new()),
            incident_reports: Arc::new(memory::MemoryIncidentReportRepository::new()),
            shift_handoffs: Arc::new(memory::MemoryShiftHandoffRepository::new()),
            device_tokens: Arc::new(memory::MemoryDeviceTokenRepository::new()),
            sms_opt_outs: Arc::new(memory::MemorySmsOptOutRepository::new()),

            // Phase 6: EMS & External repositories (memory)
            ems_handoffs: Arc::new(memory::MemoryEmsHandoffRepository::new()),
            mci_records: Arc::new(memory::MemoryMciRecordRepository::new()),
            chain_of_custody: Arc::new(memory::MemoryChainOfCustodyRepository::new()),

            // Phase 9: Clinical Decision Support repositories (memory)
            cds_alerts: Arc::new(memory::MemoryCdsAlertRepository::new()),

            // Phase 10: Insurance & Billing repositories (memory)
            insurance_records: Arc::new(memory::MemoryInsuranceRecordRepository::new()),

            // Phase 12: Immunization repositories (memory)
            immunization_records: Arc::new(memory::MemoryImmunizationRecordRepository::new()),

            // Phase 14: Sync & Integration repositories (memory)
            sync_conflicts: Arc::new(memory::MemorySyncConflictRepository::new()),

            // Phase 15: Audit & Compliance repositories (memory)
            data_retention_policies: Arc::new(memory::MemoryDataRetentionPolicyRepository::new()),
            retention_job_runs: Arc::new(memory::MemoryRetentionJobRunRepository::new()),
            consent_records: Arc::new(memory::MemoryConsentRecordRepository::new()),

            // Phase 7 (Round 4): generic JSON-record feature domains (memory)
            language_preferences: Arc::new(memory::MemoryJsonRecordRepository::new()),
            provider_schedules: Arc::new(memory::MemoryJsonRecordRepository::new()),
            eligibility_checks: Arc::new(memory::MemoryJsonRecordRepository::new()),
            satisfaction_surveys: Arc::new(memory::MemoryJsonRecordRepository::new()),
            symptom_sessions: Arc::new(memory::MemoryJsonRecordRepository::new()),
            family_groups: Arc::new(memory::MemoryJsonRecordRepository::new()),
            insurance_claims: Arc::new(memory::MemoryJsonRecordRepository::new()),
            insurance_cards: Arc::new(memory::MemoryJsonRecordRepository::new()),
            autopsy_reports: Arc::new(memory::MemoryJsonRecordRepository::new()),
            sync_queue_items: Arc::new(memory::MemoryJsonRecordRepository::new()),

            // Round 5: wearables + telehealth legacy shapes (memory)
            wearable_device_records: Arc::new(memory::MemoryJsonRecordRepository::new()),
            wearable_reading_records: Arc::new(memory::MemoryJsonRecordRepository::new()),
            wearable_alert_records: Arc::new(memory::MemoryJsonRecordRepository::new()),
            wearable_alert_rules: Arc::new(memory::MemoryJsonRecordRepository::new()),
            telehealth_session_records: Arc::new(memory::MemoryJsonRecordRepository::new()),

            // Round 6: shape-mismatch domains (memory)
            e_prescriptions_v2: Arc::new(memory::MemoryJsonRecordRepository::new()),
            drug_interaction_checks: Arc::new(memory::MemoryJsonRecordRepository::new()),
            lab_result_submissions: Arc::new(memory::MemoryJsonRecordRepository::new()),

            // Round 7: SOAP clinical notes (memory)
            soap_note_records: Arc::new(memory::MemoryJsonRecordRepository::new()),

            // Phase 4.3: CDS thresholds + audit (memory)
            cds_threshold_configs: Arc::new(memory::MemoryJsonRecordRepository::new()),
            cds_audit_entries: Arc::new(memory::MemoryJsonRecordRepository::new()),

            // Phase 33: offline-sync device registry (memory)
            sync_devices: Arc::new(memory::MemoryJsonRecordRepository::new()),

            // Horizon HZ-023 (memory)
            messages: Arc::new(memory::MemoryJsonRecordRepository::new()),
            symptom_entries: Arc::new(memory::MemoryJsonRecordRepository::new()),
            barcode_scans: Arc::new(memory::MemoryJsonRecordRepository::new()),
            lab_calibrations: Arc::new(memory::MemoryJsonRecordRepository::new()),
            note_templates: Arc::new(memory::MemoryJsonRecordRepository::new()),
            order_sets: Arc::new(memory::MemoryJsonRecordRepository::new()),
            cds_rules: Arc::new(memory::MemoryJsonRecordRepository::new()),
            pharmacy_decisions: Arc::new(memory::MemoryJsonRecordRepository::new()),
            scanner_settings: Arc::new(memory::MemoryJsonRecordRepository::new()),
            user_avatars: Arc::new(memory::MemoryJsonRecordRepository::new()),
            notification_reads: Arc::new(memory::MemoryJsonRecordRepository::new()),
            blood_type_screen_records: Arc::new(memory::MemoryJsonRecordRepository::new()),
            transfusion_event_records: Arc::new(memory::MemoryJsonRecordRepository::new()),
            dispense_events: Arc::new(memory::MemoryJsonRecordRepository::new()),
            prescription_verification_events: Arc::new(memory::MemoryJsonRecordRepository::new()),
            death_certificate_records: Arc::new(memory::MemoryJsonRecordRepository::new()),
            family_history_records: Arc::new(memory::MemoryJsonRecordRepository::new()),
            user_setting_records: Arc::new(memory::MemoryJsonRecordRepository::new()),
            used_emergency_tokens: Arc::new(memory::MemoryJsonRecordRepository::new()),
            research_export_runs: Arc::new(memory::MemoryJsonRecordRepository::new()),
        }
    }

    /// Guard a prescription transition and persist its history/audit as one unit.
    pub async fn apply_prescription_mutation(
        &self,
        mutation: PrescriptionMutation,
    ) -> RepositoryResult<Option<JsonRecordEntity>> {
        match &self.pool {
            Some(pool) => apply_prescription_postgres(pool, mutation).await,
            None => {
                let _guard = self.prescription_workflow_lock.lock().await;
                let changed = self
                    .e_prescriptions_v2
                    .replace_if_field_eq(
                        &mutation.prescription_id,
                        &mutation.guard_field,
                        &mutation.expected_value,
                        mutation.record,
                    )
                    .await?;
                if changed.is_none() {
                    return Ok(None);
                }
                for (target, event) in mutation.events {
                    match target {
                        PrescriptionEventTarget::Dispense => {
                            self.dispense_events.create(event).await?;
                        }
                        PrescriptionEventTarget::Verification => {
                            self.prescription_verification_events.create(event).await?;
                        }
                    }
                }
                self.access_logs.create(mutation.audit).await?;
                Ok(changed)
            }
        }
    }

    /// Store a new refill request together with its audit row.
    ///
    /// `Duplicate` when the prescription already has an open request (the
    /// database's partial unique index, mirrored in memory).
    pub async fn create_refill_request(
        &self,
        request: refill_requests::RefillRequestEntity,
        audit: AccessLogEntity,
    ) -> RepositoryResult<refill_requests::RefillRequestEntity> {
        if let Some(pool) = &self.pool {
            return create_refill_postgres(pool, &request, &audit).await;
        }
        let _guard = self.prescription_workflow_lock.lock().await;
        let stored = self.refill_requests.create(request).await?;
        self.access_logs.create(audit).await?;
        Ok(stored)
    }

    /// Receive a blood unit into stock, with its audit row.
    /// `Duplicate` when the unit number is already on record.
    pub async fn receive_blood_unit(
        &self,
        unit: blood_units::BloodUnitEntity,
        audit: AccessLogEntity,
    ) -> RepositoryResult<blood_units::BloodUnitEntity> {
        if let Some(pool) = &self.pool {
            return receive_unit_postgres(pool, &unit, &audit).await;
        }
        let stored = self.blood_units.create(unit).await?;
        self.access_logs.create(audit).await?;
        Ok(stored)
    }

    /// Apply a blood-unit transition with its audit row. `None` when the
    /// unit was not in a state that allows it.
    pub async fn transition_blood_unit(
        &self,
        id: &str,
        transition: blood_units::UnitTransition,
        at: chrono::DateTime<chrono::Utc>,
        audit: AccessLogEntity,
    ) -> RepositoryResult<Option<blood_units::BloodUnitEntity>> {
        if let Some(pool) = &self.pool {
            return transition_unit_postgres(pool, id, &transition, at, &audit).await;
        }
        let changed = self.blood_units.apply(id, &transition, at).await?;
        if changed.is_some() {
            self.access_logs.create(audit).await?;
        }
        Ok(changed)
    }

    /// Record a telehealth recording together with its audit row.
    pub async fn create_telehealth_recording(
        &self,
        row: telehealth_recordings::TelehealthRecordingEntity,
        audit: AccessLogEntity,
    ) -> RepositoryResult<telehealth_recordings::TelehealthRecordingEntity> {
        if let Some(pool) = &self.pool {
            return create_recording_postgres(pool, &row, &audit).await;
        }
        let stored = self.telehealth_recordings.create(row).await?;
        self.access_logs.create(audit).await?;
        Ok(stored)
    }

    /// Record an EOB document together with its audit row.
    pub async fn create_eob_document(
        &self,
        row: eob_documents::EobDocumentEntity,
        audit: AccessLogEntity,
    ) -> RepositoryResult<eob_documents::EobDocumentEntity> {
        if let Some(pool) = &self.pool {
            return create_eob_postgres(pool, &row, &audit).await;
        }
        let stored = self.eob_documents.create(row).await?;
        self.access_logs.create(audit).await?;
        Ok(stored)
    }

    /// Record a message attachment together with its audit row.
    pub async fn create_message_attachment(
        &self,
        row: message_attachments::MessageAttachmentEntity,
        audit: AccessLogEntity,
    ) -> RepositoryResult<message_attachments::MessageAttachmentEntity> {
        if let Some(pool) = &self.pool {
            return create_attachment_postgres(pool, &row, &audit).await;
        }
        let stored = self.message_attachments.create(row).await?;
        self.access_logs.create(audit).await?;
        Ok(stored)
    }

    /// Deny or cancel an open refill request, with its audit row.
    /// `None` when the request was not open (already decided or cancelled).
    pub async fn close_refill_request(
        &self,
        closure: refill_requests::RefillClosure,
        audit: AccessLogEntity,
    ) -> RepositoryResult<Option<refill_requests::RefillRequestEntity>> {
        if let Some(pool) = &self.pool {
            return close_refill_postgres(pool, &closure, &audit).await;
        }
        let _guard = self.prescription_workflow_lock.lock().await;
        let closed = self.refill_requests.close_if_open(&closure).await?;
        if closed.is_some() {
            self.access_logs.create(audit).await?;
        }
        Ok(closed)
    }

    /// Approve an open refill request: new prescription, original decremented,
    /// request closed and audited, all or nothing on PostgreSQL. `None` when
    /// the request was not open or the original's refill count has moved.
    pub async fn approve_refill_request(
        &self,
        approval: refill_requests::RefillApproval,
    ) -> RepositoryResult<Option<refill_requests::RefillRequestEntity>> {
        if let Some(pool) = &self.pool {
            return approve_refill_postgres(pool, &approval).await;
        }
        // Same lock as every other prescription transition, so a dispense and
        // an approval cannot interleave on the memory backend.
        let _guard = self.prescription_workflow_lock.lock().await;
        let still_open = self
            .refill_requests
            .get_by_id(&approval.closure.request_id)
            .await?
            .is_some_and(|request| request.status == "requested");
        if !still_open {
            return Ok(None);
        }
        let decremented = self
            .e_prescriptions_v2
            .replace_if_field_eq(
                &approval.original_prescription_id,
                "refills_remaining",
                &approval.expected_refills_remaining,
                approval.updated_original,
            )
            .await?;
        if decremented.is_none() {
            return Ok(None);
        }
        self.e_prescriptions_v2
            .create(approval.new_prescription)
            .await?;
        let closed = self
            .refill_requests
            .close_if_open(&approval.closure)
            .await?;
        self.access_logs.create(approval.audit).await?;
        Ok(closed)
    }

    /// Persist a new patient and its NFC tag.
    ///
    /// On the PostgreSQL backend both rows are written inside a single
    /// transaction, so a patient is never left without its tag (or vice versa)
    /// when the second insert fails — the transaction rolls back. The in-memory
    /// backend is single-process and writes the two rows sequentially.
    pub async fn create_patient_with_nfc(
        &self,
        patient: PatientEntity,
        nfc: NfcTagEntity,
    ) -> RepositoryResult<()> {
        let pool = match &self.pool {
            Some(p) => p,
            None => {
                // In-memory backend: sequential writes (single process).
                self.patients.create(patient).await?;
                self.nfc_tags.create(nfc).await?;
                return Ok(());
            }
        };
        // Built with QueryBuilder + push_bind (same convention as postgres/patient.rs
        // and postgres/nfc_tag.rs) — no hand-written placeholders, all values bound.
        let mut tx = pool.begin().await?;

        let mut patient_q: sqlx::QueryBuilder<sqlx::Postgres> = sqlx::QueryBuilder::new(
            "INSERT INTO patients (id, health_id, national_id_hash, national_id_type, \
             first_name_encrypted, last_name_encrypted, date_of_birth_encrypted, gender, \
             blood_type, phone_encrypted, email_encrypted, address_encrypted, \
             emergency_contact_name_encrypted, emergency_contact_phone_encrypted, \
             emergency_contact_relationship, organ_donor, dnr_status, primary_provider_id, \
             wallet_address, registered_by, is_verified, is_active, profile_extras_encrypted, \
             name_search_tokens, key_version) ",
        );
        patient_q.push_values([&patient], |mut b, p| {
            b.push_bind(&p.id)
                .push_bind(&p.health_id)
                .push_bind(&p.national_id_hash)
                .push_bind(&p.national_id_type)
                .push_bind(&p.first_name_encrypted)
                .push_bind(&p.last_name_encrypted)
                .push_bind(&p.date_of_birth_encrypted)
                .push_bind(&p.gender)
                .push_bind(&p.blood_type)
                .push_bind(&p.phone_encrypted)
                .push_bind(&p.email_encrypted)
                .push_bind(&p.address_encrypted)
                .push_bind(&p.emergency_contact_name_encrypted)
                .push_bind(&p.emergency_contact_phone_encrypted)
                .push_bind(&p.emergency_contact_relationship)
                .push_bind(p.organ_donor)
                .push_bind(p.dnr_status)
                .push_bind(&p.primary_provider_id)
                .push_bind(&p.wallet_address)
                .push_bind(&p.registered_by)
                .push_bind(p.is_verified)
                .push_bind(p.is_active)
                .push_bind(&p.profile_extras_encrypted)
                .push_bind(&p.name_search_tokens)
                .push_bind(p.key_version);
        });
        patient_q.build().execute(&mut *tx).await?;

        let mut nfc_q: sqlx::QueryBuilder<sqlx::Postgres> = sqlx::QueryBuilder::new(
            "INSERT INTO nfc_tags (id, tag_uid, patient_id, tag_type, is_active, pin_hash, \
             issued_at, expires_at, last_used_at, use_count, issued_by, status) ",
        );
        nfc_q.push_values([&nfc], |mut b, t| {
            b.push_bind(&t.id)
                .push_bind(&t.tag_uid)
                .push_bind(&t.patient_id)
                .push_bind(&t.tag_type)
                .push_bind(t.is_active)
                .push_bind(&t.pin_hash)
                .push_bind(t.issued_at)
                .push_bind(t.expires_at)
                .push_bind(t.last_used_at)
                .push_bind(t.use_count)
                .push_bind(&t.issued_by)
                .push_bind(&t.status);
        });
        nfc_q.build().execute(&mut *tx).await?;

        tx.commit().await?;
        Ok(())
    }

    /// TOCTOU-safe access recording (Phase 11.1).
    ///
    /// Closes the time-of-check-to-time-of-use gap between "verify the patient
    /// exists and is active" and "write the access-log row". On PostgreSQL the
    /// patient row is locked `FOR UPDATE` inside a transaction, so a concurrent
    /// writer cannot deactivate or delete the patient between the check and the
    /// insert — the access is logged against a definitively-valid, locked row,
    /// or the whole unit rolls back. The in-memory backend is single-process, so
    /// the check-then-act is performed under the repository's own locking.
    ///
    /// Returns [`RepositoryError::NotFound`] if the patient does not exist and
    /// [`RepositoryError::Validation`] if the patient is inactive.
    pub async fn record_access_atomic(
        &self,
        patient_id: &str,
        log: AccessLogEntity,
    ) -> RepositoryResult<()> {
        let pool = match &self.pool {
            Some(p) => p,
            None => {
                // In-memory backend: single process. `get_by_id` errors with
                // NotFound if the patient is absent, giving us the same check.
                let patient = self.patients.get_by_id(patient_id).await?;
                if !patient.is_active {
                    return Err(RepositoryError::Validation(format!(
                        "patient {} is inactive",
                        patient_id
                    )));
                }
                self.access_logs.create(log).await?;
                return Ok(());
            }
        };

        let mut tx = pool.begin().await?;

        // Acquire a row-level lock on the patient; blocks concurrent writers to
        // this row until we commit/rollback.
        let row: Option<(bool,)> =
            sqlx::query_as("SELECT is_active FROM patients WHERE id = $1 FOR UPDATE")
                .bind(patient_id)
                .fetch_optional(&mut *tx)
                .await?;
        match row {
            Some((true,)) => {}
            Some((false,)) => {
                return Err(RepositoryError::Validation(format!(
                    "patient {} is inactive",
                    patient_id
                )))
            }
            None => return Err(RepositoryError::NotFound(patient_id.to_string())),
        }

        // Write the access-log row in the same transaction.
        let mut qb: sqlx::QueryBuilder<sqlx::Postgres> = sqlx::QueryBuilder::new(
            "INSERT INTO access_logs (
                id, accessor_id, accessor_role, patient_id, resource_type, resource_id,
                action, access_reason, is_emergency_access, ip_address, user_agent,
                blockchain_tx_hash, accessed_at, facility_id
            ) ",
        );
        qb.push_values([&log], |mut b, l| {
            b.push_bind(&l.id)
                .push_bind(&l.accessor_id)
                .push_bind(&l.accessor_role)
                .push_bind(&l.patient_id)
                .push_bind(&l.resource_type)
                .push_bind(&l.resource_id)
                .push_bind(&l.action)
                .push_bind(&l.access_reason)
                .push_bind(l.is_emergency_access)
                .push_bind(&l.ip_address)
                .push_bind(&l.user_agent)
                .push_bind(&l.blockchain_tx_hash)
                .push_bind(l.accessed_at)
                .push_bind(&l.facility_id);
        });
        qb.build().execute(&mut *tx).await?;

        tx.commit().await?;
        Ok(())
    }

    /// Book an appointment atomically: reject a booking that overlaps an
    /// existing, non-cancelled appointment for the same provider, checked and
    /// inserted in one transaction on PostgreSQL so two concurrent requests
    /// can't double-book the same slot (11.1 TOCTOU — extends the
    /// `record_access_atomic` pattern to appointment scheduling). Memory
    /// backend: check-then-act under the repo's own locking, the same
    /// accepted limitation `record_access_atomic` documents above.
    pub async fn book_appointment_atomic(
        &self,
        appointment: AppointmentEntity,
    ) -> RepositoryResult<AppointmentEntity> {
        match &self.pool {
            Some(pool) => self.book_appointment_postgres(pool, appointment).await,
            None => self.book_appointment_memory(appointment).await,
        }
    }

    async fn book_appointment_memory(
        &self,
        appointment: AppointmentEntity,
    ) -> RepositoryResult<AppointmentEntity> {
        let day = appointment.scheduled_datetime.date_naive();
        let existing = self
            .appointments
            .get_by_provider(&appointment.provider_id, day)
            .await?;
        if existing
            .iter()
            .any(|e| appointments_overlap(e, &appointment))
        {
            return Err(booking_conflict_error(&appointment.provider_id));
        }
        self.appointments.create(appointment).await
    }

    async fn book_appointment_postgres(
        &self,
        pool: &sqlx::PgPool,
        appointment: AppointmentEntity,
    ) -> RepositoryResult<AppointmentEntity> {
        let mut tx = pool.begin().await?;

        let day_start = appointment
            .scheduled_datetime
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();
        let day_end = day_start + chrono::Duration::days(1);

        // Lock this provider's rows for the day so a concurrent booking can't
        // slip in between our check and our insert.
        let rows: Vec<(chrono::DateTime<chrono::Utc>, i32)> = sqlx::query_as(
            "SELECT scheduled_datetime, duration_minutes FROM appointments \
             WHERE provider_id = $1 AND scheduled_datetime >= $2 AND scheduled_datetime < $3 \
             AND status NOT IN ('cancelled', 'no_show') FOR UPDATE",
        )
        .bind(&appointment.provider_id)
        .bind(day_start)
        .bind(day_end)
        .fetch_all(&mut *tx)
        .await?;

        let (new_start, new_end) = appointment_time_range(&appointment);
        let conflict = rows.iter().any(|(start, minutes)| {
            ranges_overlap(new_start, new_end, *start, minutes_end(*start, *minutes))
        });
        if conflict {
            return Err(booking_conflict_error(&appointment.provider_id));
        }

        let mut qb: sqlx::QueryBuilder<sqlx::Postgres> = sqlx::QueryBuilder::new(
            "INSERT INTO appointments (
                id, patient_id, provider_id, appointment_type, scheduled_datetime,
                duration_minutes, status, location, room, reason_for_visit, visit_type,
                priority, recurring, recurrence_pattern, parent_appointment_id,
                insurance_verified, copay_amount, copay_collected, reminder_sent,
                reminder_sent_at, check_in_time, check_out_time, cancelled_at,
                cancellation_reason, cancelled_by, notes, created_by, data
            ) ",
        );
        qb.push_values([&appointment], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(&a.provider_id)
                .push_bind(&a.appointment_type)
                .push_bind(a.scheduled_datetime)
                .push_bind(a.duration_minutes)
                .push_bind(&a.status)
                .push_bind(&a.location)
                .push_bind(&a.room)
                .push_bind(&a.reason_for_visit)
                .push_bind(&a.visit_type)
                .push_bind(&a.priority)
                .push_bind(a.recurring)
                .push_bind(&a.recurrence_pattern)
                .push_bind(&a.parent_appointment_id)
                .push_bind(a.insurance_verified)
                .push_bind(a.copay_amount)
                .push_bind(a.copay_collected)
                .push_bind(a.reminder_sent)
                .push_bind(a.reminder_sent_at)
                .push_bind(a.check_in_time)
                .push_bind(a.check_out_time)
                .push_bind(a.cancelled_at)
                .push_bind(&a.cancellation_reason)
                .push_bind(&a.cancelled_by)
                .push_bind(&a.notes)
                .push_bind(&a.created_by)
                .push_bind(&a.data);
        });
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AppointmentEntity>()
            .fetch_one(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(result)
    }

    /// Create a new repository container with PostgreSQL backend
    #[cfg(feature = "postgres")]
    pub async fn new_postgres(pool: sqlx::PgPool) -> Result<Self, RepositoryError> {
        Ok(Self {
            backend: StorageBackend::Postgres,
            pool: Some(pool.clone()),
            prescription_workflow_lock: Arc::new(tokio::sync::Mutex::new(())),
            patients: Arc::new(postgres::PgPatientRepository::new(pool.clone())),
            medical_records: Arc::new(postgres::PgMedicalRecordRepository::new(pool.clone())),
            nfc_tags: Arc::new(postgres::PgNfcTagRepository::new(pool.clone())),
            vital_signs: Arc::new(postgres::PgVitalSignsRepository::new(pool.clone())),
            triage_assessments: Arc::new(postgres::PgTriageAssessmentRepository::new(pool.clone())),
            access_logs: Arc::new(postgres::PgAccessLogRepository::new(pool.clone())),
            refill_requests: Arc::new(refill_requests::PgRefillRequestRepository::new(
                pool.clone(),
            )),
            message_attachments: Arc::new(message_attachments::PgMessageAttachmentRepository::new(
                pool.clone(),
            )),
            eob_documents: Arc::new(eob_documents::PgEobDocumentRepository::new(pool.clone())),
            telehealth_recordings: Arc::new(
                telehealth_recordings::PgTelehealthRecordingRepository::new(pool.clone()),
            ),
            blood_units: Arc::new(blood_units::PgBloodUnitRepository::new(pool.clone())),
            guardian_relationships: Arc::new(postgres::PgGuardianRelationshipRepository::new(
                pool.clone(),
            )),
            legal_holds: Arc::new(postgres::PgLegalHoldRepository::new(pool.clone())),
            emergency_capsules: Arc::new(postgres::PgEmergencyCapsuleRepository::new(pool.clone())),
            retention_execution: Arc::new(postgres::PgRetentionExecutionRepository::new(
                pool.clone(),
            )),
            patient_access: Arc::new(postgres::PgPatientAccessRepository::new(pool.clone())),

            // Emergency Protocol repositories (PostgreSQL — JSONB-persisted, C1)
            code_blue: Arc::new(postgres::PgCodeBlueRepository::new(pool.clone())),
            trauma_assessments_repo: Arc::new(postgres::PgTraumaAssessmentRepository::new(
                pool.clone(),
            )),
            stroke_assessments_repo: Arc::new(postgres::PgStrokeAssessmentRepository::new(
                pool.clone(),
            )),
            cardiac_events_repo: Arc::new(postgres::PgCardiacEventRepository::new(pool.clone())),
            sepsis_assessments_repo: Arc::new(postgres::PgSepsisAssessmentRepository::new(
                pool.clone(),
            )),

            // Phase 2: Clinical Documentation repositories (PostgreSQL)
            gcs_assessments: Arc::new(postgres::PgGcsAssessmentRepository::new(pool.clone())),
            progress_notes: Arc::new(postgres::PgProgressNoteRepository::new(pool.clone())),
            history_physicals: Arc::new(postgres::PgHistoryPhysicalRepository::new(pool.clone())),
            consultation_notes: Arc::new(postgres::PgConsultationNoteRepository::new(pool.clone())),
            nursing_care_plans: Arc::new(postgres::PgNursingCarePlanRepository::new(pool.clone())),
            medication_records: Arc::new(postgres::PgMedicationRecordRepository::new(pool.clone())),
            io_records: Arc::new(postgres::PgIORecordRepository::new(pool.clone())),
            wound_assessments: Arc::new(postgres::PgWoundAssessmentRepository::new(pool.clone())),
            iv_assessments: Arc::new(postgres::PgIVAssessmentRepository::new(pool.clone())),
            fall_risk_assessments: Arc::new(postgres::PgFallRiskAssessmentRepository::new(
                pool.clone(),
            )),

            // Phase 3: Lab & Diagnostics repositories (PostgreSQL)
            specimen_collections: Arc::new(postgres::PgSpecimenCollectionRepository::new(
                pool.clone(),
            )),
            specimen_rejections: Arc::new(postgres::PgSpecimenRejectionRepository::new(
                pool.clone(),
            )),
            specimen_recollections: Arc::new(postgres::PgSpecimenRecollectionRepository::new(
                pool.clone(),
            )),
            lab_submissions: Arc::new(postgres::PgLabSubmissionRepository::new(pool.clone())),
            lab_qc_records: Arc::new(postgres::PgLabQcRecordRepository::new(pool.clone())),
            critical_values: Arc::new(postgres::PgCriticalValueRepository::new(pool.clone())),

            // Phase 3: Surgical & Procedures repositories (PostgreSQL)
            pre_op_assessments: Arc::new(postgres::PgPreOpAssessmentRepository::new(pool.clone())),
            operative_notes: Arc::new(postgres::PgOperativeNoteRepository::new(pool.clone())),
            post_op_notes: Arc::new(postgres::PgPostOpNoteRepository::new(pool.clone())),
            anesthesia_records: Arc::new(postgres::PgAnesthesiaRecordRepository::new(pool.clone())),
            intubation_records: Arc::new(postgres::PgIntubationRecordRepository::new(pool.clone())),
            laceration_repairs: Arc::new(postgres::PgLacerationRepairRepository::new(pool.clone())),
            splint_cast_records: Arc::new(postgres::PgSplintCastRecordRepository::new(
                pool.clone(),
            )),

            // Phase 3: Radiology repositories (PostgreSQL)
            radiology_orders: Arc::new(postgres::PgRadiologyOrderRepository::new(pool.clone())),
            radiology_reports: Arc::new(postgres::PgRadiologyReportRepository::new(pool.clone())),
            pathology_reports: Arc::new(postgres::PgPathologyReportRepository::new(pool.clone())),

            // Phase 3: Blood Bank repositories (PostgreSQL)

            // Phase 3: Pharmacy repositories (PostgreSQL)
            medication_reminders: Arc::new(postgres::PgMedicationReminderRepository::new(
                pool.clone(),
            )),
            adherence_logs: Arc::new(postgres::PgAdherenceLogRepository::new(pool.clone())),

            // Phase 4: Specialty Assessments repositories (PostgreSQL)
            burn_assessments: Arc::new(postgres::PgBurnAssessmentRepository::new(pool.clone())),
            psychiatric_assessments: Arc::new(postgres::PgPsychiatricAssessmentRepository::new(
                pool.clone(),
            )),
            toxicology_assessments: Arc::new(postgres::PgToxicologyAssessmentRepository::new(
                pool.clone(),
            )),
            pediatric_assessments: Arc::new(postgres::PgPediatricAssessmentRepository::new(
                pool.clone(),
            )),
            obstetric_emergencies: Arc::new(postgres::PgObstetricEmergencyRepository::new(
                pool.clone(),
            )),

            // Phase 5: Administrative & Scheduling repositories (PostgreSQL)
            appointments: Arc::new(postgres::PgAppointmentRepository::new(pool.clone())),
            physician_orders: Arc::new(postgres::PgPhysicianOrderRepository::new(pool.clone())),
            discharge_summaries: Arc::new(postgres::PgDischargeSummaryRepository::new(
                pool.clone(),
            )),
            discharge_instructions: Arc::new(postgres::PgDischargeInstructionsRepository::new(
                pool.clone(),
            )),
            ama_discharges: Arc::new(postgres::PgAmaDischargeRepository::new(pool.clone())),
            incident_reports: Arc::new(postgres::PgIncidentReportRepository::new(pool.clone())),
            shift_handoffs: Arc::new(postgres::PgShiftHandoffRepository::new(pool.clone())),
            device_tokens: Arc::new(postgres::PgDeviceTokenRepository::new(pool.clone())),
            sms_opt_outs: Arc::new(postgres::PgSmsOptOutRepository::new(pool.clone())),

            // Phase 6: EMS & External repositories (PostgreSQL)
            ems_handoffs: Arc::new(postgres::PgEmsHandoffRepository::new(pool.clone())),
            mci_records: Arc::new(postgres::PgMciRecordRepository::new(pool.clone())),
            chain_of_custody: Arc::new(postgres::PgChainOfCustodyRepository::new(pool.clone())),

            // Phase 9: Clinical Decision Support repositories (PostgreSQL)
            cds_alerts: Arc::new(postgres::PgCdsAlertRepository::new(pool.clone())),

            // Phase 10: Insurance & Billing repositories (PostgreSQL)
            insurance_records: Arc::new(postgres::PgInsuranceRecordRepository::new(pool.clone())),

            // Phase 12: Immunization repositories (PostgreSQL)
            immunization_records: Arc::new(postgres::PgImmunizationRecordRepository::new(
                pool.clone(),
            )),

            // Phase 14: Sync & Integration repositories (PostgreSQL)
            sync_conflicts: Arc::new(postgres::PgSyncConflictRepository::new(pool.clone())),

            // Phase 15: Audit & Compliance repositories (PostgreSQL)
            data_retention_policies: Arc::new(postgres::PgDataRetentionPolicyRepository::new(
                pool.clone(),
            )),
            retention_job_runs: Arc::new(postgres::PgRetentionJobRunRepository::new(pool.clone())),

            // Phase 7 (Round 4): generic JSON-record feature domains (PostgreSQL)
            provider_schedules: Arc::new(postgres::PgProviderScheduleRepository::new(pool.clone())),
            language_preferences: Arc::new(postgres::PgLanguagePreferenceRepository::new(
                pool.clone(),
            )),
            eligibility_checks: Arc::new(postgres::PgEligibilityCheckRepository::new(pool.clone())),
            satisfaction_surveys: Arc::new(postgres::PgSatisfactionSurveyRepository::new(
                pool.clone(),
            )),
            symptom_sessions: Arc::new(postgres::PgSymptomSessionRepository::new(pool.clone())),
            family_groups: Arc::new(postgres::PgFamilyGroupRepository::new(pool.clone())),
            insurance_claims: Arc::new(postgres::PgInsuranceClaimRepository::new(pool.clone())),
            insurance_cards: Arc::new(postgres::PgInsuranceCardRepository::new(pool.clone())),
            autopsy_reports: Arc::new(postgres::PgAutopsyReportRepository::new(pool.clone())),
            sync_queue_items: Arc::new(postgres::PgSyncQueueItemRepository::new(pool.clone())),

            // Round 5: wearables + telehealth legacy shapes (PostgreSQL)
            wearable_device_records: Arc::new(postgres::PgWearableDeviceRecordRepository::new(
                pool.clone(),
            )),
            wearable_reading_records: Arc::new(postgres::PgWearableReadingRecordRepository::new(
                pool.clone(),
            )),
            wearable_alert_records: Arc::new(postgres::PgWearableAlertRecordRepository::new(
                pool.clone(),
            )),
            wearable_alert_rules: Arc::new(postgres::PgWearableAlertRuleRepository::new(
                pool.clone(),
            )),
            telehealth_session_records: Arc::new(
                postgres::PgTelehealthSessionRecordRepository::new(pool.clone()),
            ),

            // Round 6: shape-mismatch domains (PostgreSQL)
            e_prescriptions_v2: Arc::new(postgres::PgEPrescriptionV2Repository::new(pool.clone())),
            drug_interaction_checks: Arc::new(postgres::PgDrugInteractionCheckRepository::new(
                pool.clone(),
            )),
            lab_result_submissions: Arc::new(postgres::PgLabResultSubmissionRepository::new(
                pool.clone(),
            )),

            // Round 7: SOAP clinical notes (PostgreSQL)
            soap_note_records: Arc::new(postgres::PgSoapNoteRecordRepository::new(pool.clone())),

            // Phase 4.3: CDS thresholds + audit (PostgreSQL)
            cds_threshold_configs: Arc::new(postgres::PgCdsThresholdConfigRepository::new(
                pool.clone(),
            )),
            cds_audit_entries: Arc::new(postgres::PgCdsAuditEntryRepository::new(pool.clone())),

            // Phase 33: offline-sync device registry (PostgreSQL)
            sync_devices: Arc::new(postgres::PgSyncDeviceRepository::new(pool.clone())),

            // Horizon HZ-023 (PostgreSQL)
            messages: Arc::new(postgres::PgMessageRepository::new(pool.clone())),
            symptom_entries: Arc::new(postgres::PgSymptomEntryRepository::new(pool.clone())),
            barcode_scans: Arc::new(postgres::PgBarcodeScanRepository::new(pool.clone())),
            lab_calibrations: Arc::new(postgres::PgLabCalibrationRepository::new(pool.clone())),
            note_templates: Arc::new(postgres::PgNoteTemplateRepository::new(pool.clone())),
            order_sets: Arc::new(postgres::PgOrderSetRepository::new(pool.clone())),
            cds_rules: Arc::new(postgres::PgCdsRuleRepository::new(pool.clone())),
            pharmacy_decisions: Arc::new(postgres::PgPharmacyDecisionRepository::new(pool.clone())),
            scanner_settings: Arc::new(postgres::PgScannerSettingsRepository::new(pool.clone())),
            user_avatars: Arc::new(postgres::PgUserAvatarRepository::new(pool.clone())),
            notification_reads: Arc::new(postgres::PgNotificationReadRepository::new(pool.clone())),
            blood_type_screen_records: Arc::new(postgres::PgBloodTypeScreenRecordRepository::new(
                pool.clone(),
            )),
            transfusion_event_records: Arc::new(postgres::PgTransfusionEventRecordRepository::new(
                pool.clone(),
            )),
            dispense_events: Arc::new(postgres::PgDispenseEventRepository::new(pool.clone())),
            prescription_verification_events: Arc::new(
                postgres::PgPrescriptionVerificationEventRepository::new(pool.clone()),
            ),
            death_certificate_records: Arc::new(postgres::PgDeathCertificateRecordRepository::new(
                pool.clone(),
            )),
            family_history_records: Arc::new(postgres::PgFamilyHistoryRecordRepository::new(
                pool.clone(),
            )),
            user_setting_records: Arc::new(postgres::PgUserSettingRecordRepository::new(
                pool.clone(),
            )),
            used_emergency_tokens: Arc::new(postgres::PgUsedEmergencyTokenRepository::new(
                pool.clone(),
            )),
            research_export_runs: Arc::new(postgres::PgResearchExportRunRepository::new(
                pool.clone(),
            )),

            consent_records: Arc::new(postgres::PgConsentRecordRepository::new(pool)),
        })
    }

    /// Create repository container based on environment configuration
    #[cfg(feature = "postgres")]
    pub async fn from_env(pool: Option<sqlx::PgPool>) -> Result<Self, RepositoryError> {
        match StorageBackend::from_env() {
            StorageBackend::Postgres => {
                let pool = pool.ok_or_else(|| {
                    RepositoryError::Configuration(
                        "PostgreSQL pool required for postgres backend".into(),
                    )
                })?;
                Self::new_postgres(pool).await
            }
            StorageBackend::Memory => Ok(Self::new_memory()),
        }
    }

    /// Create repository container based on environment (memory-only fallback)
    #[cfg(not(feature = "postgres"))]
    pub async fn from_env(_pool: Option<()>) -> Result<Self, RepositoryError> {
        if StorageBackend::from_env() == StorageBackend::Postgres {
            log::warn!("PostgreSQL backend requested but 'postgres' feature not enabled. Falling back to memory.");
        }
        Ok(Self::new_memory())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_backend_from_env() {
        // Default should be memory
        std::env::remove_var("MEDICHAIN_STORAGE");
        assert_eq!(StorageBackend::from_env(), StorageBackend::Memory);

        // Test postgres variants
        std::env::set_var("MEDICHAIN_STORAGE", "postgres");
        assert_eq!(StorageBackend::from_env(), StorageBackend::Postgres);

        std::env::set_var("MEDICHAIN_STORAGE", "postgresql");
        assert_eq!(StorageBackend::from_env(), StorageBackend::Postgres);

        std::env::set_var("MEDICHAIN_STORAGE", "pg");
        assert_eq!(StorageBackend::from_env(), StorageBackend::Postgres);

        // Unknown value falls back to memory
        std::env::set_var("MEDICHAIN_STORAGE", "unknown");
        assert_eq!(StorageBackend::from_env(), StorageBackend::Memory);

        // Cleanup
        std::env::remove_var("MEDICHAIN_STORAGE");
    }

    #[test]
    fn test_memory_container_creation() {
        let container = RepositoryContainer::new_memory();
        assert_eq!(container.backend, StorageBackend::Memory);
    }

    fn appt(
        provider_id: &str,
        start_offset_min: i64,
        duration_minutes: i32,
        status: &str,
    ) -> AppointmentEntity {
        let base = chrono::DateTime::from_timestamp(1_700_000_000, 0).unwrap();
        AppointmentEntity {
            id: "A1".to_string(),
            patient_id: "P1".to_string(),
            provider_id: provider_id.to_string(),
            appointment_type: "FollowUp".to_string(),
            scheduled_datetime: base + chrono::Duration::minutes(start_offset_min),
            duration_minutes,
            status: status.to_string(),
            location: None,
            room: None,
            reason_for_visit: None,
            visit_type: None,
            priority: None,
            recurring: false,
            recurrence_pattern: None,
            parent_appointment_id: None,
            insurance_verified: false,
            copay_amount: None,
            copay_collected: false,
            reminder_sent: false,
            reminder_sent_at: None,
            check_in_time: None,
            check_out_time: None,
            cancelled_at: None,
            cancellation_reason: None,
            cancelled_by: None,
            notes: None,
            created_by: "U1".to_string(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            data: serde_json::Value::Null,
        }
    }

    #[test]
    fn overlapping_slots_conflict() {
        let existing = appt("DR-1", 0, 30, "scheduled");
        let candidate = appt("DR-1", 15, 30, "scheduled"); // overlaps [0,30) at 15
        assert!(appointments_overlap(&existing, &candidate));
    }

    #[test]
    fn back_to_back_slots_do_not_conflict() {
        let existing = appt("DR-1", 0, 30, "scheduled");
        let candidate = appt("DR-1", 30, 30, "scheduled"); // starts exactly when existing ends
        assert!(!appointments_overlap(&existing, &candidate));
    }

    #[test]
    fn cancelled_appointments_never_conflict() {
        let existing = appt("DR-1", 0, 30, "cancelled");
        let candidate = appt("DR-1", 10, 30, "scheduled");
        assert!(!appointments_overlap(&existing, &candidate));

        let existing_no_show = appt("DR-1", 0, 30, "no_show");
        assert!(!appointments_overlap(&existing_no_show, &candidate));
    }

    #[test]
    fn identical_slot_conflicts() {
        let existing = appt("DR-1", 0, 30, "scheduled");
        let candidate = appt("DR-1", 0, 30, "scheduled");
        assert!(appointments_overlap(&existing, &candidate));
    }
}
