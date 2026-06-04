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
//! │  (PatientRepository, AllergyRepository, etc.)              │
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

pub mod traits;

#[cfg(feature = "postgres")]
pub mod postgres;

pub mod memory;

// Re-export commonly used items
pub use traits::*;

use std::sync::Arc;

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
    // Phase 1 repositories
    pub patients: Arc<dyn PatientRepository>,
    pub allergies: Arc<dyn AllergyRepository>,
    pub medical_records: Arc<dyn MedicalRecordRepository>,
    pub nfc_tags: Arc<dyn NfcTagRepository>,
    pub vital_signs: Arc<dyn VitalSignsRepository>,
    pub triage_assessments: Arc<dyn TriageAssessmentRepository>,
    pub access_logs: Arc<dyn AccessLogRepository>,

    // Emergency Protocol repositories
    pub code_blue: Arc<dyn CodeBlueRepository>,
    pub trauma_assessments_repo: Arc<dyn TraumaAssessmentRepository>,
    pub stroke_assessments_repo: Arc<dyn StrokeAssessmentRepository>,
    pub cardiac_events_repo: Arc<dyn CardiacEventRepository>,
    pub sepsis_assessments_repo: Arc<dyn SepsisAssessmentRepository>,

    // Phase 2: Clinical Documentation repositories
    pub sample_history: Arc<dyn SampleHistoryRepository>,
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
    pub lab_submissions: Arc<dyn LabSubmissionRepository>,
    pub lab_panels: Arc<dyn LabPanelRepository>,
    pub lab_trends: Arc<dyn LabTrendRepository>,
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
    pub blood_type_screens: Arc<dyn BloodTypeScreenRepository>,
    pub crossmatch_records: Arc<dyn CrossmatchRecordRepository>,
    pub transfusion_records: Arc<dyn TransfusionRecordRepository>,

    // Phase 3: Pharmacy repositories
    pub e_prescriptions: Arc<dyn EPrescriptionRepository>,
    pub drug_interactions: Arc<dyn DrugInteractionRepository>,
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

    // Phase 6: EMS & External repositories
    pub ems_handoffs: Arc<dyn EmsHandoffRepository>,
    pub mci_records: Arc<dyn MciRecordRepository>,
    pub chain_of_custody: Arc<dyn ChainOfCustodyRepository>,

    // Phase 7: Wearables & IoT repositories
    pub wearable_devices: Arc<dyn WearableDeviceRepository>,
    pub wearable_data: Arc<dyn WearableDataRepository>,
    pub wearable_alerts: Arc<dyn WearableAlertRepository>,
    pub wearable_integration_logs: Arc<dyn WearableIntegrationLogRepository>,

    // Phase 8: Telehealth repositories
    pub telehealth_sessions: Arc<dyn TelehealthSessionRepository>,
    pub telehealth_notes: Arc<dyn TelehealthNoteRepository>,
    pub remote_patient_monitoring: Arc<dyn RemotePatientMonitoringRepository>,
    pub rpm_readings: Arc<dyn RpmReadingRepository>,

    // Phase 9: Clinical Decision Support repositories
    pub cds_alerts: Arc<dyn CdsAlertRepository>,

    // Phase 10: Insurance & Billing repositories
    pub insurance_records: Arc<dyn InsuranceRecordRepository>,
    pub billing_codes: Arc<dyn BillingCodeRepository>,

    // Phase 11: Family & Genetics repositories
    pub family_medical_histories: Arc<dyn FamilyMedicalHistoryRepository>,
    pub genetic_test_results: Arc<dyn GeneticTestResultRepository>,

    // Phase 12: Immunization repositories
    pub immunization_records: Arc<dyn ImmunizationRecordRepository>,
    pub immunization_schedules: Arc<dyn ImmunizationScheduleRepository>,
    pub vaccine_inventory: Arc<dyn VaccineInventoryRepository>,

    // Phase 13: Death Records repositories
    pub death_records: Arc<dyn DeathRecordRepository>,
    pub organ_donation_records: Arc<dyn OrganDonationRecordRepository>,

    // Phase 14: Sync & Integration repositories
    pub sync_operations: Arc<dyn SyncOperationRepository>,
    pub sync_conflicts: Arc<dyn SyncConflictRepository>,
    pub external_id_mappings: Arc<dyn ExternalIdMappingRepository>,

    // Phase 15: Audit & Compliance repositories
    pub compliance_reports: Arc<dyn ComplianceReportRepository>,
    pub data_retention_policies: Arc<dyn DataRetentionPolicyRepository>,
    pub retention_job_runs: Arc<dyn RetentionJobRunRepository>,
    pub consent_records: Arc<dyn ConsentRecordRepository>,

    // Phase 7 (Round 4): generic JSON-record feature domains
    pub language_preferences: Arc<dyn JsonRecordRepository>,
    pub eligibility_checks: Arc<dyn JsonRecordRepository>,
    pub satisfaction_surveys: Arc<dyn JsonRecordRepository>,
    pub symptom_sessions: Arc<dyn JsonRecordRepository>,
    pub family_groups: Arc<dyn JsonRecordRepository>,
    pub insurance_claims: Arc<dyn JsonRecordRepository>,
    pub insurance_cards: Arc<dyn JsonRecordRepository>,
    pub autopsy_requests: Arc<dyn JsonRecordRepository>,
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
    pub lab_trend_results: Arc<dyn JsonRecordRepository>,
    pub lab_result_submissions: Arc<dyn JsonRecordRepository>,

    // Round 7: SOAP clinical notes (JSON-record backed)
    pub soap_note_records: Arc<dyn JsonRecordRepository>,
}

impl RepositoryContainer {
    /// Create a new repository container with memory backend
    pub fn new_memory() -> Self {
        Self {
            backend: StorageBackend::Memory,
            pool: None,
            patients: Arc::new(memory::MemoryPatientRepository::new()),
            allergies: Arc::new(memory::MemoryAllergyRepository::new()),
            medical_records: Arc::new(memory::MemoryMedicalRecordRepository::new()),
            nfc_tags: Arc::new(memory::MemoryNfcTagRepository::new()),
            vital_signs: Arc::new(memory::MemoryVitalSignsRepository::new()),
            triage_assessments: Arc::new(memory::MemoryTriageAssessmentRepository::new()),
            access_logs: Arc::new(memory::MemoryAccessLogRepository::new()),

            // Emergency Protocol repositories (memory)
            code_blue: Arc::new(memory::MemoryCodeBlueRepository::new()),
            trauma_assessments_repo: Arc::new(memory::MemoryTraumaAssessmentRepository::new()),
            stroke_assessments_repo: Arc::new(memory::MemoryStrokeAssessmentRepository::new()),
            cardiac_events_repo: Arc::new(memory::MemoryCardiacEventRepository::new()),
            sepsis_assessments_repo: Arc::new(memory::MemorySepsisAssessmentRepository::new()),

            // Phase 2: Clinical Documentation repositories (memory)
            sample_history: Arc::new(memory::MemorySampleHistoryRepository::new()),
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
            lab_submissions: Arc::new(memory::MemoryLabSubmissionRepository::new()),
            lab_panels: Arc::new(memory::MemoryLabPanelRepository::new()),
            lab_trends: Arc::new(memory::MemoryLabTrendRepository::new()),
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
            blood_type_screens: Arc::new(memory::MemoryBloodTypeScreenRepository::new()),
            crossmatch_records: Arc::new(memory::MemoryCrossmatchRecordRepository::new()),
            transfusion_records: Arc::new(memory::MemoryTransfusionRecordRepository::new()),

            // Phase 3: Pharmacy repositories (memory)
            e_prescriptions: Arc::new(memory::MemoryEPrescriptionRepository::new()),
            drug_interactions: Arc::new(memory::MemoryDrugInteractionRepository::new()),
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

            // Phase 6: EMS & External repositories (memory)
            ems_handoffs: Arc::new(memory::MemoryEmsHandoffRepository::new()),
            mci_records: Arc::new(memory::MemoryMciRecordRepository::new()),
            chain_of_custody: Arc::new(memory::MemoryChainOfCustodyRepository::new()),

            // Phase 7: Wearables & IoT repositories (memory)
            wearable_devices: Arc::new(memory::MemoryWearableDeviceRepository::new()),
            wearable_data: Arc::new(memory::MemoryWearableDataRepository::new()),
            wearable_alerts: Arc::new(memory::MemoryWearableAlertRepository::new()),
            wearable_integration_logs: Arc::new(
                memory::MemoryWearableIntegrationLogRepository::new(),
            ),

            // Phase 8: Telehealth repositories (memory)
            telehealth_sessions: Arc::new(memory::MemoryTelehealthSessionRepository::new()),
            telehealth_notes: Arc::new(memory::MemoryTelehealthNoteRepository::new()),
            remote_patient_monitoring: Arc::new(
                memory::MemoryRemotePatientMonitoringRepository::new(),
            ),
            rpm_readings: Arc::new(memory::MemoryRpmReadingRepository::new()),

            // Phase 9: Clinical Decision Support repositories (memory)
            cds_alerts: Arc::new(memory::MemoryCdsAlertRepository::new()),

            // Phase 10: Insurance & Billing repositories (memory)
            insurance_records: Arc::new(memory::MemoryInsuranceRecordRepository::new()),
            billing_codes: Arc::new(memory::MemoryBillingCodeRepository::new()),

            // Phase 11: Family & Genetics repositories (memory)
            family_medical_histories: Arc::new(memory::MemoryFamilyMedicalHistoryRepository::new()),
            genetic_test_results: Arc::new(memory::MemoryGeneticTestResultRepository::new()),

            // Phase 12: Immunization repositories (memory)
            immunization_records: Arc::new(memory::MemoryImmunizationRecordRepository::new()),
            immunization_schedules: Arc::new(memory::MemoryImmunizationScheduleRepository::new()),
            vaccine_inventory: Arc::new(memory::MemoryVaccineInventoryRepository::new()),

            // Phase 13: Death Records repositories (memory)
            death_records: Arc::new(memory::MemoryDeathRecordRepository::new()),
            organ_donation_records: Arc::new(memory::MemoryOrganDonationRecordRepository::new()),

            // Phase 14: Sync & Integration repositories (memory)
            sync_operations: Arc::new(memory::MemorySyncOperationRepository::new()),
            sync_conflicts: Arc::new(memory::MemorySyncConflictRepository::new()),
            external_id_mappings: Arc::new(memory::MemoryExternalIdMappingRepository::new()),

            // Phase 15: Audit & Compliance repositories (memory)
            compliance_reports: Arc::new(memory::MemoryComplianceReportRepository::new()),
            data_retention_policies: Arc::new(memory::MemoryDataRetentionPolicyRepository::new()),
            retention_job_runs: Arc::new(memory::MemoryRetentionJobRunRepository::new()),
            consent_records: Arc::new(memory::MemoryConsentRecordRepository::new()),

            // Phase 7 (Round 4): generic JSON-record feature domains (memory)
            language_preferences: Arc::new(memory::MemoryJsonRecordRepository::new()),
            eligibility_checks: Arc::new(memory::MemoryJsonRecordRepository::new()),
            satisfaction_surveys: Arc::new(memory::MemoryJsonRecordRepository::new()),
            symptom_sessions: Arc::new(memory::MemoryJsonRecordRepository::new()),
            family_groups: Arc::new(memory::MemoryJsonRecordRepository::new()),
            insurance_claims: Arc::new(memory::MemoryJsonRecordRepository::new()),
            insurance_cards: Arc::new(memory::MemoryJsonRecordRepository::new()),
            autopsy_requests: Arc::new(memory::MemoryJsonRecordRepository::new()),
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
            lab_trend_results: Arc::new(memory::MemoryJsonRecordRepository::new()),
            lab_result_submissions: Arc::new(memory::MemoryJsonRecordRepository::new()),

            // Round 7: SOAP clinical notes (memory)
            soap_note_records: Arc::new(memory::MemoryJsonRecordRepository::new()),
        }
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
             wallet_address, registered_by, is_verified, is_active, profile_extras_encrypted) ",
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
                .push_bind(&p.profile_extras_encrypted);
        });
        patient_q.build().execute(&mut *tx).await?;

        let mut nfc_q: sqlx::QueryBuilder<sqlx::Postgres> = sqlx::QueryBuilder::new(
            "INSERT INTO nfc_tags (id, tag_uid, patient_id, tag_type, is_active, pin_hash, \
             issued_at, expires_at, last_used_at, use_count, issued_by) ",
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
                .push_bind(&t.issued_by);
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

    /// Create a new repository container with PostgreSQL backend
    #[cfg(feature = "postgres")]
    pub async fn new_postgres(pool: sqlx::PgPool) -> Result<Self, RepositoryError> {
        Ok(Self {
            backend: StorageBackend::Postgres,
            pool: Some(pool.clone()),
            patients: Arc::new(postgres::PgPatientRepository::new(pool.clone())),
            allergies: Arc::new(postgres::PgAllergyRepository::new(pool.clone())),
            medical_records: Arc::new(postgres::PgMedicalRecordRepository::new(pool.clone())),
            nfc_tags: Arc::new(postgres::PgNfcTagRepository::new(pool.clone())),
            vital_signs: Arc::new(postgres::PgVitalSignsRepository::new(pool.clone())),
            triage_assessments: Arc::new(postgres::PgTriageAssessmentRepository::new(pool.clone())),
            access_logs: Arc::new(postgres::PgAccessLogRepository::new(pool.clone())),

            // Emergency Protocol repositories (memory fallback until Pg implemented)
            code_blue: Arc::new(memory::MemoryCodeBlueRepository::new()),
            trauma_assessments_repo: Arc::new(memory::MemoryTraumaAssessmentRepository::new()),
            stroke_assessments_repo: Arc::new(memory::MemoryStrokeAssessmentRepository::new()),
            cardiac_events_repo: Arc::new(memory::MemoryCardiacEventRepository::new()),
            sepsis_assessments_repo: Arc::new(memory::MemorySepsisAssessmentRepository::new()),

            // Phase 2: Clinical Documentation repositories (PostgreSQL)
            sample_history: Arc::new(postgres::PgSampleHistoryRepository::new(pool.clone())),
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
            lab_submissions: Arc::new(postgres::PgLabSubmissionRepository::new(pool.clone())),
            lab_panels: Arc::new(postgres::PgLabPanelRepository::new(pool.clone())),
            lab_trends: Arc::new(postgres::PgLabTrendRepository::new(pool.clone())),
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
            blood_type_screens: Arc::new(postgres::PgBloodTypeScreenRepository::new(pool.clone())),
            crossmatch_records: Arc::new(postgres::PgCrossmatchRecordRepository::new(pool.clone())),
            transfusion_records: Arc::new(postgres::PgTransfusionRecordRepository::new(
                pool.clone(),
            )),

            // Phase 3: Pharmacy repositories (PostgreSQL)
            e_prescriptions: Arc::new(postgres::PgEPrescriptionRepository::new(pool.clone())),
            drug_interactions: Arc::new(postgres::PgDrugInteractionRepository::new(pool.clone())),
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

            // Phase 6: EMS & External repositories (PostgreSQL)
            ems_handoffs: Arc::new(postgres::PgEmsHandoffRepository::new(pool.clone())),
            mci_records: Arc::new(postgres::PgMciRecordRepository::new(pool.clone())),
            chain_of_custody: Arc::new(postgres::PgChainOfCustodyRepository::new(pool.clone())),

            // Phase 7: Wearables & IoT repositories (PostgreSQL)
            wearable_devices: Arc::new(postgres::PgWearableDeviceRepository::new(pool.clone())),
            wearable_data: Arc::new(postgres::PgWearableDataRepository::new(pool.clone())),
            wearable_alerts: Arc::new(postgres::PgWearableAlertRepository::new(pool.clone())),
            wearable_integration_logs: Arc::new(postgres::PgWearableIntegrationLogRepository::new(
                pool.clone(),
            )),

            // Phase 8: Telehealth repositories (PostgreSQL)
            telehealth_sessions: Arc::new(postgres::PgTelehealthSessionRepository::new(
                pool.clone(),
            )),
            telehealth_notes: Arc::new(postgres::PgTelehealthNoteRepository::new(pool.clone())),
            remote_patient_monitoring: Arc::new(
                postgres::PgRemotePatientMonitoringRepository::new(pool.clone()),
            ),
            rpm_readings: Arc::new(postgres::PgRpmReadingRepository::new(pool.clone())),

            // Phase 9: Clinical Decision Support repositories (PostgreSQL)
            cds_alerts: Arc::new(postgres::PgCdsAlertRepository::new(pool.clone())),

            // Phase 10: Insurance & Billing repositories (PostgreSQL)
            insurance_records: Arc::new(postgres::PgInsuranceRecordRepository::new(pool.clone())),
            billing_codes: Arc::new(postgres::PgBillingCodeRepository::new(pool.clone())),

            // Phase 11: Family & Genetics repositories (PostgreSQL)
            family_medical_histories: Arc::new(postgres::PgFamilyMedicalHistoryRepository::new(
                pool.clone(),
            )),
            genetic_test_results: Arc::new(postgres::PgGeneticTestResultRepository::new(
                pool.clone(),
            )),

            // Phase 12: Immunization repositories (PostgreSQL)
            immunization_records: Arc::new(postgres::PgImmunizationRecordRepository::new(
                pool.clone(),
            )),
            immunization_schedules: Arc::new(postgres::PgImmunizationScheduleRepository::new(
                pool.clone(),
            )),
            vaccine_inventory: Arc::new(postgres::PgVaccineInventoryRepository::new(pool.clone())),

            // Phase 13: Death Records repositories (PostgreSQL)
            death_records: Arc::new(postgres::PgDeathRecordRepository::new(pool.clone())),
            organ_donation_records: Arc::new(postgres::PgOrganDonationRecordRepository::new(
                pool.clone(),
            )),

            // Phase 14: Sync & Integration repositories (PostgreSQL)
            sync_operations: Arc::new(postgres::PgSyncOperationRepository::new(pool.clone())),
            sync_conflicts: Arc::new(postgres::PgSyncConflictRepository::new(pool.clone())),
            external_id_mappings: Arc::new(postgres::PgExternalIdMappingRepository::new(
                pool.clone(),
            )),

            // Phase 15: Audit & Compliance repositories (PostgreSQL)
            compliance_reports: Arc::new(postgres::PgComplianceReportRepository::new(pool.clone())),
            data_retention_policies: Arc::new(postgres::PgDataRetentionPolicyRepository::new(
                pool.clone(),
            )),
            retention_job_runs: Arc::new(postgres::PgRetentionJobRunRepository::new(pool.clone())),

            // Phase 7 (Round 4): generic JSON-record feature domains (PostgreSQL)
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
            autopsy_requests: Arc::new(postgres::PgAutopsyRequestRepository::new(pool.clone())),
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
            telehealth_session_records: Arc::new(postgres::PgTelehealthSessionRecordRepository::new(
                pool.clone(),
            )),

            // Round 6: shape-mismatch domains (PostgreSQL)
            e_prescriptions_v2: Arc::new(postgres::PgEPrescriptionV2Repository::new(pool.clone())),
            drug_interaction_checks: Arc::new(postgres::PgDrugInteractionCheckRepository::new(
                pool.clone(),
            )),
            lab_trend_results: Arc::new(postgres::PgLabTrendResultRepository::new(pool.clone())),
            lab_result_submissions: Arc::new(postgres::PgLabResultSubmissionRepository::new(
                pool.clone(),
            )),

            // Round 7: SOAP clinical notes (PostgreSQL)
            soap_note_records: Arc::new(postgres::PgSoapNoteRecordRepository::new(pool.clone())),

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
}
