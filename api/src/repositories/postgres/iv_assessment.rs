//! PostgreSQL IV Assessment repository using QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::{
    IVAssessmentEntity, IVAssessmentRepository, PaginatedResult, Pagination, RepositoryResult,
};

#[derive(Debug, Clone)]
pub struct PgIVAssessmentRepository {
    pool: PgPool,
}

impl PgIVAssessmentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl IVAssessmentRepository for PgIVAssessmentRepository {
    async fn create(&self, assessment: IVAssessmentEntity) -> RepositoryResult<IVAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO iv_assessments (
                id, patient_id, site_id, site_location, catheter_type, catheter_gauge,
                insertion_date, patency, site_appearance, infiltration_grade, phlebitis_grade,
                current_infusions, dressing_intact, dressing_change_due, pain_level, notes,
                actions_taken, site_discontinued, discontinuation_reason, assessed_by, assessed_at, facility_id
            ) "
        );

        qb.push_values([&assessment], |mut b, e| {
            b.push_bind(&e.id)
                .push_bind(&e.patient_id)
                .push_bind(&e.site_id)
                .push_bind(&e.site_location)
                .push_bind(&e.catheter_type)
                .push_bind(&e.catheter_gauge)
                .push_bind(e.insertion_date)
                .push_bind(&e.patency)
                .push_bind(&e.site_appearance)
                .push_bind(e.infiltration_grade)
                .push_bind(e.phlebitis_grade)
                .push_bind(&e.current_infusions)
                .push_bind(e.dressing_intact)
                .push_bind(e.dressing_change_due)
                .push_bind(e.pain_level)
                .push_bind(&e.notes)
                .push_bind(&e.actions_taken)
                .push_bind(e.site_discontinued)
                .push_bind(&e.discontinuation_reason)
                .push_bind(&e.assessed_by)
                .push_bind(e.assessed_at)
                .push_bind(&e.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<IVAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<IVAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM iv_assessments WHERE id = ");
        qb.push_bind(id);

        let assessment = qb
            .build_query_as::<IVAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IVAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM iv_assessments WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM iv_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let assessments = qb
            .build_query_as::<IVAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(assessments, total as u64, &pagination))
    }

    async fn get_by_site_id(
        &self,
        site_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IVAssessmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM iv_assessments WHERE site_id = ");
        count_qb.push_bind(site_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM iv_assessments WHERE site_id = ");
        qb.push_bind(site_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let assessments = qb
            .build_query_as::<IVAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(assessments, total as u64, &pagination))
    }

    async fn update(&self, assessment: IVAssessmentEntity) -> RepositoryResult<IVAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE iv_assessments SET ");
        qb.push("site_location = ")
            .push_bind(&assessment.site_location);
        qb.push(", catheter_type = ")
            .push_bind(&assessment.catheter_type);
        qb.push(", catheter_gauge = ")
            .push_bind(&assessment.catheter_gauge);
        qb.push(", patency = ").push_bind(&assessment.patency);
        qb.push(", site_appearance = ")
            .push_bind(&assessment.site_appearance);
        qb.push(", infiltration_grade = ")
            .push_bind(assessment.infiltration_grade);
        qb.push(", phlebitis_grade = ")
            .push_bind(assessment.phlebitis_grade);
        qb.push(", current_infusions = ")
            .push_bind(&assessment.current_infusions);
        qb.push(", dressing_intact = ")
            .push_bind(assessment.dressing_intact);
        qb.push(", dressing_change_due = ")
            .push_bind(assessment.dressing_change_due);
        qb.push(", pain_level = ").push_bind(assessment.pain_level);
        qb.push(", notes = ").push_bind(&assessment.notes);
        qb.push(", actions_taken = ")
            .push_bind(&assessment.actions_taken);
        qb.push(", site_discontinued = ")
            .push_bind(assessment.site_discontinued);
        qb.push(", discontinuation_reason = ")
            .push_bind(&assessment.discontinuation_reason);
        qb.push(", updated_at = CURRENT_TIMESTAMP WHERE id = ")
            .push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<IVAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_active_sites_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<IVAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM iv_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND (site_discontinued IS NULL OR site_discontinued = false) ORDER BY assessed_at DESC");

        let assessments = qb
            .build_query_as::<IVAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(assessments)
    }

    async fn get_sites_needing_attention(&self) -> RepositoryResult<Vec<IVAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM iv_assessments 
            WHERE (site_discontinued IS NULL OR site_discontinued = false)
            AND (
                infiltration_grade >= 2
                OR phlebitis_grade >= 2
                OR dressing_intact = false
                OR dressing_change_due <= CURRENT_DATE
                OR pain_level >= 5
            )
            ORDER BY assessed_at DESC",
        );

        let assessments = qb
            .build_query_as::<IVAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(assessments)
    }
}
