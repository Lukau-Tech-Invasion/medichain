//! Clinical Documentation Module
//!
//! Implements professional medical documentation standards:
//! - ESI (Emergency Severity Index) Triage System
//! - SOAP Notes (Subjective, Objective, Assessment, Plan)
//! - SAMPLE History (Signs, Allergies, Medications, Past history, Last oral intake, Events)
//! - Glasgow Coma Scale (GCS) with automatic scoring
//! - Vital Signs Flowsheet with time-series tracking
//!
//! © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.

// Allow medical acronyms to be in uppercase (medical standard naming)
#![allow(clippy::upper_case_acronyms)]

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
    #[serde(default)]
    pub review_of_systems: Option<String>,
    /// Patient-reported symptoms
    pub symptoms: Vec<String>,
    /// Duration of symptoms
    #[serde(default)]
    pub symptom_duration: Option<String>,
    /// What makes it better/worse
    #[serde(default)]
    pub modifying_factors: Option<String>,
    /// Previous treatments tried
    #[serde(default)]
    pub previous_treatments: Option<String>,
    /// Social history notes (relevant)
    #[serde(default)]
    pub social_history: Option<String>,
    /// Family history (relevant)
    #[serde(default)]
    pub family_history: Option<String>,
}

/// Objective section of SOAP note
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ObjectiveSection {
    /// Vital signs
    #[serde(default)]
    pub vital_signs: Option<TriageVitalSigns>,
    /// General appearance
    #[serde(default)]
    pub general_appearance: Option<String>,
    /// Physical examination findings by system
    pub physical_exam: Vec<PhysicalExamFinding>,
    /// Lab results (references)
    #[serde(default)]
    pub lab_results: Vec<String>,
    /// Imaging results (references)
    #[serde(default)]
    pub imaging_results: Vec<String>,
    /// Other diagnostic tests
    #[serde(default)]
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
    #[serde(default)]
    pub primary_diagnosis: Option<DiagnosisEntry>,
    /// Secondary/differential diagnoses
    #[serde(default)]
    pub secondary_diagnoses: Vec<DiagnosisEntry>,
    /// Clinical reasoning/summary
    pub clinical_summary: String,
    /// Severity/acuity assessment
    #[serde(default)]
    pub severity: Option<String>,
    /// Prognosis if relevant
    #[serde(default)]
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

/// What the assessor observed: the three GCS components and what went with them.
///
/// Grouped so the constructor cannot be called with its three responses in the
/// wrong order -- `EyeResponse`, `VerbalResponse` and `MotorResponse` are
/// distinct types, but the two `Option`s beside them were not.
#[derive(Debug, Clone)]
pub struct GcsObservation {
    pub eye: EyeResponse,
    pub verbal: VerbalResponse,
    pub motor: MotorResponse,
    pub pupil_assessment: Option<PupilAssessment>,
    pub notes: Option<String>,
}

impl GlasgowComaScale {
    /// Create new GCS assessment with automatic score calculation
    pub fn new(
        assessment_id: String,
        patient_id: String,
        observation: GcsObservation,
        assessed_by: String,
    ) -> Self {
        let GcsObservation {
            eye,
            verbal,
            motor,
            pupil_assessment,
            notes,
        } = observation;
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

    /// Check if reading contains any critical values.
    ///
    /// The limits are `clinical_scoring::VITAL_BANDS`, the same ones the
    /// vitals screens colour by, so what the server alerts on and what a
    /// clinician sees flagged cannot drift apart.
    pub fn has_critical_values(&self) -> Vec<String> {
        use crate::clinical_scoring::vital_beyond;
        let mut alerts = Vec::new();

        if let Some(hr) = self.heart_rate {
            let (low, high) = vital_beyond("heart_rate", f64::from(hr));
            if low {
                alerts.push(format!("Bradycardia: HR {}", hr));
            }
            if high {
                alerts.push(format!("Tachycardia: HR {}", hr));
            }
        }
        if let Some(rr) = self.respiratory_rate {
            let (low, high) = vital_beyond("respiratory_rate", f64::from(rr));
            if low {
                alerts.push(format!("Bradypnea: RR {}", rr));
            }
            if high {
                alerts.push(format!("Tachypnea: RR {}", rr));
            }
        }
        if let Some(sbp) = self.systolic_bp {
            let (low, high) = vital_beyond("bp_systolic", f64::from(sbp));
            if low {
                alerts.push(format!("Hypotension: SBP {}", sbp));
            }
            if high {
                alerts.push(format!("Hypertensive: SBP {}", sbp));
            }
        }
        if let Some(temp) = self.temperature_celsius {
            let (low, high) = vital_beyond("temperature", f64::from(temp));
            if low {
                alerts.push(format!("Hypothermia: {} °C", temp));
            }
            if high {
                alerts.push(format!("High fever: {} °C", temp));
            }
        }
        if let Some(spo2) = self.oxygen_saturation {
            if vital_beyond("oxygen_saturation", f64::from(spo2)).0 {
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
        self.readings.sort_by_key(|a| a.timestamp);
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
            GcsObservation {
                eye: EyeResponse::Spontaneous,       // 4
                verbal: VerbalResponse::Oriented,    // 5
                motor: MotorResponse::ObeysCommands, // 6
                pupil_assessment: None,
                notes: None,
            },
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
            GcsObservation {
                eye: EyeResponse::None,                // 1
                verbal: VerbalResponse::None,          // 1
                motor: MotorResponse::AbnormalFlexion, // 3
                pupil_assessment: None,
                notes: None,
            },
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

// ----------------------------------------------------------------------------
// TRAUMA ASSESSMENT
// ----------------------------------------------------------------------------

/// Blood product types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BloodProductType {
    PackedRBC,
    FFP,
    Platelets,
    Cryoprecipitate,
    WholeBlood,
}

// ----------------------------------------------------------------------------
// STROKE ASSESSMENT (NIH STROKE SCALE)
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// CARDIAC EVENT DOCUMENTATION
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// SEPSIS PROTOCOL
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// INTAKE & OUTPUT (I/O) CHART
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// NURSING CARE PLAN
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// WOUND CARE DOCUMENTATION
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// IV SITE DOCUMENTATION
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// SHIFT HANDOFF / SBAR
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// INCIDENT REPORTING
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// FALL RISK ASSESSMENT
// ----------------------------------------------------------------------------

// ============================================================================
// PHASE 4: SPECIALTY EMERGENCY DOCUMENTATION
// ============================================================================

// ----------------------------------------------------------------------------
// BURN DOCUMENTATION
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// PSYCHIATRIC EMERGENCY
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// TOXICOLOGY / OVERDOSE
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// MASS CASUALTY INCIDENT (MCI)
// ----------------------------------------------------------------------------

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

// ============================================================================
// PHASE 6: PEDIATRIC & OBSTETRIC EMERGENCY
// ============================================================================

// ----------------------------------------------------------------------------
// PEDIATRIC ASSESSMENT
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// OBSTETRIC EMERGENCY
// ----------------------------------------------------------------------------

// ============================================================================
// PHASE 7: LABORATORY DOCUMENTATION
// ============================================================================

// ----------------------------------------------------------------------------
// SPECIMEN COLLECTION
// ----------------------------------------------------------------------------

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

// ============================================================================
// PHASE 8: DISCHARGE & ORDERS DOCUMENTATION
// ============================================================================

// ----------------------------------------------------------------------------
// PHYSICIAN ORDERS
// ----------------------------------------------------------------------------

/// Order priority
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum OrderPriority {
    Stat,
    Urgent,
    Routine,
    Scheduled,
    PRN,
}

// ----------------------------------------------------------------------------
// DISCHARGE DOCUMENTATION
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// HISTORY & PHYSICAL (H&P)
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// CONSULTATION NOTES
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// PROGRESS NOTES
// ----------------------------------------------------------------------------

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
    /// Order ID. Assigned by the server on create; a value sent is ignored.
    #[serde(default)]
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
    /// Record ID. Server-assigned: the creating handler generates one whenever
    /// the client omits it or sends a blank, because this value becomes the
    /// row's primary key. Trusting a client-supplied id meant two records sent
    /// with `""` collided on the primary key and surfaced as a 500.
    #[serde(default)]
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

/// Policy-driven second-person verification state for dispensing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum SecondaryVerificationStatus {
    #[default]
    NotRequired,
    Required,
    Pending,
    Verified,
    Rejected,
    Expired,
    Revoked,
}

/// Evidence binding a second-pharmacist decision to one prescription.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SecondaryDispensingVerification {
    pub required: bool,
    pub status: SecondaryVerificationStatus,
    pub policy_version: Option<String>,
    pub policy_rule_id: Option<String>,
    pub verification_ttl_seconds: Option<i64>,
    pub first_pharmacist_id: Option<String>,
    pub request_id: Option<String>,
    pub requested_by: Option<String>,
    pub requested_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub verified_by: Option<String>,
    pub verified_at: Option<i64>,
    pub decision_reason: Option<String>,
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
    /// The telehealth session this appointment is held in, once one exists.
    ///
    /// `None` on an in-person appointment, and on a telehealth appointment
    /// whose session could not be provisioned — which is why it is an option
    /// rather than assumed. A client must treat `None` as "there is no meeting
    /// yet" and must not offer a join action: previously nothing ever set this,
    /// so the two subsystems were entirely disconnected and the patient app's
    /// Join button pointed at nothing (`docs/WORKFLOW_AUDIT.md`, WF-014).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telehealth_session_id: Option<String>,
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
    /// The party who did not book refused the proposed time. Terminal, and
    /// deliberately distinct from `Cancelled`: a decline means "I never agreed
    /// to this slot", which is a different fact from calling off an agreed one.
    Declined,
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
    /// Request ID. Assigned by the server on create; a client value is ignored.
    #[serde(default)]
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
    /// Every medication the check covered. Only the first used to be kept, so
    /// a filed check could not say what had been checked against what.
    /// Defaulted so checks filed before this was recorded still read.
    #[serde(default)]
    pub medications_checked: Vec<String>,
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

// ============================================================================
// PHASE 23: APPOINTMENT BOOKING SYSTEM
// ============================================================================

// Note: Using existing Appointment, AppointmentStatus, and AppointmentReminder structs from line 7183
// Additional booking-specific types below

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
    /// Age the patient gave, if they gave one.
    ///
    /// Stored because triage depends on it: chest pain in a 25-year-old and in
    /// a 70-year-old are different presentations, and a session filed without
    /// it leaves the clinician reading the history with symptoms and no
    /// context. `StartSymptomCheckRequest` has accepted this field since the
    /// feature was built and the handler dropped it on the floor -- the patient
    /// app sends it.
    ///
    /// `Option`, and absent rather than zero when unanswered: an age nobody
    /// gave is not age 0.
    pub age: Option<i32>,
    /// Sex or gender the patient gave, if they gave one. Dropped on the floor
    /// for the same reason, and it changes triage for the same reason.
    pub gender: Option<String>,
    /// Whether the patient said they are pregnant.
    ///
    /// `None` means they were not asked or did not say -- which is NOT the same
    /// as "no". Several red flags and most medication advice turn on this, so a
    /// false here must mean the patient actually said no.
    pub pregnant: Option<bool>,
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
/// Fallback session length for records written before `duration_minutes`
/// existed on this struct.
///
/// A stored session with no duration is not a zero-minute session; 60 is what
/// `provision_session` hardcoded at the time those records were written, so it
/// is the true value for every one of them.
fn default_session_duration_minutes() -> u32 {
    60
}

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
    /// How long the session was booked for, in minutes.
    ///
    /// Not cosmetic: `telehealth::CreateSessionParams` derives the join token's
    /// expiry from it, so a room booked for two hours whose duration is not
    /// carried expires while the consultation is still running. It was
    /// hardcoded to 60 in `provision_session` and absent from this struct
    /// entirely, so the number the clinician chose on the form reached nothing
    /// and the list rendered a `?? 30` fallback for every session ever created.
    #[serde(default = "default_session_duration_minutes")]
    pub duration_minutes: u32,
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
    /// Units dispensed so far, across every fill.
    ///
    /// `medication.quantity` is what was prescribed; this is what has actually
    /// left the pharmacy. The difference is what a partial fill still owes, and
    /// keeping the running total on the prescription is what makes concurrent
    /// dispensing safe: the transition is guarded on this value, so two
    /// pharmacists filling the same prescription at the same moment cannot both
    /// add to it.
    ///
    /// `#[serde(default)]` so prescriptions written before dispensing existed
    /// still deserialize, as zero dispensed.
    #[serde(default)]
    pub dispensed_quantity: u32,
    /// Populated only by the configured dispensing-policy mechanism. An empty
    /// policy never turns a jurisdictional assumption into an enforcement rule.
    #[serde(default)]
    pub secondary_verification: SecondaryDispensingVerification,
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

// ============================================================================
// PHASE 33: OFFLINE MODE SYNC
// ============================================================================

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
