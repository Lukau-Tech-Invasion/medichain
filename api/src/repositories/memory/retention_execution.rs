//! In-memory retention execution repository.
//!
//! See `repositories::traits::RetentionExecutionRepository` for why approvals,
//! restrictions, and register entries share one boundary.

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::{
    DeletionRegisterEntity, ProcessingRestrictionEntity, RepositoryError, RepositoryResult,
    RetentionApprovalEntity, RetentionExecutionRepository,
};

#[derive(Debug, Default)]
pub struct MemoryRetentionExecutionRepository {
    approvals: RwLock<HashMap<String, RetentionApprovalEntity>>,
    restrictions: RwLock<Vec<ProcessingRestrictionEntity>>,
    register: RwLock<Vec<DeletionRegisterEntity>>,
}

impl MemoryRetentionExecutionRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl RetentionExecutionRepository for MemoryRetentionExecutionRepository {
    async fn create_approval(
        &self,
        approval: RetentionApprovalEntity,
    ) -> RepositoryResult<RetentionApprovalEntity> {
        let mut approvals = self
            .approvals
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        approvals.insert(approval.token.clone(), approval.clone());
        Ok(approval)
    }

    async fn get_approval(&self, token: &str) -> RepositoryResult<RetentionApprovalEntity> {
        let approvals = self
            .approvals
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        approvals
            .get(token)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Approval {} not found", token)))
    }

    async fn list_open_approvals(&self) -> RepositoryResult<Vec<RetentionApprovalEntity>> {
        let approvals = self
            .approvals
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        let mut open: Vec<_> = approvals
            .values()
            .filter(|a| a.status == "pending" || a.status == "approved")
            .cloned()
            .collect();
        open.sort_by(|a, b| b.requested_at.cmp(&a.requested_at));
        Ok(open)
    }

    async fn decide_approval(
        &self,
        token: &str,
        approved: bool,
        decided_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<RetentionApprovalEntity> {
        let mut approvals = self
            .approvals
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        let approval = approvals
            .get_mut(token)
            .ok_or_else(|| RepositoryError::NotFound(format!("Approval {} not found", token)))?;

        // Only a pending approval can be decided. Re-deciding an executed run
        // would rewrite history.
        if approval.status != "pending" {
            return Err(RepositoryError::Validation(format!(
                "approval {} is '{}' and can no longer be decided",
                token, approval.status
            )));
        }

        approval.status = if approved { "approved" } else { "rejected" }.to_string();
        approval.approved_by = Some(decided_by.to_string());
        approval.approved_at = Some(Utc::now());
        approval.rejection_reason = reason.filter(|_| !approved);
        Ok(approval.clone())
    }

    async fn mark_executed(
        &self,
        token: &str,
        executed_by: &str,
    ) -> RepositoryResult<RetentionApprovalEntity> {
        let mut approvals = self
            .approvals
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        let approval = approvals
            .get_mut(token)
            .ok_or_else(|| RepositoryError::NotFound(format!("Approval {} not found", token)))?;

        // Checked under the write lock so two concurrent executions cannot both
        // observe an unexecuted approval and both proceed.
        if approval.executed_at.is_some() {
            return Err(RepositoryError::Validation(format!(
                "approval {} was already executed at {:?}",
                token, approval.executed_at
            )));
        }

        approval.status = "executed".to_string();
        approval.executed_by = Some(executed_by.to_string());
        approval.executed_at = Some(Utc::now());
        Ok(approval.clone())
    }

    async fn record_restriction(
        &self,
        restriction: ProcessingRestrictionEntity,
    ) -> RepositoryResult<ProcessingRestrictionEntity> {
        let mut restrictions = self
            .restrictions
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        restrictions.push(restriction.clone());
        Ok(restriction)
    }

    async fn is_restricted(&self, patient_id: &str) -> RepositoryResult<bool> {
        let restrictions = self
            .restrictions
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        Ok(restrictions
            .iter()
            .any(|r| r.patient_id == patient_id && r.is_active()))
    }

    async fn list_active_restrictions(&self) -> RepositoryResult<Vec<ProcessingRestrictionEntity>> {
        let restrictions = self
            .restrictions
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        Ok(restrictions
            .iter()
            .filter(|r| r.is_active())
            .cloned()
            .collect())
    }

    async fn lift_restriction(
        &self,
        id: &str,
        lifted_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<ProcessingRestrictionEntity> {
        let mut restrictions = self
            .restrictions
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        let restriction = restrictions
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Restriction {} not found", id)))?;

        restriction.lifted_by = Some(lifted_by.to_string());
        restriction.lifted_at = Some(Utc::now());
        restriction.lift_reason = reason;
        Ok(restriction.clone())
    }

    async fn append_register_entry(
        &self,
        entry: DeletionRegisterEntity,
    ) -> RepositoryResult<DeletionRegisterEntity> {
        let mut register = self
            .register
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        register.push(entry.clone());
        Ok(entry)
    }

    async fn list_register(&self, limit: i64) -> RepositoryResult<Vec<DeletionRegisterEntity>> {
        let register = self
            .register
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        Ok(register
            .iter()
            .rev()
            .take(limit.max(0) as usize)
            .cloned()
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn approval(token: &str) -> RetentionApprovalEntity {
        RetentionApprovalEntity {
            token: token.to_string(),
            assessment_digest: "a".repeat(64),
            assessed_on: Utc::now().date_naive(),
            due_count: 3,
            requested_by: "admin".to_string(),
            requested_at: Utc::now(),
            approved_by: None,
            approved_at: None,
            executed_by: None,
            executed_at: None,
            status: "pending".to_string(),
            expires_at: Utc::now() + Duration::hours(24),
            rejection_reason: None,
        }
    }

    #[tokio::test]
    async fn pending_approval_is_not_executable_until_approved() {
        let repo = MemoryRetentionExecutionRepository::new();
        repo.create_approval(approval("T-1")).await.unwrap();

        let pending = repo.get_approval("T-1").await.unwrap();
        assert!(!pending.is_executable(Utc::now()));

        repo.decide_approval("T-1", true, "admin", None)
            .await
            .unwrap();
        let approved = repo.get_approval("T-1").await.unwrap();
        assert!(approved.is_executable(Utc::now()));
    }

    /// Replaying an execution request must not restrict the same records twice.
    #[tokio::test]
    async fn an_approval_can_only_be_executed_once() {
        let repo = MemoryRetentionExecutionRepository::new();
        repo.create_approval(approval("T-2")).await.unwrap();
        repo.decide_approval("T-2", true, "admin", None)
            .await
            .unwrap();

        repo.mark_executed("T-2", "admin").await.unwrap();
        assert!(repo.mark_executed("T-2", "admin").await.is_err());
    }

    #[tokio::test]
    async fn rejected_approval_is_not_executable() {
        let repo = MemoryRetentionExecutionRepository::new();
        repo.create_approval(approval("T-3")).await.unwrap();
        repo.decide_approval("T-3", false, "admin", Some("periods unconfirmed".into()))
            .await
            .unwrap();

        let rejected = repo.get_approval("T-3").await.unwrap();
        assert!(!rejected.is_executable(Utc::now()));
        assert_eq!(
            rejected.rejection_reason.as_deref(),
            Some("periods unconfirmed")
        );
    }

    /// An approval that sat unused past its expiry describes a record set that
    /// has since drifted, so it must not execute.
    #[tokio::test]
    async fn expired_approval_is_not_executable() {
        let repo = MemoryRetentionExecutionRepository::new();
        let mut stale = approval("T-4");
        stale.expires_at = Utc::now() - Duration::hours(1);
        repo.create_approval(stale).await.unwrap();
        repo.decide_approval("T-4", true, "admin", None)
            .await
            .unwrap();

        let approved = repo.get_approval("T-4").await.unwrap();
        assert!(!approved.is_executable(Utc::now()));
    }

    /// A decision is a one-time act; re-deciding would rewrite the record of
    /// what was authorised.
    #[tokio::test]
    async fn a_decided_approval_cannot_be_decided_again() {
        let repo = MemoryRetentionExecutionRepository::new();
        repo.create_approval(approval("T-5")).await.unwrap();
        repo.decide_approval("T-5", true, "admin", None)
            .await
            .unwrap();

        assert!(repo
            .decide_approval("T-5", false, "admin", None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn restriction_is_active_until_lifted() {
        let repo = MemoryRetentionExecutionRepository::new();
        repo.record_restriction(ProcessingRestrictionEntity {
            id: "PR-1".to_string(),
            patient_id: "PAT-1".to_string(),
            entity_type: "clinical_record".to_string(),
            reason: "retention period elapsed".to_string(),
            policy_id: Some("RET-CLINICAL-ORDINARY".to_string()),
            approval_token: Some("T-1".to_string()),
            restricted_by: "admin".to_string(),
            restricted_at: Utc::now(),
            lifted_by: None,
            lifted_at: None,
            lift_reason: None,
        })
        .await
        .unwrap();

        assert!(repo.is_restricted("PAT-1").await.unwrap());
        assert!(!repo.is_restricted("PAT-2").await.unwrap());

        repo.lift_restriction("PR-1", "admin", Some("hold placed".into()))
            .await
            .unwrap();

        assert!(!repo.is_restricted("PAT-1").await.unwrap());
        // Lifting is not deletion: the fact it was restricted survives.
        assert_eq!(repo.list_active_restrictions().await.unwrap().len(), 0);
    }
}
