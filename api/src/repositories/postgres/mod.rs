//! PostgreSQL repository implementations.
//!
//! These implementations use sqlx for async PostgreSQL database access.
//! All queries are parameterized to prevent SQL injection.
//!
//! # NASA Power of 10 Compliance
//!
//! - No recursion
//! - All result sets bounded by LIMIT clauses
//! - Functions under 60 lines

#[cfg(test)]
mod actor_registry_tests;
#[cfg(test)]
pub(crate) mod tests;

mod access_log;
mod cds;
mod consent;
mod consultation_note;
mod discharge;
mod emergency;
mod emergency_capsules;
mod ems;
mod fall_risk_assessment;
mod gcs_assessment;
mod guardian_relationships;
mod history_physical;
mod imaging;
mod immunization;
mod incident;
mod insurance;
mod io_record;
mod iv_assessment;
mod json_record;
mod lab;
mod legal_holds;
mod medical_record;
mod medication_adherence;
mod medication_record;
mod nfc_tag;
mod notifications;
mod nursing_care_plan;
mod patient;
mod patient_access;
mod progress_note;
mod retention;
mod retention_execution;
mod scheduling_orders;
mod shift_handoff;
mod specialty;
mod surgical;
mod sync;
mod triage;
mod vital_signs;
mod wound_assessment;

pub use access_log::PgAccessLogRepository;
pub use cds::PgCdsAlertRepository;
pub use consent::PgConsentRecordRepository;
pub use consultation_note::PgConsultationNoteRepository;
pub use discharge::{
    PgAmaDischargeRepository, PgDischargeInstructionsRepository, PgDischargeSummaryRepository,
};
pub use emergency::{
    PgCardiacEventRepository, PgCodeBlueRepository, PgSepsisAssessmentRepository,
    PgStrokeAssessmentRepository, PgTraumaAssessmentRepository,
};
pub use emergency_capsules::PgEmergencyCapsuleRepository;
pub use ems::{PgChainOfCustodyRepository, PgEmsHandoffRepository, PgMciRecordRepository};
pub use fall_risk_assessment::PgFallRiskAssessmentRepository;
pub use gcs_assessment::PgGcsAssessmentRepository;
pub use guardian_relationships::PgGuardianRelationshipRepository;
pub use history_physical::PgHistoryPhysicalRepository;
pub use imaging::{
    PgPathologyReportRepository, PgRadiologyOrderRepository, PgRadiologyReportRepository,
};
pub use immunization::PgImmunizationRecordRepository;
pub use incident::PgIncidentReportRepository;
pub use insurance::PgInsuranceRecordRepository;
pub use io_record::PgIORecordRepository;
pub use iv_assessment::PgIVAssessmentRepository;
pub use lab::{
    PgCriticalValueRepository, PgLabQcRecordRepository, PgLabSubmissionRepository,
    PgSpecimenCollectionRepository, PgSpecimenRecollectionRepository,
    PgSpecimenRejectionRepository,
};
pub use legal_holds::PgLegalHoldRepository;
pub use medical_record::PgMedicalRecordRepository;
pub use medication_adherence::{PgAdherenceLogRepository, PgMedicationReminderRepository};
pub use medication_record::PgMedicationRecordRepository;
pub use nfc_tag::PgNfcTagRepository;
pub use notifications::{PgDeviceTokenRepository, PgSmsOptOutRepository};
pub use nursing_care_plan::PgNursingCarePlanRepository;
pub use patient::PgPatientRepository;
pub use patient_access::PgPatientAccessRepository;
pub use progress_note::PgProgressNoteRepository;
pub use retention::{PgDataRetentionPolicyRepository, PgRetentionJobRunRepository};
pub use retention_execution::PgRetentionExecutionRepository;
pub use scheduling_orders::{PgAppointmentRepository, PgPhysicianOrderRepository};
pub use shift_handoff::PgShiftHandoffRepository;
pub use specialty::{
    PgBurnAssessmentRepository, PgObstetricEmergencyRepository, PgPediatricAssessmentRepository,
    PgPsychiatricAssessmentRepository, PgToxicologyAssessmentRepository,
};
pub use surgical::{
    PgAnesthesiaRecordRepository, PgIntubationRecordRepository, PgLacerationRepairRepository,
    PgOperativeNoteRepository, PgPostOpNoteRepository, PgPreOpAssessmentRepository,
    PgSplintCastRecordRepository,
};
pub use sync::PgSyncConflictRepository;
pub use triage::PgTriageAssessmentRepository;
pub use vital_signs::PgVitalSignsRepository;
pub use wound_assessment::PgWoundAssessmentRepository;

// Generic JSON-record feature domains
pub use json_record::{
    PgAutopsyReportRepository,
    // Horizon HZ-023: stores replacing fabricated literals
    PgBarcodeScanRepository,
    // Final durability sweep (migration 20260811000002)
    PgBloodTypeScreenRecordRepository,
    // Phase 4.3: CDS thresholds + audit
    PgCdsAuditEntryRepository,
    PgCdsRuleRepository,
    PgCdsThresholdConfigRepository,
    PgDeathCertificateRecordRepository,
    PgDispenseEventRepository,
    // Round 6: shape-mismatch domains
    PgDrugInteractionCheckRepository,
    PgEPrescriptionV2Repository,
    PgEligibilityCheckRepository,
    // Ambulance run record (migration 20261030000001)
    PgEmsRunEventRepository,
    PgEmsRunRepository,
    PgFamilyGroupRepository,
    PgFamilyHistoryRecordRepository,
    PgInsuranceCardRepository,
    PgInsuranceClaimRepository,
    PgLabCalibrationRepository,
    PgLabResultSubmissionRepository,
    PgLanguagePreferenceRepository,
    PgMessageRepository,
    PgNoteTemplateRepository,
    PgNotificationReadRepository,
    PgOrderSetRepository,
    PgPharmacyDecisionRepository,
    PgPrescriptionVerificationEventRepository,
    PgProviderScheduleRepository,
    PgResearchExportRunRepository,
    PgSatisfactionSurveyRepository,
    PgScannerSettingsRepository,
    // Round 7: SOAP clinical notes
    PgSoapNoteRecordRepository,
    PgSymptomEntryRepository,
    PgSymptomSessionRepository,
    // Phase 33: offline-sync device registry
    PgSyncDeviceRepository,
    PgSyncQueueItemRepository,
    // Round 5: wearables + telehealth
    PgTelehealthSessionRecordRepository,
    PgTransfusionEventRecordRepository,
    PgUsedEmergencyTokenRepository,
    PgUserAvatarRepository,
    PgUserSettingRecordRepository,
    PgWearableAlertRecordRepository,
    PgWearableAlertRuleRepository,
    PgWearableDeviceRecordRepository,
    PgWearableReadingRecordRepository,
};
