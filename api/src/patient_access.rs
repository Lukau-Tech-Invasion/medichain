//! Patient-controlled standing access grants and provider access requests.
//!
//! This is the consent-based counterpart to [`crate::emergency_grants`]: a
//! provider *requests* access to a patient's records, the patient *approves*
//! (creating an active grant) or *denies*, and the patient can *revoke* a grant
//! at any time. It backs the patient-app Consent Management page.
//!
//! Distinct from emergency (break-glass) grants, which are provider-initiated,
//! auto-expiring, and do not need patient approval. Here the patient is the
//! decision-maker, matching MediChain's "patients control who accesses their
//! records" model.
//!
//! In-memory, mirroring [`crate::emergency_grants::EmergencyGrantStore`]: the
//! demo/synthetic backend keeps this state in the process. A PostgreSQL-backed
//! implementation is tracked in `docs/TECHNICAL_DEBT_REGISTER.md`.

use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccessType {
    Full,
    Limited,
    Emergency,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GrantStatus {
    Active,
    Expired,
    Revoked,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RequestStatus {
    Pending,
    Approved,
    Denied,
}

// The response shapes are serialized `camelCase` on purpose: the patient-app
// page reads `providerName`, `accessType`, `grantedAt`, `accessCount`, … . A
// serde rename mismatch here would leave the UI rendering `undefined`
// (exactly the HZ-015 class of bug), so do not drop `rename_all` below.

/// A standing access grant the patient has approved. `patient_id` is internal
/// (used for ownership checks) and never serialized to the client.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessGrant {
    pub id: String,
    #[serde(skip)]
    pub patient_id: String,
    pub provider_id: String,
    pub provider_name: String,
    pub provider_role: String,
    pub organization: String,
    pub access_type: AccessType,
    pub granted_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub status: GrantStatus,
    pub last_accessed: Option<DateTime<Utc>>,
    pub access_count: u32,
}

/// A provider's pending request for access, awaiting the patient's decision.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessRequest {
    pub id: String,
    #[serde(skip)]
    pub patient_id: String,
    pub provider_id: String,
    pub provider_name: String,
    pub provider_role: String,
    pub organization: String,
    pub requested_at: DateTime<Utc>,
    pub reason: String,
    pub status: RequestStatus,
}

/// Details carried from a request into the grant it becomes on approval.
pub struct RequestingProvider {
    pub provider_id: String,
    pub provider_name: String,
    pub provider_role: String,
    pub organization: String,
    pub reason: String,
}

pub struct PatientAccessStore {
    grants: RwLock<HashMap<String, AccessGrant>>,
    requests: RwLock<HashMap<String, AccessRequest>>,
}

impl PatientAccessStore {
    pub fn new() -> Self {
        Self {
            grants: RwLock::new(HashMap::new()),
            requests: RwLock::new(HashMap::new()),
        }
    }

    /// A provider asks the patient for access. Creates a `pending` request.
    pub fn create_request(
        &self,
        patient_id: String,
        provider: RequestingProvider,
        now: DateTime<Utc>,
    ) -> Result<AccessRequest, &'static str> {
        if patient_id.is_empty() || provider.provider_id.is_empty() {
            return Err("Patient and provider are required");
        }
        if provider.reason.trim().is_empty() {
            return Err("A reason for the access request is required");
        }
        let request = AccessRequest {
            id: format!("REQ-{}", Uuid::new_v4()),
            patient_id,
            provider_id: provider.provider_id,
            provider_name: provider.provider_name,
            provider_role: provider.provider_role,
            organization: provider.organization,
            requested_at: now,
            reason: provider.reason,
            status: RequestStatus::Pending,
        };
        self.requests
            .write()
            .map_err(|_| "Access request store is unavailable")?
            .insert(request.id.clone(), request.clone());
        Ok(request)
    }

    pub fn list_requests_by_patient(&self, patient_id: &str) -> Vec<AccessRequest> {
        self.requests
            .read()
            .map(|map| {
                let mut out: Vec<AccessRequest> = map
                    .values()
                    .filter(|r| r.patient_id == patient_id)
                    .cloned()
                    .collect();
                out.sort_by(|a, b| b.requested_at.cmp(&a.requested_at));
                out
            })
            .unwrap_or_default()
    }

    /// Active grants for a patient, with lazy expiry applied so a caller never
    /// sees an "active" grant whose `expires_at` has passed.
    pub fn list_grants_by_patient(&self, patient_id: &str, now: DateTime<Utc>) -> Vec<AccessGrant> {
        let mut grants = match self.grants.write() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        for grant in grants.values_mut() {
            if grant.status == GrantStatus::Active {
                if let Some(expiry) = grant.expires_at {
                    if now >= expiry {
                        grant.status = GrantStatus::Expired;
                    }
                }
            }
        }
        let mut out: Vec<AccessGrant> = grants
            .values()
            .filter(|g| g.patient_id == patient_id)
            .cloned()
            .collect();
        out.sort_by(|a, b| b.granted_at.cmp(&a.granted_at));
        out
    }

    pub fn get_request(&self, request_id: &str) -> Option<AccessRequest> {
        self.requests.read().ok()?.get(request_id).cloned()
    }

    pub fn get_grant(&self, grant_id: &str) -> Option<AccessGrant> {
        self.grants.read().ok()?.get(grant_id).cloned()
    }

    /// Patient approves a pending request: marks it `approved` and creates a new
    /// active grant carrying the provider's details. Idempotency: a request that
    /// is not `pending` is refused (mirrors the emergency-grant revoke replay
    /// rule) so a double-approve cannot mint two grants.
    pub fn approve_request(
        &self,
        request_id: &str,
        access_type: AccessType,
        expires_at: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Result<(AccessRequest, AccessGrant), &'static str> {
        let mut requests = self
            .requests
            .write()
            .map_err(|_| "Access request store is unavailable")?;
        let request = requests
            .get_mut(request_id)
            .ok_or("Access request not found")?;
        if request.status != RequestStatus::Pending {
            return Err("Access request has already been decided");
        }
        request.status = RequestStatus::Approved;
        let grant = AccessGrant {
            id: format!("GRANT-{}", Uuid::new_v4()),
            patient_id: request.patient_id.clone(),
            provider_id: request.provider_id.clone(),
            provider_name: request.provider_name.clone(),
            provider_role: request.provider_role.clone(),
            organization: request.organization.clone(),
            access_type,
            granted_at: now,
            expires_at,
            status: GrantStatus::Active,
            last_accessed: None,
            access_count: 0,
        };
        let decided = request.clone();
        drop(requests);
        self.grants
            .write()
            .map_err(|_| "Access grant store is unavailable")?
            .insert(grant.id.clone(), grant.clone());
        Ok((decided, grant))
    }

    /// Patient denies a pending request. Only a `pending` request can be denied.
    pub fn deny_request(&self, request_id: &str) -> Result<AccessRequest, &'static str> {
        let mut requests = self
            .requests
            .write()
            .map_err(|_| "Access request store is unavailable")?;
        let request = requests
            .get_mut(request_id)
            .ok_or("Access request not found")?;
        if request.status != RequestStatus::Pending {
            return Err("Access request has already been decided");
        }
        request.status = RequestStatus::Denied;
        Ok(request.clone())
    }

    /// Patient revokes an active grant. Only an `active` grant can be revoked.
    pub fn revoke_grant(
        &self,
        grant_id: &str,
        _now: DateTime<Utc>,
    ) -> Result<AccessGrant, &'static str> {
        let mut grants = self
            .grants
            .write()
            .map_err(|_| "Access grant store is unavailable")?;
        let grant = grants.get_mut(grant_id).ok_or("Access grant not found")?;
        if grant.status != GrantStatus::Active {
            return Err("Access grant is not active");
        }
        grant.status = GrantStatus::Revoked;
        Ok(grant.clone())
    }
}

impl Default for PatientAccessStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider() -> RequestingProvider {
        RequestingProvider {
            provider_id: "5DoctorWallet".into(),
            provider_name: "Dr Synthetic".into(),
            provider_role: "Doctor".into(),
            organization: "Synthetic General Hospital".into(),
            reason: "Follow-up consultation".into(),
        }
    }

    #[test]
    fn approve_creates_one_active_grant_and_is_not_replayable() {
        let store = PatientAccessStore::new();
        let now = Utc::now();
        let req = store
            .create_request("PAT-1".into(), provider(), now)
            .unwrap();
        assert_eq!(req.status, RequestStatus::Pending);

        let (decided, grant) = store
            .approve_request(&req.id, AccessType::Limited, None, now)
            .unwrap();
        assert_eq!(decided.status, RequestStatus::Approved);
        assert_eq!(grant.status, GrantStatus::Active);
        assert_eq!(grant.patient_id, "PAT-1");
        assert_eq!(store.list_grants_by_patient("PAT-1", now).len(), 1);

        // Replaying the approval is refused; no second grant is minted.
        assert_eq!(
            store
                .approve_request(&req.id, AccessType::Limited, None, now)
                .unwrap_err(),
            "Access request has already been decided"
        );
        assert_eq!(store.list_grants_by_patient("PAT-1", now).len(), 1);
    }

    #[test]
    fn deny_blocks_a_later_approve() {
        let store = PatientAccessStore::new();
        let now = Utc::now();
        let req = store
            .create_request("PAT-1".into(), provider(), now)
            .unwrap();
        store.deny_request(&req.id).unwrap();
        assert_eq!(
            store
                .approve_request(&req.id, AccessType::Limited, None, now)
                .unwrap_err(),
            "Access request has already been decided"
        );
        assert!(store.list_grants_by_patient("PAT-1", now).is_empty());
    }

    #[test]
    fn revoke_is_idempotent_and_only_for_active() {
        let store = PatientAccessStore::new();
        let now = Utc::now();
        let req = store
            .create_request("PAT-1".into(), provider(), now)
            .unwrap();
        let (_, grant) = store
            .approve_request(&req.id, AccessType::Limited, None, now)
            .unwrap();
        store.revoke_grant(&grant.id, now).unwrap();
        assert_eq!(
            store.revoke_grant(&grant.id, now).unwrap_err(),
            "Access grant is not active"
        );
    }

    #[test]
    fn a_reason_is_required_for_a_request() {
        let store = PatientAccessStore::new();
        let mut p = provider();
        p.reason = "   ".into();
        assert!(store.create_request("PAT-1".into(), p, Utc::now()).is_err());
    }

    #[test]
    fn grants_and_requests_are_scoped_per_patient() {
        let store = PatientAccessStore::new();
        let now = Utc::now();
        store
            .create_request("PAT-1".into(), provider(), now)
            .unwrap();
        store
            .create_request("PAT-2".into(), provider(), now)
            .unwrap();
        assert_eq!(store.list_requests_by_patient("PAT-1").len(), 1);
        assert_eq!(store.list_requests_by_patient("PAT-2").len(), 1);
        assert!(store.list_requests_by_patient("PAT-3").is_empty());
    }
}
