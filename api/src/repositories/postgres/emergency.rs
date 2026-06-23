//! PostgreSQL implementations for the emergency-protocol repositories (C1).
//!
//! Code Blue, Trauma, Stroke, Cardiac, and Sepsis entities carry unsigned-integer
//! fields (u8/u32) that have no native PostgreSQL column type, so each record is
//! persisted losslessly as JSONB in a uniform `(id, patient_id, record_json,
//! created_at, updated_at)` table — the same proven shape used by
//! [`super::phase7`]'s JSON-record repositories. `id`/`patient_id` stay as
//! queryable columns; the full entity round-trips through `record_json`.
//!
//! All SQL is parameter-bound; table names are compile-time literals (no runtime
//! string concatenation of untrusted input).

use async_trait::async_trait;
use sqlx::PgPool;

use crate::repositories::traits::*;

/// Row shape for the shared JSONB-blob emergency tables.
#[derive(sqlx::FromRow)]
struct EmergencyRow {
    record_json: serde_json::Value,
}

/// Decode a batch of JSONB rows back into typed entities.
fn decode_rows<T: serde::de::DeserializeOwned>(
    rows: Vec<EmergencyRow>,
) -> RepositoryResult<Vec<T>> {
    rows.into_iter()
        .map(|r| {
            serde_json::from_value::<T>(r.record_json)
                .map_err(|e| RepositoryError::Internal(e.to_string()))
        })
        .collect()
}

/// Generate a PostgreSQL repository over a JSONB-blob emergency table.
///
/// Implements the five methods common to every emergency-protocol repository
/// trait: `create`, `get_by_id`, `get_by_patient`, `update`, `delete`.
macro_rules! pg_emergency_repo {
    ($repo:ident, $trait_:ident, $entity:ty, $table:literal, $label:literal) => {
        #[doc = concat!("PostgreSQL-backed repository for ", $label, " records.")]
        #[derive(Debug, Clone)]
        pub struct $repo {
            pool: PgPool,
        }

        impl $repo {
            pub fn new(pool: PgPool) -> Self {
                Self { pool }
            }
        }

        #[async_trait]
        impl $trait_ for $repo {
            async fn create(&self, record: $entity) -> RepositoryResult<$entity> {
                let json = serde_json::to_value(&record)
                    .map_err(|e| RepositoryError::Internal(e.to_string()))?;
                sqlx::query(concat!(
                    "INSERT INTO ",
                    $table,
                    " (id, patient_id, record_json, created_at, updated_at) \
                     VALUES ($1, $2, $3, $4, $5)"
                ))
                .bind(&record.id)
                .bind(&record.patient_id)
                .bind(&json)
                .bind(record.created_at)
                .bind(record.updated_at)
                .execute(&self.pool)
                .await?;
                Ok(record)
            }

            async fn get_by_id(&self, id: &str) -> RepositoryResult<$entity> {
                let row: Option<EmergencyRow> = sqlx::query_as(concat!(
                    "SELECT record_json FROM ",
                    $table,
                    " WHERE id = $1"
                ))
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
                match row {
                    Some(r) => serde_json::from_value(r.record_json)
                        .map_err(|e| RepositoryError::Internal(e.to_string())),
                    None => Err(RepositoryError::NotFound(format!(
                        concat!($label, " {} not found"),
                        id
                    ))),
                }
            }

            async fn get_by_patient(
                &self,
                patient_id: &str,
                pagination: Pagination,
            ) -> RepositoryResult<PaginatedResult<$entity>> {
                let total: i64 = sqlx::query_scalar(concat!(
                    "SELECT COUNT(*) FROM ",
                    $table,
                    " WHERE patient_id = $1"
                ))
                .bind(patient_id)
                .fetch_one(&self.pool)
                .await?;

                let rows: Vec<EmergencyRow> = sqlx::query_as(concat!(
                    "SELECT record_json FROM ",
                    $table,
                    " WHERE patient_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3"
                ))
                .bind(patient_id)
                .bind(pagination.limit() as i64)
                .bind(pagination.offset() as i64)
                .fetch_all(&self.pool)
                .await?;

                let items = decode_rows(rows)?;
                Ok(PaginatedResult::new(items, total as u64, &pagination))
            }

            async fn update(&self, record: $entity) -> RepositoryResult<$entity> {
                let json = serde_json::to_value(&record)
                    .map_err(|e| RepositoryError::Internal(e.to_string()))?;
                let res = sqlx::query(concat!(
                    "UPDATE ",
                    $table,
                    " SET patient_id = $2, record_json = $3, updated_at = $4 WHERE id = $1"
                ))
                .bind(&record.id)
                .bind(&record.patient_id)
                .bind(&json)
                .bind(record.updated_at)
                .execute(&self.pool)
                .await?;
                if res.rows_affected() == 0 {
                    return Err(RepositoryError::NotFound(format!(
                        concat!($label, " {} not found"),
                        record.id
                    )));
                }
                Ok(record)
            }

            async fn delete(&self, id: &str) -> RepositoryResult<()> {
                let res = sqlx::query(concat!("DELETE FROM ", $table, " WHERE id = $1"))
                    .bind(id)
                    .execute(&self.pool)
                    .await?;
                if res.rows_affected() == 0 {
                    return Err(RepositoryError::NotFound(format!(
                        concat!($label, " {} not found"),
                        id
                    )));
                }
                Ok(())
            }
        }
    };
}

// Code Blue is implemented by hand because its trait additionally exposes
// `list_all`; the other four share the macro-generated common method set.
/// PostgreSQL-backed repository for Code Blue records.
#[derive(Debug, Clone)]
pub struct PgCodeBlueRepository {
    pool: PgPool,
}

impl PgCodeBlueRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CodeBlueRepository for PgCodeBlueRepository {
    async fn create(&self, record: CodeBlueEntity) -> RepositoryResult<CodeBlueEntity> {
        let json =
            serde_json::to_value(&record).map_err(|e| RepositoryError::Internal(e.to_string()))?;
        sqlx::query(
            "INSERT INTO ep_code_blue_records \
             (id, patient_id, record_json, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(&record.id)
        .bind(&record.patient_id)
        .bind(&json)
        .bind(record.created_at)
        .bind(record.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<CodeBlueEntity> {
        let row: Option<EmergencyRow> =
            sqlx::query_as("SELECT record_json FROM ep_code_blue_records WHERE id = $1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        match row {
            Some(r) => serde_json::from_value(r.record_json)
                .map_err(|e| RepositoryError::Internal(e.to_string())),
            None => Err(RepositoryError::NotFound(format!(
                "Code Blue record {} not found",
                id
            ))),
        }
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CodeBlueEntity>> {
        let total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ep_code_blue_records WHERE patient_id = $1")
                .bind(patient_id)
                .fetch_one(&self.pool)
                .await?;

        let rows: Vec<EmergencyRow> = sqlx::query_as(
            "SELECT record_json FROM ep_code_blue_records \
             WHERE patient_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(patient_id)
        .bind(pagination.limit() as i64)
        .bind(pagination.offset() as i64)
        .fetch_all(&self.pool)
        .await?;

        let items = decode_rows(rows)?;
        Ok(PaginatedResult::new(items, total as u64, &pagination))
    }

    async fn update(&self, record: CodeBlueEntity) -> RepositoryResult<CodeBlueEntity> {
        let json =
            serde_json::to_value(&record).map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let res = sqlx::query(
            "UPDATE ep_code_blue_records \
             SET patient_id = $2, record_json = $3, updated_at = $4 WHERE id = $1",
        )
        .bind(&record.id)
        .bind(&record.patient_id)
        .bind(&json)
        .bind(record.updated_at)
        .execute(&self.pool)
        .await?;
        if res.rows_affected() == 0 {
            return Err(RepositoryError::NotFound(format!(
                "Code Blue record {} not found",
                record.id
            )));
        }
        Ok(record)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let res = sqlx::query("DELETE FROM ep_code_blue_records WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(RepositoryError::NotFound(format!(
                "Code Blue record {} not found",
                id
            )));
        }
        Ok(())
    }

    async fn list_all(&self) -> RepositoryResult<Vec<CodeBlueEntity>> {
        let rows: Vec<EmergencyRow> = sqlx::query_as(
            "SELECT record_json FROM ep_code_blue_records ORDER BY created_at DESC LIMIT 1000",
        )
        .fetch_all(&self.pool)
        .await?;
        decode_rows(rows)
    }
}

pg_emergency_repo!(
    PgTraumaAssessmentRepository,
    TraumaAssessmentRepository,
    TraumaAssessmentEntity,
    "ep_trauma_assessments",
    "Trauma assessment"
);
pg_emergency_repo!(
    PgStrokeAssessmentRepository,
    StrokeAssessmentRepository,
    StrokeAssessmentEntity,
    "ep_stroke_assessments",
    "Stroke assessment"
);
pg_emergency_repo!(
    PgCardiacEventRepository,
    CardiacEventRepository,
    CardiacEventEntity,
    "ep_cardiac_events",
    "Cardiac event"
);
pg_emergency_repo!(
    PgSepsisAssessmentRepository,
    SepsisAssessmentRepository,
    SepsisAssessmentEntity,
    "ep_sepsis_assessments",
    "Sepsis assessment"
);
