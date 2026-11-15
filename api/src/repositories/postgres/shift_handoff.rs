//! PostgreSQL repositories for shift handoffs.
//!
//! This module uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

/// PostgreSQL-backed shift handoff repository
#[derive(Debug, Clone)]
pub struct PgShiftHandoffRepository {
    pool: PgPool,
}

impl PgShiftHandoffRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ShiftHandoffRepository for PgShiftHandoffRepository {
    async fn create(&self, handoff: ShiftHandoffEntity) -> RepositoryResult<ShiftHandoffEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO shift_handoffs (
                id, patient_id, outgoing_provider_id, incoming_provider_id,
                handoff_datetime, handoff_type, location_from, location_to,
                situation, background, assessment, recommendation, pending_tasks,
                pending_results, pending_consults, critical_values, code_status,
                isolation_precautions, fall_risk_level, skin_integrity_issues,
                iv_access, drains_tubes, family_concerns, anticipated_disposition,
                contingency_plans, questions_asked, read_back_confirmed,
                acknowledged_by_incoming, acknowledged_at, handoff_tool_used,
                data
            ) ",
        );

        qb.push_values([&handoff], |mut b, h| {
            b.push_bind(&h.id)
                .push_bind(&h.patient_id)
                .push_bind(&h.outgoing_provider_id)
                .push_bind(&h.incoming_provider_id)
                .push_bind(h.handoff_datetime)
                .push_bind(&h.handoff_type)
                .push_bind(&h.location_from)
                .push_bind(&h.location_to)
                .push_bind(&h.situation)
                .push_bind(&h.background)
                .push_bind(&h.assessment)
                .push_bind(&h.recommendation)
                .push_bind(&h.pending_tasks)
                .push_bind(&h.pending_results)
                .push_bind(&h.pending_consults)
                .push_bind(&h.critical_values)
                .push_bind(&h.code_status)
                .push_bind(&h.isolation_precautions)
                .push_bind(&h.fall_risk_level)
                .push_bind(&h.skin_integrity_issues)
                .push_bind(&h.iv_access)
                .push_bind(&h.drains_tubes)
                .push_bind(&h.family_concerns)
                .push_bind(&h.anticipated_disposition)
                .push_bind(&h.contingency_plans)
                .push_bind(&h.questions_asked)
                .push_bind(h.read_back_confirmed)
                .push_bind(h.acknowledged_by_incoming)
                .push_bind(h.acknowledged_at)
                .push_bind(&h.handoff_tool_used)
                .push_bind(&h.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ShiftHandoffEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ShiftHandoffEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM shift_handoffs WHERE id = ");
        qb.push_bind(id);

        let handoff = qb
            .build_query_as::<ShiftHandoffEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(handoff)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ShiftHandoffEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM shift_handoffs WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM shift_handoffs WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY handoff_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<ShiftHandoffEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_provider_since(
        &self,
        provider_id: &str,
        since: NaiveDate,
    ) -> RepositoryResult<Vec<ShiftHandoffEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM shift_handoffs 
             WHERE (outgoing_provider_id = ",
        );
        qb.push_bind(provider_id);
        qb.push(" OR incoming_provider_id = ");
        qb.push_bind(provider_id);
        qb.push(") AND DATE(handoff_datetime) >= ");
        qb.push_bind(since);
        qb.push(" ORDER BY handoff_datetime DESC");

        let items = qb
            .build_query_as::<ShiftHandoffEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_batch(&self, batch_id: &str) -> RepositoryResult<Vec<ShiftHandoffEntity>> {
        // `LIKE 'batch-%'` with the pattern bound, never concatenated. The
        // batch id is server-generated and hex, but a parameterised query is
        // the rule here regardless of who supplies the value.
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM shift_handoffs WHERE id LIKE ");
        qb.push_bind(format!("{batch_id}-%"));
        qb.push(" ORDER BY handoff_datetime DESC");

        let items = qb
            .build_query_as::<ShiftHandoffEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn acknowledge(&self, id: &str) -> RepositoryResult<ShiftHandoffEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE shift_handoffs SET ");
        qb.push("acknowledged_by_incoming = true");
        qb.push(", acknowledged_at = COALESCE(acknowledged_at, NOW())");
        qb.push(", updated_at = CASE WHEN acknowledged_by_incoming THEN updated_at ELSE NOW() END WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ShiftHandoffEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_unacknowledged(
        &self,
        incoming_provider_id: &str,
    ) -> RepositoryResult<Vec<ShiftHandoffEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM shift_handoffs 
             WHERE incoming_provider_id = ",
        );
        qb.push_bind(incoming_provider_id);
        qb.push(" AND acknowledged_by_incoming = false ORDER BY handoff_datetime DESC");

        let items = qb
            .build_query_as::<ShiftHandoffEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}
