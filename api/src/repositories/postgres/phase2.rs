//! PostgreSQL implementation of Phase 2 clinical repositories.
//!
//! This module uses sqlx::QueryBuilder pattern for dynamic query construction,
//! providing type-safe parameter binding without manual positional placeholders.

use async_trait::async_trait;
use sqlx::{PgPool, QueryBuilder, Postgres};
use chrono::{Utc, NaiveDate};

use crate::repositories::traits::{
    Pagination, PaginatedResult, RepositoryError, RepositoryResult, DateRange,
    SampleHistoryEntity, SampleHistoryRepository,
    GcsAssessmentEntity, GcsAssessmentRepository,
    ProgressNoteEntity, ProgressNoteRepository,
    HistoryPhysicalEntity, HistoryPhysicalRepository,
    ConsultationNoteEntity, ConsultationNoteRepository,
    NursingCarePlanEntity, NursingCarePlanRepository,
    MedicationRecordEntity, MedicationRecordRepository,
    IORecordEntity, IORecordRepository,
    WoundAssessmentEntity, WoundAssessmentRepository,
    IVAssessmentEntity, IVAssessmentRepository,
    FallRiskAssessmentEntity, FallRiskAssessmentRepository,
};

// =============================================================================
// Sample History Repository
// =============================================================================

#[derive(Debug, Clone)]
pub struct PgSampleHistoryRepository {
    pool: PgPool,
}

impl PgSampleHistoryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SampleHistoryRepository for PgSampleHistoryRepository {
    async fn create(&self, history: SampleHistoryEntity) -> RepositoryResult<SampleHistoryEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO sample_histories (
                id, patient_id, signs_symptoms, past_medical_history, events_leading,
                last_intake, medications, allergies_snapshot, collected_by, 
                collected_at, facility_id, is_active
            ) "
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
             .push_bind(&h.collected_at)
             .push_bind(&h.facility_id)
             .push_bind(h.is_active);
        });

        qb.push(" RETURNING *");

        let result = qb.build_query_as::<SampleHistoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SampleHistoryEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM sample_histories WHERE id = "
        );
        qb.push_bind(id);
        qb.push(" AND is_active = true");

        let history = qb.build_query_as::<SampleHistoryEntity>()
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
        let mut count_qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT COUNT(*) FROM sample_histories WHERE patient_id = "
        );
        count_qb.push_bind(patient_id);
        count_qb.push(" AND is_active = true");

        let count_result = count_qb.build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let total = count_result as u64;

        // Get paginated results
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM sample_histories WHERE patient_id = "
        );
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY collected_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let histories = qb.build_query_as::<SampleHistoryEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(histories, total, &pagination))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<SampleHistoryEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM sample_histories WHERE patient_id = "
        );
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY collected_at DESC LIMIT 1");

        let history = qb.build_query_as::<SampleHistoryEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(history)
    }

    async fn update(&self, history: SampleHistoryEntity) -> RepositoryResult<SampleHistoryEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE sample_histories SET ");
        qb.push("signs_symptoms = ").push_bind(&history.signs_symptoms);
        qb.push(", past_medical_history = ").push_bind(&history.past_medical_history);
        qb.push(", events_leading = ").push_bind(&history.events_leading);
        qb.push(", last_intake = ").push_bind(&history.last_intake);
        qb.push(", medications = ").push_bind(&history.medications);
        qb.push(", allergies_snapshot = ").push_bind(&history.allergies_snapshot);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(&history.id);
        qb.push(" RETURNING *");

        let result = qb.build_query_as::<SampleHistoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE sample_histories SET is_active = false, updated_at = NOW() WHERE id = "
        );
        qb.push_bind(id);

        qb.build().execute(&self.pool).await?;

        Ok(())
    }
}

// =============================================================================
// GCS Assessment Repository
// =============================================================================

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
    async fn create(&self, assessment: GcsAssessmentEntity) -> RepositoryResult<GcsAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO gcs_assessments (
                id, patient_id, eye_response, verbal_response, motor_response,
                interpretation, notes, pupil_assessment, assessed_by, assessed_at, facility_id
            ) "
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
             .push_bind(&a.assessed_at)
             .push_bind(&a.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb.build_query_as::<GcsAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<GcsAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM gcs_assessments WHERE id = "
        );
        qb.push_bind(id);

        let assessment = qb.build_query_as::<GcsAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<GcsAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT COUNT(*) FROM gcs_assessments WHERE patient_id = "
        );
        count_qb.push_bind(patient_id);

        let count_result = count_qb.build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let total = count_result as u64;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM gcs_assessments WHERE patient_id = "
        );
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let assessments = qb.build_query_as::<GcsAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(assessments, total, &pagination))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<GcsAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM gcs_assessments WHERE patient_id = "
        );
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT 1");

        let assessment = qb.build_query_as::<GcsAssessmentEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn update(&self, assessment: GcsAssessmentEntity) -> RepositoryResult<GcsAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE gcs_assessments SET ");
        qb.push("eye_response = ").push_bind(assessment.eye_response);
        qb.push(", verbal_response = ").push_bind(assessment.verbal_response);
        qb.push(", motor_response = ").push_bind(assessment.motor_response);
        qb.push(", interpretation = ").push_bind(&assessment.interpretation);
        qb.push(", notes = ").push_bind(&assessment.notes);
        qb.push(", pupil_assessment = ").push_bind(&assessment.pupil_assessment);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let result = qb.build_query_as::<GcsAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_critical_scores(
        &self,
        threshold: i32,
    ) -> RepositoryResult<Vec<GcsAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM gcs_assessments WHERE total_score <= "
        );
        qb.push_bind(threshold);
        qb.push(" ORDER BY assessed_at DESC LIMIT 50");

        let assessments = qb.build_query_as::<GcsAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(assessments)
    }
}

// =============================================================================
// Fall Risk Assessment Repository
// =============================================================================

#[derive(Debug, Clone)]
pub struct PgFallRiskAssessmentRepository {
    pool: PgPool,
}

impl PgFallRiskAssessmentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl FallRiskAssessmentRepository for PgFallRiskAssessmentRepository {
    async fn create(&self, assessment: FallRiskAssessmentEntity) -> RepositoryResult<FallRiskAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO fall_risk_assessments (
                id, patient_id, assessment_tool, history_of_falling, secondary_diagnosis,
                ambulatory_aid, iv_therapy, gait_status, mental_status,
                additional_factors, interventions, notes, assessed_by, assessed_at,
                next_assessment_due, facility_id
            ) "
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
             .push_bind(&a.assessed_at)
             .push_bind(&a.next_assessment_due)
             .push_bind(&a.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb.build_query_as::<FallRiskAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<FallRiskAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM fall_risk_assessments WHERE id = "
        );
        qb.push_bind(id);

        let assessment = qb.build_query_as::<FallRiskAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<FallRiskAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT COUNT(*) FROM fall_risk_assessments WHERE patient_id = "
        );
        count_qb.push_bind(patient_id);

        let count_result = count_qb.build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let total = count_result as u64;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM fall_risk_assessments WHERE patient_id = "
        );
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let assessments = qb.build_query_as::<FallRiskAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(assessments, total, &pagination))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<FallRiskAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM fall_risk_assessments WHERE patient_id = "
        );
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT 1");

        let assessment = qb.build_query_as::<FallRiskAssessmentEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn update(&self, assessment: FallRiskAssessmentEntity) -> RepositoryResult<FallRiskAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE fall_risk_assessments SET ");
        qb.push("history_of_falling = ").push_bind(assessment.history_of_falling);
        qb.push(", secondary_diagnosis = ").push_bind(assessment.secondary_diagnosis);
        qb.push(", ambulatory_aid = ").push_bind(assessment.ambulatory_aid);
        qb.push(", iv_therapy = ").push_bind(assessment.iv_therapy);
        qb.push(", gait_status = ").push_bind(assessment.gait_status);
        qb.push(", mental_status = ").push_bind(assessment.mental_status);
        qb.push(", additional_factors = ").push_bind(&assessment.additional_factors);
        qb.push(", interventions = ").push_bind(&assessment.interventions);
        qb.push(", notes = ").push_bind(&assessment.notes);
        qb.push(", next_assessment_due = ").push_bind(&assessment.next_assessment_due);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let result = qb.build_query_as::<FallRiskAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_high_risk_patients(&self) -> RepositoryResult<Vec<FallRiskAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM fall_risk_assessments WHERE risk_level IN ('moderate', 'high') ORDER BY total_score DESC LIMIT 50"
        );

        let assessments = qb.build_query_as::<FallRiskAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(assessments)
    }

    async fn get_assessments_due(&self) -> RepositoryResult<Vec<FallRiskAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM fall_risk_assessments WHERE next_assessment_due <= NOW() ORDER BY next_assessment_due ASC LIMIT 50"
        );

        let assessments = qb.build_query_as::<FallRiskAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(assessments)
    }
}