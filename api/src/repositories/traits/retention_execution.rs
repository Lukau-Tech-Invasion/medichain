//! Approval-gated retention execution.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::RepositoryResult;

/// An operator's authorisation to execute one specific retention assessment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct RetentionApprovalEntity {
    pub token: String,
    /// SHA3-256 over the assessment this token authorises. Re-derived at
    /// execution; a mismatch means the record set moved and the approval no
    /// longer describes what would happen.
    pub assessment_digest: String,
    pub assessed_on: chrono::NaiveDate,
    pub due_count: i32,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub executed_by: Option<String>,
    pub executed_at: Option<DateTime<Utc>>,
    /// `pending` | `approved` | `executed` | `rejected` | `expired`
    pub status: String,
    pub expires_at: DateTime<Utc>,
    pub rejection_reason: Option<String>,
}

impl RetentionApprovalEntity {
    /// Whether this token may still be executed at `now`.
    pub fn is_executable(&self, now: DateTime<Utc>) -> bool {
        self.status == "approved" && self.executed_at.is_none() && now < self.expires_at
    }
}

/// A POPIA processing restriction: the record is retained, but processing is
/// limited to storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ProcessingRestrictionEntity {
    pub id: String,
    pub patient_id: String,
    pub entity_type: String,
    pub reason: String,
    pub policy_id: Option<String>,
    pub approval_token: Option<String>,
    pub restricted_by: String,
    pub restricted_at: DateTime<Utc>,
    pub lifted_by: Option<String>,
    pub lifted_at: Option<DateTime<Utc>>,
    pub lift_reason: Option<String>,
}

impl ProcessingRestrictionEntity {
    pub fn is_active(&self) -> bool {
        self.lifted_at.is_none()
    }
}

/// Evidence that a retention decision was carried out.
///
/// Deliberately carries no clinical payload — a register that copied a record's
/// contents to prove the record was disposed of would defeat the disposal.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct DeletionRegisterEntity {
    pub id: String,
    pub patient_id: String,
    pub entity_type: String,
    /// `restricted` today; `deleted`/`de_identified` reserved for destructive
    /// execution, which is not built.
    pub action: String,
    pub policy_id: Option<String>,
    pub policy_name: Option<String>,
    /// Why the record was due, in the evaluator's terms.
    pub basis: String,
    pub approval_token: Option<String>,
    pub executed_by: String,
    pub executed_at: DateTime<Utc>,
}

/// Retention execution repository.
///
/// One trait rather than three because approvals, restrictions, and register
/// entries are a single aggregate: a restriction without the approval that
/// authorised it, or a register entry without either, is not a meaningful
/// record. Keeping them behind one boundary makes it impossible to persist one
/// without access to the others.
#[async_trait]
pub trait RetentionExecutionRepository: Send + Sync + fmt::Debug {
    async fn create_approval(
        &self,
        approval: RetentionApprovalEntity,
    ) -> RepositoryResult<RetentionApprovalEntity>;

    async fn get_approval(&self, token: &str) -> RepositoryResult<RetentionApprovalEntity>;

    /// Approvals that are still pending or approved, newest first.
    async fn list_open_approvals(&self) -> RepositoryResult<Vec<RetentionApprovalEntity>>;

    /// Move a `pending` approval to `approved` or `rejected`.
    async fn decide_approval(
        &self,
        token: &str,
        approved: bool,
        decided_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<RetentionApprovalEntity>;

    /// Mark an approval executed. Must fail if it was already executed, so a
    /// replayed request cannot restrict the same records twice.
    async fn mark_executed(
        &self,
        token: &str,
        executed_by: &str,
    ) -> RepositoryResult<RetentionApprovalEntity>;

    async fn record_restriction(
        &self,
        restriction: ProcessingRestrictionEntity,
    ) -> RepositoryResult<ProcessingRestrictionEntity>;

    /// Whether this patient currently has any unlifted restriction.
    async fn is_restricted(&self, patient_id: &str) -> RepositoryResult<bool>;

    async fn list_active_restrictions(&self) -> RepositoryResult<Vec<ProcessingRestrictionEntity>>;

    async fn lift_restriction(
        &self,
        id: &str,
        lifted_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<ProcessingRestrictionEntity>;

    async fn append_register_entry(
        &self,
        entry: DeletionRegisterEntity,
    ) -> RepositoryResult<DeletionRegisterEntity>;

    async fn list_register(&self, limit: i64) -> RepositoryResult<Vec<DeletionRegisterEntity>>;
}
