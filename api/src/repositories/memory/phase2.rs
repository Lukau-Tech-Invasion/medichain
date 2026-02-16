//! Phase 2 memory repository implementations module.
//!
//! This module contains all the Phase 2 clinical documentation and nursing care
//! memory repository implementations for backward compatibility.

mod sample_history;
mod gcs_assessment;
mod progress_note;
mod history_physical;
mod consultation_note;
mod nursing_care_plan;
mod medication_record;
mod io_record;
mod wound_assessment;
mod iv_assessment;
mod fall_risk_assessment;

pub use sample_history::MemorySampleHistoryRepository;
pub use gcs_assessment::MemoryGcsAssessmentRepository;
pub use progress_note::MemoryProgressNoteRepository;
pub use history_physical::MemoryHistoryPhysicalRepository;
pub use consultation_note::MemoryConsultationNoteRepository;
pub use nursing_care_plan::MemoryNursingCarePlanRepository;
pub use medication_record::MemoryMedicationRecordRepository;
pub use io_record::MemoryIORecordRepository;
pub use wound_assessment::MemoryWoundAssessmentRepository;
pub use iv_assessment::MemoryIVAssessmentRepository;
pub use fall_risk_assessment::MemoryFallRiskAssessmentRepository;