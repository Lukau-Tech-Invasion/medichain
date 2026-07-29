//! PostgreSQL emergency capsule repository (Horizon HZ-003).
//!
//! See `repositories::memory::emergency_capsules` for the design rationale.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres};

use crate::repositories::traits::{
    EmergencyCapsuleAccessEntity, EmergencyCapsuleEntity, EmergencyCapsuleRepository,
    RepositoryError, RepositoryResult,
};

#[derive(Debug, Clone)]
pub struct PgEmergencyCapsuleRepository {
    pool: PgPool,
}

impl PgEmergencyCapsuleRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const CAPSULE_COLUMNS: &str = "patient_id, version, commitment, capsule_encrypted, key_version, \
    created_by, created_at, revoked_at, revoked_by, revocation_reason, chain_tx_hash, \
    chain_finalized";

const ACCESS_COLUMNS: &str = "id, patient_id, capsule_version, accessed_by, grant_id, \
    reason_code, reason_text, fields_revealed, commitment_verified, accessed_at";

#[async_trait]
impl EmergencyCapsuleRepository for PgEmergencyCapsuleRepository {
    async fn put(
        &self,
        capsule: EmergencyCapsuleEntity,
    ) -> RepositoryResult<EmergencyCapsuleEntity> {
        // The version check is expressed as a conditional INSERT rather than a
        // read-then-write, so two concurrent writers cannot both observe the
        // same "latest" version and both insert. The primary key would catch an
        // exact collision, but not the case where one writer inserts v3 while
        // another is midway through inserting v2 having read v1.
        let result = sqlx::query_as::<Postgres, EmergencyCapsuleEntity>(&format!(
            "INSERT INTO emergency_capsules
                (patient_id, version, commitment, capsule_encrypted, key_version,
                 created_by, created_at, revoked_at, revoked_by, revocation_reason,
                 chain_tx_hash, chain_finalized)
             SELECT $1, $2, $3, $4, $5, $6, $7, NULL, NULL, NULL, $8, $9
             WHERE NOT EXISTS (
                 SELECT 1 FROM emergency_capsules
                 WHERE patient_id = $1 AND version >= $2
             )
             RETURNING {CAPSULE_COLUMNS}"
        ))
        .bind(&capsule.patient_id)
        .bind(capsule.version)
        .bind(&capsule.commitment)
        .bind(&capsule.capsule_encrypted)
        .bind(capsule.key_version)
        .bind(&capsule.created_by)
        .bind(capsule.created_at)
        .bind(&capsule.chain_tx_hash)
        .bind(capsule.chain_finalized)
        .fetch_optional(&self.pool)
        .await?;

        result.ok_or_else(|| {
            RepositoryError::Validation(format!(
                "capsule version {} is not newer than the stored version for patient {}",
                capsule.version, capsule.patient_id
            ))
        })
    }

    async fn current(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<EmergencyCapsuleEntity>> {
        let result = sqlx::query_as::<Postgres, EmergencyCapsuleEntity>(&format!(
            "SELECT {CAPSULE_COLUMNS} FROM emergency_capsules
             WHERE patient_id = $1 AND revoked_at IS NULL
             ORDER BY version DESC
             LIMIT 1"
        ))
        .bind(patient_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn latest_version(&self, patient_id: &str) -> RepositoryResult<i32> {
        // COALESCE so a patient with no capsule yields 0 rather than NULL,
        // making the caller's "next version = latest + 1" work unchanged for
        // the first capsule. Revoked versions are deliberately included: a
        // revoked version number must never be reissued.
        let version: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(version), 0) FROM emergency_capsules WHERE patient_id = $1",
        )
        .bind(patient_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(version)
    }

    async fn history(&self, patient_id: &str) -> RepositoryResult<Vec<EmergencyCapsuleEntity>> {
        let result = sqlx::query_as::<Postgres, EmergencyCapsuleEntity>(&format!(
            "SELECT {CAPSULE_COLUMNS} FROM emergency_capsules
             WHERE patient_id = $1
             ORDER BY version DESC"
        ))
        .bind(patient_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }

    async fn revoke(
        &self,
        patient_id: &str,
        version: i32,
        revoked_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<EmergencyCapsuleEntity> {
        // `revoked_at IS NULL` in the WHERE clause makes revocation idempotent
        // in the safe direction: a second revoke does not overwrite who first
        // revoked it or when.
        let result = sqlx::query_as::<Postgres, EmergencyCapsuleEntity>(&format!(
            "UPDATE emergency_capsules
             SET revoked_at = NOW(), revoked_by = $3, revocation_reason = $4
             WHERE patient_id = $1 AND version = $2 AND revoked_at IS NULL
             RETURNING {CAPSULE_COLUMNS}"
        ))
        .bind(patient_id)
        .bind(version)
        .bind(revoked_by)
        .bind(&reason)
        .fetch_optional(&self.pool)
        .await?;

        result.ok_or_else(|| {
            RepositoryError::NotFound(format!(
                "Emergency capsule {}/v{} not found or already revoked",
                patient_id, version
            ))
        })
    }

    async fn record_chain_result(
        &self,
        patient_id: &str,
        version: i32,
        tx_hash: &str,
        finalized: bool,
    ) -> RepositoryResult<()> {
        sqlx::query(
            "UPDATE emergency_capsules
             SET chain_tx_hash = $3, chain_finalized = $4
             WHERE patient_id = $1 AND version = $2",
        )
        .bind(patient_id)
        .bind(version)
        .bind(tx_hash)
        .bind(finalized)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn log_access(
        &self,
        access: EmergencyCapsuleAccessEntity,
    ) -> RepositoryResult<EmergencyCapsuleAccessEntity> {
        let result = sqlx::query_as::<Postgres, EmergencyCapsuleAccessEntity>(&format!(
            "INSERT INTO emergency_capsule_access_log
                (id, patient_id, capsule_version, accessed_by, grant_id, reason_code,
                 reason_text, fields_revealed, commitment_verified, accessed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING {ACCESS_COLUMNS}"
        ))
        .bind(&access.id)
        .bind(&access.patient_id)
        .bind(access.capsule_version)
        .bind(&access.accessed_by)
        .bind(&access.grant_id)
        .bind(&access.reason_code)
        .bind(&access.reason_text)
        .bind(&access.fields_revealed)
        .bind(access.commitment_verified)
        .bind(access.accessed_at)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn access_history(
        &self,
        patient_id: &str,
        limit: i64,
    ) -> RepositoryResult<Vec<EmergencyCapsuleAccessEntity>> {
        let result = sqlx::query_as::<Postgres, EmergencyCapsuleAccessEntity>(&format!(
            "SELECT {ACCESS_COLUMNS} FROM emergency_capsule_access_log
             WHERE patient_id = $1
             ORDER BY accessed_at DESC
             LIMIT $2"
        ))
        .bind(patient_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }
}
