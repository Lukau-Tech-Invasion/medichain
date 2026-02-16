//! PostgreSQL implementation of AccessLogRepository.
//! Uses sqlx::QueryBuilder pattern for type-safe query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::{
    AccessLogEntity, AccessLogRepository, DateRange, PaginatedResult, Pagination, RepositoryResult,
};

/// PostgreSQL-backed access log repository
#[derive(Debug, Clone)]
pub struct PgAccessLogRepository {
    pool: PgPool,
}

impl PgAccessLogRepository {
    /// Create a new PostgreSQL access log repository
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AccessLogRepository for PgAccessLogRepository {
    async fn create(&self, log: AccessLogEntity) -> RepositoryResult<AccessLogEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO access_logs (
                id, accessor_id, accessor_role, patient_id, resource_type, resource_id,
                action, access_reason, is_emergency_access, ip_address, user_agent,
                blockchain_tx_hash, accessed_at, facility_id
            ) ",
        );

        qb.push_values([&log], |mut b, l| {
            b.push_bind(&l.id)
                .push_bind(&l.accessor_id)
                .push_bind(&l.accessor_role)
                .push_bind(&l.patient_id)
                .push_bind(&l.resource_type)
                .push_bind(&l.resource_id)
                .push_bind(&l.action)
                .push_bind(&l.access_reason)
                .push_bind(l.is_emergency_access)
                .push_bind(&l.ip_address)
                .push_bind(&l.user_agent)
                .push_bind(&l.blockchain_tx_hash)
                .push_bind(l.accessed_at)
                .push_bind(&l.facility_id);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AccessLogEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_accessor(
        &self,
        accessor_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM access_logs WHERE accessor_id = ");
        count_qb.push_bind(accessor_id);
        let count: (i64,) = count_qb.build_query_as().fetch_one(&self.pool).await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM access_logs WHERE accessor_id = ");
        qb.push_bind(accessor_id);
        qb.push(" ORDER BY accessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let logs = qb
            .build_query_as::<AccessLogEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(logs, count.0 as u64, &pagination))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM access_logs WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let count: (i64,) = count_qb.build_query_as().fetch_one(&self.pool).await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM access_logs WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY accessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let logs = qb
            .build_query_as::<AccessLogEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(logs, count.0 as u64, &pagination))
    }

    async fn get_by_date_range(
        &self,
        range: DateRange,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>> {
        let from = range
            .from
            .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap());
        let to = range.to.unwrap_or_else(chrono::Utc::now);

        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM access_logs WHERE accessed_at >= ");
        count_qb.push_bind(from);
        count_qb.push(" AND accessed_at <= ");
        count_qb.push_bind(to);
        let count: (i64,) = count_qb.build_query_as().fetch_one(&self.pool).await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM access_logs WHERE accessed_at >= ");
        qb.push_bind(from);
        qb.push(" AND accessed_at <= ");
        qb.push_bind(to);
        qb.push(" ORDER BY accessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let logs = qb
            .build_query_as::<AccessLogEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(logs, count.0 as u64, &pagination))
    }

    async fn get_emergency_accesses(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM access_logs WHERE is_emergency_access = true");
        let count: (i64,) = count_qb.build_query_as().fetch_one(&self.pool).await?;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM access_logs WHERE is_emergency_access = true ORDER BY accessed_at DESC LIMIT "
        );
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let logs = qb
            .build_query_as::<AccessLogEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(logs, count.0 as u64, &pagination))
    }

    async fn search(
        &self,
        query: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>> {
        let search_pattern = format!("%{}%", query);

        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM access_logs WHERE accessor_id ILIKE ");
        count_qb.push_bind(&search_pattern);
        count_qb.push(" OR patient_id ILIKE ");
        count_qb.push_bind(&search_pattern);
        count_qb.push(" OR resource_type ILIKE ");
        count_qb.push_bind(&search_pattern);
        count_qb.push(" OR action ILIKE ");
        count_qb.push_bind(&search_pattern);
        let count: (i64,) = count_qb.build_query_as().fetch_one(&self.pool).await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM access_logs WHERE accessor_id ILIKE ");
        qb.push_bind(&search_pattern);
        qb.push(" OR patient_id ILIKE ");
        qb.push_bind(&search_pattern);
        qb.push(" OR resource_type ILIKE ");
        qb.push_bind(&search_pattern);
        qb.push(" OR action ILIKE ");
        qb.push_bind(&search_pattern);
        qb.push(" ORDER BY accessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let logs = qb
            .build_query_as::<AccessLogEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(logs, count.0 as u64, &pagination))
    }
}
