//! Who may open a patient's chart (WP9), and the care relationships that
//! decide it for clinicians.
//!
//! The rule, in order: the patient themselves; their guardian (or an
//! administrator, as before); a clinician the patient granted access to; a
//! clinician in an active care relationship with the patient; or a clinician
//! who broke the glass (reason required, time-limited, patient told at once).
//! Holding a clinical role is no longer enough on its own.
//!
//! The rule is enforced on every patient-scoped chart read by the disclosure
//! middleware (`phi_access_audit`), which also writes the authority onto the
//! audit row, so the patient's history can say "via referral" or "emergency
//! access". Emergency-card and NFC reads have their own token-based authority
//! and are not gated here: nothing in this module may block emergency access.
//!
//! The windows below are **defaults pending clinical approval** (WP13 moves
//! them into signed-off policy files).

use chrono::{DateTime, Duration, Utc};

use crate::repositories::care_relationships::CareRelationshipEntity;
use crate::state::AppState;

/// Days a clinician keeps access after an appointment or consultation.
pub const ENCOUNTER_RELATIONSHIP_DAYS: i64 = 30;
/// Days a consulting clinician keeps access after a referral.
pub const REFERRAL_RELATIONSHIP_DAYS: i64 = 90;
/// Minutes a break-glass grant lasts.
pub const BREAK_GLASS_MINUTES: i64 = 60;

/// What authorised a chart read, as recorded on the audit row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChartAuthority {
    SelfAccess,
    Guardian(String),
    Admin,
    PatientGrant(String),
    /// A care relationship: its id and source (`encounter`, `referral`, …).
    CareRelationship {
        id: String,
        source: String,
    },
    BreakGlass(String),
    Denied,
}

impl ChartAuthority {
    /// Whether the read may proceed.
    pub fn is_permitted(&self) -> bool {
        !matches!(self, Self::Denied)
    }

    /// The `access_logs.authority_type` value, or `None` when denied.
    pub fn authority_type(&self) -> Option<&'static str> {
        match self {
            Self::SelfAccess => Some("self"),
            Self::Guardian(_) => Some("guardian"),
            Self::Admin => Some("admin"),
            Self::PatientGrant(_) => Some("patient_grant"),
            Self::CareRelationship { .. } => Some("care_relationship"),
            Self::BreakGlass(_) => Some("break_glass"),
            Self::Denied => None,
        }
    }

    /// The id of the grant, relationship or break-glass record, if any.
    pub fn authority_id(&self) -> Option<String> {
        match self {
            Self::Guardian(id) | Self::PatientGrant(id) | Self::BreakGlass(id) => Some(id.clone()),
            Self::CareRelationship { id, .. } => Some(id.clone()),
            _ => None,
        }
    }

    /// Whether this read is emergency access (break-glass).
    pub fn is_emergency(&self) -> bool {
        matches!(self, Self::BreakGlass(_))
    }
}

/// The authority store could not be consulted. Chart reads fail closed (503).
#[derive(Debug)]
pub struct AuthorityUnavailable(pub String);

/// The active patient grant held by `clinician` on `patient_id`, if any.
async fn patient_grant(
    data: &AppState,
    patient_id: &str,
    clinician: &str,
    now: DateTime<Utc>,
) -> Result<Option<String>, AuthorityUnavailable> {
    let grants = data
        .patient_access
        .list_grants_by_patient(patient_id, now)
        .await
        .map_err(|error| AuthorityUnavailable(error.to_string()))?;
    Ok(grants
        .into_iter()
        .find(|grant| grant.provider_id == clinician && grant.is_effective(now))
        .map(|grant| grant.id))
}

/// The clinician-side authorities, in order: grant, relationship, break-glass.
async fn clinician_authority(
    data: &AppState,
    caller: &crate::User,
    patient_id: &str,
    now: DateTime<Utc>,
) -> Result<ChartAuthority, AuthorityUnavailable> {
    let wallet = caller.wallet_address.as_str();
    if let Some(id) = patient_grant(data, patient_id, wallet, now).await? {
        return Ok(ChartAuthority::PatientGrant(id));
    }
    let store = &data.repositories.care_relationships;
    let facility = data.identity_contexts.facility_for_wallet(wallet);
    let unavailable = |error: crate::repositories::traits::RepositoryError| {
        AuthorityUnavailable(error.to_string())
    };
    if let Some(row) = store
        .active_for(patient_id, wallet, facility.as_deref(), now)
        .await
        .map_err(unavailable)?
    {
        return Ok(ChartAuthority::CareRelationship {
            id: row.id,
            source: row.source,
        });
    }
    Ok(
        match store
            .active_break_glass(patient_id, wallet, now)
            .await
            .map_err(unavailable)?
        {
            Some(grant) => ChartAuthority::BreakGlass(grant.id),
            None => ChartAuthority::Denied,
        },
    )
}

/// Decide what, if anything, authorises `caller` to read `patient_id`'s chart.
///
/// Returns the authority (or `Denied`), or `AuthorityUnavailable` when a store
/// that could have granted access cannot be read (the caller answers 503).
pub async fn resolve_chart_access(
    data: &actix_web::web::Data<AppState>,
    caller: &crate::User,
    patient_id: &str,
) -> Result<ChartAuthority, AuthorityUnavailable> {
    use crate::support::PatientAccessGrant;
    let base = crate::support::resolve_patient_access(
        data,
        caller,
        patient_id,
        crate::repositories::traits::GuardianPermission::ViewRecords,
    )
    .await;
    match base {
        PatientAccessGrant::SelfAccess => return Ok(ChartAuthority::SelfAccess),
        PatientAccessGrant::Admin => return Ok(ChartAuthority::Admin),
        PatientAccessGrant::Guardian(r) => return Ok(ChartAuthority::Guardian(r.id)),
        PatientAccessGrant::Denied => {}
    }
    if !caller.role.can_view_medical_records() {
        return Ok(ChartAuthority::Denied);
    }
    clinician_authority(data, caller, patient_id, Utc::now()).await
}

/// Record (or refresh) a care relationship from a clinical workflow item.
///
/// A failure is logged, not returned: the appointment or consult it came from
/// has already been saved, and the clinician can still break the glass. The
/// relationship is not what makes the clinical record valid.
pub async fn record_relationship(
    data: &AppState,
    patient_id: &str,
    clinician_id: &str,
    source: &str,
    source_id: &str,
    window: (DateTime<Utc>, DateTime<Utc>),
) {
    let row = CareRelationshipEntity {
        id: format!("CR-{}", uuid::Uuid::new_v4()),
        patient_id: patient_id.to_string(),
        clinician_id: Some(clinician_id.to_string()),
        facility_id: data.identity_contexts.facility_for_wallet(clinician_id),
        source: source.to_string(),
        source_id: source_id.to_string(),
        starts_at: window.0,
        ends_at: Some(window.1),
        created_at: Utc::now(),
    };
    if let Err(error) = data.repositories.care_relationships.record(row).await {
        log::error!(
            "care relationship ({source} {source_id}) for patient {patient_id} not recorded: {error}"
        );
    }
}

/// An encounter relationship: from now until [`ENCOUNTER_RELATIONSHIP_DAYS`]
/// after the encounter's time (or after now, if that is later).
pub async fn record_encounter(
    data: &AppState,
    patient_id: &str,
    clinician_id: &str,
    source_id: &str,
    encounter_at: DateTime<Utc>,
) {
    let now = Utc::now();
    let end = encounter_at.max(now) + Duration::days(ENCOUNTER_RELATIONSHIP_DAYS);
    record_relationship(
        data,
        patient_id,
        clinician_id,
        "encounter",
        source_id,
        (now, end),
    )
    .await;
}

/// A referral relationship for the consulting clinician, when they are a
/// registered clinician (a free-text name cannot hold a relationship).
pub async fn record_referral(
    data: &AppState,
    patient_id: &str,
    consulting: &str,
    consult_id: &str,
) {
    let registered = data
        .users
        .read()
        .ok()
        .and_then(|users| {
            users
                .get(consulting)
                .map(|u| u.role.can_view_medical_records())
        })
        .unwrap_or(false);
    if !registered {
        return;
    }
    let now = Utc::now();
    let end = now + Duration::days(REFERRAL_RELATIONSHIP_DAYS);
    record_relationship(
        data,
        patient_id,
        consulting,
        "referral",
        consult_id,
        (now, end),
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::web;

    const PATIENT_ID: &str = "PAT-CARE-RULE";

    async fn state() -> web::Data<AppState> {
        let state = AppState::new();
        for (wallet, role) in [
            ("doctor_related", crate::Role::Doctor),
            ("doctor_stranger", crate::Role::Doctor),
            ("pharmacist_rule", crate::Role::Pharmacist),
        ] {
            crate::test_fixtures::register(&state, wallet, role);
        }
        crate::test_fixtures::seed_patient(&state, PATIENT_ID).await;
        web::Data::new(state)
    }

    fn user(data: &AppState, wallet: &str) -> crate::User {
        data.users.read().unwrap().get(wallet).cloned().unwrap()
    }

    #[actix_web::test]
    async fn a_clinician_needs_a_relationship_grant_or_break_glass() {
        let data = state().await;
        let stranger = user(&data, "doctor_stranger");
        let related = user(&data, "doctor_related");
        record_encounter(&data, PATIENT_ID, "doctor_related", "APT-1", Utc::now()).await;

        let authority = resolve_chart_access(&data, &related, PATIENT_ID)
            .await
            .unwrap();
        assert!(
            matches!(authority, ChartAuthority::CareRelationship { ref source, .. } if source == "encounter")
        );
        assert_eq!(
            resolve_chart_access(&data, &stranger, PATIENT_ID)
                .await
                .unwrap(),
            ChartAuthority::Denied
        );
    }

    #[actix_web::test]
    async fn a_referral_needs_a_registered_clinician() {
        let data = state().await;
        record_referral(&data, PATIENT_ID, "Dr Somebody (free text)", "CON-1").await;
        record_referral(&data, PATIENT_ID, "doctor_stranger", "CON-2").await;
        let stranger = user(&data, "doctor_stranger");
        let authority = resolve_chart_access(&data, &stranger, PATIENT_ID)
            .await
            .unwrap();
        assert_eq!(authority.authority_type(), Some("care_relationship"));
    }

    #[actix_web::test]
    async fn the_patient_and_a_patient_role_stranger_are_told_apart() {
        let data = state().await;
        let mut patient = crate::test_fixtures::staff("patient_rule", crate::Role::Patient);
        patient.linked_patient_id = Some(PATIENT_ID.into());
        assert_eq!(
            resolve_chart_access(&data, &patient, PATIENT_ID)
                .await
                .unwrap(),
            ChartAuthority::SelfAccess
        );
        // Another patient never reaches the clinician rules, relationship or not.
        let other = crate::test_fixtures::staff("patient_other_rule", crate::Role::Patient);
        record_encounter(&data, PATIENT_ID, "patient_other_rule", "APT-3", Utc::now()).await;
        assert_eq!(
            resolve_chart_access(&data, &other, PATIENT_ID)
                .await
                .unwrap(),
            ChartAuthority::Denied
        );
    }
}
