//! Guardian relationships.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::RepositoryResult;

// =============================================================================
// Guardian relationships — persistent, permission-granular. Supersedes the
// Horizon HZ-008 in-memory `guardian_relationships::GuardianRegistry`: a
// parent/guardian relationship must survive restarts and can span years
// (divorce, adoption, foster care), so it cannot live only in a
// process-lifetime RwLock, and a single "is guardian" boolean can't express
// "may view records but may not sign consent."
// =============================================================================

/// The kind of relationship a guardian has to the ward.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GuardianRelationshipType {
    /// Parent or legal guardian of a minor.
    ParentOrGuardian,
    /// Court-appointed or documented proxy for an incapacitated adult, or a
    /// foster carer (use `expires_at` for a time-limited foster placement).
    LegalProxy,
    /// Appointed power of attorney for healthcare decisions.
    PowerOfAttorney,
}

impl GuardianRelationshipType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ParentOrGuardian => "parent_or_guardian",
            Self::LegalProxy => "legal_proxy",
            Self::PowerOfAttorney => "power_of_attorney",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "parent_or_guardian" => Some(Self::ParentOrGuardian),
            "legal_proxy" => Some(Self::LegalProxy),
            "power_of_attorney" => Some(Self::PowerOfAttorney),
            _ => None,
        }
    }
}

/// A granular capability a guardian may exercise on behalf of a ward.
/// Replaces the HZ-008 boolean "is an active guardian" check with an
/// explicit, auditable grant per capability.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GuardianPermission {
    ViewRecords,
    BookAppointments,
    /// DEPRECATED — consenting to *treatment* and consenting to *data
    /// processing* are distinct decisions under South African law (Children's
    /// Act §129 vs POPIA §35) and the 2026-07-28 legal review was explicit that
    /// they must not collapse into one flag. Retained so existing stored grants
    /// keep working: it satisfies both successors (see `satisfied_by`).
    /// New grants should use `ConsentToTreatment` / `ConsentToDataProcessing`.
    GiveConsent,
    /// Consent to medical treatment on the ward's behalf.
    ConsentToTreatment,
    /// Consent to processing of the ward's personal information.
    ConsentToDataProcessing,
    UploadVaccinations,
    DownloadReports,
    ApproveSurgery,
}

impl GuardianPermission {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ViewRecords => "view_records",
            Self::BookAppointments => "book_appointments",
            Self::GiveConsent => "give_consent",
            Self::ConsentToTreatment => "consent_to_treatment",
            Self::ConsentToDataProcessing => "consent_to_data_processing",
            Self::UploadVaccinations => "upload_vaccinations",
            Self::DownloadReports => "download_reports",
            Self::ApproveSurgery => "approve_surgery",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "view_records" => Some(Self::ViewRecords),
            "book_appointments" => Some(Self::BookAppointments),
            "give_consent" => Some(Self::GiveConsent),
            "consent_to_treatment" => Some(Self::ConsentToTreatment),
            "consent_to_data_processing" => Some(Self::ConsentToDataProcessing),
            "upload_vaccinations" => Some(Self::UploadVaccinations),
            "download_reports" => Some(Self::DownloadReports),
            "approve_surgery" => Some(Self::ApproveSurgery),
            _ => None,
        }
    }

    /// Whether a stored grant of `granted` satisfies a request for `self`.
    ///
    /// Normally exact equality. The exception is the deprecated blanket
    /// `give_consent`, which satisfies both of its successors so relationships
    /// created before the split keep functioning. The reverse does NOT hold:
    /// holding only `consent_to_treatment` must not satisfy a request for
    /// `consent_to_data_processing`, which is the whole point of splitting them.
    pub fn satisfied_by(&self, granted: &str) -> bool {
        if granted == self.as_str() {
            return true;
        }
        granted == Self::GiveConsent.as_str()
            && matches!(
                self,
                Self::ConsentToTreatment | Self::ConsentToDataProcessing
            )
    }
}

/// The kind of document establishing a guardian's legal authority.
///
/// Recording *that* an Admin verified a relationship is not the same as
/// recording *what they saw*. Without this, "verified" is an unfalsifiable
/// assertion — see `docs/PRODUCTION_READINESS_GATES.md` §3.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GuardianAuthorityEvidence {
    BirthCertificate,
    CourtOrder,
    AdoptionOrder,
    PowerOfAttorneyDocument,
    FosterPlacementOrder,
    Affidavit,
    Other,
}

impl GuardianAuthorityEvidence {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::BirthCertificate => "birth_certificate",
            Self::CourtOrder => "court_order",
            Self::AdoptionOrder => "adoption_order",
            Self::PowerOfAttorneyDocument => "power_of_attorney_document",
            Self::FosterPlacementOrder => "foster_placement_order",
            Self::Affidavit => "affidavit",
            Self::Other => "other",
        }
    }
}

/// Whether the ward participated in the decision, per the Children's Act.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChildAssentStatus {
    /// Ward is an adult.
    NotApplicable,
    /// Should have been sought and wasn't. A deliberate value rather than
    /// leaving the field null, so the omission is visible instead of ambiguous.
    NotSought,
    Given,
    /// Recorded even where a guardian may still lawfully consent — a child's
    /// refusal is legally and ethically relevant even when not decisive.
    Refused,
    /// Too young, or clinically unable to participate.
    Unable,
}

impl ChildAssentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NotApplicable => "not_applicable",
            Self::NotSought => "not_sought",
            Self::Given => "given",
            Self::Refused => "refused",
            Self::Unable => "unable",
        }
    }
}

/// A guardian's relationship to a ward patient, persisted.
///
/// Creation requires Admin verification (mirrors `assign_role`'s Admin-only,
/// can't-self-grant pattern) — a guardian relationship is asserted by an
/// operator with real authority to verify it (e.g. having reviewed
/// guardianship documentation), never self-declared by the guardian.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct GuardianRelationshipEntity {
    pub id: String,
    pub guardian_user_id: String,
    pub ward_patient_id: String,
    /// `GuardianRelationshipType::as_str()` value.
    pub relationship_type: String,
    /// `GuardianPermission::as_str()` values.
    pub permissions: Vec<String>,
    pub verified_by: String,
    pub verified_at: DateTime<Utc>,
    pub active: bool,
    /// Time-limited grants (e.g. foster care) expire on their own without
    /// needing an explicit revoke.
    pub expires_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub revoked_reason: Option<String>,

    // --- Legal-authority evidence (migration 20260729000002) ---
    // Admin verification alone does not establish that a person is *legally*
    // authorised rather than merely an adult relative — see
    // `docs/PRODUCTION_READINESS_GATES.md` §3.
    /// `GuardianAuthorityEvidence::as_str()` value.
    pub authority_evidence_type: Option<String>,
    /// Pointer (record id / IPFS hash) to the document — never its contents.
    pub authority_evidence_reference: Option<String>,
    pub authority_issuing_authority: Option<String>,
    /// Role/title of the verifier; `verified_by` is only a user id.
    pub authority_verified_by_role: Option<String>,
    pub authority_evidence_recorded_at: Option<DateTime<Utc>>,
    /// Periodic review date. Distinct from `expires_at` — an indefinite
    /// relationship still needs re-verification.
    pub next_reverification_due: Option<DateTime<Utc>>,

    // --- Child participation (Children's Act) ---
    /// `ChildAssentStatus::as_str()` value.
    pub child_assent_status: Option<String>,
    pub child_assent_recorded_at: Option<DateTime<Utc>>,
    pub child_assent_notes: Option<String>,

    // --- Guardianship changes and disputes ---
    /// The relationship this one replaces (custody transfer chain).
    pub supersedes_relationship_id: Option<String>,
    /// Flagged for human review. Deliberately does not by itself revoke access:
    /// unilaterally cutting a disputed guardian off could itself cause harm.
    pub dispute_flag: bool,
    pub dispute_notes: Option<String>,
}

impl GuardianRelationshipEntity {
    /// Whether this relationship currently grants `permission` — active, not
    /// revoked, and (if time-limited) not yet expired.
    ///
    /// Permission matching goes through `GuardianPermission::satisfied_by` so a
    /// relationship holding the deprecated blanket `give_consent` still
    /// satisfies the treatment/data-processing successors that replaced it.
    pub fn grants(&self, permission: GuardianPermission, now: DateTime<Utc>) -> bool {
        self.active
            && self.expires_at.map(|expires| expires > now).unwrap_or(true)
            && self
                .permissions
                .iter()
                .any(|p| permission.satisfied_by(p.as_str()))
    }
}

/// Guardian relationship repository trait.
#[async_trait]
pub trait GuardianRelationshipRepository: Send + Sync + fmt::Debug {
    /// Record a new verified relationship.
    async fn create(
        &self,
        relationship: GuardianRelationshipEntity,
    ) -> RepositoryResult<GuardianRelationshipEntity>;

    /// Create delegated authority and persist its mandatory audit event in one
    /// production transaction.
    async fn create_with_audit(
        &self,
        relationship: GuardianRelationshipEntity,
        event: crate::audit_outbox::AuditEvent,
    ) -> RepositoryResult<GuardianRelationshipEntity>;

    /// All relationships (active or not) naming this ward — used to build
    /// "who may act for this patient" views (emergency contact surfacing,
    /// admin review).
    async fn get_by_ward(
        &self,
        ward_patient_id: &str,
    ) -> RepositoryResult<Vec<GuardianRelationshipEntity>>;

    /// All relationships naming this guardian — drives the "my children" /
    /// profile-switcher list.
    async fn get_by_guardian(
        &self,
        guardian_user_id: &str,
    ) -> RepositoryResult<Vec<GuardianRelationshipEntity>>;

    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<GuardianRelationshipEntity>>;

    /// Adjust an existing relationship's permission set and/or expiry
    /// in-place, without revoking and re-verifying it.
    async fn update_permissions(
        &self,
        id: &str,
        permissions: Vec<String>,
        expires_at: Option<DateTime<Utc>>,
    ) -> RepositoryResult<GuardianRelationshipEntity>;

    /// Update delegated permissions and persist the mandatory audit event in
    /// one production transaction.
    async fn update_permissions_with_audit(
        &self,
        id: &str,
        permissions: Vec<String>,
        expires_at: Option<DateTime<Utc>>,
        event: crate::audit_outbox::AuditEvent,
    ) -> RepositoryResult<GuardianRelationshipEntity>;

    /// Revoke a previously verified relationship (e.g. the ward reaches
    /// majority, guardianship is legally terminated, or the assertion was
    /// made in error).
    async fn revoke(&self, id: &str, reason: Option<String>) -> RepositoryResult<()>;

    /// Revoke delegated authority and persist its required audit event as one
    /// production transaction.
    async fn revoke_with_audit(
        &self,
        id: &str,
        reason: Option<String>,
        event: crate::audit_outbox::AuditEvent,
    ) -> RepositoryResult<()>;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A relationship created before consent was split into treatment vs.
    /// data-processing must keep working — otherwise this change silently
    /// revokes every existing guardian's ability to consent.
    #[test]
    fn deprecated_give_consent_satisfies_both_successor_permissions() {
        let granted = GuardianPermission::GiveConsent.as_str();
        assert!(GuardianPermission::ConsentToTreatment.satisfied_by(granted));
        assert!(GuardianPermission::ConsentToDataProcessing.satisfied_by(granted));
    }

    /// The reverse must NOT hold: a guardian granted only treatment consent
    /// must not thereby be able to consent to data processing. Collapsing these
    /// back together would undo the whole point of splitting them.
    #[test]
    fn narrow_consent_permissions_do_not_satisfy_each_other() {
        assert!(!GuardianPermission::ConsentToDataProcessing
            .satisfied_by(GuardianPermission::ConsentToTreatment.as_str()));
        assert!(!GuardianPermission::ConsentToTreatment
            .satisfied_by(GuardianPermission::ConsentToDataProcessing.as_str()));
    }

    /// The blanket grant must not widen anything beyond consent.
    #[test]
    fn give_consent_does_not_satisfy_unrelated_permissions() {
        let granted = GuardianPermission::GiveConsent.as_str();
        assert!(!GuardianPermission::ViewRecords.satisfied_by(granted));
        assert!(!GuardianPermission::ApproveSurgery.satisfied_by(granted));
    }

    #[test]
    fn grants_honours_the_deprecated_permission_through_the_entity() {
        let relationship = GuardianRelationshipEntity {
            id: "GR-1".into(),
            guardian_user_id: "guardian".into(),
            ward_patient_id: "ward".into(),
            relationship_type: GuardianRelationshipType::ParentOrGuardian
                .as_str()
                .to_string(),
            permissions: vec![GuardianPermission::GiveConsent.as_str().to_string()],
            verified_by: "admin".into(),
            verified_at: Utc::now(),
            active: true,
            expires_at: None,
            revoked_at: None,
            revoked_reason: None,
            authority_evidence_type: None,
            authority_evidence_reference: None,
            authority_issuing_authority: None,
            authority_verified_by_role: None,
            authority_evidence_recorded_at: None,
            next_reverification_due: None,
            child_assent_status: None,
            child_assent_recorded_at: None,
            child_assent_notes: None,
            supersedes_relationship_id: None,
            dispute_flag: false,
            dispute_notes: None,
        };

        let now = Utc::now();
        assert!(relationship.grants(GuardianPermission::ConsentToDataProcessing, now));
        assert!(relationship.grants(GuardianPermission::ConsentToTreatment, now));
        assert!(!relationship.grants(GuardianPermission::ViewRecords, now));
    }
}
