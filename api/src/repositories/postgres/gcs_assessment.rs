//! PostgreSQL implementation of GcsAssessmentRepository.
//! Uses sqlx::QueryBuilder pattern for type-safe query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::{
    GcsAssessmentEntity, GcsAssessmentRepository, PaginatedResult, Pagination, RepositoryResult,
};

#[derive(Debug, Clone)]
pub struct PgGcsAssessmentRepository {
    pool: PgPool,
}

impl PgGcsAssessmentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl GcsAssessmentRepository for PgGcsAssessmentRepository {
    async fn create(
        &self,
        assessment: GcsAssessmentEntity,
    ) -> RepositoryResult<GcsAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO gcs_assessments (
                id, patient_id, eye_response, verbal_response, motor_response,
                interpretation, notes, pupil_assessment, assessed_by, assessed_at, facility_id
            ) ",
        );

        qb.push_values([&assessment], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(a.eye_response)
                .push_bind(a.verbal_response)
                .push_bind(a.motor_response)
                .push_bind(&a.interpretation)
                .push_bind(&a.notes)
                .push_bind(&a.pupil_assessment)
                .push_bind(&a.assessed_by)
                .push_bind(a.assessed_at)
                .push_bind(&a.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<GcsAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<GcsAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM gcs_assessments WHERE id = ");
        qb.push_bind(id);

        let assessment = qb
            .build_query_as::<GcsAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<GcsAssessmentEntity>> {
        let offset = pagination.offset() as i64;
        let limit = pagination.limit() as i64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM gcs_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);

        let assessments = qb
            .build_query_as::<GcsAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM gcs_assessments WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        Ok(PaginatedResult::new(assessments, total as u64, &pagination))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<GcsAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM gcs_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT 1");

        let assessment = qb
            .build_query_as::<GcsAssessmentEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn update(
        &self,
        assessment: GcsAssessmentEntity,
    ) -> RepositoryResult<GcsAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE gcs_assessments SET ");
        qb.push("eye_response = ")
            .push_bind(assessment.eye_response);
        qb.push(", verbal_response = ")
            .push_bind(assessment.verbal_response);
        qb.push(", motor_response = ")
            .push_bind(assessment.motor_response);
        qb.push(", interpretation = ")
            .push_bind(&assessment.interpretation);
        qb.push(", notes = ").push_bind(&assessment.notes);
        qb.push(", pupil_assessment = ")
            .push_bind(&assessment.pupil_assessment);
        qb.push(", assessed_by = ")
            .push_bind(&assessment.assessed_by);
        qb.push(", assessed_at = ")
            .push_bind(assessment.assessed_at);
        qb.push(", facility_id = ")
            .push_bind(&assessment.facility_id);
        qb.push(", updated_at = CURRENT_TIMESTAMP WHERE id = ")
            .push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let updated = qb
            .build_query_as::<GcsAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(updated)
    }

    async fn get_critical_scores(
        &self,
        threshold: i32,
    ) -> RepositoryResult<Vec<GcsAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM gcs_assessments WHERE total_score <= ");
        qb.push_bind(threshold);
        qb.push(" ORDER BY assessed_at DESC");

        let assessments = qb
            .build_query_as::<GcsAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(assessments)
    }
}
