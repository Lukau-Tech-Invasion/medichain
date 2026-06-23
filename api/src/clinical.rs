//! Clinical Documentation Module
//!
//! Implements professional medical documentation standards:
//! - ESI (Emergency Severity Index) Triage System
//! - SOAP Notes (Subjective, Objective, Assessment, Plan)
//! - SAMPLE History (Signs, Allergies, Medications, Past history, Last oral intake, Events)
//! - Glasgow Coma Scale (GCS) with automatic scoring
//! - Vital Signs Flowsheet with time-series tracking
//!
//! © 2025 Trustware. All rights reserved.

// Allow medical acronyms to be in uppercase (medical standard naming)
#![allow(clippy::upper_case_acronyms)]
// Allow dead code - these structs will be used as API endpoints are implemented
#![allow(dead_code)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ============================================================================
// ESI (Emergency Severity Index) TRIAGE SYSTEM
// ============================================================================
// Standard 5-level triage system used worldwide for emergency departments

/// ESI Level - Emergency Severity Index
/// Level 1 is most critical, Level 5 is least urgent
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum ESILevel {
    /// Level 1: Requires immediate life-saving intervention
    /// Examples: Cardiac arrest, severe respiratory distress, major trauma
    Level1Resuscitation,
    /// Level 2: High-risk situation or severe pain/distress
    /// Examples: Chest pain, altered mental status, severe allergic reaction
    Level2Emergent,
    /// Level 3: Requires two or more resources but stable vital signs
    /// Examples: Abdominal pain needing labs + imaging, high fever
    #[default]
    Level3Urgent,
    /// Level 4: Requires one resource
    /// Examples: Simple laceration, UTI symptoms, medication refill
    Level4LessUrgent,
    /// Level 5: No resources needed
    /// Examples: Prescription refill, minor complaint, suture removal
    Level5NonUrgent,
}

impl ESILevel {
    /// Create ESILevel from numeric value (1-5)
    pub fn from_level(level: u8) -> Option<Self> {
        match level {
            1 => Some(ESILevel::Level1Resuscitation),
            2 => Some(ESILevel::Level2Emergent),
            3 => Some(ESILevel::Level3Urgent),
            4 => Some(ESILevel::Level4LessUrgent),
            5 => Some(ESILevel::Level5NonUrgent),
            _ => None,
        }
    }

    /// Get numeric level (1-5)
    pub fn level(&self) -> u8 {
        match self {
            ESILevel::Level1Resuscitation => 1,
            ESILevel::Level2Emergent => 2,
            ESILevel::Level3Urgent => 3,
            ESILevel::Level4LessUrgent => 4,
            ESILevel::Level5NonUrgent => 5,
        }
    }

    /// Get human-readable description
    pub fn description(&self) -> &'static str {
        match self {
            ESILevel::Level1Resuscitation => {
                "Resuscitation - Immediate life-saving intervention required"
            }
            ESILevel::Level2Emergent => {
                "Emergent - High-risk, confused/lethargic, severe pain/distress"
            }
            ESILevel::Level3Urgent => "Urgent - Stable, multiple resources needed",
            ESILevel::Level4LessUrgent => "Less Urgent - Stable, one resource needed",
            ESILevel::Level5NonUrgent => "Non-Urgent - Stable, no resources needed",
        }
    }

    /// Get expected wait time category
    pub fn expected_wait(&self) -> &'static str {
        match self {
            ESILevel::Level1Resuscitation => "Immediate (0 minutes)",
            ESILevel::Level2Emergent => "Immediate to 10 minutes",
            ESILevel::Level3Urgent => "Up to 30 minutes",
            ESILevel::Level4LessUrgent => "Up to 60 minutes",
            ESILevel::Level5NonUrgent => "Up to 120 minutes or next available",
        }
    }

    /// Color code for visual display
    pub fn color_code(&self) -> &'static str {
        match self {
            ESILevel::Level1Resuscitation => "red",
            ESILevel::Level2Emergent => "orange",
            ESILevel::Level3Urgent => "yellow",
            ESILevel::Level4LessUrgent => "green",
            ESILevel::Level5NonUrgent => "blue",
        }
    }
}

impl std::fmt::Display for ESILevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ESI-{}: {}", self.level(), self.description())
    }
}

/// Vital signs captured during triage
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TriageVitalSigns {
    /// Heart rate (beats per minute) - Normal: 60-100
    pub heart_rate: Option<u16>,
    /// Respiratory rate (breaths per minute) - Normal: 12-20
    pub respiratory_rate: Option<u16>,
    /// Blood pressure systolic (mmHg) - Normal: 90-120
    pub bp_systolic: Option<u16>,
    /// Blood pressure diastolic (mmHg) - Normal: 60-80
    pub bp_diastolic: Option<u16>,
    /// Temperature in Celsius - Normal: 36.1-37.2
    pub temperature_celsius: Option<f32>,
    /// Oxygen saturation percentage - Normal: 95-100%
    pub oxygen_saturation: Option<u8>,
    /// Pain scale (0-10) - 0 = no pain, 10 = worst imaginable
    pub pain_scale: Option<u8>,
    /// Glasgow Coma Scale score (3-15) - 15 = fully alert
    pub gcs_score: Option<u8>,
    /// Blood glucose (mg/dL) - Normal fasting: 70-100
    pub blood_glucose: Option<u16>,
    /// Weight in kilograms
    pub weight_kg: Option<f32>,
}

impl TriageVitalSigns {
    /// Check if any vital sign is critically abnormal
    pub fn has_critical_values(&self) -> bool {
        // Critical thresholds based on adult values
        let hr_critical = self.heart_rate.is_some_and(|hr| !(40..=150).contains(&hr));
        let rr_critical = self
            .respiratory_rate
            .is_some_and(|rr| !(8..=35).contains(&rr));
        let bp_critical = self.bp_systolic.is_some_and(|bp| !(80..=220).contains(&bp));
        let temp_critical = self
            .temperature_celsius
            .is_some_and(|t| !(35.0..=40.0).contains(&t));
        let spo2_critical = self.oxygen_saturation.is_some_and(|spo2| spo2 < 90);
        let gcs_critical = self.gcs_score.is_some_and(|gcs| gcs < 9);
        let glucose_critical = self
            .blood_glucose
            .is_some_and(|bg| !(50..=400).contains(&bg));

        hr_critical
            || rr_critical
            || bp_critical
            || temp_critical
            || spo2_critical
            || gcs_critical
            || glucose_critical
    }
}

/// Complete triage assessment record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriageAssessment {
    /// Unique assessment ID
    pub assessment_id: String,
    /// Patient ID this assessment belongs to
    pub patient_id: String,
    /// ESI level assigned
    pub esi_level: ESILevel,
    /// Chief complaint - main reason for visit
    pub chief_complaint: String,
    /// Vital signs at triage
    pub vital_signs: TriageVitalSigns,
    /// Pain scale (0-10)
    pub pain_scale: Option<u8>,
    /// Additional notes from triage nurse
    pub notes: Option<String>,
    /// Nurse/provider who performed triage
    pub performed_by: String,
    /// Timestamp of assessment (Unix timestamp)
    pub performed_at: i64,
}

/// Information when patient is re-triaged
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReTriageInfo {
    /// Previous ESI level
    pub previous_level: ESILevel,
    /// New ESI level
    pub new_level: ESILevel,
    /// Reason for re-triage
    pub reason: String,
    /// Who performed re-triage
    pub assessed_by: String,
    /// When re-triaged
    pub assessed_at: DateTime<Utc>,
}

// ============================================================================
// SAMPLE HISTORY
// ============================================================================
// EMS/Emergency standard for rapid patient assessment

/// SAMPLE History - Standard emergency assessment format
/// S - Signs/Symptoms
/// A - Allergies
/// M - Medications
/// P - Past medical history
/// L - Last oral intake
/// E - Events leading to illness/injury
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SAMPLEHistory {
    /// Patient ID
    pub patient_id: String,
    /// Signs and symptoms - what is the patient experiencing?
    pub signs_symptoms: Vec<String>,
    /// Allergies - medications, foods, environmental
    pub allergies: Vec<AllergyInfo>,
    /// Current medications with dosages
    pub medications: Vec<MedicationInfo>,
    /// Past medical history - conditions, surgeries, hospitalizations
    pub past_medical_history: Vec<String>,
    /// Last oral intake - time and what was consumed
    pub last_intake: Option<LastIntake>,
    /// Events leading to current situation
    pub events_leading: String,
    /// Who collected this history
    pub collected_by: String,
    /// When it was collected (Unix timestamp)
    pub collected_at: i64,
}

/// Detailed allergy information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllergyInfo {
    /// Allergen name
    pub allergen: String,
    /// Type: medication, food, environmental, other
    pub allergy_type: String,
    /// Reaction description
    pub reaction: String,
    /// Severity: mild, moderate, severe, anaphylaxis
    pub severity: String,
}

/// Medication information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MedicationInfo {
    /// Medication name (generic or brand)
    pub name: String,
    /// Dosage (e.g., "500mg")
    pub dosage: String,
    /// Frequency (e.g., "twice daily", "as needed")
    pub frequency: String,
    /// Route (e.g., "oral", "injection", "topical")
    pub route: String,
    /// Prescribing reason
    pub indication: Option<String>,
    /// Last dose taken
    pub last_dose: Option<DateTime<Utc>>,
}

/// Last oral intake information (important for surgery/procedures)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastIntake {
    /// Type: solid food, liquid, clear liquid, NPO
    pub intake_type: String,
    /// What was consumed
    pub description: String,
    /// When it was consumed
    pub time: DateTime<Utc>,
}

// ============================================================================
// SOAP NOTES
// ============================================================================
// Standard medical documentation format

/// SOAP Note - Standard clinical documentation
/// S - Subjective (patient's description)
/// O - Objective (measurable findings)
/// A - Assessment (diagnosis/impression)
/// P - Plan (treatment plan)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SOAPNote {
    /// Unique note ID
    pub note_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Note type: initial, follow-up, consultation, procedure
    pub encounter_type: String,
    /// SUBJECTIVE: Patient's description of symptoms, history, concerns
    pub subjective: SubjectiveSection,
    /// OBJECTIVE: Measurable, observable data
    pub objective: ObjectiveSection,
    /// ASSESSMENT: Clinical impression, diagnoses
    pub assessment: AssessmentSection,
    /// PLAN: Treatment plan, medications, follow-up
    pub plan: PlanSection,
    /// Provider who created the note
    pub author_id: String,
    /// Creation timestamp (Unix timestamp)
    pub created_at: i64,
    /// Last update timestamp (Unix timestamp)
    pub updated_at: Option<i64>,
    /// Status: active, amended, error
    pub status: String,
    /// Addendum notes if any
    pub addenda: Vec<SOAPAddendum>,
}

/// Subjective section of SOAP note
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SubjectiveSection {
    /// Chief complaint
    pub chief_complaint: String,
    /// History of present illness (HPI)
    pub history_of_present_illness: String,
    /// Review of systems
    pub review_of_systems: Option<String>,
    /// Patient-reported symptoms
    pub symptoms: Vec<String>,
    /// Duration of symptoms
    pub symptom_duration: Option<String>,
    /// What makes it better/worse
    pub modifying_factors: Option<String>,
    /// Previous treatments tried
    pub previous_treatments: Option<String>,
    /// Social history notes (relevant)
    pub social_history: Option<String>,
    /// Family history (relevant)
    pub family_history: Option<String>,
}

/// Objective section of SOAP note
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ObjectiveSection {
    /// Vital signs
    pub vital_signs: Option<TriageVitalSigns>,
    /// General appearance
    pub general_appearance: Option<String>,
    /// Physical examination findings by system
    pub physical_exam: Vec<PhysicalExamFinding>,
    /// Lab results (references)
    pub lab_results: Vec<String>,
    /// Imaging results (references)
    pub imaging_results: Vec<String>,
    /// Other diagnostic tests
    pub diagnostic_tests: Vec<String>,
}

/// Physical examination finding
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicalExamFinding {
    /// Body system (cardiovascular, respiratory, neurological, etc.)
    pub system: String,
    /// Findings (normal, abnormal)
    pub findings: String,
    /// Whether findings are normal
    pub is_normal: bool,
}

/// Assessment section of SOAP note
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AssessmentSection {
    /// Primary diagnosis/impression
    pub primary_diagnosis: Option<DiagnosisEntry>,
    /// Secondary/differential diagnoses
    pub secondary_diagnoses: Vec<DiagnosisEntry>,
    /// Clinical reasoning/summary
    pub clinical_summary: String,
    /// Severity/acuity assessment
    pub severity: Option<String>,
    /// Prognosis if relevant
    pub prognosis: Option<String>,
}

/// Diagnosis entry with ICD-10 code support
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosisEntry {
    /// Diagnosis description
    pub description: String,
    /// ICD-10 code if known
    pub icd10_code: Option<String>,
    /// Status: confirmed, provisional, rule-out
    pub status: String,
}

/// Plan section of SOAP note
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlanSection {
    /// Treatment plan narrative
    pub treatment_plan: String,
    /// Medications prescribed
    pub medications: Vec<PrescriptionEntry>,
    /// Procedures ordered/performed
    pub procedures: Vec<String>,
    /// Lab tests ordered
    pub lab_orders: Vec<String>,
    /// Imaging ordered
    pub imaging_orders: Vec<String>,
    /// Referrals
    pub referrals: Vec<String>,
    /// Patient education provided
    pub patient_education: Vec<String>,
    /// Follow-up instructions
    pub follow_up: Option<String>,
    /// Return precautions/red flags
    pub return_precautions: Vec<String>,
    /// Work/school restrictions if any
    pub activity_restrictions: Option<String>,
}

/// Prescription entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrescriptionEntry {
    /// Medication name
    pub medication: String,
    /// Dosage
    pub dosage: String,
    /// Route
    pub route: String,
    /// Frequency
    pub frequency: String,
    /// Duration
    pub duration: String,
    /// Quantity dispensed
    pub quantity: Option<u32>,
    /// Refills allowed
    pub refills: Option<u32>,
    /// Special instructions
    pub instructions: Option<String>,
}

/// Addendum to SOAP note (for corrections/additions)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SOAPAddendum {
    /// Unique addendum ID
    pub addendum_id: String,
    /// Addendum content
    pub content: String,
    /// Who added it
    pub author_id: String,
    /// When added (Unix timestamp)
    pub created_at: i64,
}

// ============================================================================
// GLASGOW COMA SCALE (GCS)
// ============================================================================
// Standard neurological assessment tool

/// Eye Opening Response (1-4)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum EyeResponse {
    /// 1 - No eye opening
    None = 1,
    /// 2 - Eye opening to pain
    ToPain = 2,
    /// 3 - Eye opening to voice
    ToVoice = 3,
    /// 4 - Eyes open spontaneously
    Spontaneous = 4,
}

impl EyeResponse {
    /// Create from numeric score (1-4)
    pub fn from_score(score: u8) -> Option<Self> {
        match score {
            1 => Some(EyeResponse::None),
            2 => Some(EyeResponse::ToPain),
            3 => Some(EyeResponse::ToVoice),
            4 => Some(EyeResponse::Spontaneous),
            _ => None,
        }
    }

    pub fn score(&self) -> u8 {
        *self as u8
    }

    pub fn description(&self) -> &'static str {
        match self {
            EyeResponse::None => "No eye opening",
            EyeResponse::ToPain => "Eye opening to pain",
            EyeResponse::ToVoice => "Eye opening to voice",
            EyeResponse::Spontaneous => "Eyes open spontaneously",
        }
    }
}

/// Verbal Response (1-5)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum VerbalResponse {
    /// 1 - No verbal response
    None = 1,
    /// 2 - Incomprehensible sounds
    IncomprehensibleSounds = 2,
    /// 3 - Inappropriate words
    InappropriateWords = 3,
    /// 4 - Confused conversation
    Confused = 4,
    /// 5 - Oriented and conversing
    Oriented = 5,
}

impl VerbalResponse {
    /// Create from numeric score (1-5)
    pub fn from_score(score: u8) -> Option<Self> {
        match score {
            1 => Some(VerbalResponse::None),
            2 => Some(VerbalResponse::IncomprehensibleSounds),
            3 => Some(VerbalResponse::InappropriateWords),
            4 => Some(VerbalResponse::Confused),
            5 => Some(VerbalResponse::Oriented),
            _ => None,
        }
    }

    pub fn score(&self) -> u8 {
        *self as u8
    }

    pub fn description(&self) -> &'static str {
        match self {
            VerbalResponse::None => "No verbal response",
            VerbalResponse::IncomprehensibleSounds => "Incomprehensible sounds",
            VerbalResponse::InappropriateWords => "Inappropriate words",
            VerbalResponse::Confused => "Confused conversation",
            VerbalResponse::Oriented => "Oriented and conversing",
        }
    }
}

/// Motor Response (1-6)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum MotorResponse {
    /// 1 - No motor response
    None = 1,
    /// 2 - Extension to pain (decerebrate posturing)
    ExtensionToPain = 2,
    /// 3 - Abnormal flexion to pain (decorticate posturing)
    AbnormalFlexion = 3,
    /// 4 - Withdrawal from pain
    WithdrawalFromPain = 4,
    /// 5 - Localizes to pain
    LocalizesToPain = 5,
    /// 6 - Obeys commands
    ObeysCommands = 6,
}

impl MotorResponse {
    /// Create from numeric score (1-6)
    pub fn from_score(score: u8) -> Option<Self> {
        match score {
            1 => Some(MotorResponse::None),
            2 => Some(MotorResponse::ExtensionToPain),
            3 => Some(MotorResponse::AbnormalFlexion),
            4 => Some(MotorResponse::WithdrawalFromPain),
            5 => Some(MotorResponse::LocalizesToPain),
            6 => Some(MotorResponse::ObeysCommands),
            _ => None,
        }
    }

    pub fn score(&self) -> u8 {
        *self as u8
    }

    pub fn description(&self) -> &'static str {
        match self {
            MotorResponse::None => "No motor response",
            MotorResponse::ExtensionToPain => "Extension to pain (decerebrate)",
            MotorResponse::AbnormalFlexion => "Abnormal flexion (decorticate)",
            MotorResponse::WithdrawalFromPain => "Withdrawal from pain",
            MotorResponse::LocalizesToPain => "Localizes to pain",
            MotorResponse::ObeysCommands => "Obeys commands",
        }
    }
}

/// Glasgow Coma Scale assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlasgowComaScale {
    /// Unique assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Eye opening response
    pub eye_response: EyeResponse,
    /// Verbal response
    pub verbal_response: VerbalResponse,
    /// Motor response
    pub motor_response: MotorResponse,
    /// Total score (calculated: 3-15)
    pub total_score: u8,
    /// Interpretation of score
    pub interpretation: String,
    /// Special considerations (intubated, sedated, etc.)
    pub notes: Option<String>,
    /// Pupil assessment (optional but commonly done with GCS)
    pub pupil_assessment: Option<PupilAssessment>,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time (Unix timestamp)
    pub assessed_at: i64,
}

impl GlasgowComaScale {
    /// Create new GCS assessment with automatic score calculation
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        assessment_id: String,
        patient_id: String,
        eye: EyeResponse,
        verbal: VerbalResponse,
        motor: MotorResponse,
        pupil_assessment: Option<PupilAssessment>,
        notes: Option<String>,
        assessed_by: String,
    ) -> Self {
        let total = eye.score() + verbal.score() + motor.score();
        let interpretation = Self::interpret_score_static(total);

        GlasgowComaScale {
            assessment_id,
            patient_id,
            eye_response: eye,
            verbal_response: verbal,
            motor_response: motor,
            total_score: total,
            interpretation,
            notes,
            pupil_assessment,
            assessed_by,
            assessed_at: Utc::now().timestamp(),
        }
    }

    /// Interpret GCS score (static version)
    pub fn interpret_score_static(score: u8) -> String {
        match score {
            3..=8 => "Severe brain injury (coma)".to_string(),
            9..=12 => "Moderate brain injury".to_string(),
            13..=15 => "Mild brain injury or normal".to_string(),
            _ => "Invalid score".to_string(),
        }
    }

    /// Interpret this assessment's score
    pub fn interpret_score(&self) -> &str {
        match self.total_score {
            3..=8 => "Severe brain injury (coma)",
            9..=12 => "Moderate brain injury",
            13..=15 => "Mild brain injury or normal",
            _ => "Invalid score",
        }
    }

    /// Check if patient is in coma (GCS <= 8)
    pub fn is_comatose(&self) -> bool {
        self.total_score <= 8
    }

    /// Check if intubation may be needed (GCS <= 8)
    pub fn needs_airway_protection(&self) -> bool {
        self.total_score <= 8
    }
}

/// Pupil assessment (often paired with GCS)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PupilAssessment {
    /// Left pupil size in mm
    pub left_size_mm: f32,
    /// Right pupil size in mm
    pub right_size_mm: f32,
    /// Left pupil reactivity
    pub left_reactivity: PupilReactivity,
    /// Right pupil reactivity
    pub right_reactivity: PupilReactivity,
    /// Additional notes
    pub notes: Option<String>,
}

/// Pupil reactivity
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PupilReactivity {
    /// Brisk/normal reaction to light
    Brisk,
    /// Sluggish reaction to light
    Sluggish,
    /// Non-reactive/fixed
    NonReactive,
    /// Unable to assess (e.g., swollen)
    UnableToAssess,
}

impl std::fmt::Display for PupilReactivity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PupilReactivity::Brisk => write!(f, "Brisk"),
            PupilReactivity::Sluggish => write!(f, "Sluggish"),
            PupilReactivity::NonReactive => write!(f, "Non-reactive"),
            PupilReactivity::UnableToAssess => write!(f, "Unable to assess"),
        }
    }
}

// ============================================================================
// VITAL SIGNS FLOWSHEET
// ============================================================================
// Time-series tracking of vital signs

/// Vital signs reading with timestamp
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VitalSignsReading {
    /// Unique reading ID
    pub reading_id: String,
    /// Reading timestamp (Unix timestamp)
    pub timestamp: i64,
    /// Heart rate (bpm)
    pub heart_rate: Option<u16>,
    /// Systolic blood pressure (mmHg)
    pub systolic_bp: Option<u16>,
    /// Diastolic blood pressure (mmHg)
    pub diastolic_bp: Option<u16>,
    /// Respiratory rate (breaths/min)
    pub respiratory_rate: Option<u16>,
    /// Oxygen saturation (%)
    pub oxygen_saturation: Option<u16>,
    /// Temperature (Celsius)
    pub temperature_celsius: Option<f32>,
    /// Pain scale (0-10)
    pub pain_scale: Option<u8>,
    /// Recorded by
    pub recorded_by: String,
    /// Additional notes
    pub notes: Option<String>,
}

/// Parse an ABO/Rh blood type string into `(ABO, is_rh_positive)`.
/// Returns `None` for unrecognized input.
fn parse_blood_type(s: &str) -> Option<(&'static str, bool)> {
    let s = s.trim().to_uppercase();
    let (abo, rh_positive) = if let Some(stripped) = s.strip_suffix('+') {
        (stripped.to_string(), true)
    } else if let Some(stripped) = s.strip_suffix('-') {
        (stripped.to_string(), false)
    } else {
        return None;
    };
    let abo_static = match abo.as_str() {
        "O" => "O",
        "A" => "A",
        "B" => "B",
        "AB" => "AB",
        _ => return None,
    };
    Some((abo_static, rh_positive))
}

/// Whether `donor` red blood cells can be transfused into `recipient`
/// (ABO + Rh compatibility). Returns `false` for unparseable inputs.
///
/// Rules: O- is the universal donor, AB+ the universal recipient; an Rh-positive
/// donor cannot give to an Rh-negative recipient; ABO antigens must be absent in
/// the recipient's plasma (O→all, A→A/AB, B→B/AB, AB→AB).
pub fn blood_type_compatible(donor: &str, recipient: &str) -> bool {
    let (Some((d_abo, d_rh)), Some((r_abo, r_rh))) =
        (parse_blood_type(donor), parse_blood_type(recipient))
    else {
        return false;
    };
    // Rh: a positive donor's cells are incompatible with a negative recipient.
    if d_rh && !r_rh {
        return false;
    }
    match d_abo {
        "O" => true,
        "A" => r_abo == "A" || r_abo == "AB",
        "B" => r_abo == "B" || r_abo == "AB",
        "AB" => r_abo == "AB",
        _ => false,
    }
}

/// Mean arterial pressure (mmHg) from systolic/diastolic: `(SBP + 2*DBP) / 3`.
///
/// Uses widened arithmetic so it can never overflow for any `u16` inputs
/// (Phase 12.2 — overflow prevention in clinical arithmetic).
pub fn mean_arterial_pressure(systolic: u16, diastolic: u16) -> u16 {
    ((systolic as u32 + 2 * diastolic as u32) / 3) as u16
}

impl VitalSignsReading {
    /// Calculate MAP if systolic and diastolic are available
    /// MAP = DBP + 1/3(SBP - DBP) or (SBP + 2*DBP) / 3
    pub fn calculate_map(&self) -> Option<u16> {
        match (self.systolic_bp, self.diastolic_bp) {
            (Some(sbp), Some(dbp)) => {
                let map = (sbp as f32 + 2.0 * dbp as f32) / 3.0;
                Some(map.round() as u16)
            }
            _ => None,
        }
    }

    /// Check if reading contains any critical values
    pub fn has_critical_values(&self) -> Vec<String> {
        let mut alerts = Vec::new();

        if let Some(hr) = self.heart_rate {
            if hr < 40 {
                alerts.push(format!("Bradycardia: HR {}", hr));
            }
            if hr > 150 {
                alerts.push(format!("Tachycardia: HR {}", hr));
            }
        }

        if let Some(rr) = self.respiratory_rate {
            if rr < 8 {
                alerts.push(format!("Bradypnea: RR {}", rr));
            }
            if rr > 30 {
                alerts.push(format!("Tachypnea: RR {}", rr));
            }
        }

        if let Some(sbp) = self.systolic_bp {
            if sbp < 90 {
                alerts.push(format!("Hypotension: SBP {}", sbp));
            }
            if sbp > 180 {
                alerts.push(format!("Hypertensive: SBP {}", sbp));
            }
        }

        if let Some(temp) = self.temperature_celsius {
            if temp < 35.0 {
                alerts.push(format!("Hypothermia: {} °C", temp));
            }
            if temp > 39.5 {
                alerts.push(format!("High fever: {} °C", temp));
            }
        }

        if let Some(spo2) = self.oxygen_saturation {
            if spo2 < 92 {
                alerts.push(format!("Hypoxia: SpO2 {}%", spo2));
            }
        }

        alerts
    }
}

/// Vital signs flowsheet containing multiple readings over time
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VitalSignsFlowsheet {
    /// Patient ID
    pub patient_id: String,
    /// All readings in chronological order
    pub readings: Vec<VitalSignsReading>,
}

impl VitalSignsFlowsheet {
    /// Add a reading
    pub fn add_reading(&mut self, reading: VitalSignsReading) {
        self.readings.push(reading);
        // Keep readings sorted by timestamp
        self.readings.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    }

    /// Get latest reading
    pub fn latest_reading(&self) -> Option<&VitalSignsReading> {
        self.readings.last()
    }

    /// Check if any reading has critical values
    pub fn has_any_critical_values(&self) -> bool {
        self.readings
            .iter()
            .any(|r| !r.has_critical_values().is_empty())
    }

    /// Get all critical alerts across all readings
    pub fn all_critical_alerts(&self) -> Vec<(i64, Vec<String>)> {
        self.readings
            .iter()
            .filter_map(|r| {
                let alerts = r.has_critical_values();
                if alerts.is_empty() {
                    None
                } else {
                    Some((r.timestamp, alerts))
                }
            })
            .collect()
    }
}

// ============================================================================
// LAB PANEL TEMPLATES
// ============================================================================

/// Predefined lab panel templates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabPanelTemplate {
    /// Template name
    pub name: String,
    /// Short code
    pub code: String,
    /// Description
    pub description: String,
    /// Tests included in this panel
    pub tests: Vec<LabTestTemplate>,
    /// Common indications for ordering
    pub indications: Vec<String>,
}

/// Individual lab test template with reference ranges
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabTestTemplate {
    /// Test name
    pub name: String,
    /// Test code (e.g., LOINC)
    pub code: Option<String>,
    /// Unit of measurement
    pub unit: String,
    /// Reference range for adult male
    pub reference_range_male: String,
    /// Reference range for adult female
    pub reference_range_female: String,
    /// Reference range for pediatric (if different)
    pub reference_range_pediatric: Option<String>,
    /// Critical low value
    pub critical_low: Option<f64>,
    /// Critical high value
    pub critical_high: Option<f64>,
}

/// Get standard lab panel templates
pub fn get_standard_lab_panels() -> Vec<LabPanelTemplate> {
    vec![
        // Complete Blood Count (CBC)
        LabPanelTemplate {
            name: "Complete Blood Count (CBC)".to_string(),
            code: "CBC".to_string(),
            description: "Measures red/white blood cells, hemoglobin, hematocrit, platelets"
                .to_string(),
            tests: vec![
                LabTestTemplate {
                    name: "Hemoglobin".to_string(),
                    code: Some("718-7".to_string()),
                    unit: "g/dL".to_string(),
                    reference_range_male: "13.5-17.5".to_string(),
                    reference_range_female: "12.0-16.0".to_string(),
                    reference_range_pediatric: Some("11.0-16.0".to_string()),
                    critical_low: Some(7.0),
                    critical_high: Some(20.0),
                },
                LabTestTemplate {
                    name: "Hematocrit".to_string(),
                    code: Some("4544-3".to_string()),
                    unit: "%".to_string(),
                    reference_range_male: "38.8-50.0".to_string(),
                    reference_range_female: "34.9-44.5".to_string(),
                    reference_range_pediatric: Some("36.0-44.0".to_string()),
                    critical_low: Some(20.0),
                    critical_high: Some(60.0),
                },
                LabTestTemplate {
                    name: "WBC Count".to_string(),
                    code: Some("6690-2".to_string()),
                    unit: "x10^9/L".to_string(),
                    reference_range_male: "4.5-11.0".to_string(),
                    reference_range_female: "4.5-11.0".to_string(),
                    reference_range_pediatric: Some("5.0-15.0".to_string()),
                    critical_low: Some(2.0),
                    critical_high: Some(30.0),
                },
                LabTestTemplate {
                    name: "Platelet Count".to_string(),
                    code: Some("777-3".to_string()),
                    unit: "x10^9/L".to_string(),
                    reference_range_male: "150-400".to_string(),
                    reference_range_female: "150-400".to_string(),
                    reference_range_pediatric: None,
                    critical_low: Some(50.0),
                    critical_high: Some(1000.0),
                },
            ],
            indications: vec![
                "Anemia workup".to_string(),
                "Infection evaluation".to_string(),
                "Bleeding disorders".to_string(),
                "Routine health screening".to_string(),
            ],
        },
        // Basic Metabolic Panel (BMP)
        LabPanelTemplate {
            name: "Basic Metabolic Panel (BMP)".to_string(),
            code: "BMP".to_string(),
            description: "Electrolytes, kidney function, glucose".to_string(),
            tests: vec![
                LabTestTemplate {
                    name: "Sodium".to_string(),
                    code: Some("2951-2".to_string()),
                    unit: "mEq/L".to_string(),
                    reference_range_male: "136-145".to_string(),
                    reference_range_female: "136-145".to_string(),
                    reference_range_pediatric: None,
                    critical_low: Some(120.0),
                    critical_high: Some(160.0),
                },
                LabTestTemplate {
                    name: "Potassium".to_string(),
                    code: Some("2823-3".to_string()),
                    unit: "mEq/L".to_string(),
                    reference_range_male: "3.5-5.0".to_string(),
                    reference_range_female: "3.5-5.0".to_string(),
                    reference_range_pediatric: None,
                    critical_low: Some(2.5),
                    critical_high: Some(6.5),
                },
                LabTestTemplate {
                    name: "Chloride".to_string(),
                    code: Some("2075-0".to_string()),
                    unit: "mEq/L".to_string(),
                    reference_range_male: "98-106".to_string(),
                    reference_range_female: "98-106".to_string(),
                    reference_range_pediatric: None,
                    critical_low: Some(80.0),
                    critical_high: Some(120.0),
                },
                LabTestTemplate {
                    name: "Bicarbonate (CO2)".to_string(),
                    code: Some("1963-8".to_string()),
                    unit: "mEq/L".to_string(),
                    reference_range_male: "22-29".to_string(),
                    reference_range_female: "22-29".to_string(),
                    reference_range_pediatric: None,
                    critical_low: Some(10.0),
                    critical_high: Some(40.0),
                },
                LabTestTemplate {
                    name: "BUN".to_string(),
                    code: Some("3094-0".to_string()),
                    unit: "mg/dL".to_string(),
                    reference_range_male: "7-20".to_string(),
                    reference_range_female: "7-20".to_string(),
                    reference_range_pediatric: Some("5-18".to_string()),
                    critical_low: None,
                    critical_high: Some(100.0),
                },
                LabTestTemplate {
                    name: "Creatinine".to_string(),
                    code: Some("2160-0".to_string()),
                    unit: "mg/dL".to_string(),
                    reference_range_male: "0.7-1.3".to_string(),
                    reference_range_female: "0.6-1.1".to_string(),
                    reference_range_pediatric: Some("0.3-0.7".to_string()),
                    critical_low: None,
                    critical_high: Some(10.0),
                },
                LabTestTemplate {
                    name: "Glucose".to_string(),
                    code: Some("2345-7".to_string()),
                    unit: "mg/dL".to_string(),
                    reference_range_male: "70-100 (fasting)".to_string(),
                    reference_range_female: "70-100 (fasting)".to_string(),
                    reference_range_pediatric: None,
                    critical_low: Some(40.0),
                    critical_high: Some(500.0),
                },
                LabTestTemplate {
                    name: "Calcium".to_string(),
                    code: Some("17861-6".to_string()),
                    unit: "mg/dL".to_string(),
                    reference_range_male: "8.5-10.5".to_string(),
                    reference_range_female: "8.5-10.5".to_string(),
                    reference_range_pediatric: Some("8.8-10.8".to_string()),
                    critical_low: Some(6.0),
                    critical_high: Some(13.0),
                },
            ],
            indications: vec![
                "Dehydration".to_string(),
                "Kidney function assessment".to_string(),
                "Electrolyte imbalance".to_string(),
                "Diabetes monitoring".to_string(),
            ],
        },
        // Liver Function Panel (LFT)
        LabPanelTemplate {
            name: "Liver Function Panel (LFT)".to_string(),
            code: "LFT".to_string(),
            description: "Liver enzymes, bilirubin, proteins".to_string(),
            tests: vec![
                LabTestTemplate {
                    name: "ALT (SGPT)".to_string(),
                    code: Some("1742-6".to_string()),
                    unit: "U/L".to_string(),
                    reference_range_male: "7-56".to_string(),
                    reference_range_female: "7-45".to_string(),
                    reference_range_pediatric: None,
                    critical_low: None,
                    critical_high: Some(1000.0),
                },
                LabTestTemplate {
                    name: "AST (SGOT)".to_string(),
                    code: Some("1920-8".to_string()),
                    unit: "U/L".to_string(),
                    reference_range_male: "10-40".to_string(),
                    reference_range_female: "9-32".to_string(),
                    reference_range_pediatric: None,
                    critical_low: None,
                    critical_high: Some(1000.0),
                },
                LabTestTemplate {
                    name: "Alkaline Phosphatase".to_string(),
                    code: Some("6768-6".to_string()),
                    unit: "U/L".to_string(),
                    reference_range_male: "44-147".to_string(),
                    reference_range_female: "44-147".to_string(),
                    reference_range_pediatric: Some("100-400 (varies by age)".to_string()),
                    critical_low: None,
                    critical_high: Some(1000.0),
                },
                LabTestTemplate {
                    name: "Total Bilirubin".to_string(),
                    code: Some("1975-2".to_string()),
                    unit: "mg/dL".to_string(),
                    reference_range_male: "0.1-1.2".to_string(),
                    reference_range_female: "0.1-1.2".to_string(),
                    reference_range_pediatric: None,
                    critical_low: None,
                    critical_high: Some(15.0),
                },
                LabTestTemplate {
                    name: "Albumin".to_string(),
                    code: Some("1751-7".to_string()),
                    unit: "g/dL".to_string(),
                    reference_range_male: "3.5-5.0".to_string(),
                    reference_range_female: "3.5-5.0".to_string(),
                    reference_range_pediatric: None,
                    critical_low: Some(1.5),
                    critical_high: None,
                },
                LabTestTemplate {
                    name: "Total Protein".to_string(),
                    code: Some("2885-2".to_string()),
                    unit: "g/dL".to_string(),
                    reference_range_male: "6.0-8.3".to_string(),
                    reference_range_female: "6.0-8.3".to_string(),
                    reference_range_pediatric: None,
                    critical_low: Some(3.0),
                    critical_high: Some(12.0),
                },
            ],
            indications: vec![
                "Liver disease evaluation".to_string(),
                "Medication monitoring".to_string(),
                "Jaundice workup".to_string(),
                "Hepatitis screening".to_string(),
            ],
        },
        // Lipid Panel
        LabPanelTemplate {
            name: "Lipid Panel".to_string(),
            code: "LIPID".to_string(),
            description: "Cholesterol, triglycerides, HDL, LDL".to_string(),
            tests: vec![
                LabTestTemplate {
                    name: "Total Cholesterol".to_string(),
                    code: Some("2093-3".to_string()),
                    unit: "mg/dL".to_string(),
                    reference_range_male: "<200 desirable".to_string(),
                    reference_range_female: "<200 desirable".to_string(),
                    reference_range_pediatric: Some("<170".to_string()),
                    critical_low: None,
                    critical_high: None,
                },
                LabTestTemplate {
                    name: "Triglycerides".to_string(),
                    code: Some("2571-8".to_string()),
                    unit: "mg/dL".to_string(),
                    reference_range_male: "<150".to_string(),
                    reference_range_female: "<150".to_string(),
                    reference_range_pediatric: None,
                    critical_low: None,
                    critical_high: Some(1000.0),
                },
                LabTestTemplate {
                    name: "HDL Cholesterol".to_string(),
                    code: Some("2085-9".to_string()),
                    unit: "mg/dL".to_string(),
                    reference_range_male: ">40".to_string(),
                    reference_range_female: ">50".to_string(),
                    reference_range_pediatric: Some(">45".to_string()),
                    critical_low: None,
                    critical_high: None,
                },
                LabTestTemplate {
                    name: "LDL Cholesterol".to_string(),
                    code: Some("18262-6".to_string()),
                    unit: "mg/dL".to_string(),
                    reference_range_male: "<100 optimal".to_string(),
                    reference_range_female: "<100 optimal".to_string(),
                    reference_range_pediatric: Some("<110".to_string()),
                    critical_low: None,
                    critical_high: None,
                },
            ],
            indications: vec![
                "Cardiovascular risk assessment".to_string(),
                "Diabetes monitoring".to_string(),
                "Statin therapy monitoring".to_string(),
                "Routine health screening".to_string(),
            ],
        },
        // Coagulation Panel
        LabPanelTemplate {
            name: "Coagulation Panel".to_string(),
            code: "COAG".to_string(),
            description: "PT, INR, PTT for bleeding/clotting disorders".to_string(),
            tests: vec![
                LabTestTemplate {
                    name: "Prothrombin Time (PT)".to_string(),
                    code: Some("5902-2".to_string()),
                    unit: "seconds".to_string(),
                    reference_range_male: "11-13.5".to_string(),
                    reference_range_female: "11-13.5".to_string(),
                    reference_range_pediatric: None,
                    critical_low: None,
                    critical_high: Some(50.0),
                },
                LabTestTemplate {
                    name: "INR".to_string(),
                    code: Some("6301-6".to_string()),
                    unit: "ratio".to_string(),
                    reference_range_male: "0.9-1.1 (2.0-3.0 on warfarin)".to_string(),
                    reference_range_female: "0.9-1.1 (2.0-3.0 on warfarin)".to_string(),
                    reference_range_pediatric: None,
                    critical_low: None,
                    critical_high: Some(5.0),
                },
                LabTestTemplate {
                    name: "aPTT".to_string(),
                    code: Some("3173-2".to_string()),
                    unit: "seconds".to_string(),
                    reference_range_male: "25-35".to_string(),
                    reference_range_female: "25-35".to_string(),
                    reference_range_pediatric: None,
                    critical_low: None,
                    critical_high: Some(100.0),
                },
            ],
            indications: vec![
                "Pre-surgical screening".to_string(),
                "Anticoagulant monitoring".to_string(),
                "Bleeding disorder workup".to_string(),
                "Liver disease assessment".to_string(),
            ],
        },
        // Thyroid Panel
        LabPanelTemplate {
            name: "Thyroid Panel".to_string(),
            code: "THYROID".to_string(),
            description: "TSH, T3, T4 for thyroid function".to_string(),
            tests: vec![
                LabTestTemplate {
                    name: "TSH".to_string(),
                    code: Some("3016-3".to_string()),
                    unit: "mIU/L".to_string(),
                    reference_range_male: "0.4-4.0".to_string(),
                    reference_range_female: "0.4-4.0".to_string(),
                    reference_range_pediatric: Some("0.7-6.4 (varies by age)".to_string()),
                    critical_low: Some(0.01),
                    critical_high: Some(50.0),
                },
                LabTestTemplate {
                    name: "Free T4".to_string(),
                    code: Some("3024-7".to_string()),
                    unit: "ng/dL".to_string(),
                    reference_range_male: "0.8-1.8".to_string(),
                    reference_range_female: "0.8-1.8".to_string(),
                    reference_range_pediatric: None,
                    critical_low: Some(0.2),
                    critical_high: Some(5.0),
                },
                LabTestTemplate {
                    name: "Free T3".to_string(),
                    code: Some("3053-6".to_string()),
                    unit: "pg/mL".to_string(),
                    reference_range_male: "2.3-4.2".to_string(),
                    reference_range_female: "2.3-4.2".to_string(),
                    reference_range_pediatric: None,
                    critical_low: None,
                    critical_high: None,
                },
            ],
            indications: vec![
                "Thyroid disorder screening".to_string(),
                "Fatigue evaluation".to_string(),
                "Weight changes".to_string(),
                "Medication monitoring".to_string(),
            ],
        },
    ]
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_esi_level_values() {
        assert_eq!(ESILevel::Level1Resuscitation.level(), 1);
        assert_eq!(ESILevel::Level5NonUrgent.level(), 5);
    }

    #[test]
    fn test_esi_level_from_level() {
        assert!(ESILevel::from_level(1).is_some());
        assert!(ESILevel::from_level(5).is_some());
        assert!(ESILevel::from_level(0).is_none());
        assert!(ESILevel::from_level(6).is_none());
    }

    #[test]
    fn test_gcs_score_calculation() {
        let gcs = GlasgowComaScale::new(
            "test-1".to_string(),
            "patient-1".to_string(),
            EyeResponse::Spontaneous,     // 4
            VerbalResponse::Oriented,     // 5
            MotorResponse::ObeysCommands, // 6
            None,
            None,
            "nurse-1".to_string(),
        );
        assert_eq!(gcs.total_score, 15);
        assert!(!gcs.is_comatose());
    }

    #[test]
    fn test_gcs_coma_detection() {
        let gcs = GlasgowComaScale::new(
            "test-2".to_string(),
            "patient-2".to_string(),
            EyeResponse::None,              // 1
            VerbalResponse::None,           // 1
            MotorResponse::AbnormalFlexion, // 3
            None,
            None,
            "nurse-1".to_string(),
        );
        assert_eq!(gcs.total_score, 5);
        assert!(gcs.is_comatose());
        assert!(gcs.needs_airway_protection());
    }

    #[test]
    fn test_vital_signs_critical_detection() {
        let reading = VitalSignsReading {
            reading_id: "vs-1".to_string(),
            timestamp: Utc::now().timestamp(),
            heart_rate: Some(30),  // Critical - bradycardia
            systolic_bp: Some(70), // Critical - hypotension
            diastolic_bp: Some(40),
            respiratory_rate: Some(15),
            oxygen_saturation: Some(85), // Critical - hypoxia
            temperature_celsius: Some(36.5),
            pain_scale: None,
            recorded_by: "nurse-1".to_string(),
            notes: None,
        };

        let alerts = reading.has_critical_values();
        assert_eq!(alerts.len(), 3);
    }

    #[test]
    fn test_map_calculation() {
        let reading = VitalSignsReading {
            reading_id: "vs-2".to_string(),
            timestamp: Utc::now().timestamp(),
            heart_rate: None,
            systolic_bp: Some(120),
            diastolic_bp: Some(80),
            respiratory_rate: None,
            oxygen_saturation: None,
            temperature_celsius: None,
            pain_scale: None,
            recorded_by: "nurse-1".to_string(),
            notes: None,
        };

        // MAP = (120 + 2*80) / 3 = 280 / 3 = 93.33 ≈ 93
        assert_eq!(reading.calculate_map(), Some(93));
    }

    #[test]
    fn test_lab_panels_available() {
        let panels = get_standard_lab_panels();
        assert!(!panels.is_empty());

        // Check CBC exists
        let cbc = panels.iter().find(|p| p.code == "CBC");
        assert!(cbc.is_some());

        // Check CBC has expected tests
        let cbc = cbc.unwrap();
        assert!(cbc.tests.iter().any(|t| t.name == "Hemoglobin"));
        assert!(cbc.tests.iter().any(|t| t.name == "WBC Count"));
    }
}

// ============================================================================
// PHASE 2: EMERGENCY PROTOCOLS
// ============================================================================
// Critical emergency documentation for life-threatening situations

// ----------------------------------------------------------------------------
// CODE BLUE / RESUSCITATION DOCUMENTATION
// ----------------------------------------------------------------------------

/// Code Blue Event - Cardiac/Respiratory Arrest Documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeBlueRecord {
    /// Unique event ID
    pub event_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Location where code was called
    pub location: String,
    /// Time code was called (Unix timestamp)
    pub code_called_at: i64,
    /// Time team arrived
    pub team_arrived_at: Option<i64>,
    /// Initial rhythm
    pub initial_rhythm: CardiacRhythm,
    /// Was patient witnessed?
    pub witnessed: bool,
    /// CPR started time
    pub cpr_started_at: Option<i64>,
    /// CPR quality metrics
    pub cpr_metrics: Option<CPRMetrics>,
    /// Defibrillation attempts
    pub defibrillations: Vec<DefibrillationAttempt>,
    /// Medications administered
    pub medications: Vec<CodeMedication>,
    /// Airway management
    pub airway_management: Option<AirwayManagement>,
    /// IV/IO access
    pub vascular_access: Vec<VascularAccess>,
    /// ROSC (Return of Spontaneous Circulation) time
    pub rosc_at: Option<i64>,
    /// Code end time
    pub code_ended_at: Option<i64>,
    /// Outcome
    pub outcome: CodeOutcome,
    /// Total code duration in minutes
    pub duration_minutes: Option<u32>,
    /// Team members present
    pub team_members: Vec<CodeTeamMember>,
    /// Code leader
    pub code_leader: String,
    /// Post-ROSC care initiated
    pub post_rosc_care: Option<PostROSCCare>,
    /// Family notified
    pub family_notified: bool,
    /// Family notification time
    pub family_notified_at: Option<i64>,
    /// Documentation completed by
    pub documented_by: String,
    /// Documentation time
    pub documented_at: i64,
}

/// Cardiac rhythm types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CardiacRhythm {
    /// Normal sinus rhythm
    NormalSinus,
    /// Ventricular fibrillation (shockable)
    VentricularFibrillation,
    /// Pulseless ventricular tachycardia (shockable)
    PulselessVT,
    /// Asystole (non-shockable)
    Asystole,
    /// Pulseless electrical activity (non-shockable)
    PEA,
    /// Bradycardia
    Bradycardia,
    /// Tachycardia
    Tachycardia,
    /// Atrial fibrillation
    AtrialFibrillation,
    /// Unknown
    Unknown,
}

impl CardiacRhythm {
    /// Is this a shockable rhythm?
    pub fn is_shockable(&self) -> bool {
        matches!(
            self,
            CardiacRhythm::VentricularFibrillation | CardiacRhythm::PulselessVT
        )
    }
}

/// CPR Quality Metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CPRMetrics {
    /// Compression rate (target: 100-120/min)
    pub compression_rate: Option<u16>,
    /// Compression depth (target: 5-6 cm for adults)
    pub compression_depth_cm: Option<f32>,
    /// Chest recoil adequate?
    pub adequate_recoil: bool,
    /// Compression fraction (% of time with compressions, target: >80%)
    pub compression_fraction_percent: Option<u8>,
    /// End-tidal CO2 (if available, target: >10 mmHg)
    pub etco2_mmhg: Option<u16>,
}

/// Defibrillation attempt record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefibrillationAttempt {
    /// Attempt number (1, 2, 3...)
    pub attempt_number: u8,
    /// Time of shock
    pub time: i64,
    /// Energy in Joules
    pub energy_joules: u16,
    /// Rhythm before shock
    pub pre_shock_rhythm: CardiacRhythm,
    /// Rhythm after shock
    pub post_shock_rhythm: CardiacRhythm,
    /// Successful (converted rhythm)?
    pub successful: bool,
}

/// Medication given during code
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeMedication {
    /// Medication name
    pub name: String,
    /// Dose
    pub dose: String,
    /// Route (IV, IO, ETT)
    pub route: String,
    /// Time administered
    pub time: i64,
    /// Given by
    pub given_by: String,
}

/// Airway management during code
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirwayManagement {
    /// Type of airway
    pub airway_type: AirwayType,
    /// Time secured
    pub secured_at: Option<i64>,
    /// ETT size (if intubated)
    pub ett_size: Option<f32>,
    /// ETT depth at teeth (cm)
    pub ett_depth_cm: Option<f32>,
    /// Confirmation method
    pub confirmation_method: String,
    /// Secured by
    pub secured_by: String,
    /// Attempts needed
    pub attempts: u8,
}

/// Airway type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AirwayType {
    /// Bag-valve-mask
    BVM,
    /// Supraglottic airway (LMA, King)
    SupraglotticAirway,
    /// Endotracheal intubation
    EndotrachealTube,
    /// Surgical airway (cricothyrotomy)
    SurgicalAirway,
}

/// Vascular access during code
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VascularAccess {
    /// Type (IV or IO)
    pub access_type: VascularAccessType,
    /// Location
    pub location: String,
    /// Gauge/size
    pub size: String,
    /// Time established
    pub established_at: i64,
    /// Established by
    pub established_by: String,
}

/// Vascular access type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum VascularAccessType {
    /// Peripheral IV
    PeripheralIV,
    /// Central line
    CentralLine,
    /// Intraosseous
    Intraosseous,
}

/// Code outcome
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CodeOutcome {
    /// Return of spontaneous circulation
    ROSC,
    /// Death - efforts terminated
    Death,
    /// Ongoing - transferred to cath lab, OR, etc.
    TransferredOngoing,
    /// Family requested termination
    FamilyRequestedTermination,
}

/// Code team member
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeTeamMember {
    /// Name/ID
    pub name: String,
    /// Role
    pub role: CodeTeamRole,
}

/// Code team roles
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CodeTeamRole {
    CodeLeader,
    Compressor,
    AirwayManager,
    MedicationNurse,
    Recorder,
    Runner,
    Other,
}

/// Post-ROSC care documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostROSCCare {
    /// Targeted temperature management initiated?
    pub ttm_initiated: bool,
    /// Target temperature
    pub target_temp_celsius: Option<f32>,
    /// 12-lead ECG obtained?
    pub ecg_obtained: bool,
    /// Cath lab activation?
    pub cath_lab_activated: bool,
    /// Vasopressors required?
    pub vasopressors: Vec<String>,
    /// Disposition (ICU, Cath lab, etc.)
    pub disposition: String,
}

// ----------------------------------------------------------------------------
// TRAUMA ASSESSMENT
// ----------------------------------------------------------------------------

/// Primary Trauma Survey (ABCDE)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraumaAssessment {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Mechanism of injury
    pub mechanism: TraumaMechanism,
    /// Mechanism details
    pub mechanism_details: String,
    /// Time of injury (if known)
    pub injury_time: Option<i64>,
    /// Primary survey (ABCDE)
    pub primary_survey: PrimarySurvey,
    /// Secondary survey
    pub secondary_survey: Option<SecondarySurvey>,
    /// Trauma score
    pub trauma_score: Option<TraumaScore>,
    /// GCS at arrival
    pub gcs: u8,
    /// Injuries identified
    pub injuries: Vec<TraumaInjury>,
    /// Photos taken?
    pub photos_documented: bool,
    /// Photo references
    pub photo_references: Vec<String>,
    /// Blood products given
    pub blood_products: Vec<BloodProduct>,
    /// Massive transfusion protocol activated?
    pub mtp_activated: bool,
    /// Trauma team activated?
    pub trauma_team_activated: bool,
    /// Trauma team activation time
    pub trauma_activation_time: Option<i64>,
    /// Level of trauma activation (1, 2, etc.)
    pub trauma_level: Option<u8>,
    /// Disposition
    pub disposition: TraumaDisposition,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time
    pub assessed_at: i64,
}

/// Trauma mechanism
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TraumaMechanism {
    /// Motor vehicle collision
    MVC,
    /// Motorcycle collision
    Motorcycle,
    /// Pedestrian struck
    PedestrianStruck,
    /// Fall
    Fall,
    /// Penetrating - gunshot
    Gunshot,
    /// Penetrating - stabbing
    Stabbing,
    /// Assault/blunt
    Assault,
    /// Burns
    Burns,
    /// Industrial accident
    Industrial,
    /// Sports injury
    Sports,
    /// Other
    Other,
}

/// Primary survey (ABCDE)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimarySurvey {
    /// A - Airway
    pub airway: AirwayAssessment,
    /// B - Breathing
    pub breathing: BreathingAssessment,
    /// C - Circulation
    pub circulation: CirculationAssessment,
    /// D - Disability (neuro)
    pub disability: DisabilityAssessment,
    /// E - Exposure
    pub exposure: ExposureAssessment,
}

/// Airway assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirwayAssessment {
    /// Airway patent?
    pub patent: bool,
    /// Obstruction present?
    pub obstruction: bool,
    /// Intervention required
    pub intervention: Option<String>,
    /// C-spine immobilization in place?
    pub cspine_immobilized: bool,
}

/// Breathing assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreathingAssessment {
    /// Respiratory rate
    pub respiratory_rate: u16,
    /// Breath sounds equal bilaterally?
    pub breath_sounds_equal: bool,
    /// Chest wall intact?
    pub chest_wall_intact: bool,
    /// Trachea midline?
    pub trachea_midline: bool,
    /// SpO2
    pub spo2: Option<u8>,
    /// Oxygen supplementation
    pub oxygen_supplementation: Option<String>,
    /// Interventions (chest tube, etc.)
    pub interventions: Vec<String>,
}

/// Circulation assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CirculationAssessment {
    /// Heart rate
    pub heart_rate: u16,
    /// Blood pressure
    pub systolic_bp: Option<u16>,
    pub diastolic_bp: Option<u16>,
    /// Skin color (pink, pale, cyanotic)
    pub skin_color: String,
    /// Skin temperature (warm, cool, cold)
    pub skin_temperature: String,
    /// Capillary refill (seconds)
    pub capillary_refill_sec: Option<u8>,
    /// Active bleeding?
    pub active_bleeding: bool,
    /// Bleeding sites
    pub bleeding_sites: Vec<String>,
    /// IV access
    pub iv_access: Vec<String>,
    /// Fluid resuscitation
    pub fluid_resuscitation: Option<String>,
}

/// Disability/Neuro assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisabilityAssessment {
    /// GCS total
    pub gcs_total: u8,
    /// GCS Eye
    pub gcs_eye: u8,
    /// GCS Verbal
    pub gcs_verbal: u8,
    /// GCS Motor
    pub gcs_motor: u8,
    /// Pupils equal and reactive?
    pub pupils_equal_reactive: bool,
    /// Left pupil size (mm)
    pub left_pupil_mm: Option<f32>,
    /// Right pupil size (mm)
    pub right_pupil_mm: Option<f32>,
    /// Motor function all extremities
    pub motor_function: String,
    /// Sensory function
    pub sensory_function: String,
}

/// Exposure assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExposureAssessment {
    /// Patient fully exposed?
    pub fully_exposed: bool,
    /// Temperature
    pub temperature_celsius: Option<f32>,
    /// Hypothermia prevention measures
    pub warming_measures: Vec<String>,
    /// Additional injuries found on log roll
    pub posterior_injuries: Vec<String>,
}

/// Secondary survey findings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecondarySurvey {
    /// Head exam
    pub head: String,
    /// Face exam
    pub face: String,
    /// Neck exam
    pub neck: String,
    /// Chest exam
    pub chest: String,
    /// Abdomen exam
    pub abdomen: String,
    /// Pelvis exam
    pub pelvis: String,
    /// Extremities exam
    pub extremities: String,
    /// Back/spine exam
    pub back: String,
    /// Neuro exam detailed
    pub neuro: String,
}

/// Trauma scoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraumaScore {
    /// Revised Trauma Score (RTS)
    pub rts: Option<f32>,
    /// Injury Severity Score (ISS)
    pub iss: Option<u8>,
    /// Probability of survival
    pub probability_survival: Option<f32>,
}

/// Individual trauma injury
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraumaInjury {
    /// Body region (AIS body regions)
    pub body_region: String,
    /// Injury description
    pub description: String,
    /// AIS severity (1-6)
    pub ais_severity: Option<u8>,
    /// Laterality (left, right, bilateral)
    pub laterality: Option<String>,
}

/// Blood product transfusion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BloodProduct {
    /// Product type
    pub product_type: BloodProductType,
    /// Units
    pub units: u8,
    /// Time started
    pub started_at: i64,
    /// Blood type
    pub blood_type: Option<String>,
}

/// Blood product types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BloodProductType {
    PackedRBC,
    FFP,
    Platelets,
    Cryoprecipitate,
    WholeBlood,
}

/// Trauma disposition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TraumaDisposition {
    OperatingRoom,
    TraumaICU,
    Interventional,
    StepdownUnit,
    ObservationUnit,
    Discharge,
    TransferOut,
    Morgue,
}

// ----------------------------------------------------------------------------
// STROKE ASSESSMENT (NIH STROKE SCALE)
// ----------------------------------------------------------------------------

/// Stroke Assessment with NIH Stroke Scale
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrokeAssessment {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Last known well time (critical for tPA)
    pub last_known_well: i64,
    /// Symptom onset time
    pub symptom_onset: Option<i64>,
    /// Door time (arrival)
    pub door_time: i64,
    /// CT time
    pub ct_time: Option<i64>,
    /// Door to CT minutes
    pub door_to_ct_minutes: Option<u32>,
    /// NIH Stroke Scale
    pub nihss: NIHStrokeScale,
    /// Total NIHSS score
    pub nihss_total: u8,
    /// CT findings
    pub ct_findings: String,
    /// Hemorrhage on CT?
    pub hemorrhage: bool,
    /// Large vessel occlusion suspected?
    pub lvo_suspected: bool,
    /// tPA eligible?
    pub tpa_eligible: bool,
    /// tPA contraindications
    pub tpa_contraindications: Vec<String>,
    /// tPA given?
    pub tpa_given: bool,
    /// tPA time
    pub tpa_time: Option<i64>,
    /// Door to needle time (minutes)
    pub door_to_needle_minutes: Option<u32>,
    /// Thrombectomy candidate?
    pub thrombectomy_candidate: bool,
    /// Neuro IR activated?
    pub neuro_ir_activated: bool,
    /// Blood pressure management
    pub bp_management: String,
    /// Stroke type
    pub stroke_type: StrokeType,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time
    pub assessed_at: i64,
}

/// NIH Stroke Scale components
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NIHStrokeScale {
    /// 1a. Level of consciousness (0-3)
    pub loc: u8,
    /// 1b. LOC questions (0-2)
    pub loc_questions: u8,
    /// 1c. LOC commands (0-2)
    pub loc_commands: u8,
    /// 2. Best gaze (0-2)
    pub best_gaze: u8,
    /// 3. Visual fields (0-3)
    pub visual_fields: u8,
    /// 4. Facial palsy (0-3)
    pub facial_palsy: u8,
    /// 5a. Motor arm left (0-4)
    pub motor_arm_left: u8,
    /// 5b. Motor arm right (0-4)
    pub motor_arm_right: u8,
    /// 6a. Motor leg left (0-4)
    pub motor_leg_left: u8,
    /// 6b. Motor leg right (0-4)
    pub motor_leg_right: u8,
    /// 7. Limb ataxia (0-2)
    pub limb_ataxia: u8,
    /// 8. Sensory (0-2)
    pub sensory: u8,
    /// 9. Best language (0-3)
    pub best_language: u8,
    /// 10. Dysarthria (0-2)
    pub dysarthria: u8,
    /// 11. Extinction/inattention (0-2)
    pub extinction: u8,
}

impl NIHStrokeScale {
    /// Calculate total NIHSS score
    pub fn total_score(&self) -> u8 {
        self.loc
            + self.loc_questions
            + self.loc_commands
            + self.best_gaze
            + self.visual_fields
            + self.facial_palsy
            + self.motor_arm_left
            + self.motor_arm_right
            + self.motor_leg_left
            + self.motor_leg_right
            + self.limb_ataxia
            + self.sensory
            + self.best_language
            + self.dysarthria
            + self.extinction
    }

    /// Interpret stroke severity
    pub fn interpret_severity(&self) -> &'static str {
        match self.total_score() {
            0 => "No stroke symptoms",
            1..=4 => "Minor stroke",
            5..=15 => "Moderate stroke",
            16..=20 => "Moderate to severe stroke",
            21..=42 => "Severe stroke",
            _ => "Invalid score",
        }
    }
}

/// Stroke type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum StrokeType {
    /// Ischemic stroke
    Ischemic,
    /// Hemorrhagic - intracerebral
    HemorrhagicICH,
    /// Hemorrhagic - subarachnoid
    HemorrhagicSAH,
    /// Transient ischemic attack
    TIA,
    /// Stroke mimic
    Mimic,
    /// Unknown/undetermined
    Unknown,
}

// ----------------------------------------------------------------------------
// CARDIAC EVENT DOCUMENTATION
// ----------------------------------------------------------------------------

/// Acute Cardiac Event Documentation (STEMI, NSTEMI, Unstable Angina)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardiacEvent {
    /// Event ID
    pub event_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Chief complaint
    pub chief_complaint: String,
    /// Symptom onset time
    pub symptom_onset: Option<i64>,
    /// Door time
    pub door_time: i64,
    /// First ECG time
    pub first_ecg_time: Option<i64>,
    /// Door to ECG minutes
    pub door_to_ecg_minutes: Option<u32>,
    /// ECG findings
    pub ecg_findings: ECGFindings,
    /// Cardiac biomarkers
    pub biomarkers: CardiacBiomarkers,
    /// Event type
    pub event_type: CardiacEventType,
    /// TIMI risk score
    pub timi_score: Option<u8>,
    /// HEART score
    pub heart_score: Option<u8>,
    /// Cath lab activated?
    pub cath_lab_activated: bool,
    /// Cath lab activation time
    pub cath_lab_activation_time: Option<i64>,
    /// PCI performed?
    pub pci_performed: bool,
    /// Door to balloon time (minutes)
    pub door_to_balloon_minutes: Option<u32>,
    /// Culprit vessel
    pub culprit_vessel: Option<String>,
    /// Interventions performed
    pub interventions: Vec<String>,
    /// Antiplatelet therapy
    pub antiplatelet_therapy: Vec<String>,
    /// Anticoagulation
    pub anticoagulation: Option<String>,
    /// Complications
    pub complications: Vec<String>,
    /// Disposition
    pub disposition: String,
    /// Documented by
    pub documented_by: String,
    /// Documentation time
    pub documented_at: i64,
}

/// ECG findings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ECGFindings {
    /// Rate
    pub rate: u16,
    /// Rhythm
    pub rhythm: String,
    /// ST elevation leads
    pub st_elevation_leads: Vec<String>,
    /// ST depression leads
    pub st_depression_leads: Vec<String>,
    /// T wave inversions
    pub t_wave_inversions: Vec<String>,
    /// Q waves
    pub q_waves: Vec<String>,
    /// Bundle branch block
    pub bundle_branch_block: Option<String>,
    /// Other findings
    pub other_findings: Vec<String>,
    /// Interpretation
    pub interpretation: String,
}

/// Cardiac biomarkers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardiacBiomarkers {
    /// Initial troponin
    pub troponin_initial: Option<f32>,
    /// Troponin peak
    pub troponin_peak: Option<f32>,
    /// Troponin unit (ng/mL, pg/mL)
    pub troponin_unit: String,
    /// Troponin type (I, T, high-sensitivity)
    pub troponin_type: String,
    /// BNP/NT-proBNP
    pub bnp: Option<f32>,
    /// BNP unit
    pub bnp_unit: Option<String>,
}

/// Cardiac event type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CardiacEventType {
    /// ST-elevation MI
    STEMI,
    /// Non-ST-elevation MI
    NSTEMI,
    /// Unstable angina
    UnstableAngina,
    /// Stable angina
    StableAngina,
    /// Demand ischemia (Type 2 MI)
    DemandIschemia,
    /// Non-cardiac chest pain
    NonCardiac,
}

// ----------------------------------------------------------------------------
// SEPSIS PROTOCOL
// ----------------------------------------------------------------------------

/// Sepsis Assessment and Bundle Compliance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SepsisAssessment {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Suspected source of infection
    pub suspected_source: String,
    /// Time sepsis identified
    pub sepsis_identified_at: i64,
    /// SIRS criteria met
    pub sirs_criteria: SIRSCriteria,
    /// qSOFA score
    pub qsofa: QSofaScore,
    /// SOFA score (if available)
    pub sofa_score: Option<u8>,
    /// Sepsis severity
    pub severity: SepsisSeverity,
    /// Lactate levels
    pub lactate_levels: Vec<LactateReading>,
    /// Hour-1 bundle compliance
    pub hour_1_bundle: SepsisBundle,
    /// Hour-3 bundle compliance
    pub hour_3_bundle: Option<SepsisBundle3>,
    /// Blood cultures obtained before antibiotics?
    pub cultures_before_abx: bool,
    /// Antibiotics given
    pub antibiotics: Vec<AntibioticDose>,
    /// Time to first antibiotic (minutes from sepsis ID)
    pub time_to_antibiotics_minutes: Option<u32>,
    /// Fluid resuscitation
    pub fluid_resuscitation: FluidResuscitation,
    /// Vasopressors required?
    pub vasopressors_required: bool,
    /// Vasopressors used
    pub vasopressors: Vec<String>,
    /// ICU admission required?
    pub icu_admission: bool,
    /// Outcome
    pub outcome: Option<String>,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time
    pub assessed_at: i64,
}

/// SIRS criteria (need 2+ for SIRS)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SIRSCriteria {
    /// Temperature >38°C or <36°C
    pub temp_abnormal: bool,
    /// Heart rate >90
    pub hr_elevated: bool,
    /// Respiratory rate >20 or PaCO2 <32
    pub rr_elevated: bool,
    /// WBC >12,000 or <4,000 or >10% bands
    pub wbc_abnormal: bool,
}

impl SIRSCriteria {
    /// Count how many SIRS criteria are met
    pub fn count(&self) -> u8 {
        let mut count = 0;
        if self.temp_abnormal {
            count += 1;
        }
        if self.hr_elevated {
            count += 1;
        }
        if self.rr_elevated {
            count += 1;
        }
        if self.wbc_abnormal {
            count += 1;
        }
        count
    }

    /// SIRS positive if 2+ criteria
    pub fn is_positive(&self) -> bool {
        self.count() >= 2
    }
}

/// qSOFA score (bedside sepsis screening)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QSofaScore {
    /// Respiratory rate ≥22
    pub rr_22_or_more: bool,
    /// Altered mental status (GCS <15)
    pub altered_mental_status: bool,
    /// Systolic BP ≤100
    pub sbp_100_or_less: bool,
}

impl QSofaScore {
    /// Calculate qSOFA score (0-3)
    pub fn score(&self) -> u8 {
        let mut score = 0;
        if self.rr_22_or_more {
            score += 1;
        }
        if self.altered_mental_status {
            score += 1;
        }
        if self.sbp_100_or_less {
            score += 1;
        }
        score
    }

    /// High risk if qSOFA ≥2
    pub fn is_high_risk(&self) -> bool {
        self.score() >= 2
    }
}

/// Sepsis severity levels
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SepsisSeverity {
    /// Sepsis (infection + organ dysfunction)
    Sepsis,
    /// Septic shock (sepsis + vasopressors + lactate >2)
    SepticShock,
    /// SIRS only (no organ dysfunction)
    SIRSOnly,
}

/// Lactate reading
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LactateReading {
    /// Value in mmol/L
    pub value_mmol: f32,
    /// Time of reading
    pub time: i64,
    /// Source (arterial, venous)
    pub source: String,
}

/// Hour-1 sepsis bundle
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SepsisBundle {
    /// Lactate measured?
    pub lactate_measured: bool,
    /// Lactate time
    pub lactate_time: Option<i64>,
    /// Blood cultures obtained?
    pub blood_cultures_obtained: bool,
    /// Cultures time
    pub cultures_time: Option<i64>,
    /// Broad-spectrum antibiotics given?
    pub antibiotics_given: bool,
    /// Antibiotics time
    pub antibiotics_time: Option<i64>,
    /// Fluid resuscitation started (if hypotensive/lactate≥4)?
    pub fluids_started: bool,
    /// Fluids start time
    pub fluids_time: Option<i64>,
    /// Vasopressors started if needed?
    pub vasopressors_if_needed: bool,
}

impl SepsisBundle {
    /// Check if Hour-1 bundle is complete
    pub fn is_complete(&self) -> bool {
        self.lactate_measured && self.blood_cultures_obtained && self.antibiotics_given
    }
}

/// Hour-3 sepsis bundle (for severe sepsis)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SepsisBundle3 {
    /// Repeat lactate if initial >2
    pub repeat_lactate: bool,
    /// 30 mL/kg crystalloid completed?
    pub fluid_bolus_complete: bool,
}

/// Antibiotic dose record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AntibioticDose {
    /// Antibiotic name
    pub name: String,
    /// Dose
    pub dose: String,
    /// Route
    pub route: String,
    /// Time given
    pub time: i64,
}

/// Fluid resuscitation tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FluidResuscitation {
    /// Fluid type
    pub fluid_type: String,
    /// Total volume given (mL)
    pub total_volume_ml: u32,
    /// Target (30 mL/kg for sepsis)
    pub target_ml_per_kg: Option<f32>,
    /// Patient weight (kg)
    pub weight_kg: Option<f32>,
    /// Target volume (mL)
    pub target_volume_ml: Option<u32>,
    /// Start time
    pub start_time: i64,
    /// Completion time
    pub completion_time: Option<i64>,
    /// Response (BP improved, urine output, etc.)
    pub response: Option<String>,
}

// ----------------------------------------------------------------------------
// EMS/PARAMEDIC HANDOFF
// ----------------------------------------------------------------------------

/// EMS Handoff Report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EMSHandoff {
    /// Report ID
    pub report_id: String,
    /// Patient ID (assigned at hospital)
    pub patient_id: Option<String>,
    /// EMS unit number
    pub unit_number: String,
    /// Crew members
    pub crew: Vec<String>,
    /// Dispatch time
    pub dispatch_time: i64,
    /// On scene time
    pub on_scene_time: i64,
    /// Depart scene time
    pub depart_scene_time: i64,
    /// Arrival time at hospital
    pub arrival_time: i64,
    /// Transport time (minutes)
    pub transport_minutes: u32,
    /// Scene location
    pub scene_location: String,
    /// Dispatch reason
    pub dispatch_reason: String,
    /// Patient demographics (as known)
    pub demographics: EMSPatientInfo,
    /// Chief complaint
    pub chief_complaint: String,
    /// Mechanism of injury (if trauma)
    pub mechanism: Option<String>,
    /// SAMPLE history collected
    pub sample_history: Option<EMSSampleHistory>,
    /// Vital signs (serial)
    pub vital_signs: Vec<EMSVitalSigns>,
    /// Glasgow Coma Scale
    pub gcs: Option<u8>,
    /// Interventions performed
    pub interventions: Vec<EMSIntervention>,
    /// Medications given
    pub medications: Vec<EMSMedication>,
    /// IV access established
    pub iv_access: Vec<String>,
    /// ECG rhythm
    pub ecg_rhythm: Option<String>,
    /// 12-lead ECG transmitted?
    pub twelve_lead_transmitted: bool,
    /// Stroke alert called?
    pub stroke_alert: bool,
    /// STEMI alert called?
    pub stemi_alert: bool,
    /// Trauma alert called?
    pub trauma_alert: bool,
    /// Trauma alert level
    pub trauma_level: Option<u8>,
    /// Receiving physician
    pub receiving_physician: Option<String>,
    /// Handoff time
    pub handoff_time: i64,
    /// Additional notes
    pub notes: Option<String>,
}

/// EMS patient info (limited)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EMSPatientInfo {
    /// Name (if known)
    pub name: Option<String>,
    /// Age (estimated if unknown)
    pub age: Option<u8>,
    /// Age is estimated?
    pub age_estimated: bool,
    /// Sex
    pub sex: Option<String>,
    /// Weight estimate (kg)
    pub weight_kg: Option<f32>,
}

/// EMS SAMPLE history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EMSSampleHistory {
    /// Signs & symptoms
    pub signs_symptoms: String,
    /// Allergies
    pub allergies: String,
    /// Medications
    pub medications: String,
    /// Past medical history
    pub past_history: String,
    /// Last oral intake
    pub last_intake: String,
    /// Events leading
    pub events: String,
}

/// EMS vital signs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EMSVitalSigns {
    /// Time of reading
    pub time: i64,
    /// Blood pressure
    pub bp: Option<String>,
    /// Heart rate
    pub hr: Option<u16>,
    /// Respiratory rate
    pub rr: Option<u16>,
    /// SpO2
    pub spo2: Option<u8>,
    /// Temperature
    pub temp_f: Option<f32>,
    /// Blood glucose
    pub glucose: Option<u16>,
    /// Pain scale
    pub pain: Option<u8>,
    /// GCS
    pub gcs: Option<u8>,
}

/// EMS intervention
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EMSIntervention {
    /// Intervention name
    pub intervention: String,
    /// Time performed
    pub time: i64,
    /// Success/notes
    pub notes: Option<String>,
}

/// EMS medication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EMSMedication {
    /// Medication name
    pub name: String,
    /// Dose
    pub dose: String,
    /// Route
    pub route: String,
    /// Time given
    pub time: i64,
    /// Response
    pub response: Option<String>,
}

// ============================================================================
// PHASE 3: NURSING DOCUMENTATION
// ============================================================================
// Comprehensive nursing documentation for patient care

// ----------------------------------------------------------------------------
// MEDICATION ADMINISTRATION RECORD (MAR)
// ----------------------------------------------------------------------------

/// Medication Administration Record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MedicationAdministrationRecord {
    /// Patient ID
    pub patient_id: String,
    /// Date of MAR
    pub date: String,
    /// Scheduled medications
    pub scheduled_medications: Vec<ScheduledMedication>,
    /// PRN medications
    pub prn_medications: Vec<PRNMedication>,
    /// Continuous infusions
    pub infusions: Vec<ContinuousInfusion>,
}

/// Scheduled medication entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledMedication {
    /// Medication ID
    pub medication_id: String,
    /// Medication name
    pub name: String,
    /// Dose
    pub dose: String,
    /// Route
    pub route: MedicationRoute,
    /// Frequency
    pub frequency: String,
    /// Scheduled times
    pub scheduled_times: Vec<String>,
    /// Administration records
    pub administrations: Vec<MedicationAdministration>,
    /// Special instructions
    pub instructions: Option<String>,
    /// Allergies checked?
    pub allergies_verified: bool,
}

/// PRN (as needed) medication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PRNMedication {
    /// Medication ID
    pub medication_id: String,
    /// Medication name
    pub name: String,
    /// Dose
    pub dose: String,
    /// Route
    pub route: MedicationRoute,
    /// Indication (when to give)
    pub indication: String,
    /// Minimum interval between doses
    pub min_interval_hours: Option<f32>,
    /// Maximum doses in 24 hours
    pub max_doses_24h: Option<u8>,
    /// Administration records
    pub administrations: Vec<PRNAdministration>,
}

/// Continuous infusion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinuousInfusion {
    /// Infusion ID
    pub infusion_id: String,
    /// Medication name
    pub name: String,
    /// Concentration
    pub concentration: String,
    /// Current rate
    pub rate: String,
    /// Start time
    pub start_time: i64,
    /// Rate changes
    pub rate_changes: Vec<InfusionRateChange>,
    /// IV site
    pub iv_site: String,
    /// Titration parameters (if applicable)
    pub titration_params: Option<TitrationParams>,
}

/// Medication administration record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MedicationAdministration {
    /// Scheduled time
    pub scheduled_time: String,
    /// Actual time given
    pub actual_time: Option<i64>,
    /// Status
    pub status: MedicationStatus,
    /// Reason if not given
    pub reason_not_given: Option<String>,
    /// Site (for injections)
    pub site: Option<String>,
    /// Given by
    pub given_by: Option<String>,
    /// Witnessed by (for high-risk meds)
    pub witnessed_by: Option<String>,
    /// Notes
    pub notes: Option<String>,
}

/// PRN administration with effectiveness
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PRNAdministration {
    /// Time given
    pub time_given: i64,
    /// Indication at time of administration
    pub indication_at_time: String,
    /// Assessment before (e.g., pain scale)
    pub assessment_before: Option<String>,
    /// Assessment after
    pub assessment_after: Option<String>,
    /// Time of reassessment
    pub reassessment_time: Option<i64>,
    /// Effective?
    pub effective: Option<bool>,
    /// Given by
    pub given_by: String,
    /// Notes
    pub notes: Option<String>,
}

/// Medication route
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MedicationRoute {
    Oral,
    Sublingual,
    IV,
    IM,
    Subcutaneous,
    Topical,
    Ophthalmic,
    Otic,
    Nasal,
    Inhaled,
    Rectal,
    Transdermal,
    Enteral,
    Other,
}

/// Medication status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MedicationStatus {
    Given,
    Held,
    Refused,
    NotAvailable,
    NPO,
    PatientAsleep,
    OffUnit,
    Discontinued,
}

/// Infusion rate change
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InfusionRateChange {
    /// Time of change
    pub time: i64,
    /// Previous rate
    pub previous_rate: String,
    /// New rate
    pub new_rate: String,
    /// Reason for change
    pub reason: String,
    /// Changed by
    pub changed_by: String,
}

/// Titration parameters for drips
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TitrationParams {
    /// Parameter to titrate to (e.g., "MAP", "SBP", "Heart rate")
    pub target_parameter: String,
    /// Target range
    pub target_range: String,
    /// Titration instructions
    pub instructions: String,
}

// ----------------------------------------------------------------------------
// INTAKE & OUTPUT (I/O) CHART
// ----------------------------------------------------------------------------

/// Intake and Output record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntakeOutputRecord {
    /// Patient ID
    pub patient_id: String,
    /// Date
    pub date: String,
    /// Shift (day, evening, night)
    pub shift: String,
    /// Intake entries
    pub intake: Vec<IntakeEntry>,
    /// Output entries
    pub output: Vec<OutputEntry>,
    /// Running totals
    pub totals: IOTotals,
    /// Fluid restriction (if any)
    pub fluid_restriction_ml: Option<u32>,
    /// Target output (if any)
    pub target_output_ml: Option<u32>,
    /// Documented by
    pub documented_by: String,
}

/// Intake entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntakeEntry {
    /// Time
    pub time: i64,
    /// Type
    pub intake_type: IntakeType,
    /// Description
    pub description: String,
    /// Amount (mL)
    pub amount_ml: u32,
    /// IV infusion? (for continuous tracking)
    pub is_infusion: bool,
    /// Recorded by
    pub recorded_by: String,
}

/// Intake type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum IntakeType {
    Oral,
    IVFluid,
    IVMedication,
    BloodProduct,
    TubeFeeding,
    TPN,
    IVPush,
    Other,
}

/// Output entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputEntry {
    /// Time
    pub time: i64,
    /// Type
    pub output_type: OutputType,
    /// Description
    pub description: Option<String>,
    /// Amount (mL)
    pub amount_ml: u32,
    /// Characteristics (color, clarity, etc.)
    pub characteristics: Option<String>,
    /// Recorded by
    pub recorded_by: String,
}

/// Output type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum OutputType {
    Urine,
    Stool,
    Emesis,
    NGTube,
    ChestTube,
    JPDrain,
    WoundDrainage,
    Ostomy,
    Blood,
    Other,
}

/// I/O totals
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IOTotals {
    /// Total intake (mL)
    pub total_intake_ml: u32,
    /// Oral intake
    pub oral_intake_ml: u32,
    /// IV intake
    pub iv_intake_ml: u32,
    /// Total output (mL)
    pub total_output_ml: u32,
    /// Urine output
    pub urine_output_ml: u32,
    /// Other output
    pub other_output_ml: u32,
    /// Net balance (intake - output)
    pub net_balance_ml: i32,
    /// 24-hour urine output (for renal monitoring)
    pub urine_24h_ml: Option<u32>,
}

// ----------------------------------------------------------------------------
// NURSING CARE PLAN
// ----------------------------------------------------------------------------

/// Nursing Care Plan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NursingCarePlan {
    /// Care plan ID
    pub care_plan_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Admission date
    pub admission_date: String,
    /// Primary diagnoses
    pub nursing_diagnoses: Vec<NursingDiagnosis>,
    /// Goals
    pub goals: Vec<CareGoal>,
    /// Interventions
    pub interventions: Vec<CareIntervention>,
    /// Education needs
    pub education_needs: Vec<PatientEducation>,
    /// Discharge planning
    pub discharge_planning: DischargePlanning,
    /// Created by
    pub created_by: String,
    /// Created at
    pub created_at: i64,
    /// Last updated by
    pub updated_by: String,
    /// Last updated at
    pub updated_at: i64,
}

/// Nursing diagnosis (NANDA format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NursingDiagnosis {
    /// Diagnosis ID
    pub id: String,
    /// Diagnosis statement (Problem)
    pub diagnosis: String,
    /// Related to (Etiology)
    pub related_to: String,
    /// As evidenced by (Signs/Symptoms)
    pub as_evidenced_by: Vec<String>,
    /// Priority (1 = highest)
    pub priority: u8,
    /// Status
    pub status: DiagnosisStatus,
    /// Date identified
    pub identified_date: String,
    /// Date resolved (if resolved)
    pub resolved_date: Option<String>,
}

/// Diagnosis status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DiagnosisStatus {
    Active,
    Resolved,
    Improved,
    Unchanged,
    Worsened,
}

/// Care goal
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CareGoal {
    /// Goal ID
    pub id: String,
    /// Related diagnosis ID
    pub diagnosis_id: String,
    /// Goal statement (SMART format)
    pub goal: String,
    /// Target date
    pub target_date: String,
    /// Outcome criteria (measurable indicators)
    pub outcome_criteria: Vec<String>,
    /// Status
    pub status: GoalStatus,
    /// Evaluation notes
    pub evaluation: Option<String>,
}

/// Goal status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum GoalStatus {
    NotMet,
    PartiallyMet,
    Met,
    Ongoing,
    Discontinued,
}

/// Care intervention
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CareIntervention {
    /// Intervention ID
    pub id: String,
    /// Related goal ID
    pub goal_id: String,
    /// Intervention description
    pub intervention: String,
    /// Frequency
    pub frequency: String,
    /// Implementation records
    pub implementations: Vec<InterventionImplementation>,
}

/// Intervention implementation record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterventionImplementation {
    /// Date/time performed
    pub performed_at: i64,
    /// Performed by
    pub performed_by: String,
    /// Patient response
    pub patient_response: String,
    /// Notes
    pub notes: Option<String>,
}

/// Patient education
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientEducation {
    /// Topic
    pub topic: String,
    /// Teaching method
    pub method: String,
    /// Learner (patient, family, caregiver)
    pub learner: String,
    /// Date taught
    pub date_taught: Option<String>,
    /// Understanding demonstrated?
    pub understanding_demonstrated: bool,
    /// Barriers to learning
    pub barriers: Vec<String>,
    /// Needs reinforcement?
    pub needs_reinforcement: bool,
    /// Taught by
    pub taught_by: Option<String>,
}

/// Discharge planning
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DischargePlanning {
    /// Anticipated discharge date
    pub anticipated_discharge: Option<String>,
    /// Discharge disposition
    pub disposition: DischargeDisposition,
    /// Living situation
    pub living_situation: String,
    /// Support system
    pub support_system: String,
    /// Equipment/supplies needed
    pub equipment_needed: Vec<String>,
    /// Home health referral needed?
    pub home_health_needed: bool,
    /// DME ordered?
    pub dme_ordered: Vec<String>,
    /// Follow-up appointments
    pub follow_up_appointments: Vec<String>,
    /// Barriers to discharge
    pub barriers: Vec<String>,
}

/// Discharge disposition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DischargeDisposition {
    Home,
    HomeWithHomeHealth,
    SkilledNursingFacility,
    RehabFacility,
    LongTermCare,
    Hospice,
    TransferToAnotherHospital,
    AMA,
    Expired,
}

// ----------------------------------------------------------------------------
// WOUND CARE DOCUMENTATION
// ----------------------------------------------------------------------------

/// Wound assessment and care documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WoundAssessment {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Wound ID (for tracking multiple wounds)
    pub wound_id: String,
    /// Wound location
    pub location: WoundLocation,
    /// Wound type
    pub wound_type: WoundType,
    /// Wound etiology
    pub etiology: String,
    /// Wound measurements
    pub measurements: WoundMeasurements,
    /// Wound bed description
    pub wound_bed: WoundBed,
    /// Wound edges
    pub wound_edges: String,
    /// Periwound skin
    pub periwound: String,
    /// Drainage
    pub drainage: WoundDrainage,
    /// Odor present?
    pub odor: bool,
    /// Signs of infection?
    pub infection_signs: Vec<String>,
    /// Pain level (0-10)
    pub pain_level: Option<u8>,
    /// Treatment/dressing applied
    pub treatment: WoundTreatment,
    /// Pressure injury staging (if applicable)
    pub pressure_stage: Option<PressureInjuryStage>,
    /// Photo taken?
    pub photo_documented: bool,
    /// Photo reference
    pub photo_reference: Option<String>,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time
    pub assessed_at: i64,
    /// Next assessment due
    pub next_assessment_due: Option<String>,
}

/// Wound location
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WoundLocation {
    /// Body part
    pub body_part: String,
    /// Laterality (left, right, midline)
    pub laterality: Option<String>,
    /// Detailed description
    pub description: String,
}

/// Wound type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum WoundType {
    SurgicalIncision,
    PressureInjury,
    Laceration,
    Abrasion,
    Burn,
    VenousUlcer,
    ArterialUlcer,
    DiabeticUlcer,
    SkinTear,
    Abscess,
    Dehiscence,
    Other,
}

/// Wound measurements
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WoundMeasurements {
    /// Length (cm) - head to toe
    pub length_cm: f32,
    /// Width (cm) - side to side
    pub width_cm: f32,
    /// Depth (cm)
    pub depth_cm: Option<f32>,
    /// Undermining (if present)
    pub undermining: Option<String>,
    /// Tunneling (if present)
    pub tunneling: Option<String>,
    /// Calculated area (cm²)
    pub area_cm2: f32,
}

/// Wound bed characteristics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WoundBed {
    /// Percentage granulation tissue (healthy red)
    pub granulation_percent: u8,
    /// Percentage slough (yellow)
    pub slough_percent: u8,
    /// Percentage eschar (black)
    pub eschar_percent: u8,
    /// Percentage epithelial (pink)
    pub epithelial_percent: u8,
    /// Other tissue
    pub other_percent: u8,
    /// Description
    pub description: String,
}

/// Wound drainage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WoundDrainage {
    /// Drainage type
    pub drainage_type: DrainageType,
    /// Amount
    pub amount: DrainageAmount,
    /// Color
    pub color: String,
    /// Consistency
    pub consistency: String,
}

/// Drainage type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DrainageType {
    Serous,
    Sanguineous,
    Serosanguineous,
    Purulent,
    None,
}

/// Drainage amount
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DrainageAmount {
    None,
    Scant,
    Small,
    Moderate,
    Large,
    Copious,
}

/// Wound treatment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WoundTreatment {
    /// Cleansing solution
    pub cleansing: String,
    /// Primary dressing
    pub primary_dressing: String,
    /// Secondary dressing
    pub secondary_dressing: Option<String>,
    /// Securement method
    pub securement: String,
    /// Frequency of dressing changes
    pub change_frequency: String,
    /// Special instructions
    pub instructions: Option<String>,
}

/// Pressure injury staging (NPUAP)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PressureInjuryStage {
    /// Stage 1: Non-blanchable erythema
    Stage1,
    /// Stage 2: Partial thickness skin loss
    Stage2,
    /// Stage 3: Full thickness skin loss
    Stage3,
    /// Stage 4: Full thickness tissue loss
    Stage4,
    /// Unstageable: Obscured by slough/eschar
    Unstageable,
    /// Deep tissue injury
    DeepTissueInjury,
    /// Medical device related
    DeviceRelated,
    /// Mucosal membrane pressure injury
    Mucosal,
}

// ----------------------------------------------------------------------------
// IV SITE DOCUMENTATION
// ----------------------------------------------------------------------------

/// IV site assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IVSiteAssessment {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// IV line ID
    pub line_id: String,
    /// Line type
    pub line_type: IVLineType,
    /// Insertion site
    pub insertion_site: String,
    /// Insertion date/time
    pub insertion_time: i64,
    /// Inserted by
    pub inserted_by: String,
    /// Catheter gauge/size
    pub catheter_size: String,
    /// Catheter length (for central lines)
    pub catheter_length_cm: Option<f32>,
    /// Number of lumens (for central lines)
    pub lumens: Option<u8>,
    /// Site assessment
    pub site_assessment: IVSiteCondition,
    /// Dressing type
    pub dressing_type: String,
    /// Dressing date
    pub dressing_date: String,
    /// Tubing change date
    pub tubing_change_date: Option<String>,
    /// Flushed with
    pub flush_solution: Option<String>,
    /// Current infusions
    pub current_infusions: Vec<String>,
    /// Complications
    pub complications: Vec<IVComplication>,
    /// Assessment time
    pub assessed_at: i64,
    /// Assessed by
    pub assessed_by: String,
}

/// IV line type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum IVLineType {
    PeripheralIV,
    PICC,
    CentralLineSubclavian,
    CentralLineIJ,
    CentralLineFemoral,
    PortACath,
    Midline,
    ArterialLine,
}

/// IV site condition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IVSiteCondition {
    /// Site clean and dry?
    pub clean_dry: bool,
    /// Dressing intact?
    pub dressing_intact: bool,
    /// Redness present?
    pub redness: bool,
    /// Swelling present?
    pub swelling: bool,
    /// Tenderness?
    pub tenderness: bool,
    /// Drainage?
    pub drainage: bool,
    /// Blood return (for central lines)?
    pub blood_return: Option<bool>,
    /// Flushes without resistance?
    pub flushes_easily: bool,
    /// VIP score (Visual Infusion Phlebitis)
    pub vip_score: Option<u8>,
    /// Notes
    pub notes: Option<String>,
}

/// IV complications
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum IVComplication {
    Infiltration,
    Extravasation,
    Phlebitis,
    Thrombosis,
    Infection,
    Occlusion,
    Dislodgement,
    AirEmbolism,
    Hematoma,
}

// ----------------------------------------------------------------------------
// SHIFT HANDOFF / SBAR
// ----------------------------------------------------------------------------

/// Shift handoff report (SBAR format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShiftHandoff {
    /// Handoff ID
    pub handoff_id: String,
    /// Patient ID
    pub patient_id: String,
    /// From nurse
    pub from_nurse: String,
    /// To nurse
    pub to_nurse: String,
    /// Handoff time
    pub handoff_time: i64,
    /// SITUATION
    pub situation: HandoffSituation,
    /// BACKGROUND
    pub background: HandoffBackground,
    /// ASSESSMENT
    pub assessment: HandoffAssessment,
    /// RECOMMENDATION
    pub recommendation: HandoffRecommendation,
    /// Safety checks
    pub safety_checks: SafetyChecks,
    /// Tasks pending
    pub pending_tasks: Vec<PendingTask>,
    /// Questions from receiving nurse
    pub questions: Option<String>,
    /// Handoff acknowledged
    pub acknowledged: bool,
}

/// Situation (current status)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandoffSituation {
    /// Room/bed
    pub room_bed: String,
    /// Patient name
    pub patient_name: String,
    /// Admitting diagnosis
    pub diagnosis: String,
    /// Current condition
    pub current_condition: String,
    /// Code status
    pub code_status: String,
    /// Isolation precautions
    pub isolation: Option<String>,
    /// Immediate concerns
    pub immediate_concerns: Vec<String>,
}

/// Background (relevant history)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandoffBackground {
    /// Admission date
    pub admission_date: String,
    /// Reason for admission
    pub admission_reason: String,
    /// Relevant medical history
    pub medical_history: Vec<String>,
    /// Allergies
    pub allergies: Vec<String>,
    /// Key events this shift
    pub shift_events: Vec<String>,
    /// Recent procedures/tests
    pub recent_procedures: Vec<String>,
}

/// Assessment (current data)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandoffAssessment {
    /// Latest vital signs
    pub vital_signs: String,
    /// Neuro status
    pub neuro: String,
    /// Cardiac/circulatory
    pub cardiac: String,
    /// Respiratory
    pub respiratory: String,
    /// GI/GU
    pub gi_gu: String,
    /// Skin/wounds
    pub skin_wounds: String,
    /// Pain status
    pub pain: String,
    /// IV sites/access
    pub iv_access: String,
    /// Labs/diagnostics pending
    pub pending_labs: Vec<String>,
    /// Abnormal findings
    pub abnormal_findings: Vec<String>,
}

/// Recommendation (plan)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandoffRecommendation {
    /// Current plan of care
    pub plan_of_care: String,
    /// What to watch for
    pub watch_for: Vec<String>,
    /// Anticipated orders/changes
    pub anticipated_changes: Vec<String>,
    /// Expected discharge
    pub expected_discharge: Option<String>,
    /// Family/social concerns
    pub family_concerns: Option<String>,
}

/// Safety checks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafetyChecks {
    /// ID band present and accurate?
    pub id_band_verified: bool,
    /// Fall risk assessed?
    pub fall_risk_assessed: bool,
    /// Fall risk level
    pub fall_risk_level: String,
    /// Bed alarm on?
    pub bed_alarm_on: Option<bool>,
    /// Call light within reach?
    pub call_light_accessible: bool,
    /// Restraints (if applicable)
    pub restraints: Option<String>,
    /// DVT prophylaxis
    pub dvt_prophylaxis: String,
    /// Skin assessment done?
    pub skin_assessed: bool,
}

/// Pending task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingTask {
    /// Task description
    pub task: String,
    /// Due time
    pub due_time: Option<String>,
    /// Priority
    pub priority: TaskPriority,
}

/// Task priority
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskPriority {
    High,
    Medium,
    Low,
}

// ----------------------------------------------------------------------------
// INCIDENT REPORTING
// ----------------------------------------------------------------------------

/// Incident report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncidentReport {
    /// Report ID
    pub report_id: String,
    /// Patient ID (if patient-related)
    pub patient_id: Option<String>,
    /// Incident date/time
    pub incident_time: i64,
    /// Location
    pub location: String,
    /// Incident type
    pub incident_type: IncidentType,
    /// Description of incident
    pub description: String,
    /// Witnesses
    pub witnesses: Vec<String>,
    /// Immediate actions taken
    pub immediate_actions: Vec<String>,
    /// Patient condition before incident
    pub condition_before: Option<String>,
    /// Patient condition after incident
    pub condition_after: Option<String>,
    /// Vital signs post-incident
    pub post_incident_vitals: Option<String>,
    /// Physician notified?
    pub physician_notified: bool,
    /// Physician name
    pub physician_name: Option<String>,
    /// Notification time
    pub notification_time: Option<i64>,
    /// Family notified?
    pub family_notified: bool,
    /// Interventions/treatments
    pub interventions: Vec<String>,
    /// Outcome
    pub outcome: String,
    /// Contributing factors
    pub contributing_factors: Vec<String>,
    /// Preventive measures recommended
    pub preventive_measures: Vec<String>,
    /// Reported by
    pub reported_by: String,
    /// Report time
    pub reported_at: i64,
    /// Supervisor reviewed?
    pub supervisor_reviewed: bool,
    /// Supervisor name
    pub supervisor_name: Option<String>,
    /// Review time
    pub review_time: Option<i64>,
}

/// Incident type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum IncidentType {
    Fall,
    MedicationError,
    AdverseDrugReaction,
    NeedlestickExposure,
    EquipmentMalfunction,
    PatientElopement,
    SkinBreakdown,
    ProcedureComplication,
    PatientBehavior,
    SecurityIncident,
    PropertyLoss,
    NearMiss,
    Other,
}

// ----------------------------------------------------------------------------
// FALL RISK ASSESSMENT
// ----------------------------------------------------------------------------

/// Fall risk assessment (Morse Fall Scale)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FallRiskAssessment {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// History of falling (immediate or past 3 months)
    pub history_of_falling: MorseFallScore,
    /// Secondary diagnosis (2+ medical diagnoses)
    pub secondary_diagnosis: MorseFallScore,
    /// Ambulatory aid
    pub ambulatory_aid: MorseFallScore,
    /// IV/Heparin lock
    pub iv_heparin_lock: MorseFallScore,
    /// Gait
    pub gait: MorseFallScore,
    /// Mental status
    pub mental_status: MorseFallScore,
    /// Total score
    pub total_score: u8,
    /// Risk level
    pub risk_level: FallRiskLevel,
    /// Interventions implemented
    pub interventions: Vec<FallPrevention>,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time
    pub assessed_at: i64,
}

/// Morse Fall Scale scoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MorseFallScore {
    /// Item
    pub item: String,
    /// Score value
    pub score: u8,
    /// Description
    pub description: String,
}

/// Fall risk level
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FallRiskLevel {
    /// 0-24: Low risk
    Low,
    /// 25-44: Moderate risk
    Moderate,
    /// 45+: High risk
    High,
}

/// Fall prevention interventions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FallPrevention {
    BedInLowestPosition,
    BedAlarmOn,
    ChairAlarmOn,
    SideRailsUp,
    CallLightWithinReach,
    NonSlipFootwear,
    GaitBelt,
    AssistWithMobility,
    FallRiskSignage,
    FrequentRounding,
    ToiletingSchedule,
    EnvironmentCleared,
    Other,
}

// ============================================================================
// PHASE 4: SPECIALTY EMERGENCY DOCUMENTATION
// ============================================================================

// ----------------------------------------------------------------------------
// BURN DOCUMENTATION
// ----------------------------------------------------------------------------

/// Burn assessment using Rule of Nines
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BurnAssessment {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Burn cause
    pub burn_cause: BurnCause,
    /// Time of burn
    pub burn_time: Option<i64>,
    /// Body surface area by region (Rule of Nines)
    pub tbsa_regions: TBSARegions,
    /// Total body surface area burned (%)
    pub total_tbsa_percent: f32,
    /// Burn depth by region
    pub burn_depths: Vec<BurnDepthRegion>,
    /// Inhalation injury suspected?
    pub inhalation_injury: bool,
    /// Inhalation injury signs
    pub inhalation_signs: Vec<String>,
    /// Circumferential burns?
    pub circumferential: bool,
    /// Circumferential locations
    pub circumferential_locations: Vec<String>,
    /// Escharotomy needed/performed?
    pub escharotomy: Option<Escharotomy>,
    /// Fluid resuscitation (Parkland formula)
    pub fluid_resuscitation: BurnFluidResuscitation,
    /// Pain management
    pub pain_management: String,
    /// Tetanus status updated?
    pub tetanus_updated: bool,
    /// Burn center transfer criteria met?
    pub burn_center_criteria: bool,
    /// Photos documented?
    pub photos_documented: bool,
    /// Photo references
    pub photo_references: Vec<String>,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time
    pub assessed_at: i64,
}

/// Burn cause
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BurnCause {
    Thermal,
    Scald,
    Chemical,
    Electrical,
    Radiation,
    Friction,
    Inhalation,
    Frostbite,
}

/// TBSA regions (Rule of Nines for adults)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TBSARegions {
    /// Head (9%)
    pub head_percent: f32,
    /// Anterior trunk (18%)
    pub anterior_trunk_percent: f32,
    /// Posterior trunk (18%)
    pub posterior_trunk_percent: f32,
    /// Right arm (9%)
    pub right_arm_percent: f32,
    /// Left arm (9%)
    pub left_arm_percent: f32,
    /// Right leg (18%)
    pub right_leg_percent: f32,
    /// Left leg (18%)
    pub left_leg_percent: f32,
    /// Perineum (1%)
    pub perineum_percent: f32,
}

impl TBSARegions {
    /// Calculate total TBSA
    pub fn total(&self) -> f32 {
        self.head_percent
            + self.anterior_trunk_percent
            + self.posterior_trunk_percent
            + self.right_arm_percent
            + self.left_arm_percent
            + self.right_leg_percent
            + self.left_leg_percent
            + self.perineum_percent
    }
}

/// Burn depth by region
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BurnDepthRegion {
    /// Body region
    pub region: String,
    /// Burn depth
    pub depth: BurnDepth,
    /// Appearance description
    pub appearance: String,
}

/// Burn depth classification
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BurnDepth {
    /// Superficial (1st degree) - epidermis only
    Superficial,
    /// Superficial partial thickness (2nd degree)
    SuperficialPartialThickness,
    /// Deep partial thickness (2nd degree)
    DeepPartialThickness,
    /// Full thickness (3rd degree)
    FullThickness,
    /// Fourth degree (extends to muscle/bone)
    FourthDegree,
}

/// Escharotomy record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Escharotomy {
    /// Performed?
    pub performed: bool,
    /// Location(s)
    pub locations: Vec<String>,
    /// Time performed
    pub performed_at: Option<i64>,
    /// Performed by
    pub performed_by: Option<String>,
}

/// Burn fluid resuscitation (Parkland formula)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BurnFluidResuscitation {
    /// Patient weight (kg)
    pub weight_kg: f32,
    /// TBSA %
    pub tbsa_percent: f32,
    /// Calculated 24h fluid (4 mL × kg × TBSA%)
    pub calculated_24h_ml: u32,
    /// First 8 hours volume
    pub first_8h_ml: u32,
    /// Second 8 hours volume
    pub second_8h_ml: u32,
    /// Third 8 hours volume
    pub third_8h_ml: u32,
    /// Urine output target (0.5-1 mL/kg/hr)
    pub urine_output_target_ml_hr: f32,
    /// Fluid type (usually LR)
    pub fluid_type: String,
}

impl BurnFluidResuscitation {
    /// Calculate Parkland formula fluid requirements
    pub fn calculate_parkland(weight_kg: f32, tbsa_percent: f32) -> Self {
        let total_24h = (4.0 * weight_kg * tbsa_percent) as u32;
        let first_8h = total_24h / 2;
        let remaining = total_24h - first_8h;
        let second_8h = remaining / 2;
        let third_8h = remaining - second_8h;

        BurnFluidResuscitation {
            weight_kg,
            tbsa_percent,
            calculated_24h_ml: total_24h,
            first_8h_ml: first_8h,
            second_8h_ml: second_8h,
            third_8h_ml: third_8h,
            urine_output_target_ml_hr: weight_kg * 0.5, // 0.5 mL/kg/hr minimum
            fluid_type: "Lactated Ringers".to_string(),
        }
    }
}

// ----------------------------------------------------------------------------
// PSYCHIATRIC EMERGENCY
// ----------------------------------------------------------------------------

/// Psychiatric emergency assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsychiatricAssessment {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Chief complaint
    pub chief_complaint: String,
    /// Mental status examination
    pub mental_status_exam: MentalStatusExam,
    /// Suicide risk assessment
    pub suicide_risk: SuicideRiskAssessment,
    /// Homicidal ideation assessment
    pub homicidal_risk: HomicidalRiskAssessment,
    /// Substance use
    pub substance_use: SubstanceUseAssessment,
    /// Psychiatric history
    pub psych_history: PsychiatricHistory,
    /// Current medications (psych)
    pub psych_medications: Vec<String>,
    /// Medication compliance
    pub medication_compliant: Option<bool>,
    /// Social history
    pub social_history: PsychSocialHistory,
    /// Legal status
    pub legal_status: LegalStatus,
    /// Safety precautions implemented
    pub safety_precautions: Vec<PsychSafetyPrecaution>,
    /// Disposition
    pub disposition: PsychDisposition,
    /// Safety plan created?
    pub safety_plan: Option<SafetyPlan>,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time
    pub assessed_at: i64,
}

/// Mental status examination
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MentalStatusExam {
    /// Appearance
    pub appearance: String,
    /// Behavior
    pub behavior: String,
    /// Speech
    pub speech: String,
    /// Mood (patient's own description)
    pub mood: String,
    /// Affect (observed emotional expression)
    pub affect: String,
    /// Thought process
    pub thought_process: String,
    /// Thought content
    pub thought_content: String,
    /// Perceptions (hallucinations)
    pub perceptions: String,
    /// Cognition (oriented x3/4)
    pub cognition: String,
    /// Insight
    pub insight: String,
    /// Judgment
    pub judgment: String,
}

/// Suicide risk assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuicideRiskAssessment {
    /// Suicidal ideation?
    pub ideation: bool,
    /// Ideation description
    pub ideation_description: Option<String>,
    /// Plan?
    pub plan: bool,
    /// Plan description
    pub plan_description: Option<String>,
    /// Intent?
    pub intent: bool,
    /// Access to means?
    pub access_to_means: bool,
    /// Means description
    pub means_description: Option<String>,
    /// Prior attempts?
    pub prior_attempts: bool,
    /// Number of prior attempts
    pub attempt_count: Option<u8>,
    /// Most recent attempt details
    pub recent_attempt_details: Option<String>,
    /// Risk factors present
    pub risk_factors: Vec<String>,
    /// Protective factors
    pub protective_factors: Vec<String>,
    /// Overall risk level
    pub risk_level: SuicideRiskLevel,
    /// Columbia Suicide Severity Rating Scale used?
    pub cssrs_used: bool,
    /// CSSRS score if used
    pub cssrs_score: Option<u8>,
}

/// Suicide risk level
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SuicideRiskLevel {
    Low,
    Moderate,
    High,
    Imminent,
}

/// Homicidal risk assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomicidalRiskAssessment {
    /// Homicidal ideation?
    pub ideation: bool,
    /// Target identified?
    pub target_identified: bool,
    /// Target description (if applicable)
    pub target_description: Option<String>,
    /// Plan?
    pub plan: bool,
    /// Access to weapons?
    pub access_to_weapons: bool,
    /// History of violence?
    pub history_of_violence: bool,
    /// Risk level
    pub risk_level: String,
    /// Duty to warn enacted? (Tarasoff)
    pub duty_to_warn: bool,
    /// Law enforcement notified?
    pub law_enforcement_notified: bool,
}

/// Substance use assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubstanceUseAssessment {
    /// Current intoxication?
    pub currently_intoxicated: bool,
    /// Substances
    pub substances: Vec<SubstanceUse>,
    /// In withdrawal?
    pub in_withdrawal: bool,
    /// Withdrawal symptoms
    pub withdrawal_symptoms: Vec<String>,
    /// CIWA/COWS score if applicable
    pub withdrawal_score: Option<u8>,
    /// Withdrawal protocol initiated?
    pub withdrawal_protocol: bool,
}

/// Individual substance use
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubstanceUse {
    /// Substance name
    pub substance: String,
    /// Route
    pub route: String,
    /// Frequency
    pub frequency: String,
    /// Last use
    pub last_use: Option<String>,
    /// Amount/dose
    pub amount: Option<String>,
}

/// Psychiatric history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsychiatricHistory {
    /// Previous diagnoses
    pub diagnoses: Vec<String>,
    /// Previous hospitalizations
    pub hospitalizations: u8,
    /// Previous suicide attempts
    pub suicide_attempts: u8,
    /// Previous self-harm
    pub self_harm_history: bool,
    /// Trauma history
    pub trauma_history: Option<String>,
    /// Family psychiatric history
    pub family_history: Vec<String>,
}

/// Psychosocial history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsychSocialHistory {
    /// Living situation
    pub living_situation: String,
    /// Support system
    pub support_system: String,
    /// Employment
    pub employment: String,
    /// Recent stressors
    pub recent_stressors: Vec<String>,
    /// Legal issues
    pub legal_issues: Option<String>,
    /// Financial issues
    pub financial_issues: Option<String>,
}

/// Legal status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegalStatus {
    /// Admission type
    pub admission_type: AdmissionType,
    /// Hold type (if involuntary)
    pub hold_type: Option<String>,
    /// Hold expiration
    pub hold_expiration: Option<i64>,
    /// Court hearing scheduled?
    pub court_hearing: Option<String>,
    /// Guardian/conservator?
    pub guardian: Option<String>,
}

/// Admission type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AdmissionType {
    Voluntary,
    Involuntary5150,
    InvoluntaryOther,
    CourtOrdered,
}

/// Psychiatric safety precautions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PsychSafetyPrecaution {
    OneToOneObservation,
    Q15MinuteChecks,
    Q30MinuteChecks,
    ElopementPrecautions,
    SuicidePrecautions,
    SharpsSafety,
    BelongingsSearched,
    RoomSafe,
    Sitter,
    SecurityPresent,
}

/// Psychiatric disposition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PsychDisposition {
    InpatientAdmission,
    PartialHospitalization,
    IntensiveOutpatient,
    OutpatientFollowUp,
    TransferToPsychFacility,
    CrisisStabilization,
    DischargeHome,
}

/// Safety plan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafetyPlan {
    /// Warning signs
    pub warning_signs: Vec<String>,
    /// Coping strategies
    pub coping_strategies: Vec<String>,
    /// Social contacts for distraction
    pub social_contacts: Vec<String>,
    /// Professional contacts
    pub professional_contacts: Vec<String>,
    /// Crisis hotline numbers
    pub crisis_numbers: Vec<String>,
    /// Means restriction plan
    pub means_restriction: String,
    /// Reasons for living
    pub reasons_for_living: Vec<String>,
    /// Patient signature?
    pub patient_signed: bool,
}

// ----------------------------------------------------------------------------
// TOXICOLOGY / OVERDOSE
// ----------------------------------------------------------------------------

/// Toxicology/Overdose assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToxicologyAssessment {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Exposure type
    pub exposure_type: ExposureType,
    /// Substance(s) involved
    pub substances: Vec<ToxicSubstance>,
    /// Time of exposure
    pub exposure_time: Option<i64>,
    /// Route of exposure
    pub exposure_route: ExposureRoute,
    /// Intentional or accidental?
    pub intent: ExposureIntent,
    /// Symptoms
    pub symptoms: Vec<String>,
    /// Toxidrome identified
    pub toxidrome: Option<Toxidrome>,
    /// Poison Control contacted?
    pub poison_control_contacted: bool,
    /// Poison Control case number
    pub poison_control_case: Option<String>,
    /// Poison Control recommendations
    pub poison_control_recs: Option<String>,
    /// Decontamination performed
    pub decontamination: Vec<DecontaminationMethod>,
    /// Antidotes given
    pub antidotes: Vec<Antidote>,
    /// Lab studies
    pub lab_studies: ToxLabs,
    /// Supportive care measures
    pub supportive_care: Vec<String>,
    /// Observation period required
    pub observation_hours: Option<u8>,
    /// Disposition
    pub disposition: String,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time
    pub assessed_at: i64,
}

/// Exposure type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExposureType {
    DrugOverdose,
    ChemicalExposure,
    Envenomation,
    Inhalation,
    FoodPoisoning,
    PlantIngestion,
    Other,
}

/// Toxic substance details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToxicSubstance {
    /// Substance name
    pub name: String,
    /// Amount (if known)
    pub amount: Option<String>,
    /// Formulation
    pub formulation: Option<String>,
}

/// Exposure route
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExposureRoute {
    Ingestion,
    Inhalation,
    Injection,
    Dermal,
    Ocular,
    Multiple,
}

/// Exposure intent
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExposureIntent {
    Intentional,
    Accidental,
    TherapeuticMisadventure,
    Unknown,
}

/// Toxidrome patterns
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Toxidrome {
    Sympathomimetic,
    Anticholinergic,
    Cholinergic,
    Opioid,
    SedativeHypnotic,
    SerotoninSyndrome,
    NMS,
    Withdrawal,
}

/// Decontamination methods
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DecontaminationMethod {
    ActivatedCharcoal,
    GastricLavage,
    WholeBoweIrrigation,
    SkinDecontamination,
    EyeIrrigation,
    None,
}

/// Antidote given
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Antidote {
    /// Antidote name
    pub name: String,
    /// Dose
    pub dose: String,
    /// Time given
    pub time: i64,
    /// Response
    pub response: Option<String>,
}

/// Toxicology labs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToxLabs {
    /// Urine drug screen
    pub uds: Option<String>,
    /// Blood alcohol level
    pub blood_alcohol: Option<f32>,
    /// Acetaminophen level
    pub acetaminophen: Option<f32>,
    /// Salicylate level
    pub salicylate: Option<f32>,
    /// Specific drug levels
    pub specific_levels: Vec<DrugLevel>,
    /// ABG
    pub abg: Option<String>,
    /// Anion gap
    pub anion_gap: Option<f32>,
    /// Osmolar gap
    pub osmolar_gap: Option<f32>,
}

/// Drug level
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrugLevel {
    /// Drug name
    pub drug: String,
    /// Level
    pub level: f32,
    /// Unit
    pub unit: String,
    /// Therapeutic range
    pub therapeutic_range: Option<String>,
}

// ----------------------------------------------------------------------------
// MASS CASUALTY INCIDENT (MCI)
// ----------------------------------------------------------------------------

/// Mass Casualty Incident documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MassCasualtyIncident {
    /// Incident ID
    pub incident_id: String,
    /// Incident name/type
    pub incident_name: String,
    /// Incident location
    pub location: String,
    /// Incident time
    pub incident_time: i64,
    /// MCI level declared
    pub mci_level: MCILevel,
    /// Estimated casualties
    pub estimated_casualties: u32,
    /// Patients tracked
    pub patients: Vec<MCIPatient>,
    /// Triage officer
    pub triage_officer: String,
    /// Incident commander
    pub incident_commander: String,
    /// Resources deployed
    pub resources: Vec<String>,
    /// Status updates
    pub status_updates: Vec<MCIStatusUpdate>,
    /// Deactivation time
    pub deactivation_time: Option<i64>,
}

/// MCI level
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MCILevel {
    Level1,
    Level2,
    Level3,
}

/// MCI patient tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCIPatient {
    /// Triage tag number
    pub tag_number: String,
    /// Triage category
    pub triage_category: MCITriageCategory,
    /// Age (estimated)
    pub age_estimate: Option<String>,
    /// Sex
    pub sex: Option<String>,
    /// Chief complaint/injury
    pub chief_complaint: String,
    /// Transport destination
    pub destination: Option<String>,
    /// Transport time
    pub transport_time: Option<i64>,
    /// Patient ID (if identified later)
    pub patient_id: Option<String>,
}

/// MCI triage categories (START triage)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MCITriageCategory {
    /// Red - Immediate (life-threatening, salvageable)
    Immediate,
    /// Yellow - Delayed (serious but can wait)
    Delayed,
    /// Green - Minor (walking wounded)
    Minor,
    /// Black - Expectant/Deceased
    Expectant,
}

/// MCI status update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCIStatusUpdate {
    /// Update time
    pub time: i64,
    /// Status message
    pub message: String,
    /// Updated by
    pub updated_by: String,
}

// ============================================================================
// PHASE 5: PROCEDURE DOCUMENTATION
// ============================================================================

// ----------------------------------------------------------------------------
// INTUBATION RECORD
// ----------------------------------------------------------------------------

/// Intubation/Airway procedure documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntubationRecord {
    /// Record ID
    pub record_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Indication for intubation
    pub indication: IntubationIndication,
    /// Pre-intubation assessment
    pub pre_assessment: PreIntubationAssessment,
    /// Pre-oxygenation method
    pub preoxygenation: String,
    /// Pre-oxygenation SpO2
    pub preoxygenation_spo2: Option<u8>,
    /// RSI medications used
    pub medications: Vec<IntubationMedication>,
    /// Laryngoscope type
    pub laryngoscope: LaryngoscopeType,
    /// Blade type and size
    pub blade: String,
    /// View (Cormack-Lehane grade)
    pub cormack_lehane_grade: u8,
    /// ETT size
    pub ett_size: f32,
    /// ETT depth at teeth (cm)
    pub ett_depth_cm: f32,
    /// Cuff inflated?
    pub cuff_inflated: bool,
    /// Cuff pressure
    pub cuff_pressure_cmh2o: Option<u16>,
    /// Number of attempts
    pub attempts: u8,
    /// Successful?
    pub successful: bool,
    /// Confirmation methods
    pub confirmation: Vec<IntubationConfirmation>,
    /// End-tidal CO2
    pub etco2: Option<u16>,
    /// Post-intubation CXR ordered?
    pub cxr_ordered: bool,
    /// Complications
    pub complications: Vec<IntubationComplication>,
    /// Ventilator settings
    pub ventilator_settings: Option<VentilatorSettings>,
    /// Performed by
    pub performed_by: String,
    /// Assisted by
    pub assisted_by: Option<String>,
    /// Procedure time
    pub procedure_time: i64,
}

/// Intubation indication
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum IntubationIndication {
    RespiratoryFailure,
    AirwayProtection,
    ProcedureAnesthesia,
    CardiacArrest,
    Trauma,
    AnticipatedDecompensation,
    Other,
}

/// Pre-intubation assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreIntubationAssessment {
    /// LEMON airway assessment
    pub lemon_assessment: LEMONAssessment,
    /// Mallampati score
    pub mallampati: u8,
    /// NPO status
    pub npo_status: Option<String>,
    /// Last meal time
    pub last_meal: Option<String>,
    /// Difficult airway anticipated?
    pub difficult_airway_anticipated: bool,
    /// Backup plans discussed
    pub backup_plans: Vec<String>,
}

/// LEMON difficult airway assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LEMONAssessment {
    /// L - Look externally (facial trauma, obesity, etc.)
    pub look_externally: String,
    /// E - Evaluate 3-3-2 rule
    pub evaluate_332: bool,
    /// M - Mallampati
    pub mallampati: u8,
    /// O - Obstruction
    pub obstruction: bool,
    /// N - Neck mobility
    pub neck_mobility: String,
}

/// Intubation medication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntubationMedication {
    /// Medication name
    pub name: String,
    /// Dose
    pub dose: String,
    /// Time given
    pub time: i64,
    /// Category (induction, paralytic, pretreatment)
    pub category: String,
}

/// Laryngoscope type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LaryngoscopeType {
    DirectMacintosh,
    DirectMiller,
    VideoGlideScope,
    VideoCMAC,
    VideoMcGrath,
    Fiberoptic,
    Other,
}

/// Intubation confirmation methods
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum IntubationConfirmation {
    EndTidalCO2,
    BilateralBreathSounds,
    ChestRise,
    CondensationInTube,
    SpO2Improvement,
    EsophagealDetectorDevice,
    ChestXray,
}

/// Intubation complications
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum IntubationComplication {
    DesaturationBelow90,
    Hypotension,
    Bradycardia,
    EsophagealIntubation,
    RightMainstem,
    Aspiration,
    DentalTrauma,
    LaryngealTrauma,
    Pneumothorax,
    CardiacArrest,
    None,
}

/// Ventilator initial settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VentilatorSettings {
    /// Mode
    pub mode: String,
    /// Tidal volume (mL)
    pub tidal_volume_ml: Option<u16>,
    /// Respiratory rate
    pub respiratory_rate: u16,
    /// PEEP (cmH2O)
    pub peep_cmh2o: u8,
    /// FiO2 (%)
    pub fio2_percent: u8,
    /// Pressure support (if applicable)
    pub pressure_support_cmh2o: Option<u8>,
}

// ----------------------------------------------------------------------------
// LACERATION REPAIR
// ----------------------------------------------------------------------------

/// Laceration repair documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LacerationRepair {
    /// Record ID
    pub record_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Location of laceration
    pub location: String,
    /// Mechanism of injury
    pub mechanism: String,
    /// Time of injury
    pub injury_time: Option<i64>,
    /// Wound characteristics
    pub wound: LacerationWound,
    /// Neurovascular status before repair
    pub neuro_before: NeurovascularStatus,
    /// Tetanus status/given
    pub tetanus: TetanusStatus,
    /// Anesthesia used
    pub anesthesia: LocalAnesthesia,
    /// Wound explored?
    pub wound_explored: bool,
    /// Exploration findings
    pub exploration_findings: Option<String>,
    /// Foreign body found?
    pub foreign_body: Option<String>,
    /// Irrigated?
    pub irrigated: bool,
    /// Irrigation solution and volume
    pub irrigation: Option<String>,
    /// Closure technique
    pub closure: WoundClosure,
    /// Neurovascular status after repair
    pub neuro_after: NeurovascularStatus,
    /// Dressing applied
    pub dressing: String,
    /// Antibiotics prescribed?
    pub antibiotics: Option<String>,
    /// Follow-up instructions
    pub follow_up: String,
    /// Suture removal timeframe
    pub suture_removal_days: Option<u8>,
    /// Photo documented?
    pub photo_documented: bool,
    /// Performed by
    pub performed_by: String,
    /// Procedure time
    pub procedure_time: i64,
}

/// Laceration wound characteristics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LacerationWound {
    /// Length (cm)
    pub length_cm: f32,
    /// Depth (mm)
    pub depth_mm: Option<f32>,
    /// Shape (linear, stellate, irregular)
    pub shape: String,
    /// Edges (clean, jagged, crushed)
    pub edges: String,
    /// Contamination level
    pub contamination: ContaminationLevel,
    /// Active bleeding?
    pub active_bleeding: bool,
    /// Tissue viability
    pub tissue_viability: String,
}

/// Contamination level
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ContaminationLevel {
    Clean,
    CleanContaminated,
    Contaminated,
    Dirty,
}

/// Neurovascular status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeurovascularStatus {
    /// Sensation intact?
    pub sensation_intact: bool,
    /// Motor function intact?
    pub motor_intact: bool,
    /// Capillary refill
    pub capillary_refill_sec: Option<u8>,
    /// Pulses distal to injury
    pub pulses: String,
    /// Notes
    pub notes: Option<String>,
}

/// Tetanus status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TetanusStatus {
    /// Last tetanus vaccine
    pub last_vaccine: Option<String>,
    /// Years since last vaccine
    pub years_since: Option<u8>,
    /// Tetanus given today?
    pub given_today: bool,
    /// Type given (Tdap, Td)
    pub type_given: Option<String>,
}

/// Local anesthesia
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAnesthesia {
    /// Agent used
    pub agent: String,
    /// Concentration
    pub concentration: String,
    /// Volume (mL)
    pub volume_ml: f32,
    /// With epinephrine?
    pub with_epinephrine: bool,
    /// Technique (infiltration, block)
    pub technique: String,
    /// Adequate anesthesia achieved?
    pub adequate: bool,
}

/// Wound closure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WoundClosure {
    /// Closure type
    pub closure_type: ClosureType,
    /// Suture material (if sutured)
    pub suture_material: Option<String>,
    /// Suture size
    pub suture_size: Option<String>,
    /// Number of sutures
    pub suture_count: Option<u8>,
    /// Suture technique
    pub suture_technique: Option<String>,
    /// Deep sutures placed?
    pub deep_sutures: bool,
    /// Staple count (if stapled)
    pub staple_count: Option<u8>,
}

/// Closure type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ClosureType {
    SimpleSutures,
    MattressSutures,
    RunningSubcuticular,
    Staples,
    Dermabond,
    SterilStrips,
    OpenHealing,
    DelayedPrimaryClosure,
}

// ----------------------------------------------------------------------------
// SPLINTING / CASTING
// ----------------------------------------------------------------------------

/// Splint/Cast documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplintCastRecord {
    /// Record ID
    pub record_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Injury/Indication
    pub indication: String,
    /// Fracture/injury location
    pub location: String,
    /// Type (splint or cast)
    pub immobilization_type: ImmobilizationType,
    /// Specific splint/cast type
    pub specific_type: String,
    /// Material used
    pub material: String,
    /// Position of immobilization
    pub position: String,
    /// Padding adequate?
    pub padding_adequate: bool,
    /// Neurovascular check before
    pub nv_check_before: NeurovascularStatus,
    /// Neurovascular check after
    pub nv_check_after: NeurovascularStatus,
    /// Patient instructions given?
    pub instructions_given: bool,
    /// Instructions
    pub instructions: Vec<String>,
    /// Weight bearing status
    pub weight_bearing: WeightBearingStatus,
    /// Follow-up
    pub follow_up: String,
    /// Orthopedics referral?
    pub ortho_referral: bool,
    /// Applied by
    pub applied_by: String,
    /// Application time
    pub application_time: i64,
}

/// Immobilization type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ImmobilizationType {
    Splint,
    Cast,
    Sling,
    Boot,
    Brace,
}

/// Weight bearing status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum WeightBearingStatus {
    NonWeightBearing,
    TouchdownWeightBearing,
    PartialWeightBearing,
    WeightBearingAsToelerated,
    FullWeightBearing,
}

// ============================================================================
// PHASE 6: PEDIATRIC & OBSTETRIC EMERGENCY
// ============================================================================

// ----------------------------------------------------------------------------
// PEDIATRIC ASSESSMENT
// ----------------------------------------------------------------------------

/// Pediatric emergency assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PediatricAssessment {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Age
    pub age: PediatricAge,
    /// Weight (kg)
    pub weight_kg: f32,
    /// Weight estimation method
    pub weight_method: WeightEstimationMethod,
    /// Pediatric vital signs with age-specific norms
    pub vital_signs: PediatricVitalSigns,
    /// Pediatric Assessment Triangle (PAT)
    pub pat: PediatricAssessmentTriangle,
    /// Pain assessment
    pub pain: PediatricPain,
    /// Developmental assessment
    pub development: Option<String>,
    /// SAMPLE history from parent/caregiver
    pub history: PediatricHistory,
    /// Immunization status
    pub immunizations: String,
    /// Child abuse screening
    pub abuse_screening: AbuseScreening,
    /// Parent/Guardian present?
    pub guardian_present: bool,
    /// Guardian name
    pub guardian_name: Option<String>,
    /// Relationship
    pub guardian_relationship: Option<String>,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time
    pub assessed_at: i64,
}

/// Pediatric age representation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PediatricAge {
    /// Years
    pub years: u8,
    /// Months
    pub months: u8,
    /// Days (for neonates)
    pub days: Option<u8>,
    /// Age category
    pub category: PediatricAgeCategory,
}

/// Pediatric age categories
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PediatricAgeCategory {
    Neonate,    // 0-28 days
    Infant,     // 1-12 months
    Toddler,    // 1-3 years
    Preschool,  // 3-5 years
    SchoolAge,  // 6-12 years
    Adolescent, // 13-18 years
}

/// Weight estimation method
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum WeightEstimationMethod {
    Measured,
    BroseloeTape,
    ParentReport,
    AgeBased,
}

/// Pediatric vital signs with age-specific interpretation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PediatricVitalSigns {
    /// Heart rate
    pub heart_rate: u16,
    /// HR interpretation for age
    pub hr_interpretation: VitalInterpretation,
    /// Respiratory rate
    pub respiratory_rate: u16,
    /// RR interpretation for age
    pub rr_interpretation: VitalInterpretation,
    /// Blood pressure (systolic)
    pub systolic_bp: Option<u16>,
    /// BP interpretation for age
    pub bp_interpretation: VitalInterpretation,
    /// Temperature
    pub temperature_celsius: f32,
    /// Temp interpretation
    pub temp_interpretation: VitalInterpretation,
    /// SpO2
    pub spo2: Option<u8>,
    /// Capillary refill (seconds)
    pub capillary_refill_sec: Option<u8>,
}

/// Vital sign interpretation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum VitalInterpretation {
    Normal,
    Low,
    High,
    Critical,
    NotMeasured,
}

/// Pediatric Assessment Triangle (PAT)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PediatricAssessmentTriangle {
    /// Appearance (TICLS)
    pub appearance: PATAppearance,
    /// Work of Breathing
    pub work_of_breathing: PATBreathing,
    /// Circulation to Skin
    pub circulation: PATCirculation,
    /// Overall impression
    pub impression: String,
}

/// PAT Appearance (TICLS)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PATAppearance {
    /// Tone - moving, good muscle tone?
    pub tone: String,
    /// Interactiveness - alert, engaged?
    pub interactiveness: String,
    /// Consolability - can be consoled?
    pub consolability: String,
    /// Look/Gaze - tracking, making eye contact?
    pub look_gaze: String,
    /// Speech/Cry - strong cry, normal speech?
    pub speech_cry: String,
    /// Normal or abnormal?
    pub status: PATStatus,
}

/// PAT Work of Breathing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PATBreathing {
    /// Abnormal sounds (stridor, wheezing, grunting)
    pub abnormal_sounds: Vec<String>,
    /// Abnormal positioning (tripod, sniffing)
    pub abnormal_positioning: bool,
    /// Retractions
    pub retractions: bool,
    /// Nasal flaring
    pub nasal_flaring: bool,
    /// Normal or abnormal?
    pub status: PATStatus,
}

/// PAT Circulation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PATCirculation {
    /// Skin color
    pub skin_color: String,
    /// Mottling?
    pub mottling: bool,
    /// Pallor?
    pub pallor: bool,
    /// Cyanosis?
    pub cyanosis: bool,
    /// Normal or abnormal?
    pub status: PATStatus,
}

/// PAT status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PATStatus {
    Normal,
    Abnormal,
}

/// Pediatric pain assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PediatricPain {
    /// Pain scale used
    pub scale_used: PediatricPainScale,
    /// Pain score
    pub score: u8,
    /// Location
    pub location: Option<String>,
    /// Description
    pub description: Option<String>,
}

/// Pediatric pain scales
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PediatricPainScale {
    /// FLACC for infants/preverbal (0-10)
    FLACC,
    /// Wong-Baker Faces (0-10)
    WongBakerFaces,
    /// Numeric (0-10)
    Numeric,
    /// CRIES for neonates
    CRIES,
}

/// Pediatric history from parent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PediatricHistory {
    /// Birth history (if relevant)
    pub birth_history: Option<String>,
    /// Prematurity?
    pub premature: Option<bool>,
    /// Gestational age if premature
    pub gestational_age_weeks: Option<u8>,
    /// Chronic conditions
    pub chronic_conditions: Vec<String>,
    /// Previous hospitalizations
    pub previous_hospitalizations: Vec<String>,
    /// Current medications
    pub medications: Vec<String>,
    /// Allergies
    pub allergies: Vec<String>,
    /// Last oral intake
    pub last_intake: String,
    /// Recent illness/exposures
    pub recent_illness: Option<String>,
}

/// Child abuse screening
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbuseScreening {
    /// Screening performed?
    pub performed: bool,
    /// Concerns identified?
    pub concerns: bool,
    /// Injury consistent with history?
    pub injury_consistent: Option<bool>,
    /// Red flags noted
    pub red_flags: Vec<String>,
    /// Child Protective Services notified?
    pub cps_notified: bool,
    /// CPS report number
    pub cps_report: Option<String>,
}

// ----------------------------------------------------------------------------
// OBSTETRIC EMERGENCY
// ----------------------------------------------------------------------------

/// Obstetric emergency assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObstetricEmergency {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Gestational age
    pub gestational_age: GestationalAge,
    /// Gravida/Para
    pub gravida: u8,
    /// Para
    pub para: u8,
    /// Living children
    pub living: u8,
    /// Prenatal care?
    pub prenatal_care: bool,
    /// Complications this pregnancy
    pub pregnancy_complications: Vec<String>,
    /// Chief complaint
    pub chief_complaint: String,
    /// Emergency type
    pub emergency_type: ObstetricEmergencyType,
    /// Contractions
    pub contractions: Option<ContractionAssessment>,
    /// Fetal assessment
    pub fetal_assessment: FetalAssessment,
    /// Vaginal bleeding
    pub vaginal_bleeding: Option<VaginalBleeding>,
    /// Cervical exam (if performed)
    pub cervical_exam: Option<CervicalExam>,
    /// Interventions
    pub interventions: Vec<String>,
    /// OB consulted?
    pub ob_consulted: bool,
    /// Disposition
    pub disposition: String,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time
    pub assessed_at: i64,
}

/// Gestational age
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GestationalAge {
    /// Weeks
    pub weeks: u8,
    /// Days
    pub days: u8,
    /// Method of determination
    pub method: String,
    /// EDD (estimated due date)
    pub edd: Option<String>,
}

/// Obstetric emergency types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ObstetricEmergencyType {
    PreTermLabor,
    TermLabor,
    PlacentaPrevia,
    PlacntalAbruption,
    Preeclampsia,
    Eclampsia,
    EctopicPregnancy,
    ThreatenedAbortion,
    PPROM,
    UmbilicalCordProlapse,
    FetalDistress,
    PostpartumHemorrhage,
    Other,
}

/// Contraction assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractionAssessment {
    /// Contractions present?
    pub present: bool,
    /// Frequency (minutes apart)
    pub frequency_minutes: Option<u8>,
    /// Duration (seconds)
    pub duration_seconds: Option<u8>,
    /// Intensity (mild, moderate, strong)
    pub intensity: Option<String>,
    /// Regular?
    pub regular: bool,
}

/// Fetal assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetalAssessment {
    /// Fetal heart rate
    pub fhr: Option<u16>,
    /// FHR normal range (110-160)?
    pub fhr_normal: Option<bool>,
    /// Fetal movement reported?
    pub fetal_movement: Option<bool>,
    /// Presentation (if known)
    pub presentation: Option<String>,
    /// Fetal monitoring initiated?
    pub monitoring: bool,
}

/// Vaginal bleeding assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaginalBleeding {
    /// Amount
    pub amount: BleedingAmount,
    /// Color (bright red, dark)
    pub color: String,
    /// Clots present?
    pub clots: bool,
    /// Associated with pain?
    pub with_pain: bool,
}

/// Bleeding amount
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BleedingAmount {
    Spotting,
    Light,
    Moderate,
    Heavy,
}

/// Cervical exam
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CervicalExam {
    /// Dilation (cm)
    pub dilation_cm: f32,
    /// Effacement (%)
    pub effacement_percent: u8,
    /// Station (-3 to +3)
    pub station: i8,
    /// Membranes (intact, ruptured)
    pub membranes: String,
    /// Presenting part
    pub presenting_part: String,
}

// ============================================================================
// PHASE 7: LABORATORY DOCUMENTATION
// ============================================================================

// ----------------------------------------------------------------------------
// SPECIMEN COLLECTION
// ----------------------------------------------------------------------------

/// Specimen collection record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecimenCollection {
    /// Collection ID
    pub collection_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Accession number
    pub accession_number: String,
    /// Test ordered
    pub test_ordered: String,
    /// Specimen type
    pub specimen_type: SpecimenType,
    /// Collection site
    pub collection_site: String,
    /// Collection time
    pub collection_time: i64,
    /// Collected by
    pub collected_by: String,
    /// Collection method
    pub collection_method: String,
    /// Tube type/container
    pub container_type: String,
    /// Number of tubes/containers
    pub container_count: u8,
    /// Volume collected (mL)
    pub volume_ml: Option<f32>,
    /// Patient fasting?
    pub fasting: Option<bool>,
    /// Special handling instructions
    pub special_handling: Vec<String>,
    /// Chain of custody required?
    pub chain_of_custody: bool,
    /// Patient identification verified?
    pub patient_id_verified: bool,
    /// Verification method
    pub verification_method: String,
    /// Labeling complete?
    pub labeling_complete: bool,
    /// Transport time to lab
    pub transport_time: Option<i64>,
    /// Specimen condition on receipt
    pub condition_on_receipt: Option<SpecimenCondition>,
}

/// Specimen types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SpecimenType {
    Blood,
    Urine,
    Stool,
    Sputum,
    CSF,
    Wound,
    Throat,
    Nasal,
    Tissue,
    Fluid,
    Other,
}

/// Specimen condition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SpecimenCondition {
    Acceptable,
    Hemolyzed,
    Lipemic,
    Clotted,
    InsufficientVolume,
    Contaminated,
    IncorrectContainer,
    Mislabeled,
    Damaged,
}

/// Chain of custody form
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainOfCustody {
    /// Form ID
    pub form_id: String,
    /// Specimen ID
    pub specimen_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Reason for custody tracking
    pub reason: ChainOfCustodyReason,
    /// Chain entries (each handoff)
    pub chain: Vec<CustodyEntry>,
    /// Seal intact throughout?
    pub seal_intact: bool,
    /// Storage conditions maintained?
    pub storage_conditions_met: bool,
    /// Final disposition
    pub final_disposition: String,
}

/// Chain of custody reasons
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ChainOfCustodyReason {
    DrugScreen,
    Forensic,
    Legal,
    Workplace,
    Other,
}

/// Individual custody transfer entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustodyEntry {
    /// Entry number
    pub entry_number: u8,
    /// Released by
    pub released_by: String,
    /// Received by
    pub received_by: String,
    /// Transfer time
    pub transfer_time: i64,
    /// Purpose of transfer
    pub purpose: String,
    /// Specimen condition
    pub condition: String,
}

// ----------------------------------------------------------------------------
// LABORATORY QC
// ----------------------------------------------------------------------------

/// Quality Control documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabQCRecord {
    /// QC Record ID
    pub qc_id: String,
    /// Date
    pub date: String,
    /// Analyzer/Instrument
    pub instrument: String,
    /// Test/Analyte
    pub test: String,
    /// QC level (1, 2, 3)
    pub qc_level: u8,
    /// QC material lot number
    pub lot_number: String,
    /// Expected value/range
    pub expected_range: String,
    /// Observed value
    pub observed_value: f32,
    /// Unit
    pub unit: String,
    /// Within range?
    pub within_range: bool,
    /// Out of range action taken
    pub action_taken: Option<String>,
    /// Reviewed by
    pub reviewed_by: String,
    /// Review time
    pub review_time: i64,
    /// Comments
    pub comments: Option<String>,
}

/// Critical value notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriticalValueNotification {
    /// Notification ID
    pub notification_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Test name
    pub test_name: String,
    /// Critical value
    pub critical_value: String,
    /// Unit
    pub unit: String,
    /// Critical range reference
    pub critical_range: String,
    /// Verified by (second tech)
    pub verified_by: Option<String>,
    /// Verification time
    pub verification_time: Option<i64>,
    /// Provider notified
    pub provider_notified: String,
    /// Notification time
    pub notification_time: i64,
    /// Notification method (phone, page, etc.)
    pub notification_method: String,
    /// Read-back verified?
    pub read_back_verified: bool,
    /// Provider acknowledgment
    pub provider_acknowledgment: Option<String>,
    /// Lab technician
    pub lab_technician: String,
    /// Comments
    pub comments: Option<String>,
}

/// Specimen rejection form
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecimenRejection {
    /// Rejection ID
    pub rejection_id: String,
    /// Accession number
    pub accession_number: String,
    /// Patient ID
    pub patient_id: String,
    /// Test ordered
    pub test_ordered: String,
    /// Rejection reason
    pub rejection_reason: RejectionReason,
    /// Rejection reason details
    pub rejection_details: String,
    /// Recollection required?
    pub recollection_required: bool,
    /// Ordering provider notified?
    pub provider_notified: bool,
    /// Notification time
    pub notification_time: Option<i64>,
    /// Specimen disposed?
    pub disposed: bool,
    /// Disposal time
    pub disposal_time: Option<i64>,
    /// Rejected by
    pub rejected_by: String,
    /// Rejection time
    pub rejection_time: i64,
}

/// Specimen rejection reasons
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RejectionReason {
    Hemolyzed,
    Clotted,
    InsufficientQuantity,
    IncorrectContainer,
    Unlabeled,
    Mislabeled,
    Leaked,
    Expired,
    ImproperStorage,
    WrongPatient,
    NoOrderOnFile,
    DuplicateOrder,
    Contaminated,
    Other,
}

// ============================================================================
// PHASE 8: DISCHARGE & ORDERS DOCUMENTATION
// ============================================================================

// ----------------------------------------------------------------------------
// PHYSICIAN ORDERS
// ----------------------------------------------------------------------------

/// Physician order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicianOrder {
    /// Order ID
    pub order_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Order category
    pub category: OrderCategory,
    /// Order text
    pub order_text: String,
    /// Priority
    pub priority: OrderPriority,
    /// Start date/time
    pub start_time: i64,
    /// End date/time (if applicable)
    pub end_time: Option<i64>,
    /// Frequency (for recurring orders)
    pub frequency: Option<String>,
    /// Special instructions
    pub instructions: Option<String>,
    /// Ordering provider
    pub ordering_provider: String,
    /// Order time
    pub order_time: i64,
    /// Verbal/telephone order?
    pub verbal_order: bool,
    /// Read back verified (for verbal orders)
    pub read_back: Option<bool>,
    /// Co-signature required?
    pub cosign_required: bool,
    /// Co-signed by
    pub cosigned_by: Option<String>,
    /// Status
    pub status: OrderStatus,
    /// Acknowledged by
    pub acknowledged_by: Option<String>,
    /// Acknowledged time
    pub acknowledged_time: Option<i64>,
}

/// Order categories
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum OrderCategory {
    Medication,
    Laboratory,
    Imaging,
    Procedure,
    Consult,
    Diet,
    Activity,
    Nursing,
    Respiratory,
    IV,
    Discharge,
    Other,
}

/// Order priority
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum OrderPriority {
    Stat,
    Urgent,
    Routine,
    Scheduled,
    PRN,
}

/// Order status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum OrderStatus {
    Active,
    Pending,
    Completed,
    Discontinued,
    Cancelled,
    OnHold,
}

/// Order set (pre-defined collection of orders)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderSet {
    /// Order set ID
    pub order_set_id: String,
    /// Name
    pub name: String,
    /// Description
    pub description: String,
    /// Category (Admission, Post-op, etc.)
    pub category: String,
    /// Orders in set
    pub orders: Vec<OrderSetItem>,
    /// Created by
    pub created_by: String,
    /// Last updated
    pub updated_at: i64,
}

/// Order set item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderSetItem {
    /// Sequence number
    pub sequence: u8,
    /// Order template
    pub order_template: String,
    /// Category
    pub category: OrderCategory,
    /// Required (vs optional)
    pub required: bool,
    /// Default values
    pub defaults: Option<String>,
}

// ----------------------------------------------------------------------------
// DISCHARGE DOCUMENTATION
// ----------------------------------------------------------------------------

/// Discharge summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DischargeSummary {
    /// Summary ID
    pub summary_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Admission date
    pub admission_date: String,
    /// Discharge date
    pub discharge_date: String,
    /// Length of stay (days)
    pub length_of_stay_days: u16,
    /// Admitting diagnosis
    pub admitting_diagnosis: String,
    /// Discharge diagnoses (ICD-10)
    pub discharge_diagnoses: Vec<DiagnosisCode>,
    /// Principal procedure
    pub principal_procedure: Option<String>,
    /// Other procedures
    pub procedures: Vec<String>,
    /// Hospital course
    pub hospital_course: String,
    /// Significant findings
    pub significant_findings: Vec<String>,
    /// Condition at discharge
    pub condition_at_discharge: DischargeCondition,
    /// Discharge disposition
    pub disposition: DischargeDisposition,
    /// Discharge medications
    pub medications: Vec<DischargeMedication>,
    /// Medication reconciliation completed
    pub med_reconciliation_complete: bool,
    /// Follow-up appointments
    pub follow_up: Vec<FollowUpAppointment>,
    /// Discharge instructions given
    pub instructions_given: bool,
    /// Patient/family education
    pub education: Vec<String>,
    /// Pending tests at discharge
    pub pending_tests: Vec<String>,
    /// Instructions for pending results
    pub pending_results_plan: Option<String>,
    /// Attending physician
    pub attending_physician: String,
    /// Primary care physician notified
    pub pcp_notified: bool,
    /// Dictated by
    pub dictated_by: String,
    /// Dictation time
    pub dictation_time: i64,
    /// Signed by
    pub signed_by: Option<String>,
    /// Signature time
    pub signature_time: Option<i64>,
}

/// Diagnosis code
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosisCode {
    /// ICD-10 code
    pub icd10_code: String,
    /// Description
    pub description: String,
    /// Primary/secondary
    pub rank: DiagnosisRank,
    /// Present on admission?
    pub present_on_admission: Option<bool>,
}

/// Diagnosis rank
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DiagnosisRank {
    Principal,
    Secondary,
    Complication,
    Comorbidity,
}

/// Discharge condition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DischargeCondition {
    Improved,
    Stable,
    Unchanged,
    Worsened,
    Expired,
}

/// Discharge medication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DischargeMedication {
    /// Medication name
    pub name: String,
    /// Dose
    pub dose: String,
    /// Route
    pub route: String,
    /// Frequency
    pub frequency: String,
    /// Duration/quantity
    pub duration: Option<String>,
    /// Instructions
    pub instructions: Option<String>,
    /// New medication?
    pub new_medication: bool,
    /// Changed from admission?
    pub changed: bool,
    /// Change reason
    pub change_reason: Option<String>,
    /// Prescription provided?
    pub prescription_provided: bool,
}

/// Follow-up appointment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FollowUpAppointment {
    /// Provider/specialty
    pub provider: String,
    /// Timeframe
    pub timeframe: String,
    /// Reason
    pub reason: String,
    /// Appointment scheduled?
    pub scheduled: bool,
    /// Appointment date/time
    pub appointment_time: Option<String>,
    /// Contact info
    pub contact_info: Option<String>,
}

/// Discharge instructions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DischargeInstructions {
    /// Instructions ID
    pub instructions_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Diagnosis
    pub diagnosis: String,
    /// Activity restrictions
    pub activity_restrictions: Vec<String>,
    /// Diet instructions
    pub diet: String,
    /// Wound care instructions (if applicable)
    pub wound_care: Option<String>,
    /// Medication instructions
    pub medication_instructions: String,
    /// Warning signs to watch for
    pub warning_signs: Vec<String>,
    /// When to call doctor
    pub call_doctor_if: Vec<String>,
    /// When to go to ER
    pub go_to_er_if: Vec<String>,
    /// Follow-up care
    pub follow_up_care: Vec<String>,
    /// Additional resources
    pub resources: Vec<String>,
    /// Language provided in
    pub language: String,
    /// Interpreter used?
    pub interpreter_used: bool,
    /// Patient verbalized understanding?
    pub patient_verbalized_understanding: bool,
    /// Teach-back method used?
    pub teach_back_used: bool,
    /// Given to (patient, family member, etc.)
    pub given_to: String,
    /// Relationship to patient
    pub recipient_relationship: Option<String>,
    /// Provided by
    pub provided_by: String,
    /// Provided time
    pub provided_time: i64,
}

/// Against Medical Advice (AMA) discharge
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AMADischarge {
    /// AMA ID
    pub ama_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Recommended treatment
    pub recommended_treatment: String,
    /// Risks explained
    pub risks_explained: Vec<String>,
    /// Potential consequences
    pub potential_consequences: Vec<String>,
    /// Patient understands risks?
    pub patient_understands: bool,
    /// Patient competent to make decision?
    pub patient_competent: bool,
    /// Capacity assessment performed?
    pub capacity_assessment: bool,
    /// Patient signature obtained?
    pub patient_signed: bool,
    /// Signature refused?
    pub signature_refused: bool,
    /// Witness name
    pub witness: String,
    /// Physician name
    pub physician: String,
    /// Follow-up offered?
    pub follow_up_offered: bool,
    /// Prescriptions offered?
    pub prescriptions_offered: bool,
    /// Time of AMA
    pub ama_time: i64,
    /// Documentation time
    pub documentation_time: i64,
    /// Documented by
    pub documented_by: String,
}

// ----------------------------------------------------------------------------
// HISTORY & PHYSICAL (H&P)
// ----------------------------------------------------------------------------

/// History and Physical examination
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryAndPhysical {
    /// H&P ID
    pub hp_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Date/time of exam
    pub exam_time: i64,
    /// Chief complaint
    pub chief_complaint: String,
    /// History of present illness (HPI)
    pub hpi: String,
    /// Past medical history
    pub past_medical_history: Vec<String>,
    /// Past surgical history
    pub past_surgical_history: Vec<String>,
    /// Family history
    pub family_history: Vec<String>,
    /// Social history
    pub social_history: SocialHistory,
    /// Medications (home)
    pub medications: Vec<String>,
    /// Allergies
    pub allergies: Vec<AllergyEntry>,
    /// Review of systems
    pub review_of_systems: ReviewOfSystems,
    /// Physical examination
    pub physical_exam: PhysicalExam,
    /// Assessment/Diagnosis
    pub assessment: Vec<String>,
    /// Plan
    pub plan: Vec<String>,
    /// Performed by
    pub performed_by: String,
    /// Cosigned by (if required)
    pub cosigned_by: Option<String>,
}

/// Social history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialHistory {
    /// Tobacco use
    pub tobacco: String,
    /// Pack years (if smoker)
    pub pack_years: Option<f32>,
    /// Alcohol use
    pub alcohol: String,
    /// Illicit drug use
    pub drugs: String,
    /// Occupation
    pub occupation: Option<String>,
    /// Living situation
    pub living_situation: Option<String>,
    /// Marital status
    pub marital_status: Option<String>,
    /// Other relevant social history
    pub other: Option<String>,
}

/// Allergy entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllergyEntry {
    /// Allergen
    pub allergen: String,
    /// Reaction type
    pub reaction: String,
    /// Severity
    pub severity: String,
}

/// Review of Systems
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewOfSystems {
    /// Constitutional
    pub constitutional: String,
    /// Eyes
    pub eyes: String,
    /// ENT
    pub ent: String,
    /// Cardiovascular
    pub cardiovascular: String,
    /// Respiratory
    pub respiratory: String,
    /// GI
    pub gi: String,
    /// GU
    pub gu: String,
    /// Musculoskeletal
    pub musculoskeletal: String,
    /// Integumentary
    pub integumentary: String,
    /// Neurological
    pub neurological: String,
    /// Psychiatric
    pub psychiatric: String,
    /// Endocrine
    pub endocrine: String,
    /// Hematologic/Lymphatic
    pub hematologic: String,
    /// Allergic/Immunologic
    pub allergic: String,
}

/// Physical examination
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicalExam {
    /// General appearance
    pub general: String,
    /// Vital signs
    pub vital_signs: String,
    /// HEENT
    pub heent: String,
    /// Neck
    pub neck: String,
    /// Cardiovascular
    pub cardiovascular: String,
    /// Pulmonary
    pub pulmonary: String,
    /// Abdomen
    pub abdomen: String,
    /// Extremities
    pub extremities: String,
    /// Skin
    pub skin: String,
    /// Neurological
    pub neurological: String,
    /// Psychiatric
    pub psychiatric: Option<String>,
    /// GU/Rectal (if performed)
    pub gu_rectal: Option<String>,
    /// Breast (if performed)
    pub breast: Option<String>,
    /// Back
    pub back: Option<String>,
}

// ----------------------------------------------------------------------------
// CONSULTATION NOTES
// ----------------------------------------------------------------------------

/// Consultation note
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsultationNote {
    /// Consult ID
    pub consult_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Requesting provider
    pub requesting_provider: String,
    /// Consulting service/provider
    pub consulting_provider: String,
    /// Specialty
    pub specialty: String,
    /// Urgency
    pub urgency: ConsultUrgency,
    /// Reason for consultation
    pub reason: String,
    /// Clinical question
    pub clinical_question: String,
    /// Request time
    pub request_time: i64,
    /// Response time
    pub response_time: Option<i64>,
    /// History (relevant to consult)
    pub history: String,
    /// Exam findings
    pub exam_findings: String,
    /// Diagnostic studies reviewed
    pub studies_reviewed: Vec<String>,
    /// Assessment
    pub assessment: String,
    /// Recommendations
    pub recommendations: Vec<String>,
    /// Follow-up plan
    pub follow_up: String,
    /// Consultant signature
    pub consultant_signature: Option<String>,
    /// Signature time
    pub signature_time: Option<i64>,
}

/// Consultation urgency
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConsultUrgency {
    Emergent,
    Urgent,
    Routine,
    Elective,
}

// ----------------------------------------------------------------------------
// PROGRESS NOTES
// ----------------------------------------------------------------------------

/// Daily progress note
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressNote {
    /// Note ID
    pub note_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Note date
    pub note_date: String,
    /// Hospital day
    pub hospital_day: u16,
    /// Post-op day (if applicable)
    pub post_op_day: Option<u16>,
    /// Subjective
    pub subjective: String,
    /// Events overnight
    pub overnight_events: String,
    /// Vital signs summary
    pub vital_signs: String,
    /// I/O summary
    pub io_summary: Option<String>,
    /// Physical exam
    pub exam: String,
    /// Labs/Studies
    pub labs_studies: String,
    /// Assessment by problem
    pub assessment: Vec<ProgressProblem>,
    /// Plan
    pub plan: Vec<String>,
    /// Disposition/estimated discharge
    pub disposition: Option<String>,
    /// Code status
    pub code_status: String,
    /// Attending discussed with
    pub discussed_with: Option<String>,
    /// Author
    pub author: String,
    /// Note time
    pub note_time: i64,
    /// Cosigned by
    pub cosigned_by: Option<String>,
}

/// Progress note problem
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressProblem {
    /// Problem number
    pub problem_number: u8,
    /// Problem description
    pub problem: String,
    /// Status (improving, stable, worsening)
    pub status: String,
    /// Plan for this problem
    pub plan: String,
}

// ============================================================================
// PHASE 9: SURGICAL DOCUMENTATION
// ============================================================================

// ----------------------------------------------------------------------------
// PRE-OPERATIVE ASSESSMENT
// ----------------------------------------------------------------------------

/// Pre-operative assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreOperativeAssessment {
    /// Assessment ID
    pub assessment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Scheduled procedure
    pub scheduled_procedure: String,
    /// Procedure date/time
    pub procedure_datetime: String,
    /// Surgeon
    pub surgeon: String,
    /// Anesthesiologist
    pub anesthesiologist: Option<String>,
    /// NPO status
    pub npo_status: NPOStatus,
    /// Surgical site verified
    pub site_verified: bool,
    /// Site marking complete
    pub site_marked: bool,
    /// Consent signed
    pub consent_signed: bool,
    /// Blood type confirmed
    pub blood_type_confirmed: bool,
    /// Blood products available
    pub blood_available: bool,
    /// Allergies reviewed
    pub allergies_reviewed: bool,
    /// Current medications reviewed
    pub medications_reviewed: bool,
    /// Medications held
    pub medications_held: Vec<String>,
    /// Labs reviewed
    pub labs_reviewed: bool,
    /// Imaging reviewed
    pub imaging_reviewed: bool,
    /// ASA classification
    pub asa_class: ASAClassification,
    /// Airway assessment
    pub airway_assessment: MallampatiScore,
    /// Cardiac risk assessment
    pub cardiac_risk: Option<String>,
    /// DVT prophylaxis ordered
    pub dvt_prophylaxis: bool,
    /// Antibiotic prophylaxis ordered
    pub antibiotic_prophylaxis: Option<String>,
    /// Special equipment needed
    pub special_equipment: Vec<String>,
    /// Pre-op vitals
    pub pre_op_vitals: String,
    /// IV access established
    pub iv_access: bool,
    /// Pre-op checklist complete
    pub checklist_complete: bool,
    /// Notes
    pub notes: Option<String>,
    /// Assessed by
    pub assessed_by: String,
    /// Assessment time
    pub assessed_at: i64,
}

/// NPO (Nothing by mouth) status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NPOStatus {
    /// Last solid food
    pub last_solid: Option<String>,
    /// Last clear liquid
    pub last_liquid: Option<String>,
    /// NPO since (timestamp)
    pub npo_since: Option<i64>,
    /// Meets NPO requirements
    pub compliant: bool,
}

/// ASA Physical Status Classification
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ASAClassification {
    /// Healthy patient
    ASA1,
    /// Mild systemic disease
    ASA2,
    /// Severe systemic disease
    ASA3,
    /// Severe systemic disease - constant threat to life
    ASA4,
    /// Moribund - not expected to survive without surgery
    ASA5,
    /// Brain dead - organ donor
    ASA6,
    /// Emergency modifier (add E)
    Emergency,
}

/// Mallampati airway score
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MallampatiScore {
    /// Soft palate, uvula, fauces, pillars visible
    Class1,
    /// Soft palate, uvula, fauces visible
    Class2,
    /// Soft palate, base of uvula visible
    Class3,
    /// Only hard palate visible
    Class4,
}

// ----------------------------------------------------------------------------
// OPERATIVE NOTE (INTRA-OPERATIVE)
// ----------------------------------------------------------------------------

/// Operative note / Surgical report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperativeNote {
    /// Note ID
    pub note_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Date of surgery
    pub surgery_date: String,
    /// Pre-operative diagnosis
    pub pre_op_diagnosis: Vec<String>,
    /// Post-operative diagnosis
    pub post_op_diagnosis: Vec<String>,
    /// Procedure performed
    pub procedure_performed: String,
    /// CPT codes
    pub cpt_codes: Vec<String>,
    /// Surgeon(s)
    pub surgeons: Vec<SurgicalTeamMember>,
    /// Anesthesia team
    pub anesthesia_team: Vec<String>,
    /// Anesthesia type
    pub anesthesia_type: AnesthesiaType,
    /// Surgical approach
    pub surgical_approach: String,
    /// Incision type/location
    pub incision: String,
    /// Findings
    pub findings: String,
    /// Procedure details (step-by-step)
    pub procedure_details: String,
    /// Specimens removed
    pub specimens: Vec<SurgicalSpecimen>,
    /// Estimated blood loss (mL)
    pub estimated_blood_loss: u32,
    /// Fluids administered
    pub fluids_given: String,
    /// Blood products given
    pub blood_products: Vec<String>,
    /// Drains placed
    pub drains: Vec<SurgicalDrain>,
    /// Implants/devices
    pub implants: Vec<SurgicalImplant>,
    /// Wound closure
    pub wound_closure: String,
    /// Dressing applied
    pub dressing: String,
    /// Complications
    pub complications: Option<String>,
    /// Condition at end of procedure
    pub condition_at_end: String,
    /// Disposition (PACU, ICU, floor)
    pub disposition: String,
    /// Time in OR
    pub time_in_or: i64,
    /// Time out of OR
    pub time_out_or: i64,
    /// Dictated by
    pub dictated_by: String,
    /// Dictation time
    pub dictation_time: i64,
}

/// Surgical team member
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurgicalTeamMember {
    pub name: String,
    pub role: SurgicalRole,
    pub npi: Option<String>,
}

/// Surgical roles
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SurgicalRole {
    PrimarySurgeon,
    Assistant,
    Resident,
    ScrubNurse,
    CirculatingNurse,
    SurgicalTech,
}

/// Anesthesia type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AnesthesiaType {
    General,
    Spinal,
    Epidural,
    Regional,
    LocalWithSedation,
    LocalOnly,
    MAC,
}

/// Surgical specimen
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurgicalSpecimen {
    pub specimen_id: String,
    pub description: String,
    pub sent_to_pathology: bool,
    pub pathology_accession: Option<String>,
}

/// Surgical drain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurgicalDrain {
    pub drain_type: String,
    pub location: String,
    pub size: Option<String>,
}

/// Surgical implant
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurgicalImplant {
    pub implant_type: String,
    pub manufacturer: String,
    pub lot_number: String,
    pub serial_number: Option<String>,
    pub location: String,
}

// ----------------------------------------------------------------------------
// POST-OPERATIVE NOTE
// ----------------------------------------------------------------------------

/// Post-operative note
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostOperativeNote {
    /// Note ID
    pub note_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Surgery date
    pub surgery_date: String,
    /// Procedure
    pub procedure: String,
    /// Post-op day
    pub post_op_day: u16,
    /// Current condition
    pub condition: String,
    /// Pain assessment
    pub pain_score: u8,
    /// Pain management
    pub pain_management: String,
    /// Vital signs stable
    pub vitals_stable: bool,
    /// Diet status
    pub diet: String,
    /// Activity level
    pub activity: String,
    /// Wound assessment
    pub wound: WoundStatus,
    /// Drain output (if applicable)
    pub drain_output: Option<String>,
    /// I/O balance
    pub io_balance: Option<String>,
    /// Foley catheter
    pub foley: Option<String>,
    /// DVT prophylaxis
    pub dvt_prophylaxis: String,
    /// Complications
    pub complications: Option<String>,
    /// Labs pending/results
    pub labs: Option<String>,
    /// Imaging pending/results
    pub imaging: Option<String>,
    /// Plan
    pub plan: Vec<String>,
    /// Estimated discharge
    pub estimated_discharge: Option<String>,
    /// Written by
    pub written_by: String,
    /// Note time
    pub note_time: i64,
}

/// Wound status for post-op
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WoundStatus {
    pub appearance: String,
    pub drainage: Option<String>,
    pub signs_of_infection: bool,
    pub dressing_changed: bool,
}

// ============================================================================
// PHASE 10: ANESTHESIA RECORDS
// ============================================================================

/// Anesthesia record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnesthesiaRecord {
    /// Record ID
    pub record_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Date
    pub date: String,
    /// Procedure
    pub procedure: String,
    /// Anesthesiologist
    pub anesthesiologist: String,
    /// CRNA (if applicable)
    pub crna: Option<String>,
    /// ASA class
    pub asa_class: ASAClassification,
    /// Anesthesia type
    pub anesthesia_type: AnesthesiaType,
    /// Pre-anesthesia assessment
    pub pre_assessment: AnesthesiaPreAssessment,
    /// Airway management
    pub airway: AnesthesiaAirway,
    /// Induction
    pub induction: AnesthesiaInduction,
    /// Maintenance
    pub maintenance: AnesthesiaMaintenance,
    /// Intraoperative events
    pub intraop_events: Vec<AnesthesiaEvent>,
    /// Vital signs record (every 5 min)
    pub vital_signs: Vec<AnesthesiaVitals>,
    /// Medications administered
    pub medications: Vec<AnesthesiaMedication>,
    /// Fluids administered
    pub fluids: Vec<AnesthesiaFluid>,
    /// Blood products
    pub blood_products: Vec<String>,
    /// Emergence
    pub emergence: AnesthesiaEmergence,
    /// Total anesthesia time
    pub anesthesia_time_minutes: u32,
    /// Complications
    pub complications: Vec<String>,
    /// PACU handoff
    pub pacu_handoff: PACUHandoff,
}

/// Pre-anesthesia assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnesthesiaPreAssessment {
    pub airway_exam: String,
    pub mallampati: MallampatiScore,
    pub mouth_opening: String,
    pub neck_mobility: String,
    pub teeth_condition: String,
    pub cardiac_history: String,
    pub pulmonary_history: String,
    pub previous_anesthesia: Option<String>,
    pub family_anesthesia_problems: bool,
    pub consent_obtained: bool,
}

/// Anesthesia airway management
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnesthesiaAirway {
    pub airway_type: String,
    pub tube_size: Option<String>,
    pub blade_type: Option<String>,
    pub blade_size: Option<u8>,
    pub cuff_pressure: Option<u8>,
    pub grade_of_view: Option<String>,
    pub attempts: u8,
    pub confirmed_by: String,
}

/// Anesthesia induction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnesthesiaInduction {
    pub time: i64,
    pub agents: Vec<String>,
    pub muscle_relaxant: Option<String>,
    pub hemodynamic_response: String,
}

/// Anesthesia maintenance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnesthesiaMaintenance {
    pub agents: Vec<String>,
    pub technique: String,
    pub ventilation_mode: String,
    pub fio2: u8,
    pub tidal_volume: Option<u16>,
    pub respiratory_rate: Option<u8>,
    pub peep: Option<u8>,
}

/// Anesthesia intraoperative event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnesthesiaEvent {
    pub time: i64,
    pub event: String,
    pub intervention: Option<String>,
}

/// Anesthesia vital signs (every 5 min)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnesthesiaVitals {
    pub time: i64,
    pub hr: u16,
    pub sbp: u16,
    pub dbp: u16,
    pub map: u16,
    pub spo2: u8,
    pub etco2: Option<u8>,
    pub temp: Option<f32>,
}

/// Anesthesia medication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnesthesiaMedication {
    pub time: i64,
    pub medication: String,
    pub dose: String,
    pub route: String,
}

/// Anesthesia fluid
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnesthesiaFluid {
    pub fluid_type: String,
    pub volume_ml: u32,
    pub start_time: i64,
    pub end_time: Option<i64>,
}

/// Anesthesia emergence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnesthesiaEmergence {
    pub time: i64,
    pub reversal_agents: Vec<String>,
    pub extubation_time: Option<i64>,
    pub awake: bool,
    pub following_commands: bool,
    pub complications: Vec<String>,
}

/// PACU handoff
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PACUHandoff {
    pub arrival_time: i64,
    pub handoff_to: String,
    pub airway_status: String,
    pub hemodynamic_status: String,
    pub pain_score: u8,
    pub nausea_vomiting: bool,
    pub orders_given: Vec<String>,
}

// ============================================================================
// PHASE 11: RADIOLOGY & IMAGING
// ============================================================================

/// Radiology order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadiologyOrder {
    /// Order ID
    pub order_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Study type
    pub study_type: RadiologyStudyType,
    /// Body part
    pub body_part: String,
    /// Laterality
    pub laterality: Option<Laterality>,
    /// Clinical indication
    pub indication: String,
    /// Priority
    pub priority: OrderPriority,
    /// Ordering provider
    pub ordering_provider: String,
    /// Order time
    pub order_time: i64,
    /// Contrast required
    pub contrast: bool,
    /// Allergies reviewed
    pub allergies_reviewed: bool,
    /// Creatinine checked (if contrast)
    pub creatinine_checked: Option<bool>,
    /// Pregnancy status checked (female)
    pub pregnancy_checked: Option<bool>,
    /// Special instructions
    pub special_instructions: Option<String>,
    /// Status
    pub status: RadiologyOrderStatus,
}

/// Radiology study types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RadiologyStudyType {
    XRay,
    CT,
    CTWithContrast,
    MRI,
    MRIWithContrast,
    Ultrasound,
    Nuclear,
    PET,
    Fluoroscopy,
    Mammography,
    Angiography,
}

/// Laterality
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Laterality {
    Left,
    Right,
    Bilateral,
    NA,
}

/// Radiology order status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RadiologyOrderStatus {
    Ordered,
    Scheduled,
    InProgress,
    Completed,
    Preliminary,
    Final,
    Cancelled,
}

/// Radiology report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadiologyReport {
    /// Report ID
    pub report_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Order ID
    pub order_id: String,
    /// Accession number
    pub accession_number: String,
    /// Study type
    pub study_type: RadiologyStudyType,
    /// Body part examined
    pub body_part: String,
    /// Study date/time
    pub study_datetime: i64,
    /// Technique/protocol
    pub technique: String,
    /// Contrast used
    pub contrast: Option<String>,
    /// Comparison studies
    pub comparison: Option<String>,
    /// Clinical history
    pub clinical_history: String,
    /// Findings
    pub findings: String,
    /// Impression
    pub impression: Vec<String>,
    /// Recommendations
    pub recommendations: Option<String>,
    /// Critical finding
    pub critical_finding: bool,
    /// Critical finding communicated
    pub critical_communicated: Option<CriticalCommunication>,
    /// Radiologist
    pub radiologist: String,
    /// Report status
    pub status: RadiologyReportStatus,
    /// Preliminary time
    pub preliminary_time: Option<i64>,
    /// Final time
    pub final_time: Option<i64>,
    /// DICOM study UID
    pub dicom_study_uid: Option<String>,
    /// IPFS hash for images
    pub image_ipfs_hash: Option<String>,
}

/// Critical finding communication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriticalCommunication {
    pub communicated_to: String,
    pub communicated_by: String,
    pub communication_time: i64,
    pub method: String,
    pub read_back: bool,
}

/// Radiology report status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RadiologyReportStatus {
    Preliminary,
    Final,
    Addendum,
    Corrected,
}

// ============================================================================
// PHASE 12: PATHOLOGY REPORTS
// ============================================================================

/// Pathology report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathologyReport {
    /// Report ID
    pub report_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Accession number
    pub accession_number: String,
    /// Specimen type
    pub specimen_type: PathologySpecimenType,
    /// Collection date
    pub collection_date: String,
    /// Received date
    pub received_date: String,
    /// Clinical history
    pub clinical_history: String,
    /// Specimen source
    pub specimen_source: String,
    /// Gross description
    pub gross_description: String,
    /// Microscopic description
    pub microscopic_description: String,
    /// Special stains
    pub special_stains: Vec<SpecialStain>,
    /// Immunohistochemistry
    pub ihc: Vec<IHCResult>,
    /// Molecular studies
    pub molecular: Vec<MolecularResult>,
    /// Diagnosis
    pub diagnosis: Vec<String>,
    /// Synoptic report (for cancer)
    pub synoptic: Option<SynopticReport>,
    /// Comment
    pub comment: Option<String>,
    /// Pathologist
    pub pathologist: String,
    /// Report date
    pub report_date: String,
    /// Status
    pub status: PathologyStatus,
    /// Addenda
    pub addenda: Vec<PathologyAddendum>,
}

/// Pathology specimen types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PathologySpecimenType {
    Biopsy,
    Excision,
    Resection,
    Cytology,
    FNA,
    FluidCytology,
    BoneMarrow,
    Autopsy,
}

/// Special stain result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecialStain {
    pub stain_name: String,
    pub result: String,
}

/// Immunohistochemistry result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IHCResult {
    pub marker: String,
    pub result: String,
    pub interpretation: String,
}

/// Molecular result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MolecularResult {
    pub test_name: String,
    pub result: String,
    pub interpretation: String,
}

/// Synoptic report (cancer staging)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SynopticReport {
    pub tumor_site: String,
    pub histologic_type: String,
    pub histologic_grade: String,
    pub tumor_size: String,
    pub margins: String,
    pub lymph_nodes: String,
    pub stage_t: String,
    pub stage_n: String,
    pub stage_m: String,
    pub ajcc_stage: String,
}

/// Pathology status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PathologyStatus {
    Pending,
    Preliminary,
    Final,
    Amended,
}

/// Pathology addendum
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathologyAddendum {
    pub addendum_id: String,
    pub content: String,
    pub author: String,
    pub date: String,
}

// ============================================================================
// PHASE 13: IMMUNIZATION RECORDS
// ============================================================================

/// Immunization record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImmunizationRecord {
    /// Record ID
    pub record_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Vaccine name
    pub vaccine_name: String,
    /// CVX code (CDC vaccine code)
    pub cvx_code: String,
    /// Manufacturer
    pub manufacturer: String,
    /// Lot number
    pub lot_number: String,
    /// Expiration date
    pub expiration_date: String,
    /// Administration date
    pub administration_date: String,
    /// Dose number in series
    pub dose_number: u8,
    /// Route
    pub route: ImmunizationRoute,
    /// Site
    pub site: String,
    /// Administered by
    pub administered_by: String,
    /// VIS (Vaccine Information Statement) date
    pub vis_date: String,
    /// Funding source
    pub funding_source: FundingSource,
    /// Registry reported
    pub registry_reported: bool,
    /// Adverse reaction
    pub adverse_reaction: Option<String>,
    /// Notes
    pub notes: Option<String>,
}

/// Immunization route
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ImmunizationRoute {
    Intramuscular,
    Subcutaneous,
    Intradermal,
    Oral,
    Intranasal,
}

/// Funding source
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FundingSource {
    Private,
    PublicVFC,
    PublicState,
    Military,
    Other,
}

/// Immunization schedule / Due list
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImmunizationSchedule {
    /// Patient ID
    pub patient_id: String,
    /// Age (for schedule calculation)
    pub patient_age_months: u16,
    /// Due vaccines
    pub due_vaccines: Vec<DueVaccine>,
    /// Overdue vaccines
    pub overdue_vaccines: Vec<DueVaccine>,
    /// Completed vaccines
    pub completed_vaccines: Vec<String>,
    /// Contraindicated vaccines
    pub contraindicated: Vec<ContraindicatedVaccine>,
}

/// Due vaccine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DueVaccine {
    pub vaccine_name: String,
    pub dose_number: u8,
    pub due_date: String,
    pub catch_up_date: Option<String>,
}

/// Contraindicated vaccine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContraindicatedVaccine {
    pub vaccine_name: String,
    pub reason: String,
    pub documented_by: String,
    pub documentation_date: String,
}

// ============================================================================
// PHASE 14: FAMILY HISTORY
// ============================================================================

/// Family medical history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyMedicalHistory {
    /// Patient ID
    pub patient_id: String,
    /// Family members
    pub family_members: Vec<FamilyHistoryMember>,
    /// Genetic conditions in family
    pub genetic_conditions: Vec<GeneticCondition>,
    /// Three-generation history complete
    pub three_gen_complete: bool,
    /// Last updated
    pub last_updated: i64,
    /// Updated by
    pub updated_by: String,
}

/// Family history member (for medical history)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyHistoryMember {
    /// Relationship
    pub relationship: FamilyHistoryRelationship,
    /// Living status
    pub living: bool,
    /// Current age (if living)
    pub current_age: Option<u8>,
    /// Age at death
    pub age_at_death: Option<u8>,
    /// Cause of death
    pub cause_of_death: Option<String>,
    /// Medical conditions
    pub conditions: Vec<FamilyCondition>,
}

/// Family relationship for medical history
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FamilyHistoryRelationship {
    Mother,
    Father,
    MaternalGrandmother,
    MaternalGrandfather,
    PaternalGrandmother,
    PaternalGrandfather,
    Sister,
    Brother,
    Daughter,
    Son,
    MaternalAunt,
    MaternalUncle,
    PaternalAunt,
    PaternalUncle,
    Other,
}

/// Family condition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyCondition {
    pub condition: String,
    pub age_at_diagnosis: Option<u8>,
    pub notes: Option<String>,
}

/// Genetic condition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneticCondition {
    pub condition_name: String,
    pub inheritance_pattern: InheritancePattern,
    pub affected_members: Vec<String>,
    pub genetic_testing_done: bool,
    pub test_results: Option<String>,
}

/// Inheritance pattern
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum InheritancePattern {
    AutosomalDominant,
    AutosomalRecessive,
    XLinked,
    Mitochondrial,
    Multifactorial,
    Unknown,
}

// ============================================================================
// PHASE 15: BLOOD BANK
// ============================================================================

/// Blood type and screen
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BloodTypeScreen {
    /// Test ID
    pub test_id: String,
    /// Patient ID
    pub patient_id: String,
    /// ABO type
    pub abo_type: ABOType,
    /// Rh type
    pub rh_type: RhType,
    /// Antibody screen
    pub antibody_screen: AntibodyScreen,
    /// Collection time
    pub collection_time: i64,
    /// Expiration (72 hours for crossmatch)
    pub expiration: i64,
    /// Performed by
    pub performed_by: String,
    /// Verified by
    pub verified_by: String,
}

/// ABO blood type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ABOType {
    A,
    B,
    AB,
    O,
}

/// Rh type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RhType {
    Positive,
    Negative,
}

/// Antibody screen
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AntibodyScreen {
    pub result: AntibodyResult,
    pub antibodies_identified: Vec<String>,
    pub clinical_significance: Option<String>,
}

/// Antibody result
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AntibodyResult {
    Negative,
    Positive,
    Inconclusive,
}

/// Crossmatch record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossmatchRecord {
    /// Crossmatch ID
    pub crossmatch_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Type and screen ID
    pub type_screen_id: String,
    /// Units crossmatched
    pub units: Vec<CrossmatchedUnit>,
    /// Crossmatch type
    pub crossmatch_type: CrossmatchType,
    /// Performed by
    pub performed_by: String,
    /// Performed at
    pub performed_at: i64,
    /// Expiration
    pub expiration: i64,
}

/// Crossmatched unit
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossmatchedUnit {
    pub unit_number: String,
    pub product_type: BloodProductType,
    pub abo_rh: String,
    pub expiration: String,
    pub crossmatch_result: CrossmatchResult,
}

/// Crossmatch type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CrossmatchType {
    Electronic,
    Immediate,
    Full,
}

/// Crossmatch result
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CrossmatchResult {
    Compatible,
    Incompatible,
    Pending,
}

/// Transfusion record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransfusionRecord {
    /// Transfusion ID
    pub transfusion_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Unit number
    pub unit_number: String,
    /// Product type
    pub product_type: BloodProductType,
    /// ABO/Rh
    pub abo_rh: String,
    /// Indication
    pub indication: String,
    /// Consent obtained
    pub consent_obtained: bool,
    /// Pre-transfusion vitals
    pub pre_vitals: TransfusionVitals,
    /// Patient ID verification
    pub patient_verified: PatientVerification,
    /// Start time
    pub start_time: i64,
    /// End time
    pub end_time: Option<i64>,
    /// Volume transfused (mL)
    pub volume_ml: u32,
    /// Rate (mL/hr)
    pub rate: u16,
    /// Monitoring vitals (q15 min x 1hr, then q30 min)
    pub monitoring_vitals: Vec<TransfusionVitals>,
    /// Reaction
    pub reaction: Option<TransfusionReaction>,
    /// Post-transfusion vitals
    pub post_vitals: Option<TransfusionVitals>,
    /// Administered by
    pub administered_by: String,
}

/// Transfusion vitals
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransfusionVitals {
    pub time: i64,
    pub temp_c: f32,
    pub hr: u16,
    pub bp: String,
    pub rr: u16,
    pub spo2: u8,
}

/// Patient verification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientVerification {
    pub patient_id_band: bool,
    pub patient_stated_name: bool,
    pub patient_stated_dob: bool,
    pub unit_label_matches: bool,
    pub verified_by_nurse: String,
    pub verified_by_second: String,
}

/// Transfusion reaction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransfusionReaction {
    pub reaction_type: TransfusionReactionType,
    pub onset_time: i64,
    pub symptoms: Vec<String>,
    pub transfusion_stopped: bool,
    pub blood_bank_notified: bool,
    pub physician_notified: bool,
    pub treatment: Vec<String>,
    pub outcome: String,
}

/// Transfusion reaction types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TransfusionReactionType {
    Febrile,
    Allergic,
    Anaphylactic,
    Hemolytic,
    TRALI,
    TACO,
    Septic,
    Other,
}

// ============================================================================
// PHASE 16: E-PRESCRIBING
// ============================================================================

/// Electronic prescription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElectronicPrescription {
    /// Prescription ID
    pub rx_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Medication name
    pub medication_name: String,
    /// Generic name
    pub generic_name: String,
    /// NDC code
    pub ndc_code: Option<String>,
    /// RxNorm code
    pub rxnorm_code: Option<String>,
    /// Strength
    pub strength: String,
    /// Form (tablet, capsule, etc.)
    pub form: MedicationForm,
    /// Directions (sig)
    pub directions: String,
    /// Quantity
    pub quantity: u32,
    /// Quantity unit
    pub quantity_unit: String,
    /// Days supply
    pub days_supply: u16,
    /// Refills
    pub refills: u8,
    /// DAW (Dispense as Written)
    pub daw: bool,
    /// Prescriber
    pub prescriber: PrescriberInfo,
    /// Pharmacy
    pub pharmacy: PharmacyInfo,
    /// Written date
    pub written_date: String,
    /// Effective date
    pub effective_date: String,
    /// Expiration date
    pub expiration_date: String,
    /// Diagnosis codes
    pub diagnosis_codes: Vec<String>,
    /// Prior authorization
    pub prior_auth: Option<PriorAuthorization>,
    /// Controlled substance schedule
    pub schedule: Option<ControlledSchedule>,
    /// Status
    pub status: PrescriptionStatus,
    /// Transmission time
    pub transmitted_at: Option<i64>,
    /// Notes to pharmacist
    pub pharmacist_notes: Option<String>,
    /// Set true when the prescriber acknowledges and overrides an interaction
    /// warning at prescribe time (required to save a contraindicated combination).
    #[serde(default)]
    pub override_interactions: bool,
    /// Free-text reason recorded when overriding a contraindicated interaction.
    #[serde(default)]
    pub override_reason: Option<String>,
}

/// Medication form
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MedicationForm {
    Tablet,
    Capsule,
    Liquid,
    Injection,
    Cream,
    Ointment,
    Patch,
    Inhaler,
    Drops,
    Suppository,
    Other,
}

/// Prescriber information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrescriberInfo {
    pub name: String,
    pub npi: String,
    pub dea_number: Option<String>,
    pub state_license: String,
    pub phone: String,
    pub fax: Option<String>,
}

/// Pharmacy information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PharmacyInfo {
    pub name: String,
    pub ncpdp_id: String,
    pub npi: String,
    pub address: String,
    pub phone: String,
    pub fax: String,
}

/// Prior authorization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriorAuthorization {
    pub required: bool,
    pub status: PAStatus,
    pub auth_number: Option<String>,
    pub expiration: Option<String>,
}

/// Prior auth status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PAStatus {
    Required,
    Pending,
    Approved,
    Denied,
    NotRequired,
}

/// Controlled substance schedule
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ControlledSchedule {
    ScheduleII,
    ScheduleIII,
    ScheduleIV,
    ScheduleV,
    NonControlled,
}

/// Prescription status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PrescriptionStatus {
    Draft,
    Pending,
    Signed,
    Transmitted,
    Received,
    InProgress,
    Dispensed,
    PartialFill,
    Cancelled,
    Expired,
    Error,
}

// ============================================================================
// PHASE 17: APPOINTMENTS & SCHEDULING
// ============================================================================

/// Appointment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Appointment {
    /// Appointment ID
    pub appointment_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Provider ID
    pub provider_id: String,
    /// Provider name
    pub provider_name: String,
    /// Appointment type
    pub appointment_type: AppointmentType,
    /// Visit reason
    pub visit_reason: String,
    /// Scheduled date
    pub scheduled_date: String,
    /// Start time
    pub start_time: String,
    /// Scheduled timestamp (Unix)
    pub scheduled_time: Option<i64>,
    /// Duration (minutes)
    pub duration_minutes: u16,
    /// Location
    pub location: AppointmentLocation,
    /// Status
    pub status: AppointmentStatus,
    /// Created at
    pub created_at: i64,
    /// Updated at
    pub updated_at: i64,
    /// Created by
    pub created_by: String,
    /// Booked by (user who booked the appointment)
    pub booked_by: Option<String>,
    /// Check-in time
    pub check_in_time: Option<i64>,
    /// Is telehealth appointment
    pub is_telehealth: bool,
    /// Reminders sent
    pub reminders_sent: Vec<AppointmentReminder>,
    /// Instructions
    pub instructions: Option<String>,
    /// Insurance verified
    pub insurance_verified: bool,
    /// Notes
    pub notes: Option<String>,
}

/// Appointment type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AppointmentType {
    NewPatient,
    FollowUp,
    Urgent,
    Telehealth,
    Procedure,
    PreOp,
    PostOp,
    AnnualExam,
    Consultation,
    LabWork,
    Imaging,
    Other,
}

/// Appointment location
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppointmentLocation {
    pub facility_name: String,
    pub department: String,
    pub room: Option<String>,
    pub address: Option<String>,
    pub telehealth_link: Option<String>,
}

/// Appointment status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AppointmentStatus {
    Scheduled,
    Confirmed,
    CheckedIn,
    InProgress,
    Completed,
    NoShow,
    Cancelled,
    Rescheduled,
    Waitlisted,
}

/// Appointment reminder
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppointmentReminder {
    pub reminder_type: ReminderType,
    pub sent_at: i64,
    pub status: ReminderStatus,
}

/// Reminder type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ReminderType {
    SMS,
    Email,
    Phone,
    Push,
}

/// Reminder status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ReminderStatus {
    Sent,
    Delivered,
    Failed,
    Acknowledged,
}

// ============================================================================
// PHASE 18: DEATH CERTIFICATE & AUTOPSY
// ============================================================================

/// Death certificate
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeathCertificate {
    /// Certificate ID
    pub certificate_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Decedent name
    pub decedent_name: String,
    /// Date of birth
    pub date_of_birth: String,
    /// Date of death
    pub date_of_death: String,
    /// Time of death
    pub time_of_death: String,
    /// Place of death
    pub place_of_death: PlaceOfDeath,
    /// Manner of death
    pub manner_of_death: MannerOfDeath,
    /// Cause of death
    pub cause_of_death: CauseOfDeath,
    /// Autopsy performed
    pub autopsy_performed: bool,
    /// Autopsy findings available
    pub autopsy_findings_available: Option<bool>,
    /// Certifying physician
    pub certifying_physician: String,
    /// Physician license number
    pub physician_license: String,
    /// Date certified
    pub date_certified: String,
    /// Medical examiner/coroner case
    pub me_case: bool,
    /// ME case number
    pub me_case_number: Option<String>,
}

/// Place of death
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceOfDeath {
    pub facility_type: DeathFacilityType,
    pub facility_name: Option<String>,
    pub address: String,
    pub city: String,
    pub state: String,
    pub country: String,
}

/// Death facility type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DeathFacilityType {
    Hospital,
    NursingHome,
    Hospice,
    Home,
    Other,
}

/// Manner of death
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MannerOfDeath {
    Natural,
    Accident,
    Suicide,
    Homicide,
    Pending,
    Undetermined,
}

/// Cause of death (chain)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CauseOfDeath {
    /// Immediate cause (line a)
    pub immediate_cause: String,
    /// Interval from onset to death
    pub immediate_interval: String,
    /// Intermediate cause (line b) - sequentially leading to immediate
    pub intermediate_cause_b: Option<String>,
    pub intermediate_interval_b: Option<String>,
    /// Line c
    pub intermediate_cause_c: Option<String>,
    pub intermediate_interval_c: Option<String>,
    /// Underlying cause (line d)
    pub underlying_cause: Option<String>,
    pub underlying_interval: Option<String>,
    /// Other significant conditions
    pub other_significant: Vec<String>,
}

/// Autopsy request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutopsyRequest {
    /// Request ID
    pub request_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Requesting physician
    pub requesting_physician: String,
    /// Reason for autopsy
    pub reason: AutopsyReason,
    /// Clinical history summary
    pub clinical_summary: String,
    /// Questions to be answered
    pub questions: Vec<String>,
    /// Family consent obtained
    pub family_consent: bool,
    /// Consent signed by
    pub consent_signed_by: Option<String>,
    /// Relationship to decedent
    pub consenter_relationship: Option<String>,
    /// Request date
    pub request_date: String,
    /// Status
    pub status: AutopsyStatus,
    /// Pathologist assigned
    pub pathologist_assigned: Option<String>,
    /// Scheduled date
    pub scheduled_date: Option<String>,
}

/// Autopsy reason
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AutopsyReason {
    UnknownCause,
    QualityAssurance,
    FamilyRequest,
    LegalRequirement,
    Research,
    Education,
}

/// Autopsy status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AutopsyStatus {
    Requested,
    ConsentPending,
    Approved,
    Scheduled,
    InProgress,
    Completed,
    Declined,
}

/// Autopsy report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutopsyReport {
    /// Report ID
    pub report_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Autopsy date
    pub autopsy_date: String,
    /// Pathologist
    pub pathologist: String,
    /// External examination
    pub external_exam: String,
    /// Internal examination
    pub internal_exam: InternalExam,
    /// Microscopic findings
    pub microscopic: String,
    /// Toxicology results
    pub toxicology: Option<String>,
    /// Final diagnoses
    pub diagnoses: Vec<String>,
    /// Cause of death
    pub cause_of_death: CauseOfDeath,
    /// Opinion
    pub opinion: String,
    /// Report date
    pub report_date: String,
}

/// Internal exam sections
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternalExam {
    pub cardiovascular: String,
    pub respiratory: String,
    pub gastrointestinal: String,
    pub genitourinary: String,
    pub hepatobiliary: String,
    pub hematopoietic: String,
    pub musculoskeletal: String,
    pub central_nervous: String,
    pub endocrine: String,
}

// ============================================================================
// PHASE 19: PATIENT SATISFACTION
// ============================================================================

/// Patient satisfaction survey
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientSatisfactionSurvey {
    /// Survey ID
    pub survey_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Visit ID
    pub visit_id: String,
    /// Visit date
    pub visit_date: String,
    /// Department
    pub department: String,
    /// Survey type
    pub survey_type: SurveyType,
    /// Responses
    pub responses: Vec<SurveyResponse>,
    /// Overall rating (1-5)
    pub overall_rating: u8,
    /// Would recommend (0-10)
    pub nps_score: u8,
    /// Free text comments
    pub comments: Option<String>,
    /// Submitted at
    pub submitted_at: i64,
    /// Anonymous
    pub anonymous: bool,
    /// Follow-up requested
    pub follow_up_requested: bool,
    /// Contact method
    pub contact_method: Option<String>,
}

/// Survey type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SurveyType {
    CAHPS,
    HCAHPS,
    Custom,
    PostDischarge,
    PostVisit,
}

/// Survey response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurveyResponse {
    pub question_id: String,
    pub question_text: String,
    pub response_type: ResponseType,
    pub response_value: String,
}

/// Response type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ResponseType {
    Rating,
    YesNo,
    MultipleChoice,
    FreeText,
}

// ============================================================================
// PHASE 20: MEDICATION REMINDERS & ALERTS
// ============================================================================

/// Medication reminder
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MedicationReminder {
    /// Reminder ID
    pub reminder_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Medication name
    pub medication_name: String,
    /// Dosage
    pub dosage: String,
    /// Frequency
    pub frequency: ReminderFrequency,
    /// Times of day (HH:MM format)
    pub reminder_times: Vec<String>,
    /// Start date
    pub start_date: String,
    /// End date (optional for ongoing)
    pub end_date: Option<String>,
    /// Instructions
    pub instructions: Option<String>,
    /// Active
    pub active: bool,
    /// Created by (patient or provider)
    pub created_by: String,
    /// Created at
    pub created_at: i64,
    /// Notification preferences
    pub notification_prefs: NotificationPreferences,
}

/// Reminder frequency
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ReminderFrequency {
    Once,
    Daily,
    TwiceDaily,
    ThreeTimesDaily,
    FourTimesDaily,
    EveryOtherDay,
    Weekly,
    Biweekly,
    Monthly,
    AsNeeded,
    Custom,
}

/// Notification preferences
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPreferences {
    pub push_notification: bool,
    pub sms: bool,
    pub email: bool,
    pub in_app: bool,
    pub reminder_before_minutes: u16,
}

/// Medication adherence log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MedicationAdherenceLog {
    /// Log ID
    pub log_id: String,
    /// Reminder ID
    pub reminder_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Scheduled time
    pub scheduled_time: i64,
    /// Action taken
    pub action: AdherenceAction,
    /// Actual time taken (if taken)
    pub taken_at: Option<i64>,
    /// Notes
    pub notes: Option<String>,
}

/// Adherence action
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AdherenceAction {
    Taken,
    Skipped,
    Snoozed,
    Missed,
    TakenLate,
}

// ============================================================================
// PHASE 21: DRUG INTERACTION CHECKING
// ============================================================================

/// Drug reference information (for drug lookup/search)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrugReference {
    /// Unique drug identifier
    pub drug_id: String,
    /// Drug name
    pub name: String,
    /// Generic name
    pub generic_name: String,
    /// Brand names
    pub brand_names: Vec<String>,
    /// Drug class
    pub drug_class: String,
    /// Route of administration
    pub route: String,
    /// Dosage form
    pub form: String,
    /// Common doses
    pub common_doses: Vec<String>,
}

/// Drug interaction check request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrugInteractionCheckRequest {
    /// Patient ID
    pub patient_id: String,
    /// New medication being prescribed
    pub new_medication: MedicationInfo,
    /// Include OTC drugs
    pub include_otc: bool,
    /// Include supplements
    pub include_supplements: bool,
}

/// Medication info for interaction check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionMedicationInfo {
    pub rxcui: Option<String>,
    pub ndc: Option<String>,
    pub name: String,
    pub dosage: String,
    pub route: String,
}

/// Drug interaction result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrugInteractionResult {
    /// Result ID
    pub result_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Checked at
    pub checked_at: i64,
    /// New medication checked
    pub new_medication: String,
    /// Interactions found
    pub interactions: Vec<DrugInteraction>,
    /// Overall severity
    pub overall_severity: InteractionSeverity,
    /// Safe to prescribe
    pub safe_to_prescribe: bool,
    /// Checked by
    pub checked_by: String,
}

/// Individual drug interaction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrugInteraction {
    /// Drug A
    pub drug_a: String,
    /// Drug B
    pub drug_b: String,
    /// Severity
    pub severity: InteractionSeverity,
    /// Description
    pub description: String,
    /// Clinical effects
    pub clinical_effects: String,
    /// Management recommendation
    pub management: String,
    /// Evidence level
    pub evidence_level: EvidenceLevel,
    /// Source database
    pub source: String,
}

/// Interaction severity
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum InteractionSeverity {
    None,
    Minor,
    Moderate,
    Major,
    Contraindicated,
}

/// Evidence level for interaction
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum EvidenceLevel {
    Theoretical,
    CaseReport,
    CaseStudy,
    ClinicalTrial,
    Established,
}

// ============================================================================
// PHASE 22: FAMILY ACCOUNT LINKING
// ============================================================================

/// Family group
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyGroup {
    /// Family group ID
    pub family_id: String,
    /// Family name
    pub family_name: String,
    /// Primary account holder
    pub primary_account_id: String,
    /// Members
    pub members: Vec<FamilyMember>,
    /// Created at
    pub created_at: i64,
    /// Last modified
    pub last_modified: i64,
}

/// Family member
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyMember {
    /// Patient ID
    pub patient_id: String,
    /// Relationship to primary
    pub relationship: FamilyRelationship,
    /// Access level
    pub access_level: FamilyAccessLevel,
    /// Can manage appointments
    pub can_manage_appointments: bool,
    /// Can book appointments
    pub can_book_appointments: bool,
    /// Can view medical records
    pub can_view_records: bool,
    /// Can manage medications
    pub can_manage_medications: bool,
    /// Minor (under 18)
    pub is_minor: bool,
    /// Linked at
    pub linked_at: i64,
    /// Linked by
    pub linked_by: String,
}

/// Family relationship
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FamilyRelationship {
    Self_,
    Spouse,
    Child,
    Parent,
    Sibling,
    Grandparent,
    Grandchild,
    Guardian,
    Dependent,
    Other,
}

/// Family access level
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FamilyAccessLevel {
    Full,
    ReadOnly,
    EmergencyOnly,
    AppointmentsOnly,
    Custom,
}

/// Family link request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyLinkRequest {
    /// Request ID
    pub request_id: String,
    /// Requester patient ID
    pub requester_id: String,
    /// Target patient ID
    pub target_patient_id: String,
    /// Requested relationship
    pub relationship: FamilyRelationship,
    /// Status
    pub status: LinkRequestStatus,
    /// Created at
    pub created_at: i64,
    /// Expires at
    pub expires_at: i64,
    /// Verification code (for SMS/email verification)
    pub verification_code: Option<String>,
}

/// Link request status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LinkRequestStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
    Revoked,
}

// ============================================================================
// PHASE 23: APPOINTMENT BOOKING SYSTEM
// ============================================================================

// Note: Using existing Appointment, AppointmentStatus, and AppointmentReminder structs from line 7183
// Additional booking-specific types below

/// Provider schedule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSchedule {
    /// Provider ID
    pub provider_id: String,
    /// Provider name
    pub provider_name: String,
    /// Specialty
    pub specialty: String,
    /// Location
    pub location_id: String,
    /// Working days
    pub working_days: Vec<WorkingDay>,
    /// Blocked times (vacations, meetings, etc.)
    pub blocked_times: Vec<BlockedTime>,
    /// Default appointment duration
    pub default_duration_minutes: u16,
    /// Buffer between appointments
    pub buffer_minutes: u8,
    /// Max patients per day
    pub max_patients_per_day: Option<u16>,
}

/// Working day schedule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkingDay {
    pub day_of_week: u8,
    pub start_time: String,
    pub end_time: String,
    pub lunch_start: Option<String>,
    pub lunch_end: Option<String>,
}

/// Blocked time period
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockedTime {
    pub start_datetime: i64,
    pub end_datetime: i64,
    pub reason: String,
    pub recurring: bool,
}

/// Available slot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableSlot {
    pub slot_id: String,
    pub provider_id: String,
    pub provider_name: String,
    pub datetime: i64,
    pub duration_minutes: u16,
    pub location: String,
    pub appointment_type: AppointmentType,
}

// ============================================================================
// PHASE 24: WEARABLE DEVICE INTEGRATION
// ============================================================================

/// Wearable device
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WearableDevice {
    /// Device ID
    pub device_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Device type
    pub device_type: WearableDeviceType,
    /// Manufacturer
    pub manufacturer: String,
    /// Model
    pub model: String,
    /// Serial number
    pub serial_number: Option<String>,
    /// Firmware version
    pub firmware_version: Option<String>,
    /// Connection status
    pub connection_status: ConnectionStatus,
    /// Last sync time
    pub last_sync: Option<i64>,
    /// Paired at
    pub paired_at: i64,
    /// Active
    pub active: bool,
    /// Data types collected
    pub data_types: Vec<WearableDataType>,
    /// Sync frequency (hours)
    pub sync_frequency_hours: u8,
    /// Battery level
    pub battery_level: Option<u8>,
}

/// Wearable device type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum WearableDeviceType {
    #[default]
    Other,
    Smartwatch,
    FitnessBand,
    CGM,
    BloodPressureMonitor,
    PulseOximeter,
    SmartScale,
    ECGMonitor,
    SleepTracker,
    GlucoseMeter,
    PeakFlowMeter,
}

/// Connection status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum ConnectionStatus {
    #[default]
    Disconnected,
    Connected,
    Syncing,
    Error,
    LowBattery,
    OutOfRange,
}

/// Wearable data type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum WearableDataType {
    #[default]
    Steps,
    HeartRate,
    BloodPressure,
    BloodGlucose,
    SpO2,
    Distance,
    Calories,
    Sleep,
    ECG,
    Weight,
    Temperature,
    RespiratoryRate,
    Stress,
    HRV,
    Other(String),
}

/// Wearable data reading
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WearableReading {
    /// Reading ID
    pub reading_id: String,
    /// Device ID
    pub device_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Data type
    pub data_type: WearableDataType,
    /// Value
    pub value: f64,
    /// Unit
    pub unit: String,
    /// Secondary value (e.g., diastolic BP)
    pub secondary_value: Option<f64>,
    /// Recorded at (device time)
    pub recorded_at: i64,
    /// Synced at (server time)
    pub synced_at: i64,
    /// Context (resting, exercise, sleep, etc.)
    pub context: Option<String>,
    /// Quality indicator
    pub quality: DataQuality,
    /// Flagged as abnormal
    pub flagged: bool,
    /// Flag reason
    pub flag_reason: Option<String>,
}

/// Data quality indicator
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum DataQuality {
    High,
    Medium,
    Low,
    #[default]
    Unknown,
    Invalid,
}

/// Wearable alert rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WearableAlertRule {
    /// Rule ID
    pub rule_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Data type to monitor
    pub data_type: WearableDataType,
    /// Threshold type
    pub threshold_type: ThresholdType,
    /// Threshold value
    pub threshold_value: f64,
    /// Secondary threshold (for range)
    pub secondary_threshold: Option<f64>,
    /// Alert severity
    pub severity: AlertSeverity,
    /// Notify patient
    pub notify_patient: bool,
    /// Notify provider
    pub notify_provider: bool,
    /// Provider to notify
    pub provider_id: Option<String>,
    /// Active
    pub active: bool,
    /// Created at
    pub created_at: i64,
}

/// Threshold type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ThresholdType {
    Above,
    Below,
    OutsideRange,
    ChangeRate,
    AbsenceOfData,
}

/// Alert severity
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AlertSeverity {
    Info,
    Warning,
    Urgent,
    Critical,
}

/// Wearable alert
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WearableAlert {
    /// Alert ID
    pub alert_id: String,
    /// Rule ID that triggered
    pub rule_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Reading that triggered
    pub reading_id: String,
    /// Alert type
    pub data_type: WearableDataType,
    /// Value that triggered
    pub trigger_value: f64,
    /// Threshold
    pub threshold: f64,
    /// Severity
    pub severity: AlertSeverity,
    /// Message
    pub message: String,
    /// Created at
    pub created_at: i64,
    /// Acknowledged
    pub acknowledged: bool,
    /// Acknowledged by
    pub acknowledged_by: Option<String>,
    /// Acknowledged at
    pub acknowledged_at: Option<i64>,
    /// Action taken
    pub action_taken: Option<String>,
}

// ============================================================================
// PHASE 25: AI SYMPTOM CHECKER
// ============================================================================

/// Symptom check session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymptomCheckSession {
    /// Session ID
    pub session_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Started at
    pub started_at: i64,
    /// Completed at
    pub completed_at: Option<i64>,
    /// Initial symptoms reported
    pub initial_symptoms: Vec<String>,
    /// Conversation history
    pub conversation: Vec<SymptomMessage>,
    /// Final assessment
    pub assessment: Option<SymptomAssessment>,
    /// Triage recommendation
    pub triage_recommendation: Option<TriageRecommendation>,
    /// Status
    pub status: SymptomCheckStatus,
}

/// Symptom message in conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymptomMessage {
    pub role: MessageRole,
    pub content: String,
    pub timestamp: i64,
    /// Extracted symptoms (if AI message)
    pub extracted_symptoms: Option<Vec<ExtractedSymptom>>,
}

/// Message role
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MessageRole {
    Patient,
    AI,
    System,
}

/// Extracted symptom from conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedSymptom {
    pub symptom_name: String,
    pub snomed_code: Option<String>,
    pub body_location: Option<String>,
    pub severity: Option<String>,
    pub duration: Option<String>,
    pub onset: Option<String>,
    pub character: Option<String>,
    pub aggravating_factors: Vec<String>,
    pub relieving_factors: Vec<String>,
    pub associated_symptoms: Vec<String>,
}

/// Symptom assessment result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymptomAssessment {
    /// Possible conditions
    pub possible_conditions: Vec<PossibleCondition>,
    /// Red flags identified
    pub red_flags: Vec<RedFlag>,
    /// Recommended next steps
    pub recommendations: Vec<String>,
    /// Questions to ask provider
    pub questions_for_provider: Vec<String>,
    /// Self-care advice
    pub self_care: Vec<String>,
    /// Confidence level
    pub confidence: f32,
    /// Disclaimer
    pub disclaimer: String,
}

/// Possible condition from symptom check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PossibleCondition {
    pub condition_name: String,
    pub icd10_code: Option<String>,
    pub probability: f32,
    pub description: String,
    pub urgency: UrgencyLevel,
    pub common_causes: Vec<String>,
}

/// Urgency level
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum UrgencyLevel {
    Emergency,
    Urgent,
    SoonAppointment,
    Routine,
    SelfCare,
}

/// Red flag symptom
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedFlag {
    pub symptom: String,
    pub concern: String,
    pub action_needed: String,
}

/// Triage recommendation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriageRecommendation {
    pub level: TriageLevel,
    pub explanation: String,
    pub timeframe: String,
    pub care_options: Vec<CareOption>,
}

/// Triage level from symptom check
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TriageLevel {
    EmergencyRoom,
    UrgentCare,
    SameDayAppointment,
    ScheduledAppointment,
    Telehealth,
    SelfCare,
}

/// Care option
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CareOption {
    pub option_type: String,
    pub description: String,
    pub available: bool,
    pub estimated_wait: Option<String>,
    pub cost_estimate: Option<String>,
}

/// Symptom check status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SymptomCheckStatus {
    InProgress,
    Completed,
    Abandoned,
    EscalatedToProvider,
}

// ============================================================================
// PHASE 26: TELEHEALTH INTEGRATION
// ============================================================================

/// Telehealth session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelehealthSession {
    /// Session ID
    pub session_id: String,
    /// Appointment ID (if scheduled)
    pub appointment_id: Option<String>,
    /// Patient ID
    pub patient_id: String,
    /// Provider ID
    pub provider_id: String,
    /// Session type
    pub session_type: TelehealthType,
    /// Scheduled start
    pub scheduled_start: i64,
    /// Actual start
    pub actual_start: Option<i64>,
    /// Actual end
    pub actual_end: Option<i64>,
    /// Status
    pub status: TelehealthStatus,
    /// Video room URL
    pub video_room_url: String,
    /// Waiting room URL
    pub waiting_room_url: String,
    /// Join instructions
    pub join_instructions: String,
    /// Technical requirements
    pub technical_requirements: Vec<String>,
    /// Patient joined at
    pub patient_joined_at: Option<i64>,
    /// Provider joined at
    pub provider_joined_at: Option<i64>,
    /// Recording enabled
    pub recording_enabled: bool,
    /// Recording consent given
    pub recording_consent: bool,
    /// Chat enabled
    pub chat_enabled: bool,
    /// Screen share enabled
    pub screen_share_enabled: bool,
    /// Quality metrics
    pub quality_metrics: Option<VideoQualityMetrics>,
    /// Notes from visit
    pub visit_notes: Option<String>,
    /// Follow-up scheduled
    pub follow_up_scheduled: Option<String>,
}

/// Telehealth session type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TelehealthType {
    VideoVisit,
    PhoneCall,
    SecureMessage,
    AsyncVideo,
    RemoteMonitoring,
    VirtualGroupVisit,
}

/// Telehealth session status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TelehealthStatus {
    Scheduled,
    WaitingRoom,
    InProgress,
    OnHold,
    Completed,
    Cancelled,
    NoShow,
    TechnicalIssue,
}

/// Video quality metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoQualityMetrics {
    pub avg_bitrate_kbps: u32,
    pub packet_loss_percent: f32,
    pub latency_ms: u32,
    pub resolution: String,
    pub frame_rate: u8,
    pub audio_quality_score: f32,
    pub video_quality_score: f32,
    pub disconnections: u8,
}

/// Telehealth device check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCheck {
    pub check_id: String,
    pub patient_id: String,
    pub checked_at: i64,
    pub camera_working: bool,
    pub microphone_working: bool,
    pub speaker_working: bool,
    pub browser_supported: bool,
    pub bandwidth_adequate: bool,
    pub bandwidth_mbps: f32,
    pub issues_detected: Vec<String>,
    pub recommendations: Vec<String>,
}

/// Telehealth waiting room
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaitingRoomEntry {
    pub entry_id: String,
    pub session_id: String,
    pub patient_id: String,
    pub provider_id: String,
    pub entered_at: i64,
    pub position_in_queue: u16,
    pub estimated_wait_minutes: u16,
    pub status: WaitingRoomStatus,
    pub patient_ready: bool,
    pub provider_notified: bool,
}

/// Waiting room status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum WaitingRoomStatus {
    Waiting,
    BeingAdmitted,
    Admitted,
    ProviderReady,
    Left,
}

// ============================================================================
// PHASE 27: CLINICAL DECISION SUPPORT (CDS)
// ============================================================================

/// CDS alert
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CDSAlert {
    /// Alert ID
    pub alert_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Provider ID (who receives alert)
    pub provider_id: String,
    /// Alert type
    pub alert_type: CDSAlertType,
    /// Severity
    pub severity: CDSSeverity,
    /// Title
    pub title: String,
    /// Description
    pub description: String,
    /// Clinical context
    pub clinical_context: String,
    /// Triggering data
    pub triggering_data: serde_json::Value,
    /// Recommended actions
    pub recommended_actions: Vec<CDSRecommendedAction>,
    /// Evidence/rationale
    pub evidence: Vec<CDSEvidence>,
    /// Guideline reference
    pub guideline_reference: Option<String>,
    /// Created at
    pub created_at: i64,
    /// Expires at
    pub expires_at: Option<i64>,
    /// Status
    pub status: CDSAlertStatus,
    /// Response
    pub response: Option<CDSResponse>,
}

/// CDS alert type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CDSAlertType {
    DrugInteraction,
    DrugAllergy,
    DuplicateTherapy,
    DoseRangeCheck,
    PreventiveCare,
    DiagnosticGap,
    LaboratoryAbnormal,
    VitalSignAbnormal,
    CarePlanDeviation,
    QualityMeasure,
    CostSavingOpportunity,
    BestPracticeAdvisory,
    OrderSet,
}

/// CDS severity
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CDSSeverity {
    Informational,
    Low,
    Medium,
    High,
    Critical,
}

/// Recommended action from CDS
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CDSRecommendedAction {
    pub action_id: String,
    pub action_type: String,
    pub description: String,
    pub strength: RecommendationStrength,
    pub one_click_order: Option<serde_json::Value>,
}

/// Recommendation strength
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RecommendationStrength {
    Strong,
    Moderate,
    Weak,
    Optional,
}

/// CDS evidence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CDSEvidence {
    pub source: String,
    pub citation: String,
    pub url: Option<String>,
    pub evidence_grade: String,
}

/// CDS alert status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CDSAlertStatus {
    Active,
    Acknowledged,
    Accepted,
    Overridden,
    Deferred,
    Resolved,
    Expired,
}

/// Provider response to CDS alert
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CDSResponse {
    pub responded_at: i64,
    pub responded_by: String,
    pub action_taken: CDSActionTaken,
    pub override_reason: Option<String>,
    pub notes: Option<String>,
    pub time_to_response_seconds: u32,
}

/// Action taken on CDS alert
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CDSActionTaken {
    Accepted,
    AcceptedWithModification,
    Overridden,
    Deferred,
    EscalatedToPharmacy,
    PatientRefused,
    NotApplicable,
}

// ============================================================================
// PHASE 28: LAB RESULT TRENDING
// ============================================================================

/// Lab trend request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabTrendRequest {
    pub patient_id: String,
    pub test_codes: Vec<String>,
    pub start_date: String,
    pub end_date: String,
    pub include_reference_ranges: bool,
}

/// Lab trend result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabTrendResult {
    /// Result ID
    pub result_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Test code (LOINC)
    pub loinc_code: String,
    /// Test name
    pub test_name: String,
    /// Unit
    pub unit: String,
    /// Reference range
    pub reference_range: Option<ReferenceRange>,
    /// Data points
    pub data_points: Vec<LabDataPoint>,
    /// Trend analysis
    pub trend_analysis: TrendAnalysis,
    /// Generated at
    pub generated_at: i64,
}

/// Reference range for lab
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceRange {
    pub low: Option<f64>,
    pub high: Option<f64>,
    pub critical_low: Option<f64>,
    pub critical_high: Option<f64>,
    pub unit: String,
    pub age_specific: bool,
    pub gender_specific: bool,
}

/// Lab data point
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabDataPoint {
    pub result_id: String,
    pub value: f64,
    pub collected_at: i64,
    pub status: LabValueStatus,
    pub flag: Option<String>,
    pub performing_lab: String,
}

/// Lab value status relative to reference range
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LabValueStatus {
    Normal,
    Low,
    High,
    CriticalLow,
    CriticalHigh,
    Unknown,
}

/// Trend analysis for lab values
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendAnalysis {
    pub direction: TrendDirection,
    pub percent_change: Option<f64>,
    pub rate_of_change: Option<f64>,
    pub rate_unit: Option<String>,
    pub statistically_significant: bool,
    pub clinical_significance: String,
    pub prediction: Option<TrendPrediction>,
}

/// Trend direction
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TrendDirection {
    Increasing,
    Decreasing,
    Stable,
    Fluctuating,
    InsufficientData,
}

/// Trend prediction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendPrediction {
    pub predicted_value: f64,
    pub prediction_date: String,
    pub confidence_interval_low: f64,
    pub confidence_interval_high: f64,
    pub confidence_percent: f32,
}

// ============================================================================
// PHASE 29: PRESCRIPTION E-SIGNING
// ============================================================================

/// E-prescription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EPrescription {
    /// Prescription ID
    pub prescription_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Prescriber ID
    pub prescriber_id: String,
    /// Prescriber name
    pub prescriber_name: String,
    /// Prescriber NPI
    pub prescriber_npi: String,
    /// Prescriber DEA (if controlled)
    pub prescriber_dea: Option<String>,
    /// Medication
    pub medication: PrescribedMedication,
    /// Pharmacy
    pub pharmacy: EPharmacyInfo,
    /// Status
    pub status: PrescriptionStatus,
    /// Created at
    pub created_at: i64,
    /// Signed at
    pub signed_at: Option<i64>,
    /// Signature
    pub signature: Option<ESignature>,
    /// Transmitted at
    pub transmitted_at: Option<i64>,
    /// Transmission status
    pub transmission_status: Option<TransmissionStatus>,
    /// Controlled substance
    pub is_controlled: bool,
    /// DEA schedule
    pub dea_schedule: Option<String>,
    /// Refills allowed
    pub refills_allowed: u8,
    /// Refills remaining
    pub refills_remaining: u8,
    /// Last filled date
    pub last_filled: Option<i64>,
    /// Expires at
    pub expires_at: i64,
    /// Notes to pharmacy
    pub pharmacy_notes: Option<String>,
    /// Patient instructions
    pub patient_instructions: String,
    /// Diagnosis codes
    pub diagnosis_codes: Vec<String>,
}

/// Prescribed medication details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrescribedMedication {
    pub rxcui: Option<String>,
    pub ndc: Option<String>,
    pub name: String,
    pub generic_name: Option<String>,
    pub strength: String,
    pub form: String,
    pub quantity: u32,
    pub quantity_unit: String,
    pub days_supply: u16,
    pub directions: String,
    pub daw_code: u8,
}

/// Pharmacy information for e-prescriptions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EPharmacyInfo {
    pub ncpdp_id: String,
    pub npi: String,
    pub name: String,
    pub address: String,
    pub city: String,
    pub state: String,
    pub zip: String,
    pub phone: String,
    pub fax: Option<String>,
    pub is_mail_order: bool,
    pub is_24_hour: bool,
    pub accepts_epcs: bool,
}

/// E-signature for prescription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ESignature {
    pub signature_id: String,
    pub signer_id: String,
    pub signer_name: String,
    pub signer_credential: String,
    pub signed_at: i64,
    pub signature_method: SignatureMethod,
    pub ip_address: String,
    pub user_agent: String,
    pub certificate_thumbprint: Option<String>,
    pub attestation: String,
}

/// Signature method
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SignatureMethod {
    Password,
    Biometric,
    SmartCard,
    Token,
    TwoFactor,
}

/// E-Signature prescription status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ESignaturePrescriptionStatus {
    Draft,
    PendingSignature,
    Signed,
    Transmitted,
    Received,
    InProgress,
    Filled,
    PartiallyFilled,
    Cancelled,
    Expired,
    Denied,
}

/// Transmission status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TransmissionStatus {
    Pending,
    Sent,
    Acknowledged,
    Error,
    Retry,
}

// ============================================================================
// PHASE 30: INSURANCE CLAIM INTEGRATION
// ============================================================================

/// Insurance claim
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsuranceClaim {
    /// Claim ID
    pub claim_id: String,
    /// Patient ID
    pub patient_id: String,
    /// Encounter ID
    pub encounter_id: String,
    /// Provider ID
    pub provider_id: String,
    /// Facility ID
    pub facility_id: String,
    /// Insurance info
    pub insurance: PatientInsurance,
    /// Claim type
    pub claim_type: ClaimType,
    /// Service date
    pub service_date: String,
    /// Service lines
    pub service_lines: Vec<ServiceLine>,
    /// Diagnosis codes
    pub diagnosis_codes: Vec<ClaimDiagnosisCode>,
    /// Total charge
    pub total_charge: f64,
    /// Status
    pub status: ClaimStatus,
    /// Submitted at
    pub submitted_at: Option<i64>,
    /// Payer claim number
    pub payer_claim_number: Option<String>,
    /// Adjudicated at
    pub adjudicated_at: Option<i64>,
    /// Paid amount
    pub paid_amount: Option<f64>,
    /// Patient responsibility
    pub patient_responsibility: Option<f64>,
    /// Denied reason
    pub denied_reason: Option<String>,
    /// EOB received
    pub eob_received: bool,
    /// Created at
    pub created_at: i64,
    /// Last updated
    pub last_updated: i64,
}

/// Patient insurance info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientInsurance {
    pub payer_id: String,
    pub payer_name: String,
    pub plan_name: String,
    pub member_id: String,
    pub group_number: Option<String>,
    pub subscriber_name: String,
    pub subscriber_dob: String,
    pub relationship: String,
    pub coverage_type: CoverageType,
    pub priority: InsurancePriority,
    pub effective_date: String,
    pub termination_date: Option<String>,
    pub copay: Option<f64>,
    pub deductible: Option<f64>,
    pub deductible_met: Option<f64>,
    pub out_of_pocket_max: Option<f64>,
    pub out_of_pocket_met: Option<f64>,
}

/// Coverage type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CoverageType {
    Medical,
    Dental,
    Vision,
    Pharmacy,
    Behavioral,
    LongTermCare,
}

/// Insurance priority
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum InsurancePriority {
    Primary,
    Secondary,
    Tertiary,
}

/// Claim type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ClaimType {
    Professional,
    Institutional,
    Dental,
    Pharmacy,
}

/// Service line on claim
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceLine {
    pub line_number: u8,
    pub cpt_code: String,
    pub modifier: Option<String>,
    pub description: String,
    pub quantity: u8,
    pub unit_charge: f64,
    pub total_charge: f64,
    pub diagnosis_pointers: Vec<u8>,
    pub place_of_service: String,
    pub rendering_provider_npi: String,
}

/// Diagnosis code on claim
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimDiagnosisCode {
    pub sequence: u8,
    pub code: String,
    pub code_type: String,
    pub description: String,
}

/// Claim status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ClaimStatus {
    Draft,
    ReadyToSubmit,
    Submitted,
    Acknowledged,
    Pending,
    InReview,
    AdditionalInfoRequested,
    Approved,
    PartiallyApproved,
    Denied,
    Appealed,
    Paid,
    Closed,
}

/// Eligibility check request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EligibilityCheckRequest {
    pub patient_id: String,
    pub payer_id: String,
    pub member_id: String,
    pub subscriber_dob: String,
    pub service_type: String,
    pub service_date: String,
}

/// Eligibility check response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EligibilityCheckResponse {
    pub check_id: String,
    pub patient_id: String,
    pub checked_at: i64,
    pub eligible: bool,
    pub coverage_active: bool,
    pub plan_name: String,
    pub coverage_details: CoverageDetails,
    pub errors: Vec<String>,
}

/// Coverage details from eligibility check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageDetails {
    pub effective_date: String,
    pub termination_date: Option<String>,
    pub copay: Option<f64>,
    pub coinsurance_percent: Option<u8>,
    pub deductible: Option<f64>,
    pub deductible_remaining: Option<f64>,
    pub out_of_pocket_max: Option<f64>,
    pub out_of_pocket_remaining: Option<f64>,
    pub in_network: bool,
    pub prior_auth_required: bool,
    pub referral_required: bool,
}

// ============================================================================
// PHASE 31: ANALYTICS DASHBOARD
// ============================================================================

/// Dashboard metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardMetrics {
    /// Generated at
    pub generated_at: i64,
    /// Time period
    pub period: AnalyticsPeriod,
    /// Patient metrics
    pub patient_metrics: PatientMetrics,
    /// Appointment metrics
    pub appointment_metrics: AppointmentMetrics,
    /// Clinical metrics
    pub clinical_metrics: ClinicalMetrics,
    /// Financial metrics
    pub financial_metrics: Option<FinancialMetrics>,
    /// Quality metrics
    pub quality_metrics: QualityMetrics,
}

/// Analytics time period
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsPeriod {
    pub start_date: String,
    pub end_date: String,
    pub comparison_start: Option<String>,
    pub comparison_end: Option<String>,
}

/// Patient-related metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientMetrics {
    pub total_patients: u64,
    pub new_patients: u64,
    pub active_patients: u64,
    pub patients_by_age_group: Vec<AgeGroupCount>,
    pub patients_by_gender: Vec<GenderCount>,
    pub top_conditions: Vec<ConditionCount>,
}

/// Age group count
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgeGroupCount {
    pub age_group: String,
    pub count: u64,
}

/// Gender count
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenderCount {
    pub gender: String,
    pub count: u64,
}

/// Condition count
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConditionCount {
    pub condition: String,
    pub icd10_code: String,
    pub count: u64,
}

/// Appointment metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppointmentMetrics {
    pub total_appointments: u64,
    pub completed_appointments: u64,
    pub cancelled_appointments: u64,
    pub no_show_rate: f32,
    pub average_wait_time_minutes: f32,
    pub appointments_by_type: Vec<AppointmentTypeCount>,
    pub appointments_by_provider: Vec<ProviderAppointmentCount>,
    pub telehealth_percentage: f32,
}

/// Appointment type count
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppointmentTypeCount {
    pub appointment_type: String,
    pub count: u64,
}

/// Provider appointment count
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderAppointmentCount {
    pub provider_id: String,
    pub provider_name: String,
    pub count: u64,
}

/// Clinical metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClinicalMetrics {
    pub total_encounters: u64,
    pub prescriptions_written: u64,
    pub lab_orders: u64,
    pub imaging_orders: u64,
    pub referrals_made: u64,
    pub procedures_performed: u64,
    pub immunizations_given: u64,
    pub cds_alerts_generated: u64,
    pub cds_alerts_accepted: u64,
}

/// Financial metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinancialMetrics {
    pub total_charges: f64,
    pub total_payments: f64,
    pub claims_submitted: u64,
    pub claims_paid: u64,
    pub claims_denied: u64,
    pub denial_rate: f32,
    pub average_days_to_payment: f32,
    pub ar_aging: ARAgingBreakdown,
}

/// A/R aging breakdown
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ARAgingBreakdown {
    pub current: f64,
    pub days_30: f64,
    pub days_60: f64,
    pub days_90: f64,
    pub over_90: f64,
}

/// Quality metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityMetrics {
    pub preventive_care_compliance: f32,
    pub chronic_care_compliance: f32,
    pub medication_adherence_rate: f32,
    pub patient_satisfaction_score: f32,
    pub hedis_measures: Vec<HedisMeasure>,
}

/// HEDIS quality measure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HedisMeasure {
    pub measure_id: String,
    pub measure_name: String,
    pub numerator: u64,
    pub denominator: u64,
    pub rate: f32,
    pub benchmark: f32,
    pub meets_benchmark: bool,
}

// ============================================================================
// PHASE 32: MULTI-LANGUAGE SUPPORT
// ============================================================================

/// User language preference
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguagePreference {
    /// User/Patient ID
    pub user_id: String,
    /// Preferred language code (ISO 639-1)
    pub preferred_language: String,
    /// Secondary language
    pub secondary_language: Option<String>,
    /// Reading proficiency
    pub reading_proficiency: LanguageProficiency,
    /// Needs interpreter
    pub needs_interpreter: bool,
    /// Interpreter language
    pub interpreter_language: Option<String>,
    /// Updated at
    pub updated_at: i64,
}

/// Language proficiency level
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LanguageProficiency {
    Native,
    Fluent,
    Intermediate,
    Basic,
    None,
}

/// Supported language
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportedLanguage {
    pub code: String,
    pub name: String,
    pub native_name: String,
    pub rtl: bool,
    pub medical_terminology_available: bool,
    pub patient_materials_available: bool,
    pub ui_available: bool,
}

/// Translation request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationRequest {
    pub request_id: String,
    pub source_language: String,
    pub target_language: String,
    pub content_type: TranslationContentType,
    pub content: String,
    pub context: Option<String>,
    pub medical_context: bool,
}

/// Translation content type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TranslationContentType {
    UILabel,
    PatientInstructions,
    MedicationDirections,
    DiagnosisDescription,
    ConsentForm,
    EducationalMaterial,
    Alert,
    Message,
}

/// Translation response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationResponse {
    pub request_id: String,
    pub translated_content: String,
    pub confidence_score: f32,
    pub human_reviewed: bool,
    pub alternative_translations: Vec<String>,
}

// ============================================================================
// PHASE 33: OFFLINE MODE SYNC
// ============================================================================

/// Sync status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    /// Device ID
    pub device_id: String,
    /// User ID
    pub user_id: String,
    /// Last sync time
    pub last_sync_at: i64,
    /// Sync in progress
    pub sync_in_progress: bool,
    /// Pending upload count
    pub pending_uploads: u32,
    /// Pending download count
    pub pending_downloads: u32,
    /// Last error
    pub last_error: Option<String>,
    /// Offline since
    pub offline_since: Option<i64>,
    /// Data freshness
    pub data_freshness: DataFreshness,
}

/// Data freshness level
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DataFreshness {
    Current,
    SlightlyStale,
    Stale,
    VeryStale,
    Expired,
}

/// Sync queue item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncQueueItem {
    /// Queue item ID
    pub queue_id: String,
    /// Device ID
    pub device_id: String,
    /// User ID
    pub user_id: String,
    /// Entity type
    pub entity_type: String,
    /// Entity ID
    pub entity_id: String,
    /// Operation
    pub operation: SyncOperation,
    /// Data (JSON)
    pub data: serde_json::Value,
    /// Created at (local time)
    pub created_at: i64,
    /// Priority
    pub priority: SyncPriority,
    /// Attempts
    pub attempts: u8,
    /// Last attempt at
    pub last_attempt_at: Option<i64>,
    /// Last error
    pub last_error: Option<String>,
    /// Status
    pub status: SyncItemStatus,
}

/// Sync operation type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SyncOperation {
    Create,
    Update,
    Delete,
    Merge,
}

/// Sync priority
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SyncPriority {
    Critical,
    High,
    Normal,
    Low,
}

/// Sync item status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SyncItemStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Conflict,
}

/// Sync conflict
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConflict {
    /// Conflict ID
    pub conflict_id: String,
    /// Entity type
    pub entity_type: String,
    /// Entity ID
    pub entity_id: String,
    /// Local version
    pub local_data: serde_json::Value,
    /// Local modified at
    pub local_modified_at: i64,
    /// Server version
    pub server_data: serde_json::Value,
    /// Server modified at
    pub server_modified_at: i64,
    /// Resolution
    pub resolution: Option<ConflictResolution>,
    /// Detected at
    pub detected_at: i64,
    /// Resolved at
    pub resolved_at: Option<i64>,
    /// Resolved by
    pub resolved_by: Option<String>,
}

/// Conflict resolution strategy
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConflictResolution {
    UseLocal,
    UseServer,
    Merge,
    Manual,
}

/// Offline capable data set
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfflineDataSet {
    /// Patient ID
    pub patient_id: String,
    /// Device ID
    pub device_id: String,
    /// Downloaded at
    pub downloaded_at: i64,
    /// Expires at
    pub expires_at: i64,
    /// Data categories included
    pub included_categories: Vec<OfflineCategory>,
    /// Total size bytes
    pub total_size_bytes: u64,
    /// Encrypted
    pub encrypted: bool,
    /// Encryption key hash
    pub key_hash: String,
}

/// Offline data category
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum OfflineCategory {
    Demographics,
    Allergies,
    Medications,
    Conditions,
    VitalSigns,
    LabResults,
    Immunizations,
    Appointments,
    CareTeam,
    EmergencyContacts,
    AdvanceDirectives,
}
