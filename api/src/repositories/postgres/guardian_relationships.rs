//! PostgreSQL implementation of the persistent guardian-relationship repository.
//!
//! See `repositories::memory::guardian_relationships` for the design rationale
//! (supersedes the Horizon HZ-008 in-memory `GuardianRegistry`).

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{PgPool, Postgres};

use crate::repositories::traits::{
    GuardianRelationshipEntity, GuardianRelationshipRepository, RepositoryResult,
};

#[derive(Debug, Clone)]
pub struct PgGuardianRelationshipRepository {
    pool: PgPool,
}

impl PgGuardianRelationshipRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const SELECT_COLUMNS: &str = "id, guardian_wallet, ward_patient_id, relationship_type, \
    permissions, verified_by, verified_at, active, expires_at, revoked_at, revoked_reason, \
    authority_evidence_type, authority_evidence_reference, authority_issuing_authority, \
    authority_verified_by_role, authority_evidence_recorded_at, next_reverification_due, \
    child_assent_status, child_assent_recorded_at, child_assent_notes, \
    supersedes_relationship_id, dispute_flag, dispute_notes";

#[async_trait]
impl GuardianRelationshipRepository for PgGuardianRelationshipRepository {
    async fn create(
        &self,
        relationship: GuardianRelationshipEntity,
    ) -> RepositoryResult<GuardianRelationshipEntity> {
        let result = sqlx::query_as::<Postgres, GuardianRelationshipEntity>(&format!(
            "INSERT INTO guardian_relationships
                (id, guardian_wallet, ward_patient_id, relationship_type, permissions,
                 verified_by, verified_at, active, expires_at, revoked_at, revoked_reason,
                 authority_evidence_type, authority_evidence_reference,
                 authority_issuing_authority, authority_verified_by_role,
                 authority_evidence_recorded_at, next_reverification_due,
                 child_assent_status, child_assent_recorded_at, child_assent_notes,
                 supersedes_relationship_id, dispute_flag, dispute_notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                     $16, $17, $18, $19, $20, $21, $22, $23)
             RETURNING {SELECT_COLUMNS}"
        ))
        .bind(&relationship.id)
        .bind(&relationship.guardian_wallet)
        .bind(&relationship.ward_patient_id)
        .bind(&relationship.relationship_type)
        .bind(&relationship.permissions)
        .bind(&relationship.verified_by)
        .bind(relationship.verified_at)
        .bind(relationship.active)
        .bind(relationship.expires_at)
        .bind(relationship.revoked_at)
        .bind(&relationship.revoked_reason)
        .bind(&relationship.authority_evidence_type)
        .bind(&relationship.authority_evidence_reference)
        .bind(&relationship.authority_issuing_authority)
        .bind(&relationship.authority_verified_by_role)
        .bind(relationship.authority_evidence_recorded_at)
        .bind(relationship.next_reverification_due)
        .bind(&relationship.child_assent_status)
        .bind(relationship.child_assent_recorded_at)
        .bind(&relationship.child_assent_notes)
        .bind(&relationship.supersedes_relationship_id)
        .bind(relationship.dispute_flag)
        .bind(&relationship.dispute_notes)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn get_by_ward(
        &self,
        ward_patient_id: &str,
    ) -> RepositoryResult<Vec<GuardianRelationshipEntity>> {
        let result = sqlx::query_as::<Postgres, GuardianRelationshipEntity>(&format!(
            "SELECT {SELECT_COLUMNS} FROM guardian_relationships WHERE ward_patient_id = $1"
        ))
        .bind(ward_patient_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }

    async fn get_by_guardian(
        &self,
        guardian_wallet: &str,
    ) -> RepositoryResult<Vec<GuardianRelationshipEntity>> {
        let result = sqlx::query_as::<Postgres, GuardianRelationshipEntity>(&format!(
            "SELECT {SELECT_COLUMNS} FROM guardian_relationships WHERE guardian_wallet = $1"
        ))
        .bind(guardian_wallet)
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<GuardianRelationshipEntity>> {
        let result = sqlx::query_as::<Postgres, GuardianRelationshipEntity>(&format!(
            "SELECT {SELECT_COLUMNS} FROM guardian_relationships WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn update_permissions(
        &self,
        id: &str,
        permissions: Vec<String>,
        expires_at: Option<DateTime<Utc>>,
    ) -> RepositoryResult<GuardianRelationshipEntity> {
        let result = sqlx::query_as::<Postgres, GuardianRelationshipEntity>(&format!(
            "UPDATE guardian_relationships
             SET permissions = $2, expires_at = $3
             WHERE id = $1
             RETURNING {SELECT_COLUMNS}"
        ))
        .bind(id)
        .bind(&permissions)
        .bind(expires_at)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn revoke(&self, id: &str, reason: Option<String>) -> RepositoryResult<()> {
        sqlx::query(
            "UPDATE guardian_relationships
             SET active = FALSE, revoked_at = NOW(), revoked_reason = $2
             WHERE id = $1",
        )
        .bind(id)
        .bind(&reason)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
