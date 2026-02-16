//! PostgreSQL implementations for Phase 15 Audit/Compliance repositories.
//!
//! Uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// COMPLIANCE REPORT REPOSITORY
// =============================================================================

/// PostgreSQL-backed compliance report repository
#[derive(Debug, Clone)]
pub struct PgComplianceReportRepository {
    pool: PgPool,
}

impl PgComplianceReportRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ComplianceReportRepository for PgComplianceReportRepository {
    async fn create(
        &self,
        report: ComplianceReportEntity,
    ) -> RepositoryResult<ComplianceReportEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO compliance_reports (
                id, report_type, report_name, reporting_period_start, reporting_period_end,
                generated_by, generated_at, department, facility_id, total_events,
                compliant_count, violation_count, high_risk_count, findings,
                recommendations, status, reviewed_by, reviewed_at, review_notes,
                report_url, report_ipfs_hash
            ) ",
        );

        qb.push_values([&report], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.report_type)
                .push_bind(&r.report_name)
                .push_bind(r.reporting_period_start)
                .push_bind(r.reporting_period_end)
                .push_bind(&r.generated_by)
                .push_bind(r.generated_at)
                .push_bind(&r.department)
                .push_bind(&r.facility_id)
                .push_bind(r.total_events)
                .push_bind(r.compliant_count)
                .push_bind(r.violation_count)
                .push_bind(r.high_risk_count)
                .push_bind(&r.findings)
                .push_bind(&r.recommendations)
                .push_bind(&r.status)
                .push_bind(&r.reviewed_by)
                .push_bind(r.reviewed_at)
                .push_bind(&r.review_notes)
                .push_bind(&r.report_url)
                .push_bind(&r.report_ipfs_hash);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ComplianceReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ComplianceReportEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM compliance_reports WHERE id = ");
        qb.push_bind(id);

        let report = qb
            .build_query_as::<ComplianceReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(report)
    }

    async fn get_by_type(
        &self,
        report_type: &str,
    ) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM compliance_reports WHERE report_type = ");
        qb.push_bind(report_type);
        qb.push(" ORDER BY generated_at DESC");

        let items = qb
            .build_query_as::<ComplianceReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_framework(
        &self,
        framework: &str,
    ) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        // Framework not directly in entity, filter by report_type as proxy
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM compliance_reports WHERE report_type = ");
        qb.push_bind(framework);
        qb.push(" ORDER BY generated_at DESC");

        let items = qb
            .build_query_as::<ComplianceReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_status(&self, status: &str) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM compliance_reports WHERE status = ");
        qb.push_bind(status);
        qb.push(" ORDER BY generated_at DESC");

        let items = qb
            .build_query_as::<ComplianceReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        report: ComplianceReportEntity,
    ) -> RepositoryResult<ComplianceReportEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE compliance_reports SET ");
        qb.push("status = ").push_bind(&report.status);
        qb.push(", reviewed_by = ").push_bind(&report.reviewed_by);
        qb.push(", reviewed_at = ").push_bind(report.reviewed_at);
        qb.push(", review_notes = ").push_bind(&report.review_notes);
        qb.push(", findings = ").push_bind(&report.findings);
        qb.push(", recommendations = ")
            .push_bind(&report.recommendations);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&report.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ComplianceReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_period(
        &self,
        start: chrono::NaiveDate,
        end: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM compliance_reports WHERE reporting_period_start >= ");
        qb.push_bind(start);
        qb.push(" AND reporting_period_end <= ");
        qb.push_bind(end);
        qb.push(" ORDER BY reporting_period_start DESC");

        let items = qb
            .build_query_as::<ComplianceReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn approve(
        &self,
        id: &str,
        reviewed_by: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<ComplianceReportEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE compliance_reports SET ");
        qb.push("status = 'approved', reviewed_by = ")
            .push_bind(reviewed_by);
        qb.push(", reviewed_at = NOW()");
        qb.push(", review_notes = ").push_bind(notes);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ComplianceReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_pending_review(&self) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM compliance_reports WHERE status = 'pending_review' ORDER BY generated_at ASC",
        );

        let items = qb
            .build_query_as::<ComplianceReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// DATA RETENTION POLICY REPOSITORY
// =============================================================================

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

// =============================================================================
// RETENTION JOB RUN REPOSITORY
// =============================================================================

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

// =============================================================================
// CONSENT RECORD REPOSITORY
// =============================================================================

/// PostgreSQL-backed consent record repository
#[derive(Debug, Clone)]
pub struct PgConsentRecordRepository {
    pool: PgPool,
}

impl PgConsentRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ConsentRecordRepository for PgConsentRecordRepository {
    async fn create(&self, record: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO consent_records (
                id, patient_id, consent_type, consent_given, consent_datetime,
                expiration_datetime, scope_description, data_types_covered, purpose,
                recipient_organization, collection_method, witness_name, witness_signature,
                collector_id, collector_name, revoked, revoked_datetime, revocation_reason,
                revoked_by, document_url, document_ipfs_hash, regulatory_requirement, version
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.consent_type)
                .push_bind(r.consent_given)
                .push_bind(r.consent_datetime)
                .push_bind(r.expiration_datetime)
                .push_bind(&r.scope_description)
                .push_bind(&r.data_types_covered)
                .push_bind(&r.purpose)
                .push_bind(&r.recipient_organization)
                .push_bind(&r.collection_method)
                .push_bind(&r.witness_name)
                .push_bind(&r.witness_signature)
                .push_bind(&r.collector_id)
                .push_bind(&r.collector_name)
                .push_bind(r.revoked)
                .push_bind(r.revoked_datetime)
                .push_bind(&r.revocation_reason)
                .push_bind(&r.revoked_by)
                .push_bind(&r.document_url)
                .push_bind(&r.document_ipfs_hash)
                .push_bind(&r.regulatory_requirement)
                .push_bind(&r.version);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ConsentRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consent_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consent_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY consent_datetime DESC");

        let items = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consent_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND consent_given = true AND (revoked IS NULL OR revoked = false) ORDER BY consent_datetime DESC");

        let items = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_type(
        &self,
        patient_id: &str,
        consent_type: &str,
    ) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM consent_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND consent_type = ");
        qb.push_bind(consent_type);
        qb.push(" ORDER BY consent_datetime DESC");

        let items = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(&self, record: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE consent_records SET ");
        qb.push("scope_description = ")
            .push_bind(&record.scope_description);
        qb.push(", data_types_covered = ")
            .push_bind(&record.data_types_covered);
        qb.push(", expiration_datetime = ")
            .push_bind(record.expiration_datetime);
        qb.push(", consent_given = ")
            .push_bind(record.consent_given);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn revoke(
        &self,
        id: &str,
        revoked_by: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<ConsentRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE consent_records SET ");
        qb.push("consent_given = false, revoked = true, revoked_datetime = NOW()");
        qb.push(", revoked_by = ").push_bind(revoked_by);
        qb.push(", revocation_reason = ").push_bind(reason);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_expiring_soon(&self, days: i32) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM consent_records 
             WHERE consent_given = true 
             AND (revoked IS NULL OR revoked = false) 
             AND expiration_datetime IS NOT NULL 
             AND expiration_datetime <= NOW() + INTERVAL '",
        );
        qb.push(days.to_string());
        qb.push(" days' ORDER BY expiration_datetime ASC");

        let items = qb
            .build_query_as::<ConsentRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn check_consent(
        &self,
        patient_id: &str,
        consent_type: &str,
        purpose: &str,
    ) -> RepositoryResult<bool> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT COUNT(*) > 0 AS has_consent FROM consent_records WHERE patient_id = ",
        );
        qb.push_bind(patient_id);
        qb.push(" AND consent_type = ");
        qb.push_bind(consent_type);
        qb.push(" AND purpose = ");
        qb.push_bind(purpose);
        qb.push(" AND consent_given = true AND (revoked IS NULL OR revoked = false)");
        qb.push(" AND (expiration_datetime IS NULL OR expiration_datetime > NOW())");

        #[derive(sqlx::FromRow)]
        struct ConsentCheck {
            has_consent: bool,
        }

        let result = qb
            .build_query_as::<ConsentCheck>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result.has_consent)
    }
}
