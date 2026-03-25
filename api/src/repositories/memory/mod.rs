//! In-memory repository implementations using HashMap.
//!
//! These implementations provide backward compatibility with the existing
//! AppState HashMap-based storage. They are the default when PostgreSQL
//! is not configured.
//!
//! # Thread Safety
//!
//! All repositories use `RwLock<HashMap>` for thread-safe access.

// Phase 1 repositories
mod access_log;
mod allergy;
mod medical_record;
mod nfc_tag;
mod patient;
mod triage;
mod vital_signs;

// Phase 2 repositories
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

// Emergency protocol repositories
mod emergency;

// Phase 3 repositories
mod phase3;

// Phase 1 exports
pub use access_log::MemoryAccessLogRepository;
pub use allergy::MemoryAllergyRepository;
pub use medical_record::MemoryMedicalRecordRepository;
pub use nfc_tag::MemoryNfcTagRepository;
pub use patient::MemoryPatientRepository;
pub use triage::MemoryTriageAssessmentRepository;
pub use vital_signs::MemoryVitalSignsRepository;

// Phase 2 exports
pub use consultation_note::MemoryConsultationNoteRepository;
pub use fall_risk_assessment::MemoryFallRiskAssessmentRepository;
pub use gcs_assessment::MemoryGcsAssessmentRepository;
pub use history_physical::MemoryHistoryPhysicalRepository;
pub use io_record::MemoryIORecordRepository;
pub use iv_assessment::MemoryIVAssessmentRepository;
pub use medication_record::MemoryMedicationRecordRepository;
pub use nursing_care_plan::MemoryNursingCarePlanRepository;
pub use progress_note::MemoryProgressNoteRepository;
pub use sample_history::MemorySampleHistoryRepository;
pub use wound_assessment::MemoryWoundAssessmentRepository;

// Emergency protocol exports
pub use emergency::MemoryCodeBlueRepository;
pub use emergency::MemoryTraumaAssessmentRepository;
pub use emergency::MemoryStrokeAssessmentRepository;
pub use emergency::MemoryCardiacEventRepository;
pub use emergency::MemorySepsisAssessmentRepository;

// Phase 3 exports - Lab & Diagnostics
pub use phase3::MemoryCriticalValueRepository;
pub use phase3::MemoryLabPanelRepository;
pub use phase3::MemoryLabQcRecordRepository;
pub use phase3::MemoryLabSubmissionRepository;
pub use phase3::MemoryLabTrendRepository;
pub use phase3::MemorySpecimenCollectionRepository;
pub use phase3::MemorySpecimenRejectionRepository;

// Phase 3 exports - Surgical & Procedures
pub use phase3::MemoryAnesthesiaRecordRepository;
pub use phase3::MemoryIntubationRecordRepository;
pub use phase3::MemoryLacerationRepairRepository;
pub use phase3::MemoryOperativeNoteRepository;
pub use phase3::MemoryPostOpNoteRepository;
pub use phase3::MemoryPreOpAssessmentRepository;
pub use phase3::MemorySplintCastRecordRepository;

// Phase 3 exports - Radiology & Imaging
pub use phase3::MemoryPathologyReportRepository;
pub use phase3::MemoryRadiologyOrderRepository;
pub use phase3::MemoryRadiologyReportRepository;

// Phase 3 exports - Blood Bank
pub use phase3::MemoryBloodTypeScreenRepository;
pub use phase3::MemoryCrossmatchRecordRepository;
pub use phase3::MemoryTransfusionRecordRepository;

// Phase 3 exports - Pharmacy & Medications
pub use phase3::MemoryAdherenceLogRepository;
pub use phase3::MemoryDrugInteractionRepository;
pub use phase3::MemoryEPrescriptionRepository;
pub use phase3::MemoryMedicationReminderRepository;

// Phase 4-6 repositories
mod phase4;

// Phase 4 exports - Specialty Assessments
pub use phase4::MemoryBurnAssessmentRepository;
pub use phase4::MemoryObstetricEmergencyRepository;
pub use phase4::MemoryPediatricAssessmentRepository;
pub use phase4::MemoryPsychiatricAssessmentRepository;
pub use phase4::MemoryToxicologyAssessmentRepository;

// Phase 5 exports - Administrative & Scheduling
pub use phase4::MemoryAmaDischargeRepository;
pub use phase4::MemoryAppointmentRepository;
pub use phase4::MemoryDischargeInstructionsRepository;
pub use phase4::MemoryDischargeSummaryRepository;
pub use phase4::MemoryIncidentReportRepository;
pub use phase4::MemoryPhysicianOrderRepository;
pub use phase4::MemoryShiftHandoffRepository;

// Phase 6 exports - EMS & External
pub use phase4::MemoryChainOfCustodyRepository;
pub use phase4::MemoryEmsHandoffRepository;
pub use phase4::MemoryMciRecordRepository;

// Phase 7-10 repositories
mod phase5;

// Phase 7 exports - Wearables & IoT
pub use phase5::MemoryWearableAlertRepository;
pub use phase5::MemoryWearableDataRepository;
pub use phase5::MemoryWearableDeviceRepository;
pub use phase5::MemoryWearableIntegrationLogRepository;

// Phase 8 exports - Telehealth
pub use phase5::MemoryRemotePatientMonitoringRepository;
pub use phase5::MemoryRpmReadingRepository;
pub use phase5::MemoryTelehealthNoteRepository;
pub use phase5::MemoryTelehealthSessionRepository;

// Phase 9 exports - Clinical Decision Support
pub use phase5::MemoryCdsAlertRepository;

// Phase 10 exports - Insurance & Billing
pub use phase5::MemoryBillingCodeRepository;
pub use phase5::MemoryDeviceTokenRepository;
pub use phase5::MemoryInsuranceRecordRepository;

// Phase 11-15 repositories
mod phase6;

// Phase 11 exports - Family History & Genetics
pub use phase6::MemoryFamilyMedicalHistoryRepository;
pub use phase6::MemoryGeneticTestResultRepository;

// Phase 12 exports - Immunization Records
pub use phase6::MemoryImmunizationRecordRepository;
pub use phase6::MemoryImmunizationScheduleRepository;
pub use phase6::MemoryVaccineInventoryRepository;

// Phase 13 exports - Death Records & Certification
pub use phase6::MemoryDeathRecordRepository;
pub use phase6::MemoryOrganDonationRecordRepository;

// Phase 14 exports - Data Synchronization & Conflict Resolution
pub use phase6::MemoryExternalIdMappingRepository;
pub use phase6::MemorySyncConflictRepository;
pub use phase6::MemorySyncOperationRepository;

// Phase 15 exports - Enhanced Audit & Compliance
pub use phase6::MemoryComplianceReportRepository;
pub use phase6::MemoryConsentRecordRepository;
pub use phase6::MemoryDataRetentionPolicyRepository;
pub use phase6::MemoryRetentionJobRunRepository;
