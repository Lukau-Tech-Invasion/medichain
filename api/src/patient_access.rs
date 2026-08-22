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
//! This module owns the *state machine* — what a valid request looks like,
//! which transitions are legal, how identifiers are minted. Storage lives
//! behind [`PatientAccessRepository`], so a consent decision survives a
//! restart: an HTTP 200 on "revoke Dr X's access" that a redeploy undoes is a
//! consent failure, not a caching detail.

use chrono::{DateTime, Utc};
use std::sync::Arc;
use uuid::Uuid;

use crate::repositories::traits::{
    AccessGrantEntity, AccessRequestEntity, PatientAccessRepository,
};

/// How much of the record a grant opens up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessType {
    Full,
    Limited,
    Emergency,
}

impl AccessType {
    /// The stored/serialized form. Must match the `access_type` CHECK
    /// constraint in migration `20260809000001_patient_access.sql`.
    pub fn as_str(self) -> &'static str {
        match self {
            AccessType::Full => "full",
            AccessType::Limited => "limited",
            AccessType::Emergency => "emergency",
        }
    }
}

/// Details carried from a request into the grant it becomes on approval.
pub struct RequestingProvider {
    pub provider_id: String,
    pub provider_name: String,
    pub provider_role: String,
    pub organization: String,
    pub reason: String,
}

// Stable, caller-facing failure messages. The handlers surface these verbatim,
// so they are part of the API contract.

/// Storage is unreachable. Handlers map this to 503, never to 400 — the caller
/// did nothing wrong and retrying is the right advice.
pub const STORE_UNAVAILABLE: &str = "Patient access records are unavailable";
const REQUEST_NOT_FOUND: &str = "Access request not found";
const REQUEST_ALREADY_DECIDED: &str = "Access request has already been decided";
const GRANT_NOT_FOUND: &str = "Access grant not found";
const GRANT_NOT_ACTIVE: &str = "Access grant is not active";

/// The consent state machine over a [`PatientAccessRepository`].
#[derive(Clone)]
pub struct PatientAccessService {
    repo: Arc<dyn PatientAccessRepository>,
}

impl std::fmt::Debug for PatientAccessService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PatientAccessService")
            .finish_non_exhaustive()
    }
}

impl PatientAccessService {
    pub fn new(repo: Arc<dyn PatientAccessRepository>) -> Self {
        Self { repo }
    }

    /// A provider asks the patient for access. Creates a `pending` request.
    pub async fn create_request(
        &self,
        patient_id: String,
        provider: RequestingProvider,
        now: DateTime<Utc>,
    ) -> Result<AccessRequestEntity, &'static str> {
        if patient_id.is_empty() || provider.provider_id.is_empty() {
            return Err("Patient and provider are required");
        }
        if provider.reason.trim().is_empty() {
            return Err("A reason for the access request is required");
        }
        let request = AccessRequestEntity {
            id: format!("REQ-{}", Uuid::new_v4()),
            patient_id,
            provider_id: provider.provider_id,
            provider_name: provider.provider_name,
            provider_role: provider.provider_role,
            organization: provider.organization,
            requested_at: now,
            reason: provider.reason,
            status: "pending".to_string(),
        };
        self.repo.create_request(request).await.map_err(|e| {
            log::error!("patient access: create_request failed: {e}");
            STORE_UNAVAILABLE
        })
    }

    /// Create a request and mandatory outbox event in the same production
    /// transaction. The caller prepares the event after the request ID exists.
    pub async fn create_request_with_audit(
        &self,
        patient_id: String,
        provider: RequestingProvider,
        event: crate::audit_outbox::AuditOutboxEvent,
        now: DateTime<Utc>,
    ) -> Result<AccessRequestEntity, &'static str> {
        if patient_id.is_empty()
            || provider.provider_id.is_empty()
            || provider.reason.trim().is_empty()
        {
            return Err("Patient, provider, and a reason are required");
        }
        let request = AccessRequestEntity {
            id: event.aggregate_id.clone(),
            patient_id,
            provider_id: provider.provider_id,
            provider_name: provider.provider_name,
            provider_role: provider.provider_role,
            organization: provider.organization,
            requested_at: now,
            reason: provider.reason,
            status: "pending".to_string(),
        };
        self.repo
            .create_request_with_audit(request, event)
            .await
            .map_err(|e| {
                log::error!("patient access: create_request_with_audit failed: {e}");
                STORE_UNAVAILABLE
            })
    }

    /// This patient's requests, newest first.
    ///
    /// Returns `Err` rather than an empty list when storage is unreachable: an
    /// empty consent list reads as "nobody has asked for your records", which
    /// is a materially different — and false — statement.
    pub async fn list_requests_by_patient(
        &self,
        patient_id: &str,
    ) -> Result<Vec<AccessRequestEntity>, &'static str> {
        self.repo
            .list_requests_by_patient(patient_id)
            .await
            .map_err(|e| {
                log::error!("patient access: list_requests_by_patient failed: {e}");
                STORE_UNAVAILABLE
            })
    }

    /// This patient's grants, newest first, with lazy expiry applied so a
    /// caller never sees an "active" grant whose `expires_at` has passed.
    pub async fn list_grants_by_patient(
        &self,
        patient_id: &str,
        now: DateTime<Utc>,
    ) -> Result<Vec<AccessGrantEntity>, &'static str> {
        self.repo
            .list_grants_by_patient(patient_id, now)
            .await
            .map_err(|e| {
                log::error!("patient access: list_grants_by_patient failed: {e}");
                STORE_UNAVAILABLE
            })
    }

    pub async fn get_request(
        &self,
        request_id: &str,
    ) -> Result<Option<AccessRequestEntity>, &'static str> {
        self.repo.get_request(request_id).await.map_err(|e| {
            log::error!("patient access: get_request failed: {e}");
            STORE_UNAVAILABLE
        })
    }

    pub async fn get_grant(
        &self,
        grant_id: &str,
    ) -> Result<Option<AccessGrantEntity>, &'static str> {
        self.repo.get_grant(grant_id).await.map_err(|e| {
            log::error!("patient access: get_grant failed: {e}");
            STORE_UNAVAILABLE
        })
    }

    /// Patient approves a pending request: marks it `approved` and creates a
    /// new active grant carrying the provider's details, in one atomic step.
    ///
    /// A request that is not `pending` is refused, so a double-approve cannot
    /// mint two grants.
    pub async fn approve_request(
        &self,
        request_id: &str,
        access_type: AccessType,
        expires_at: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Result<(AccessRequestEntity, AccessGrantEntity), &'static str> {
        let request = match self.get_request(request_id).await? {
            Some(r) => r,
            None => return Err(REQUEST_NOT_FOUND),
        };
        let grant = AccessGrantEntity {
            id: format!("GRANT-{}", Uuid::new_v4()),
            patient_id: request.patient_id.clone(),
            provider_id: request.provider_id.clone(),
            provider_name: request.provider_name.clone(),
            provider_role: request.provider_role.clone(),
            organization: request.organization.clone(),
            access_type: access_type.as_str().to_string(),
            granted_at: now,
            expires_at,
            status: "active".to_string(),
            last_accessed: None,
            access_count: 0,
            source_request_id: Some(request.id.clone()),
        };

        match self.repo.approve_request(request_id, grant).await {
            Ok(Some(approved)) => Ok(approved),
            // The conditional update matched nothing: the request was decided
            // between the read above and the write, or was already decided.
            Ok(None) => Err(REQUEST_ALREADY_DECIDED),
            Err(e) => {
                log::error!("patient access: approve_request failed: {e}");
                Err(STORE_UNAVAILABLE)
            }
        }
    }

    /// Approve a request, mint its grant, and persist a prebuilt audit event
    /// in the same production transaction.
    pub async fn approve_request_with_audit(
        &self,
        request_id: &str,
        access_type: AccessType,
        expires_at: Option<DateTime<Utc>>,
        event: crate::audit_outbox::AuditOutboxEvent,
        now: DateTime<Utc>,
    ) -> Result<(AccessRequestEntity, AccessGrantEntity), &'static str> {
        let request = match self.get_request(request_id).await? {
            Some(request) => request,
            None => return Err(REQUEST_NOT_FOUND),
        };
        let grant = AccessGrantEntity {
            id: event.aggregate_id.clone(),
            patient_id: request.patient_id.clone(),
            provider_id: request.provider_id.clone(),
            provider_name: request.provider_name.clone(),
            provider_role: request.provider_role.clone(),
            organization: request.organization.clone(),
            access_type: access_type.as_str().to_string(),
            granted_at: now,
            expires_at,
            status: "active".to_string(),
            last_accessed: None,
            access_count: 0,
            source_request_id: Some(request.id.clone()),
        };
        match self
            .repo
            .approve_request_with_audit(request_id, grant, event)
            .await
        {
            Ok(Some(approved)) => Ok(approved),
            Ok(None) => Err(REQUEST_ALREADY_DECIDED),
            Err(error) => {
                log::error!("patient access: approve_request_with_audit failed: {error}");
                Err(STORE_UNAVAILABLE)
            }
        }
    }

    /// Patient denies a pending request. Only a `pending` request can be denied.
    pub async fn deny_request(
        &self,
        request_id: &str,
    ) -> Result<AccessRequestEntity, &'static str> {
        match self.repo.deny_request(request_id).await {
            Ok(Some(request)) => Ok(request),
            Ok(None) => Err(self.why_request_refused(request_id).await),
            Err(e) => {
                log::error!("patient access: deny_request failed: {e}");
                Err(STORE_UNAVAILABLE)
            }
        }
    }

    /// Patient revokes an active grant. Only a grant that is active *and*
    /// unexpired can be revoked — reporting an already-lapsed grant as freshly
    /// revoked would misdescribe what happened.
    pub async fn revoke_grant(
        &self,
        grant_id: &str,
        now: DateTime<Utc>,
    ) -> Result<AccessGrantEntity, &'static str> {
        match self.repo.revoke_grant(grant_id, now).await {
            Ok(Some(grant)) => Ok(grant),
            Ok(None) => Err(self.why_grant_refused(grant_id).await),
            Err(e) => {
                log::error!("patient access: revoke_grant failed: {e}");
                Err(STORE_UNAVAILABLE)
            }
        }
    }

    /// Distinguish "no such request" from "already decided" for the caller's
    /// message only. Advisory: the row may change again after this read.
    async fn why_request_refused(&self, request_id: &str) -> &'static str {
        match self.repo.get_request(request_id).await {
            Ok(Some(_)) => REQUEST_ALREADY_DECIDED,
            Ok(None) => REQUEST_NOT_FOUND,
            Err(_) => STORE_UNAVAILABLE,
        }
    }

    async fn why_grant_refused(&self, grant_id: &str) -> &'static str {
        match self.repo.get_grant(grant_id).await {
            Ok(Some(_)) => GRANT_NOT_ACTIVE,
            Ok(None) => GRANT_NOT_FOUND,
            Err(_) => STORE_UNAVAILABLE,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::memory::MemoryPatientAccessRepository;
    use chrono::Duration;

    fn service() -> PatientAccessService {
        PatientAccessService::new(Arc::new(MemoryPatientAccessRepository::new()))
    }

    fn provider() -> RequestingProvider {
        RequestingProvider {
            provider_id: "5DoctorWallet".into(),
            provider_name: "Dr Synthetic".into(),
            provider_role: "Doctor".into(),
            organization: "Synthetic General Hospital".into(),
            reason: "Follow-up consultation".into(),
        }
    }

    #[tokio::test]
    async fn approve_creates_one_active_grant_and_is_not_replayable() {
        let svc = service();
        let now = Utc::now();
        let req = svc
            .create_request("PAT-1".into(), provider(), now)
            .await
            .unwrap();
        assert_eq!(req.status, "pending");

        let (decided, grant) = svc
            .approve_request(&req.id, AccessType::Limited, None, now)
            .await
            .unwrap();
        assert_eq!(decided.status, "approved");
        assert_eq!(grant.status, "active");
        assert_eq!(grant.patient_id, "PAT-1");
        assert_eq!(grant.source_request_id.as_deref(), Some(req.id.as_str()));
        assert_eq!(
            svc.list_grants_by_patient("PAT-1", now)
                .await
                .unwrap()
                .len(),
            1
        );

        // Replaying the approval is refused; no second grant is minted.
        assert_eq!(
            svc.approve_request(&req.id, AccessType::Limited, None, now)
                .await
                .unwrap_err(),
            REQUEST_ALREADY_DECIDED
        );
        assert_eq!(
            svc.list_grants_by_patient("PAT-1", now)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn deny_blocks_a_later_approve() {
        let svc = service();
        let now = Utc::now();
        let req = svc
            .create_request("PAT-1".into(), provider(), now)
            .await
            .unwrap();
        svc.deny_request(&req.id).await.unwrap();
        assert_eq!(
            svc.approve_request(&req.id, AccessType::Limited, None, now)
                .await
                .unwrap_err(),
            REQUEST_ALREADY_DECIDED
        );
        assert!(svc
            .list_grants_by_patient("PAT-1", now)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn revoke_is_idempotent_and_only_for_active() {
        let svc = service();
        let now = Utc::now();
        let req = svc
            .create_request("PAT-1".into(), provider(), now)
            .await
            .unwrap();
        let (_, grant) = svc
            .approve_request(&req.id, AccessType::Limited, None, now)
            .await
            .unwrap();
        svc.revoke_grant(&grant.id, now).await.unwrap();
        assert_eq!(
            svc.revoke_grant(&grant.id, now).await.unwrap_err(),
            GRANT_NOT_ACTIVE
        );
    }

    /// A grant whose window has closed is not "revoked" — it already lapsed.
    /// Reporting success here would tell the patient they had just withdrawn
    /// access that had in fact expired on its own.
    #[tokio::test]
    async fn a_lapsed_grant_cannot_be_revoked() {
        let svc = service();
        let now = Utc::now();
        let req = svc
            .create_request("PAT-1".into(), provider(), now)
            .await
            .unwrap();
        let (_, grant) = svc
            .approve_request(
                &req.id,
                AccessType::Limited,
                Some(now + Duration::hours(1)),
                now,
            )
            .await
            .unwrap();

        let later = now + Duration::hours(2);
        assert_eq!(
            svc.revoke_grant(&grant.id, later).await.unwrap_err(),
            GRANT_NOT_ACTIVE
        );
    }

    /// Expiry is applied on read, so the patient's own consent screen never
    /// shows a lapsed grant as still active.
    #[tokio::test]
    async fn listing_applies_expiry() {
        let svc = service();
        let now = Utc::now();
        let req = svc
            .create_request("PAT-1".into(), provider(), now)
            .await
            .unwrap();
        svc.approve_request(
            &req.id,
            AccessType::Limited,
            Some(now + Duration::hours(1)),
            now,
        )
        .await
        .unwrap();

        let listed = svc
            .list_grants_by_patient("PAT-1", now + Duration::hours(2))
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, "expired");
    }

    #[tokio::test]
    async fn a_reason_is_required_for_a_request() {
        let svc = service();
        let mut p = provider();
        p.reason = "   ".into();
        assert!(svc
            .create_request("PAT-1".into(), p, Utc::now())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn approving_an_unknown_request_is_not_found() {
        let svc = service();
        assert_eq!(
            svc.approve_request("REQ-nope", AccessType::Limited, None, Utc::now())
                .await
                .unwrap_err(),
            REQUEST_NOT_FOUND
        );
    }

    #[tokio::test]
    async fn grants_and_requests_are_scoped_per_patient() {
        let svc = service();
        let now = Utc::now();
        svc.create_request("PAT-1".into(), provider(), now)
            .await
            .unwrap();
        svc.create_request("PAT-2".into(), provider(), now)
            .await
            .unwrap();
        assert_eq!(
            svc.list_requests_by_patient("PAT-1").await.unwrap().len(),
            1
        );
        assert_eq!(
            svc.list_requests_by_patient("PAT-2").await.unwrap().len(),
            1
        );
        assert!(svc
            .list_requests_by_patient("PAT-3")
            .await
            .unwrap()
            .is_empty());
    }
}
