//! In-memory implementation of the persistent guardian-relationship repository.
//!
//! Supersedes the Horizon HZ-008 `guardian_relationships::GuardianRegistry`
//! (still an `RwLock<HashMap>`, but now behind the standard repository trait
//! so the PostgreSQL implementation is a drop-in swap, matching every other
//! entity in this codebase).

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::{
    GuardianRelationshipEntity, GuardianRelationshipRepository, RepositoryError, RepositoryResult,
};

#[derive(Debug, Default)]
pub struct MemoryGuardianRelationshipRepository {
    relationships: RwLock<HashMap<String, GuardianRelationshipEntity>>,
}

impl MemoryGuardianRelationshipRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl GuardianRelationshipRepository for MemoryGuardianRelationshipRepository {
    async fn create(
        &self,
        relationship: GuardianRelationshipEntity,
    ) -> RepositoryResult<GuardianRelationshipEntity> {
        let mut relationships = self.relationships.write().map_err(|_| {
            RepositoryError::Internal("guardian relationship store poisoned".into())
        })?;
        relationships.insert(relationship.id.clone(), relationship.clone());
        Ok(relationship)
    }

    async fn get_by_ward(
        &self,
        ward_patient_id: &str,
    ) -> RepositoryResult<Vec<GuardianRelationshipEntity>> {
        let relationships = self.relationships.read().map_err(|_| {
            RepositoryError::Internal("guardian relationship store poisoned".into())
        })?;
        Ok(relationships
            .values()
            .filter(|r| r.ward_patient_id == ward_patient_id)
            .cloned()
            .collect())
    }

    async fn get_by_guardian(
        &self,
        guardian_wallet: &str,
    ) -> RepositoryResult<Vec<GuardianRelationshipEntity>> {
        let relationships = self.relationships.read().map_err(|_| {
            RepositoryError::Internal("guardian relationship store poisoned".into())
        })?;
        Ok(relationships
            .values()
            .filter(|r| r.guardian_wallet == guardian_wallet)
            .cloned()
            .collect())
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<GuardianRelationshipEntity>> {
        let relationships = self.relationships.read().map_err(|_| {
            RepositoryError::Internal("guardian relationship store poisoned".into())
        })?;
        Ok(relationships.get(id).cloned())
    }

    async fn update_permissions(
        &self,
        id: &str,
        permissions: Vec<String>,
        expires_at: Option<chrono::DateTime<Utc>>,
    ) -> RepositoryResult<GuardianRelationshipEntity> {
        let mut relationships = self.relationships.write().map_err(|_| {
            RepositoryError::Internal("guardian relationship store poisoned".into())
        })?;
        let relationship = relationships
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(id.to_string()))?;
        relationship.permissions = permissions;
        relationship.expires_at = expires_at;
        Ok(relationship.clone())
    }

    async fn update_permissions_with_audit(
        &self,
        id: &str,
        permissions: Vec<String>,
        expires_at: Option<chrono::DateTime<Utc>>,
        _event: crate::audit_outbox::AuditOutboxEvent,
    ) -> RepositoryResult<GuardianRelationshipEntity> {
        self.update_permissions(id, permissions, expires_at).await
    }

    async fn revoke(&self, id: &str, reason: Option<String>) -> RepositoryResult<()> {
        let mut relationships = self.relationships.write().map_err(|_| {
            RepositoryError::Internal("guardian relationship store poisoned".into())
        })?;
        let relationship = relationships
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(id.to_string()))?;
        relationship.active = false;
        relationship.revoked_at = Some(Utc::now());
        relationship.revoked_reason = reason;
        Ok(())
    }

    async fn revoke_with_audit(
        &self,
        id: &str,
        reason: Option<String>,
        _event: crate::audit_outbox::AuditOutboxEvent,
    ) -> RepositoryResult<()> {
        self.revoke(id, reason).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::traits::GuardianPermission;
    use uuid::Uuid;

    fn new_relationship(permissions: Vec<&str>) -> GuardianRelationshipEntity {
        GuardianRelationshipEntity {
            id: Uuid::new_v4().to_string(),
            guardian_wallet: "guardian_wallet".into(),
            ward_patient_id: "ward_patient_id".into(),
            relationship_type: "parent_or_guardian".into(),
            permissions: permissions.into_iter().map(String::from).collect(),
            verified_by: "admin_wallet".into(),
            verified_at: Utc::now(),
            active: true,
            expires_at: None,
            revoked_at: None,
            revoked_reason: None,
            authority_evidence_type: None,
            authority_evidence_reference: None,
            authority_issuing_authority: None,
            authority_verified_by_role: None,
            authority_evidence_recorded_at: None,
            next_reverification_due: None,
            child_assent_status: None,
            child_assent_recorded_at: None,
            child_assent_notes: None,
            supersedes_relationship_id: None,
            dispute_flag: false,
            dispute_notes: None,
        }
    }

    #[actix_web::test]
    async fn created_relationship_grants_only_its_listed_permissions() {
        let repo = MemoryGuardianRelationshipRepository::new();
        let relationship = new_relationship(vec!["view_records"]);
        repo.create(relationship.clone()).await.unwrap();

        let stored = repo
            .get_by_id(&relationship.id)
            .await
            .unwrap()
            .expect("relationship should exist");
        assert!(stored.grants(GuardianPermission::ViewRecords, Utc::now()));
        assert!(!stored.grants(GuardianPermission::GiveConsent, Utc::now()));
    }

    #[actix_web::test]
    async fn revoked_relationship_grants_nothing() {
        let repo = MemoryGuardianRelationshipRepository::new();
        let relationship = new_relationship(vec!["view_records", "give_consent"]);
        repo.create(relationship.clone()).await.unwrap();
        repo.revoke(&relationship.id, Some("guardianship terminated".into()))
            .await
            .unwrap();

        let stored = repo.get_by_id(&relationship.id).await.unwrap().unwrap();
        assert!(!stored.active);
        assert!(!stored.grants(GuardianPermission::ViewRecords, Utc::now()));
    }

    #[actix_web::test]
    async fn expired_relationship_grants_nothing() {
        let repo = MemoryGuardianRelationshipRepository::new();
        let mut relationship = new_relationship(vec!["view_records"]);
        relationship.expires_at = Some(Utc::now() - chrono::Duration::minutes(1));
        repo.create(relationship.clone()).await.unwrap();

        let stored = repo.get_by_id(&relationship.id).await.unwrap().unwrap();
        assert!(!stored.grants(GuardianPermission::ViewRecords, Utc::now()));
    }

    #[actix_web::test]
    async fn update_permissions_changes_only_the_targeted_relationship() {
        let repo = MemoryGuardianRelationshipRepository::new();
        let relationship = new_relationship(vec!["view_records"]);
        repo.create(relationship.clone()).await.unwrap();

        let updated = repo
            .update_permissions(
                &relationship.id,
                vec!["view_records".into(), "give_consent".into()],
                None,
            )
            .await
            .unwrap();
        assert!(updated.grants(GuardianPermission::GiveConsent, Utc::now()));
    }

    #[actix_web::test]
    async fn get_by_guardian_drives_the_my_children_list() {
        let repo = MemoryGuardianRelationshipRepository::new();
        repo.create(new_relationship(vec!["view_records"]))
            .await
            .unwrap();
        let mut other_ward = new_relationship(vec!["view_records"]);
        other_ward.ward_patient_id = "another_ward".into();
        repo.create(other_ward).await.unwrap();

        let children = repo.get_by_guardian("guardian_wallet").await.unwrap();
        assert_eq!(children.len(), 2);
    }
}
