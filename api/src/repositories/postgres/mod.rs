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

mod access_log;
mod allergy;
mod emergency;
mod medical_record;
mod nfc_tag;
mod patient;
mod triage;
mod vital_signs;

#[cfg(test)]
pub(crate) mod tests;

// Phase 2: Clinical Documentation repositories
mod consultation_note;
mod fall_risk_assessment;
mod gcs_assessment;
mod history_physical;
mod io_record;
mod iv_assessment;
mod medication_record;
mod nursing_care_plan;
mod progress_note;
mod sample_history;
mod wound_assessment;

// Phase 3: Lab, Surgical, Radiology, Blood Bank, Pharmacy repositories
mod phase3_lab;
mod phase3_other;
mod phase3_surgical;

// Phase 4-6: Specialty Assessments, Administrative, EMS & External
mod phase4_admin;
mod phase4_ems;
mod phase4_specialty;

// Persistent guardian relationships (supersedes the in-memory GuardianRegistry)
mod guardian_relationships;
pub use guardian_relationships::PgGuardianRelationshipRepository;
mod legal_holds;
pub use legal_holds::PgLegalHoldRepository;
mod emergency_capsules;
pub use emergency_capsules::PgEmergencyCapsuleRepository;
mod retention_execution;
pub use retention_execution::PgRetentionExecutionRepository;
mod patient_access;
pub use patient_access::PgPatientAccessRepository;

// Phase 7-10: Wearables & IoT, Telehealth, Clinical Decision Support, Insurance & Billing
mod phase5_cds;
mod phase5_communication;
mod phase5_insurance;

// Phase 11-15: Family/Genetics, Immunization, Death, Sync/Integration, Audit/Compliance
mod phase6_audit;
mod phase6_immunization;
mod phase6_sync;

pub use access_log::PgAccessLogRepository;
pub use allergy::PgAllergyRepository;
pub use emergency::{
    PgCardiacEventRepository, PgCodeBlueRepository, PgSepsisAssessmentRepository,
    PgStrokeAssessmentRepository, PgTraumaAssessmentRepository,
};
pub use medical_record::PgMedicalRecordRepository;
pub use nfc_tag::PgNfcTagRepository;
pub use patient::PgPatientRepository;
pub use triage::PgTriageAssessmentRepository;
pub use vital_signs::PgVitalSignsRepository;

// Phase 2 exports
pub use consultation_note::PgConsultationNoteRepository;
pub use fall_risk_assessment::PgFallRiskAssessmentRepository;
pub use gcs_assessment::PgGcsAssessmentRepository;
pub use history_physical::PgHistoryPhysicalRepository;
pub use io_record::PgIORecordRepository;
pub use iv_assessment::PgIVAssessmentRepository;
pub use medication_record::PgMedicationRecordRepository;
pub use nursing_care_plan::PgNursingCarePlanRepository;
pub use progress_note::PgProgressNoteRepository;
pub use sample_history::PgSampleHistoryRepository;
pub use wound_assessment::PgWoundAssessmentRepository;

// Phase 3 exports: Lab & Diagnostics
pub use phase3_lab::{
    PgCriticalValueRepository, PgLabQcRecordRepository, PgLabSubmissionRepository,
    PgSpecimenCollectionRepository, PgSpecimenRecollectionRepository,
    PgSpecimenRejectionRepository,
};

// Phase 3 exports: Surgical & Procedures
pub use phase3_surgical::{
    PgAnesthesiaRecordRepository, PgIntubationRecordRepository, PgLacerationRepairRepository,
    PgOperativeNoteRepository, PgPostOpNoteRepository, PgPreOpAssessmentRepository,
    PgSplintCastRecordRepository,
};

// Phase 3 exports: Radiology, Blood Bank, Pharmacy
pub use phase3_other::{
    PgAdherenceLogRepository,
    // Blood Bank
    PgBloodTypeScreenRepository,
    PgDrugInteractionRepository,
    // Pharmacy
    PgMedicationReminderRepository,
    PgPathologyReportRepository,
    // Radiology
    PgRadiologyOrderRepository,
    PgRadiologyReportRepository,
};

// Phase 4 exports: Specialty Assessments
pub use phase4_specialty::{
    PgBurnAssessmentRepository, PgObstetricEmergencyRepository, PgPediatricAssessmentRepository,
    PgPsychiatricAssessmentRepository, PgToxicologyAssessmentRepository,
};

// Phase 5 exports: Administrative & Scheduling
pub use phase4_admin::{
    PgAmaDischargeRepository, PgAppointmentRepository, PgDischargeInstructionsRepository,
    PgDischargeSummaryRepository, PgIncidentReportRepository, PgPhysicianOrderRepository,
    PgShiftHandoffRepository,
};

// Phase 6 exports: EMS & External
pub use phase4_ems::{PgChainOfCustodyRepository, PgEmsHandoffRepository, PgMciRecordRepository};

// Phase 7 exports: Wearables & IoT

// Phase 8 exports: Telehealth

// Phase 9 exports: Clinical Decision Support
pub use phase5_cds::PgCdsAlertRepository;

pub use phase5_communication::{PgDeviceTokenRepository, PgSmsOptOutRepository};

// Phase 10 exports: Insurance & Billing
pub use phase5_insurance::PgInsuranceRecordRepository;

// Phase 11 exports: Family & Genetics

// Phase 12 exports: Immunization
pub use phase6_immunization::PgImmunizationRecordRepository;

// Phase 13 exports: Death Records

// Phase 14 exports: Sync & Integration
pub use phase6_sync::PgSyncConflictRepository;

// Phase 15 exports: Audit & Compliance
pub use phase6_audit::{
    PgConsentRecordRepository, PgDataRetentionPolicyRepository, PgRetentionJobRunRepository,
};

// Phase 7 (Round 4): generic JSON-record feature domains
mod phase7;
pub use phase7::{
    PgAutopsyReportRepository,
    PgAutopsyRequestRepository,
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
    PgEPrescriptionRecordRepository,
    PgEPrescriptionV2Repository,
    PgEligibilityCheckRepository,
    PgFamilyGroupRepository,
    PgFamilyHistoryRecordRepository,
    PgInsuranceCardRepository,
    PgInsuranceClaimRepository,
    PgLabCalibrationRepository,
    PgLabResultSubmissionRepository,
    PgLabTrendResultRepository,
    PgLanguagePreferenceRepository,
    PgMessageRepository,
    PgNoteTemplateRepository,
    PgNotificationReadRepository,
    PgOrderSetRepository,
    PgPharmacyDecisionRepository,
    PgPrescriptionVerificationEventRepository,
    PgProviderScheduleRepository,
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
