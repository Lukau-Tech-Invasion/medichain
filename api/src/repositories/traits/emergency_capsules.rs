//! The emergency capsule and its access record.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::RepositoryResult;

/// A stored emergency capsule version (Horizon HZ-003).
///
/// The plaintext values live only inside `capsule_encrypted`; everything else
/// on this row is metadata that must be queryable without decrypting.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct EmergencyCapsuleEntity {
    pub patient_id: String,
    pub version: i32,
    /// Hex-encoded SHA3-256 commitment, recorded in the sealed audit stream.
    pub commitment: String,
    #[serde(skip_serializing)]
    pub capsule_encrypted: Vec<u8>,
    pub key_version: i32,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub revoked_by: Option<String>,
    pub revocation_reason: Option<String>,
    /// Where this version's published commitment is in the sealed audit stream:
    /// `pending`, `sealed` or `exported`. Derived on read from the audit event
    /// that records the publication; never stored on the capsule row, and never
    /// written by callers (they pass `pending`).
    #[cfg_attr(feature = "postgres", sqlx(default))]
    pub seal_status: String,
}

impl EmergencyCapsuleEntity {
    /// A capsule is live until explicitly revoked.
    pub fn is_live(&self) -> bool {
        self.revoked_at.is_none()
    }
}

/// One break-glass read of a capsule.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct EmergencyCapsuleAccessEntity {
    pub id: String,
    pub patient_id: String,
    /// `None` when no capsule existed to read — still recorded, because a
    /// failed break-glass attempt is an access attempt.
    pub capsule_version: Option<i32>,
    pub accessed_by: String,
    /// The emergency grant under which the read happened.
    pub grant_id: Option<String>,
    pub reason_code: String,
    pub reason_text: Option<String>,
    /// Fields actually returned to the caller.
    pub fields_revealed: Vec<String>,
    /// Whether the capsule still matched its own commitment at read time.
    pub commitment_verified: bool,
    pub accessed_at: DateTime<Utc>,
}

/// Emergency capsule repository trait.
///
/// Capsules are append-only: `put` adds a new version rather than mutating an
/// existing one, and `revoke` marks a version dead without removing it. There
/// is deliberately no `update` and no `delete` — an emergency directive's
/// history is part of the clinical record.
#[async_trait]
pub trait EmergencyCapsuleRepository: Send + Sync + fmt::Debug {
    /// Store a new capsule version.
    ///
    /// Must reject a version that is not strictly greater than the newest
    /// stored version for that patient.
    async fn put(
        &self,
        capsule: EmergencyCapsuleEntity,
    ) -> RepositoryResult<EmergencyCapsuleEntity>;

    /// Newest non-revoked capsule for a patient, if any.
    async fn current(&self, patient_id: &str) -> RepositoryResult<Option<EmergencyCapsuleEntity>>;

    /// Newest version number stored for a patient, revoked or not.
    ///
    /// Used to allocate the next version. Counts revoked versions so a revoked
    /// version number is never reissued.
    async fn latest_version(&self, patient_id: &str) -> RepositoryResult<i32>;

    /// Every stored version, newest first.
    async fn history(&self, patient_id: &str) -> RepositoryResult<Vec<EmergencyCapsuleEntity>>;

    /// Mark a version revoked.
    async fn revoke(
        &self,
        patient_id: &str,
        version: i32,
        revoked_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<EmergencyCapsuleEntity>;

    /// Append a break-glass access record.
    async fn log_access(
        &self,
        access: EmergencyCapsuleAccessEntity,
    ) -> RepositoryResult<EmergencyCapsuleAccessEntity>;

    /// Access history for a patient, newest first.
    async fn access_history(
        &self,
        patient_id: &str,
        limit: i64,
    ) -> RepositoryResult<Vec<EmergencyCapsuleAccessEntity>>;
}
