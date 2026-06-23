//! PostgreSQL History Physical repository using QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::{
    HistoryPhysicalEntity, HistoryPhysicalRepository, PaginatedResult, Pagination, RepositoryResult,
};

#[derive(Debug, Clone)]
pub struct PgHistoryPhysicalRepository {
    pool: PgPool,
}

impl PgHistoryPhysicalRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl HistoryPhysicalRepository for PgHistoryPhysicalRepository {
    async fn create(&self, hp: HistoryPhysicalEntity) -> RepositoryResult<HistoryPhysicalEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO history_physicals (
                id, patient_id, chief_complaint, history_present_illness, past_medical_history,
                family_history, social_history, medications, allergies, review_of_systems,
                physical_exam, vital_signs, assessment, plan_content, exam_type,
                performed_by, performed_at, facility_id, data
            ) ",
        );

        qb.push_values([&hp], |mut b, e| {
            b.push_bind(&e.id)
                .push_bind(&e.patient_id)
                .push_bind(&e.chief_complaint)
                .push_bind(&e.history_present_illness)
                .push_bind(&e.past_medical_history)
                .push_bind(&e.family_history)
                .push_bind(&e.social_history)
                .push_bind(&e.medications)
                .push_bind(&e.allergies)
                .push_bind(&e.review_of_systems)
                .push_bind(&e.physical_exam)
                .push_bind(&e.vital_signs)
                .push_bind(&e.assessment)
                .push_bind(&e.plan_content)
                .push_bind(&e.exam_type)
                .push_bind(&e.performed_by)
                .push_bind(e.performed_at)
                .push_bind(&e.facility_id)
                .push_bind(&e.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<HistoryPhysicalEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<HistoryPhysicalEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM history_physicals WHERE id = ");
        qb.push_bind(id);

        let hp = qb
            .build_query_as::<HistoryPhysicalEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(hp)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<HistoryPhysicalEntity>> {
        let offset = pagination.offset() as i64;
        let limit = pagination.limit() as i64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM history_physicals WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY performed_at DESC LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);

        let hps = qb
            .build_query_as::<HistoryPhysicalEntity>()
            .fetch_all(&self.pool)
            .await?;

        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM history_physicals WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        count_qb.push(" AND is_active = true");

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        Ok(PaginatedResult::new(hps, total as u64, &pagination))
    }

    async fn update(&self, hp: HistoryPhysicalEntity) -> RepositoryResult<HistoryPhysicalEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE history_physicals SET ");
        qb.push("chief_complaint = ").push_bind(&hp.chief_complaint);
        qb.push(", history_present_illness = ")
            .push_bind(&hp.history_present_illness);
        qb.push(", past_medical_history = ")
            .push_bind(&hp.past_medical_history);
        qb.push(", family_history = ").push_bind(&hp.family_history);
        qb.push(", social_history = ").push_bind(&hp.social_history);
        qb.push(", medications = ").push_bind(&hp.medications);
        qb.push(", allergies = ").push_bind(&hp.allergies);
        qb.push(", review_of_systems = ")
            .push_bind(&hp.review_of_systems);
        qb.push(", physical_exam = ").push_bind(&hp.physical_exam);
        qb.push(", vital_signs = ").push_bind(&hp.vital_signs);
        qb.push(", assessment = ").push_bind(&hp.assessment);
        qb.push(", plan_content = ").push_bind(&hp.plan_content);
        qb.push(", exam_type = ").push_bind(&hp.exam_type);
        qb.push(", performed_by = ").push_bind(&hp.performed_by);
        qb.push(", performed_at = ").push_bind(hp.performed_at);
        qb.push(", facility_id = ").push_bind(&hp.facility_id);
        qb.push(", data = ").push_bind(&hp.data);
        qb.push(", updated_at = CURRENT_TIMESTAMP WHERE id = ")
            .push_bind(&hp.id);
        qb.push(" RETURNING *");

        let updated = qb
            .build_query_as::<HistoryPhysicalEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(updated)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE history_physicals SET is_active = false WHERE id = ");
        qb.push_bind(id);

        qb.build().execute(&self.pool).await?;

        Ok(())
    }

    async fn get_by_exam_type(
        &self,
        exam_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<HistoryPhysicalEntity>> {
        let offset = pagination.offset() as i64;
        let limit = pagination.limit() as i64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM history_physicals WHERE exam_type = ");
        qb.push_bind(exam_type);
        qb.push(" AND is_active = true ORDER BY performed_at DESC LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);

        let hps = qb
            .build_query_as::<HistoryPhysicalEntity>()
            .fetch_all(&self.pool)
            .await?;

        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM history_physicals WHERE exam_type = ");
        count_qb.push_bind(exam_type);
        count_qb.push(" AND is_active = true");

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        Ok(PaginatedResult::new(hps, total as u64, &pagination))
    }
}
