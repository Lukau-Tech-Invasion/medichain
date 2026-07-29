//! Federation-ready identity contexts.
//!
//! This Phase 1 module is an additive bridge from the legacy wallet/role model.
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

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoginContext {
    pub id: String,
    pub person_id: String,
    pub wallet_address: String,
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
    people_by_wallet: RwLock<HashMap<String, String>>,
    patient_profiles: RwLock<HashMap<String, String>>,
    professional_assignments: RwLock<HashMap<String, ProfessionalAssignment>>,
    contexts: RwLock<HashMap<String, LoginContext>>,
}

#[derive(Debug, Clone)]
struct ProfessionalAssignment {
    id: String,
    organization_id: String,
    facility_id: String,
    role: String,
    active: bool,
}

impl IdentityContextStore {
    pub fn new() -> Self {
        Self {
            people_by_wallet: RwLock::new(HashMap::new()),
            patient_profiles: RwLock::new(HashMap::new()),
            professional_assignments: RwLock::new(HashMap::new()),
            contexts: RwLock::new(HashMap::new()),
        }
    }

    /// Create the minimum compatible identity records for an existing wallet.
    /// This prevents a destructive authentication migration while making the
    /// legacy organisation explicit and easy to replace in Phase 2.
    pub fn register_legacy_user(
        &self,
        wallet_address: &str,
        linked_patient_id: Option<&str>,
        role: &str,
    ) -> String {
        let person_id = self.person_id_for(wallet_address);
        if let Some(patient_id) = linked_patient_id {
            if let Ok(mut profiles) = self.patient_profiles.write() {
                profiles.insert(wallet_address.to_string(), patient_id.to_string());
            }
        }
        if role != "Patient" {
            if let Ok(mut assignments) = self.professional_assignments.write() {
                assignments
                    .entry(wallet_address.to_string())
                    .or_insert_with(|| ProfessionalAssignment {
                        id: format!("legacy-assignment-{}", Uuid::new_v4()),
                        organization_id: "legacy-organization".to_string(),
                        facility_id: "legacy-facility".to_string(),
                        role: role.to_string(),
                        active: true,
                    });
            }
        }
        person_id
    }

    /// Issue a patient context for `wallet_address`. `target_patient_id`
    /// selects which medical identity to enter: `None` looks up the caller's
    /// own linked patient profile (unchanged, back-compatible behavior);
    /// `Some(id)` enters that identity directly — the "choose profile" flow
    /// for a guardian switching into a ward's record. Callers MUST verify
    /// authorization for `target_patient_id` (self, Admin, or an active
    /// guardian relationship — see `support::caller_may_access_patient`)
    /// *before* calling this; it trusts the id it's given.
    pub fn issue_patient_context(
        &self,
        wallet_address: &str,
        target_patient_id: Option<&str>,
    ) -> Result<LoginContext, &'static str> {
        let patient_profile_id = match target_patient_id {
            Some(target) => target.to_string(),
            None => self
                .patient_profiles
                .read()
                .ok()
                .and_then(|profiles| profiles.get(wallet_address).cloned())
                .ok_or("No patient profile is linked to this identity")?,
        };
        self.store_context(LoginContext {
            id: Uuid::new_v4().to_string(),
            person_id: self.person_id_for(wallet_address),
            wallet_address: wallet_address.to_string(),
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

    pub fn issue_work_context(&self, wallet_address: &str) -> Result<LoginContext, &'static str> {
        let assignment = self
            .professional_assignments
            .read()
            .ok()
            .and_then(|assignments| assignments.get(wallet_address).cloned())
            .filter(|assignment| assignment.active)
            .ok_or("No active professional assignment exists for this identity")?;
        self.store_context(LoginContext {
            id: Uuid::new_v4().to_string(),
            person_id: self.person_id_for(wallet_address),
            wallet_address: wallet_address.to_string(),
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

    pub fn active_context(&self, context_id: &str, wallet_address: &str) -> Option<LoginContext> {
        self.contexts
            .read()
            .ok()?
            .get(context_id)
            .filter(|context| {
                context.wallet_address == wallet_address && context.active(Utc::now())
            })
            .cloned()
    }

    fn person_id_for(&self, wallet_address: &str) -> String {
        self.people_by_wallet
            .write()
            .map(|mut people| {
                people
                    .entry(wallet_address.to_string())
                    .or_insert_with(|| Uuid::new_v4().to_string())
                    .clone()
            })
            .unwrap_or_else(|_| format!("unavailable-{}", wallet_address))
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
        let wallet = "5TestIdentityContext";
        store.register_legacy_user(wallet, Some("patient-1"), "Doctor");
        let work = store.issue_work_context(wallet).unwrap();
        let patient = store.issue_patient_context(wallet, None).unwrap();
        assert_eq!(work.context_type, ContextType::Professional);
        assert!(work.patient_profile_id.is_none());
        assert_eq!(patient.context_type, ContextType::Patient);
        assert!(patient.organization_id.is_none());
    }

    #[test]
    fn target_patient_id_switches_into_a_wards_identity() {
        let store = IdentityContextStore::new();
        let wallet = "5GuardianWallet";
        store.register_legacy_user(wallet, None, "Patient");
        let context = store
            .issue_patient_context(wallet, Some("PAT-ward-123"))
            .unwrap();
        assert_eq!(context.patient_profile_id.as_deref(), Some("PAT-ward-123"));
    }
}
