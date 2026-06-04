//! PostgreSQL IO Record repository using QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::{
    DateRange, IORecordEntity, IORecordRepository, PaginatedResult, Pagination, RepositoryResult,
};

#[derive(Debug, Clone)]
pub struct PgIORecordRepository {
    pool: PgPool,
}

impl PgIORecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl IORecordRepository for PgIORecordRepository {
    async fn create(&self, record: IORecordEntity) -> RepositoryResult<IORecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO io_records (
                id, patient_id, record_date, shift, oral_intake, iv_intake, tube_feeding,
                other_intake, urine_output, emesis, drainage, stool, other_output,
                intake_items, output_items, notes, recorded_by, verified_by, facility_id
            ) ",
        );

        qb.push_values([&record], |mut b, e| {
            b.push_bind(&e.id)
                .push_bind(&e.patient_id)
                .push_bind(e.record_date)
                .push_bind(&e.shift)
                .push_bind(e.oral_intake)
                .push_bind(e.iv_intake)
                .push_bind(e.tube_feeding)
                .push_bind(e.other_intake)
                .push_bind(e.urine_output)
                .push_bind(e.emesis)
                .push_bind(e.drainage)
                .push_bind(e.stool)
                .push_bind(e.other_output)
                .push_bind(&e.intake_items)
                .push_bind(&e.output_items)
                .push_bind(&e.notes)
                .push_bind(&e.recorded_by)
                .push_bind(&e.verified_by)
                .push_bind(&e.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<IORecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<IORecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM io_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<IORecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient_date_shift(
        &self,
        patient_id: &str,
        date: chrono::NaiveDate,
        shift: &str,
    ) -> RepositoryResult<Option<IORecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM io_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND record_date = ").push_bind(date);
        qb.push(" AND shift = ").push_bind(shift);

        let record = qb
            .build_query_as::<IORecordEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        _date_range: Option<DateRange>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IORecordEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM io_records WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM io_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY record_date DESC, shift LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let records = qb
            .build_query_as::<IORecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(records, total as u64, &pagination))
    }

    async fn update(&self, record: IORecordEntity) -> RepositoryResult<IORecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE io_records SET ");
        qb.push("oral_intake = ").push_bind(record.oral_intake);
        qb.push(", iv_intake = ").push_bind(record.iv_intake);
        qb.push(", tube_feeding = ").push_bind(record.tube_feeding);
        qb.push(", other_intake = ").push_bind(record.other_intake);
        qb.push(", urine_output = ").push_bind(record.urine_output);
        qb.push(", emesis = ").push_bind(record.emesis);
        qb.push(", drainage = ").push_bind(record.drainage);
        qb.push(", stool = ").push_bind(record.stool);
        qb.push(", other_output = ").push_bind(record.other_output);
        qb.push(", intake_items = ").push_bind(&record.intake_items);
        qb.push(", output_items = ").push_bind(&record.output_items);
        qb.push(", notes = ").push_bind(&record.notes);
        qb.push(", verified_by = ").push_bind(&record.verified_by);
        qb.push(", updated_at = CURRENT_TIMESTAMP WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<IORecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_negative_balance_patients(&self) -> RepositoryResult<Vec<IORecordEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM io_records WHERE net_balance < 0 ORDER BY record_date DESC",
        );

        let records = qb
            .build_query_as::<IORecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(records)
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IORecordEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM io_records");

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM io_records ORDER BY record_date DESC, shift LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let records = qb
            .build_query_as::<IORecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(records, total as u64, &pagination))
    }
}
