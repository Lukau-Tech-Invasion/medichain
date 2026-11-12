//! In-memory repository implementations using HashMap.
//!
//! These implementations provide backward compatibility with the existing
//! AppState HashMap-based storage. They are the default when PostgreSQL
//! is not configured.
//!
//! # Thread Safety
//!
//! All repositories use `RwLock<HashMap>` for thread-safe access.

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

pub use access_log::MemoryAccessLogRepository;
pub use cds::MemoryCdsAlertRepository;
pub use consent::MemoryConsentRecordRepository;
pub use consultation_note::MemoryConsultationNoteRepository;
pub use discharge::{
    MemoryAmaDischargeRepository, MemoryDischargeInstructionsRepository,
    MemoryDischargeSummaryRepository,
};
pub use emergency::{
    MemoryCardiacEventRepository, MemoryCodeBlueRepository, MemorySepsisAssessmentRepository,
    MemoryStrokeAssessmentRepository, MemoryTraumaAssessmentRepository,
};
pub use emergency_capsules::MemoryEmergencyCapsuleRepository;
pub use ems::{
    MemoryChainOfCustodyRepository, MemoryEmsHandoffRepository, MemoryMciRecordRepository,
};
pub use fall_risk_assessment::MemoryFallRiskAssessmentRepository;
pub use gcs_assessment::MemoryGcsAssessmentRepository;
pub use guardian_relationships::MemoryGuardianRelationshipRepository;
pub use history_physical::MemoryHistoryPhysicalRepository;
pub use imaging::{
    MemoryPathologyReportRepository, MemoryRadiologyOrderRepository,
    MemoryRadiologyReportRepository,
};
pub use immunization::MemoryImmunizationRecordRepository;
pub use incident::MemoryIncidentReportRepository;
pub use insurance::MemoryInsuranceRecordRepository;
pub use io_record::MemoryIORecordRepository;
pub use iv_assessment::MemoryIVAssessmentRepository;
pub use lab::{
    MemoryCriticalValueRepository, MemoryLabQcRecordRepository, MemoryLabSubmissionRepository,
    MemorySpecimenCollectionRepository, MemorySpecimenRecollectionRepository,
    MemorySpecimenRejectionRepository,
};
pub use legal_holds::MemoryLegalHoldRepository;
pub use medical_record::MemoryMedicalRecordRepository;
pub use medication_adherence::{MemoryAdherenceLogRepository, MemoryMedicationReminderRepository};
pub use medication_record::MemoryMedicationRecordRepository;
pub use nfc_tag::MemoryNfcTagRepository;
pub use notifications::{MemoryDeviceTokenRepository, MemorySmsOptOutRepository};
pub use nursing_care_plan::MemoryNursingCarePlanRepository;
pub use patient::MemoryPatientRepository;
pub use patient_access::MemoryPatientAccessRepository;
pub use progress_note::MemoryProgressNoteRepository;
pub use retention::{MemoryDataRetentionPolicyRepository, MemoryRetentionJobRunRepository};
pub use retention_execution::MemoryRetentionExecutionRepository;
pub use scheduling_orders::{MemoryAppointmentRepository, MemoryPhysicianOrderRepository};
pub use shift_handoff::MemoryShiftHandoffRepository;
pub use specialty::{
    MemoryBurnAssessmentRepository, MemoryObstetricEmergencyRepository,
    MemoryPediatricAssessmentRepository, MemoryPsychiatricAssessmentRepository,
    MemoryToxicologyAssessmentRepository,
};
pub use surgical::{
    MemoryAnesthesiaRecordRepository, MemoryIntubationRecordRepository,
    MemoryLacerationRepairRepository, MemoryOperativeNoteRepository, MemoryPostOpNoteRepository,
    MemoryPreOpAssessmentRepository, MemorySplintCastRecordRepository,
};
pub use sync::MemorySyncConflictRepository;
pub use triage::MemoryTriageAssessmentRepository;
pub use vital_signs::MemoryVitalSignsRepository;
pub use wound_assessment::MemoryWoundAssessmentRepository;

// Generic JSON-record feature domains
pub use json_record::MemoryJsonRecordRepository;
