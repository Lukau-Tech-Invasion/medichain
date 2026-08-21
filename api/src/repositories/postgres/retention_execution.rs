//! PostgreSQL retention execution repository.
//!
//! See `repositories::memory::retention_execution` for the design rationale.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres};

use crate::repositories::traits::{
    DeletionRegisterEntity, ProcessingRestrictionEntity, RepositoryError, RepositoryResult,
    RetentionApprovalEntity, RetentionExecutionRepository,
};

#[derive(Debug, Clone)]
pub struct PgRetentionExecutionRepository {
    pool: PgPool,
}

impl PgRetentionExecutionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const APPROVAL_COLUMNS: &str = "token, assessment_digest, assessed_on, due_count, requested_by, \
    requested_at, approved_by, approved_at, executed_by, executed_at, status, expires_at, \
    rejection_reason";

const RESTRICTION_COLUMNS: &str = "id, patient_id, entity_type, reason, policy_id, \
    approval_token, restricted_by, restricted_at, lifted_by, lifted_at, lift_reason";

const REGISTER_COLUMNS: &str = "id, patient_id, entity_type, action, policy_id, policy_name, \
    basis, approval_token, executed_by, executed_at";

#[async_trait]
impl RetentionExecutionRepository for PgRetentionExecutionRepository {
    async fn create_approval(
        &self,
        approval: RetentionApprovalEntity,
    ) -> RepositoryResult<RetentionApprovalEntity> {
        let result = sqlx::query_as::<Postgres, RetentionApprovalEntity>(&format!(
            "INSERT INTO retention_approvals
                (token, assessment_digest, assessed_on, due_count, requested_by, requested_at,
                 status, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING {APPROVAL_COLUMNS}"
        ))
        .bind(&approval.token)
        .bind(&approval.assessment_digest)
        .bind(approval.assessed_on)
        .bind(approval.due_count)
        .bind(&approval.requested_by)
        .bind(approval.requested_at)
        .bind(&approval.status)
        .bind(approval.expires_at)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn get_approval(&self, token: &str) -> RepositoryResult<RetentionApprovalEntity> {
        let result = sqlx::query_as::<Postgres, RetentionApprovalEntity>(&format!(
            "SELECT {APPROVAL_COLUMNS} FROM retention_approvals WHERE token = $1"
        ))
        .bind(token)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn list_open_approvals(&self) -> RepositoryResult<Vec<RetentionApprovalEntity>> {
        let result = sqlx::query_as::<Postgres, RetentionApprovalEntity>(&format!(
            "SELECT {APPROVAL_COLUMNS} FROM retention_approvals
             WHERE status IN ('pending', 'approved')
             ORDER BY requested_at DESC"
        ))
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }

    async fn decide_approval(
        &self,
        token: &str,
        approved: bool,
        decided_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<RetentionApprovalEntity> {
        // `status = 'pending'` in the WHERE clause makes the state transition
        // atomic: two concurrent decisions cannot both succeed, and an executed
        // run cannot be retroactively re-decided.
        let result = sqlx::query_as::<Postgres, RetentionApprovalEntity>(&format!(
            "UPDATE retention_approvals
             SET status = $2, approved_by = $3, approved_at = NOW(), rejection_reason = $4
             WHERE token = $1
               AND status = 'pending'
               AND requested_by <> $3
             RETURNING {APPROVAL_COLUMNS}"
        ))
        .bind(token)
        .bind(if approved { "approved" } else { "rejected" })
        .bind(decided_by)
        .bind(reason.filter(|_| !approved))
        .fetch_optional(&self.pool)
        .await?;

        result.ok_or_else(|| {
            RepositoryError::Validation(format!(
                "approval {} does not exist or is no longer pending",
                token
            ))
        })
    }

    async fn mark_executed(
        &self,
        token: &str,
        executed_by: &str,
    ) -> RepositoryResult<RetentionApprovalEntity> {
        // `executed_at IS NULL` is the idempotency guard: a replayed execution
        // request finds no row to update and is refused rather than restricting
        // the same records twice.
        let result = sqlx::query_as::<Postgres, RetentionApprovalEntity>(&format!(
            "UPDATE retention_approvals
             SET status = 'executed', executed_by = $2, executed_at = NOW()
             WHERE token = $1 AND status = 'approved' AND executed_at IS NULL
             RETURNING {APPROVAL_COLUMNS}"
        ))
        .bind(token)
        .bind(executed_by)
        .fetch_optional(&self.pool)
        .await?;

        result.ok_or_else(|| {
            RepositoryError::Validation(format!(
                "approval {} is not in an executable state (missing, unapproved, or already \
                 executed)",
                token
            ))
        })
    }

    async fn record_restriction(
        &self,
        restriction: ProcessingRestrictionEntity,
    ) -> RepositoryResult<ProcessingRestrictionEntity> {
        let result = sqlx::query_as::<Postgres, ProcessingRestrictionEntity>(&format!(
            "INSERT INTO processing_restrictions
                (id, patient_id, entity_type, reason, policy_id, approval_token,
                 restricted_by, restricted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING {RESTRICTION_COLUMNS}"
        ))
        .bind(&restriction.id)
        .bind(&restriction.patient_id)
        .bind(&restriction.entity_type)
        .bind(&restriction.reason)
        .bind(&restriction.policy_id)
        .bind(&restriction.approval_token)
        .bind(&restriction.restricted_by)
        .bind(restriction.restricted_at)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn is_restricted(&self, patient_id: &str) -> RepositoryResult<bool> {
        let restricted: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                 SELECT 1 FROM processing_restrictions
                 WHERE patient_id = $1 AND lifted_at IS NULL
             )",
        )
        .bind(patient_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(restricted)
    }

    async fn list_active_restrictions(&self) -> RepositoryResult<Vec<ProcessingRestrictionEntity>> {
        let result = sqlx::query_as::<Postgres, ProcessingRestrictionEntity>(&format!(
            "SELECT {RESTRICTION_COLUMNS} FROM processing_restrictions
             WHERE lifted_at IS NULL
             ORDER BY restricted_at DESC"
        ))
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }

    async fn lift_restriction(
        &self,
        id: &str,
        lifted_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<ProcessingRestrictionEntity> {
        let result = sqlx::query_as::<Postgres, ProcessingRestrictionEntity>(&format!(
            "UPDATE processing_restrictions
             SET lifted_by = $2, lifted_at = NOW(), lift_reason = $3
             WHERE id = $1 AND lifted_at IS NULL
             RETURNING {RESTRICTION_COLUMNS}"
        ))
        .bind(id)
        .bind(lifted_by)
        .bind(&reason)
        .fetch_optional(&self.pool)
        .await?;

        result.ok_or_else(|| {
            RepositoryError::NotFound(format!("Restriction {} not found or already lifted", id))
        })
    }

    async fn append_register_entry(
        &self,
        entry: DeletionRegisterEntity,
    ) -> RepositoryResult<DeletionRegisterEntity> {
        let result = sqlx::query_as::<Postgres, DeletionRegisterEntity>(&format!(
            "INSERT INTO deletion_register
                (id, patient_id, entity_type, action, policy_id, policy_name, basis,
                 approval_token, executed_by, executed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING {REGISTER_COLUMNS}"
        ))
        .bind(&entry.id)
        .bind(&entry.patient_id)
        .bind(&entry.entity_type)
        .bind(&entry.action)
        .bind(&entry.policy_id)
        .bind(&entry.policy_name)
        .bind(&entry.basis)
        .bind(&entry.approval_token)
        .bind(&entry.executed_by)
        .bind(entry.executed_at)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn list_register(&self, limit: i64) -> RepositoryResult<Vec<DeletionRegisterEntity>> {
        let result = sqlx::query_as::<Postgres, DeletionRegisterEntity>(&format!(
            "SELECT {REGISTER_COLUMNS} FROM deletion_register
             ORDER BY executed_at DESC
             LIMIT $1"
        ))
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }
}
