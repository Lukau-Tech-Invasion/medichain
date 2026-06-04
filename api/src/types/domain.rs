use super::*;

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
    /// Email address
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Phone number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    /// Department (for healthcare workers)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub department: Option<String>,
    /// Specialty (for doctors)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialty: Option<String>,
    /// License/registration number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license_number: Option<String>,
    /// Status (active, inactive, suspended, pending)
    #[serde(default = "default_status")]
    pub status: String,
    /// Last login timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_login: Option<DateTime<Utc>>,
}

pub fn default_status() -> String {
    "active".to_string()
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

pub fn default_priority() -> u8 {
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

pub fn default_insurance_active() -> bool {
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
    pub phone: String,
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

// ----------------------------------------------------------------------------
// PatientProfile <-> PatientEntity conversion (Phase 2.1 patient persistence)
//
// The rich plaintext `PatientProfile` is persisted via `PatientRepository`. PHI
// is encrypted with ChaCha20-Poly1305 (the per-deployment `AppState.encryption_key`,
// the same key used for IPFS document encryption). The complete profile is also
// serialized + encrypted into `profile_extras_encrypted` so reads round-trip
// losslessly (incl. address/insurance/doctors/preferences/directives); typed
// columns are populated for lookup/search. FK columns (registered_by,
// primary_provider_id) stay NULL because user IDs here are wallet addresses, not
// the `users(id)` UUIDs the schema's foreign keys expect.
// ----------------------------------------------------------------------------

/// Encrypt a UTF-8 string into the stored (nonce || ciphertext) byte form.
pub fn enc_patient_field(key: &medichain_crypto::EncryptionKey, plaintext: &str) -> Option<Vec<u8>> {
    medichain_crypto::encrypt(key, plaintext.as_bytes())
        .ok()
        .map(|e| e.to_bytes())
}

/// Convert a rich `PatientProfile` into a database `PatientEntity`, encrypting PHI.
pub(crate) fn patient_profile_to_entity(
    profile: &PatientProfile,
    key: &medichain_crypto::EncryptionKey,
) -> crate::repositories::traits::PatientEntity {
    // Split full_name into first/last for the typed columns (full value preserved in blob).
    let (first, last) = match profile.full_name.split_once(' ') {
        Some((f, l)) => (f.to_string(), l.to_string()),
        None => (profile.full_name.clone(), String::new()),
    };
    let national_id_hash =
        hex::encode(<Sha3_256 as Digest>::digest(profile.national_id.as_bytes()));
    let primary_contact = profile.emergency_info.emergency_contacts.first();
    // Lossless: encrypt the whole profile JSON into the blob column.
    let extras_encrypted = serde_json::to_vec(profile)
        .ok()
        .and_then(|bytes| medichain_crypto::encrypt(key, &bytes).ok())
        .map(|e| e.to_bytes());

    crate::repositories::traits::PatientEntity {
        id: profile.patient_id.clone(),
        health_id: profile.patient_id.clone(),
        national_id_hash,
        national_id_type: "NIN".to_string(),
        first_name_encrypted: enc_patient_field(key, &first),
        last_name_encrypted: enc_patient_field(key, &last),
        date_of_birth_encrypted: enc_patient_field(key, &profile.date_of_birth),
        gender: None,
        blood_type: Some(profile.emergency_info.blood_type.to_string()),
        phone_encrypted: enc_patient_field(key, &profile.phone),
        email_encrypted: None,
        address_encrypted: profile
            .address
            .as_ref()
            .and_then(|a| serde_json::to_string(a).ok())
            .and_then(|s| enc_patient_field(key, &s)),
        emergency_contact_name_encrypted: primary_contact
            .and_then(|c| enc_patient_field(key, &c.name)),
        emergency_contact_phone_encrypted: primary_contact
            .and_then(|c| enc_patient_field(key, &c.phone)),
        emergency_contact_relationship: primary_contact.map(|c| c.relationship.clone()),
        organ_donor: profile.emergency_info.organ_donor,
        dnr_status: profile.emergency_info.dnr_status,
        primary_provider_id: None,
        wallet_address: None,
        created_at: profile.created_at,
        updated_at: profile.last_updated,
        registered_by: None,
        is_verified: false,
        is_active: true,
        profile_extras_encrypted: extras_encrypted,
    }
}

/// Reconstruct the rich `PatientProfile` from a stored entity by decrypting the
/// `profile_extras_encrypted` blob. Returns `None` if the blob is missing or cannot
/// be decrypted/parsed (e.g. a row created before this column existed).
pub(crate) fn patient_entity_to_profile(
    entity: &crate::repositories::traits::PatientEntity,
    key: &medichain_crypto::EncryptionKey,
) -> Option<PatientProfile> {
    let blob = entity.profile_extras_encrypted.as_ref()?;
    let ed = medichain_crypto::EncryptedData::from_bytes(blob).ok()?;
    let bytes = medichain_crypto::decrypt(key, &ed).ok()?;
    serde_json::from_slice::<PatientProfile>(&bytes).ok()
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

