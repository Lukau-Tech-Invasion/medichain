//! PostgreSQL implementation of FallRiskAssessmentRepository.
//! Uses sqlx::QueryBuilder pattern for type-safe query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::{
    FallRiskAssessmentEntity, FallRiskAssessmentRepository, PaginatedResult, Pagination,
    RepositoryResult,
};

/// PostgreSQL-backed fall risk assessment repository
#[derive(Debug, Clone)]
pub struct PgFallRiskAssessmentRepository {
    pool: PgPool,
}

impl PgFallRiskAssessmentRepository {
    /// Create a new PostgreSQL fall risk assessment repository
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl FallRiskAssessmentRepository for PgFallRiskAssessmentRepository {
    async fn create(
        &self,
        assessment: FallRiskAssessmentEntity,
    ) -> RepositoryResult<FallRiskAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO fall_risk_assessments (
                id, patient_id, assessment_tool, history_of_falling, secondary_diagnosis,
                ambulatory_aid, iv_therapy, gait_status, mental_status,
                additional_factors, interventions, notes, assessed_by, assessed_at,
                next_assessment_due, facility_id
            ) ",
        );

        qb.push_values([&assessment], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(&a.assessment_tool)
                .push_bind(a.history_of_falling)
                .push_bind(a.secondary_diagnosis)
                .push_bind(a.ambulatory_aid)
                .push_bind(a.iv_therapy)
                .push_bind(a.gait_status)
                .push_bind(a.mental_status)
                .push_bind(&a.additional_factors)
                .push_bind(&a.interventions)
                .push_bind(&a.notes)
                .push_bind(&a.assessed_by)
                .push_bind(a.assessed_at)
                .push_bind(a.next_assessment_due)
                .push_bind(&a.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<FallRiskAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<FallRiskAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM fall_risk_assessments WHERE id = ");
        qb.push_bind(id);

        let assessment = qb
            .build_query_as::<FallRiskAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<FallRiskAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM fall_risk_assessments WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let count_result = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let total = count_result as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM fall_risk_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let assessments = qb
            .build_query_as::<FallRiskAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(assessments, total as u64, &pagination))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<FallRiskAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM fall_risk_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT 1");

        let assessment = qb
            .build_query_as::<FallRiskAssessmentEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn update(
        &self,
        assessment: FallRiskAssessmentEntity,
    ) -> RepositoryResult<FallRiskAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE fall_risk_assessments SET ");
        qb.push("history_of_falling = ")
            .push_bind(assessment.history_of_falling);
        qb.push(", secondary_diagnosis = ")
            .push_bind(assessment.secondary_diagnosis);
        qb.push(", ambulatory_aid = ")
            .push_bind(assessment.ambulatory_aid);
        qb.push(", iv_therapy = ").push_bind(assessment.iv_therapy);
        qb.push(", gait_status = ")
            .push_bind(assessment.gait_status);
        qb.push(", mental_status = ")
            .push_bind(assessment.mental_status);
        qb.push(", additional_factors = ")
            .push_bind(&assessment.additional_factors);
        qb.push(", interventions = ")
            .push_bind(&assessment.interventions);
        qb.push(", notes = ").push_bind(&assessment.notes);
        qb.push(", next_assessment_due = ")
            .push_bind(assessment.next_assessment_due);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<FallRiskAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_high_risk_patients(&self) -> RepositoryResult<Vec<FallRiskAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM fall_risk_assessments WHERE risk_level IN ('moderate', 'high') ORDER BY total_score DESC LIMIT 50"
        );

        let assessments = qb
            .build_query_as::<FallRiskAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(assessments)
    }

    async fn get_assessments_due(&self) -> RepositoryResult<Vec<FallRiskAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM fall_risk_assessments WHERE next_assessment_due <= NOW() ORDER BY next_assessment_due ASC LIMIT 50"
        );

        let assessments = qb
            .build_query_as::<FallRiskAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(assessments)
    }
}
