//! PostgreSQL repositories for retention policies and retention job runs.
//!
//! Uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

/// PostgreSQL-backed data retention policy repository
#[derive(Debug, Clone)]
pub struct PgDataRetentionPolicyRepository {
    pool: PgPool,
}

impl PgDataRetentionPolicyRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DataRetentionPolicyRepository for PgDataRetentionPolicyRepository {
    /// Policies whose scheduled review has come due.
    ///
    /// A policy that has never been reviewed is due as soon as it is effective:
    /// `last_reviewed_date IS NULL` is "not yet reviewed", not "reviewed at the
    /// dawn of time", and treating it as the latter would hide exactly the
    /// policies nobody has looked at.
    async fn get_due_for_review(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let items = sqlx::query_as::<_, DataRetentionPolicyEntity>(
            "SELECT * FROM data_retention_policies \n             WHERE is_active = true \n               AND review_frequency_days IS NOT NULL \n               AND ( \n                 last_reviewed_date IS NULL \n                 OR last_reviewed_date + (review_frequency_days || ' days')::interval <= CURRENT_DATE \n               ) \n             ORDER BY last_reviewed_date ASC NULLS FIRST",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(items)
    }

    async fn create(
        &self,
        policy: DataRetentionPolicyEntity,
    ) -> RepositoryResult<DataRetentionPolicyEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO data_retention_policies (
                id, policy_name, entity_type, retention_period_days, retention_period_type,
                archive_after_days, delete_after_days, applies_to_status, department,
                exceptions, legal_hold_override, regulatory_basis, review_frequency_days,
                last_reviewed_date, reviewed_by, is_active, effective_date, end_date
            ) ",
        );

        qb.push_values([&policy], |mut b, p| {
            b.push_bind(&p.id)
                .push_bind(&p.policy_name)
                .push_bind(&p.entity_type)
                .push_bind(p.retention_period_days)
                .push_bind(&p.retention_period_type)
                .push_bind(p.archive_after_days)
                .push_bind(p.delete_after_days)
                .push_bind(&p.applies_to_status)
                .push_bind(&p.department)
                .push_bind(&p.exceptions)
                .push_bind(p.legal_hold_override)
                .push_bind(&p.regulatory_basis)
                .push_bind(p.review_frequency_days)
                .push_bind(p.last_reviewed_date)
                .push_bind(&p.reviewed_by)
                .push_bind(p.is_active)
                .push_bind(p.effective_date)
                .push_bind(p.end_date);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<DataRetentionPolicyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DataRetentionPolicyEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM data_retention_policies WHERE id = ");
        qb.push_bind(id);

        let policy = qb
            .build_query_as::<DataRetentionPolicyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(policy)
    }

    async fn get_active(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM data_retention_policies WHERE is_active = true ORDER BY policy_name ASC",
        );

        let items = qb
            .build_query_as::<DataRetentionPolicyEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_entity_type(
        &self,
        entity_type: &str,
    ) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM data_retention_policies WHERE entity_type = ");
        qb.push_bind(entity_type);
        qb.push(" ORDER BY policy_name ASC");

        let items = qb
            .build_query_as::<DataRetentionPolicyEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        policy: DataRetentionPolicyEntity,
    ) -> RepositoryResult<DataRetentionPolicyEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE data_retention_policies SET ");
        qb.push("policy_name = ").push_bind(&policy.policy_name);
        qb.push(", retention_period_days = ")
            .push_bind(policy.retention_period_days);
        qb.push(", archive_after_days = ")
            .push_bind(policy.archive_after_days);
        qb.push(", delete_after_days = ")
            .push_bind(policy.delete_after_days);
        qb.push(", is_active = ").push_bind(policy.is_active);
        qb.push(", end_date = ").push_bind(policy.end_date);
        qb.push(", last_reviewed_date = ")
            .push_bind(policy.last_reviewed_date);
        qb.push(", reviewed_by = ").push_bind(&policy.reviewed_by);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&policy.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<DataRetentionPolicyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<DataRetentionPolicyEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE data_retention_policies SET is_active = false, updated_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<DataRetentionPolicyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_due_for_execution(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM data_retention_policies 
             WHERE is_active = true 
             AND effective_date <= CURRENT_DATE
             AND (end_date IS NULL OR end_date > CURRENT_DATE)
             ORDER BY policy_name ASC",
        );

        let items = qb
            .build_query_as::<DataRetentionPolicyEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

/// PostgreSQL-backed retention job run repository
#[derive(Debug, Clone)]
pub struct PgRetentionJobRunRepository {
    pool: PgPool,
}

impl PgRetentionJobRunRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl RetentionJobRunRepository for PgRetentionJobRunRepository {
    async fn create(&self, run: RetentionJobRunEntity) -> RepositoryResult<RetentionJobRunEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO retention_job_runs (
                id, policy_id, job_type, started_at, completed_at, entity_type,
                date_threshold, status, records_evaluated, records_archived,
                records_deleted, records_skipped, error_count, error_details,
                run_by, dry_run
            ) ",
        );

        qb.push_values([&run], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.policy_id)
                .push_bind(&r.job_type)
                .push_bind(r.started_at)
                .push_bind(r.completed_at)
                .push_bind(&r.entity_type)
                .push_bind(r.date_threshold)
                .push_bind(&r.status)
                .push_bind(r.records_evaluated)
                .push_bind(r.records_archived)
                .push_bind(r.records_deleted)
                .push_bind(r.records_skipped)
                .push_bind(r.error_count)
                .push_bind(&r.error_details)
                .push_bind(&r.run_by)
                .push_bind(r.dry_run);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RetentionJobRunEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<RetentionJobRunEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM retention_job_runs WHERE id = ");
        qb.push_bind(id);

        let run = qb
            .build_query_as::<RetentionJobRunEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(run)
    }

    async fn get_by_policy(&self, policy_id: &str) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM retention_job_runs WHERE policy_id = ");
        qb.push_bind(policy_id);
        qb.push(" ORDER BY started_at DESC");

        let items = qb
            .build_query_as::<RetentionJobRunEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_status(&self, status: &str) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM retention_job_runs WHERE status = ");
        qb.push_bind(status);
        qb.push(" ORDER BY started_at DESC");

        let items = qb
            .build_query_as::<RetentionJobRunEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(&self, run: RetentionJobRunEntity) -> RepositoryResult<RetentionJobRunEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE retention_job_runs SET ");
        qb.push("completed_at = ").push_bind(run.completed_at);
        qb.push(", status = ").push_bind(&run.status);
        qb.push(", records_evaluated = ")
            .push_bind(run.records_evaluated);
        qb.push(", records_archived = ")
            .push_bind(run.records_archived);
        qb.push(", records_deleted = ")
            .push_bind(run.records_deleted);
        qb.push(", records_skipped = ")
            .push_bind(run.records_skipped);
        qb.push(", error_count = ").push_bind(run.error_count);
        qb.push(", error_details = ").push_bind(&run.error_details);
        qb.push(" WHERE id = ").push_bind(&run.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RetentionJobRunEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_recent(&self, limit: i32) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM retention_job_runs ORDER BY started_at DESC LIMIT ");
        qb.push_bind(limit);

        let items = qb
            .build_query_as::<RetentionJobRunEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_in_progress(&self) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM retention_job_runs WHERE status = 'in_progress' ORDER BY started_at ASC",
        );

        let items = qb
            .build_query_as::<RetentionJobRunEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn complete(
        &self,
        id: &str,
        archived: i32,
        deleted: i32,
        skipped: i32,
    ) -> RepositoryResult<RetentionJobRunEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE retention_job_runs SET ");
        qb.push("status = 'completed', completed_at = NOW()");
        qb.push(", records_archived = ").push_bind(archived);
        qb.push(", records_deleted = ").push_bind(deleted);
        qb.push(", records_skipped = ").push_bind(skipped);
        qb.push(" WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RetentionJobRunEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn fail(
        &self,
        id: &str,
        error_details: serde_json::Value,
    ) -> RepositoryResult<RetentionJobRunEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE retention_job_runs SET ");
        qb.push("status = 'failed', completed_at = NOW()");
        qb.push(", error_details = ").push_bind(error_details);
        qb.push(" WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RetentionJobRunEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}
