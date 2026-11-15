//! PostgreSQL repositories for incident reports.
//!
//! This module uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

/// PostgreSQL-backed incident report repository
#[derive(Debug, Clone)]
pub struct PgIncidentReportRepository {
    pool: PgPool,
}

impl PgIncidentReportRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl IncidentReportRepository for PgIncidentReportRepository {
    async fn create(&self, report: IncidentReportEntity) -> RepositoryResult<IncidentReportEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO incident_reports (
                id, patient_id, reporter_id, incident_datetime, discovery_datetime,
                incident_type, severity, location, department, description,
                immediate_actions_taken, patient_outcome, patient_notified,
                patient_notified_by, family_notified, attending_notified,
                supervisor_notified, risk_management_notified, witnesses,
                contributing_factors, root_cause, preventable, similar_incidents_prior,
                corrective_actions, follow_up_required, follow_up_assigned_to,
                follow_up_due_date, follow_up_completed, follow_up_completed_at,
                investigation_status, reviewed_by, reviewed_at, review_comments,
                regulatory_reportable, reported_to_agencies, confidential, data
            ) ",
        );

        qb.push_values([&report], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.reporter_id)
                .push_bind(r.incident_datetime)
                .push_bind(r.discovery_datetime)
                .push_bind(&r.incident_type)
                .push_bind(&r.severity)
                .push_bind(&r.location)
                .push_bind(&r.department)
                .push_bind(&r.description)
                .push_bind(&r.immediate_actions_taken)
                .push_bind(&r.patient_outcome)
                .push_bind(r.patient_notified)
                .push_bind(&r.patient_notified_by)
                .push_bind(r.family_notified)
                .push_bind(r.attending_notified)
                .push_bind(r.supervisor_notified)
                .push_bind(r.risk_management_notified)
                .push_bind(&r.witnesses)
                .push_bind(&r.contributing_factors)
                .push_bind(&r.root_cause)
                .push_bind(r.preventable)
                .push_bind(r.similar_incidents_prior)
                .push_bind(&r.corrective_actions)
                .push_bind(r.follow_up_required)
                .push_bind(&r.follow_up_assigned_to)
                .push_bind(r.follow_up_due_date)
                .push_bind(r.follow_up_completed)
                .push_bind(r.follow_up_completed_at)
                .push_bind(&r.investigation_status)
                .push_bind(&r.reviewed_by)
                .push_bind(r.reviewed_at)
                .push_bind(&r.review_comments)
                .push_bind(r.regulatory_reportable)
                .push_bind(&r.reported_to_agencies)
                .push_bind(r.confidential)
                // The blob the read handlers serve. Omitted until
                // `20260910000006`, so every read of it on PostgreSQL
                // returned null while the in-memory backend returned
                // the record.
                .push_bind(&r.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<IncidentReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<IncidentReportEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM incident_reports WHERE id = ");
        qb.push_bind(id);

        let report = qb
            .build_query_as::<IncidentReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(report)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IncidentReportEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM incident_reports WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM incident_reports WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY incident_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<IncidentReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, report: IncidentReportEntity) -> RepositoryResult<IncidentReportEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE incident_reports SET ");
        qb.push("description = ").push_bind(&report.description);
        qb.push(", immediate_actions_taken = ")
            .push_bind(&report.immediate_actions_taken);
        qb.push(", patient_outcome = ")
            .push_bind(&report.patient_outcome);
        qb.push(", root_cause = ").push_bind(&report.root_cause);
        qb.push(", corrective_actions = ")
            .push_bind(&report.corrective_actions);
        qb.push(", investigation_status = ")
            .push_bind(&report.investigation_status);
        qb.push(", reviewed_by = ").push_bind(&report.reviewed_by);
        qb.push(", reviewed_at = ").push_bind(report.reviewed_at);
        qb.push(", review_comments = ")
            .push_bind(&report.review_comments);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&report.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<IncidentReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_open_investigations(&self) -> RepositoryResult<Vec<IncidentReportEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM incident_reports 
             WHERE investigation_status IN ('open', 'in_progress')
             ORDER BY incident_datetime DESC",
        );

        let items = qb
            .build_query_as::<IncidentReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_severity(&self, severity: &str) -> RepositoryResult<Vec<IncidentReportEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM incident_reports WHERE severity = ");
        qb.push_bind(severity);
        qb.push(" ORDER BY incident_datetime DESC");

        let items = qb
            .build_query_as::<IncidentReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_type(
        &self,
        incident_type: &str,
        date_range: Option<DateRange>,
    ) -> RepositoryResult<Vec<IncidentReportEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM incident_reports WHERE incident_type = ");
        qb.push_bind(incident_type);

        if let Some(range) = date_range {
            if let Some(from) = range.from {
                qb.push(" AND incident_datetime >= ");
                qb.push_bind(from);
            }
            if let Some(to) = range.to {
                qb.push(" AND incident_datetime <= ");
                qb.push_bind(to);
            }
        }

        qb.push(" ORDER BY incident_datetime DESC");

        let items = qb
            .build_query_as::<IncidentReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IncidentReportEntity>> {
        let total = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM incident_reports")
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM incident_reports ORDER BY incident_datetime DESC LIMIT ",
        );
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<IncidentReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }
}
