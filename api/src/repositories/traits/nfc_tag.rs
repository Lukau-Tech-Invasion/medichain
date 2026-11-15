//! NFC tags.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{PaginatedResult, Pagination, RepositoryResult};

/// The status a stored card carries when the row predates the `status` column.
///
/// Every such row was written by a code path that could only produce an active
/// card, so this is the true value for all of them rather than a placeholder.
fn default_tag_status() -> String {
    "Active".to_string()
}

/// NFC tag entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct NfcTagEntity {
    pub id: String,
    pub tag_uid: String,
    pub patient_id: String,
    pub tag_type: String,
    pub is_active: bool,
    /// Why the card is or is not usable: `Active`, `Suspended`, `Revoked` or
    /// `Expired`.
    ///
    /// `is_active` stays the predicate every existing reader asks, and this
    /// narrows it to the reason. A boolean cannot tell a suspended card, which
    /// an administrator can reinstate, from a revoked one, which nobody can --
    /// and collapsing the two loses the difference permanently the first time a
    /// card is read back from storage.
    #[serde(default = "default_tag_status")]
    pub status: String,
    #[serde(skip_serializing)]
    pub pin_hash: Option<String>,
    pub issued_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub use_count: i32,
    pub issued_by: Option<String>,
}

/// NFC tag repository trait
#[async_trait]
pub trait NfcTagRepository: Send + Sync + fmt::Debug {
    /// Create a new NFC tag
    async fn create(&self, tag: NfcTagEntity) -> RepositoryResult<NfcTagEntity>;

    /// Get tag by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<NfcTagEntity>;

    /// Get tag by UID
    async fn get_by_uid(&self, uid: &str) -> RepositoryResult<NfcTagEntity>;

    /// Get tags for a patient
    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<NfcTagEntity>>;

    /// Get active tag for a patient
    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<NfcTagEntity>>;

    /// Update tag
    async fn update(&self, tag: NfcTagEntity) -> RepositoryResult<NfcTagEntity>;

    /// Deactivate tag
    async fn deactivate(&self, id: &str) -> RepositoryResult<()>;

    /// Record tag usage
    async fn record_usage(&self, id: &str) -> RepositoryResult<()>;

    /// List all tags
    async fn list(&self, pagination: Pagination)
        -> RepositoryResult<PaginatedResult<NfcTagEntity>>;
    /// How many cards are in each `status`, across every patient.
    async fn count_by_status(&self) -> RepositoryResult<Vec<(String, u64)>>;
}
