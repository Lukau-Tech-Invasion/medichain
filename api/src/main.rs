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

mod ipfs;
mod nfc_simulator;

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

/// User account with role
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub user_id: String,
    pub username: String,
    pub role: Role,
    pub created_at: DateTime<Utc>,
    pub created_by: Option<String>,
}

/// Blood types supported by the system
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

/// Emergency contact information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmergencyContact {
    pub name: String,
    pub phone: String,
    pub relationship: String,
}

/// Patient emergency information (visible without full consent)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmergencyInfo {
    pub patient_id: String,
    pub blood_type: BloodType,
    pub allergies: Vec<String>,
    pub current_medications: Vec<String>,
    pub chronic_conditions: Vec<String>,
    pub emergency_contacts: Vec<EmergencyContact>,
    pub organ_donor: bool,
    pub dnr_status: bool,
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
    pub allergies: Vec<String>,
    pub current_medications: Vec<String>,
    pub chronic_conditions: Vec<String>,
    pub emergency_contact_name: String,
    pub emergency_contact_phone: String,
    pub emergency_contact_relationship: String,
    pub organ_donor: bool,
    pub dnr_status: bool,
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
// RBAC Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct AssignRoleRequest {
    pub user_id: String,
    pub username: String,
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct AssignRoleResponse {
    pub success: bool,
    pub user_id: String,
    pub role: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct RevokeRoleRequest {
    pub user_id: String,
}

#[derive(Debug, Serialize)]
pub struct RevokeRoleResponse {
    pub success: bool,
    pub user_id: String,
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LabResultStatus {
    Pending,
    Approved,
    Rejected,
}

impl Default for LabResultStatus {
    fn default() -> Self {
        LabResultStatus::Pending
    }
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
}

impl AppState {
    pub fn new() -> Self {
        // In production, keys would be managed by HSM/key vault
        let encryption_key =
            medichain_crypto::EncryptionKey::generate().expect("Failed to generate encryption key");

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
        };
        state.seed_demo_data();
        state
    }

    /// Seed demo data for hackathon presentation
    /// Includes 12 diverse African patients with various medical conditions
    fn seed_demo_data(&mut self) {
        // ====================================================================
        // SAMPLE PATIENTS - 12 diverse African patients
        // ====================================================================

        let sample_patients = vec![
            // Patient 1: Nigeria - Diabetes & Hypertension
            (
                "PAT-001-DEMO",
                "Adebayo Okonkwo",
                "1985-06-15",
                "NIN-12345678901",
                BloodType::OPositive,
                vec!["Penicillin", "Sulfa drugs"],
                vec![
                    "Metformin 500mg - twice daily",
                    "Lisinopril 10mg - once daily",
                ],
                vec!["Type 2 Diabetes", "Hypertension"],
                ("Chioma Okonkwo", "+234-801-234-5678", "Spouse"),
                true,
                false,
            ),
            // Patient 2: Ghana - Sickle Cell
            (
                "PAT-002-DEMO",
                "Kwame Asante",
                "1992-03-22",
                "GHA-987654321012",
                BloodType::APositive,
                vec!["Aspirin", "NSAIDs"],
                vec!["Hydroxyurea 500mg - daily", "Folic acid 5mg - daily"],
                vec!["Sickle Cell Disease"],
                ("Akosua Asante", "+233-24-123-4567", "Mother"),
                false,
                false,
            ),
            // Patient 3: Ethiopia - HIV on ARV
            (
                "PAT-003-DEMO",
                "Tigist Haile",
                "1988-11-08",
                "ETH-FAYDA-5566778899",
                BloodType::BPositive,
                vec!["Nevirapine"],
                vec!["Tenofovir/Lamivudine/Dolutegravir - daily"],
                vec!["HIV (on ARV - undetectable viral load)"],
                ("Yonas Haile", "+251-91-234-5678", "Brother"),
                true,
                false,
            ),
            // Patient 4: Kenya - Asthma & Allergies
            (
                "PAT-004-DEMO",
                "Wanjiku Kamau",
                "1995-07-30",
                "KEN-HUDUMA-1122334455",
                BloodType::ABPositive,
                vec!["Peanuts", "Shellfish", "Bee stings"],
                vec![
                    "Salbutamol inhaler - as needed",
                    "Fluticasone inhaler - twice daily",
                    "EpiPen - emergency",
                ],
                vec!["Severe Asthma", "Anaphylaxis risk"],
                ("James Kamau", "+254-722-123-456", "Father"),
                false,
                false,
            ),
            // Patient 5: South Africa - Heart Condition
            (
                "PAT-005-DEMO",
                "Thabo Ndlovu",
                "1970-02-14",
                "ZAF-SMART-6677889900",
                BloodType::ONegative,
                vec!["Statins"],
                vec![
                    "Warfarin 5mg - daily",
                    "Bisoprolol 5mg - daily",
                    "Aspirin 81mg - daily",
                ],
                vec![
                    "Atrial Fibrillation",
                    "Previous MI (2023)",
                    "CHF - NYHA Class II",
                ],
                ("Nomvula Ndlovu", "+27-82-345-6789", "Wife"),
                false,
                true,
            ), // DNR status
            // Patient 6: Rwanda - Epilepsy
            (
                "PAT-006-DEMO",
                "Umutoni Uwimana",
                "2000-09-12",
                "RWA-NID-2233445566",
                BloodType::APositive,
                vec![],
                vec![
                    "Valproate 500mg - twice daily",
                    "Levetiracetam 500mg - twice daily",
                ],
                vec!["Epilepsy - Grand Mal seizures"],
                ("Jean-Pierre Uwimana", "+250-78-123-4567", "Father"),
                true,
                false,
            ),
            // Patient 7: Tanzania - Pregnancy
            (
                "PAT-007-DEMO",
                "Rehema Mwanga",
                "1993-04-25",
                "TZA-NIDA-7788990011",
                BloodType::BNegative,
                vec!["Latex"],
                vec!["Prenatal vitamins - daily", "Iron supplement - daily"],
                vec!["Pregnancy - 28 weeks", "Rh-negative (Anti-D given)"],
                ("Hassan Mwanga", "+255-754-321-987", "Husband"),
                false,
                false,
            ),
            // Patient 8: Uganda - Malaria history
            (
                "PAT-008-DEMO",
                "Nakato Ssempijja",
                "1998-12-03",
                "UGA-NIN-3344556677",
                BloodType::ABNegative,
                vec!["Chloroquine"],
                vec!["Doxycycline 100mg - malaria prophylaxis when traveling"],
                vec!["Recurrent Malaria (G6PD deficiency)", "Mild Anemia"],
                ("Joseph Ssempijja", "+256-772-456-789", "Husband"),
                true,
                false,
            ),
            // Patient 9: Senegal - Mental Health
            (
                "PAT-009-DEMO",
                "Fatou Diallo",
                "1982-08-17",
                "SEN-CNI-9900112233",
                BloodType::OPositive,
                vec!["SSRIs - causes severe reaction"],
                vec![
                    "Mirtazapine 30mg - at bedtime",
                    "Quetiapine 50mg - as needed",
                ],
                vec!["Major Depressive Disorder", "Generalized Anxiety"],
                ("Amadou Diallo", "+221-77-123-4567", "Brother"),
                false,
                false,
            ),
            // Patient 10: Cameroon - Kidney Disease
            (
                "PAT-010-DEMO",
                "Jean-Baptiste Nkomo",
                "1975-01-28",
                "CMR-CNI-4455667788",
                BloodType::BPositive,
                vec!["Contrast dye", "ACE inhibitors"],
                vec![
                    "Calcium carbonate - with meals",
                    "Erythropoietin - weekly injection",
                ],
                vec!["Chronic Kidney Disease Stage 4", "Hypertension", "Anemia"],
                ("Marie Nkomo", "+237-677-890-123", "Wife"),
                true,
                true,
            ), // DNR status
            // Patient 11: Morocco - Diabetes Type 1
            (
                "PAT-011-DEMO",
                "Yasmine El Amrani",
                "2005-05-20",
                "MAR-CNIE-1234509876",
                BloodType::ANegative,
                vec!["None known"],
                vec![
                    "Insulin Lantus 20u - bedtime",
                    "Insulin Novorapid - with meals",
                ],
                vec!["Type 1 Diabetes", "Celiac Disease"],
                ("Fatima El Amrani", "+212-661-234-567", "Mother"),
                true,
                false,
            ),
            // Patient 12: Egypt - Multiple conditions (elderly)
            (
                "PAT-012-DEMO",
                "Ahmed Hassan Ibrahim",
                "1948-10-05",
                "EGY-NID-5678901234",
                BloodType::OPositive,
                vec!["Penicillin", "Morphine", "Codeine"],
                vec![
                    "Amlodipine 10mg - daily",
                    "Metformin 1000mg - twice daily",
                    "Atorvastatin 40mg - at bedtime",
                    "Omeprazole 20mg - daily",
                    "Donepezil 10mg - daily",
                ],
                vec![
                    "Type 2 Diabetes",
                    "Hypertension",
                    "Hyperlipidemia",
                    "GERD",
                    "Mild Dementia",
                    "Osteoarthritis",
                ],
                ("Sara Ibrahim", "+20-100-234-5678", "Daughter"),
                false,
                true,
            ), // DNR status
        ];

        // Insert all patients
        for (
            i,
            (pat_id, name, dob, nat_id, blood, allergies, meds, conditions, contact, donor, dnr),
        ) in sample_patients.iter().enumerate()
        {
            let patient_id = pat_id.to_string();
            let nfc_tag_id = format!("NFC-DEMO-{:03}", i + 1);

            let emergency_info = EmergencyInfo {
                patient_id: patient_id.clone(),
                blood_type: blood.clone(),
                allergies: allergies.iter().map(|s| s.to_string()).collect(),
                current_medications: meds.iter().map(|s| s.to_string()).collect(),
                chronic_conditions: conditions.iter().map(|s| s.to_string()).collect(),
                emergency_contacts: vec![EmergencyContact {
                    name: contact.0.to_string(),
                    phone: contact.1.to_string(),
                    relationship: contact.2.to_string(),
                }],
                organ_donor: *donor,
                dnr_status: *dnr,
                last_updated: Utc::now(),
            };

            let patient = PatientProfile {
                patient_id: patient_id.clone(),
                full_name: name.to_string(),
                date_of_birth: dob.to_string(),
                national_id: nat_id.to_string(),
                emergency_info,
                created_at: Utc::now(),
                last_updated: Utc::now(),
            };

            // Generate NFC tag hash
            let hash = generate_nfc_hash(&patient_id, &nfc_tag_id);
            let nfc_tag = NfcTagData {
                tag_id: nfc_tag_id.clone(),
                patient_id: patient_id.clone(),
                hash,
                created_at: Utc::now(),
            };

            // Insert patient data
            self.patients
                .write()
                .unwrap()
                .insert(patient_id.clone(), patient);
            self.nfc_tags.write().unwrap().insert(nfc_tag_id, nfc_tag);

            // Create user account for patient
            let patient_user = User {
                user_id: patient_id.clone(),
                username: name.to_lowercase().replace(' ', "."),
                role: Role::Patient,
                created_at: Utc::now(),
                created_by: Some("DOC-001".to_string()),
            };
            self.users.write().unwrap().insert(patient_id, patient_user);
        }

        // ====================================================================
        // HEALTHCARE STAFF USERS
        // ====================================================================
        let demo_users = vec![
            User {
                user_id: "ADMIN-001".to_string(),
                username: "admin".to_string(),
                role: Role::Admin,
                created_at: Utc::now(),
                created_by: None,
            },
            User {
                user_id: "DOC-001".to_string(),
                username: "dr.adeola".to_string(),
                role: Role::Doctor,
                created_at: Utc::now(),
                created_by: Some("ADMIN-001".to_string()),
            },
            User {
                user_id: "DOC-002".to_string(),
                username: "dr.mensah".to_string(),
                role: Role::Doctor,
                created_at: Utc::now(),
                created_by: Some("ADMIN-001".to_string()),
            },
            User {
                user_id: "NURSE-001".to_string(),
                username: "nurse.amina".to_string(),
                role: Role::Nurse,
                created_at: Utc::now(),
                created_by: Some("ADMIN-001".to_string()),
            },
            User {
                user_id: "NURSE-002".to_string(),
                username: "nurse.tendai".to_string(),
                role: Role::Nurse,
                created_at: Utc::now(),
                created_by: Some("ADMIN-001".to_string()),
            },
            User {
                user_id: "LAB-001".to_string(),
                username: "lab.kofi".to_string(),
                role: Role::LabTechnician,
                created_at: Utc::now(),
                created_by: Some("ADMIN-001".to_string()),
            },
            User {
                user_id: "PHARM-001".to_string(),
                username: "pharm.nadia".to_string(),
                role: Role::Pharmacist,
                created_at: Utc::now(),
                created_by: Some("ADMIN-001".to_string()),
            },
        ];

        for user in demo_users {
            self.users
                .write()
                .unwrap()
                .insert(user.user_id.clone(), user);
        }

        // ====================================================================
        // SAMPLE LAB RESULTS (pending approval)
        // ====================================================================
        let sample_lab_submissions = vec![
            LabResultSubmission {
                id: "LAB-DEMO-001".to_string(),
                patient_id: "PAT-001-DEMO".to_string(),
                patient_name: "Adebayo Okonkwo".to_string(),
                test_name: "Complete Blood Count (CBC)".to_string(),
                test_category: "Hematology".to_string(),
                results: vec![
                    LabTestResult {
                        parameter: "Hemoglobin".to_string(),
                        value: "14.2".to_string(),
                        unit: "g/dL".to_string(),
                        reference_range: "13.5-17.5".to_string(),
                        flag: None,
                    },
                    LabTestResult {
                        parameter: "WBC Count".to_string(),
                        value: "7.5".to_string(),
                        unit: "x10^9/L".to_string(),
                        reference_range: "4.5-11.0".to_string(),
                        flag: None,
                    },
                    LabTestResult {
                        parameter: "Platelet Count".to_string(),
                        value: "245".to_string(),
                        unit: "x10^9/L".to_string(),
                        reference_range: "150-400".to_string(),
                        flag: None,
                    },
                ],
                notes: Some("Routine check - all values within normal range".to_string()),
                submitted_by: "LAB-001".to_string(),
                submitted_at: Utc::now(),
                status: LabResultStatus::Pending,
                reviewed_by: None,
                reviewed_at: None,
                rejection_reason: None,
                content_hash: None,
                metadata_hash: None,
            },
            LabResultSubmission {
                id: "LAB-DEMO-002".to_string(),
                patient_id: "PAT-001-DEMO".to_string(),
                patient_name: "Adebayo Okonkwo".to_string(),
                test_name: "HbA1c (Glycated Hemoglobin)".to_string(),
                test_category: "Chemistry".to_string(),
                results: vec![LabTestResult {
                    parameter: "HbA1c".to_string(),
                    value: "7.2".to_string(),
                    unit: "%".to_string(),
                    reference_range: "<5.7".to_string(),
                    flag: Some("HIGH".to_string()),
                }],
                notes: Some(
                    "Slightly elevated - patient is diabetic, discuss with doctor".to_string(),
                ),
                submitted_by: "LAB-001".to_string(),
                submitted_at: Utc::now(),
                status: LabResultStatus::Pending,
                reviewed_by: None,
                reviewed_at: None,
                rejection_reason: None,
                content_hash: None,
                metadata_hash: None,
            },
            LabResultSubmission {
                id: "LAB-DEMO-003".to_string(),
                patient_id: "PAT-003-DEMO".to_string(),
                patient_name: "Tigist Haile".to_string(),
                test_name: "HIV Viral Load".to_string(),
                test_category: "Virology".to_string(),
                results: vec![LabTestResult {
                    parameter: "HIV-1 RNA".to_string(),
                    value: "<20".to_string(),
                    unit: "copies/mL".to_string(),
                    reference_range: "<20 (undetectable)".to_string(),
                    flag: None,
                }],
                notes: Some("Viral load undetectable - ARV therapy effective".to_string()),
                submitted_by: "LAB-001".to_string(),
                submitted_at: Utc::now(),
                status: LabResultStatus::Approved,
                reviewed_by: Some("DOC-001".to_string()),
                reviewed_at: Some(Utc::now()),
                rejection_reason: None,
                content_hash: Some("Qm-approved-demo".to_string()),
                metadata_hash: Some("Qm-meta-demo".to_string()),
            },
            LabResultSubmission {
                id: "LAB-DEMO-004".to_string(),
                patient_id: "PAT-010-DEMO".to_string(),
                patient_name: "Jean-Baptiste Nkomo".to_string(),
                test_name: "Kidney Function Panel".to_string(),
                test_category: "Chemistry".to_string(),
                results: vec![
                    LabTestResult {
                        parameter: "Creatinine".to_string(),
                        value: "4.2".to_string(),
                        unit: "mg/dL".to_string(),
                        reference_range: "0.7-1.3".to_string(),
                        flag: Some("HIGH".to_string()),
                    },
                    LabTestResult {
                        parameter: "BUN".to_string(),
                        value: "45".to_string(),
                        unit: "mg/dL".to_string(),
                        reference_range: "7-20".to_string(),
                        flag: Some("HIGH".to_string()),
                    },
                    LabTestResult {
                        parameter: "eGFR".to_string(),
                        value: "18".to_string(),
                        unit: "mL/min/1.73m²".to_string(),
                        reference_range: ">90".to_string(),
                        flag: Some("CRITICAL".to_string()),
                    },
                ],
                notes: Some(
                    "CKD Stage 4 - eGFR declining, nephrology consult recommended".to_string(),
                ),
                submitted_by: "LAB-001".to_string(),
                submitted_at: Utc::now(),
                status: LabResultStatus::Pending,
                reviewed_by: None,
                reviewed_at: None,
                rejection_reason: None,
                content_hash: None,
                metadata_hash: None,
            },
        ];

        for submission in sample_lab_submissions {
            self.lab_submissions
                .write()
                .unwrap()
                .insert(submission.id.clone(), submission);
        }
    }
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

/// Extract user_id from X-User-Id header (simulated auth for demo)
fn get_current_user_id(req: &HttpRequest) -> Option<String> {
    req.headers()
        .get("X-User-Id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Get user by ID from app state
fn get_user(data: &web::Data<AppState>, user_id: &str) -> Option<User> {
    data.users.read().ok()?.get(user_id).cloned()
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
        allergies: req.allergies.clone(),
        current_medications: req.current_medications.clone(),
        chronic_conditions: req.chronic_conditions.clone(),
        emergency_contacts: vec![EmergencyContact {
            name: req.emergency_contact_name.clone(),
            phone: req.emergency_contact_phone.clone(),
            relationship: req.emergency_contact_relationship.clone(),
        }],
        organ_donor: req.organ_donor,
        dnr_status: req.dnr_status,
        last_updated: Utc::now(),
    };

    // Create patient profile
    let patient = PatientProfile {
        patient_id: patient_id.clone(),
        full_name: req.full_name.clone(),
        date_of_birth: req.date_of_birth.clone(),
        national_id: req.national_id.clone(),
        emergency_info,
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
    let patient_user = User {
        user_id: patient_id.clone(),
        username: req.full_name.to_lowercase().replace(' ', "."),
        role: Role::Patient,
        created_at: Utc::now(),
        created_by: Some(current_user_id.clone()),
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
        patient.emergency_info.allergies = allergies.clone();
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

/// Get demo info
#[get("/api/demo")]
async fn demo_info() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "project": "MediChain",
        "hackathon": "Rust Africa Hackathon 2026",
        "track": "Fintech & Inclusive Finance (Web3)",
        "description": "Blockchain-based national health ID system with NFC emergency access",
        "demo_instructions": {
            "step_1": "Tap 'Simulate NFC' with patient_id 'PAT-001-DEMO'",
            "step_2": "Use the returned nfc_tag_id with '/api/emergency-access'",
            "step_3": "View access logs at '/api/access-logs/PAT-001-DEMO'"
        },
        "rbac_demo": {
            "admin_user": "ADMIN-001 (can assign/revoke roles)",
            "doctor_user": "DOC-001 (can register patients, edit records)",
            "nurse_user": "NURSE-001 (can register patients, edit records)",
            "lab_tech_user": "LAB-001 (can register patients, read-only records)",
            "patient_user": "PAT-001-DEMO (read-only access to own records)"
        },
        "features": [
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
            "health": "GET /health",
            "register": "POST /api/register (requires: Doctor, Nurse, Admin)",
            "update_patient": "PUT /api/patients/{patient_id} (requires: Doctor, Nurse, Admin)",
            "get_my_records": "GET /api/my-records (Patient: own records only)",
            "emergency_access": "POST /api/emergency-access",
            "simulate_nfc": "POST /api/simulate-nfc-tap",
            "access_logs": "GET /api/access-logs/{patient_id}",
            "patients": "GET /api/patients",
            "users": "GET /api/users",
            "assign_role": "POST /api/roles/assign (requires: Admin)",
            "revoke_role": "DELETE /api/roles/revoke (requires: Admin)",
            "demo": "GET /api/demo"
        },
        "auth_header": "Use 'X-User-Id' header with user_id for authentication"
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

    // Create new user
    let user = User {
        user_id: body.user_id.clone(),
        username: body.username.clone(),
        role: role.clone(),
        created_at: Utc::now(),
        created_by: Some(current_user_id.clone()),
    };

    data.users
        .write()
        .unwrap()
        .insert(body.user_id.clone(), user);

    log::info!(
        "Role {} assigned to user {} by admin {}",
        role,
        body.user_id,
        current_user_id
    );

    HttpResponse::Ok().json(AssignRoleResponse {
        success: true,
        user_id: body.user_id.clone(),
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
    if body.user_id == current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Cannot revoke your own role".to_string(),
            code: "CANNOT_REVOKE_OWN_ROLE".to_string(),
        });
    }

    // Remove user
    let removed = data.users.write().unwrap().remove(&body.user_id);

    if removed.is_none() {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        });
    }

    log::info!(
        "Role revoked from user {} by admin {}",
        body.user_id,
        current_user_id
    );

    HttpResponse::Ok().json(RevokeRoleResponse {
        success: true,
        user_id: body.user_id.clone(),
        message: "Role revoked successfully".to_string(),
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

    // Find patient record matching user_id
    let patients = data.patients.read().unwrap();

    // For patients, they can only see their own records
    // For healthcare providers, they can see all records
    if current_user.role == Role::Patient {
        match patients.get(&current_user_id) {
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
            .or_insert_with(Vec::new)
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

        let owns_record = patient_records.map_or(false, |recs| {
            recs.iter().any(|r| r.content_hash == req.content_hash)
        });

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
                .or_insert_with(Vec::new)
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
            .service(emergency_access)
            .service(simulate_nfc_tap)
            .service(get_access_logs)
            .service(list_patients)
            .service(demo_info)
            // RBAC endpoints
            .service(assign_role)
            .service(revoke_role)
            .service(list_users)
            .service(get_my_records)
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
    })
    .bind(&bind_addr)?
    .run()
    .await
}
