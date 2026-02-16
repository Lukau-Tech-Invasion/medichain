//! PostgreSQL implementations for Phase 9 Clinical Decision Support repositories.
//!
//! Uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// CDS ALERT REPOSITORY
// =============================================================================

/// PostgreSQL-backed CDS alert repository
#[derive(Debug, Clone)]
pub struct PgCdsAlertRepository {
    pool: PgPool,
}

impl PgCdsAlertRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CdsAlertRepository for PgCdsAlertRepository {
    async fn create(&self, alert: CdsAlertEntity) -> RepositoryResult<CdsAlertEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO cds_alerts (
                id, patient_id, encounter_id, provider_id, alert_datetime,
                alert_type, alert_category, severity, alert_title, alert_message,
                clinical_evidence, recommendation, source_system, rule_id,
                rule_version, trigger_data, related_order_id, related_medication_id,
                related_lab_id, status, acknowledged_by, acknowledged_datetime,
                override_reason, override_justification, action_taken, action_datetime,
                auto_resolved, resolution_reason, was_helpful, feedback_notes,
                displayed_duration_seconds, created_at, updated_at
            ) ",
        );

        qb.push_values([&alert], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(&a.encounter_id)
                .push_bind(&a.provider_id)
                .push_bind(a.alert_datetime)
                .push_bind(&a.alert_type)
                .push_bind(&a.alert_category)
                .push_bind(&a.severity)
                .push_bind(&a.alert_title)
                .push_bind(&a.alert_message)
                .push_bind(&a.clinical_evidence)
                .push_bind(&a.recommendation)
                .push_bind(&a.source_system)
                .push_bind(&a.rule_id)
                .push_bind(&a.rule_version)
                .push_bind(&a.trigger_data)
                .push_bind(&a.related_order_id)
                .push_bind(&a.related_medication_id)
                .push_bind(&a.related_lab_id)
                .push_bind(&a.status)
                .push_bind(&a.acknowledged_by)
                .push_bind(a.acknowledged_datetime)
                .push_bind(&a.override_reason)
                .push_bind(&a.override_justification)
                .push_bind(&a.action_taken)
                .push_bind(a.action_datetime)
                .push_bind(a.auto_resolved)
                .push_bind(&a.resolution_reason)
                .push_bind(a.was_helpful)
                .push_bind(&a.feedback_notes)
                .push_bind(a.displayed_duration_seconds)
                .push_bind(a.created_at)
                .push_bind(a.updated_at);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<CdsAlertEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<CdsAlertEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM cds_alerts WHERE id = ");
        qb.push_bind(id);

        let alert = qb
            .build_query_as::<CdsAlertEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(alert)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        active_only: bool,
    ) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM cds_alerts WHERE patient_id = ");
        qb.push_bind(patient_id);
        if active_only {
            qb.push(" AND status = 'active'");
        }
        qb.push(" ORDER BY created_at DESC");

        let items = qb
            .build_query_as::<CdsAlertEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_encounter(&self, encounter_id: &str) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM cds_alerts WHERE encounter_id = ");
        qb.push_bind(encounter_id);
        qb.push(" ORDER BY severity DESC, created_at DESC");

        let items = qb
            .build_query_as::<CdsAlertEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_unacknowledged(
        &self,
        patient_id: Option<&str>,
    ) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM cds_alerts WHERE acknowledged_by IS NULL AND status = 'active'",
        );
        if let Some(pid) = patient_id {
            qb.push(" AND patient_id = ");
            qb.push_bind(pid);
        }
        qb.push(" ORDER BY severity DESC, created_at ASC");

        let items = qb
            .build_query_as::<CdsAlertEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn acknowledge(
        &self,
        id: &str,
        by: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<CdsAlertEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE cds_alerts SET ");
        qb.push("acknowledged_by = ").push_bind(by);
        qb.push(", acknowledged_datetime = NOW()");
        if let Some(r) = reason {
            qb.push(", action_taken = ").push_bind(r);
        }
        qb.push(", status = 'acknowledged', updated_at = NOW() WHERE id = ")
            .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<CdsAlertEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn override_alert(
        &self,
        id: &str,
        by: &str,
        reason: &str,
    ) -> RepositoryResult<CdsAlertEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE cds_alerts SET ");
        qb.push("override_reason = ").push_bind(reason);
        qb.push(", override_justification = ").push_bind(by);
        qb.push(", status = 'overridden', updated_at = NOW() WHERE id = ")
            .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<CdsAlertEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn dismiss(&self, id: &str) -> RepositoryResult<CdsAlertEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE cds_alerts SET ");
        qb.push("status = 'dismissed', updated_at = NOW() WHERE id = ")
            .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<CdsAlertEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_rule(
        &self,
        rule_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CdsAlertEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM cds_alerts WHERE rule_id = ");
        count_qb.push_bind(rule_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM cds_alerts WHERE rule_id = ");
        qb.push_bind(rule_id);
        qb.push(" ORDER BY created_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<CdsAlertEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_high_severity(&self) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM cds_alerts 
             WHERE severity IN ('critical', 'high') 
             AND status = 'active' 
             AND acknowledged_by IS NULL 
             ORDER BY CASE severity 
                 WHEN 'critical' THEN 1 
                 WHEN 'high' THEN 2 
                 ELSE 3 
             END, created_at ASC",
        );

        let items = qb
            .build_query_as::<CdsAlertEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}
