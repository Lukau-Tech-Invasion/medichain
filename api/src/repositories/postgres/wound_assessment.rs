//! PostgreSQL implementation of WoundAssessmentRepository.
//! Uses sqlx::QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::{
    PaginatedResult, Pagination, RepositoryResult, WoundAssessmentEntity, WoundAssessmentRepository,
};

#[derive(Debug, Clone)]
pub struct PgWoundAssessmentRepository {
    pool: PgPool,
}

impl PgWoundAssessmentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl WoundAssessmentRepository for PgWoundAssessmentRepository {
    async fn create(
        &self,
        assessment: WoundAssessmentEntity,
    ) -> RepositoryResult<WoundAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO wound_assessments (
                id, patient_id, wound_id, wound_location, wound_type, length_cm, width_cm, depth_cm,
                tissue_type, drainage_amount, drainage_type, periwound_condition, pain_level,
                treatment_applied, dressing_type, notes, photo_taken, assessed_by, assessed_at, facility_id
            ) "
        );

        qb.push_values([&assessment], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(&a.wound_id)
                .push_bind(&a.wound_location)
                .push_bind(&a.wound_type)
                .push_bind(a.length_cm)
                .push_bind(a.width_cm)
                .push_bind(a.depth_cm)
                .push_bind(&a.tissue_type)
                .push_bind(&a.drainage_amount)
                .push_bind(&a.drainage_type)
                .push_bind(&a.periwound_condition)
                .push_bind(a.pain_level)
                .push_bind(&a.treatment_applied)
                .push_bind(&a.dressing_type)
                .push_bind(&a.notes)
                .push_bind(a.photo_taken)
                .push_bind(&a.assessed_by)
                .push_bind(a.assessed_at)
                .push_bind(&a.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WoundAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<WoundAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wound_assessments WHERE id = ");
        qb.push_bind(id);

        let assessment = qb
            .build_query_as::<WoundAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WoundAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM wound_assessments WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wound_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let assessments = qb
            .build_query_as::<WoundAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(assessments, total as u64, &pagination))
    }

    async fn get_by_wound_id(
        &self,
        wound_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WoundAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM wound_assessments WHERE wound_id = ");
        count_qb.push_bind(wound_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wound_assessments WHERE wound_id = ");
        qb.push_bind(wound_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let assessments = qb
            .build_query_as::<WoundAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(assessments, total as u64, &pagination))
    }

    async fn update(
        &self,
        assessment: WoundAssessmentEntity,
    ) -> RepositoryResult<WoundAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE wound_assessments SET ");
        qb.push("wound_location = ")
            .push_bind(&assessment.wound_location);
        qb.push(", wound_type = ").push_bind(&assessment.wound_type);
        qb.push(", length_cm = ").push_bind(assessment.length_cm);
        qb.push(", width_cm = ").push_bind(assessment.width_cm);
        qb.push(", depth_cm = ").push_bind(assessment.depth_cm);
        qb.push(", tissue_type = ")
            .push_bind(&assessment.tissue_type);
        qb.push(", drainage_amount = ")
            .push_bind(&assessment.drainage_amount);
        qb.push(", drainage_type = ")
            .push_bind(&assessment.drainage_type);
        qb.push(", periwound_condition = ")
            .push_bind(&assessment.periwound_condition);
        qb.push(", pain_level = ").push_bind(assessment.pain_level);
        qb.push(", treatment_applied = ")
            .push_bind(&assessment.treatment_applied);
        qb.push(", dressing_type = ")
            .push_bind(&assessment.dressing_type);
        qb.push(", notes = ").push_bind(&assessment.notes);
        qb.push(", photo_taken = ")
            .push_bind(assessment.photo_taken);
        qb.push(", updated_at = CURRENT_TIMESTAMP WHERE id = ")
            .push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WoundAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_critical_wounds(&self) -> RepositoryResult<Vec<WoundAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM wound_assessments WHERE tissue_type IN ('Necrotic', 'Infected', 'Slough') OR pain_level >= 7 ORDER BY assessed_at DESC"
        );

        let assessments = qb
            .build_query_as::<WoundAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(assessments)
    }
}
