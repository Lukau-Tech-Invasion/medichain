//! PostgreSQL implementation of SampleHistoryRepository.
//! Uses sqlx::QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::{
    PaginatedResult, Pagination, RepositoryResult, SampleHistoryEntity, SampleHistoryRepository,
};

/// PostgreSQL-backed sample history repository
#[derive(Debug, Clone)]
pub struct PgSampleHistoryRepository {
    pool: PgPool,
}

impl PgSampleHistoryRepository {
    /// Create a new PostgreSQL sample history repository
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SampleHistoryRepository for PgSampleHistoryRepository {
    async fn create(&self, history: SampleHistoryEntity) -> RepositoryResult<SampleHistoryEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO sample_histories (id, patient_id, signs_symptoms, past_medical_history, events_leading, last_intake, medications, allergies_snapshot, collected_by, collected_at, facility_id, is_active) "
        );

        qb.push_values([&history], |mut b, h| {
            b.push_bind(&h.id)
                .push_bind(&h.patient_id)
                .push_bind(&h.signs_symptoms)
                .push_bind(&h.past_medical_history)
                .push_bind(&h.events_leading)
                .push_bind(&h.last_intake)
                .push_bind(&h.medications)
                .push_bind(&h.allergies_snapshot)
                .push_bind(&h.collected_by)
                .push_bind(h.collected_at)
                .push_bind(&h.facility_id)
                .push_bind(h.is_active);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SampleHistoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SampleHistoryEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM sample_histories WHERE id = ");
        qb.push_bind(id);
        qb.push(" AND is_active = true");

        let history = qb
            .build_query_as::<SampleHistoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(history)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<SampleHistoryEntity>> {
        // Get total count
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM sample_histories WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        count_qb.push(" AND is_active = true");

        let count_result = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let total = count_result as u64;

        // Get paginated results
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM sample_histories WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY collected_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let histories = qb
            .build_query_as::<SampleHistoryEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(histories, total, &pagination))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<SampleHistoryEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM sample_histories WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY collected_at DESC LIMIT 1");

        let history = qb
            .build_query_as::<SampleHistoryEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(history)
    }

    async fn update(&self, history: SampleHistoryEntity) -> RepositoryResult<SampleHistoryEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE sample_histories SET ");
        qb.push("signs_symptoms = ")
            .push_bind(&history.signs_symptoms);
        qb.push(", past_medical_history = ")
            .push_bind(&history.past_medical_history);
        qb.push(", events_leading = ")
            .push_bind(&history.events_leading);
        qb.push(", last_intake = ").push_bind(&history.last_intake);
        qb.push(", medications = ").push_bind(&history.medications);
        qb.push(", allergies_snapshot = ")
            .push_bind(&history.allergies_snapshot);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&history.id);
        qb.push(" AND is_active = true RETURNING *");

        let result = qb
            .build_query_as::<SampleHistoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE sample_histories SET is_active = false, updated_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);

        let rows_affected = qb.build().execute(&self.pool).await?.rows_affected();

        if rows_affected == 0 {
            return Err(crate::repositories::traits::RepositoryError::NotFound(
                format!("Sample history with ID {} not found", id),
            ));
        }

        Ok(())
    }
}
