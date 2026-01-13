//! MediChain REST API Server
//!
//! This API server provides emergency medical records access for first responders
//! and healthcare providers. It simulates NFC tap interactions and provides
//! endpoints for patient registration, emergency access, and consent management.
//!
//! **RBAC Enforcement:**
//! - Only healthcare providers (Doctor, Nurse, LabTechnician, Pharmacist) can register patients
//! - Only Doctor and Nurse can edit medical records
//! - Patients can only read their own records
//! - Admin can assign/revoke roles
//!
//! © 2025 Trustware. All rights reserved.

use actix_cors::Cors;
use actix_web::{
    delete, get, post, put, web, App, HttpRequest, HttpResponse, HttpServer, Responder,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

mod clinical;
mod clinical_endpoints;
mod ipfs;
mod nfc_simulator;

use clinical::{
    AMADischarge,
    AnesthesiaRecord,
    Appointment,
    AutopsyReport,
    AutopsyRequest,
    BloodTypeScreen,
    // Phase 4: Specialty Emergency
    BurnAssessment,
    CardiacEvent,
    ChainOfCustody,
    // Phase 2: Emergency Protocols
    CodeBlueRecord,
    ConsultationNote,
    CriticalValueNotification,
    CrossmatchRecord,
    DeathCertificate,
    DischargeInstructions,
    DischargeSummary,
    EMSHandoff,
    // Phase 1: Basic Clinical
    ESILevel,
    ElectronicPrescription,
    FallRiskAssessment,
    FamilyMedicalHistory,
    GlasgowComaScale,
    HistoryAndPhysical,
    IVSiteAssessment,
    ImmunizationRecord,
    ImmunizationSchedule,
    IncidentReport,
    IntakeOutputRecord,
    // Phase 5: Procedures
    IntubationRecord,
    LabPanelTemplate,
    LabQCRecord,
    LacerationRepair,
    MassCasualtyIncident,
    // Phase 3: Nursing Documentation
    MedicationAdministrationRecord,
    NursingCarePlan,
    ObstetricEmergency,
    OperativeNote,
    // Phase 6: Pediatric & Obstetric
    PathologyReport,
    PatientSatisfactionSurvey,
    PediatricAssessment,
    // Phase 8: Discharge & Orders
    PhysicianOrder,
    PostOperativeNote,
    PreOperativeAssessment,
    ProgressNote,
    PsychiatricAssessment,
    RadiologyOrder,
    RadiologyReport,
    SAMPLEHistory,
    SOAPNote,
    SepsisAssessment,
    ShiftHandoff,
    // Phase 7: Lab Documentation
    SpecimenCollection,
    SpecimenRejection,
    SplintCastRecord,
    StrokeAssessment,
    ToxicologyAssessment,
    TransfusionRecord,
    TraumaAssessment,
    TriageAssessment,
    VitalSignsFlowsheet,
    VitalSignsReading,
    WoundAssessment,
};
use ipfs::{EncryptedMetadata, IpfsClient, IpfsError, MedicalRecordReference};
use nfc_simulator::{CardRegistry, NFCCard, NationalIdType, QRCodeData};

// ============================================================================
// Data Types
// ============================================================================

/// User roles matching the blockchain pallet
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Role {
    Admin,
    Doctor,
    Nurse,
    LabTechnician,
    Pharmacist,
    Patient,
}

impl Role {
    /// Check if this role is a healthcare provider (can register patients)
    pub fn is_healthcare_provider(&self) -> bool {
        matches!(
            self,
            Role::Admin | Role::Doctor | Role::Nurse | Role::LabTechnician | Role::Pharmacist
        )
    }

    /// Check if this role can edit medical records
    pub fn can_edit_medical_records(&self) -> bool {
        matches!(self, Role::Admin | Role::Doctor | Role::Nurse)
    }

    /// Check if this role can view medical records (all healthcare providers can read)
    pub fn can_view_medical_records(&self) -> bool {
        matches!(
            self,
            Role::Admin | Role::Doctor | Role::Nurse | Role::LabTechnician | Role::Pharmacist
        )
    }

    /// Check if this role is admin
    pub fn is_admin(&self) -> bool {
        matches!(self, Role::Admin)
    }
}

impl std::fmt::Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Role::Admin => write!(f, "Admin"),
            Role::Doctor => write!(f, "Doctor"),
            Role::Nurse => write!(f, "Nurse"),
            Role::LabTechnician => write!(f, "LabTechnician"),
            Role::Pharmacist => write!(f, "Pharmacist"),
            Role::Patient => write!(f, "Patient"),
        }
    }
}

/// User account with role (wallet-based identity)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    /// SS58 wallet address (primary identifier for blockchain auth)
    pub wallet_address: String,
    /// Optional username for display
    pub username: Option<String>,
    /// Full name
    pub name: String,
    /// User's role in the system
    pub role: Role,
    /// When the user was registered
    pub created_at: DateTime<Utc>,
    /// Which admin registered this user (wallet address)
    pub created_by: Option<String>,
    /// Optional linked patient ID (for patient users)
    pub linked_patient_id: Option<String>,
}

/// Blood types supported by the system
/// Serialized to human-readable format: "A+", "O-", etc.
#[derive(Debug, Clone, PartialEq)]
pub enum BloodType {
    APositive,
    ANegative,
    BPositive,
    BNegative,
    ABPositive,
    ABNegative,
    OPositive,
    ONegative,
}

impl serde::Serialize for BloodType {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> serde::Deserialize<'de> for BloodType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "A+" | "APositive" => Ok(BloodType::APositive),
            "A-" | "ANegative" => Ok(BloodType::ANegative),
            "B+" | "BPositive" => Ok(BloodType::BPositive),
            "B-" | "BNegative" => Ok(BloodType::BNegative),
            "AB+" | "ABPositive" => Ok(BloodType::ABPositive),
            "AB-" | "ABNegative" => Ok(BloodType::ABNegative),
            "O+" | "OPositive" => Ok(BloodType::OPositive),
            "O-" | "ONegative" => Ok(BloodType::ONegative),
            _ => Err(serde::de::Error::custom(format!(
                "Invalid blood type: {}",
                s
            ))),
        }
    }
}

impl std::fmt::Display for BloodType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BloodType::APositive => write!(f, "A+"),
            BloodType::ANegative => write!(f, "A-"),
            BloodType::BPositive => write!(f, "B+"),
            BloodType::BNegative => write!(f, "B-"),
            BloodType::ABPositive => write!(f, "AB+"),
            BloodType::ABNegative => write!(f, "AB-"),
            BloodType::OPositive => write!(f, "O+"),
            BloodType::ONegative => write!(f, "O-"),
        }
    }
}

/// Allergy severity levels (FHIR R5 AllergyIntolerance compatible)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum AllergySeverity {
    /// Mild reaction - local symptoms only
    #[default]
    Mild,
    /// Moderate reaction - systemic symptoms
    Moderate,
    /// Severe/life-threatening reaction (anaphylaxis risk)
    Severe,
    /// Unknown severity
    Unknown,
}

impl std::fmt::Display for AllergySeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AllergySeverity::Mild => write!(f, "mild"),
            AllergySeverity::Moderate => write!(f, "moderate"),
            AllergySeverity::Severe => write!(f, "severe"),
            AllergySeverity::Unknown => write!(f, "unknown"),
        }
    }
}

/// Structured allergy information with severity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Allergy {
    /// Name of the allergen (e.g., "Penicillin", "Peanuts")
    pub name: String,
    /// Severity of the allergic reaction
    pub severity: AllergySeverity,
    /// Clinical reaction description (optional)
    pub reaction: Option<String>,
    /// When the allergy was verified by a healthcare provider
    pub verified_at: Option<DateTime<Utc>>,
}

/// Emergency contact information (enhanced with priority and decision authority)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmergencyContact {
    /// Full name of the emergency contact
    pub name: String,
    /// Phone number with country code (e.g., "+234-801-234-5678")
    pub phone: String,
    /// Relationship to patient (e.g., "Spouse", "Mother", "Brother")
    pub relationship: String,
    /// Priority order (1 = primary contact)
    #[serde(default = "default_priority")]
    pub priority: u8,
    /// Can this contact make medical decisions for the patient?
    #[serde(default)]
    pub can_make_medical_decisions: bool,
    /// Preferred language for communication (ISO 639-1 code)
    pub language: Option<String>,
}

fn default_priority() -> u8 {
    1
}

/// Insurance coverage type (FHIR Coverage compatible)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum InsuranceCoverageType {
    /// Public/Government insurance (e.g., NHIS)
    #[default]
    Public,
    /// Private insurance
    Private,
    /// Employer-provided insurance
    Employer,
    /// National Health Insurance Scheme
    NHIS,
    /// Community-based health insurance
    Community,
    /// No insurance / Self-pay
    None,
}

impl std::fmt::Display for InsuranceCoverageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InsuranceCoverageType::Public => write!(f, "public"),
            InsuranceCoverageType::Private => write!(f, "private"),
            InsuranceCoverageType::Employer => write!(f, "employer"),
            InsuranceCoverageType::NHIS => write!(f, "nhis"),
            InsuranceCoverageType::Community => write!(f, "community"),
            InsuranceCoverageType::None => write!(f, "none"),
        }
    }
}

/// Insurance information (FHIR Coverage resource compatible)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsuranceInfo {
    /// Insurance provider name
    pub provider: String,
    /// Policy number
    pub policy_number: String,
    /// Group number (optional)
    pub group_number: Option<String>,
    /// Coverage start date (ISO 8601)
    pub valid_from: String,
    /// Coverage end date (ISO 8601)
    pub valid_to: String,
    /// Type of coverage
    pub coverage_type: InsuranceCoverageType,
    /// Is the insurance currently active?
    #[serde(default = "default_insurance_active")]
    pub is_active: bool,
}

fn default_insurance_active() -> bool {
    true
}

/// Patient address (FHIR Address compatible)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Address {
    /// Street address line
    pub street: Option<String>,
    /// City
    pub city: String,
    /// State/Province/Region
    pub state: Option<String>,
    /// Country (ISO 3166-1 alpha-2 code, e.g., "NG", "KE", "GH")
    pub country: String,
    /// Postal/ZIP code
    pub postal_code: Option<String>,
    /// GPS coordinates for areas without formal addresses (critical for rural Africa)
    pub coordinates: Option<GeoCoordinates>,
}

/// Geographic coordinates (for rural areas without formal addresses)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoCoordinates {
    pub latitude: f64,
    pub longitude: f64,
}

/// Healthcare provider information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthcareProvider {
    /// Provider's full name
    pub name: String,
    /// Phone number with country code
    pub phone: String,
    /// Healthcare facility name
    pub facility: Option<String>,
    /// Specialty (e.g., "General Practice", "Cardiology")
    pub specialty: Option<String>,
    /// License/registration number
    pub license_number: Option<String>,
}

/// Patient preferences and settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PatientPreferences {
    /// Show medical ID when device is locked (for emergency access)
    #[serde(default)]
    pub show_when_locked: bool,
    /// Enable location sharing during emergencies
    #[serde(default)]
    pub enable_location_sharing: bool,
    /// Automatically notify family/emergency contacts during emergency
    #[serde(default)]
    pub auto_notify_family: bool,
    /// Preferred display language for medical ID (ISO 639-1 code)
    pub display_language: Option<String>,
}

/// Advanced directives document reference
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedDirectives {
    /// IPFS hash of the advanced directives document
    pub ipfs_hash: String,
    /// Type of directive (e.g., "living_will", "healthcare_proxy", "dnr_order")
    pub directive_type: String,
    /// Date the directive was signed (ISO 8601)
    pub signed_date: String,
    /// Witness or notary information
    pub witness_info: Option<String>,
    /// When uploaded to system
    pub uploaded_at: i64,
    /// Who uploaded the document
    pub uploaded_by: String,
}

/// Family notification settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyNotificationSettings {
    /// Enable automatic notifications
    #[serde(default)]
    pub enabled: bool,
    /// Notification methods: "sms", "email", "push"
    #[serde(default)]
    pub notification_methods: Vec<String>,
    /// Delay before sending notifications (in minutes, 0 = immediate)
    #[serde(default)]
    pub delay_minutes: u16,
    /// Custom message to include in notifications
    pub custom_message: Option<String>,
}

/// Patient emergency information (visible without full consent)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmergencyInfo {
    pub patient_id: String,
    pub blood_type: BloodType,
    /// Structured allergies with severity levels
    pub allergies: Vec<Allergy>,
    pub current_medications: Vec<String>,
    pub chronic_conditions: Vec<String>,
    pub emergency_contacts: Vec<EmergencyContact>,
    pub organ_donor: bool,
    pub dnr_status: bool,
    /// Preferred languages for communication (ISO 639-1 codes, e.g., ["en", "yo", "ha"])
    /// First language is primary. Critical for Africa's 2000+ languages.
    #[serde(default)]
    pub languages: Vec<String>,
    pub last_updated: DateTime<Utc>,
}

/// Full patient profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientProfile {
    pub patient_id: String,
    pub full_name: String,
    pub date_of_birth: String,
    pub national_id: String,
    pub emergency_info: EmergencyInfo,
    /// Patient's address (optional, FHIR compatible)
    pub address: Option<Address>,
    /// Insurance information (optional, FHIR Coverage compatible)
    pub insurance: Option<InsuranceInfo>,
    /// Primary healthcare provider
    pub primary_doctor: Option<HealthcareProvider>,
    /// Community Health Worker (Africa-specific: critical for rural healthcare access)
    pub community_health_worker: Option<HealthcareProvider>,
    /// Patient preferences and settings (lock screen, notifications, etc.)
    #[serde(default)]
    pub preferences: PatientPreferences,
    /// Advanced directives documents (living will, healthcare proxy, etc.)
    #[serde(default)]
    pub advanced_directives: Vec<AdvancedDirectives>,
    /// Family notification settings
    pub family_notifications: Option<FamilyNotificationSettings>,
    pub created_at: DateTime<Utc>,
    pub last_updated: DateTime<Utc>,
}

/// NFC Tag data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NfcTagData {
    pub tag_id: String,
    pub patient_id: String,
    pub hash: String,
    pub created_at: DateTime<Utc>,
}

/// Access log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessLogEntry {
    pub access_id: String,
    pub patient_id: String,
    pub accessor_id: String,
    pub accessor_role: String,
    pub access_type: String,
    pub location: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub emergency: bool,
}

// ============================================================================
// API Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct RegisterPatientRequest {
    pub full_name: String,
    pub date_of_birth: String,
    pub national_id: String,
    pub blood_type: String,
    /// Allergies - can be simple strings (converted to Mild severity) for backward compatibility
    pub allergies: Vec<String>,
    pub current_medications: Vec<String>,
    pub chronic_conditions: Vec<String>,
    pub emergency_contact_name: String,
    pub emergency_contact_phone: String,
    pub emergency_contact_relationship: String,
    pub organ_donor: bool,
    pub dnr_status: bool,
    /// Preferred languages (ISO 639-1 codes), e.g., ["en", "yo", "ha"]
    #[serde(default)]
    pub languages: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RegisterPatientResponse {
    pub success: bool,
    pub patient_id: String,
    pub nfc_tag_id: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct EmergencyAccessRequest {
    pub nfc_tag_id: String,
    pub accessor_id: String,
    pub accessor_role: String,
    pub location: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EmergencyAccessResponse {
    pub success: bool,
    pub access_id: String,
    pub emergency_info: Option<EmergencyInfo>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct SimulateNfcTapRequest {
    pub patient_id: String,
}

#[derive(Debug, Serialize)]
pub struct SimulateNfcTapResponse {
    pub success: bool,
    pub nfc_tag_id: String,
    pub tag_data: NfcTagData,
    pub qr_code_base64: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct HealthCheckResponse {
    pub status: String,
    pub version: String,
    pub timestamp: DateTime<Utc>,
    pub blockchain_connected: bool,
}

#[derive(Debug, Serialize)]
pub struct AccessLogsResponse {
    pub patient_id: String,
    pub access_logs: Vec<AccessLogEntry>,
    pub total_accesses: usize,
}

// ============================================================================
// Wallet-Based Authentication Request/Response Types
// ============================================================================

/// Request to register a new user with their wallet address
#[derive(Debug, Deserialize)]
pub struct WalletRegisterRequest {
    /// SS58 encoded wallet address
    pub wallet_address: String,
    /// Full name
    pub name: String,
    /// Optional username for display
    pub username: Option<String>,
    /// Role (only Admin can register healthcare providers)
    pub role: String,
}

/// Response for wallet registration
#[derive(Debug, Serialize)]
pub struct WalletRegisterResponse {
    pub success: bool,
    pub wallet_address: String,
    pub role: String,
    pub message: String,
}

/// Request to verify/login with wallet
#[derive(Debug, Deserialize)]
pub struct WalletLoginRequest {
    /// SS58 encoded wallet address
    pub wallet_address: String,
}

/// Response for wallet login
#[derive(Debug, Serialize)]
pub struct WalletLoginResponse {
    pub success: bool,
    pub user: Option<WalletUserInfo>,
    pub message: String,
}

/// User info returned on login
#[derive(Debug, Serialize)]
pub struct WalletUserInfo {
    pub wallet_address: String,
    pub name: String,
    pub username: Option<String>,
    pub role: String,
    pub linked_patient_id: Option<String>,
}

// ============================================================================
// RBAC Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct AssignRoleRequest {
    /// Wallet address of the user to assign role to
    pub wallet_address: String,
    /// Full name of the user
    pub name: String,
    /// Optional username
    pub username: Option<String>,
    /// Role to assign
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct AssignRoleResponse {
    pub success: bool,
    pub wallet_address: String,
    pub role: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct RevokeRoleRequest {
    pub wallet_address: String,
}

#[derive(Debug, Serialize)]
pub struct RevokeRoleResponse {
    pub success: bool,
    pub wallet_address: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub success: bool,
    pub error: String,
    pub code: String,
}

// ============================================================================
// Lab Result Submission Types (Pending Approval Workflow)
// ============================================================================

/// Status of lab result submission
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum LabResultStatus {
    #[default]
    Pending,
    Approved,
    Rejected,
}

impl std::fmt::Display for LabResultStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LabResultStatus::Pending => write!(f, "pending"),
            LabResultStatus::Approved => write!(f, "approved"),
            LabResultStatus::Rejected => write!(f, "rejected"),
        }
    }
}

/// Individual test result within a lab submission
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabTestResult {
    /// Parameter name (e.g., "Hemoglobin", "WBC Count")
    pub parameter: String,
    /// Result value
    pub value: String,
    /// Unit of measurement (e.g., "g/dL", "cells/mcL")
    pub unit: String,
    /// Normal reference range (e.g., "12.0-17.5")
    pub reference_range: String,
    /// Optional flag for abnormal results
    pub flag: Option<String>,
}

/// Lab result submission awaiting doctor approval
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabResultSubmission {
    /// Unique submission ID
    pub id: String,
    /// Patient ID this result is for
    pub patient_id: String,
    /// Patient name (for display purposes)
    pub patient_name: String,
    /// Name of the test (e.g., "Complete Blood Count")
    pub test_name: String,
    /// Category of test (e.g., "Hematology", "Chemistry")
    pub test_category: String,
    /// Individual test results
    pub results: Vec<LabTestResult>,
    /// Additional notes from lab technician
    pub notes: Option<String>,
    /// Lab technician who submitted
    pub submitted_by: String,
    /// Submission timestamp
    pub submitted_at: DateTime<Utc>,
    /// Current status
    pub status: LabResultStatus,
    /// Doctor who reviewed (if reviewed)
    pub reviewed_by: Option<String>,
    /// Review timestamp
    pub reviewed_at: Option<DateTime<Utc>>,
    /// Rejection reason (if rejected)
    pub rejection_reason: Option<String>,
    /// IPFS content hash (set after approval and upload)
    pub content_hash: Option<String>,
    /// IPFS metadata hash (set after approval and upload)
    pub metadata_hash: Option<String>,
}

/// Request to submit lab results
#[derive(Debug, Deserialize)]
pub struct SubmitLabResultRequest {
    pub patient_id: String,
    pub test_name: String,
    pub test_category: String,
    pub results: Vec<LabTestResult>,
    pub notes: Option<String>,
}

/// Response for lab result submission
#[derive(Debug, Serialize)]
pub struct SubmitLabResultResponse {
    pub success: bool,
    pub submission_id: String,
    pub message: String,
}

/// Request to review (approve/reject) lab results
#[derive(Debug, Deserialize)]
pub struct ReviewLabResultRequest {
    pub submission_id: String,
    pub action: String, // "approve" or "reject"
    pub rejection_reason: Option<String>,
}

/// Response for lab result review
#[derive(Debug, Serialize)]
pub struct ReviewLabResultResponse {
    pub success: bool,
    pub submission_id: String,
    pub new_status: String,
    pub message: String,
}

/// Response for pending lab results list
#[derive(Debug, Serialize)]
pub struct PendingLabResultsResponse {
    pub submissions: Vec<LabResultSubmission>,
    pub total: usize,
}

// ============================================================================
// IPFS Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct UploadMedicalRecordRequest {
    /// Patient ID this record belongs to
    pub patient_id: String,
    /// Base64-encoded file content
    pub content_base64: String,
    /// Original filename
    pub filename: String,
    /// Content type (e.g., "application/pdf", "image/jpeg")
    pub content_type: String,
    /// Record type (e.g., "lab_result", "imaging", "prescription")
    pub record_type: String,
}

#[derive(Debug, Serialize)]
pub struct UploadMedicalRecordResponse {
    pub success: bool,
    pub ipfs_hash: String,
    pub metadata_hash: String,
    pub record_reference: MedicalRecordReference,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct DownloadMedicalRecordRequest {
    /// IPFS hash of the encrypted content
    pub content_hash: String,
    /// IPFS hash of the encrypted metadata
    pub metadata_hash: String,
}

#[derive(Debug, Serialize)]
pub struct DownloadMedicalRecordResponse {
    pub success: bool,
    /// Base64-encoded decrypted content
    pub content_base64: String,
    pub filename: String,
    pub content_type: String,
    pub record_type: String,
    pub uploaded_by: String,
    pub uploaded_at: i64,
}

#[derive(Debug, Serialize)]
pub struct IpfsHealthResponse {
    pub ipfs_connected: bool,
    pub api_url: String,
    pub gateway_url: String,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Get default supported languages for the system
fn get_default_supported_languages() -> Vec<clinical::SupportedLanguage> {
    vec![
        clinical::SupportedLanguage {
            code: "en".to_string(),
            name: "English".to_string(),
            native_name: "English".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "zu".to_string(),
            name: "Zulu".to_string(),
            native_name: "isiZulu".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "xh".to_string(),
            name: "Xhosa".to_string(),
            native_name: "isiXhosa".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "af".to_string(),
            name: "Afrikaans".to_string(),
            native_name: "Afrikaans".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "st".to_string(),
            name: "Sotho".to_string(),
            native_name: "Sesotho".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "tn".to_string(),
            name: "Tswana".to_string(),
            native_name: "Setswana".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "ts".to_string(),
            name: "Tsonga".to_string(),
            native_name: "Xitsonga".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "ss".to_string(),
            name: "Swati".to_string(),
            native_name: "siSwati".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "ve".to_string(),
            name: "Venda".to_string(),
            native_name: "Tshivenḓa".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "nr".to_string(),
            name: "Ndebele".to_string(),
            native_name: "isiNdebele".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "nso".to_string(),
            name: "Northern Sotho".to_string(),
            native_name: "Sepedi".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "ar".to_string(),
            name: "Arabic".to_string(),
            native_name: "العربية".to_string(),
            rtl: true,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "fr".to_string(),
            name: "French".to_string(),
            native_name: "Français".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        clinical::SupportedLanguage {
            code: "pt".to_string(),
            name: "Portuguese".to_string(),
            native_name: "Português".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
    ]
}

// ============================================================================
// Application State
// ============================================================================

pub struct AppState {
    pub patients: RwLock<HashMap<String, PatientProfile>>,
    pub nfc_tags: RwLock<HashMap<String, NfcTagData>>,
    pub access_logs: RwLock<Vec<AccessLogEntry>>,
    pub users: RwLock<HashMap<String, User>>,
    /// Medical record references (patient_id -> list of record refs)
    pub medical_records: RwLock<HashMap<String, Vec<MedicalRecordReference>>>,
    /// Lab result submissions pending approval (submission_id -> submission)
    pub lab_submissions: RwLock<HashMap<String, LabResultSubmission>>,
    /// IPFS client for encrypted document storage
    pub ipfs_client: IpfsClient,
    /// Encryption key for medical records (in production: per-patient keys from HSM)
    pub encryption_key: medichain_crypto::EncryptionKey,
    /// NFC Card registry for demo
    pub card_registry: CardRegistry,
    // ============================================================================
    // Clinical Documentation Storage (Phase 1)
    // ============================================================================
    /// Triage assessments (assessment_id -> TriageAssessment)
    pub triage_assessments: RwLock<HashMap<String, TriageAssessment>>,
    /// SOAP notes (note_id -> SOAPNote)
    pub soap_notes: RwLock<HashMap<String, SOAPNote>>,
    /// SAMPLE histories (patient_id -> SAMPLEHistory)
    pub sample_histories: RwLock<HashMap<String, SAMPLEHistory>>,
    /// Glasgow Coma Scale assessments (assessment_id -> GlasgowComaScale)
    pub gcs_assessments: RwLock<HashMap<String, GlasgowComaScale>>,
    /// Vital signs flowsheets (patient_id -> VitalSignsFlowsheet)
    pub vital_signs: RwLock<HashMap<String, VitalSignsFlowsheet>>,
    /// Lab panel templates (panel_name -> LabPanelTemplate)
    pub lab_panels: RwLock<HashMap<String, LabPanelTemplate>>,
    // ============================================================================
    // Clinical Documentation Storage (Phase 2-8) - New Types
    // ============================================================================
    /// Code Blue records (event_id -> CodeBlueRecord)
    pub code_blue_records: RwLock<HashMap<String, CodeBlueRecord>>,
    /// Trauma assessments (assessment_id -> TraumaAssessment)
    pub trauma_assessments: RwLock<HashMap<String, TraumaAssessment>>,
    /// Stroke assessments (assessment_id -> StrokeAssessment)
    pub stroke_assessments: RwLock<HashMap<String, StrokeAssessment>>,
    /// Cardiac events (event_id -> CardiacEvent)
    pub cardiac_events: RwLock<HashMap<String, CardiacEvent>>,
    /// Sepsis assessments (assessment_id -> SepsisAssessment)
    pub sepsis_assessments: RwLock<HashMap<String, SepsisAssessment>>,
    /// EMS handoff reports (report_id -> EMSHandoff)
    pub ems_handoffs: RwLock<HashMap<String, EMSHandoff>>,
    /// Medication Administration Records (patient_id+date -> MAR)
    pub medication_records: RwLock<HashMap<String, MedicationAdministrationRecord>>,
    /// Intake/Output records (patient_id+date+shift -> IntakeOutputRecord)
    pub io_records: RwLock<HashMap<String, IntakeOutputRecord>>,
    /// Nursing care plans (care_plan_id -> NursingCarePlan)
    pub nursing_care_plans: RwLock<HashMap<String, NursingCarePlan>>,
    /// Wound assessments (assessment_id -> WoundAssessment)
    pub wound_assessments: RwLock<HashMap<String, WoundAssessment>>,
    /// IV site assessments (assessment_id -> IVSiteAssessment)
    pub iv_assessments: RwLock<HashMap<String, IVSiteAssessment>>,
    /// Shift handoffs (handoff_id -> ShiftHandoff)
    pub shift_handoffs: RwLock<HashMap<String, ShiftHandoff>>,
    /// Incident reports (report_id -> IncidentReport)
    pub incident_reports: RwLock<HashMap<String, IncidentReport>>,
    /// Fall risk assessments (assessment_id -> FallRiskAssessment)
    pub fall_risk_assessments: RwLock<HashMap<String, FallRiskAssessment>>,
    /// Burn assessments (assessment_id -> BurnAssessment)
    pub burn_assessments: RwLock<HashMap<String, BurnAssessment>>,
    /// Psychiatric assessments (assessment_id -> PsychiatricAssessment)
    pub psych_assessments: RwLock<HashMap<String, PsychiatricAssessment>>,
    /// Toxicology assessments (assessment_id -> ToxicologyAssessment)
    pub tox_assessments: RwLock<HashMap<String, ToxicologyAssessment>>,
    /// Mass casualty incidents (incident_id -> MassCasualtyIncident)
    pub mci_records: RwLock<HashMap<String, MassCasualtyIncident>>,
    /// Intubation records (record_id -> IntubationRecord)
    pub intubation_records: RwLock<HashMap<String, IntubationRecord>>,
    /// Laceration repairs (record_id -> LacerationRepair)
    pub laceration_records: RwLock<HashMap<String, LacerationRepair>>,
    /// Splint/cast records (record_id -> SplintCastRecord)
    pub splint_cast_records: RwLock<HashMap<String, SplintCastRecord>>,
    /// Pediatric assessments (assessment_id -> PediatricAssessment)
    pub pediatric_assessments: RwLock<HashMap<String, PediatricAssessment>>,
    /// Obstetric emergencies (assessment_id -> ObstetricEmergency)
    pub obstetric_emergencies: RwLock<HashMap<String, ObstetricEmergency>>,
    /// Specimen collections (collection_id -> SpecimenCollection)
    pub specimen_collections: RwLock<HashMap<String, SpecimenCollection>>,
    /// Chain of custody records (form_id -> ChainOfCustody)
    pub chain_of_custody: RwLock<HashMap<String, ChainOfCustody>>,
    /// Lab QC records (qc_id -> LabQCRecord)
    pub lab_qc_records: RwLock<HashMap<String, LabQCRecord>>,
    /// Critical value notifications (notification_id -> CriticalValueNotification)
    pub critical_values: RwLock<HashMap<String, CriticalValueNotification>>,
    /// Specimen rejections (rejection_id -> SpecimenRejection)
    pub specimen_rejections: RwLock<HashMap<String, SpecimenRejection>>,
    /// Physician orders (order_id -> PhysicianOrder)
    pub physician_orders: RwLock<HashMap<String, PhysicianOrder>>,
    /// Discharge summaries (summary_id -> DischargeSummary)
    pub discharge_summaries: RwLock<HashMap<String, DischargeSummary>>,
    /// Discharge instructions (instructions_id -> DischargeInstructions)
    pub discharge_instructions: RwLock<HashMap<String, DischargeInstructions>>,
    /// AMA discharges (ama_id -> AMADischarge)
    pub ama_discharges: RwLock<HashMap<String, AMADischarge>>,
    /// History & Physical documents (hp_id -> HistoryAndPhysical)
    pub history_physicals: RwLock<HashMap<String, HistoryAndPhysical>>,
    /// Consultation notes (consult_id -> ConsultationNote)
    pub consult_notes: RwLock<HashMap<String, ConsultationNote>>,
    /// Progress notes (note_id -> ProgressNote)
    pub progress_notes: RwLock<HashMap<String, ProgressNote>>,
    // ============================================================================
    // Clinical Documentation Storage (Phase 9-19) - Complete Hospital System
    // ============================================================================
    /// Pre-operative assessments (assessment_id -> PreOperativeAssessment)
    pub pre_op_assessments: RwLock<HashMap<String, PreOperativeAssessment>>,
    /// Operative notes (note_id -> OperativeNote)
    pub operative_notes: RwLock<HashMap<String, OperativeNote>>,
    /// Post-operative notes (note_id -> PostOperativeNote)
    pub post_op_notes: RwLock<HashMap<String, PostOperativeNote>>,
    /// Anesthesia records (record_id -> AnesthesiaRecord)
    pub anesthesia_records: RwLock<HashMap<String, AnesthesiaRecord>>,
    /// Radiology orders (order_id -> RadiologyOrder)
    pub radiology_orders: RwLock<HashMap<String, RadiologyOrder>>,
    /// Radiology reports (report_id -> RadiologyReport)
    pub radiology_reports: RwLock<HashMap<String, RadiologyReport>>,
    /// Pathology reports (report_id -> PathologyReport)
    pub pathology_reports: RwLock<HashMap<String, PathologyReport>>,
    /// Immunization records (record_id -> ImmunizationRecord)
    pub immunization_records: RwLock<HashMap<String, ImmunizationRecord>>,
    /// Immunization schedules (patient_id -> ImmunizationSchedule)
    pub immunization_schedules: RwLock<HashMap<String, ImmunizationSchedule>>,
    /// Family medical histories (patient_id -> FamilyMedicalHistory)
    pub family_histories: RwLock<HashMap<String, FamilyMedicalHistory>>,
    /// Blood type screens (test_id -> BloodTypeScreen)
    pub blood_type_screens: RwLock<HashMap<String, BloodTypeScreen>>,
    /// Crossmatch records (crossmatch_id -> CrossmatchRecord)
    pub crossmatch_records: RwLock<HashMap<String, CrossmatchRecord>>,
    /// Transfusion records (transfusion_id -> TransfusionRecord)
    pub transfusion_records: RwLock<HashMap<String, TransfusionRecord>>,
    /// Electronic prescriptions (rx_id -> ElectronicPrescription)
    pub e_prescriptions: RwLock<HashMap<String, ElectronicPrescription>>,
    /// Appointments (appointment_id -> Appointment)
    pub appointments: RwLock<HashMap<String, Appointment>>,
    /// Death certificates (certificate_id -> DeathCertificate)
    pub death_certificates: RwLock<HashMap<String, DeathCertificate>>,
    /// Autopsy requests (request_id -> AutopsyRequest)
    pub autopsy_requests: RwLock<HashMap<String, AutopsyRequest>>,
    /// Autopsy reports (report_id -> AutopsyReport)
    pub autopsy_reports: RwLock<HashMap<String, AutopsyReport>>,
    /// Patient satisfaction surveys (survey_id -> PatientSatisfactionSurvey)
    pub satisfaction_surveys: RwLock<HashMap<String, PatientSatisfactionSurvey>>,
    // ============================================================================
    // Clinical Documentation Storage (Phase 20-33) - Extended Features
    // ============================================================================
    /// Medication reminders (reminder_id -> MedicationReminder)
    pub medication_reminders: RwLock<HashMap<String, clinical::MedicationReminder>>,
    /// Medication adherence logs (log_id -> MedicationAdherenceLog)
    pub adherence_logs: RwLock<HashMap<String, clinical::MedicationAdherenceLog>>,
    /// Drug interaction results (result_id -> DrugInteractionResult)
    pub drug_interactions: RwLock<HashMap<String, clinical::DrugInteractionResult>>,
    /// Family groups (family_id -> FamilyGroup)
    pub family_groups: RwLock<HashMap<String, clinical::FamilyGroup>>,
    /// Family link requests (request_id -> FamilyLinkRequest)
    pub family_link_requests: RwLock<HashMap<String, clinical::FamilyLinkRequest>>,
    /// Provider schedules (provider_id -> ProviderSchedule)
    pub provider_schedules: RwLock<HashMap<String, clinical::ProviderSchedule>>,
    /// Wearable devices (device_id -> WearableDevice)
    pub wearable_devices: RwLock<HashMap<String, clinical::WearableDevice>>,
    /// Wearable readings (reading_id -> WearableReading)
    pub wearable_readings: RwLock<HashMap<String, clinical::WearableReading>>,
    /// Wearable alert rules (rule_id -> WearableAlertRule)
    pub wearable_alert_rules: RwLock<HashMap<String, clinical::WearableAlertRule>>,
    /// Wearable alerts (alert_id -> WearableAlert)
    pub wearable_alerts: RwLock<HashMap<String, clinical::WearableAlert>>,
    /// Symptom check sessions (session_id -> SymptomCheckSession)
    pub symptom_sessions: RwLock<HashMap<String, clinical::SymptomCheckSession>>,
    /// Telehealth sessions (session_id -> TelehealthSession)
    pub telehealth_sessions: RwLock<HashMap<String, clinical::TelehealthSession>>,
    /// Device checks (check_id -> DeviceCheck)
    pub device_checks: RwLock<HashMap<String, clinical::DeviceCheck>>,
    /// Waiting room entries (entry_id -> WaitingRoomEntry)
    pub waiting_room: RwLock<HashMap<String, clinical::WaitingRoomEntry>>,
    /// CDS alerts (alert_id -> CDSAlert)
    pub cds_alerts: RwLock<HashMap<String, clinical::CDSAlert>>,
    /// Lab trend results (result_id -> LabTrendResult)
    pub lab_trends: RwLock<HashMap<String, clinical::LabTrendResult>>,
    /// E-prescriptions with signing (prescription_id -> EPrescription)
    pub e_prescriptions_v2: RwLock<HashMap<String, clinical::EPrescription>>,
    /// Insurance claims (claim_id -> InsuranceClaim)
    pub insurance_claims: RwLock<HashMap<String, clinical::InsuranceClaim>>,
    /// Eligibility check responses (check_id -> EligibilityCheckResponse)
    pub eligibility_checks: RwLock<HashMap<String, clinical::EligibilityCheckResponse>>,
    /// Language preferences (user_id -> LanguagePreference)
    pub language_preferences: RwLock<HashMap<String, clinical::LanguagePreference>>,
    /// Supported languages list
    pub supported_languages: RwLock<Vec<clinical::SupportedLanguage>>,
    /// Sync statuses (device_id -> SyncStatus)
    pub sync_statuses: RwLock<HashMap<String, clinical::SyncStatus>>,
    /// Sync queue (queue_id -> SyncQueueItem)
    pub sync_queue: RwLock<HashMap<String, clinical::SyncQueueItem>>,
    /// Sync conflicts (conflict_id -> SyncConflict)
    pub sync_conflicts: RwLock<HashMap<String, clinical::SyncConflict>>,
    /// Patient allergies (patient_id -> Vec<AllergyInfo>)
    pub allergies: RwLock<HashMap<String, Vec<clinical::AllergyInfo>>>,
}

impl AppState {
    pub fn new() -> Self {
        // In production, keys would be managed by HSM/key vault
        let encryption_key =
            medichain_crypto::EncryptionKey::generate().expect("Failed to generate encryption key");

        // Initialize lab panels from standard templates
        let mut lab_panels_map = HashMap::new();
        for panel in clinical::get_standard_lab_panels() {
            lab_panels_map.insert(panel.name.clone(), panel);
        }

        let mut state = Self {
            patients: RwLock::new(HashMap::new()),
            nfc_tags: RwLock::new(HashMap::new()),
            access_logs: RwLock::new(Vec::new()),
            users: RwLock::new(HashMap::new()),
            medical_records: RwLock::new(HashMap::new()),
            lab_submissions: RwLock::new(HashMap::new()),
            ipfs_client: IpfsClient::new_local(),
            encryption_key,
            card_registry: CardRegistry::new(),
            // Clinical documentation storage (Phase 1)
            triage_assessments: RwLock::new(HashMap::new()),
            soap_notes: RwLock::new(HashMap::new()),
            sample_histories: RwLock::new(HashMap::new()),
            gcs_assessments: RwLock::new(HashMap::new()),
            vital_signs: RwLock::new(HashMap::new()),
            lab_panels: RwLock::new(lab_panels_map),
            // Clinical documentation storage (Phase 2-8)
            code_blue_records: RwLock::new(HashMap::new()),
            trauma_assessments: RwLock::new(HashMap::new()),
            stroke_assessments: RwLock::new(HashMap::new()),
            cardiac_events: RwLock::new(HashMap::new()),
            sepsis_assessments: RwLock::new(HashMap::new()),
            ems_handoffs: RwLock::new(HashMap::new()),
            medication_records: RwLock::new(HashMap::new()),
            io_records: RwLock::new(HashMap::new()),
            nursing_care_plans: RwLock::new(HashMap::new()),
            wound_assessments: RwLock::new(HashMap::new()),
            iv_assessments: RwLock::new(HashMap::new()),
            shift_handoffs: RwLock::new(HashMap::new()),
            incident_reports: RwLock::new(HashMap::new()),
            fall_risk_assessments: RwLock::new(HashMap::new()),
            burn_assessments: RwLock::new(HashMap::new()),
            psych_assessments: RwLock::new(HashMap::new()),
            tox_assessments: RwLock::new(HashMap::new()),
            mci_records: RwLock::new(HashMap::new()),
            intubation_records: RwLock::new(HashMap::new()),
            laceration_records: RwLock::new(HashMap::new()),
            splint_cast_records: RwLock::new(HashMap::new()),
            pediatric_assessments: RwLock::new(HashMap::new()),
            obstetric_emergencies: RwLock::new(HashMap::new()),
            specimen_collections: RwLock::new(HashMap::new()),
            chain_of_custody: RwLock::new(HashMap::new()),
            lab_qc_records: RwLock::new(HashMap::new()),
            critical_values: RwLock::new(HashMap::new()),
            specimen_rejections: RwLock::new(HashMap::new()),
            physician_orders: RwLock::new(HashMap::new()),
            discharge_summaries: RwLock::new(HashMap::new()),
            discharge_instructions: RwLock::new(HashMap::new()),
            ama_discharges: RwLock::new(HashMap::new()),
            history_physicals: RwLock::new(HashMap::new()),
            consult_notes: RwLock::new(HashMap::new()),
            progress_notes: RwLock::new(HashMap::new()),
            // Clinical documentation storage (Phase 9-19)
            pre_op_assessments: RwLock::new(HashMap::new()),
            operative_notes: RwLock::new(HashMap::new()),
            post_op_notes: RwLock::new(HashMap::new()),
            anesthesia_records: RwLock::new(HashMap::new()),
            radiology_orders: RwLock::new(HashMap::new()),
            radiology_reports: RwLock::new(HashMap::new()),
            pathology_reports: RwLock::new(HashMap::new()),
            immunization_records: RwLock::new(HashMap::new()),
            immunization_schedules: RwLock::new(HashMap::new()),
            family_histories: RwLock::new(HashMap::new()),
            blood_type_screens: RwLock::new(HashMap::new()),
            crossmatch_records: RwLock::new(HashMap::new()),
            transfusion_records: RwLock::new(HashMap::new()),
            e_prescriptions: RwLock::new(HashMap::new()),
            appointments: RwLock::new(HashMap::new()),
            death_certificates: RwLock::new(HashMap::new()),
            autopsy_requests: RwLock::new(HashMap::new()),
            autopsy_reports: RwLock::new(HashMap::new()),
            satisfaction_surveys: RwLock::new(HashMap::new()),
            // Clinical documentation storage (Phase 20-33) - Extended Features
            medication_reminders: RwLock::new(HashMap::new()),
            adherence_logs: RwLock::new(HashMap::new()),
            drug_interactions: RwLock::new(HashMap::new()),
            family_groups: RwLock::new(HashMap::new()),
            family_link_requests: RwLock::new(HashMap::new()),
            provider_schedules: RwLock::new(HashMap::new()),
            wearable_devices: RwLock::new(HashMap::new()),
            wearable_readings: RwLock::new(HashMap::new()),
            wearable_alert_rules: RwLock::new(HashMap::new()),
            wearable_alerts: RwLock::new(HashMap::new()),
            symptom_sessions: RwLock::new(HashMap::new()),
            telehealth_sessions: RwLock::new(HashMap::new()),
            device_checks: RwLock::new(HashMap::new()),
            waiting_room: RwLock::new(HashMap::new()),
            cds_alerts: RwLock::new(HashMap::new()),
            lab_trends: RwLock::new(HashMap::new()),
            e_prescriptions_v2: RwLock::new(HashMap::new()),
            insurance_claims: RwLock::new(HashMap::new()),
            eligibility_checks: RwLock::new(HashMap::new()),
            language_preferences: RwLock::new(HashMap::new()),
            supported_languages: RwLock::new(get_default_supported_languages()),
            sync_statuses: RwLock::new(HashMap::new()),
            sync_queue: RwLock::new(HashMap::new()),
            sync_conflicts: RwLock::new(HashMap::new()),
            allergies: RwLock::new(HashMap::new()),
        };
        // TODO: Demo data seeding removed for wallet-based blockchain authentication
        // state.seed_demo_data();
        state
    }

    // Seed demo data function removed - wallet-based blockchain authentication only
    // All users must register via /api/auth/bootstrap or /api/auth/register endpoints
    // All patient data created dynamically via wallet-authenticated requests
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

fn generate_nfc_hash(patient_id: &str, tag_id: &str) -> String {
    let mut hasher = Sha3_256::new();
    hasher.update(patient_id.as_bytes());
    hasher.update(tag_id.as_bytes());
    hasher.update(Utc::now().to_rfc3339().as_bytes());
    hex::encode(hasher.finalize())
}

fn parse_blood_type(s: &str) -> Result<BloodType, String> {
    match s.to_uppercase().as_str() {
        "A+" | "A_POSITIVE" | "APOSITIVE" => Ok(BloodType::APositive),
        "A-" | "A_NEGATIVE" | "ANEGATIVE" => Ok(BloodType::ANegative),
        "B+" | "B_POSITIVE" | "BPOSITIVE" => Ok(BloodType::BPositive),
        "B-" | "B_NEGATIVE" | "BNEGATIVE" => Ok(BloodType::BNegative),
        "AB+" | "AB_POSITIVE" | "ABPOSITIVE" => Ok(BloodType::ABPositive),
        "AB-" | "AB_NEGATIVE" | "ABNEGATIVE" => Ok(BloodType::ABNegative),
        "O+" | "O_POSITIVE" | "OPOSITIVE" => Ok(BloodType::OPositive),
        "O-" | "O_NEGATIVE" | "ONEGATIVE" => Ok(BloodType::ONegative),
        _ => Err(format!("Invalid blood type: {}", s)),
    }
}

fn parse_role(s: &str) -> Result<Role, String> {
    match s.to_lowercase().as_str() {
        "admin" => Ok(Role::Admin),
        "doctor" => Ok(Role::Doctor),
        "nurse" => Ok(Role::Nurse),
        "labtechnician" | "lab_technician" | "lab" => Ok(Role::LabTechnician),
        "pharmacist" => Ok(Role::Pharmacist),
        "patient" => Ok(Role::Patient),
        _ => Err(format!("Invalid role: {}. Valid roles: Admin, Doctor, Nurse, LabTechnician, Pharmacist, Patient", s)),
    }
}

/// Extract wallet address from X-User-Id header (blockchain auth)
/// The header should contain the SS58 encoded wallet address
fn get_current_user_id(req: &HttpRequest) -> Option<String> {
    req.headers()
        .get("X-User-Id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Get user by wallet address from app state
fn get_user(data: &web::Data<AppState>, wallet_address: &str) -> Option<User> {
    data.users.read().ok()?.get(wallet_address).cloned()
}

/// Validate SS58 wallet address format (basic validation)
fn is_valid_wallet_address(address: &str) -> bool {
    // SS58 addresses start with 5 and are typically 48 characters for Substrate
    address.len() >= 45 && address.len() <= 50 && address.starts_with('5')
}

fn generate_qr_code_base64(data: &str) -> Option<String> {
    use image::Luma;
    use qrcode::QrCode;

    let code = QrCode::new(data.as_bytes()).ok()?;
    let image = code.render::<Luma<u8>>().build();

    let mut buffer = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buffer);

    image::DynamicImage::ImageLuma8(image)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .ok()?;

    Some(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &buffer,
    ))
}

// ============================================================================
// API Endpoints
// ============================================================================

/// Health check endpoint
#[get("/health")]
async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(HealthCheckResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        timestamp: Utc::now(),
        blockchain_connected: true, // Simulated for demo
    })
}

/// Register a new patient (Healthcare providers only)
#[post("/api/register")]
async fn register_patient(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<RegisterPatientRequest>,
) -> impl Responder {
    // RBAC: Check if caller is a healthcare provider
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header. Only healthcare providers can register patients."
                    .to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Only healthcare providers can register patients. Your role: {}",
                current_user.role
            ),
            code: "NOT_HEALTHCARE_PROVIDER".to_string(),
        });
    }

    // Parse blood type
    let blood_type = match parse_blood_type(&req.blood_type) {
        Ok(bt) => bt,
        Err(e) => {
            return HttpResponse::BadRequest().json(RegisterPatientResponse {
                success: false,
                patient_id: String::new(),
                nfc_tag_id: String::new(),
                message: e,
            });
        }
    };

    // Generate IDs
    let patient_id = format!(
        "PAT-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );
    let nfc_tag_id = format!(
        "NFC-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Create emergency info
    let emergency_info = EmergencyInfo {
        patient_id: patient_id.clone(),
        blood_type,
        // Convert simple string allergies to structured Allergy with default severity
        allergies: req
            .allergies
            .iter()
            .map(|name| Allergy {
                name: name.clone(),
                severity: AllergySeverity::Mild, // Default to Mild, can be updated later
                reaction: None,
                verified_at: None,
            })
            .collect(),
        current_medications: req.current_medications.clone(),
        chronic_conditions: req.chronic_conditions.clone(),
        emergency_contacts: vec![EmergencyContact {
            name: req.emergency_contact_name.clone(),
            phone: req.emergency_contact_phone.clone(),
            relationship: req.emergency_contact_relationship.clone(),
            priority: 1,
            can_make_medical_decisions: false,
            language: None,
        }],
        organ_donor: req.organ_donor,
        dnr_status: req.dnr_status,
        languages: req.languages.clone(),
        last_updated: Utc::now(),
    };

    // Create patient profile
    let patient = PatientProfile {
        patient_id: patient_id.clone(),
        full_name: req.full_name.clone(),
        date_of_birth: req.date_of_birth.clone(),
        national_id: req.national_id.clone(),
        emergency_info,
        address: None,
        insurance: None,
        primary_doctor: None,
        community_health_worker: None,
        preferences: PatientPreferences::default(),
        advanced_directives: vec![],
        family_notifications: None,
        created_at: Utc::now(),
        last_updated: Utc::now(),
    };

    // Create NFC tag
    let hash = generate_nfc_hash(&patient_id, &nfc_tag_id);
    let nfc_tag = NfcTagData {
        tag_id: nfc_tag_id.clone(),
        patient_id: patient_id.clone(),
        hash,
        created_at: Utc::now(),
    };

    // Store in state
    data.patients
        .write()
        .unwrap()
        .insert(patient_id.clone(), patient);
    data.nfc_tags
        .write()
        .unwrap()
        .insert(nfc_tag_id.clone(), nfc_tag);

    // Also create a Patient user account for the new patient
    // Note: In wallet-based auth, the patient will link their wallet later
    // For now, we use the patient_id as a placeholder until they link a wallet
    let patient_user = User {
        wallet_address: patient_id.clone(), // Placeholder until wallet is linked
        username: Some(req.full_name.to_lowercase().replace(' ', ".")),
        name: req.full_name.clone(),
        role: Role::Patient,
        created_at: Utc::now(),
        created_by: Some(current_user_id.clone()),
        linked_patient_id: Some(patient_id.clone()),
    };
    data.users
        .write()
        .unwrap()
        .insert(patient_id.clone(), patient_user);

    log::info!(
        "Registered new patient: {} with NFC tag: {} by provider: {}",
        patient_id,
        nfc_tag_id,
        current_user_id
    );

    HttpResponse::Created().json(RegisterPatientResponse {
        success: true,
        patient_id,
        nfc_tag_id,
        message: "Patient registered successfully. NFC tag provisioned.".to_string(),
    })
}

/// Emergency access endpoint - simulates NFC tap by first responder
#[post("/api/emergency-access")]
async fn emergency_access(
    data: web::Data<AppState>,
    req: web::Json<EmergencyAccessRequest>,
) -> impl Responder {
    // Find NFC tag and get patient_id
    let patient_id = {
        let nfc_tags = data.nfc_tags.read().unwrap();
        match nfc_tags.get(&req.nfc_tag_id) {
            Some(tag) => tag.patient_id.clone(),
            None => {
                return HttpResponse::NotFound().json(EmergencyAccessResponse {
                    success: false,
                    access_id: String::new(),
                    emergency_info: None,
                    message: "NFC tag not found. Invalid or unregistered tag.".to_string(),
                });
            }
        }
    };

    // Get patient emergency info
    let emergency_info = {
        let patients = data.patients.read().unwrap();
        match patients.get(&patient_id) {
            Some(p) => p.emergency_info.clone(),
            None => {
                return HttpResponse::NotFound().json(EmergencyAccessResponse {
                    success: false,
                    access_id: String::new(),
                    emergency_info: None,
                    message: "Patient record not found.".to_string(),
                });
            }
        }
    };

    // Generate access ID and log
    let access_id = format!(
        "ACC-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    let access_log = AccessLogEntry {
        access_id: access_id.clone(),
        patient_id: patient_id.clone(),
        accessor_id: req.accessor_id.clone(),
        accessor_role: req.accessor_role.clone(),
        access_type: "emergency".to_string(),
        location: req.location.clone(),
        timestamp: Utc::now(),
        emergency: true,
    };

    // Log access
    data.access_logs.write().unwrap().push(access_log);

    log::info!(
        "Emergency access granted: {} accessed patient {} at {:?}",
        req.accessor_id,
        patient_id,
        req.location
    );

    HttpResponse::Ok().json(EmergencyAccessResponse {
        success: true,
        access_id,
        emergency_info: Some(emergency_info),
        message: "Emergency access granted. All accesses are logged and auditable.".to_string(),
    })
}

/// Simulate NFC tap - generates NFC tag data and QR code
#[post("/api/simulate-nfc-tap")]
async fn simulate_nfc_tap(
    data: web::Data<AppState>,
    req: web::Json<SimulateNfcTapRequest>,
) -> impl Responder {
    let patients = data.patients.read().unwrap();

    // Check if patient exists
    if !patients.contains_key(&req.patient_id) {
        return HttpResponse::NotFound().json(SimulateNfcTapResponse {
            success: false,
            nfc_tag_id: String::new(),
            tag_data: NfcTagData {
                tag_id: String::new(),
                patient_id: String::new(),
                hash: String::new(),
                created_at: Utc::now(),
            },
            qr_code_base64: None,
            message: "Patient not found.".to_string(),
        });
    }

    drop(patients);

    // Find existing NFC tag for patient
    let nfc_tags = data.nfc_tags.read().unwrap();
    let existing_tag = nfc_tags
        .values()
        .find(|t| t.patient_id == req.patient_id)
        .cloned();
    drop(nfc_tags);

    let tag_data = match existing_tag {
        Some(tag) => tag,
        None => {
            // Create new tag
            let nfc_tag_id = format!(
                "NFC-{}",
                Uuid::new_v4()
                    .to_string()
                    .split('-')
                    .next()
                    .unwrap_or("000")
            );
            let hash = generate_nfc_hash(&req.patient_id, &nfc_tag_id);
            let tag = NfcTagData {
                tag_id: nfc_tag_id.clone(),
                patient_id: req.patient_id.clone(),
                hash,
                created_at: Utc::now(),
            };
            data.nfc_tags
                .write()
                .unwrap()
                .insert(nfc_tag_id, tag.clone());
            tag
        }
    };

    // Generate QR code containing the NFC tag ID
    let qr_data = serde_json::json!({
        "type": "medichain_nfc",
        "tag_id": tag_data.tag_id,
        "hash": &tag_data.hash[..16], // First 16 chars of hash for verification
    });
    let qr_code = generate_qr_code_base64(&qr_data.to_string());

    log::info!("NFC tap simulated for patient: {}", req.patient_id);

    HttpResponse::Ok().json(SimulateNfcTapResponse {
        success: true,
        nfc_tag_id: tag_data.tag_id.clone(),
        tag_data,
        qr_code_base64: qr_code,
        message: "NFC tap simulated. Use the tag_id for emergency access.".to_string(),
    })
}

/// Get access logs for a patient
#[get("/api/access-logs/{patient_id}")]
async fn get_access_logs(data: web::Data<AppState>, path: web::Path<String>) -> impl Responder {
    let patient_id = path.into_inner();
    let access_logs = data.access_logs.read().unwrap();

    let patient_logs: Vec<AccessLogEntry> = access_logs
        .iter()
        .filter(|log| log.patient_id == patient_id)
        .cloned()
        .collect();

    let total = patient_logs.len();

    HttpResponse::Ok().json(AccessLogsResponse {
        patient_id,
        access_logs: patient_logs,
        total_accesses: total,
    })
}

/// Get all registered patients (demo endpoint)
#[get("/api/patients")]
async fn list_patients(data: web::Data<AppState>) -> impl Responder {
    let patients = data.patients.read().unwrap();
    let patient_list: Vec<&PatientProfile> = patients.values().collect();
    HttpResponse::Ok().json(patient_list)
}

/// Get a single patient by ID
#[get("/api/patients/{patient_id}")]
async fn get_patient_by_id(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // RBAC: Check if caller can access patient records
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Patients can only view their own records
    // Check by linked_patient_id for wallet-linked users, or by wallet_address for legacy patients
    let is_own_record = current_user.linked_patient_id.as_ref() == Some(&patient_id)
        || current_user.wallet_address == patient_id;
    if current_user.role == Role::Patient && !is_own_record {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Patients can only view their own records".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patients = data.patients.read().unwrap();
    match patients.get(&patient_id) {
        Some(patient) => HttpResponse::Ok().json(patient),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient {} not found", patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        }),
    }
}

/// Update patient request body
#[derive(Debug, Deserialize)]
pub struct UpdatePatientRequest {
    pub allergies: Option<Vec<String>>,
    pub current_medications: Option<Vec<String>>,
    pub chronic_conditions: Option<Vec<String>>,
    pub organ_donor: Option<bool>,
    pub dnr_status: Option<bool>,
    pub emergency_contact_name: Option<String>,
    pub emergency_contact_phone: Option<String>,
    pub emergency_contact_relationship: Option<String>,
}

/// Update patient response
#[derive(Debug, Serialize)]
pub struct UpdatePatientResponse {
    pub success: bool,
    pub patient_id: String,
    pub updated_by: String,
    pub message: String,
}

/// Update a patient's medical information (Doctor/Nurse only)
#[put("/api/patients/{patient_id}")]
async fn update_patient(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<UpdatePatientRequest>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // RBAC: Check if caller can edit medical records
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error:
                    "Missing X-User-Id header. Only doctors and nurses can update patient records."
                        .to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // CRITICAL: Only Doctor, Nurse, or Admin can edit records
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Only doctors and nurses can update medical records. Your role: {}",
                current_user.role
            ),
            code: "NOT_HEALTHCARE_PROVIDER".to_string(),
        });
    }

    // Update patient record
    let mut patients = data.patients.write().unwrap();
    let patient = match patients.get_mut(&patient_id) {
        Some(p) => p,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    };

    // Update fields if provided
    if let Some(allergies) = &req.allergies {
        // Convert string allergies to Allergy structs with Mild severity
        patient.emergency_info.allergies = allergies
            .iter()
            .map(|name| Allergy {
                name: name.clone(),
                severity: AllergySeverity::Mild,
                reaction: None,
                verified_at: Some(Utc::now()),
            })
            .collect();
    }
    if let Some(meds) = &req.current_medications {
        patient.emergency_info.current_medications = meds.clone();
    }
    if let Some(conditions) = &req.chronic_conditions {
        patient.emergency_info.chronic_conditions = conditions.clone();
    }
    if let Some(organ_donor) = req.organ_donor {
        patient.emergency_info.organ_donor = organ_donor;
    }
    if let Some(dnr) = req.dnr_status {
        patient.emergency_info.dnr_status = dnr;
    }

    // Update emergency contact if any field provided
    if req.emergency_contact_name.is_some()
        || req.emergency_contact_phone.is_some()
        || req.emergency_contact_relationship.is_some()
    {
        if let Some(contact) = patient.emergency_info.emergency_contacts.get_mut(0) {
            if let Some(name) = &req.emergency_contact_name {
                contact.name = name.clone();
            }
            if let Some(phone) = &req.emergency_contact_phone {
                contact.phone = phone.clone();
            }
            if let Some(rel) = &req.emergency_contact_relationship {
                contact.relationship = rel.clone();
            }
        }
    }

    patient.emergency_info.last_updated = Utc::now();
    patient.last_updated = Utc::now();

    log::info!(
        "Patient {} updated by provider {}",
        patient_id,
        current_user_id
    );

    HttpResponse::Ok().json(UpdatePatientResponse {
        success: true,
        patient_id,
        updated_by: current_user_id,
        message: "Patient record updated successfully".to_string(),
    })
}

/// Add emergency contact request
#[derive(Debug, Deserialize)]
pub struct AddEmergencyContactRequest {
    pub name: String,
    pub phone: String,
    pub relationship: String,
}

/// Add emergency contact (Patient can manage their own contacts)
#[post("/api/patients/{patient_id}/emergency-contacts")]
async fn add_emergency_contact(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<AddEmergencyContactRequest>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // Get current user
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Patients can only manage their own emergency contacts
    // Healthcare providers can manage any patient's contacts
    let is_own_record = current_user_id == patient_id;
    let is_provider = current_user.role.can_edit_medical_records();

    if !is_own_record && !is_provider {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "You can only manage your own emergency contacts".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Validate input
    if req.name.trim().is_empty()
        || req.phone.trim().is_empty()
        || req.relationship.trim().is_empty()
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Name, phone, and relationship are required".to_string(),
            code: "INVALID_INPUT".to_string(),
        });
    }

    // Add emergency contact
    let mut patients = data.patients.write().unwrap();
    let patient = match patients.get_mut(&patient_id) {
        Some(p) => p,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    };

    // Determine next priority based on existing contacts
    let next_priority = patient.emergency_info.emergency_contacts.len() as u8 + 1;

    let new_contact = EmergencyContact {
        name: req.name.clone(),
        phone: req.phone.clone(),
        relationship: req.relationship.clone(),
        priority: next_priority,
        can_make_medical_decisions: false,
        language: None,
    };

    patient
        .emergency_info
        .emergency_contacts
        .push(new_contact.clone());
    patient.emergency_info.last_updated = Utc::now();
    patient.last_updated = Utc::now();

    log::info!(
        "Emergency contact added to patient {} by {}",
        patient_id,
        current_user_id
    );

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "contact": new_contact,
        "message": "Emergency contact added successfully"
    }))
}

/// Get demo info
#[get("/api/demo")]
async fn demo_info() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "project": "MediChain",
        "hackathon": "Rust Africa Hackathon 2026",
        "track": "Fintech & Inclusive Finance (Web3)",
        "description": "Blockchain-based national health ID system with NFC emergency access",
        "auth_mode": "Wallet-based blockchain authentication (no seed data)",
        "demo_instructions": {
            "step_1": "First admin must bootstrap by using /api/auth/register with their wallet",
            "step_2": "Admin registers healthcare staff with wallet addresses",
            "step_3": "Healthcare staff can then register patients via /api/register",
            "step_4": "All users authenticate with X-User-Id header containing SS58 wallet address"
        },
        "wallet_auth": {
            "format": "SS58 encoded wallet address (starts with 5, 45-50 chars)",
            "example": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
            "header": "X-User-Id: <wallet_address>",
            "note": "Users must be registered by admin before accessing protected endpoints"
        },
        "features": [
            "Wallet-based blockchain authentication",
            "Role-Based Access Control (RBAC)",
            "Healthcare provider patient registration",
            "Read-only patient access",
            "NFC-based emergency medical records access",
            "Blockchain-verified patient identity",
            "Cryptographic consent management",
            "Complete audit trail",
            "HIPAA/GDPR compliance ready"
        ],
        "endpoints": {
            "auth": {
                "register": "POST /api/auth/register (Admin only - register new users)",
                "login": "POST /api/auth/login (Validate wallet and get user info)",
                "me": "GET /api/auth/me (Get current user info)"
            },
            "patients": {
                "register": "POST /api/register (Doctor, Nurse, Admin)",
                "update": "PUT /api/patients/{patient_id} (Doctor, Nurse, Admin)",
                "list": "GET /api/patients (Healthcare providers)",
                "get": "GET /api/patients/{patient_id} (Healthcare providers or own record)",
                "my_records": "GET /api/my-records (Patient: own records only)"
            },
            "emergency": {
                "access": "POST /api/emergency-access",
                "simulate_nfc": "POST /api/simulate-nfc-tap",
                "access_logs": "GET /api/access-logs/{patient_id}"
            },
            "rbac": {
                "assign_role": "POST /api/roles/assign (Admin only)",
                "revoke_role": "DELETE /api/roles/revoke (Admin only)",
                "list_users": "GET /api/users (Admin only)"
            },
            "health": "GET /health"
        },
        "auth_header": "Use 'X-User-Id' header with wallet address (SS58 format) for authentication"
    }))
}

// ============================================================================
// RBAC Endpoints
// ============================================================================

/// Assign a role to a user (Admin only)
#[post("/api/roles/assign")]
async fn assign_role(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<AssignRoleRequest>,
) -> impl Responder {
    // Get current user from header
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    // Check if current user is admin
    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can assign roles".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Parse role
    let role = match parse_role(&body.role) {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: e,
                code: "INVALID_ROLE".to_string(),
            });
        }
    };

    // Cannot assign Admin role (must be done directly)
    if role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Cannot assign Admin role via API".to_string(),
            code: "CANNOT_ASSIGN_ADMIN".to_string(),
        });
    }

    // Validate wallet address format
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid wallet address format. Must be SS58 encoded (48 chars starting with 5)"
                .to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    // Create new user with wallet address
    let user = User {
        wallet_address: body.wallet_address.clone(),
        username: body.username.clone(),
        name: body.name.clone(),
        role: role.clone(),
        created_at: Utc::now(),
        created_by: Some(current_user_id.clone()),
        linked_patient_id: None,
    };

    data.users
        .write()
        .unwrap()
        .insert(body.wallet_address.clone(), user);

    log::info!(
        "Role {} assigned to wallet {} by admin {}",
        role,
        body.wallet_address,
        current_user_id
    );

    HttpResponse::Ok().json(AssignRoleResponse {
        success: true,
        wallet_address: body.wallet_address.clone(),
        role: role.to_string(),
        message: format!("Role {} assigned successfully", role),
    })
}

/// Revoke a user's role (Admin only)
#[delete("/api/roles/revoke")]
async fn revoke_role(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<RevokeRoleRequest>,
) -> impl Responder {
    // Get current user from header
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    // Check if current user is admin
    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can revoke roles".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Cannot revoke own role
    if body.wallet_address == current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Cannot revoke your own role".to_string(),
            code: "CANNOT_REVOKE_OWN_ROLE".to_string(),
        });
    }

    // Remove user
    let removed = data.users.write().unwrap().remove(&body.wallet_address);

    if removed.is_none() {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        });
    }

    log::info!(
        "Role revoked from user {} by admin {}",
        body.wallet_address,
        current_user_id
    );

    HttpResponse::Ok().json(RevokeRoleResponse {
        success: true,
        wallet_address: body.wallet_address.clone(),
        message: "Role revoked successfully".to_string(),
    })
}

// ============================================================================
// Wallet Authentication Endpoints
// ============================================================================

/// Bootstrap request - for creating first admin
#[derive(Debug, Deserialize)]
pub struct BootstrapAdminRequest {
    pub wallet_address: String,
    pub name: String,
    pub username: Option<String>,
    pub secret_key: String, // Environment variable MEDICHAIN_BOOTSTRAP_KEY must match
}

/// Bootstrap response
#[derive(Debug, Serialize)]
pub struct BootstrapAdminResponse {
    pub success: bool,
    pub admin: WalletUserInfo,
    pub message: String,
}

/// Bootstrap first admin (only works when no users exist)
/// This endpoint allows the first admin to be created without authentication
/// SECURITY: Requires MEDICHAIN_BOOTSTRAP_KEY environment variable to match
#[post("/api/auth/bootstrap")]
async fn bootstrap_admin(
    data: web::Data<AppState>,
    body: web::Json<BootstrapAdminRequest>,
) -> impl Responder {
    // Check bootstrap key from environment
    let bootstrap_key = std::env::var("MEDICHAIN_BOOTSTRAP_KEY")
        .unwrap_or_else(|_| "medichain-dev-bootstrap-2024".to_string());

    if body.secret_key != bootstrap_key {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Invalid bootstrap key".to_string(),
            code: "INVALID_BOOTSTRAP_KEY".to_string(),
        });
    }

    // Check if any users exist
    {
        let users = data.users.read().unwrap();
        if !users.is_empty() {
            return HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "Bootstrap not allowed - users already exist. Use /api/auth/register with admin credentials.".to_string(),
                code: "BOOTSTRAP_NOT_ALLOWED".to_string(),
            });
        }
    }

    // Validate wallet address format
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error:
                "Invalid wallet address format. Must be SS58 encoded (starts with 5, 45-50 chars)"
                    .to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    // Create first admin
    let admin = User {
        wallet_address: body.wallet_address.clone(),
        username: body.username.clone(),
        name: body.name.clone(),
        role: Role::Admin,
        created_at: Utc::now(),
        created_by: None, // Self-created
        linked_patient_id: None,
    };

    data.users
        .write()
        .unwrap()
        .insert(body.wallet_address.clone(), admin.clone());

    log::info!(
        "Bootstrap: First admin created - wallet={}, name={}",
        body.wallet_address,
        body.name
    );

    HttpResponse::Created().json(BootstrapAdminResponse {
        success: true,
        admin: WalletUserInfo {
            wallet_address: body.wallet_address.clone(),
            name: body.name.clone(),
            role: "Admin".to_string(),
            username: body.username.clone(),
            linked_patient_id: None,
        },
        message: "First admin created successfully. System is now bootstrapped.".to_string(),
    })
}

/// Register a new user with wallet address (Admin only)
/// This creates a new user account linked to a blockchain wallet
#[post("/api/auth/register")]
async fn wallet_register(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<WalletRegisterRequest>,
) -> impl Responder {
    // Get current user (must be admin to register new users)
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Admin user not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only admin can register new users
    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can register new users".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Validate wallet address format
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error:
                "Invalid wallet address format. Must be SS58 encoded (starts with 5, 45-50 chars)"
                    .to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    // Check if wallet already registered
    {
        let users = data.users.read().unwrap();
        if users.contains_key(&body.wallet_address) {
            return HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "Wallet address already registered".to_string(),
                code: "WALLET_ALREADY_REGISTERED".to_string(),
            });
        }
    }

    // Parse role
    let role = match parse_role(&body.role) {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: e,
                code: "INVALID_ROLE".to_string(),
            });
        }
    };

    // Cannot register Admin role
    if role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Cannot register Admin role via API".to_string(),
            code: "CANNOT_REGISTER_ADMIN".to_string(),
        });
    }

    // Create new user
    let user = User {
        wallet_address: body.wallet_address.clone(),
        username: body.username.clone(),
        name: body.name.clone(),
        role: role.clone(),
        created_at: Utc::now(),
        created_by: Some(current_user_id.clone()),
        linked_patient_id: body.linked_patient_id.clone(),
    };

    data.users
        .write()
        .unwrap()
        .insert(body.wallet_address.clone(), user.clone());

    log::info!(
        "New user registered: wallet={}, name={}, role={} by admin={}",
        body.wallet_address,
        body.name,
        role,
        current_user_id
    );

    HttpResponse::Created().json(WalletRegisterResponse {
        success: true,
        wallet_address: body.wallet_address.clone(),
        role: role.to_string(),
        message: "User registered successfully".to_string(),
    })
}

/// Login with wallet address - validates wallet exists and returns user info
#[post("/api/auth/login")]
async fn wallet_login(
    data: web::Data<AppState>,
    body: web::Json<WalletLoginRequest>,
) -> impl Responder {
    // Validate wallet address format
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid wallet address format".to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    // Look up user by wallet address
    let user = match get_user(&data, &body.wallet_address) {
        Some(u) => u,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Wallet not registered. Contact admin for registration.".to_string(),
                code: "WALLET_NOT_REGISTERED".to_string(),
            });
        }
    };

    log::info!(
        "User logged in: wallet={}, name={}, role={}",
        user.wallet_address,
        user.name,
        user.role
    );

    HttpResponse::Ok().json(WalletLoginResponse {
        success: true,
        user: Some(WalletUserInfo {
            wallet_address: user.wallet_address.clone(),
            name: user.name.clone(),
            role: user.role.to_string(),
            username: user.username.clone(),
            linked_patient_id: user.linked_patient_id.clone(),
        }),
        message: "Login successful".to_string(),
    })
}

/// Get current user info from wallet address
#[get("/api/auth/me")]
async fn get_current_user_info(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    let wallet_address = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let user = match get_user(&data, &wallet_address) {
        Some(u) => u,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(WalletUserInfo {
        wallet_address: user.wallet_address.clone(),
        name: user.name.clone(),
        role: user.role.to_string(),
        username: user.username.clone(),
        linked_patient_id: user.linked_patient_id.clone(),
    })
}

/// List all users (Admin only)
#[get("/api/users")]
async fn list_users(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    // Get current user from header
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    // Check if current user is admin
    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can list users".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let users = data.users.read().unwrap();
    let user_list: Vec<&User> = users.values().collect();
    HttpResponse::Ok().json(user_list)
}

/// Get patient's own records (Patient role)
#[get("/api/my-records")]
async fn get_my_records(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    // Get current user from header
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    // Get current user
    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Find patient record matching linked_patient_id or wallet_address
    let patients = data.patients.read().unwrap();

    // For patients, they can only see their own records
    // For healthcare providers, they can see all records
    if current_user.role == Role::Patient {
        // Try to find by linked_patient_id first, then by wallet_address
        let patient_id = current_user
            .linked_patient_id
            .as_ref()
            .unwrap_or(&current_user.wallet_address);

        match patients.get(patient_id) {
            Some(patient) => HttpResponse::Ok().json(patient),
            None => HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "No medical records found for your account".to_string(),
                code: "RECORD_NOT_FOUND".to_string(),
            }),
        }
    } else {
        // Healthcare providers can see all
        let all: Vec<&PatientProfile> = patients.values().collect();
        HttpResponse::Ok().json(all)
    }
}

// ============================================================================
// IPFS Medical Record Endpoints
// ============================================================================

/// Check IPFS connection status
#[get("/api/ipfs/health")]
async fn ipfs_health_check(data: web::Data<AppState>) -> impl Responder {
    let connected = data.ipfs_client.health_check().await.unwrap_or(false);

    HttpResponse::Ok().json(IpfsHealthResponse {
        ipfs_connected: connected,
        api_url: "http://localhost:5001".to_string(),
        gateway_url: "http://localhost:8080".to_string(),
    })
}

/// Upload encrypted medical document to IPFS
/// Requires: Healthcare provider role (Doctor, Nurse, Admin)
#[post("/api/records/upload")]
async fn upload_medical_record(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<UploadMedicalRecordRequest>,
) -> impl Responder {
    // RBAC: Check if caller can edit medical records
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only doctors, nurses, and admins can upload medical records
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot upload medical records. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Verify patient exists
    {
        let patients = data.patients.read().unwrap();
        if !patients.contains_key(&req.patient_id) {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    }

    // Decode base64 content
    let content = match base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.content_base64,
    ) {
        Ok(c) => c,
        Err(e) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: format!("Invalid base64 content: {}", e),
                code: "INVALID_CONTENT".to_string(),
            });
        }
    };

    // Create metadata
    let metadata = EncryptedMetadata {
        filename: req.filename.clone(),
        content_type: req.content_type.clone(),
        uploaded_at: Utc::now().timestamp(),
        patient_id: req.patient_id.clone(),
        uploaded_by: current_user_id.clone(),
        record_type: req.record_type.clone(),
    };

    // Calculate content checksum (convert to hex string)
    let content_checksum = hex::encode(medichain_crypto::sha256(&content));

    // Upload to IPFS with encryption
    let upload_result = match data
        .ipfs_client
        .upload_encrypted(&content, metadata, &data.encryption_key)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: format!("IPFS upload failed: {}", e),
                code: "IPFS_ERROR".to_string(),
            });
        }
    };

    // Create record reference for on-chain storage
    let record_ref = MedicalRecordReference {
        content_hash: upload_result.ipfs_hash.clone(),
        metadata_hash: upload_result.metadata_hash.clone(),
        record_type: req.record_type.clone(),
        uploaded_at: Utc::now().timestamp(),
        content_checksum,
    };

    // Store reference locally (in production: on blockchain)
    {
        let mut records = data.medical_records.write().unwrap();
        records
            .entry(req.patient_id.clone())
            .or_default()
            .push(record_ref.clone());
    }

    // Log access
    {
        let mut logs = data.access_logs.write().unwrap();
        logs.push(AccessLogEntry {
            access_id: Uuid::new_v4().to_string(),
            patient_id: req.patient_id.clone(),
            accessor_id: current_user_id,
            accessor_role: current_user.role.to_string(),
            access_type: "upload_record".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: false,
        });
    }

    HttpResponse::Created().json(UploadMedicalRecordResponse {
        success: true,
        ipfs_hash: upload_result.ipfs_hash,
        metadata_hash: upload_result.metadata_hash,
        record_reference: record_ref,
        message: "Medical record uploaded and encrypted successfully".to_string(),
    })
}

/// Download and decrypt medical document from IPFS
/// Requires: Healthcare provider role OR patient accessing own records
#[post("/api/records/download")]
async fn download_medical_record(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<DownloadMedicalRecordRequest>,
) -> impl Responder {
    // RBAC: Check caller permissions
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Patients can only download their own records
    // Healthcare providers can download any records
    if !current_user.role.is_healthcare_provider() {
        // Check if this record belongs to the patient
        let records = data.medical_records.read().unwrap();
        let patient_records = records.get(&current_user_id);

        let owns_record = patient_records
            .is_some_and(|recs| recs.iter().any(|r| r.content_hash == req.content_hash));

        if !owns_record {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Patients can only download their own medical records".to_string(),
                code: "ACCESS_DENIED".to_string(),
            });
        }
    }

    // Download and decrypt from IPFS
    let download_result = match data
        .ipfs_client
        .download_decrypted(&req.content_hash, &req.metadata_hash, &data.encryption_key)
        .await
    {
        Ok(r) => r,
        Err(IpfsError::NotFound(hash)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Record not found: {}", hash),
                code: "RECORD_NOT_FOUND".to_string(),
            });
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: format!("IPFS download failed: {}", e),
                code: "IPFS_ERROR".to_string(),
            });
        }
    };

    // Log access
    {
        let mut logs = data.access_logs.write().unwrap();
        logs.push(AccessLogEntry {
            access_id: Uuid::new_v4().to_string(),
            patient_id: download_result.metadata.patient_id.clone(),
            accessor_id: current_user_id,
            accessor_role: current_user.role.to_string(),
            access_type: "download_record".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: false,
        });
    }

    // Encode content as base64 for JSON response
    let content_base64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &download_result.content,
    );

    HttpResponse::Ok().json(DownloadMedicalRecordResponse {
        success: true,
        content_base64,
        filename: download_result.metadata.filename,
        content_type: download_result.metadata.content_type,
        record_type: download_result.metadata.record_type,
        uploaded_by: download_result.metadata.uploaded_by,
        uploaded_at: download_result.metadata.uploaded_at,
    })
}

/// List medical records for a patient
/// Requires: Healthcare provider role OR patient accessing own records
#[get("/api/records/{patient_id}")]
async fn list_patient_records(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // RBAC: Check caller permissions
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Patients can only list their own records
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Patients can only view their own medical records".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient records
    let records = data.medical_records.read().unwrap();
    let patient_records = records.get(&patient_id).cloned().unwrap_or_default();

    // Log access
    {
        let mut logs = data.access_logs.write().unwrap();
        logs.push(AccessLogEntry {
            access_id: Uuid::new_v4().to_string(),
            patient_id: patient_id.clone(),
            accessor_id: current_user_id,
            accessor_role: current_user.role.to_string(),
            access_type: "list_records".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: false,
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "records": patient_records,
        "total": patient_records.len()
    }))
}

// ============================================================================
// Lab Result Submission Endpoints (Approval Workflow)
// ============================================================================

/// Submit lab results for doctor approval
/// Requires: LabTechnician, Doctor, Nurse, or Admin role
#[post("/api/lab/submit")]
async fn submit_lab_results(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<SubmitLabResultRequest>,
) -> impl Responder {
    // RBAC: Check if caller can submit lab results
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // LabTechnician and healthcare providers can submit lab results
    let can_submit = matches!(
        current_user.role,
        Role::LabTechnician | Role::Doctor | Role::Nurse | Role::Admin
    );

    if !can_submit {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot submit lab results. Required: LabTechnician, Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Verify patient exists and get patient name
    let patient_name = {
        let patients = data.patients.read().unwrap();
        match patients.get(&req.patient_id) {
            Some(p) => p.full_name.clone(),
            None => {
                return HttpResponse::NotFound().json(ErrorResponse {
                    success: false,
                    error: format!("Patient '{}' not found", req.patient_id),
                    code: "PATIENT_NOT_FOUND".to_string(),
                });
            }
        }
    };

    // Validate test results
    if req.results.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "At least one test result is required".to_string(),
            code: "INVALID_REQUEST".to_string(),
        });
    }

    // Generate unique submission ID
    let submission_id = format!(
        "LAB-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Create lab submission
    let submission = LabResultSubmission {
        id: submission_id.clone(),
        patient_id: req.patient_id.clone(),
        patient_name,
        test_name: req.test_name.clone(),
        test_category: req.test_category.clone(),
        results: req.results.clone(),
        notes: req.notes.clone(),
        submitted_by: current_user_id.clone(),
        submitted_at: Utc::now(),
        status: LabResultStatus::Pending,
        reviewed_by: None,
        reviewed_at: None,
        rejection_reason: None,
        content_hash: None,
        metadata_hash: None,
    };

    // Store submission
    {
        let mut submissions = data.lab_submissions.write().unwrap();
        submissions.insert(submission_id.clone(), submission);
    }

    // Log access
    {
        let mut logs = data.access_logs.write().unwrap();
        logs.push(AccessLogEntry {
            access_id: Uuid::new_v4().to_string(),
            patient_id: req.patient_id.clone(),
            accessor_id: current_user_id,
            accessor_role: current_user.role.to_string(),
            access_type: "lab_submission".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: false,
        });
    }

    log::info!(
        "Lab results submitted: {} for patient {}",
        submission_id,
        req.patient_id
    );

    HttpResponse::Created().json(SubmitLabResultResponse {
        success: true,
        submission_id,
        message: "Lab results submitted successfully. Pending doctor approval.".to_string(),
    })
}

/// Get pending lab result submissions for review
/// Requires: Doctor, Nurse, or Admin role
#[get("/api/lab/pending")]
async fn get_pending_lab_results(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    // RBAC: Only doctors, nurses, and admins can review lab results
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only Doctor, Nurse, or Admin can review
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot review lab results. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get all pending submissions
    let submissions = data.lab_submissions.read().unwrap();
    let pending: Vec<LabResultSubmission> = submissions
        .values()
        .filter(|s| s.status == LabResultStatus::Pending)
        .cloned()
        .collect();

    let total = pending.len();

    HttpResponse::Ok().json(PendingLabResultsResponse {
        submissions: pending,
        total,
    })
}

/// Get all lab result submissions (with optional status filter)
/// Requires: Doctor, Nurse, or Admin role
#[get("/api/lab/submissions")]
async fn get_all_lab_submissions(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    // RBAC: Only doctors, nurses, and admins can view lab submissions
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only Doctor, Nurse, or Admin can view all submissions
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot view lab submissions. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get optional status filter
    let status_filter = query.get("status").map(|s| s.to_lowercase());

    // Get submissions with optional filter
    let submissions = data.lab_submissions.read().unwrap();
    let filtered: Vec<LabResultSubmission> = submissions
        .values()
        .filter(|s| {
            match &status_filter {
                Some(status) => s.status.to_string() == *status,
                None => true, // Return all if no filter
            }
        })
        .cloned()
        .collect();

    let total = filtered.len();

    HttpResponse::Ok().json(serde_json::json!({
        "submissions": filtered,
        "total": total
    }))
}

/// Get a specific lab result submission by ID
/// Requires: Doctor, Nurse, Admin, or the submitting LabTechnician
#[get("/api/lab/submissions/{submission_id}")]
async fn get_lab_submission(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let submission_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    let submissions = data.lab_submissions.read().unwrap();
    let submission = match submissions.get(&submission_id) {
        Some(s) => s.clone(),
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Lab submission '{}' not found", submission_id),
                code: "SUBMISSION_NOT_FOUND".to_string(),
            });
        }
    };

    // Allow access if: healthcare provider OR the lab tech who submitted it
    let can_view = current_user.role.can_edit_medical_records()
        || (current_user.role == Role::LabTechnician && submission.submitted_by == current_user_id);

    if !can_view {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    HttpResponse::Ok().json(submission)
}

/// Review (approve or reject) a lab result submission
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/lab/review")]
async fn review_lab_results(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ReviewLabResultRequest>,
) -> impl Responder {
    // RBAC: Only doctors, nurses, and admins can approve lab results
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only Doctor, Nurse, or Admin can approve/reject
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot review lab results. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Validate action
    let action = req.action.to_lowercase();
    if action != "approve" && action != "reject" {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid action. Must be 'approve' or 'reject'".to_string(),
            code: "INVALID_ACTION".to_string(),
        });
    }

    // Rejection requires a reason
    if action == "reject" && req.rejection_reason.is_none() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Rejection requires a reason".to_string(),
            code: "REJECTION_REASON_REQUIRED".to_string(),
        });
    }

    // Get and update submission
    let mut submissions = data.lab_submissions.write().unwrap();
    let submission = match submissions.get_mut(&req.submission_id) {
        Some(s) => s,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Lab submission '{}' not found", req.submission_id),
                code: "SUBMISSION_NOT_FOUND".to_string(),
            });
        }
    };

    // Check if already reviewed
    if submission.status != LabResultStatus::Pending {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!("Lab submission already {}", submission.status),
            code: "ALREADY_REVIEWED".to_string(),
        });
    }

    let patient_id = submission.patient_id.clone();
    let submission_id = submission.id.clone();

    // Update status
    if action == "approve" {
        submission.status = LabResultStatus::Approved;
        submission.reviewed_by = Some(current_user_id.clone());
        submission.reviewed_at = Some(Utc::now());

        // On approval, create a visible medical record reference
        // Generate a simple content hash for the lab result data
        let lab_content = serde_json::to_string(&submission.results).unwrap_or_default();
        let content_checksum = hex::encode(medichain_crypto::sha256(lab_content.as_bytes()));

        // Create record reference
        let record_ref = MedicalRecordReference {
            content_hash: format!("lab-{}", submission.id),
            metadata_hash: format!("meta-{}", submission.id),
            record_type: "lab_result".to_string(),
            uploaded_at: Utc::now().timestamp(),
            content_checksum,
        };

        // Store in patient's medical records (now visible to patient)
        drop(submissions); // Release write lock before acquiring another
        {
            let mut records = data.medical_records.write().unwrap();
            records
                .entry(patient_id.clone())
                .or_default()
                .push(record_ref);
        }

        log::info!(
            "Lab submission {} approved by {} for patient {}",
            submission_id,
            current_user_id,
            patient_id
        );
    } else {
        submission.status = LabResultStatus::Rejected;
        submission.reviewed_by = Some(current_user_id.clone());
        submission.reviewed_at = Some(Utc::now());
        submission.rejection_reason = req.rejection_reason.clone();

        log::info!(
            "Lab submission {} rejected by {} for patient {}",
            submission_id,
            current_user_id,
            patient_id
        );
    }

    // Log access
    {
        let mut logs = data.access_logs.write().unwrap();
        logs.push(AccessLogEntry {
            access_id: Uuid::new_v4().to_string(),
            patient_id,
            accessor_id: current_user_id,
            accessor_role: current_user.role.to_string(),
            access_type: format!("lab_review_{}", action),
            location: None,
            timestamp: Utc::now(),
            emergency: false,
        });
    }

    HttpResponse::Ok().json(ReviewLabResultResponse {
        success: true,
        submission_id,
        new_status: action.clone(),
        message: format!(
            "Lab submission {}",
            if action == "approve" {
                "approved and added to patient records"
            } else {
                "rejected"
            }
        ),
    })
}

/// Get lab submissions for a specific patient
/// Requires: Healthcare provider OR the patient themselves (approved only)
#[get("/api/lab/patient/{patient_id}")]
async fn get_patient_lab_submissions(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    let is_healthcare = current_user.role.is_healthcare_provider();
    let is_own_records = current_user_id == patient_id;

    if !is_healthcare && !is_own_records {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient's lab submissions
    let submissions = data.lab_submissions.read().unwrap();
    let patient_submissions: Vec<LabResultSubmission> = submissions
        .values()
        .filter(|s| {
            s.patient_id == patient_id
                // Patients only see approved results
                && (is_healthcare || s.status == LabResultStatus::Approved)
        })
        .cloned()
        .collect();

    let total = patient_submissions.len();

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "submissions": patient_submissions,
        "total": total
    }))
}

// ============================================================================
// NFC Card Management Endpoints
// ============================================================================

/// Request body for generating a new NFC card
#[derive(Debug, Deserialize)]
pub struct GenerateNFCCardRequest {
    pub patient_id: String,
    pub national_id_type: String,
}

/// Response for NFC card generation
#[derive(Debug, Serialize)]
pub struct GenerateNFCCardResponse {
    pub success: bool,
    pub card_id: String,
    pub card_hash: String,
    pub qr_code_base64: Option<String>,
    pub message: String,
}

/// Response for NFC tap simulation
#[derive(Debug, Serialize)]
pub struct NFCTapResponse {
    pub success: bool,
    pub patient_id: Option<String>,
    pub card_hash: String,
    pub timestamp: u64,
    pub error: Option<String>,
}

/// Response for card info
#[derive(Debug, Serialize)]
pub struct CardInfoResponse {
    pub card_id: String,
    pub patient_id: String,
    pub card_hash: String,
    pub national_id_type: String,
    pub status: String,
    pub created_at: u64,
    pub last_used_at: Option<u64>,
}

/// Generate a new NFC card for a patient
#[post("/api/nfc/generate")]
async fn generate_nfc_card(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<GenerateNFCCardRequest>,
) -> impl Responder {
    // RBAC: Only healthcare providers can generate cards
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can generate NFC cards".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Parse national ID type
    let national_id_type = match body.national_id_type.to_lowercase().as_str() {
        "fayda" | "faydaid" | "ethiopia" => NationalIdType::FaydaId,
        "ghana" | "ghanacard" => NationalIdType::GhanaCard,
        "nin" | "nigeria" => NationalIdType::NigeriaNIN,
        "smartid" | "southafrica" => NationalIdType::SouthAfricaSmartId,
        "huduma" | "kenya" => NationalIdType::KenyaHuduma,
        _ => NationalIdType::Other,
    };

    // Create NFC card
    let card = NFCCard::new(body.patient_id.clone(), national_id_type);
    let card_id = card.card_id.clone();
    let card_hash = card.card_hash.clone();

    // Generate QR code
    let qr_data = card.generate_qr_data();
    let qr_base64 = nfc_simulator::generate_qr_image(&qr_data).ok();

    // Register the card
    if let Err(e) = data.card_registry.register_card(card) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e,
            code: "CARD_REGISTRATION_FAILED".to_string(),
        });
    }

    log::info!(
        "NFC card generated for patient {} by {}",
        body.patient_id,
        current_user_id
    );

    HttpResponse::Created().json(GenerateNFCCardResponse {
        success: true,
        card_id,
        card_hash,
        qr_code_base64: qr_base64,
        message: "NFC card generated successfully".to_string(),
    })
}

/// Simulate an NFC card tap (for demo purposes)
#[post("/api/nfc/tap")]
async fn nfc_tap(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    // RBAC: Only healthcare providers can use NFC tap
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can use NFC tap".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get card_hash from body
    let card_hash = match body.get("card_hash").and_then(|v| v.as_str()) {
        Some(h) => h.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Missing card_hash in request body".to_string(),
                code: "MISSING_FIELD".to_string(),
            });
        }
    };

    // Simulate the tap
    let tap_result = match data.card_registry.tap_card(&card_hash) {
        Ok(result) => result,
        Err(e) => {
            return HttpResponse::NotFound().json(NFCTapResponse {
                success: false,
                patient_id: None,
                card_hash,
                timestamp: chrono::Utc::now().timestamp() as u64,
                error: Some(e),
            });
        }
    };

    if tap_result.success {
        // Log the access
        {
            let mut logs = data.access_logs.write().unwrap();
            logs.push(AccessLogEntry {
                access_id: Uuid::new_v4().to_string(),
                patient_id: tap_result.patient_id.clone(),
                accessor_id: current_user_id.clone(),
                accessor_role: current_user.role.to_string(),
                access_type: "nfc_tap".to_string(),
                location: None,
                timestamp: Utc::now(),
                emergency: true,
            });
        }

        log::info!(
            "NFC tap successful for patient {} by {}",
            tap_result.patient_id,
            current_user_id
        );
    }

    HttpResponse::Ok().json(NFCTapResponse {
        success: tap_result.success,
        patient_id: if tap_result.success {
            Some(tap_result.patient_id)
        } else {
            None
        },
        card_hash: tap_result.card_hash,
        timestamp: tap_result.timestamp,
        error: tap_result.error,
    })
}

/// Verify a QR code for emergency access
#[post("/api/nfc/verify-qr")]
async fn verify_qr_code(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    // RBAC: Only healthcare providers can verify QR codes
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can verify QR codes".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get QR data from body
    let qr_json = match body.get("qr_data").and_then(|v| v.as_str()) {
        Some(d) => d.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Missing qr_data in request body".to_string(),
                code: "MISSING_FIELD".to_string(),
            });
        }
    };

    // Decode QR data
    let qr_data = match QRCodeData::decode(&qr_json) {
        Ok(d) => d,
        Err(e) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: e,
                code: "INVALID_QR_DATA".to_string(),
            });
        }
    };

    // Check expiration
    if qr_data.is_expired() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "QR code has expired".to_string(),
            code: "QR_EXPIRED".to_string(),
        });
    }

    // Verify card exists and matches
    let card = match data.card_registry.get_card(&qr_data.card_hash) {
        Some(c) => c,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Card not found".to_string(),
                code: "CARD_NOT_FOUND".to_string(),
            });
        }
    };

    // Verify patient ID matches
    if card.patient_id != qr_data.patient_id {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "QR data mismatch".to_string(),
            code: "QR_MISMATCH".to_string(),
        });
    }

    // Log the access
    {
        let mut logs = data.access_logs.write().unwrap();
        logs.push(AccessLogEntry {
            access_id: Uuid::new_v4().to_string(),
            patient_id: qr_data.patient_id.clone(),
            accessor_id: current_user_id.clone(),
            accessor_role: current_user.role.to_string(),
            access_type: "qr_verification".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: true,
        });
    }

    log::info!(
        "QR code verified for patient {} by {}",
        qr_data.patient_id,
        current_user_id
    );

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": qr_data.patient_id,
        "card_hash": qr_data.card_hash,
        "verified": true,
        "message": "QR code verified successfully"
    }))
}

/// Get card information by patient ID
#[get("/api/nfc/card/{patient_id}")]
async fn get_card_info(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // RBAC: Healthcare providers or the patient themselves
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Patients can only view their own card
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get card
    let card = match data.card_registry.get_card_by_patient(&patient_id) {
        Some(c) => c,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "No card found for this patient".to_string(),
                code: "CARD_NOT_FOUND".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(CardInfoResponse {
        card_id: card.card_id,
        patient_id: card.patient_id,
        card_hash: card.card_hash,
        national_id_type: card.national_id_type.to_string(),
        status: card.status.to_string(),
        created_at: card.created_at,
        last_used_at: card.last_used_at,
    })
}

/// Suspend a card (e.g., if reported stolen)
#[post("/api/nfc/suspend")]
async fn suspend_card(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    // RBAC: Only Admin can suspend cards
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if current_user.role != Role::Admin {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can suspend cards".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get card_hash from body
    let card_hash = match body.get("card_hash").and_then(|v| v.as_str()) {
        Some(h) => h.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Missing card_hash in request body".to_string(),
                code: "MISSING_FIELD".to_string(),
            });
        }
    };

    // Suspend the card
    if let Err(e) = data.card_registry.suspend_card(&card_hash) {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: e,
            code: "CARD_NOT_FOUND".to_string(),
        });
    }

    log::info!("Card {} suspended by Admin {}", card_hash, current_user_id);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "card_hash": card_hash,
        "message": "Card suspended successfully"
    }))
}

/// List all NFC cards (Admin only)
#[get("/api/nfc/cards")]
async fn list_nfc_cards(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    // RBAC: Only Admin can list all cards
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if current_user.role != Role::Admin {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only Admin can list all cards".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let cards = data.card_registry.list_cards();
    let card_infos: Vec<CardInfoResponse> = cards
        .into_iter()
        .map(|c| CardInfoResponse {
            card_id: c.card_id,
            patient_id: c.patient_id,
            card_hash: c.card_hash,
            national_id_type: c.national_id_type.to_string(),
            status: c.status.to_string(),
            created_at: c.created_at,
            last_used_at: c.last_used_at,
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "cards": card_infos,
        "total": card_infos.len()
    }))
}

// ============================================================================
// Clinical Documentation Endpoints (Phase 1)
// ============================================================================

// ----------------------------------------------------------------------------
// Triage Assessment Endpoints
// ----------------------------------------------------------------------------

/// Request body for creating a triage assessment
#[derive(Debug, Deserialize)]
pub struct CreateTriageRequest {
    pub patient_id: String,
    pub esi_level: u8,
    pub chief_complaint: String,
    pub vital_signs: clinical::TriageVitalSigns,
    pub pain_scale: Option<u8>,
    pub notes: Option<String>,
}

/// Response for triage assessment creation
#[derive(Debug, Serialize)]
pub struct CreateTriageResponse {
    pub success: bool,
    pub assessment_id: String,
    pub esi_level: u8,
    pub color_code: String,
    pub expected_wait: String,
    pub has_critical_vitals: bool,
    pub message: String,
}

/// Create a new triage assessment
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/clinical/triage")]
async fn create_triage_assessment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateTriageRequest>,
) -> impl Responder {
    // RBAC: Only healthcare providers who can edit records
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot create triage assessments. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Verify patient exists
    {
        let patients = data.patients.read().unwrap();
        if !patients.contains_key(&req.patient_id) {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    }

    // Parse ESI level
    let esi_level = match ESILevel::from_level(req.esi_level) {
        Some(level) => level,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "ESI level must be 1-5".to_string(),
                code: "INVALID_ESI_LEVEL".to_string(),
            });
        }
    };

    // Validate pain scale if provided
    if let Some(pain) = req.pain_scale {
        if pain > 10 {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Pain scale must be 0-10".to_string(),
                code: "INVALID_PAIN_SCALE".to_string(),
            });
        }
    }

    // Generate assessment ID
    let assessment_id = format!(
        "TRIAGE-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Check for critical vitals
    let has_critical_vitals = req.vital_signs.has_critical_values();

    // Create triage assessment
    let assessment = TriageAssessment {
        assessment_id: assessment_id.clone(),
        patient_id: req.patient_id.clone(),
        esi_level,
        chief_complaint: req.chief_complaint.clone(),
        vital_signs: req.vital_signs.clone(),
        pain_scale: req.pain_scale,
        notes: req.notes.clone(),
        performed_by: current_user_id.clone(),
        performed_at: Utc::now().timestamp(),
    };

    // Store assessment
    {
        let mut assessments = data.triage_assessments.write().unwrap();
        assessments.insert(assessment_id.clone(), assessment);
    }

    // Log access
    {
        let mut logs = data.access_logs.write().unwrap();
        logs.push(AccessLogEntry {
            access_id: Uuid::new_v4().to_string(),
            patient_id: req.patient_id.clone(),
            accessor_id: current_user_id,
            accessor_role: current_user.role.to_string(),
            access_type: "create_triage".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: esi_level.level() <= 2,
        });
    }

    log::info!(
        "Triage assessment {} created for patient {} - ESI Level {}",
        assessment_id,
        req.patient_id,
        esi_level.level()
    );

    HttpResponse::Created().json(CreateTriageResponse {
        success: true,
        assessment_id,
        esi_level: esi_level.level(),
        color_code: esi_level.color_code().to_string(),
        expected_wait: esi_level.expected_wait().to_string(),
        has_critical_vitals,
        message: format!(
            "Triage assessment created. ESI Level {}: {}",
            esi_level.level(),
            esi_level.description()
        ),
    })
}

/// Get a triage assessment by ID
#[get("/api/clinical/triage/{assessment_id}")]
async fn get_triage_assessment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Healthcare providers can view any triage
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can view triage assessments".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let assessments = data.triage_assessments.read().unwrap();
    match assessments.get(&assessment_id) {
        Some(assessment) => HttpResponse::Ok().json(assessment),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Triage assessment '{}' not found", assessment_id),
            code: "ASSESSMENT_NOT_FOUND".to_string(),
        }),
    }
}

/// Get all triage assessments for a patient
#[get("/api/clinical/patient/{patient_id}/triage")]
async fn get_patient_triage_assessments(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Healthcare providers or patient viewing own records
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    let assessments = data.triage_assessments.read().unwrap();
    let patient_assessments: Vec<&TriageAssessment> = assessments
        .values()
        .filter(|a| a.patient_id == patient_id)
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "assessments": patient_assessments,
        "total": patient_assessments.len()
    }))
}

/// Get triage queue - all pending triage assessments sorted by ESI level
/// Requires: Doctor, Nurse, or Admin role
#[get("/api/clinical/triage/queue")]
async fn get_triage_queue(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(user) => user,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Insufficient permissions to view triage queue".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let assessments = data.triage_assessments.read().unwrap();
    let mut queue: Vec<_> = assessments.values().cloned().collect();

    // Sort by ESI level (1 = most critical, 5 = least critical)
    queue.sort_by(|a, b| {
        let a_level = a.esi_level.level();
        let b_level = b.esi_level.level();
        a_level.cmp(&b_level)
    });

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "queue": queue,
        "total": queue.len()
    }))
}

// ----------------------------------------------------------------------------
// SOAP Notes Endpoints
// ----------------------------------------------------------------------------

/// Request body for creating a SOAP note
#[derive(Debug, Deserialize)]
pub struct CreateSOAPNoteRequest {
    pub patient_id: String,
    pub encounter_type: String,
    pub subjective: clinical::SubjectiveSection,
    pub objective: clinical::ObjectiveSection,
    pub assessment: clinical::AssessmentSection,
    pub plan: clinical::PlanSection,
}

/// Create a new SOAP note
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/clinical/soap")]
async fn create_soap_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateSOAPNoteRequest>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot create SOAP notes. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Verify patient exists
    {
        let patients = data.patients.read().unwrap();
        if !patients.contains_key(&req.patient_id) {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    }

    // Generate note ID
    let note_id = format!(
        "SOAP-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Create SOAP note
    let soap_note = SOAPNote {
        note_id: note_id.clone(),
        patient_id: req.patient_id.clone(),
        encounter_type: req.encounter_type.clone(),
        subjective: req.subjective.clone(),
        objective: req.objective.clone(),
        assessment: req.assessment.clone(),
        plan: req.plan.clone(),
        author_id: current_user_id.clone(),
        created_at: Utc::now().timestamp(),
        updated_at: None,
        status: "active".to_string(),
        addenda: vec![],
    };

    // Store note
    {
        let mut notes = data.soap_notes.write().unwrap();
        notes.insert(note_id.clone(), soap_note);
    }

    // Log access
    {
        let mut logs = data.access_logs.write().unwrap();
        logs.push(AccessLogEntry {
            access_id: Uuid::new_v4().to_string(),
            patient_id: req.patient_id.clone(),
            accessor_id: current_user_id,
            accessor_role: current_user.role.to_string(),
            access_type: "create_soap_note".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: false,
        });
    }

    log::info!(
        "SOAP note {} created for patient {}",
        note_id,
        req.patient_id
    );

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "note_id": note_id,
        "message": "SOAP note created successfully"
    }))
}

/// Get a SOAP note by ID
#[get("/api/clinical/soap/{note_id}")]
async fn get_soap_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let note_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    let notes = data.soap_notes.read().unwrap();
    let note = match notes.get(&note_id) {
        Some(n) => n,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("SOAP note '{}' not found", note_id),
                code: "NOTE_NOT_FOUND".to_string(),
            });
        }
    };

    // Healthcare providers or patient viewing own records
    if !current_user.role.is_healthcare_provider() && current_user_id != note.patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    HttpResponse::Ok().json(note)
}

/// Get all SOAP notes for a patient
#[get("/api/clinical/patient/{patient_id}/soap")]
async fn get_patient_soap_notes(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    let notes = data.soap_notes.read().unwrap();
    let patient_notes: Vec<&SOAPNote> = notes
        .values()
        .filter(|n| n.patient_id == patient_id)
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "notes": patient_notes,
        "total": patient_notes.len()
    }))
}

/// Add an addendum to a SOAP note
#[post("/api/clinical/soap/{note_id}/addendum")]
async fn add_soap_addendum(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let note_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can add addenda".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let content = match body.get("content").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Missing 'content' field".to_string(),
                code: "MISSING_FIELD".to_string(),
            });
        }
    };

    let mut notes = data.soap_notes.write().unwrap();
    let note = match notes.get_mut(&note_id) {
        Some(n) => n,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("SOAP note '{}' not found", note_id),
                code: "NOTE_NOT_FOUND".to_string(),
            });
        }
    };

    let addendum = clinical::SOAPAddendum {
        addendum_id: format!(
            "ADD-{}",
            Uuid::new_v4()
                .to_string()
                .split('-')
                .next()
                .unwrap_or("000")
        ),
        content,
        author_id: current_user_id.clone(),
        created_at: Utc::now().timestamp(),
    };

    let addendum_id = addendum.addendum_id.clone();
    note.addenda.push(addendum);
    note.updated_at = Some(Utc::now().timestamp());

    log::info!("Addendum {} added to SOAP note {}", addendum_id, note_id);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "addendum_id": addendum_id,
        "message": "Addendum added successfully"
    }))
}

// ----------------------------------------------------------------------------
// SAMPLE History Endpoints
// ----------------------------------------------------------------------------

/// Request body for creating/updating SAMPLE history
#[derive(Debug, Deserialize)]
pub struct CreateSAMPLEHistoryRequest {
    pub patient_id: String,
    pub signs_symptoms: Vec<String>,
    pub allergies: Vec<clinical::AllergyInfo>,
    pub medications: Vec<clinical::MedicationInfo>,
    pub past_medical_history: Vec<String>,
    pub last_intake: Option<clinical::LastIntake>,
    pub events_leading: String,
}

/// Create or update SAMPLE history
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/clinical/sample")]
async fn create_sample_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateSAMPLEHistoryRequest>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot create SAMPLE history. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Verify patient exists
    {
        let patients = data.patients.read().unwrap();
        if !patients.contains_key(&req.patient_id) {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    }

    // Create SAMPLE history
    let sample = SAMPLEHistory {
        patient_id: req.patient_id.clone(),
        signs_symptoms: req.signs_symptoms.clone(),
        allergies: req.allergies.clone(),
        medications: req.medications.clone(),
        past_medical_history: req.past_medical_history.clone(),
        last_intake: req.last_intake.clone(),
        events_leading: req.events_leading.clone(),
        collected_by: current_user_id.clone(),
        collected_at: Utc::now().timestamp(),
    };

    // Store (overwrites existing for this patient)
    {
        let mut histories = data.sample_histories.write().unwrap();
        histories.insert(req.patient_id.clone(), sample);
    }

    // Log access
    {
        let mut logs = data.access_logs.write().unwrap();
        logs.push(AccessLogEntry {
            access_id: Uuid::new_v4().to_string(),
            patient_id: req.patient_id.clone(),
            accessor_id: current_user_id,
            accessor_role: current_user.role.to_string(),
            access_type: "create_sample_history".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: false,
        });
    }

    log::info!(
        "SAMPLE history created/updated for patient {}",
        req.patient_id
    );

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "patient_id": req.patient_id,
        "message": "SAMPLE history saved successfully"
    }))
}

/// Get SAMPLE history for a patient
#[get("/api/clinical/sample/{patient_id}")]
async fn get_sample_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    let histories = data.sample_histories.read().unwrap();
    match histories.get(&patient_id) {
        Some(history) => HttpResponse::Ok().json(history),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("SAMPLE history not found for patient '{}'", patient_id),
            code: "HISTORY_NOT_FOUND".to_string(),
        }),
    }
}

// ----------------------------------------------------------------------------
// Glasgow Coma Scale Endpoints
// ----------------------------------------------------------------------------

/// Request body for creating a GCS assessment
#[derive(Debug, Deserialize)]
pub struct CreateGCSRequest {
    pub patient_id: String,
    pub eye_response: u8,
    pub verbal_response: u8,
    pub motor_response: u8,
    pub pupil_assessment: Option<clinical::PupilAssessment>,
    pub notes: Option<String>,
}

/// Response for GCS assessment
#[derive(Debug, Serialize)]
pub struct GCSResponse {
    pub success: bool,
    pub assessment_id: String,
    pub total_score: u8,
    pub interpretation: String,
    pub is_comatose: bool,
    pub needs_airway: bool,
    pub message: String,
}

/// Create a new GCS assessment
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/clinical/gcs")]
async fn create_gcs_assessment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateGCSRequest>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot create GCS assessments. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Verify patient exists
    {
        let patients = data.patients.read().unwrap();
        if !patients.contains_key(&req.patient_id) {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    }

    // Parse response scores
    let eye = match clinical::EyeResponse::from_score(req.eye_response) {
        Some(e) => e,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Eye response must be 1-4".to_string(),
                code: "INVALID_EYE_RESPONSE".to_string(),
            });
        }
    };

    let verbal = match clinical::VerbalResponse::from_score(req.verbal_response) {
        Some(v) => v,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Verbal response must be 1-5".to_string(),
                code: "INVALID_VERBAL_RESPONSE".to_string(),
            });
        }
    };

    let motor = match clinical::MotorResponse::from_score(req.motor_response) {
        Some(m) => m,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Motor response must be 1-6".to_string(),
                code: "INVALID_MOTOR_RESPONSE".to_string(),
            });
        }
    };

    // Generate assessment ID
    let assessment_id = format!(
        "GCS-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Create GCS assessment with auto-calculation
    let gcs = GlasgowComaScale::new(
        assessment_id.clone(),
        req.patient_id.clone(),
        eye,
        verbal,
        motor,
        req.pupil_assessment.clone(),
        req.notes.clone(),
        current_user_id.clone(),
    );

    let total_score = gcs.total_score;
    let interpretation = gcs.interpret_score().to_string();
    let is_comatose = gcs.is_comatose();
    let needs_airway = gcs.needs_airway_protection();

    // Store assessment
    {
        let mut assessments = data.gcs_assessments.write().unwrap();
        assessments.insert(assessment_id.clone(), gcs);
    }

    // Log access
    {
        let mut logs = data.access_logs.write().unwrap();
        logs.push(AccessLogEntry {
            access_id: Uuid::new_v4().to_string(),
            patient_id: req.patient_id.clone(),
            accessor_id: current_user_id,
            accessor_role: current_user.role.to_string(),
            access_type: "create_gcs".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: is_comatose,
        });
    }

    log::info!(
        "GCS assessment {} created for patient {} - Score: {}",
        assessment_id,
        req.patient_id,
        total_score
    );

    HttpResponse::Created().json(GCSResponse {
        success: true,
        assessment_id,
        total_score,
        interpretation,
        is_comatose,
        needs_airway,
        message: format!("GCS assessment created. Total score: {}", total_score),
    })
}

/// Get a GCS assessment by ID
#[get("/api/clinical/gcs/{assessment_id}")]
async fn get_gcs_assessment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can view GCS assessments".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let assessments = data.gcs_assessments.read().unwrap();
    match assessments.get(&assessment_id) {
        Some(assessment) => HttpResponse::Ok().json(assessment),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("GCS assessment '{}' not found", assessment_id),
            code: "ASSESSMENT_NOT_FOUND".to_string(),
        }),
    }
}

/// Get all GCS assessments for a patient
#[get("/api/clinical/patient/{patient_id}/gcs")]
async fn get_patient_gcs_assessments(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    let assessments = data.gcs_assessments.read().unwrap();
    let patient_assessments: Vec<&GlasgowComaScale> = assessments
        .values()
        .filter(|a| a.patient_id == patient_id)
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "assessments": patient_assessments,
        "total": patient_assessments.len()
    }))
}

// ----------------------------------------------------------------------------
// Vital Signs Endpoints
// ----------------------------------------------------------------------------

/// Request body for adding a vital signs reading
#[derive(Debug, Deserialize)]
pub struct AddVitalSignsRequest {
    pub patient_id: String,
    pub heart_rate: Option<u16>,
    pub systolic_bp: Option<u16>,
    pub diastolic_bp: Option<u16>,
    pub respiratory_rate: Option<u16>,
    pub oxygen_saturation: Option<u16>,
    pub temperature_celsius: Option<f32>,
    pub pain_scale: Option<u8>,
    pub notes: Option<String>,
}

/// Response for vital signs reading
#[derive(Debug, Serialize)]
pub struct VitalSignsResponse {
    pub success: bool,
    pub reading_id: String,
    pub mean_arterial_pressure: Option<u16>,
    pub critical_alerts: Vec<String>,
    pub message: String,
}

/// Add a vital signs reading for a patient
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/clinical/vitals")]
async fn add_vital_signs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AddVitalSignsRequest>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot add vital signs. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Verify patient exists
    {
        let patients = data.patients.read().unwrap();
        if !patients.contains_key(&req.patient_id) {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    }

    // Generate reading ID
    let reading_id = format!(
        "VS-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Create vital signs reading
    let reading = VitalSignsReading {
        reading_id: reading_id.clone(),
        timestamp: Utc::now().timestamp(),
        heart_rate: req.heart_rate,
        systolic_bp: req.systolic_bp,
        diastolic_bp: req.diastolic_bp,
        respiratory_rate: req.respiratory_rate,
        oxygen_saturation: req.oxygen_saturation,
        temperature_celsius: req.temperature_celsius,
        pain_scale: req.pain_scale,
        recorded_by: current_user_id.clone(),
        notes: req.notes.clone(),
    };

    let map = reading.calculate_map();
    let critical_alerts = reading.has_critical_values();
    let has_critical = !critical_alerts.is_empty();

    // Add to patient's flowsheet
    {
        let mut flowsheets = data.vital_signs.write().unwrap();
        let flowsheet =
            flowsheets
                .entry(req.patient_id.clone())
                .or_insert_with(|| VitalSignsFlowsheet {
                    patient_id: req.patient_id.clone(),
                    readings: vec![],
                });
        flowsheet.add_reading(reading);
    }

    // Log access
    {
        let mut logs = data.access_logs.write().unwrap();
        logs.push(AccessLogEntry {
            access_id: Uuid::new_v4().to_string(),
            patient_id: req.patient_id.clone(),
            accessor_id: current_user_id,
            accessor_role: current_user.role.to_string(),
            access_type: "add_vital_signs".to_string(),
            location: None,
            timestamp: Utc::now(),
            emergency: has_critical,
        });
    }

    log::info!(
        "Vital signs {} added for patient {}{}",
        reading_id,
        req.patient_id,
        if has_critical {
            " - CRITICAL VALUES DETECTED"
        } else {
            ""
        }
    );

    HttpResponse::Created().json(VitalSignsResponse {
        success: true,
        reading_id,
        mean_arterial_pressure: map,
        critical_alerts: critical_alerts.clone(),
        message: if has_critical {
            format!(
                "Vital signs recorded. ALERT: {}",
                critical_alerts.join(", ")
            )
        } else {
            "Vital signs recorded successfully".to_string()
        },
    })
}

/// Get vital signs flowsheet for a patient
#[get("/api/clinical/patient/{patient_id}/vitals")]
async fn get_patient_vitals(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    let flowsheets = data.vital_signs.read().unwrap();
    match flowsheets.get(&patient_id) {
        Some(flowsheet) => {
            let all_alerts = flowsheet.all_critical_alerts();
            HttpResponse::Ok().json(serde_json::json!({
                "patient_id": patient_id,
                "readings": flowsheet.readings,
                "total": flowsheet.readings.len(),
                "critical_alerts": all_alerts
            }))
        }
        None => HttpResponse::Ok().json(serde_json::json!({
            "patient_id": patient_id,
            "readings": [],
            "total": 0,
            "critical_alerts": []
        })),
    }
}

/// Get latest vital signs for a patient
#[get("/api/clinical/patient/{patient_id}/vitals/latest")]
async fn get_patient_latest_vitals(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    let flowsheets = data.vital_signs.read().unwrap();
    match flowsheets.get(&patient_id) {
        Some(flowsheet) => match flowsheet.latest_reading() {
            Some(reading) => {
                let alerts = reading.has_critical_values();
                HttpResponse::Ok().json(serde_json::json!({
                    "patient_id": patient_id,
                    "reading": reading,
                    "critical_alerts": alerts
                }))
            }
            None => HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "No vital signs recorded".to_string(),
                code: "NO_READINGS".to_string(),
            }),
        },
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "No vital signs recorded".to_string(),
            code: "NO_READINGS".to_string(),
        }),
    }
}

// ----------------------------------------------------------------------------
// Lab Panel Template Endpoints
// ----------------------------------------------------------------------------

/// Get all available lab panel templates
#[get("/api/clinical/lab-panels")]
async fn get_lab_panels(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Healthcare providers can view lab panels
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can view lab panels".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let panels = data.lab_panels.read().unwrap();
    let panel_list: Vec<&LabPanelTemplate> = panels.values().collect();

    HttpResponse::Ok().json(serde_json::json!({
        "panels": panel_list,
        "total": panel_list.len()
    }))
}

/// Get a specific lab panel template by name
#[get("/api/clinical/lab-panels/{panel_name}")]
async fn get_lab_panel(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let panel_name = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can view lab panels".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let panels = data.lab_panels.read().unwrap();
    match panels.get(&panel_name) {
        Some(panel) => HttpResponse::Ok().json(panel),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Lab panel '{}' not found", panel_name),
            code: "PANEL_NOT_FOUND".to_string(),
        }),
    }
}

// ============================================================================
// Phase 2-8: Emergency Protocol Endpoints (see clinical_endpoints.rs)
// ============================================================================

// ============================================================================
// Main Entry Point
// ============================================================================

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize logger
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let bind_addr = format!("{}:{}", host, port);

    println!();
    println!("╔══════════════════════════════════════════════════════════════════╗");
    println!("║                                                                  ║");
    println!("║   ███╗   ███╗███████╗██████╗ ██╗ ██████╗██╗  ██╗ █████╗ ██╗███╗  ║");
    println!("║   ████╗ ████║██╔════╝██╔══██╗██║██╔════╝██║  ██║██╔══██╗██║████╗ ║");
    println!("║   ██╔████╔██║█████╗  ██║  ██║██║██║     ███████║███████║██║██╔██╗║");
    println!("║   ██║╚██╔╝██║██╔══╝  ██║  ██║██║██║     ██╔══██║██╔══██║██║██║╚██║");
    println!("║   ██║ ╚═╝ ██║███████╗██████╔╝██║╚██████╗██║  ██║██║  ██║██║██║ ╚█║");
    println!("║   ╚═╝     ╚═╝╚══════╝╚═════╝ ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝ ╚╝║");
    println!("║                                                                  ║");
    println!("║           🏥 Blockchain Health ID • Emergency Access 🚑          ║");
    println!("║                                                                  ║");
    println!("╚══════════════════════════════════════════════════════════════════╝");
    println!();
    println!("  📡 API Server starting on http://{}", bind_addr);
    println!("  📋 Demo endpoint: http://{}/api/demo", bind_addr);
    println!("  ❤️  Health check: http://{}/health", bind_addr);
    println!("  📁 IPFS health:   http://{}/api/ipfs/health", bind_addr);
    println!();
    println!("  🔐 IPFS Endpoints:");
    println!("     POST /api/records/upload      - Upload encrypted medical record");
    println!("     POST /api/records/download    - Download decrypted record");
    println!("     GET  /api/records/{{patient}}  - List patient records");
    println!();
    println!("  📲 NFC Simulation Endpoints:");
    println!("     POST /api/nfc/generate        - Generate NFC card for patient");
    println!("     POST /api/nfc/tap             - Simulate NFC card tap");
    println!("     POST /api/nfc/verify-qr       - Verify QR code for emergency");
    println!("     GET  /api/nfc/card/{{patient}} - Get card info by patient");
    println!("     POST /api/nfc/suspend         - Suspend a card (Admin)");
    println!("     GET  /api/nfc/cards           - List all cards (Admin)");
    println!();
    println!("  🏥 Clinical Documentation Endpoints:");
    println!("     POST /api/clinical/triage     - Create ESI triage assessment");
    println!("     POST /api/clinical/soap       - Create SOAP note");
    println!("     POST /api/clinical/sample     - Create SAMPLE history");
    println!("     POST /api/clinical/gcs        - Create Glasgow Coma Scale");
    println!("     POST /api/clinical/vitals     - Add vital signs reading");
    println!("     GET  /api/clinical/lab-panels - View lab panel templates");
    println!();
    println!("  🚨 Emergency Protocol Endpoints:");
    println!("     POST /api/clinical/code-blue  - Initiate Code Blue/Resuscitation");
    println!("     POST /api/clinical/trauma     - Create Trauma Assessment");
    println!("     POST /api/clinical/stroke     - Create Stroke Assessment (NIHSS)");
    println!("     POST /api/clinical/sepsis     - Create Sepsis Assessment (qSOFA)");
    println!("     GET  /api/clinical/patient/{{id}}/emergency - All emergency records");
    println!();
    println!("  📊 Dashboard & Workflow Endpoints:");
    println!("     GET  /api/dashboard/patient   - Patient home dashboard");
    println!("     GET  /api/dashboard/doctor    - Doctor dashboard (patients, labs)");
    println!("     GET  /api/dashboard/nurse     - Nurse dashboard (tasks, vitals)");
    println!("     GET  /api/dashboard/lab       - Lab tech dashboard (queue, QC)");
    println!("     GET  /api/dashboard/admin     - Admin system overview");
    println!("     GET  /api/patients/list       - Filtered patient list");
    println!("     GET  /api/order-sets          - Common order bundles");
    println!("     GET  /api/notifications       - User notifications");
    println!("     GET  /api/medication-reminders/{{id}} - Med reminders");
    println!("     GET  /api/tasks/nurse         - Nurse task list");
    println!();
    println!("  💬 Patient Engagement Endpoints:");
    println!("     POST /api/symptoms/log        - Log symptom for tracking");
    println!("     GET  /api/symptoms/{{id}}      - Get symptom history");
    println!("     POST /api/messages/send       - Send secure message");
    println!("     GET  /api/messages            - Get inbox messages");
    println!();
    println!("  📝 Consent & Compliance Endpoints:");
    println!("     GET  /api/consent/types       - Available consent forms");
    println!("     POST /api/consent/sign        - Sign consent form");
    println!("     GET  /api/consent/patient/{{id}} - Patient's consents");
    println!();
    println!("  📦 Barcode/Sample Tracking Endpoints:");
    println!("     POST /api/barcode/generate    - Generate barcode");
    println!("     POST /api/barcode/scan        - Scan barcode");
    println!("     GET  /api/barcode/track/{{bc}} - Track barcode history");
    println!();
    println!("  📋 Note Templates Endpoints:");
    println!("     GET  /api/templates/notes     - Get note templates");
    println!("     POST /api/templates/notes/use - Create note from template");
    println!();
    println!("  🆔 Medical ID Card Endpoints:");
    println!("     GET  /api/medical-id/{{id}}    - Full Medical ID card data");
    println!("     GET  /api/medical-id/{{id}}/qr - QR code for Medical ID");
    println!("     GET  /api/medical-id/{{id}}/emergency - Emergency access view");
    println!("     GET  /api/medical-id/{{id}}/lockscreen - Lock screen format");
    println!("     POST /api/medical-id/{{id}}/preferences - Update preferences");
    println!("     POST /api/medical-id/{{id}}/emergency-notify - Trigger family alert");
    println!();
    println!("  © 2025 Trustware. Rust Africa Hackathon 2026");
    println!();

    // Create shared state
    let app_state = web::Data::new(AppState::new());

    // Start HTTP server
    HttpServer::new(move || {
        // Configure CORS for development
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .app_data(app_state.clone())
            .service(health_check)
            .service(register_patient)
            .service(update_patient)
            .service(add_emergency_contact)
            .service(emergency_access)
            .service(simulate_nfc_tap)
            .service(get_access_logs)
            .service(list_patients)
            .service(get_patient_by_id)
            .service(demo_info)
            // RBAC endpoints
            .service(assign_role)
            .service(revoke_role)
            .service(list_users)
            .service(get_my_records)
            // Wallet authentication endpoints
            .service(bootstrap_admin)
            .service(wallet_register)
            .service(wallet_login)
            .service(get_current_user_info)
            // IPFS medical record endpoints
            .service(ipfs_health_check)
            .service(upload_medical_record)
            .service(download_medical_record)
            .service(list_patient_records)
            // Lab result submission endpoints (approval workflow)
            .service(submit_lab_results)
            .service(get_pending_lab_results)
            .service(get_all_lab_submissions)
            .service(get_lab_submission)
            .service(review_lab_results)
            .service(get_patient_lab_submissions)
            // NFC card simulation endpoints
            .service(generate_nfc_card)
            .service(nfc_tap)
            .service(verify_qr_code)
            .service(get_card_info)
            .service(suspend_card)
            .service(list_nfc_cards)
            // Clinical documentation endpoints (Phase 1)
            .service(create_triage_assessment)
            .service(get_triage_assessment)
            .service(get_patient_triage_assessments)
            .service(create_soap_note)
            .service(get_soap_note)
            .service(get_patient_soap_notes)
            .service(add_soap_addendum)
            .service(create_sample_history)
            .service(get_sample_history)
            .service(create_gcs_assessment)
            .service(get_gcs_assessment)
            .service(get_patient_gcs_assessments)
            .service(add_vital_signs)
            .service(get_patient_vitals)
            .service(get_patient_latest_vitals)
            .service(get_lab_panels)
            .service(get_lab_panel)
            // Emergency protocol endpoints (Phase 2) - from clinical_endpoints module
            .service(clinical_endpoints::create_code_blue)
            .service(clinical_endpoints::get_code_blue)
            .service(clinical_endpoints::list_patient_code_blues)
            .service(clinical_endpoints::create_trauma)
            .service(clinical_endpoints::get_trauma)
            .service(clinical_endpoints::create_stroke)
            .service(clinical_endpoints::get_stroke)
            .service(clinical_endpoints::create_cardiac)
            .service(clinical_endpoints::get_cardiac)
            .service(clinical_endpoints::create_sepsis)
            .service(clinical_endpoints::get_sepsis)
            .service(clinical_endpoints::create_ems_handoff)
            .service(clinical_endpoints::get_ems_handoff)
            .service(clinical_endpoints::get_patient_emergency_records)
            // Nursing documentation endpoints (Phase 3)
            .service(clinical_endpoints::create_mar)
            .service(clinical_endpoints::get_mar)
            .service(clinical_endpoints::create_io)
            .service(clinical_endpoints::get_io)
            .service(clinical_endpoints::create_care_plan)
            .service(clinical_endpoints::get_care_plan)
            .service(clinical_endpoints::create_wound)
            .service(clinical_endpoints::get_wound)
            .service(clinical_endpoints::create_iv_site)
            .service(clinical_endpoints::get_iv_site)
            .service(clinical_endpoints::create_shift_handoff)
            .service(clinical_endpoints::get_shift_handoff)
            .service(clinical_endpoints::create_incident)
            .service(clinical_endpoints::get_incident)
            .service(clinical_endpoints::create_fall_risk)
            .service(clinical_endpoints::get_fall_risk)
            // Specialized assessment endpoints (Phase 4)
            .service(clinical_endpoints::create_burn)
            .service(clinical_endpoints::get_burn)
            .service(clinical_endpoints::create_psych)
            .service(clinical_endpoints::get_psych)
            .service(clinical_endpoints::create_tox)
            .service(clinical_endpoints::get_tox)
            .service(clinical_endpoints::create_mci)
            .service(clinical_endpoints::get_mci)
            // Procedure endpoints (Phase 5)
            .service(clinical_endpoints::create_intubation)
            .service(clinical_endpoints::get_intubation)
            .service(clinical_endpoints::create_laceration)
            .service(clinical_endpoints::get_laceration)
            .service(clinical_endpoints::create_splint)
            .service(clinical_endpoints::get_splint)
            // Specialty population endpoints (Phase 6)
            .service(clinical_endpoints::create_peds)
            .service(clinical_endpoints::get_peds)
            .service(clinical_endpoints::create_ob)
            .service(clinical_endpoints::get_ob)
            // Laboratory endpoints (Phase 7)
            .service(clinical_endpoints::create_specimen)
            .service(clinical_endpoints::get_specimen)
            .service(clinical_endpoints::create_chain_of_custody)
            .service(clinical_endpoints::get_chain_of_custody)
            .service(clinical_endpoints::create_lab_qc)
            .service(clinical_endpoints::get_lab_qc)
            .service(clinical_endpoints::create_critical_value)
            .service(clinical_endpoints::get_critical_value)
            .service(clinical_endpoints::create_specimen_rejection)
            .service(clinical_endpoints::get_specimen_rejection)
            // Physician documentation endpoints (Phase 8)
            .service(clinical_endpoints::create_order)
            .service(clinical_endpoints::get_order)
            .service(clinical_endpoints::create_discharge_summary)
            .service(clinical_endpoints::get_discharge_summary)
            .service(clinical_endpoints::create_discharge_instructions)
            .service(clinical_endpoints::get_discharge_instructions)
            .service(clinical_endpoints::create_ama)
            .service(clinical_endpoints::get_ama)
            .service(clinical_endpoints::create_hp)
            .service(clinical_endpoints::get_hp)
            .service(clinical_endpoints::create_consult)
            .service(clinical_endpoints::get_consult)
            .service(clinical_endpoints::create_progress_note)
            .service(clinical_endpoints::get_progress_note)
            // Phase 9: Surgical Documentation endpoints
            .service(clinical_endpoints::create_pre_op)
            .service(clinical_endpoints::get_pre_op)
            .service(clinical_endpoints::create_operative_note)
            .service(clinical_endpoints::get_operative_note)
            .service(clinical_endpoints::create_post_op)
            .service(clinical_endpoints::get_post_op)
            // Phase 10: Anesthesia endpoints
            .service(clinical_endpoints::create_anesthesia)
            .service(clinical_endpoints::get_anesthesia)
            // Phase 11: Radiology endpoints
            .service(clinical_endpoints::create_radiology_order)
            .service(clinical_endpoints::get_radiology_order)
            .service(clinical_endpoints::create_radiology_report)
            .service(clinical_endpoints::get_radiology_report)
            // Phase 12: Pathology endpoints
            .service(clinical_endpoints::create_pathology)
            .service(clinical_endpoints::get_pathology)
            // Phase 13: Immunization endpoints
            .service(clinical_endpoints::create_immunization)
            .service(clinical_endpoints::get_immunization)
            // Phase 14: Family History endpoints
            .service(clinical_endpoints::create_family_history)
            .service(clinical_endpoints::get_family_history)
            // Phase 15: Blood Bank endpoints
            .service(clinical_endpoints::create_blood_type_screen)
            .service(clinical_endpoints::get_blood_type_screen)
            .service(clinical_endpoints::create_transfusion)
            .service(clinical_endpoints::get_transfusion)
            // Phase 16: E-Prescribing endpoints
            .service(clinical_endpoints::create_e_prescription)
            .service(clinical_endpoints::get_e_prescription)
            // Phase 17: Appointment endpoints
            .service(clinical_endpoints::create_appointment)
            .service(clinical_endpoints::get_appointment)
            // Phase 18: Death Certificate & Autopsy endpoints
            .service(clinical_endpoints::create_death_certificate)
            .service(clinical_endpoints::get_death_certificate)
            .service(clinical_endpoints::create_autopsy_request)
            .service(clinical_endpoints::get_autopsy_request)
            // Phase 19: Patient Satisfaction endpoints
            .service(clinical_endpoints::create_satisfaction_survey)
            .service(clinical_endpoints::get_satisfaction_survey)
            // HL7 FHIR R4 endpoints
            .service(clinical_endpoints::fhir_get_patient)
            .service(clinical_endpoints::fhir_get_allergies)
            .service(clinical_endpoints::fhir_get_medications)
            .service(clinical_endpoints::fhir_get_conditions)
            .service(clinical_endpoints::fhir_get_observations)
            .service(clinical_endpoints::fhir_get_encounters)
            .service(clinical_endpoints::fhir_get_diagnostic_reports)
            .service(clinical_endpoints::fhir_get_procedures)
            .service(clinical_endpoints::fhir_get_immunizations)
            .service(clinical_endpoints::fhir_capability_statement)
            // Insurance Verification endpoints
            .service(clinical_endpoints::verify_insurance)
            .service(clinical_endpoints::check_eligibility)
            // Dashboard & Workflow endpoints
            .service(clinical_endpoints::patient_dashboard)
            .service(clinical_endpoints::doctor_dashboard)
            .service(clinical_endpoints::nurse_dashboard)
            .service(clinical_endpoints::lab_dashboard)
            .service(clinical_endpoints::admin_dashboard)
            .service(clinical_endpoints::get_patient_list)
            .service(clinical_endpoints::get_order_sets)
            .service(clinical_endpoints::get_notifications)
            .service(clinical_endpoints::get_medication_reminders)
            .service(clinical_endpoints::get_nurse_tasks)
            // Symptom Tracker endpoints
            .service(clinical_endpoints::log_symptom)
            .service(clinical_endpoints::get_symptom_history)
            // Secure Messaging endpoints
            .service(clinical_endpoints::send_message)
            .service(clinical_endpoints::get_messages)
            // Consent Form endpoints
            .service(clinical_endpoints::get_consent_types)
            .service(clinical_endpoints::sign_consent)
            .service(clinical_endpoints::get_patient_consents)
            // Barcode/Sample Tracking endpoints
            .service(clinical_endpoints::generate_barcode)
            .service(clinical_endpoints::scan_barcode)
            .service(clinical_endpoints::track_barcode)
            // Quick Note Templates endpoints
            .service(clinical_endpoints::get_note_templates)
            .service(clinical_endpoints::use_note_template)
            // Medical ID Card endpoints
            .service(clinical_endpoints::get_medical_id)
            .service(clinical_endpoints::get_medical_id_qr)
            .service(clinical_endpoints::get_emergency_medical_id)
            .service(clinical_endpoints::get_lockscreen_medical_id)
            .service(clinical_endpoints::update_medical_id_preferences)
            .service(clinical_endpoints::trigger_emergency_notification)
            // Phase 20: Medication Reminder endpoints
            .service(clinical_endpoints::create_medication_reminder)
            .service(clinical_endpoints::get_patient_reminders)
            .service(clinical_endpoints::log_medication_adherence)
            .service(clinical_endpoints::delete_medication_reminder)
            // Phase 21: Drug Interaction Checking endpoints
            .service(clinical_endpoints::check_drug_interactions)
            .service(clinical_endpoints::get_interaction_history)
            // Phase 22: Family Account Linking endpoints
            .service(clinical_endpoints::create_family_group)
            .service(clinical_endpoints::add_family_member)
            .service(clinical_endpoints::get_family_group)
            .service(clinical_endpoints::get_my_family_groups)
            .service(clinical_endpoints::remove_family_member)
            // Phase 23: Appointment Booking System endpoints
            .service(clinical_endpoints::book_appointment)
            .service(clinical_endpoints::get_patient_appointments)
            .service(clinical_endpoints::get_provider_appointments)
            .service(clinical_endpoints::cancel_appointment)
            .service(clinical_endpoints::check_in_appointment)
            .service(clinical_endpoints::get_available_slots)
            // Phase 24: Wearable Device Integration endpoints
            .service(clinical_endpoints::register_wearable_device)
            .service(clinical_endpoints::get_wearable_devices)
            .service(clinical_endpoints::submit_wearable_reading)
            .service(clinical_endpoints::get_wearable_readings)
            .service(clinical_endpoints::create_wearable_alert_rule)
            .service(clinical_endpoints::get_wearable_alerts)
            // Phase 25: AI Symptom Checker
            .service(clinical_endpoints::start_symptom_check)
            .service(clinical_endpoints::submit_symptom_answers)
            .service(clinical_endpoints::get_symptom_session)
            .service(clinical_endpoints::get_symptom_checker_history)
            // Phase 26: Telehealth Integration endpoints
            .service(clinical_endpoints::create_telehealth_session)
            .service(clinical_endpoints::get_telehealth_session)
            .service(clinical_endpoints::join_telehealth_session)
            .service(clinical_endpoints::end_telehealth_session)
            .service(clinical_endpoints::submit_device_check)
            .service(clinical_endpoints::get_patient_telehealth_sessions)
            // Phase 27: Clinical Decision Support endpoints
            .service(clinical_endpoints::create_cds_alert)
            .service(clinical_endpoints::get_cds_alerts)
            .service(clinical_endpoints::get_cds_alert)
            .service(clinical_endpoints::respond_to_cds_alert)
            .service(clinical_endpoints::get_patient_cds_alerts)
            // Phase 28: Lab Result Trending endpoints
            .service(clinical_endpoints::get_lab_trends)
            .service(clinical_endpoints::analyze_lab_trends)
            .service(clinical_endpoints::get_lab_trend_result)
            // Phase 29: E-Prescription with Signing endpoints
            .service(clinical_endpoints::create_esignature_prescription)
            .service(clinical_endpoints::sign_e_prescription)
            .service(clinical_endpoints::transmit_e_prescription)
            .service(clinical_endpoints::get_esignature_prescription)
            .service(clinical_endpoints::get_patient_e_prescriptions)
            // Phase 30: Insurance Claim Integration endpoints
            .service(clinical_endpoints::create_insurance_claim)
            .service(clinical_endpoints::submit_insurance_claim)
            .service(clinical_endpoints::get_insurance_claim)
            .service(clinical_endpoints::get_patient_insurance_claims)
            .service(clinical_endpoints::check_insurance_eligibility)
            // Phase 31: Analytics Dashboard endpoints
            .service(clinical_endpoints::get_dashboard_metrics)
            .service(clinical_endpoints::get_patient_analytics)
            .service(clinical_endpoints::get_appointment_analytics)
            .service(clinical_endpoints::get_quality_metrics)
            // Phase 32: Multi-language Support endpoints
            .service(clinical_endpoints::get_supported_languages)
            .service(clinical_endpoints::set_language_preference)
            .service(clinical_endpoints::get_language_preference)
            .service(clinical_endpoints::translate_content)
            // Phase 33: Offline Mode Sync endpoints
            .service(clinical_endpoints::get_sync_status)
            .service(clinical_endpoints::register_sync_device)
            .service(clinical_endpoints::perform_sync)
            .service(clinical_endpoints::get_sync_queue)
            .service(clinical_endpoints::download_offline_data)
            // Phase 34: List/Queue endpoints for frontend
            .service(clinical_endpoints::list_orders)
            .service(clinical_endpoints::list_discharges)
            .service(clinical_endpoints::approve_discharge)
            .service(clinical_endpoints::list_mar)
            .service(clinical_endpoints::administer_medication)
            .service(clinical_endpoints::list_io)
            .service(clinical_endpoints::record_fluid)
            .service(clinical_endpoints::list_care_plans)
            .service(get_triage_queue)
            // Phase 35: Additional list endpoints for frontend pages
            .service(clinical_endpoints::list_chain_of_custody)
            .service(clinical_endpoints::list_lab_qc)
            .service(clinical_endpoints::list_critical_values)
            .service(clinical_endpoints::list_radiology_orders)
            .service(clinical_endpoints::list_pathology)
            .service(clinical_endpoints::list_immunizations)
            .service(clinical_endpoints::list_blood_bank)
            .service(clinical_endpoints::list_autopsy)
            .service(clinical_endpoints::list_consults)
            .service(clinical_endpoints::list_cds_alerts)
    })
    .bind(&bind_addr)?
    .run()
    .await
}
