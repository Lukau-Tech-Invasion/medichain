//! PostgreSQL implementation of NursingCarePlanRepository.
//! Uses sqlx::QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::{
    NursingCarePlanEntity, NursingCarePlanRepository, PaginatedResult, Pagination, RepositoryResult,
};

#[derive(Debug, Clone)]
pub struct PgNursingCarePlanRepository {
    pool: PgPool,
}

impl PgNursingCarePlanRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl NursingCarePlanRepository for PgNursingCarePlanRepository {
    async fn create(&self, plan: NursingCarePlanEntity) -> RepositoryResult<NursingCarePlanEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO nursing_care_plans (id, patient_id, plan_name, care_level, nursing_diagnoses, goals, interventions, evaluation_notes, status, start_date, target_end_date, actual_end_date, created_by, updated_by, facility_id, data) "
        );

        qb.push_values([&plan], |mut b, p| {
            b.push_bind(&p.id)
                .push_bind(&p.patient_id)
                .push_bind(&p.plan_name)
                .push_bind(&p.care_level)
                .push_bind(&p.nursing_diagnoses)
                .push_bind(&p.goals)
                .push_bind(&p.interventions)
                .push_bind(&p.evaluation_notes)
                .push_bind(&p.status)
                .push_bind(p.start_date)
                .push_bind(p.target_end_date)
                .push_bind(p.actual_end_date)
                .push_bind(&p.created_by)
                .push_bind(&p.updated_by)
                .push_bind(&p.facility_id)
                .push_bind(&p.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<NursingCarePlanEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<NursingCarePlanEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM nursing_care_plans WHERE id = ");
        qb.push_bind(id);
        qb.push(" AND is_active = true");

        let plan = qb
            .build_query_as::<NursingCarePlanEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(plan)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<NursingCarePlanEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM nursing_care_plans WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        count_qb.push(" AND is_active = true");

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM nursing_care_plans WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY start_date DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let plans = qb
            .build_query_as::<NursingCarePlanEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(plans, total as u64, &pagination))
    }

    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<NursingCarePlanEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM nursing_care_plans WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true AND status = 'Active' ORDER BY start_date DESC");

        let plans = qb
            .build_query_as::<NursingCarePlanEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(plans)
    }

    async fn update(&self, plan: NursingCarePlanEntity) -> RepositoryResult<NursingCarePlanEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE nursing_care_plans SET ");
        qb.push("plan_name = ").push_bind(&plan.plan_name);
        qb.push(", care_level = ").push_bind(&plan.care_level);
        qb.push(", nursing_diagnoses = ")
            .push_bind(&plan.nursing_diagnoses);
        qb.push(", goals = ").push_bind(&plan.goals);
        qb.push(", interventions = ").push_bind(&plan.interventions);
        qb.push(", evaluation_notes = ")
            .push_bind(&plan.evaluation_notes);
        qb.push(", status = ").push_bind(&plan.status);
        qb.push(", start_date = ").push_bind(plan.start_date);
        qb.push(", target_end_date = ")
            .push_bind(plan.target_end_date);
        qb.push(", actual_end_date = ")
            .push_bind(plan.actual_end_date);
        qb.push(", updated_by = ").push_bind(&plan.updated_by);
        qb.push(", data = ").push_bind(&plan.data);
        qb.push(", updated_at = CURRENT_TIMESTAMP WHERE id = ")
            .push_bind(&plan.id);
        qb.push(" AND is_active = true RETURNING *");

        let result = qb
            .build_query_as::<NursingCarePlanEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE nursing_care_plans SET is_active = false WHERE id = ");
        qb.push_bind(id);

        qb.build().execute(&self.pool).await?;

        Ok(())
    }

    async fn get_by_care_level(
        &self,
        care_level: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<NursingCarePlanEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM nursing_care_plans WHERE care_level = ");
        count_qb.push_bind(care_level);
        count_qb.push(" AND is_active = true");

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM nursing_care_plans WHERE care_level = ");
        qb.push_bind(care_level);
        qb.push(" AND is_active = true ORDER BY start_date DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let plans = qb
            .build_query_as::<NursingCarePlanEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(plans, total as u64, &pagination))
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<NursingCarePlanEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM nursing_care_plans WHERE is_active = true");

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM nursing_care_plans WHERE is_active = true ORDER BY start_date DESC LIMIT ",
        );
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let plans = qb
            .build_query_as::<NursingCarePlanEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(plans, total as u64, &pagination))
    }
}
