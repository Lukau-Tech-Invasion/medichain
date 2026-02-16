//! PostgreSQL implementation of TriageAssessmentRepository.
//! Uses sqlx::QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use chrono::{Duration, Utc};
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::{
    PaginatedResult, Pagination, RepositoryError, RepositoryResult, TriageAssessmentEntity,
    TriageAssessmentRepository,
};

/// PostgreSQL-backed triage assessment repository
#[derive(Debug, Clone)]
pub struct PgTriageAssessmentRepository {
    pool: PgPool,
}

impl PgTriageAssessmentRepository {
    /// Create a new PostgreSQL triage assessment repository
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TriageAssessmentRepository for PgTriageAssessmentRepository {
    async fn create(
        &self,
        assessment: TriageAssessmentEntity,
    ) -> RepositoryResult<TriageAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO triage_assessments (
                id, patient_id, esi_level, chief_complaint, heart_rate, respiratory_rate,
                blood_pressure_systolic, blood_pressure_diastolic, temperature, oxygen_saturation,
                pain_scale, gcs_score, blood_glucose, weight, is_critical, requires_isolation,
                disposition, assigned_bed, triage_time, seen_by_provider_at, performed_by, facility_id
            ) "
        );

        qb.push_values([&assessment], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(a.esi_level)
                .push_bind(&a.chief_complaint)
                .push_bind(a.heart_rate)
                .push_bind(a.respiratory_rate)
                .push_bind(a.blood_pressure_systolic)
                .push_bind(a.blood_pressure_diastolic)
                .push_bind(a.temperature)
                .push_bind(a.oxygen_saturation)
                .push_bind(a.pain_scale)
                .push_bind(a.gcs_score)
                .push_bind(a.blood_glucose)
                .push_bind(a.weight)
                .push_bind(a.is_critical)
                .push_bind(a.requires_isolation)
                .push_bind(&a.disposition)
                .push_bind(&a.assigned_bed)
                .push_bind(a.triage_time)
                .push_bind(a.seen_by_provider_at)
                .push_bind(&a.performed_by)
                .push_bind(&a.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TriageAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<TriageAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM triage_assessments WHERE id = ");
        qb.push_bind(id);

        let assessment = qb
            .build_query_as::<TriageAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TriageAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM triage_assessments WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let count = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM triage_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY triage_time DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let assessments = qb
            .build_query_as::<TriageAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(assessments, count as u64, &pagination))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<TriageAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM triage_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY triage_time DESC LIMIT 1");

        let assessment = qb
            .build_query_as::<TriageAssessmentEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn update(
        &self,
        assessment: TriageAssessmentEntity,
    ) -> RepositoryResult<TriageAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE triage_assessments SET ");
        qb.push("esi_level = ").push_bind(assessment.esi_level);
        qb.push(", chief_complaint = ")
            .push_bind(&assessment.chief_complaint);
        qb.push(", heart_rate = ").push_bind(assessment.heart_rate);
        qb.push(", respiratory_rate = ")
            .push_bind(assessment.respiratory_rate);
        qb.push(", blood_pressure_systolic = ")
            .push_bind(assessment.blood_pressure_systolic);
        qb.push(", blood_pressure_diastolic = ")
            .push_bind(assessment.blood_pressure_diastolic);
        qb.push(", temperature = ")
            .push_bind(assessment.temperature);
        qb.push(", oxygen_saturation = ")
            .push_bind(assessment.oxygen_saturation);
        qb.push(", pain_scale = ").push_bind(assessment.pain_scale);
        qb.push(", gcs_score = ").push_bind(assessment.gcs_score);
        qb.push(", blood_glucose = ")
            .push_bind(assessment.blood_glucose);
        qb.push(", weight = ").push_bind(assessment.weight);
        qb.push(", is_critical = ")
            .push_bind(assessment.is_critical);
        qb.push(", requires_isolation = ")
            .push_bind(assessment.requires_isolation);
        qb.push(", disposition = ")
            .push_bind(&assessment.disposition);
        qb.push(", assigned_bed = ")
            .push_bind(&assessment.assigned_bed);
        qb.push(", seen_by_provider_at = ")
            .push_bind(assessment.seen_by_provider_at);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TriageAssessmentEntity>()
            .fetch_optional(&self.pool)
            .await?;

        result.ok_or_else(|| {
            RepositoryError::NotFound(format!("Triage assessment {} not found", assessment.id))
        })
    }

    async fn get_critical(&self) -> RepositoryResult<Vec<TriageAssessmentEntity>> {
        let cutoff = Utc::now() - Duration::hours(24);

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM triage_assessments WHERE esi_level <= 2 AND triage_time >= ",
        );
        qb.push_bind(cutoff);
        qb.push(" ORDER BY esi_level ASC, triage_time DESC LIMIT 100");

        let assessments = qb
            .build_query_as::<TriageAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(assessments)
    }

    async fn get_ed_dashboard(&self) -> RepositoryResult<Vec<TriageAssessmentEntity>> {
        let cutoff = Utc::now() - Duration::hours(24);

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM triage_assessments WHERE triage_time >= ");
        qb.push_bind(cutoff);
        qb.push(" ORDER BY esi_level ASC, triage_time DESC LIMIT 200");

        let assessments = qb
            .build_query_as::<TriageAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(assessments)
    }
}
