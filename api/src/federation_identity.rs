//! Federation-ready identity contexts.
//!
//! This Phase 1 module separates an account's professional and patient contexts.
//! It keeps professional and patient authorisation contexts distinct so callers
//! cannot treat a global role as permission to use personal health access.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

pub const CONTEXT_TTL_MINUTES: i64 = 60;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextType {
    Patient,
    Professional,
}

/// Placeholder facility the account bridge assigns when none is known.
const LEGACY_FACILITY_ID: &str = "legacy-facility";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoginContext {
    pub id: String,
    pub person_id: String,
    pub user_id: String,
    pub context_type: ContextType,
    pub patient_profile_id: Option<String>,
    pub organization_id: Option<String>,
    pub facility_id: Option<String>,
    pub assignment_id: Option<String>,
    pub role: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

impl LoginContext {
    fn active(&self, now: DateTime<Utc>) -> bool {
        self.expires_at > now
    }
}

/// In-memory context registry used during the backwards-compatible migration.
/// PostgreSQL schema is introduced in the matching Phase 1 migration; later
/// repository work can replace this implementation without changing token or
/// handler contracts.
pub struct IdentityContextStore {
    people_by_user: RwLock<HashMap<String, String>>,
    patient_profiles: RwLock<HashMap<String, String>>,
    professional_assignments: RwLock<HashMap<String, ProfessionalAssignment>>,
    contexts: RwLock<HashMap<String, LoginContext>>,
}

#[derive(Debug, Clone)]
struct ProfessionalAssignment {
    id: String,
    organization_id: String,
    facility_id: String,
    facility_name: Option<String>,
    role: String,
    active: bool,
}

impl IdentityContextStore {
    pub fn new() -> Self {
        Self {
            people_by_user: RwLock::new(HashMap::new()),
            patient_profiles: RwLock::new(HashMap::new()),
            professional_assignments: RwLock::new(HashMap::new()),
            contexts: RwLock::new(HashMap::new()),
        }
    }

    /// Create the minimum compatible identity records for an existing account.
    /// This prevents a destructive authentication migration while making the
    /// legacy organisation explicit and easy to replace in Phase 2.
    pub fn register_user(
        &self,
        user_id: &str,
        linked_patient_id: Option<&str>,
        role: &str,
    ) -> String {
        let person_id = self.person_id_for(user_id);
        if let Some(patient_id) = linked_patient_id {
            if let Ok(mut profiles) = self.patient_profiles.write() {
                profiles.insert(user_id.to_string(), patient_id.to_string());
            }
        }
        if role != "Patient" {
            if let Ok(mut assignments) = self.professional_assignments.write() {
                assignments
                    .entry(user_id.to_string())
                    .or_insert_with(|| ProfessionalAssignment {
                        id: format!("legacy-assignment-{}", Uuid::new_v4()),
                        organization_id: "legacy-organization".to_string(),
                        facility_id: LEGACY_FACILITY_ID.to_string(),
                        facility_name: None,
                        role: role.to_string(),
                        active: true,
                    });
            }
        }
        person_id
    }

    /// Assign a known professional to an active facility context.
    ///
    /// This is used after durable assignment provisioning so the current API
    /// process immediately reports the real facility instead of its legacy
    /// placeholder while a newly seeded demo is running.
    pub fn assign_professional_facility(
        &self,
        user_id: &str,
        organization_id: &str,
        facility_id: &str,
        facility_name: &str,
        role: &str,
    ) {
        self.person_id_for(user_id);
        if let Ok(mut assignments) = self.professional_assignments.write() {
            assignments.insert(
                user_id.to_string(),
                ProfessionalAssignment {
                    id: format!("assignment-{}", Uuid::new_v4()),
                    organization_id: organization_id.to_string(),
                    facility_id: facility_id.to_string(),
                    facility_name: Some(facility_name.to_string()),
                    role: role.to_string(),
                    active: true,
                },
            );
        }
    }

    /// Issue a patient context for `user_id`. `target_patient_id`
    /// selects which medical identity to enter: `None` looks up the caller's
    /// own linked patient profile (unchanged, back-compatible behavior);
    /// `Some(id)` enters that identity directly — the "choose profile" flow
    /// for a guardian switching into a ward's record. Callers MUST verify
    /// authorization for `target_patient_id` (self, Admin, or an active
    /// guardian relationship — see `support::caller_may_access_patient`)
    /// *before* calling this; it trusts the id it's given.
    pub fn issue_patient_context(
        &self,
        user_id: &str,
        target_patient_id: Option<&str>,
    ) -> Result<LoginContext, &'static str> {
        let patient_profile_id = match target_patient_id {
            Some(target) => target.to_string(),
            None => self
                .patient_profiles
                .read()
                .ok()
                .and_then(|profiles| profiles.get(user_id).cloned())
                .ok_or("No patient profile is linked to this identity")?,
        };
        self.store_context(LoginContext {
            id: Uuid::new_v4().to_string(),
            person_id: self.person_id_for(user_id),
            user_id: user_id.to_string(),
            context_type: ContextType::Patient,
            patient_profile_id: Some(patient_profile_id),
            organization_id: None,
            facility_id: None,
            assignment_id: None,
            role: Some("Patient".to_string()),
            created_at: Utc::now(),
            expires_at: Utc::now() + Duration::minutes(CONTEXT_TTL_MINUTES),
        })
    }

    pub fn issue_work_context(&self, user_id: &str) -> Result<LoginContext, &'static str> {
        let assignment = self
            .professional_assignments
            .read()
            .ok()
            .and_then(|assignments| assignments.get(user_id).cloned())
            .filter(|assignment| assignment.active)
            .ok_or("No active professional assignment exists for this identity")?;
        self.store_context(LoginContext {
            id: Uuid::new_v4().to_string(),
            person_id: self.person_id_for(user_id),
            user_id: user_id.to_string(),
            context_type: ContextType::Professional,
            patient_profile_id: None,
            organization_id: Some(assignment.organization_id),
            facility_id: Some(assignment.facility_id),
            assignment_id: Some(assignment.id),
            role: Some(assignment.role),
            created_at: Utc::now(),
            expires_at: Utc::now() + Duration::minutes(CONTEXT_TTL_MINUTES),
        })
    }

    /// Facility of the caller's active professional assignment, if any.
    ///
    /// Used to tell a patient *where* the person who read their record works.
    ///
    /// # Parameters
    /// * `user_id` - the clinician's authenticated account ID.
    ///
    /// # Returns
    /// The facility name, or `None` when the caller has no active assignment
    /// with a known facility name (never a guessed or default facility).
    pub fn facility_for_user(&self, user_id: &str) -> Option<String> {
        self.professional_assignments
            .read()
            .ok()?
            .get(user_id)
            .filter(|assignment| assignment.active)
            // The legacy bridge fills every assignment with this placeholder;
            // telling a patient "legacy-facility" read their record is noise.
            .filter(|assignment| assignment.facility_id != LEGACY_FACILITY_ID)
            .and_then(|assignment| assignment.facility_name.clone())
    }

    /// The id of the facility `user_id` works at, when they have a real
    /// (non-placeholder) active assignment. The ambulance board filters by it.
    pub fn facility_id_for_user(&self, user_id: &str) -> Option<String> {
        self.professional_assignments
            .read()
            .ok()?
            .get(user_id)
            .filter(|assignment| assignment.active && assignment.facility_id != LEGACY_FACILITY_ID)
            .map(|assignment| assignment.facility_id.clone())
    }

    /// Accounts actively assigned to `facility_id`: who a pre-alert for that
    /// hospital is pushed to.
    pub fn users_at_facility(&self, facility_id: &str) -> Vec<String> {
        self.professional_assignments
            .read()
            .map(|assignments| {
                assignments
                    .iter()
                    .filter(|(_, a)| a.active && a.facility_id == facility_id)
                    .map(|(user, _)| user.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Real facilities known from staff assignments, as (id, name): the
    /// destination list when no database is available.
    pub fn assigned_facilities(&self) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = self
            .professional_assignments
            .read()
            .map(|assignments| {
                assignments
                    .values()
                    .filter(|a| a.active && a.facility_id != LEGACY_FACILITY_ID)
                    .map(|a| {
                        (
                            a.facility_id.clone(),
                            a.facility_name
                                .clone()
                                .unwrap_or_else(|| a.facility_id.clone()),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        out.sort();
        out.dedup();
        out
    }

    pub fn active_context(&self, context_id: &str, user_id: &str) -> Option<LoginContext> {
        self.contexts
            .read()
            .ok()?
            .get(context_id)
            .filter(|context| context.user_id == user_id && context.active(Utc::now()))
            .cloned()
    }

    fn person_id_for(&self, user_id: &str) -> String {
        self.people_by_user
            .write()
            .map(|mut people| {
                people
                    .entry(user_id.to_string())
                    .or_insert_with(|| Uuid::new_v4().to_string())
                    .clone()
            })
            .unwrap_or_else(|_| format!("unavailable-{}", user_id))
    }

    fn store_context(&self, context: LoginContext) -> Result<LoginContext, &'static str> {
        self.contexts
            .write()
            .map_err(|_| "Identity context store is unavailable")?
            .insert(context.id.clone(), context.clone());
        Ok(context)
    }
}

impl Default for IdentityContextStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_and_patient_contexts_are_disjoint() {
        let store = IdentityContextStore::new();
        let user_id = Uuid::new_v4().to_string();
        store.register_user(&user_id, Some("patient-1"), "Doctor");
        let work = store.issue_work_context(&user_id).unwrap();
        let patient = store.issue_patient_context(&user_id, None).unwrap();
        assert_eq!(work.context_type, ContextType::Professional);
        assert!(work.patient_profile_id.is_none());
        assert_eq!(patient.context_type, ContextType::Patient);
        assert!(patient.organization_id.is_none());
    }

    #[test]
    fn target_patient_id_switches_into_a_wards_identity() {
        let store = IdentityContextStore::new();
        let user_id = Uuid::new_v4().to_string();
        store.register_user(&user_id, None, "Patient");
        let context = store
            .issue_patient_context(&user_id, Some("PAT-ward-123"))
            .unwrap();
        assert_eq!(context.patient_profile_id.as_deref(), Some("PAT-ward-123"));
    }

    #[test]
    fn a_seeded_assignment_replaces_the_legacy_facility_placeholder() {
        let store = IdentityContextStore::new();
        let user_id = Uuid::new_v4().to_string();
        store.register_user(&user_id, None, "Paramedic");
        store.assign_professional_facility(
            &user_id,
            "demo-org",
            "demo-facility-jhb",
            "MediChain Johannesburg Demonstration Clinic",
            "Paramedic",
        );
        assert_eq!(
            store.facility_for_user(&user_id).as_deref(),
            Some("MediChain Johannesburg Demonstration Clinic")
        );
        assert_eq!(
            store.issue_work_context(&user_id).unwrap().role.as_deref(),
            Some("Paramedic")
        );
    }
}
