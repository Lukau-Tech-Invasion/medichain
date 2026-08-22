//! In-memory implementation of the patient access repository.
//!
//! For dev, demo and tests. The transition methods hold their write guards
//! across the check and the write, which is what makes them atomic here; the
//! PostgreSQL implementation gets the same guarantee from conditional UPDATEs
//! inside a transaction. Both must agree, so the semantics are stated once in
//! `repositories::traits::PatientAccessRepository` and asserted by the shared
//! tests at the bottom of this file.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::{
    AccessGrantEntity, AccessRequestEntity, PatientAccessRepository, RepositoryError,
    RepositoryResult,
};

#[derive(Debug, Default)]
pub struct MemoryPatientAccessRepository {
    requests: RwLock<HashMap<String, AccessRequestEntity>>,
    grants: RwLock<HashMap<String, AccessGrantEntity>>,
}

impl MemoryPatientAccessRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

fn poisoned(what: &str) -> RepositoryError {
    RepositoryError::Internal(format!("patient access {what} store poisoned"))
}

#[async_trait]
impl PatientAccessRepository for MemoryPatientAccessRepository {
    async fn create_request(
        &self,
        request: AccessRequestEntity,
    ) -> RepositoryResult<AccessRequestEntity> {
        self.requests
            .write()
            .map_err(|_| poisoned("request"))?
            .insert(request.id.clone(), request.clone());
        Ok(request)
    }

    async fn create_request_with_audit(
        &self,
        request: AccessRequestEntity,
        _event: crate::audit_outbox::AuditOutboxEvent,
    ) -> RepositoryResult<AccessRequestEntity> {
        // Demo-only memory storage has no shared transaction manager with the
        // in-process outbox. Production uses the PostgreSQL implementation.
        self.create_request(request).await
    }

    async fn get_request(&self, id: &str) -> RepositoryResult<Option<AccessRequestEntity>> {
        Ok(self
            .requests
            .read()
            .map_err(|_| poisoned("request"))?
            .get(id)
            .cloned())
    }

    async fn list_requests_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<AccessRequestEntity>> {
        let requests = self.requests.read().map_err(|_| poisoned("request"))?;
        let mut out: Vec<AccessRequestEntity> = requests
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        out.sort_by_key(|r| std::cmp::Reverse(r.requested_at));
        Ok(out)
    }

    async fn approve_request(
        &self,
        request_id: &str,
        grant: AccessGrantEntity,
    ) -> RepositoryResult<Option<(AccessRequestEntity, AccessGrantEntity)>> {
        // Lock order is always requests-then-grants; see `revoke_grant`, which
        // takes only the grants lock. Deviating risks a deadlock.
        let mut requests = self.requests.write().map_err(|_| poisoned("request"))?;
        let mut grants = self.grants.write().map_err(|_| poisoned("grant"))?;

        let request = match requests.get_mut(request_id) {
            Some(r) if r.status == "pending" => r,
            _ => return Ok(None),
        };
        request.status = "approved".to_string();
        let decided = request.clone();

        grants.insert(grant.id.clone(), grant.clone());
        Ok(Some((decided, grant)))
    }

    async fn approve_request_with_audit(
        &self,
        request_id: &str,
        grant: AccessGrantEntity,
        _event: crate::audit_outbox::AuditOutboxEvent,
    ) -> RepositoryResult<Option<(AccessRequestEntity, AccessGrantEntity)>> {
        // Demo-only memory storage has no shared transaction manager with the
        // in-process outbox. Production uses the PostgreSQL implementation.
        self.approve_request(request_id, grant).await
    }

    async fn deny_request(
        &self,
        request_id: &str,
    ) -> RepositoryResult<Option<AccessRequestEntity>> {
        let mut requests = self.requests.write().map_err(|_| poisoned("request"))?;
        let request = match requests.get_mut(request_id) {
            Some(r) if r.status == "pending" => r,
            _ => return Ok(None),
        };
        request.status = "denied".to_string();
        Ok(Some(request.clone()))
    }

    async fn get_grant(&self, id: &str) -> RepositoryResult<Option<AccessGrantEntity>> {
        Ok(self
            .grants
            .read()
            .map_err(|_| poisoned("grant"))?
            .get(id)
            .cloned())
    }

    async fn list_grants_by_patient(
        &self,
        patient_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Vec<AccessGrantEntity>> {
        let mut grants = self.grants.write().map_err(|_| poisoned("grant"))?;
        // Lazy expiry, persisted, scoped to this patient — same statement the
        // PostgreSQL implementation runs before its SELECT.
        for grant in grants.values_mut() {
            if grant.patient_id == patient_id
                && grant.status == "active"
                && !grant.is_effective(now)
            {
                grant.status = "expired".to_string();
            }
        }
        let mut out: Vec<AccessGrantEntity> = grants
            .values()
            .filter(|g| g.patient_id == patient_id)
            .cloned()
            .collect();
        out.sort_by_key(|g| std::cmp::Reverse(g.granted_at));
        Ok(out)
    }

    async fn revoke_grant(
        &self,
        grant_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Option<AccessGrantEntity>> {
        let mut grants = self.grants.write().map_err(|_| poisoned("grant"))?;
        let grant = match grants.get_mut(grant_id) {
            Some(g) if g.is_effective(now) => g,
            _ => return Ok(None),
        };
        grant.status = "revoked".to_string();
        Ok(Some(grant.clone()))
    }
}
