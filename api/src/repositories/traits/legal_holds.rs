//! Legal holds.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::RepositoryResult;

// =============================================================================
// Legal holds (migration 20260729000003)
//
// A litigation or regulatory hold suspends retention-based disposal for the
// records it covers. The pre-existing `data_retention_policies.legal_hold_override`
// is a policy-level boolean and cannot express "this patient's records are
// under hold for matter 2026/114", which is what a hold actually is.
// =============================================================================

/// A hold suspending retention-based disposal.
///
/// Scoped to a patient, an entity type, or both. Released holds are retained
/// rather than deleted: the period during which records were held is itself
/// part of the audit trail.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct LegalHoldEntity {
    pub id: String,
    /// `None` means the hold is not limited to one patient.
    pub patient_id: Option<String>,
    /// `None` means the hold is not limited to one entity type.
    pub entity_type: Option<String>,
    pub reason: String,
    /// Case or matter reference.
    pub reference: Option<String>,
    pub applied_by: String,
    pub applied_at: DateTime<Utc>,
    pub released_by: Option<String>,
    pub released_at: Option<DateTime<Utc>>,
    pub release_reason: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

impl LegalHoldEntity {
    /// A hold is active until it is explicitly released.
    pub fn is_active(&self) -> bool {
        self.released_at.is_none()
    }
}

/// Legal hold repository trait.
#[async_trait]
pub trait LegalHoldRepository: Send + Sync + fmt::Debug {
    async fn create(&self, hold: LegalHoldEntity) -> RepositoryResult<LegalHoldEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<LegalHoldEntity>;
    /// Every unreleased hold.
    async fn get_active(&self) -> RepositoryResult<Vec<LegalHoldEntity>>;
    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<LegalHoldEntity>>;
    /// Release a hold, recording who released it and why.
    async fn release(
        &self,
        id: &str,
        released_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<LegalHoldEntity>;
}
