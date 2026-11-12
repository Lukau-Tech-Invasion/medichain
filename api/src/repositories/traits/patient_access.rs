//! Patient-controlled access requests and grants.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::RepositoryResult;

// =============================================================================
// Patient-controlled access requests and grants (migration 20260809000001)
//
// The consent-based counterpart to emergency (break-glass) grants: a provider
// requests access, the patient approves — minting a standing grant — or denies,
// and revokes at will. See `crate::patient_access` for the state machine that
// drives these operations.
// =============================================================================

// The response shapes below are serialized `camelCase` on purpose: the
// patient-app Consent Management page reads `providerName`, `accessType`,
// `grantedAt`, `accessCount`, … . A serde rename mismatch here would leave the
// UI rendering `undefined`, so do not drop `rename_all`.

/// A provider's request for standing access, awaiting the patient's decision.
///
/// `patient_id` is internal (used for ownership checks) and never serialized.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
#[serde(rename_all = "camelCase")]
pub struct AccessRequestEntity {
    pub id: String,
    #[serde(skip)]
    pub patient_id: String,
    pub provider_id: String,
    pub provider_name: String,
    pub provider_role: String,
    pub organization: String,
    pub requested_at: DateTime<Utc>,
    pub reason: String,
    /// `pending` | `approved` | `denied`
    pub status: String,
}

/// A standing access grant the patient has approved.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
#[serde(rename_all = "camelCase")]
pub struct AccessGrantEntity {
    pub id: String,
    #[serde(skip)]
    pub patient_id: String,
    pub provider_id: String,
    pub provider_name: String,
    pub provider_role: String,
    pub organization: String,
    /// `full` | `limited` | `emergency`
    pub access_type: String,
    pub granted_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    /// `active` | `expired` | `revoked`
    pub status: String,
    pub last_accessed: Option<DateTime<Utc>>,
    pub access_count: i32,
    /// The request this grant was minted from, when there was one.
    #[serde(skip)]
    pub source_request_id: Option<String>,
}

impl AccessGrantEntity {
    /// Whether this grant actually authorises access at `now` — active, and
    /// (if time-limited) not yet expired.
    ///
    /// The stored `status` alone is not sufficient: expiry is applied lazily,
    /// so a row can still read `active` after its `expires_at` has passed.
    pub fn is_effective(&self, now: DateTime<Utc>) -> bool {
        self.status == "active" && self.expires_at.map(|e| e > now).unwrap_or(true)
    }
}

/// Patient access repository.
///
/// Storage only — the state machine (validation, identifier generation,
/// which transitions are legal) lives in `crate::patient_access`. What *is*
/// here is atomicity: every transition is expressed as a conditional update
/// returning `None` when the row was no longer in the expected state, because
/// a read-then-write in the caller would let two concurrent approvals mint two
/// grants for one request.
#[async_trait]
pub trait PatientAccessRepository: Send + Sync + fmt::Debug {
    async fn create_request(
        &self,
        request: AccessRequestEntity,
    ) -> RepositoryResult<AccessRequestEntity>;

    /// Atomically persist a newly-created access request and its mandatory
    /// audit-outbox event. PostgreSQL implementations must use one database
    /// transaction; memory implementations retain demo semantics.
    async fn create_request_with_audit(
        &self,
        request: AccessRequestEntity,
        event: crate::audit_outbox::AuditEvent,
    ) -> RepositoryResult<AccessRequestEntity>;

    async fn get_request(&self, id: &str) -> RepositoryResult<Option<AccessRequestEntity>>;

    /// This patient's requests, newest first.
    async fn list_requests_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<AccessRequestEntity>>;

    /// Atomically move a `pending` request to `approved` and insert `grant`,
    /// so an approved request can never exist without the grant it minted.
    ///
    /// `Ok(None)` means the request was not pending — a replayed approval, or
    /// one that lost the race — and nothing was written.
    async fn approve_request(
        &self,
        request_id: &str,
        grant: AccessGrantEntity,
    ) -> RepositoryResult<Option<(AccessRequestEntity, AccessGrantEntity)>>;

    /// Atomically approve a request, mint its grant, and persist the mandatory
    /// audit-outbox event. PostgreSQL implementations must commit all three
    /// writes together; memory implementations retain demo semantics.
    async fn approve_request_with_audit(
        &self,
        request_id: &str,
        grant: AccessGrantEntity,
        event: crate::audit_outbox::AuditEvent,
    ) -> RepositoryResult<Option<(AccessRequestEntity, AccessGrantEntity)>>;

    /// Atomically move a `pending` request to `denied`. `Ok(None)` when it was
    /// already decided.
    async fn deny_request(&self, request_id: &str)
        -> RepositoryResult<Option<AccessRequestEntity>>;

    /// Atomically deny a request and persist the mandatory audit-outbox event.
    async fn deny_request_with_audit(
        &self,
        request_id: &str,
        event: crate::audit_outbox::AuditEvent,
    ) -> RepositoryResult<Option<AccessRequestEntity>>;

    async fn get_grant(&self, id: &str) -> RepositoryResult<Option<AccessGrantEntity>>;

    /// This patient's grants, newest first, with lazy expiry applied first so a
    /// caller never sees an `active` grant whose `expires_at` has passed.
    async fn list_grants_by_patient(
        &self,
        patient_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Vec<AccessGrantEntity>>;

    /// Atomically revoke a grant that is active *and* unexpired at `now`.
    /// `Ok(None)` when it was already revoked, or had already lapsed.
    async fn revoke_grant(
        &self,
        grant_id: &str,
        now: DateTime<Utc>,
    ) -> RepositoryResult<Option<AccessGrantEntity>>;

    /// Atomically revoke a grant and persist the mandatory audit-outbox event.
    async fn revoke_grant_with_audit(
        &self,
        grant_id: &str,
        now: DateTime<Utc>,
        event: crate::audit_outbox::AuditEvent,
    ) -> RepositoryResult<Option<AccessGrantEntity>>;
}
