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
    Paramedic,
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

    /// Which roles may break the glass on a patient's emergency capsule.
    ///
    /// Break-glass bypasses consent. It exists so that a patient who cannot
    /// speak still gets their blood type, allergies and DNR status read to the
    /// person about to treat them — and the justification for overriding
    /// consent is entirely that a treating relationship is being formed in the
    /// moment.
    ///
    /// `is_healthcare_provider()` was the gate, which admits `Pharmacist` and
    /// `LabTechnician`. Neither forms a treating relationship at the bedside: a
    /// pharmacist dispenses against a prescription and a lab technician
    /// analyses a sample, and neither needs to override a patient's consent to
    /// do it. Both were able to open the capsule.
    ///
    /// `Admin` is included, and this is the one place it is. An administrator
    /// is deliberately excluded from `can_edit_medical_records` — but
    /// break-glass is a *read* under emergency conditions, it is the account
    /// that has to be able to act when a clinician's own access is the thing
    /// that has failed, and every use is audited before disclosure. Excluding
    /// it would leave a deployment with no recourse at the worst moment.
    ///
    /// Paramedics hold their own restricted role; emergency access is audited.
    ///
    /// Decided 2026-09-10 by the product owner, closing the open question
    /// `docs/NEXT_WEEK_TODO.md` printed on every CI run. It gates
    /// `POST /api/emergency/nfc-token`, which mints the one-time token that
    /// opens the capsule. (`POST /api/emergency-access`, which revealed the
    /// capsule directly and checked the same method, has been removed; the
    /// device-bound grant is gated on a professional work context and an
    /// enrolled managed device instead.)
    pub fn may_break_glass(&self) -> bool {
        matches!(
            self,
            Role::Doctor | Role::Nurse | Role::Paramedic | Role::Admin
        )
    }

    /// Emergency services may write handovers and manage an MCI board.
    pub fn may_manage_ems(&self) -> bool {
        matches!(
            self,
            Role::Doctor | Role::Nurse | Role::Paramedic | Role::Admin
        )
    }

    /// Which roles may issue a patient a national health ID card.
    ///
    /// The third of the three break-glass questions, and the one left open when
    /// the other two were decided on 2026-09-10. An NFC card is not a read: it
    /// is a durable credential that, once minted, lets whoever holds it start an
    /// emergency capsule disclosure. Issuing one is therefore a stronger act
    /// than performing a single audited break-glass read.
    ///
    /// The gate was `is_healthcare_provider()`, which admits `Pharmacist` and
    /// `LabTechnician` — so a pharmacist could mint a national health identity
    /// credential, while `POST /api/nfc/suspend` was already `Admin`-only. That
    /// asymmetry is the defect: the roles able to create a credential could not
    /// revoke one, and the role able to revoke was not the only one creating.
    ///
    /// Doctor and Nurse are included because card issuance happens at
    /// registration, at the point of care, by the clinician in front of the
    /// patient. `Admin` is included because it
    /// already suspends cards. Neither a pharmacist dispensing against a
    /// prescription nor a lab technician analysing a sample is in a position to
    /// establish who a patient is.
    pub fn may_issue_identity_credentials(&self) -> bool {
        matches!(self, Role::Doctor | Role::Nurse | Role::Admin)
    }

    /// Which roles may write to a patient's clinical record.
    ///
    /// **Not `Admin`.** An administrator creates accounts, assigns and revokes
    /// roles, and reads the audit log. Letting the same account also write
    /// clinical records collapses a separation of duties that exists for a
    /// specific reason: the holder can grant themselves any role and then act,
    /// and the audit trail will show a legitimate role at the moment of the act.
    /// The one account able to rewrite the permission system is the one account
    /// that must not also be able to use it clinically.
    ///
    /// This is not a theoretical boundary. `ADMIN_NAV` in the clinician portal
    /// has never offered the bedside screens — somebody had already drawn this
    /// line in the product — but the router let an administrator reach them by
    /// URL and this predicate let the writes through. The two halves disagreed
    /// and the permissive one won silently.
    ///
    /// # What still works
    ///
    /// * Registering a patient — `POST /api/register` gates on
    ///   `is_healthcare_provider`, which still includes `Admin`.
    /// * Reading clinical data — that is `can_view_medical_records`, which also
    ///   still includes `Admin`.
    ///
    /// # The pallet's predicate of the same name is a different question
    ///
    /// `pallet_access_control::can_edit_medical_records` gates which *chain
    /// account* may submit a medical-record extrinsic, and the API's own service
    /// signer holds `Role::Admin` there — the dev genesis grants `//Alice` Admin
    /// precisely because it is the API's default signer. Removing `Admin` there
    /// would stop every on-chain write the API makes. That predicate is about a
    /// service identity; this one is about a person.
    pub fn can_edit_medical_records(&self) -> bool {
        matches!(self, Role::Doctor | Role::Nurse)
    }

    /// May this role perform laboratory work?
    ///
    /// Specimen collection, specimen rejection, chain of custody, quality
    /// control and the recording of critical values. These are the laboratory's
    /// own functions, and every one of them was gated on
    /// `can_edit_medical_records` — `Doctor | Nurse` — so **a lab technician
    /// could not record a specimen collection, reject a specimen, or file a QC
    /// run**. Quality control is the starkest: nobody but the lab does it.
    ///
    /// This is the same defect as the pharmacist read gate fixed on 2026-09-09
    /// (`handlers/lab.rs` gated a *read* on the *edit* predicate, excluding the
    /// pharmacists who need to see a result before dispensing against it): a
    /// question about who does a job, answered with a predicate about who edits
    /// a clinical record.
    ///
    /// Doctors and nurses keep it because ward-side collection is routine —
    /// a nurse draws bloods. `Admin` is excluded for the separation-of-duties
    /// reason recorded on `can_edit_medical_records`: the account that grants
    /// roles does not also produce laboratory records.
    pub fn can_perform_laboratory_work(&self) -> bool {
        matches!(self, Role::Doctor | Role::Nurse | Role::LabTechnician)
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
            Role::Paramedic => write!(f, "Paramedic"),
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
    /// Not typed, or not known to whoever recorded it.
    ///
    /// A Special Case (Fowler, *Patterns of Enterprise Application
    /// Architecture*): the same interface as a real group, so every reader
    /// handles it, instead of a guessed group standing in for "we do not know".
    /// Registration used to require one of the eight, which forced a guess for
    /// an unconscious or untyped patient, and the patient loader turned a
    /// missing group into O+. The emergency views already treat it as
    /// "compatible donors: O-", the uncrossmatched default. `patients.blood_type`
    /// has always allowed 'Unknown'.
    Unknown,
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
            "Unknown" | "unknown" => Ok(BloodType::Unknown),
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
            BloodType::Unknown => write!(f, "Unknown"),
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
    // Renaming this would change the serde wire format ("NHIS" -> "Nhis") with no
    // #[serde(rename)] override present — a breaking change for stored/FHIR JSON.
    #[allow(clippy::upper_case_acronyms)]
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
    /// Coverage start date (ISO 8601), when the patient gave one.
    ///
    /// Optional, and an empty string is normalised to `None` by the handler.
    /// The profile form marks both dates optional — only provider and policy
    /// number carry an asterisk — and it was posting `""` for a blank one,
    /// which stored a policy "valid from ''". That is not a date and not an
    /// absence: it renders as nothing or as "Invalid Date", and any later
    /// question of the form "is this cover current?" compares against it and
    /// gets an answer nobody entered. Rule 12 — an unmeasured thing is not a
    /// zero, and here it is not an empty string either.
    #[serde(default)]
    pub valid_from: Option<String>,
    /// Coverage end date (ISO 8601), when the patient gave one.
    #[serde(default)]
    pub valid_to: Option<String>,
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
    /// Wallet/staff id of the provider who verified the DNR advance directive.
    /// `None` means the DNR is recorded but UNVERIFIED — first responders must
    /// assume full resuscitation until the directive is confirmed.
    #[serde(default)]
    pub dnr_verified_by: Option<String>,
    /// When the DNR advance directive was verified (ISO 8601 on the wire).
    #[serde(default)]
    pub dnr_verified_at: Option<DateTime<Utc>>,
    /// Reference to the advance-directive document backing the DNR (e.g. IPFS CID).
    #[serde(default)]
    pub dnr_document_ref: Option<String>,
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
    /// "HH:MM" birth time, optional. Together with `date_of_birth` and
    /// `national_id`, this is what actually disambiguates twins — `patient_id`
    /// is already a random UUID (never derived from name/DOB), but any
    /// human-facing search/lookup UI must show all of these fields rather
    /// than name+DOB alone, which two twins can share exactly.
    #[serde(default)]
    pub time_of_birth: Option<String>,
    pub national_id: String,
    /// Administrative gender, when the patient supplied one.
    ///
    /// Optional on purpose: it is not clinically required to register, and a
    /// blank value must render as "not recorded" rather than being invented.
    #[serde(default)]
    pub gender: Option<String>,
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
pub fn enc_patient_field(
    key: &medichain_crypto::EncryptionKey,
    plaintext: &str,
) -> Option<Vec<u8>> {
    medichain_crypto::encrypt(key, plaintext.as_bytes())
        .ok()
        .map(|e| e.to_bytes())
}

/// Decrypt one stored `(nonce || ciphertext)` field back to its UTF-8 string.
///
/// The read half of [`enc_patient_field`], which had no counterpart. Without
/// one, a caller needing a single field either decrypted the entire profile
/// blob or — as the medication-reminder scheduler did — gave up and substituted
/// a placeholder.
///
/// `None` for an absent field, a key version this process does not hold, a blob
/// that will not decrypt, or bytes that are not UTF-8. A caller must not be able
/// to mistake a decryption failure for a patient who has no phone number.
pub fn dec_patient_field(
    ciphertext: Option<&Vec<u8>>,
    key_version: i32,
    keyring: &crate::encryption_keyring::EncryptionKeyring,
) -> Option<String> {
    let blob = ciphertext?;
    let key = keyring.get(key_version as u32)?;
    let ed = medichain_crypto::EncryptedData::from_bytes(blob).ok()?;
    let bytes = medichain_crypto::decrypt(key, &ed).ok()?;
    String::from_utf8(bytes).ok()
}

/// Convert a rich `PatientProfile` into a database `PatientEntity`, encrypting PHI
/// with the keyring's *current* version and stamping that version onto the row
/// (Phase 6.3 — key rotation).
pub(crate) fn patient_profile_to_entity(
    profile: &PatientProfile,
    keyring: &crate::encryption_keyring::EncryptionKeyring,
) -> crate::repositories::traits::PatientEntity {
    let key = keyring.current();
    // Split full_name into first/last for the typed columns (full value preserved in blob).
    let (first, last) = match profile.full_name.split_once(' ') {
        Some((f, l)) => (f.to_string(), l.to_string()),
        None => (profile.full_name.clone(), String::new()),
    };
    // HZ-005: keyed digest (not a bare hash) — see `crate::support::hash_national_id`.
    let national_id_hash = crate::support::hash_national_id(&profile.national_id);
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
        gender: profile.gender.clone(),
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
        dnr_verified_by: profile.emergency_info.dnr_verified_by.clone(),
        dnr_verified_at: profile.emergency_info.dnr_verified_at,
        dnr_document_ref: profile.emergency_info.dnr_document_ref.clone(),
        primary_provider_id: None,
        wallet_address: None,
        created_at: profile.created_at,
        updated_at: profile.last_updated,
        registered_by: None,
        is_verified: false,
        is_active: true,
        profile_extras_encrypted: extras_encrypted,
        name_search_tokens: crate::support::patient_name_search_tokens(&profile.full_name),
        key_version: keyring.current_version() as i32,
    }
}

/// Reconstruct the rich `PatientProfile` from a stored entity by decrypting the
/// `profile_extras_encrypted` blob with whichever keyring version the row was
/// originally encrypted under (Phase 6.3 — key rotation). Returns `None` if the
/// blob is missing, the row's key version isn't in the keyring, or the blob
/// cannot be decrypted/parsed (e.g. a row created before this column existed).
pub(crate) fn patient_entity_to_profile(
    entity: &crate::repositories::traits::PatientEntity,
    keyring: &crate::encryption_keyring::EncryptionKeyring,
) -> Option<PatientProfile> {
    let blob = entity.profile_extras_encrypted.as_ref()?;
    let key = keyring.get(entity.key_version as u32)?;
    let ed = medichain_crypto::EncryptedData::from_bytes(blob).ok()?;
    let bytes = medichain_crypto::decrypt(key, &ed).ok()?;
    serde_json::from_slice::<PatientProfile>(&bytes).ok()
}

/// A staff member's contact details, as stored.
///
/// Sealed into `user_profiles.contact_encrypted` rather than written to the
/// plaintext `phone` column. A struct rather than a bare string so a second
/// number or a pager can be added without another migration — the same
/// reasoning behind the patient side's `profile_extras_encrypted`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StaffContact {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
}

impl StaffContact {
    /// Whether there is anything worth sealing.
    pub fn is_empty(&self) -> bool {
        self.phone
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    }
}

/// Seal a staff member's contact details under the current keyring version.
///
/// `None` when there is nothing to store, so an account with no phone number
/// writes a NULL blob rather than an encrypted empty object a reader would have
/// to decrypt before discovering it was empty.
pub(crate) fn seal_staff_contact(
    contact: &StaffContact,
    keyring: &crate::encryption_keyring::EncryptionKeyring,
) -> Option<Vec<u8>> {
    if contact.is_empty() {
        return None;
    }
    let plaintext = serde_json::to_vec(contact).ok()?;
    let sealed = medichain_crypto::encrypt(keyring.current(), &plaintext).ok()?;
    Some(sealed.to_bytes())
}

/// Open a sealed staff contact with whichever keyring version sealed it.
///
/// `None` for an absent blob, a key version the keyring no longer holds, or a
/// blob that will not decrypt — the same three cases
/// [`patient_entity_to_profile`] distinguishes, and for the same reason: a
/// missing contact number must not be indistinguishable from a key-management
/// failure that has made every stored one unreadable.
pub(crate) fn open_staff_contact(
    blob: Option<&Vec<u8>>,
    key_version: Option<i32>,
    keyring: &crate::encryption_keyring::EncryptionKeyring,
) -> Option<StaffContact> {
    let blob = blob?;
    let key = keyring.get(key_version.unwrap_or(1) as u32)?;
    let ed = medichain_crypto::EncryptedData::from_bytes(blob).ok()?;
    let bytes = medichain_crypto::decrypt(key, &ed).ok()?;
    serde_json::from_slice::<StaffContact>(&bytes).ok()
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

/// Read-side view of one access-log row, returned by the access-log endpoints.
///
/// `AccessLogEntry` is the write-side shape a dozen handlers build, and it has
/// no room for *why* or *what*. Converting the stored row through it threw
/// those away, so the patient's transparency screen could say *who* and *when*
/// but never *why* they looked or *what* they saw -- the two halves of the
/// promise that actually matter. This view carries every field the row stores
/// that a patient is entitled to see. The IP address and user agent are left
/// out on purpose: they identify the clinician's device, not the disclosure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessLogView {
    pub access_id: String,
    pub patient_id: String,
    pub accessor_id: String,
    pub accessor_role: String,
    /// The stored action (`view`, `download`, `nfc_tap`, ...).
    pub access_type: String,
    /// The clinician's declared reason, or `None` when none was recorded.
    pub access_reason: Option<String>,
    /// Plain-language category of what was disclosed (e.g. "Vital signs").
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub location: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub emergency: bool,
    /// Finalized chain transaction for this entry; `None` means not (yet) anchored.
    pub blockchain_tx_hash: Option<String>,
}

#[cfg(test)]
mod role_authority_tests {
    use super::*;

    /// The EMS role can handle emergencies without inheriting chart authority.
    #[test]
    fn paramedic_role_is_restricted_to_emergency_authority() {
        assert!(Role::Paramedic.may_manage_ems());
        assert!(Role::Paramedic.may_break_glass());
        assert!(!Role::Paramedic.is_healthcare_provider());
        assert!(!Role::Paramedic.can_view_medical_records());
        assert!(!Role::Paramedic.can_edit_medical_records());
    }

    /// The separation of duties, asserted rather than commented.
    ///
    /// This boundary was previously described in prose and enforced nowhere a
    /// test could see. It is one careless `matches!` edit away from coming back,
    /// and the way it comes back is silent: nothing fails, an administrator can
    /// simply write clinical records again.
    ///
    /// Demonstrated before the change, against a running instance: an
    /// administrator POSTing to `/api/clinical/vitals` was answered `201` with a
    /// stored reading id. It was never theoretical.
    #[test]
    fn administrators_cannot_write_clinical_records() {
        assert!(
            !Role::Admin.can_edit_medical_records(),
            "an administrator assigns and revokes roles; letting the same account write \
             clinical records means it can grant itself anything and then act, with the \
             audit trail showing a legitimate role at the moment of the act"
        );
        assert!(Role::Doctor.can_edit_medical_records());
        assert!(Role::Nurse.can_edit_medical_records());
        assert!(!Role::LabTechnician.can_edit_medical_records());
        assert!(!Role::Pharmacist.can_edit_medical_records());
        assert!(!Role::Patient.can_edit_medical_records());
    }

    /// What removing that authority deliberately did NOT remove.
    ///
    /// Both of these carry an administrator, and both should: registering a
    /// patient is an administrative act, and an administrator investigating an
    /// access-log entry has to be able to see what was accessed. Narrowing
    /// either as a side effect of narrowing the write predicate would be a
    /// regression, so they are pinned here next to it.
    #[test]
    fn administrators_keep_registration_and_read_authority() {
        assert!(
            Role::Admin.is_healthcare_provider(),
            "POST /api/register gates on this; an administrator registers patients"
        );
        assert!(
            Role::Admin.can_view_medical_records(),
            "reading is not writing"
        );
        assert!(Role::Admin.is_admin());
    }

    /// Every provider can read, which is not the same set that can write.
    ///
    /// `handlers/lab.rs` gated a *read* on `can_edit_medical_records` against a
    /// comment that said "healthcare provider", so it had always excluded
    /// pharmacists — who need to see a lab result before dispensing against it.
    #[test]
    fn a_lab_technician_can_do_laboratory_work() {
        assert!(
            Role::LabTechnician.can_perform_laboratory_work(),
            "specimen collection, rejection, chain of custody and QC are the              laboratory's own functions; these were gated on              can_edit_medical_records, which excludes the lab entirely"
        );
        assert!(
            Role::Nurse.can_perform_laboratory_work(),
            "a nurse draws bloods"
        );
        assert!(Role::Doctor.can_perform_laboratory_work());

        assert!(
            !Role::Admin.can_perform_laboratory_work(),
            "same separation of duties as can_edit_medical_records: the account              that grants roles does not also produce laboratory records"
        );
        assert!(!Role::Pharmacist.can_perform_laboratory_work());
        assert!(!Role::Patient.can_perform_laboratory_work());
    }

    #[test]
    fn laboratory_work_is_not_the_same_question_as_editing_a_record() {
        // The bug this predicate exists to prevent coming back: a lab
        // technician does laboratory work and does not edit clinical records,
        // and one predicate cannot answer both.
        assert!(Role::LabTechnician.can_perform_laboratory_work());
        assert!(!Role::LabTechnician.can_edit_medical_records());
    }

    #[test]
    fn pharmacists_and_lab_technicians_can_read_but_not_write() {
        for role in [Role::Pharmacist, Role::LabTechnician] {
            assert!(
                role.can_view_medical_records(),
                "{role} must be able to read"
            );
            assert!(
                !role.can_edit_medical_records(),
                "{role} must not be able to write"
            );
        }
    }
}

#[cfg(test)]
mod staff_contact_tests {
    use super::*;
    use crate::encryption_keyring::EncryptionKeyring;

    #[test]
    fn a_sealed_contact_number_comes_back_unchanged() {
        let keyring = EncryptionKeyring::ephemeral();
        let contact = StaffContact {
            phone: Some("+27 11 555 0100".to_string()),
        };

        let blob = seal_staff_contact(&contact, &keyring).expect("a contact with a number seals");
        let opened = open_staff_contact(
            Some(&blob),
            Some(keyring.current_version() as i32),
            &keyring,
        )
        .expect("what this keyring sealed, this keyring opens");

        assert_eq!(opened.phone.as_deref(), Some("+27 11 555 0100"));
    }

    #[test]
    fn the_sealed_blob_does_not_contain_the_number_in_the_clear() {
        let keyring = EncryptionKeyring::ephemeral();
        let contact = StaffContact {
            phone: Some("0115550100".to_string()),
        };

        let blob = seal_staff_contact(&contact, &keyring).expect("seals");

        // The point of the column. A blob that happened to store the JSON
        // unencrypted would pass the round-trip test above and still be exactly
        // the plaintext `phone` column this replaces.
        assert!(
            !blob.windows(10).any(|w| w == b"0115550100"),
            "the contact number appears verbatim in the stored blob"
        );
    }

    #[test]
    fn nothing_to_store_seals_to_nothing() {
        let keyring = EncryptionKeyring::ephemeral();

        // A blank field is absent, not a contact number that is the empty
        // string (CLAUDE.md rule 9). Sealing "" would write a blob every reader
        // has to decrypt before discovering it holds nothing.
        assert!(seal_staff_contact(&StaffContact::default(), &keyring).is_none());
        assert!(seal_staff_contact(
            &StaffContact {
                phone: Some("   ".to_string()),
            },
            &keyring
        )
        .is_none());
    }

    #[test]
    fn a_key_version_the_keyring_does_not_hold_reads_as_absent() {
        let keyring = EncryptionKeyring::ephemeral();
        let blob = seal_staff_contact(
            &StaffContact {
                phone: Some("+27 11 555 0100".to_string()),
            },
            &keyring,
        )
        .expect("seals");

        // Fail closed rather than panicking or returning a wrong number: a row
        // stamped with a retired version is unreadable, and the caller renders
        // "no contact recorded" instead of taking the process down.
        assert!(open_staff_contact(Some(&blob), Some(7), &keyring).is_none());
        assert!(open_staff_contact(None, Some(1), &keyring).is_none());
    }

    #[test]
    fn a_blob_that_will_not_decrypt_reads_as_absent() {
        let keyring = EncryptionKeyring::ephemeral();
        let garbage = vec![9u8; 64];

        assert!(open_staff_contact(Some(&garbage), Some(1), &keyring).is_none());
    }
}
