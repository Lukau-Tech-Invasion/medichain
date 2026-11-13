//! Consent records.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::common::RepositoryResult;

/// Consent record entity
///
/// # Lawful-basis fields
///
/// The `popia_*`/`consent_status`/`emergency_*` fields were added after a POPIA
/// legal review (2026-07-28) found `consent_given: bool` legally insufficient —
/// see `crate::types::legal_basis` for what each ground means and
/// `docs/PRODUCTION_READINESS_GATES.md` §2 for the review itself. Store the
/// `as_str()` form of the corresponding enum, never a free-text string.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ConsentRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub consent_type: String,
    /// DEPRECATED — retained for backwards compatibility only. Derived from
    /// `consent_status` via `ConsentStatus::as_legacy_bool()`; a bare boolean
    /// cannot distinguish "refused" from "withdrawn" from "not required
    /// because another §11 ground applies". Read `consent_status` instead.
    pub consent_given: bool,
    pub consent_datetime: chrono::DateTime<chrono::Utc>,
    pub expiration_datetime: Option<chrono::DateTime<chrono::Utc>>,
    pub scope_description: Option<String>,
    pub data_types_covered: Option<serde_json::Value>,
    pub purpose: Option<String>,
    pub recipient_organization: Option<String>,
    pub collection_method: Option<String>,
    pub witness_name: Option<String>,
    pub witness_signature: Option<String>,
    pub collector_id: Option<String>,
    pub collector_name: Option<String>,
    pub revoked: Option<bool>,
    pub revoked_datetime: Option<chrono::DateTime<chrono::Utc>>,
    pub revocation_reason: Option<String>,
    pub revoked_by: Option<String>,
    pub document_url: Option<String>,
    pub document_ipfs_hash: Option<String>,
    pub regulatory_requirement: Option<String>,
    pub version: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,

    // --- POPIA lawful-basis provenance (migration 20260729000001) ---
    /// `PopiaSection11Basis::as_str()` — the lawful-processing ground.
    pub popia_section_11_basis: String,
    /// `SpecialInformationBasis::as_str()` — §27/§32 health-data authorisation.
    pub special_information_basis: String,
    /// `ChildInformationBasis::as_str()` — §34/§35 ground, or `not_applicable`.
    pub child_information_basis: String,
    /// False when processing relies on a non-consent §11 ground.
    pub consent_required: bool,
    /// `ConsentStatus::as_str()` — authoritative lifecycle state.
    pub consent_status: String,
    /// Who actually gave consent; may differ from `patient_id`.
    pub consent_given_by: Option<String>,
    /// `ConsentGiverCapacity::as_str()`.
    pub consent_giver_capacity: Option<String>,
    /// `guardian_relationships.id` evidencing a third party's authority to
    /// consent. Required when the capacity is guardian/competent_person/
    /// legal_proxy.
    pub guardian_authority_evidence_id: Option<String>,
    /// Which privacy-notice version the data subject was shown.
    pub privacy_notice_version: Option<String>,
    /// `EmergencyBasis::as_str()` — National Health Act emergency ground.
    pub emergency_basis: String,
    /// Required whenever `emergency_basis` is not `none`.
    pub emergency_justification: Option<String>,
    /// The clinician's finding that a child of 12+ has sufficient maturity to
    /// consent to their own treatment (Children's Act §129). Required whenever
    /// `consent_giver_capacity` is `child_over_12_mature` — age alone does not
    /// establish the capacity.
    #[serde(default)]
    pub child_maturity_assessment: Option<String>,
    /// Who made the maturity finding.
    #[serde(default)]
    pub child_maturity_assessed_by: Option<String>,
}

impl ConsentRecordEntity {
    /// Parse the stored lawful-basis strings back into their enums, listing any
    /// that are not recognised.
    ///
    /// Stored values are plain strings, so a hand-edited row, a partially
    /// applied migration, or a future code version writing an unknown variant
    /// would otherwise flow through the API as an opaque string that reads like
    /// a valid legal basis. Surfacing the mismatch turns a silent data-integrity
    /// problem into a visible one.
    pub fn validate_lawful_basis(&self) -> Result<(), Vec<String>> {
        use crate::types::{
            ChildInformationBasis, ConsentStatus, EmergencyBasis, PopiaSection11Basis,
            SpecialInformationBasis,
        };

        let mut problems = Vec::new();

        if PopiaSection11Basis::parse(&self.popia_section_11_basis).is_none() {
            problems.push(format!(
                "unrecognised popia_section_11_basis '{}'",
                self.popia_section_11_basis
            ));
        }
        if SpecialInformationBasis::parse(&self.special_information_basis).is_none() {
            problems.push(format!(
                "unrecognised special_information_basis '{}'",
                self.special_information_basis
            ));
        }
        if ChildInformationBasis::parse(&self.child_information_basis).is_none() {
            problems.push(format!(
                "unrecognised child_information_basis '{}'",
                self.child_information_basis
            ));
        }
        if ConsentStatus::parse(&self.consent_status).is_none() {
            problems.push(format!(
                "unrecognised consent_status '{}'",
                self.consent_status
            ));
        }
        if EmergencyBasis::parse(&self.emergency_basis).is_none() {
            problems.push(format!(
                "unrecognised emergency_basis '{}'",
                self.emergency_basis
            ));
        }
        if let Some(capacity) = &self.consent_giver_capacity {
            if crate::types::ConsentGiverCapacity::parse(capacity).is_none() {
                problems.push(format!(
                    "unrecognised consent_giver_capacity '{}'",
                    capacity
                ));
            }
        }

        // An emergency basis with no justification is unauditable — the same
        // rule the write path enforces, checked again on read so rows that
        // predate that enforcement are visible.
        if let Some(basis) = EmergencyBasis::parse(&self.emergency_basis) {
            if basis.requires_justification()
                && self
                    .emergency_justification
                    .as_ref()
                    .map(|j| j.trim().is_empty())
                    .unwrap_or(true)
            {
                problems.push(format!(
                    "emergency_basis '{}' recorded without a justification",
                    self.emergency_basis
                ));
            }
        }

        // Children's Act §129 capacity rests on a maturity finding, not on age
        // alone. Checked on read as well as write for the same reason as the
        // emergency justification above: rows written before this rule existed
        // should surface rather than pass silently.
        if self.consent_giver_capacity.as_deref() == Some("child_over_12_mature")
            && self
                .child_maturity_assessment
                .as_ref()
                .map(|a| a.trim().is_empty())
                .unwrap_or(true)
        {
            problems.push(
                "consent_giver_capacity 'child_over_12_mature' recorded without a \
                 maturity assessment"
                    .to_string(),
            );
        }

        if problems.is_empty() {
            Ok(())
        } else {
            Err(problems)
        }
    }
}

/// Hand-written rather than derived: the lawful-basis fields hold the `as_str()`
/// form of a closed enum, and a derived `Default` would fill them with `""`,
/// which parses back as `None` and would silently produce a consent record with
/// no readable lawful basis. Defaults here are the ordinary-clinical-care case.
impl Default for ConsentRecordEntity {
    fn default() -> Self {
        Self {
            id: String::new(),
            patient_id: String::new(),
            consent_type: String::new(),
            consent_given: false,
            consent_datetime: chrono::Utc::now(),
            expiration_datetime: None,
            scope_description: None,
            data_types_covered: None,
            purpose: None,
            recipient_organization: None,
            collection_method: None,
            witness_name: None,
            witness_signature: None,
            collector_id: None,
            collector_name: None,
            revoked: Some(false),
            revoked_datetime: None,
            revocation_reason: None,
            revoked_by: None,
            document_url: None,
            document_ipfs_hash: None,
            regulatory_requirement: None,
            version: None,
            created_at: None,
            updated_at: None,
            popia_section_11_basis: crate::types::PopiaSection11Basis::Consent
                .as_str()
                .to_string(),
            special_information_basis: crate::types::SpecialInformationBasis::S32Treatment
                .as_str()
                .to_string(),
            child_information_basis: crate::types::ChildInformationBasis::NotApplicable
                .as_str()
                .to_string(),
            consent_required: true,
            // `consent_given` defaults to false, so the status must agree.
            consent_status: crate::types::ConsentStatus::Refused.as_str().to_string(),
            consent_given_by: None,
            consent_giver_capacity: None,
            guardian_authority_evidence_id: None,
            privacy_notice_version: None,
            emergency_basis: crate::types::EmergencyBasis::None.as_str().to_string(),
            emergency_justification: None,
            child_maturity_assessment: None,
            child_maturity_assessed_by: None,
        }
    }
}

/// Consent record repository trait
#[async_trait]
pub trait ConsentRecordRepository: Send + Sync {
    async fn create(&self, consent: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ConsentRecordEntity>;
    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<ConsentRecordEntity>>;
    async fn update(&self, consent: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity>;
    async fn revoke(
        &self,
        id: &str,
        revoked_by: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<ConsentRecordEntity>;
    async fn get_expiring_soon(&self, days: i32) -> RepositoryResult<Vec<ConsentRecordEntity>>;

    /// Get active consent by type
    async fn get_active_by_type(
        &self,
        patient_id: &str,
        consent_type: &str,
    ) -> RepositoryResult<Option<ConsentRecordEntity>>;

    /// Get all active consents for a patient
    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<ConsentRecordEntity>>;

    /// Get all active consents for a patient (alias)
    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        // Default delegates to get_active
        self.get_active(patient_id).await
    }

    /// Get consents by type for a patient
    async fn get_by_type(
        &self,
        patient_id: &str,
        consent_type: &str,
    ) -> RepositoryResult<Vec<ConsentRecordEntity>>;

    /// Check if patient has active consent of specified type and purpose
    async fn check_consent(
        &self,
        patient_id: &str,
        consent_type: &str,
        purpose: &str,
    ) -> RepositoryResult<bool>;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A consent record with a valid basis set passes; garbage is reported
    /// rather than passed through as if it were a real legal basis.
    #[test]
    fn lawful_basis_validation_accepts_valid_and_reports_invalid() {
        let valid = ConsentRecordEntity {
            id: "C-1".into(),
            consent_status: crate::types::ConsentStatus::Granted.as_str().to_string(),
            consent_given: true,
            ..Default::default()
        };
        assert!(valid.validate_lawful_basis().is_ok());

        let invalid = ConsentRecordEntity {
            id: "C-2".into(),
            popia_section_11_basis: "vibes".into(),
            ..Default::default()
        };
        let problems = invalid.validate_lawful_basis().unwrap_err();
        assert!(problems
            .iter()
            .any(|p| p.contains("popia_section_11_basis")));
    }

    /// An emergency basis without a justification is unauditable and must be
    /// reported even on rows written before that rule was enforced.
    #[test]
    fn emergency_basis_without_justification_is_reported() {
        let record = ConsentRecordEntity {
            id: "C-3".into(),
            emergency_basis: crate::types::EmergencyBasis::NhaEmergency
                .as_str()
                .to_string(),
            emergency_justification: None,
            ..Default::default()
        };
        let problems = record.validate_lawful_basis().unwrap_err();
        assert!(problems
            .iter()
            .any(|p| p.contains("without a justification")));
    }

    /// Children's Act §129 capacity depends on a maturity finding. A row
    /// claiming mature-minor capacity without one is not a valid record, and
    /// must be visible as such even if it was written before the write path
    /// enforced it.
    #[test]
    fn mature_child_capacity_without_assessment_is_rejected() {
        let record = ConsentRecordEntity {
            id: "C-4".into(),
            consent_giver_capacity: Some("child_over_12_mature".into()),
            child_maturity_assessment: None,
            ..Default::default()
        };

        let problems = record.validate_lawful_basis().unwrap_err();
        assert!(problems
            .iter()
            .any(|p| p.contains("without a maturity assessment")));
    }

    #[test]
    fn mature_child_capacity_with_assessment_is_accepted() {
        let record = ConsentRecordEntity {
            id: "C-5".into(),
            consent_giver_capacity: Some("child_over_12_mature".into()),
            child_maturity_assessment: Some(
                "14y, understands the procedure, risks and alternatives".into(),
            ),
            ..Default::default()
        };

        assert!(record.validate_lawful_basis().is_ok());
    }

    /// Whitespace is not an assessment. Without this the required-field check
    /// is trivially satisfied by a space.
    #[test]
    fn blank_maturity_assessment_does_not_satisfy_the_requirement() {
        let record = ConsentRecordEntity {
            id: "C-6".into(),
            consent_giver_capacity: Some("child_over_12_mature".into()),
            child_maturity_assessment: Some("   ".into()),
            ..Default::default()
        };

        assert!(record.validate_lawful_basis().is_err());
    }
}
