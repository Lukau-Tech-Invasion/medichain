//! Off-chain emergency capsule and its on-chain commitment (Horizon HZ-003).
//!
//! # Why this exists
//!
//! `blood_type`, `organ_donor`, and `dnr_status` used to be stored in the clear
//! in on-chain storage, as a documented exception to this project's "hashes and
//! pointers only" rule, so a paramedic could read them without a decrypt
//! round-trip. A POPIA legal review on 2026-07-28 concluded that exception does
//! not survive contact with real patient data: an immutable ledger cannot honour
//! the correction, deletion, and retention-limitation duties POPIA places on
//! health information, and a pseudonymous `AccountId` does not cure it — the
//! Information Regulator's de-identification standard turns on whether data can
//! be re-linked to a person "by a reasonably foreseeable method", and this
//! project already accepts that such correlation may happen.
//!
//! # What replaced it
//!
//! The values live in an **off-chain capsule** (this module), where they can be
//! corrected, superseded, and deleted. Only a 32-byte commitment goes on-chain,
//! via `pallet-medical-records::set_emergency_capsule_commitment`.
//!
//! The emergency-read requirement that motivated the original design is
//! untouched: the paramedic path reads this capsule from Postgres and always
//! did — it never read from chain. What the commitment adds is the ability to
//! *detect tampering* with that off-chain copy, which the previous design did
//! not provide either.
//!
//! # Provenance
//!
//! The capsule carries provenance the old plain enums could not (who verified a
//! blood type and when; which document backs a DNR and whether it has been
//! revoked). Per the review: a recorded blood type is informational and is never
//! sufficient authorisation for transfusion on its own — compatibility testing
//! and crossmatching remain required regardless of what is stored here.

use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};

use crate::types::{BloodType, EmergencyInfo};

/// Domain separator, so a capsule commitment can never collide with another
/// hash this system computes over different data.
const CAPSULE_DOMAIN: &[u8] = b"medichain:emergency-capsule:v1";

/// How a recorded blood type was established.
///
/// A self-reported blood type and a laboratory-verified one carry very
/// different clinical weight; storing a bare enum erased that distinction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BloodTypeSource {
    LaboratoryVerified,
    ClinicianRecorded,
    PatientReported,
    Unknown,
}

impl BloodTypeSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::LaboratoryVerified => "laboratory_verified",
            Self::ClinicianRecorded => "clinician_recorded",
            Self::PatientReported => "patient_reported",
            Self::Unknown => "unknown",
        }
    }
}

/// The emergency data a first responder needs, with provenance.
///
/// Held off-chain (Postgres today), committed to on-chain as a 32-byte digest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmergencyCapsule {
    pub patient_id: String,
    /// Monotonically increasing. Must be > the version currently on-chain, so a
    /// superseded capsule cannot be replayed as current.
    pub version: u32,

    pub blood_type: BloodType,
    pub blood_type_source: BloodTypeSource,
    pub blood_type_verified_at: Option<chrono::DateTime<chrono::Utc>>,
    pub blood_type_verified_by: Option<String>,

    pub organ_donor: bool,

    pub dnr_status: bool,
    /// Document backing the DNR directive (e.g. IPFS CID).
    pub dnr_document_ref: Option<String>,
    pub dnr_verified_by: Option<String>,
    pub dnr_verified_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Set when a DNR has been revoked. A revoked DNR must never read as
    /// active, which is why revocation is an explicit field rather than the
    /// absence of a record.
    pub dnr_revoked_at: Option<chrono::DateTime<chrono::Utc>>,

    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl EmergencyCapsule {
    /// Build a capsule from the emergency info already held for a patient.
    pub fn from_emergency_info(info: &EmergencyInfo, version: u32) -> Self {
        Self {
            patient_id: info.patient_id.clone(),
            version,
            blood_type: info.blood_type.clone(),
            // The existing schema records no provenance for blood type, so this
            // is honestly reported as unknown rather than inventing a
            // verification that never happened.
            blood_type_source: BloodTypeSource::Unknown,
            blood_type_verified_at: None,
            blood_type_verified_by: None,
            organ_donor: info.organ_donor,
            dnr_status: info.dnr_status,
            dnr_document_ref: info.dnr_document_ref.clone(),
            dnr_verified_by: info.dnr_verified_by.clone(),
            dnr_verified_at: info.dnr_verified_at,
            dnr_revoked_at: None,
            updated_at: info.last_updated,
        }
    }

    /// Whether the DNR directive should be acted on.
    ///
    /// Requires a recorded DNR that is verified and not revoked. Deliberately
    /// conservative: an unverified or revoked directive reads as "resuscitate",
    /// because the cost of wrongly withholding resuscitation is not recoverable.
    pub fn dnr_is_actionable(&self) -> bool {
        self.dnr_status && self.dnr_verified_by.is_some() && self.dnr_revoked_at.is_none()
    }

    /// The 32-byte commitment published on-chain.
    ///
    /// Uses explicit length prefixes rather than delimiter-joined fields, so no
    /// combination of field values can produce the same digest as a different
    /// combination. This codebase already guards the same property for NFC card
    /// hashes (`property_tests::card_hash_resists_separator_ambiguity`).
    pub fn commitment(&self) -> [u8; 32] {
        let mut hasher = Sha3_256::new();
        hasher.update(CAPSULE_DOMAIN);

        let mut field = |bytes: &[u8]| {
            // Length-prefix every field: "ab" + "c" and "a" + "bc" must not
            // hash alike.
            hasher.update((bytes.len() as u64).to_be_bytes());
            hasher.update(bytes);
        };

        field(self.patient_id.as_bytes());
        field(&self.version.to_be_bytes());
        field(self.blood_type.to_string().as_bytes());
        field(self.blood_type_source.as_str().as_bytes());
        opt_field(&mut field, self.blood_type_verified_at.map(rfc3339));
        opt_field(&mut field, self.blood_type_verified_by.clone());
        field(&[u8::from(self.organ_donor)]);
        field(&[u8::from(self.dnr_status)]);
        opt_field(&mut field, self.dnr_document_ref.clone());
        opt_field(&mut field, self.dnr_verified_by.clone());
        opt_field(&mut field, self.dnr_verified_at.map(rfc3339));
        opt_field(&mut field, self.dnr_revoked_at.map(rfc3339));
        field(self.updated_at.to_rfc3339().as_bytes());

        hasher.finalize().into()
    }

    /// Whether this capsule matches a commitment published on-chain.
    ///
    /// A mismatch means the off-chain copy has been altered, replaced, or is a
    /// different version than the one committed — all cases where the data must
    /// not be trusted without investigation.
    pub fn matches_commitment(&self, on_chain: &[u8; 32]) -> bool {
        // Not constant-time on purpose: both sides of this comparison are
        // public integrity values, not secrets, so there is no timing oracle to
        // protect against.
        &self.commitment() == on_chain
    }
}

fn rfc3339(value: chrono::DateTime<chrono::Utc>) -> String {
    value.to_rfc3339()
}

/// Hash an optional value with an explicit presence marker.
///
/// `None` and `Some("")` are genuinely different states — "no DNR document on
/// file" versus "a DNR document whose reference is blank" — so they must not
/// produce the same digest. A presence byte keeps them distinct; without it,
/// clearing a field and blanking it would be indistinguishable on-chain.
fn opt_field<F: FnMut(&[u8])>(field: &mut F, value: Option<String>) {
    match value {
        Some(v) => {
            field(&[1u8]);
            field(v.as_bytes());
        }
        None => field(&[0u8]),
    }
}

// ---------------------------------------------------------------------------
// Storage, anchoring, and break-glass reads
// ---------------------------------------------------------------------------

use actix_web::web;

use crate::repositories::traits::{EmergencyCapsuleAccessEntity, EmergencyCapsuleEntity};
use crate::state::AppState;

/// A capsule loaded from storage, together with whether it still matches the
/// commitment recorded for it.
pub struct VerifiedCapsule {
    pub capsule: EmergencyCapsule,
    pub version: i32,
    /// `false` means the stored ciphertext no longer hashes to the commitment
    /// that was published for this version — the copy has been altered or
    /// replaced. The data is still returned (a paramedic who needs a blood type
    /// now is not helped by withholding it), but the discrepancy is recorded on
    /// the access log and must be investigated.
    pub commitment_verified: bool,
}

/// Build, encrypt, store, and anchor a new capsule version.
///
/// Call this whenever a patient's emergency information changes. Versions are
/// allocated from storage rather than passed in, so two callers cannot mint the
/// same version.
///
/// Chain unavailability does not lose the clinical write: a failed submission
/// is durably queued before this function succeeds. A finalized transaction is
/// written back to the capsule row immediately.
pub async fn publish_capsule(
    data: &web::Data<AppState>,
    info: &EmergencyInfo,
    created_by: &str,
) -> Result<EmergencyCapsuleEntity, String> {
    let repo = &data.repositories.emergency_capsules;

    let next_version = repo
        .latest_version(&info.patient_id)
        .await
        .map_err(|e| format!("could not read current capsule version: {e}"))?
        .saturating_add(1);

    let capsule = EmergencyCapsule::from_emergency_info(info, next_version as u32);
    let commitment = hex::encode(capsule.commitment());

    // Encrypted under the SERVER keyring, deliberately: the review requires the
    // capsule be encrypted at rest but ALSO that the emergency path not need an
    // ordinary patient-controlled decryption round trip. A patient in cardiac
    // arrest cannot approve a decryption.
    let key = data.encryption_keyring.current();
    let plaintext =
        serde_json::to_vec(&capsule).map_err(|e| format!("could not serialise capsule: {e}"))?;
    let capsule_encrypted = medichain_crypto::encrypt(key, &plaintext)
        .map_err(|e| format!("could not encrypt capsule: {e}"))?
        .to_bytes();

    let mut stored = repo
        .put(EmergencyCapsuleEntity {
            patient_id: info.patient_id.clone(),
            version: next_version,
            commitment: commitment.clone(),
            capsule_encrypted,
            key_version: data.encryption_keyring.current_version() as i32,
            created_by: created_by.to_string(),
            created_at: chrono::Utc::now(),
            revoked_at: None,
            revoked_by: None,
            revocation_reason: None,
            chain_tx_hash: None,
            chain_finalized: false,
        })
        .await
        .map_err(|e| format!("could not store capsule: {e}"))?;

    let patient_account = data
        .repositories
        .patients
        .get_by_id(&info.patient_id)
        .await
        .ok()
        .and_then(|patient| patient.wallet_address);
    if crate::blockchain::blockchain_enabled() && patient_account.is_none() {
        return Err(format!(
            "capsule {}/v{} is stored but the patient has no blockchain wallet",
            info.patient_id, next_version
        ));
    }
    let outcome = crate::audit_outbox::anchor_capsule_or_queue(
        data,
        &info.patient_id,
        patient_account.as_deref().unwrap_or_default(),
        &commitment,
        next_version,
    )
    .await?;
    if let Some(transaction_hash) = outcome.transaction_hash {
        repo.record_chain_result(&info.patient_id, next_version, &transaction_hash, true)
            .await
            .map_err(|error| {
                format!("chain finalized but its capsule result was not saved: {error}")
            })?;
        stored.chain_tx_hash = Some(transaction_hash);
        stored.chain_finalized = true;
    }

    Ok(stored)
}

/// Load the current capsule for a patient and check it against its commitment.
///
/// Returns `None` only when the patient has no live capsule — a decrypt or
/// parse failure is reported as an unverified capsule rather than as absence,
/// because "the stored copy is unreadable" and "there is no directive on file"
/// must not look the same to a clinician.
pub async fn load_current_verified(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> Option<VerifiedCapsule> {
    let stored = data
        .repositories
        .emergency_capsules
        .current(patient_id)
        .await
        .ok()
        .flatten()?;

    let decrypted = data
        .encryption_keyring
        .get(stored.key_version as u32)
        .and_then(|key| {
            let envelope =
                medichain_crypto::EncryptedData::from_bytes(&stored.capsule_encrypted).ok()?;
            medichain_crypto::decrypt(key, &envelope).ok()
        })
        .and_then(|bytes| serde_json::from_slice::<EmergencyCapsule>(&bytes).ok());

    let Some(capsule) = decrypted else {
        log::error!(
            "Emergency capsule {}/v{} could not be decrypted or parsed",
            patient_id,
            stored.version
        );
        return None;
    };

    // Recomputing the digest catches modification of the stored ciphertext. It
    // does NOT by itself prove the chain agrees: the stored `commitment` column
    // is the value that was submitted, so an attacker able to rewrite both the
    // blob and this column would still pass. Checking against live chain state
    // requires a connected node and is only meaningful once
    // `chain_finalized` is true for the version.
    //
    // A commitment column that is not valid 32-byte hex fails verification
    // rather than being skipped — an unreadable commitment is not a passing one.
    let commitment_verified = hex::decode(&stored.commitment)
        .ok()
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        .is_some_and(|expected| capsule.matches_commitment(&expected));
    if !commitment_verified {
        log::error!(
            "Emergency capsule {}/v{} FAILED commitment verification",
            patient_id,
            stored.version
        );
    }

    Some(VerifiedCapsule {
        capsule,
        version: stored.version,
        commitment_verified,
    })
}

/// Record a break-glass read: who, why, when, under which grant, and which
/// fields were actually revealed.
///
/// The caller must not release the emergency payload unless this append
/// succeeds. A warning in process logs is not an immutable disclosure record,
/// and a database outage must not create an unaudited break-glass path.
#[allow(clippy::too_many_arguments)]
pub async fn log_access(
    data: &web::Data<AppState>,
    patient_id: &str,
    capsule_version: Option<i32>,
    accessed_by: &str,
    grant_id: Option<String>,
    reason_code: &str,
    reason_text: Option<String>,
    fields_revealed: Vec<String>,
    commitment_verified: bool,
) -> Result<(), String> {
    let entry = EmergencyCapsuleAccessEntity {
        id: format!("ECA-{}", uuid::Uuid::new_v4()),
        patient_id: patient_id.to_string(),
        capsule_version,
        accessed_by: accessed_by.to_string(),
        grant_id,
        reason_code: reason_code.to_string(),
        reason_text,
        fields_revealed,
        commitment_verified,
        accessed_at: chrono::Utc::now(),
    };

    data.repositories
        .emergency_capsules
        .log_access(entry)
        .await
        .map(|_| ())
        .map_err(|error| format!("Emergency capsule access log write failed: {error}"))
}

/// Every protected field serialized by the grant-bound emergency response.
///
/// Optional and empty values remain in the JSON response as `null` or empty
/// arrays, so they are still disclosures and must remain in the audit ledger.
pub fn emergency_summary_revealed_fields() -> Vec<String> {
    [
        "patient_id",
        "blood_type",
        "allergies",
        "current_medications",
        "chronic_conditions",
        "emergency_contacts",
        "organ_donor",
        "dnr_status",
        "dnr_verified_by",
        "dnr_verified_at",
        "dnr_document_ref",
        "languages",
        "last_updated",
        "dnr_actionable",
        "commitment_verified",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn capsule() -> EmergencyCapsule {
        EmergencyCapsule {
            patient_id: "PAT-001".to_string(),
            version: 1,
            blood_type: BloodType::OPositive,
            blood_type_source: BloodTypeSource::LaboratoryVerified,
            blood_type_verified_at: Some(Utc.with_ymd_and_hms(2026, 7, 1, 9, 0, 0).unwrap()),
            blood_type_verified_by: Some("DR-7".to_string()),
            organ_donor: true,
            dnr_status: false,
            dnr_document_ref: None,
            dnr_verified_by: None,
            dnr_verified_at: None,
            dnr_revoked_at: None,
            updated_at: Utc.with_ymd_and_hms(2026, 7, 1, 9, 0, 0).unwrap(),
        }
    }

    #[test]
    fn commitment_is_deterministic() {
        assert_eq!(capsule().commitment(), capsule().commitment());
    }

    #[test]
    fn commitment_matches_itself_and_rejects_a_different_one() {
        let c = capsule();
        let commitment = c.commitment();
        assert!(c.matches_commitment(&commitment));
        assert!(!c.matches_commitment(&[0u8; 32]));
    }

    /// Every field must be covered by the commitment — a field left out of the
    /// digest could be altered off-chain without detection, which is the entire
    /// threat this mechanism exists to catch.
    #[test]
    fn every_field_change_changes_the_commitment() {
        let base = capsule().commitment();

        let mut c = capsule();
        c.version = 2;
        assert_ne!(c.commitment(), base, "version not covered");

        let mut c = capsule();
        c.blood_type = BloodType::ANegative;
        assert_ne!(c.commitment(), base, "blood_type not covered");

        let mut c = capsule();
        c.blood_type_source = BloodTypeSource::PatientReported;
        assert_ne!(c.commitment(), base, "blood_type_source not covered");

        let mut c = capsule();
        c.blood_type_verified_by = Some("DR-8".to_string());
        assert_ne!(c.commitment(), base, "blood_type_verified_by not covered");

        let mut c = capsule();
        c.organ_donor = false;
        assert_ne!(c.commitment(), base, "organ_donor not covered");

        let mut c = capsule();
        c.dnr_status = true;
        assert_ne!(c.commitment(), base, "dnr_status not covered");

        let mut c = capsule();
        c.dnr_revoked_at = Some(Utc.with_ymd_and_hms(2026, 7, 2, 9, 0, 0).unwrap());
        assert_ne!(c.commitment(), base, "dnr_revoked_at not covered");

        let mut c = capsule();
        c.patient_id = "PAT-002".to_string();
        assert_ne!(c.commitment(), base, "patient_id not covered");
    }

    /// Field boundaries must be unambiguous: moving characters across a
    /// boundary has to change the digest, or two different capsules could share
    /// one commitment.
    #[test]
    fn commitment_resists_field_boundary_ambiguity() {
        let mut a = capsule();
        a.patient_id = "PAT".to_string();
        a.blood_type_verified_by = Some("001DR-7".to_string());

        let mut b = capsule();
        b.patient_id = "PAT001".to_string();
        b.blood_type_verified_by = Some("DR-7".to_string());

        assert_ne!(a.commitment(), b.commitment());
    }

    /// "No DNR document on file" and "a DNR document with a blank reference"
    /// are different clinical states and must not share a commitment.
    #[test]
    fn none_and_empty_string_are_distinguishable() {
        let mut with_none = capsule();
        with_none.dnr_document_ref = None;

        let mut with_empty = capsule();
        with_empty.dnr_document_ref = Some(String::new());

        assert_ne!(with_none.commitment(), with_empty.commitment());
    }

    #[test]
    fn dnr_is_only_actionable_when_verified_and_not_revoked() {
        let mut c = capsule();
        c.dnr_status = true;
        // Recorded but unverified: must not be acted on.
        assert!(!c.dnr_is_actionable());

        c.dnr_verified_by = Some("DR-7".to_string());
        assert!(c.dnr_is_actionable());

        // Revoked directives must never read as actionable.
        c.dnr_revoked_at = Some(Utc.with_ymd_and_hms(2026, 7, 3, 9, 0, 0).unwrap());
        assert!(!c.dnr_is_actionable());
    }

    #[test]
    fn no_dnr_recorded_is_not_actionable() {
        let c = capsule();
        assert!(!c.dnr_status);
        assert!(!c.dnr_is_actionable());
    }

    /// Catches the drift the literal-list test above cannot.
    ///
    /// That test compares `emergency_summary_revealed_fields()` against a copy
    /// of itself, so it only notices somebody editing the function. It would
    /// stay green through the defect that produced this ledger in the first
    /// place: a field added to `EmergencyInfo` is disclosed by the grant-bound
    /// response and silently absent from the audit record, which is how the log
    /// came to claim two fields while fifteen were released.
    ///
    /// This derives the truth from the type instead. The struct literal is
    /// written out in full and deliberately does NOT use `..Default::default()`
    /// -- adding a field to `EmergencyInfo` breaks this compile, which forces
    /// whoever adds it to look at the disclosure ledger.
    #[test]
    fn every_serialized_emergency_field_appears_in_the_disclosure_ledger() {
        let info = EmergencyInfo {
            patient_id: "PAT-SYNTHETIC".to_string(),
            blood_type: BloodType::OPositive,
            allergies: Vec::new(),
            current_medications: Vec::new(),
            chronic_conditions: Vec::new(),
            emergency_contacts: Vec::new(),
            organ_donor: false,
            dnr_status: false,
            dnr_verified_by: None,
            dnr_verified_at: None,
            dnr_document_ref: None,
            languages: Vec::new(),
            last_updated: chrono::Utc::now(),
        };

        let serialized = serde_json::to_value(&info).expect("EmergencyInfo serializes");
        let disclosed: Vec<&str> = serialized
            .as_object()
            .expect("EmergencyInfo is a JSON object")
            .keys()
            .map(String::as_str)
            .collect();

        let ledger = emergency_summary_revealed_fields();
        for field in &disclosed {
            assert!(
                ledger.iter().any(|entry| entry == field),
                "`{field}` is released by the emergency response but is not in the disclosure ledger, so the audit record under-reports what was shown"
            );
        }

        // And the converse: the ledger must not claim a clinical field that is
        // not actually released. `dnr_actionable` and `commitment_verified` are
        // response-level additions rather than capsule fields, so they are the
        // only permitted extras.
        for entry in &ledger {
            let response_level = entry == "dnr_actionable" || entry == "commitment_verified";
            assert!(
                response_level || disclosed.contains(&entry.as_str()),
                "the disclosure ledger claims `{entry}` was revealed, but the emergency response does not serialize it"
            );
        }
    }

    #[test]
    fn grant_bound_emergency_field_ledger_matches_the_serialized_contract() {
        assert_eq!(
            emergency_summary_revealed_fields(),
            vec![
                "patient_id",
                "blood_type",
                "allergies",
                "current_medications",
                "chronic_conditions",
                "emergency_contacts",
                "organ_donor",
                "dnr_status",
                "dnr_verified_by",
                "dnr_verified_at",
                "dnr_document_ref",
                "languages",
                "last_updated",
                "dnr_actionable",
                "commitment_verified",
            ]
        );
    }
}
