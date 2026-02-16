//! PostgreSQL Medication Record repository using QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::{
    DateRange, MedicationRecordEntity, MedicationRecordRepository, PaginatedResult, Pagination,
    RepositoryResult,
};

#[derive(Debug, Clone)]
pub struct PgMedicationRecordRepository {
    pool: PgPool,
}

impl PgMedicationRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MedicationRecordRepository for PgMedicationRecordRepository {
    async fn create(
        &self,
        record: MedicationRecordEntity,
    ) -> RepositoryResult<MedicationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO medication_records (
                id, patient_id, record_date, scheduled_medications, prn_medications,
                infusions, completion_status, completion_percentage, primary_nurse, facility_id
            ) ",
        );

        qb.push_values([&record], |mut b, e| {
            b.push_bind(&e.id)
                .push_bind(&e.patient_id)
                .push_bind(e.record_date)
                .push_bind(&e.scheduled_medications)
                .push_bind(&e.prn_medications)
                .push_bind(&e.infusions)
                .push_bind(&e.completion_status)
                .push_bind(e.completion_percentage)
                .push_bind(&e.primary_nurse)
                .push_bind(&e.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<MedicationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<MedicationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM medication_records WHERE id = ");
        qb.push_bind(id);
        qb.push(" AND is_active = true");

        let record = qb
            .build_query_as::<MedicationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient_and_date(
        &self,
        patient_id: &str,
        date: chrono::NaiveDate,
    ) -> RepositoryResult<Option<MedicationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM medication_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND record_date = ").push_bind(date);
        qb.push(" AND is_active = true");

        let record = qb
            .build_query_as::<MedicationRecordEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        _date_range: Option<DateRange>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicationRecordEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM medication_records WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        count_qb.push(" AND is_active = true");

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM medication_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY record_date DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let records = qb
            .build_query_as::<MedicationRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(records, total as u64, &pagination))
    }

    async fn update(
        &self,
        record: MedicationRecordEntity,
    ) -> RepositoryResult<MedicationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE medication_records SET ");
        qb.push("scheduled_medications = ")
            .push_bind(&record.scheduled_medications);
        qb.push(", prn_medications = ")
            .push_bind(&record.prn_medications);
        qb.push(", infusions = ").push_bind(&record.infusions);
        qb.push(", completion_status = ")
            .push_bind(&record.completion_status);
        qb.push(", completion_percentage = ")
            .push_bind(record.completion_percentage);
        qb.push(", primary_nurse = ")
            .push_bind(&record.primary_nurse);
        qb.push(", updated_at = CURRENT_TIMESTAMP WHERE id = ")
            .push_bind(&record.id);
        qb.push(" AND is_active = true RETURNING *");

        let result = qb
            .build_query_as::<MedicationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_incomplete_records(&self) -> RepositoryResult<Vec<MedicationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM medication_records 
            WHERE is_active = true 
            AND (completion_percentage IS NULL OR completion_percentage < 100)
            ORDER BY record_date DESC",
        );

        let records = qb
            .build_query_as::<MedicationRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(records)
    }
}
