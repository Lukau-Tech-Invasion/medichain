//! PostgreSQL implementation of MedicalRecordRepository using QueryBuilder pattern.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::{
    DateRange, MedicalRecordEntity, MedicalRecordRepository, PaginatedResult, Pagination,
    RepositoryError, RepositoryResult,
};

/// PostgreSQL-backed medical record repository
#[derive(Debug, Clone)]
pub struct PgMedicalRecordRepository {
    pool: PgPool,
}

impl PgMedicalRecordRepository {
    /// Create a new PostgreSQL medical record repository
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MedicalRecordRepository for PgMedicalRecordRepository {
    async fn create(&self, record: MedicalRecordEntity) -> RepositoryResult<MedicalRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO medical_records (
                id, patient_id, record_type, category, ipfs_content_hash, ipfs_metadata_hash,
                content_checksum, on_chain_hash, blockchain_tx_hash, summary_encrypted,
                record_date, created_by, last_modified_by, facility_id, is_active, is_locked
            ) ",
        );

        qb.push_values([&record], |mut b, e| {
            b.push_bind(&e.id)
                .push_bind(&e.patient_id)
                .push_bind(&e.record_type)
                .push_bind(&e.category)
                .push_bind(&e.ipfs_content_hash)
                .push_bind(&e.ipfs_metadata_hash)
                .push_bind(&e.content_checksum)
                .push_bind(&e.on_chain_hash)
                .push_bind(&e.blockchain_tx_hash)
                .push_bind(&e.summary_encrypted)
                .push_bind(e.record_date)
                .push_bind(&e.created_by)
                .push_bind(&e.last_modified_by)
                .push_bind(&e.facility_id)
                .push_bind(e.is_active)
                .push_bind(e.is_locked);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<MedicalRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<MedicalRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM medical_records WHERE id = ");
        qb.push_bind(id);
        qb.push(" AND is_active = true");

        let record = qb
            .build_query_as::<MedicalRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicalRecordEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM medical_records WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        count_qb.push(" AND is_active = true");

        let count: (i64,) = count_qb.build_query_as().fetch_one(&self.pool).await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM medical_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY record_date DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let records = qb
            .build_query_as::<MedicalRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(records, count.0 as u64, &pagination))
    }

    async fn get_by_patient_and_type(
        &self,
        patient_id: &str,
        record_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicalRecordEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM medical_records WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        count_qb.push(" AND record_type = ").push_bind(record_type);
        count_qb.push(" AND is_active = true");

        let count: (i64,) = count_qb.build_query_as().fetch_one(&self.pool).await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM medical_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND record_type = ").push_bind(record_type);
        qb.push(" AND is_active = true ORDER BY record_date DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let records = qb
            .build_query_as::<MedicalRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(records, count.0 as u64, &pagination))
    }

    async fn get_by_ipfs_hash(&self, ipfs_hash: &str) -> RepositoryResult<MedicalRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM medical_records WHERE ipfs_content_hash = ");
        qb.push_bind(ipfs_hash);
        qb.push(" AND is_active = true");

        let record = qb
            .build_query_as::<MedicalRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn update(&self, record: MedicalRecordEntity) -> RepositoryResult<MedicalRecordEntity> {
        // Check if record is locked
        let mut lock_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT is_locked FROM medical_records WHERE id = ");
        lock_qb.push_bind(&record.id);

        let existing: Option<(bool,)> = lock_qb.build_query_as().fetch_optional(&self.pool).await?;

        if let Some((true,)) = existing {
            return Err(RepositoryError::Validation("Record is locked".into()));
        }

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE medical_records SET ");
        qb.push("record_type = ").push_bind(&record.record_type);
        qb.push(", category = ").push_bind(&record.category);
        qb.push(", ipfs_content_hash = ")
            .push_bind(&record.ipfs_content_hash);
        qb.push(", ipfs_metadata_hash = ")
            .push_bind(&record.ipfs_metadata_hash);
        qb.push(", content_checksum = ")
            .push_bind(&record.content_checksum);
        qb.push(", on_chain_hash = ")
            .push_bind(&record.on_chain_hash);
        qb.push(", blockchain_tx_hash = ")
            .push_bind(&record.blockchain_tx_hash);
        qb.push(", summary_encrypted = ")
            .push_bind(&record.summary_encrypted);
        qb.push(", record_date = ").push_bind(record.record_date);
        qb.push(", last_modified_by = ")
            .push_bind(&record.last_modified_by);
        qb.push(", facility_id = ").push_bind(&record.facility_id);
        qb.push(", is_active = ").push_bind(record.is_active);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" AND is_locked = false RETURNING *");

        let result = qb
            .build_query_as::<MedicalRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE medical_records SET is_active = false, updated_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);
        qb.push(" AND is_locked = false");

        let result = qb.build().execute(&self.pool).await?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound(format!(
                "Record {} not found or is locked",
                id
            )));
        }

        Ok(())
    }

    async fn lock(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE medical_records SET is_locked = true, updated_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);

        let result = qb.build().execute(&self.pool).await?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound(format!(
                "Record {} not found",
                id
            )));
        }

        Ok(())
    }

    async fn get_by_date_range(
        &self,
        patient_id: &str,
        range: DateRange,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicalRecordEntity>> {
        let from = range
            .from
            .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap());
        let to = range.to.unwrap_or_else(chrono::Utc::now);

        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM medical_records WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        count_qb.push(" AND is_active = true AND record_date >= ");
        count_qb.push_bind(from);
        count_qb.push(" AND record_date <= ");
        count_qb.push_bind(to);

        let count: (i64,) = count_qb.build_query_as().fetch_one(&self.pool).await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM medical_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true AND record_date >= ");
        qb.push_bind(from);
        qb.push(" AND record_date <= ");
        qb.push_bind(to);
        qb.push(" ORDER BY record_date DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let records = qb
            .build_query_as::<MedicalRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(records, count.0 as u64, &pagination))
    }
}
