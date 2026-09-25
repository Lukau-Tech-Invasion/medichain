//! What a patient search matches — one definition for both storage backends.
//!
//! The search used to match identifiers with `ILIKE '%query%'`, including the
//! keyed national-ID *hash* and the wallet address. Neither is text a person
//! types: a hex digest contains "ed", "ab" or "abebe" by chance, so searching a
//! short name returned unrelated patients alongside the right one — in the
//! picker a clinician uses to choose whose record to write into. The memory
//! backend matched something else again (substrings of the record and health
//! IDs), so the two backends disagreed about who a query found.
//!
//! A query now matches a patient when it is exactly one of their identifiers
//! (record ID or health ID, ignoring case; wallet address; or a national ID,
//! compared through its keyed hash), or when every name token in it is one of
//! the patient's name tokens (ADR-0009).

use super::traits::PatientEntity;

/// The derived forms of one search query.
#[derive(Debug, Clone)]
pub struct PatientSearchCriteria {
    /// The trimmed query, for exact identifier comparison.
    pub identifier: String,
    /// The keyed digest the query would have if it were a national ID.
    pub national_id_hash: String,
    /// Keyed name tokens; empty when the query has no alphanumeric word.
    pub name_tokens: Vec<String>,
}

impl PatientSearchCriteria {
    pub fn new(query: &str) -> Self {
        let identifier = query.trim().to_string();
        Self {
            national_id_hash: crate::support::hash_national_id(&identifier),
            name_tokens: crate::support::patient_name_search_tokens(&identifier),
            identifier,
        }
    }

    /// Whether an active patient is found by this query.
    pub fn matches(&self, patient: &PatientEntity) -> bool {
        patient.is_active
            && (patient.id.eq_ignore_ascii_case(&self.identifier)
                || patient.health_id.eq_ignore_ascii_case(&self.identifier)
                || patient.wallet_address.as_deref() == Some(self.identifier.as_str())
                || patient.national_id_hash == self.national_id_hash
                || self.matches_name(patient))
    }

    fn matches_name(&self, patient: &PatientEntity) -> bool {
        !self.name_tokens.is_empty()
            && self
                .name_tokens
                .iter()
                .all(|token| patient.name_search_tokens.contains(token))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patient(id: &str, name: &str) -> PatientEntity {
        let now = chrono::Utc::now();
        PatientEntity {
            id: id.to_string(),
            health_id: format!("HID-{id}"),
            national_id_hash: crate::support::hash_national_id(&format!("NID-{id}")),
            national_id_type: "FaydaID".to_string(),
            first_name_encrypted: None,
            last_name_encrypted: None,
            date_of_birth_encrypted: None,
            gender: None,
            blood_type: None,
            phone_encrypted: None,
            email_encrypted: None,
            address_encrypted: None,
            emergency_contact_name_encrypted: None,
            emergency_contact_phone_encrypted: None,
            emergency_contact_relationship: None,
            organ_donor: false,
            dnr_status: false,
            dnr_verified_by: None,
            dnr_verified_at: None,
            dnr_document_ref: None,
            primary_provider_id: None,
            wallet_address: Some(format!("5Wallet{id}")),
            created_at: now,
            updated_at: now,
            registered_by: None,
            is_verified: false,
            is_active: true,
            profile_extras_encrypted: None,
            name_search_tokens: crate::support::patient_name_search_tokens(name),
            key_version: 1,
        }
    }

    #[test]
    fn a_fragment_of_an_identifier_finds_nobody() {
        let ama = patient("PAT-001", "Ama Mensah");
        // Hex letters, so a substring match on the digest used to hit.
        let digest_fragment = &ama.national_id_hash[..4];

        for query in [digest_fragment, "Ed", "PAT-00", "HID", "5Wallet"] {
            assert!(
                !PatientSearchCriteria::new(query).matches(&ama),
                "{query:?} matched"
            );
        }
    }

    #[test]
    fn each_whole_identifier_and_the_name_find_the_patient() {
        let ama = patient("PAT-001", "Ama Mensah");

        for query in [
            "PAT-001",
            "pat-001",
            "HID-PAT-001",
            "5WalletPAT-001",
            "NID-PAT-001",
            "Ama",
            " ama  MENSAH ",
        ] {
            assert!(
                PatientSearchCriteria::new(query).matches(&ama),
                "{query:?} missed"
            );
        }
        assert!(!PatientSearchCriteria::new("Ama Owusu").matches(&ama));
    }

    #[test]
    fn an_inactive_patient_is_never_found() {
        let mut ama = patient("PAT-001", "Ama Mensah");
        ama.is_active = false;

        assert!(!PatientSearchCriteria::new("PAT-001").matches(&ama));
    }
}
