//! PostgreSQL legal-hold repository.
//!
//! See `repositories::memory::legal_holds` for the design rationale.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres};

use crate::repositories::traits::{LegalHoldEntity, LegalHoldRepository, RepositoryResult};

#[derive(Debug, Clone)]
pub struct PgLegalHoldRepository {
    pool: PgPool,
}

impl PgLegalHoldRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const SELECT_COLUMNS: &str = "id, patient_id, entity_type, reason, reference, applied_by, \
    applied_at, released_by, released_at, release_reason, created_at";

#[async_trait]
impl LegalHoldRepository for PgLegalHoldRepository {
    async fn create(&self, hold: LegalHoldEntity) -> RepositoryResult<LegalHoldEntity> {
        let result = sqlx::query_as::<Postgres, LegalHoldEntity>(&format!(
            "INSERT INTO legal_holds
                (id, patient_id, entity_type, reason, reference, applied_by, applied_at,
                 released_by, released_at, release_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING {SELECT_COLUMNS}"
        ))
        .bind(&hold.id)
        .bind(&hold.patient_id)
        .bind(&hold.entity_type)
        .bind(&hold.reason)
        .bind(&hold.reference)
        .bind(&hold.applied_by)
        .bind(hold.applied_at)
        .bind(&hold.released_by)
        .bind(hold.released_at)
        .bind(&hold.release_reason)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LegalHoldEntity> {
        let result = sqlx::query_as::<Postgres, LegalHoldEntity>(&format!(
            "SELECT {SELECT_COLUMNS} FROM legal_holds WHERE id = $1"
        ))
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn get_active(&self) -> RepositoryResult<Vec<LegalHoldEntity>> {
        let result = sqlx::query_as::<Postgres, LegalHoldEntity>(&format!(
            "SELECT {SELECT_COLUMNS} FROM legal_holds WHERE released_at IS NULL"
        ))
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<LegalHoldEntity>> {
        let result = sqlx::query_as::<Postgres, LegalHoldEntity>(&format!(
            "SELECT {SELECT_COLUMNS} FROM legal_holds WHERE patient_id = $1"
        ))
        .bind(patient_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }

    async fn release(
        &self,
        id: &str,
        released_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<LegalHoldEntity> {
        // Only unreleased holds are updated: re-releasing an already-released
        // hold would overwrite the original release's audit fields.
        let result = sqlx::query_as::<Postgres, LegalHoldEntity>(&format!(
            "UPDATE legal_holds
                SET released_by = $2, released_at = NOW(), release_reason = $3
              WHERE id = $1 AND released_at IS NULL
             RETURNING {SELECT_COLUMNS}"
        ))
        .bind(id)
        .bind(released_by)
        .bind(&reason)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }
}
