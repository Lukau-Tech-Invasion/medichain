//! POPIA lawful-processing grounds for consent and clinical data processing.
//!
//! # Why these exist
//!
//! `consent_records` originally recorded consent as a bare `consent_given: bool`
//! plus a free-text `regulatory_requirement` label that the live signing handler
//! never even populated. A POPIA legal review (2026-07-28, see
//! `docs/PRODUCTION_READINESS_GATES.md` §2) found that insufficient: consent is
//! only **one** of the lawful-processing grounds in POPIA §11, health data
//! additionally needs a special-information authorisation under §32, a minor's
//! data needs a children's-information ground under §35, and an emergency may
//! justify processing under the National Health Act **without** consent — which
//! must be recorded as its own justification rather than falsely logged as
//! consent.
//!
//! These are South-African legal mappings on purpose, not GDPR-style labels.
//!
//! Each enum follows this codebase's existing `as_str()`/`parse()` convention
//! (see `repositories::traits::GuardianPermission`) so the stored string form is
//! stable and explicit rather than derived from the Rust variant name.

use serde::{Deserialize, Serialize};

/// A lawful-processing ground under POPIA §11.
///
/// Consent is deliberately just one variant — treating it as the only ground is
/// the exact mistake the legal review flagged.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PopiaSection11Basis {
    /// §11(1)(a) — voluntary, specific and informed consent.
    Consent,
    /// §11(1)(b) — necessary to conclude or perform a contract with the subject.
    Contract,
    /// §11(1)(c) — compliance with an obligation imposed by law.
    LegalObligation,
    /// §11(1)(d) — protects a legitimate interest of the data subject.
    /// This is the ground an emergency typically relies on.
    DataSubjectLegitimateInterest,
    /// §11(1)(e) — necessary for a public-law duty by a public body.
    PublicLawDuty,
    /// §11(1)(f) — legitimate interests of the responsible party or a third party.
    ResponsiblePartyLegitimateInterest,
}

impl PopiaSection11Basis {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Consent => "consent",
            Self::Contract => "contract",
            Self::LegalObligation => "legal_obligation",
            Self::DataSubjectLegitimateInterest => "data_subject_legitimate_interest",
            Self::PublicLawDuty => "public_law_duty",
            Self::ResponsiblePartyLegitimateInterest => "responsible_party_legitimate_interest",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "consent" => Some(Self::Consent),
            "contract" => Some(Self::Contract),
            "legal_obligation" => Some(Self::LegalObligation),
            "data_subject_legitimate_interest" => Some(Self::DataSubjectLegitimateInterest),
            "public_law_duty" => Some(Self::PublicLawDuty),
            "responsible_party_legitimate_interest" => {
                Some(Self::ResponsiblePartyLegitimateInterest)
            }
            _ => None,
        }
    }
}

/// Authorisation for processing **special** personal information (health data).
///
/// POPIA §26 prohibits processing special personal information unless §27's
/// general exceptions or §32's health-specific authorisation applies. Health
/// records always need one of these in addition to a §11 ground — a §11 ground
/// alone is not enough for health data.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialInformationBasis {
    /// §32 — processing by a healthcare provider for proper treatment and care.
    /// The default for ordinary clinical work.
    S32Treatment,
    /// §32 — public-health purposes.
    S32PublicHealth,
    /// §27(1)(a) — the data subject consented to the special-information processing.
    Consent,
    /// §27(1)(d) — protection of a vital interest where consent cannot be obtained.
    VitalInterest,
    /// §27(1)(b) — establishment, exercise or defence of a right or legal obligation.
    LegalProceedings,
    /// Record holds no special personal information.
    NotApplicable,
}

impl SpecialInformationBasis {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::S32Treatment => "s32_treatment",
            Self::S32PublicHealth => "s32_public_health",
            Self::Consent => "consent",
            Self::VitalInterest => "vital_interest",
            Self::LegalProceedings => "legal_proceedings",
            Self::NotApplicable => "not_applicable",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "s32_treatment" => Some(Self::S32Treatment),
            "s32_public_health" => Some(Self::S32PublicHealth),
            "consent" => Some(Self::Consent),
            "vital_interest" => Some(Self::VitalInterest),
            "legal_proceedings" => Some(Self::LegalProceedings),
            "not_applicable" => Some(Self::NotApplicable),
            _ => None,
        }
    }
}

/// Authorisation for processing a child's personal information (POPIA §§34–35).
///
/// This layers **on top of** the health-data authorisation, it does not replace
/// it: a minor's clinical record needs both a `SpecialInformationBasis` and one
/// of these.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChildInformationBasis {
    /// §35(1)(a) — prior consent of a competent person (parent/guardian).
    S35CompetentPersonConsent,
    /// §35(1)(b) — necessary for the establishment/exercise/defence of a right.
    S35LegalObligation,
    /// §35(1)(c) — compliance with an international public-law obligation, or
    /// §35(1)(d) — research/statistical purposes in the public interest.
    S35PublicInterest,
    /// Children's Act §129 — a child of 12 or older with sufficient maturity
    /// consenting to their own medical treatment.
    ///
    /// Recorded as its own value rather than as `S35CompetentPersonConsent`
    /// because the latter asserts that a parent or guardian consented, which in
    /// this case is false. The legal review was explicit that these two must
    /// not be collapsed.
    ///
    /// **Needs counsel confirmation**: the Children's Act supplies the
    /// treatment-consent capacity, but the precise POPIA §35 ground for
    /// processing a mature child's information on their own consent is not
    /// settled here. Recorded distinctly so that question stays visible and
    /// answerable, rather than being buried under a wrong label.
    S129MatureChildSelfConsent,
    /// Data subject is not a child.
    NotApplicable,
}

impl ChildInformationBasis {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::S35CompetentPersonConsent => "s35_competent_person_consent",
            Self::S35LegalObligation => "s35_legal_obligation",
            Self::S35PublicInterest => "s35_public_interest",
            Self::S129MatureChildSelfConsent => "s129_mature_child_self_consent",
            Self::NotApplicable => "not_applicable",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "s35_competent_person_consent" => Some(Self::S35CompetentPersonConsent),
            "s35_legal_obligation" => Some(Self::S35LegalObligation),
            "s35_public_interest" => Some(Self::S35PublicInterest),
            "s129_mature_child_self_consent" => Some(Self::S129MatureChildSelfConsent),
            "not_applicable" => Some(Self::NotApplicable),
            _ => None,
        }
    }
}

/// Lifecycle state of a consent decision.
///
/// Replaces the bare `consent_given: bool`, which could not distinguish
/// "refused" from "withdrawn" from "never needed because another §11 ground
/// applies" — a distinction POPIA cares about and a boolean erases.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConsentStatus {
    Granted,
    Refused,
    Withdrawn,
    Expired,
    /// Processing proceeds on a non-consent §11 ground; no consent was sought.
    NotRequired,
}

impl ConsentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Granted => "granted",
            Self::Refused => "refused",
            Self::Withdrawn => "withdrawn",
            Self::Expired => "expired",
            Self::NotRequired => "not_required",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "granted" => Some(Self::Granted),
            "refused" => Some(Self::Refused),
            "withdrawn" => Some(Self::Withdrawn),
            "expired" => Some(Self::Expired),
            "not_required" => Some(Self::NotRequired),
            _ => None,
        }
    }

    /// Legacy `consent_given` boolean projection.
    ///
    /// The `consent_records.consent_given` column is retained for backwards
    /// compatibility but is strictly derived from this status — `ConsentStatus`
    /// is the authoritative field. Only `Granted` is affirmative.
    pub fn as_legacy_bool(&self) -> bool {
        matches!(self, Self::Granted)
    }
}

/// In what capacity the person giving consent acted.
///
/// Recorded separately from *who* they are, because "the patient's mother
/// signed" and "a court-appointed proxy signed" carry different legal weight
/// and different evidence requirements.
/// # Wire format
///
/// The two `rename` attributes below are load-bearing, not cosmetic.
/// `rename_all = "snake_case"` derives `self_capacity` and
/// `child_over12_mature`, which do **not** match what `as_str`/`parse` use
/// (`self`, `child_over_12_mature`) — and `as_str` is what gets written to
/// `consent_records.consent_giver_capacity`, what `parse` reads back, what
/// `ConsentRecordEntity::validate_lawful_basis` compares against, and what the
/// partial index in migration `20260729000005` keys on.
///
/// Without these renames a client had to send one spelling while every stored
/// and queried value used another. Found by exercising the endpoint with
/// synthetic data on 2026-07-29: requests were rejected by serde before the
/// Children's Act §129 checks ever ran, so those checks looked like they were
/// passing when they had simply never executed.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConsentGiverCapacity {
    /// The data subject themselves.
    #[serde(rename = "self")]
    SelfCapacity,
    /// A parent/guardian acting as POPIA §35 "competent person".
    Guardian,
    /// A competent person other than a parent (e.g. caregiver with authority).
    CompetentPerson,
    /// Children's Act §129: a child 12 or older with sufficient maturity
    /// consenting to their own medical treatment.
    #[serde(rename = "child_over_12_mature")]
    ChildOver12Mature,
    /// Court-appointed proxy or power of attorney for an adult.
    LegalProxy,
}

impl ConsentGiverCapacity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SelfCapacity => "self",
            Self::Guardian => "guardian",
            Self::CompetentPerson => "competent_person",
            Self::ChildOver12Mature => "child_over_12_mature",
            Self::LegalProxy => "legal_proxy",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "self" => Some(Self::SelfCapacity),
            "guardian" => Some(Self::Guardian),
            "competent_person" => Some(Self::CompetentPerson),
            "child_over_12_mature" => Some(Self::ChildOver12Mature),
            "legal_proxy" => Some(Self::LegalProxy),
            _ => None,
        }
    }

    /// Whether acting in this capacity requires recorded legal-authority
    /// evidence (a guardian relationship id) to be present.
    ///
    /// `SelfCapacity` and `ChildOver12Mature` are the data subject acting for
    /// themselves, so there is no third-party authority to evidence.
    pub fn requires_authority_evidence(&self) -> bool {
        matches!(
            self,
            Self::Guardian | Self::CompetentPerson | Self::LegalProxy
        )
    }
}

/// Emergency justification for processing without ordinary informed consent.
///
/// The National Health Act permits treatment without ordinary informed consent
/// in defined situations (serious public-health risk, or where delay would risk
/// death or irreversible harm and the patient has not refused). The review was
/// explicit that such an event must be recorded as its **own** justification and
/// never mislabelled as consent.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmergencyBasis {
    /// National Health Act emergency treatment ground.
    NhaEmergency,
    /// Protection of a vital interest where consent cannot be obtained.
    VitalInterest,
    /// Not an emergency — ordinary consent/lawful-basis rules applied.
    None,
}

impl EmergencyBasis {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NhaEmergency => "nha_emergency",
            Self::VitalInterest => "vital_interest",
            Self::None => "none",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "nha_emergency" => Some(Self::NhaEmergency),
            "vital_interest" => Some(Self::VitalInterest),
            "none" => Some(Self::None),
            _ => None,
        }
    }

    /// Whether a free-text justification must accompany this basis.
    /// An emergency override with no recorded reason is unauditable.
    pub fn requires_justification(&self) -> bool {
        !matches!(self, Self::None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every variant must survive a string round-trip, or stored rows become
    /// unreadable after a restart.
    #[test]
    fn all_bases_round_trip_through_strings() {
        for basis in [
            PopiaSection11Basis::Consent,
            PopiaSection11Basis::Contract,
            PopiaSection11Basis::LegalObligation,
            PopiaSection11Basis::DataSubjectLegitimateInterest,
            PopiaSection11Basis::PublicLawDuty,
            PopiaSection11Basis::ResponsiblePartyLegitimateInterest,
        ] {
            assert_eq!(PopiaSection11Basis::parse(basis.as_str()), Some(basis));
        }

        for basis in [
            SpecialInformationBasis::S32Treatment,
            SpecialInformationBasis::S32PublicHealth,
            SpecialInformationBasis::Consent,
            SpecialInformationBasis::VitalInterest,
            SpecialInformationBasis::LegalProceedings,
            SpecialInformationBasis::NotApplicable,
        ] {
            assert_eq!(SpecialInformationBasis::parse(basis.as_str()), Some(basis));
        }

        for basis in [
            ChildInformationBasis::S35CompetentPersonConsent,
            ChildInformationBasis::S35LegalObligation,
            ChildInformationBasis::S35PublicInterest,
            ChildInformationBasis::S129MatureChildSelfConsent,
            ChildInformationBasis::NotApplicable,
        ] {
            assert_eq!(ChildInformationBasis::parse(basis.as_str()), Some(basis));
        }

        // A mature child's own consent must never be storable as, or parse
        // back into, competent-person consent: the whole point of the separate
        // value is that "the child consented" and "a guardian consented" are
        // different legal facts.
        assert_ne!(
            ChildInformationBasis::S129MatureChildSelfConsent.as_str(),
            ChildInformationBasis::S35CompetentPersonConsent.as_str()
        );
    }

    /// The JSON spelling a client sends must equal the string that gets stored
    /// and queried.
    ///
    /// These drifted apart for `ConsentGiverCapacity`: serde's derived
    /// `snake_case` produced `self_capacity`/`child_over12_mature` while
    /// `as_str`/`parse`, the entity validation, and a partial index all used
    /// `self`/`child_over_12_mature`. Requests were rejected by serde before
    /// the Children's Act §129 checks ran — the checks appeared to pass
    /// because they never executed. Unit tests could not see it: they call
    /// `as_str`/`parse` directly and never cross the JSON boundary.
    ///
    /// Asserted for every variant of every lawful-basis enum, so adding a
    /// variant with a mismatched wire name fails here rather than in
    /// production.
    #[test]
    fn json_spelling_matches_stored_spelling() {
        fn round_trip<T>(value: T, expected: &str)
        where
            T: serde::Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug + Copy,
        {
            let json = serde_json::to_string(&value).expect("serialises");
            let wire = json.trim_matches('"');
            assert_eq!(
                wire, expected,
                "JSON spelling {:?} does not match stored spelling {:?} for {:?}",
                wire, expected, value
            );
            // And the wire form must deserialise back to the same variant.
            let back: T = serde_json::from_str(&json).expect("round-trips");
            assert_eq!(back, value);
        }

        for v in [
            PopiaSection11Basis::Consent,
            PopiaSection11Basis::Contract,
            PopiaSection11Basis::LegalObligation,
            PopiaSection11Basis::DataSubjectLegitimateInterest,
            PopiaSection11Basis::PublicLawDuty,
            PopiaSection11Basis::ResponsiblePartyLegitimateInterest,
        ] {
            round_trip(v, v.as_str());
        }

        for v in [
            SpecialInformationBasis::S32Treatment,
            SpecialInformationBasis::S32PublicHealth,
            SpecialInformationBasis::Consent,
            SpecialInformationBasis::VitalInterest,
            SpecialInformationBasis::LegalProceedings,
            SpecialInformationBasis::NotApplicable,
        ] {
            round_trip(v, v.as_str());
        }

        for v in [
            ChildInformationBasis::S35CompetentPersonConsent,
            ChildInformationBasis::S35LegalObligation,
            ChildInformationBasis::S35PublicInterest,
            ChildInformationBasis::S129MatureChildSelfConsent,
            ChildInformationBasis::NotApplicable,
        ] {
            round_trip(v, v.as_str());
        }

        for v in [
            ConsentGiverCapacity::SelfCapacity,
            ConsentGiverCapacity::Guardian,
            ConsentGiverCapacity::CompetentPerson,
            ConsentGiverCapacity::ChildOver12Mature,
            ConsentGiverCapacity::LegalProxy,
        ] {
            round_trip(v, v.as_str());
        }

        for v in [
            EmergencyBasis::None,
            EmergencyBasis::NhaEmergency,
            EmergencyBasis::VitalInterest,
        ] {
            round_trip(v, v.as_str());
        }

        for status in [
            ConsentStatus::Granted,
            ConsentStatus::Refused,
            ConsentStatus::Withdrawn,
            ConsentStatus::Expired,
            ConsentStatus::NotRequired,
        ] {
            assert_eq!(ConsentStatus::parse(status.as_str()), Some(status));
        }

        for capacity in [
            ConsentGiverCapacity::SelfCapacity,
            ConsentGiverCapacity::Guardian,
            ConsentGiverCapacity::CompetentPerson,
            ConsentGiverCapacity::ChildOver12Mature,
            ConsentGiverCapacity::LegalProxy,
        ] {
            assert_eq!(
                ConsentGiverCapacity::parse(capacity.as_str()),
                Some(capacity)
            );
        }

        for basis in [
            EmergencyBasis::NhaEmergency,
            EmergencyBasis::VitalInterest,
            EmergencyBasis::None,
        ] {
            assert_eq!(EmergencyBasis::parse(basis.as_str()), Some(basis));
        }
    }

    #[test]
    fn unknown_strings_do_not_silently_parse() {
        assert_eq!(PopiaSection11Basis::parse("legitimate_interest"), None);
        assert_eq!(SpecialInformationBasis::parse("treatment"), None);
        assert_eq!(ConsentStatus::parse("true"), None);
        assert_eq!(ConsentGiverCapacity::parse("parent"), None);
        assert_eq!(EmergencyBasis::parse(""), None);
    }

    /// Only an affirmative grant maps to the legacy `true` — a withdrawal or
    /// refusal must never read back as consent given.
    #[test]
    fn only_granted_projects_to_legacy_true() {
        assert!(ConsentStatus::Granted.as_legacy_bool());
        assert!(!ConsentStatus::Refused.as_legacy_bool());
        assert!(!ConsentStatus::Withdrawn.as_legacy_bool());
        assert!(!ConsentStatus::Expired.as_legacy_bool());
        assert!(!ConsentStatus::NotRequired.as_legacy_bool());
    }

    #[test]
    fn third_party_capacities_require_authority_evidence() {
        assert!(ConsentGiverCapacity::Guardian.requires_authority_evidence());
        assert!(ConsentGiverCapacity::CompetentPerson.requires_authority_evidence());
        assert!(ConsentGiverCapacity::LegalProxy.requires_authority_evidence());
        // The data subject acting for themselves has no third-party authority.
        assert!(!ConsentGiverCapacity::SelfCapacity.requires_authority_evidence());
        assert!(!ConsentGiverCapacity::ChildOver12Mature.requires_authority_evidence());
    }

    #[test]
    fn emergency_bases_require_justification_but_none_does_not() {
        assert!(EmergencyBasis::NhaEmergency.requires_justification());
        assert!(EmergencyBasis::VitalInterest.requires_justification());
        assert!(!EmergencyBasis::None.requires_justification());
    }
}
