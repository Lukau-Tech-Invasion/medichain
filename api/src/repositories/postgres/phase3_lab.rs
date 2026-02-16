//! PostgreSQL implementations for Phase 3 Lab & Diagnostics repositories.
//!
//! This module uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// LAB SUBMISSION REPOSITORY
// =============================================================================

/// PostgreSQL-backed lab submission repository
#[derive(Debug, Clone)]
pub struct PgLabSubmissionRepository {
    pool: PgPool,
}

impl PgLabSubmissionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl LabSubmissionRepository for PgLabSubmissionRepository {
    async fn create(
        &self,
        submission: LabSubmissionEntity,
    ) -> RepositoryResult<LabSubmissionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO lab_submissions (
                id, patient_id, ordering_provider_id, order_date, priority, status,
                tests_ordered, clinical_notes, diagnosis_codes, fasting_required,
                collection_instructions, expected_completion
            ) ",
        );

        qb.push_values([&submission], |mut b, s| {
            b.push_bind(&s.id)
                .push_bind(&s.patient_id)
                .push_bind(&s.ordering_provider_id)
                .push_bind(s.order_date)
                .push_bind(&s.priority)
                .push_bind(&s.status)
                .push_bind(&s.tests_ordered)
                .push_bind(&s.clinical_notes)
                .push_bind(&s.diagnosis_codes)
                .push_bind(s.fasting_required)
                .push_bind(&s.collection_instructions)
                .push_bind(s.expected_completion);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<LabSubmissionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabSubmissionEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_submissions WHERE id = ");
        qb.push_bind(id);

        let submission = qb
            .build_query_as::<LabSubmissionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(submission)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabSubmissionEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM lab_submissions WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_submissions WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY order_date DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<LabSubmissionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_provider(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabSubmissionEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM lab_submissions WHERE ordering_provider_id = ");
        count_qb.push_bind(provider_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_submissions WHERE ordering_provider_id = ");
        qb.push_bind(provider_id);
        qb.push(" ORDER BY order_date DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<LabSubmissionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        submission: LabSubmissionEntity,
    ) -> RepositoryResult<LabSubmissionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE lab_submissions SET ");
        qb.push("priority = ").push_bind(&submission.priority);
        qb.push(", status = ").push_bind(&submission.status);
        qb.push(", tests_ordered = ")
            .push_bind(&submission.tests_ordered);
        qb.push(", clinical_notes = ")
            .push_bind(&submission.clinical_notes);
        qb.push(", diagnosis_codes = ")
            .push_bind(&submission.diagnosis_codes);
        qb.push(", fasting_required = ")
            .push_bind(submission.fasting_required);
        qb.push(", collection_instructions = ")
            .push_bind(&submission.collection_instructions);
        qb.push(", expected_completion = ")
            .push_bind(submission.expected_completion);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&submission.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<LabSubmissionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_pending_by_priority(&self) -> RepositoryResult<Vec<LabSubmissionEntity>> {
        let items = sqlx::query_as::<_, LabSubmissionEntity>(
            r#"
            SELECT * FROM lab_submissions 
            WHERE status IN ('pending', 'collected', 'in_progress')
            ORDER BY 
                CASE priority 
                    WHEN 'stat' THEN 1 
                    WHEN 'asap' THEN 2 
                    WHEN 'urgent' THEN 3 
                    ELSE 4 
                END,
                order_date ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }
}

// =============================================================================
// LAB PANEL REPOSITORY
// =============================================================================

/// PostgreSQL-backed lab panel repository
#[derive(Debug, Clone)]
pub struct PgLabPanelRepository {
    pool: PgPool,
}

impl PgLabPanelRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl LabPanelRepository for PgLabPanelRepository {
    async fn create(&self, panel: LabPanelEntity) -> RepositoryResult<LabPanelEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO lab_panels (
                id, submission_id, patient_id, panel_code, panel_name, status,
                results, reference_ranges, abnormal_flags, performing_lab,
                technician_id, verified_by, collected_at, resulted_at, verified_at
            ) ",
        );

        qb.push_values([&panel], |mut b, p| {
            b.push_bind(&p.id)
                .push_bind(&p.submission_id)
                .push_bind(&p.patient_id)
                .push_bind(&p.panel_code)
                .push_bind(&p.panel_name)
                .push_bind(&p.status)
                .push_bind(&p.results)
                .push_bind(&p.reference_ranges)
                .push_bind(&p.abnormal_flags)
                .push_bind(&p.performing_lab)
                .push_bind(&p.technician_id)
                .push_bind(&p.verified_by)
                .push_bind(p.collected_at)
                .push_bind(p.resulted_at)
                .push_bind(p.verified_at);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<LabPanelEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabPanelEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_panels WHERE id = ");
        qb.push_bind(id);

        let panel = qb
            .build_query_as::<LabPanelEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(panel)
    }

    async fn get_by_submission(
        &self,
        submission_id: &str,
    ) -> RepositoryResult<Vec<LabPanelEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_panels WHERE submission_id = ");
        qb.push_bind(submission_id);
        qb.push(" ORDER BY panel_name");

        let panels = qb
            .build_query_as::<LabPanelEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(panels)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabPanelEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM lab_panels WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_panels WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY created_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<LabPanelEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, panel: LabPanelEntity) -> RepositoryResult<LabPanelEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE lab_panels SET ");
        qb.push("status = ").push_bind(&panel.status);
        qb.push(", results = ").push_bind(&panel.results);
        qb.push(", reference_ranges = ")
            .push_bind(&panel.reference_ranges);
        qb.push(", abnormal_flags = ")
            .push_bind(&panel.abnormal_flags);
        qb.push(", performing_lab = ")
            .push_bind(&panel.performing_lab);
        qb.push(", technician_id = ")
            .push_bind(&panel.technician_id);
        qb.push(", verified_by = ").push_bind(&panel.verified_by);
        qb.push(", collected_at = ").push_bind(panel.collected_at);
        qb.push(", resulted_at = ").push_bind(panel.resulted_at);
        qb.push(", verified_at = ").push_bind(panel.verified_at);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&panel.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<LabPanelEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_abnormal_results(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<LabPanelEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_panels WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND abnormal_flags IS NOT NULL ORDER BY created_at DESC");

        let panels = qb
            .build_query_as::<LabPanelEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(panels)
    }
}

// =============================================================================
// LAB QC RECORD REPOSITORY
// =============================================================================

/// PostgreSQL-backed lab QC record repository
#[derive(Debug, Clone)]
pub struct PgLabQcRecordRepository {
    pool: PgPool,
}

impl PgLabQcRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl LabQcRecordRepository for PgLabQcRecordRepository {
    async fn create(&self, record: LabQcRecordEntity) -> RepositoryResult<LabQcRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO lab_qc_records (
                id, instrument_id, instrument_name, qc_level, test_code, test_name,
                expected_value, measured_value, unit, acceptable_range_low,
                acceptable_range_high, passed, deviation_percent, corrective_action,
                performed_by, reviewed_by, performed_at, reviewed_at, lot_number,
                expiration_date
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.instrument_id)
                .push_bind(&r.instrument_name)
                .push_bind(&r.qc_level)
                .push_bind(&r.test_code)
                .push_bind(&r.test_name)
                .push_bind(r.expected_value)
                .push_bind(r.measured_value)
                .push_bind(&r.unit)
                .push_bind(r.acceptable_range_low)
                .push_bind(r.acceptable_range_high)
                .push_bind(r.passed)
                .push_bind(r.deviation_percent)
                .push_bind(&r.corrective_action)
                .push_bind(&r.performed_by)
                .push_bind(&r.reviewed_by)
                .push_bind(r.performed_at)
                .push_bind(r.reviewed_at)
                .push_bind(&r.lot_number)
                .push_bind(r.expiration_date);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<LabQcRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabQcRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_qc_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<LabQcRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_instrument(
        &self,
        instrument_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LabQcRecordEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM lab_qc_records WHERE instrument_id = ");
        count_qb.push_bind(instrument_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_qc_records WHERE instrument_id = ");
        qb.push_bind(instrument_id);
        qb.push(" ORDER BY performed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<LabQcRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_failed_records(
        &self,
        date_range: Option<DateRange>,
    ) -> RepositoryResult<Vec<LabQcRecordEntity>> {
        let items = match date_range {
            Some(range) => {
                let mut qb: QueryBuilder<Postgres> =
                    QueryBuilder::new("SELECT * FROM lab_qc_records WHERE passed = false AND (");
                qb.push_bind(range.from);
                qb.push("::timestamptz IS NULL OR performed_at >= ");
                qb.push_bind(range.from);
                qb.push(") AND (");
                qb.push_bind(range.to);
                qb.push("::timestamptz IS NULL OR performed_at <= ");
                qb.push_bind(range.to);
                qb.push(") ORDER BY performed_at DESC");

                qb.build_query_as::<LabQcRecordEntity>()
                    .fetch_all(&self.pool)
                    .await?
            }
            None => {
                let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                    "SELECT * FROM lab_qc_records WHERE passed = false ORDER BY performed_at DESC",
                );

                qb.build_query_as::<LabQcRecordEntity>()
                    .fetch_all(&self.pool)
                    .await?
            }
        };

        Ok(items)
    }

    async fn update(&self, record: LabQcRecordEntity) -> RepositoryResult<LabQcRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE lab_qc_records SET ");
        qb.push("corrective_action = ")
            .push_bind(&record.corrective_action);
        qb.push(", reviewed_by = ").push_bind(&record.reviewed_by);
        qb.push(", reviewed_at = ").push_bind(record.reviewed_at);
        qb.push(" WHERE id = ").push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<LabQcRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// CRITICAL VALUE REPOSITORY
// =============================================================================

/// PostgreSQL-backed critical value repository
#[derive(Debug, Clone)]
pub struct PgCriticalValueRepository {
    pool: PgPool,
}

impl PgCriticalValueRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CriticalValueRepository for PgCriticalValueRepository {
    async fn create(&self, value: CriticalValueEntity) -> RepositoryResult<CriticalValueEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO critical_values (
                id, patient_id, lab_panel_id, test_code, test_name, value, unit,
                reference_low, reference_high, critical_low, critical_high,
                severity, notified_provider_id, notification_method, notified_at,
                acknowledged_at, acknowledged_by, action_taken, reported_by
            ) ",
        );

        qb.push_values([&value], |mut b, v| {
            b.push_bind(&v.id)
                .push_bind(&v.patient_id)
                .push_bind(&v.lab_panel_id)
                .push_bind(&v.test_code)
                .push_bind(&v.test_name)
                .push_bind(v.value)
                .push_bind(&v.unit)
                .push_bind(v.reference_low)
                .push_bind(v.reference_high)
                .push_bind(v.critical_low)
                .push_bind(v.critical_high)
                .push_bind(&v.severity)
                .push_bind(&v.notified_provider_id)
                .push_bind(&v.notification_method)
                .push_bind(v.notified_at)
                .push_bind(v.acknowledged_at)
                .push_bind(&v.acknowledged_by)
                .push_bind(&v.action_taken)
                .push_bind(&v.reported_by);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<CriticalValueEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<CriticalValueEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM critical_values WHERE id = ");
        qb.push_bind(id);

        let value = qb
            .build_query_as::<CriticalValueEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(value)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CriticalValueEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM critical_values WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM critical_values WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY created_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<CriticalValueEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_unacknowledged(&self) -> RepositoryResult<Vec<CriticalValueEntity>> {
        let items = sqlx::query_as::<_, CriticalValueEntity>(
            r#"
            SELECT * FROM critical_values 
            WHERE acknowledged_at IS NULL
            ORDER BY 
                CASE severity 
                    WHEN 'panic' THEN 1 
                    WHEN 'critical' THEN 2 
                    ELSE 3 
                END,
                created_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }

    async fn acknowledge(
        &self,
        id: &str,
        acknowledged_by: &str,
        action_taken: &str,
    ) -> RepositoryResult<CriticalValueEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE critical_values SET acknowledged_at = NOW(), acknowledged_by = ",
        );
        qb.push_bind(acknowledged_by);
        qb.push(", action_taken = ").push_bind(action_taken);
        qb.push(" WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<CriticalValueEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// SPECIMEN COLLECTION REPOSITORY
// =============================================================================

/// PostgreSQL-backed specimen collection repository
#[derive(Debug, Clone)]
pub struct PgSpecimenCollectionRepository {
    pool: PgPool,
}

impl PgSpecimenCollectionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SpecimenCollectionRepository for PgSpecimenCollectionRepository {
    async fn create(
        &self,
        specimen: SpecimenCollectionEntity,
    ) -> RepositoryResult<SpecimenCollectionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO specimen_collections (
                id, patient_id, submission_id, specimen_type, collection_site,
                collection_method, collector_id, collected_at, received_at,
                received_by, container_type, volume_ml, temperature_c, condition,
                barcode, storage_location, chain_of_custody, notes
            ) ",
        );

        qb.push_values([&specimen], |mut b, s| {
            b.push_bind(&s.id)
                .push_bind(&s.patient_id)
                .push_bind(&s.submission_id)
                .push_bind(&s.specimen_type)
                .push_bind(&s.collection_site)
                .push_bind(&s.collection_method)
                .push_bind(&s.collector_id)
                .push_bind(s.collected_at)
                .push_bind(s.received_at)
                .push_bind(&s.received_by)
                .push_bind(&s.container_type)
                .push_bind(s.volume_ml)
                .push_bind(s.temperature_c)
                .push_bind(&s.condition)
                .push_bind(&s.barcode)
                .push_bind(&s.storage_location)
                .push_bind(&s.chain_of_custody)
                .push_bind(&s.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SpecimenCollectionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SpecimenCollectionEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM specimen_collections WHERE id = ");
        qb.push_bind(id);

        let specimen = qb
            .build_query_as::<SpecimenCollectionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(specimen)
    }

    async fn get_by_barcode(
        &self,
        barcode: &str,
    ) -> RepositoryResult<Option<SpecimenCollectionEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM specimen_collections WHERE barcode = ");
        qb.push_bind(barcode);

        let specimen = qb
            .build_query_as::<SpecimenCollectionEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(specimen)
    }

    async fn get_by_submission(
        &self,
        submission_id: &str,
    ) -> RepositoryResult<Vec<SpecimenCollectionEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM specimen_collections WHERE submission_id = ");
        qb.push_bind(submission_id);
        qb.push(" ORDER BY collected_at");

        let specimens = qb
            .build_query_as::<SpecimenCollectionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(specimens)
    }

    async fn update(
        &self,
        specimen: SpecimenCollectionEntity,
    ) -> RepositoryResult<SpecimenCollectionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE specimen_collections SET ");
        qb.push("received_at = ").push_bind(specimen.received_at);
        qb.push(", received_by = ").push_bind(&specimen.received_by);
        qb.push(", condition = ").push_bind(&specimen.condition);
        qb.push(", storage_location = ")
            .push_bind(&specimen.storage_location);
        qb.push(", chain_of_custody = ")
            .push_bind(&specimen.chain_of_custody);
        qb.push(", notes = ").push_bind(&specimen.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&specimen.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SpecimenCollectionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// SPECIMEN REJECTION REPOSITORY
// =============================================================================

/// PostgreSQL-backed specimen rejection repository
#[derive(Debug, Clone)]
pub struct PgSpecimenRejectionRepository {
    pool: PgPool,
}

impl PgSpecimenRejectionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SpecimenRejectionRepository for PgSpecimenRejectionRepository {
    async fn create(
        &self,
        rejection: SpecimenRejectionEntity,
    ) -> RepositoryResult<SpecimenRejectionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO specimen_rejections (
                id, specimen_id, patient_id, rejection_reason, rejection_category,
                detailed_notes, rejected_by, rejected_at, recollection_required,
                recollection_scheduled, notified_ordering_provider, notification_sent_at
            ) ",
        );

        qb.push_values([&rejection], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.specimen_id)
                .push_bind(&r.patient_id)
                .push_bind(&r.rejection_reason)
                .push_bind(&r.rejection_category)
                .push_bind(&r.detailed_notes)
                .push_bind(&r.rejected_by)
                .push_bind(r.rejected_at)
                .push_bind(r.recollection_required)
                .push_bind(r.recollection_scheduled)
                .push_bind(r.notified_ordering_provider)
                .push_bind(r.notification_sent_at);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SpecimenRejectionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SpecimenRejectionEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM specimen_rejections WHERE id = ");
        qb.push_bind(id);

        let rejection = qb
            .build_query_as::<SpecimenRejectionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(rejection)
    }

    async fn get_by_specimen(
        &self,
        specimen_id: &str,
    ) -> RepositoryResult<Vec<SpecimenRejectionEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM specimen_rejections WHERE specimen_id = ");
        qb.push_bind(specimen_id);
        qb.push(" ORDER BY rejected_at DESC");

        let rejections = qb
            .build_query_as::<SpecimenRejectionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(rejections)
    }

    async fn get_pending_recollections(&self) -> RepositoryResult<Vec<SpecimenRejectionEntity>> {
        let items = sqlx::query_as::<_, SpecimenRejectionEntity>(
            r#"
            SELECT * FROM specimen_rejections 
            WHERE recollection_required = true AND recollection_scheduled IS NULL
            ORDER BY rejected_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }
}

// =============================================================================
// LAB TREND REPOSITORY
// =============================================================================

/// PostgreSQL-backed lab trend repository
#[derive(Debug, Clone)]
pub struct PgLabTrendRepository {
    pool: PgPool,
}

impl PgLabTrendRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl LabTrendRepository for PgLabTrendRepository {
    async fn create(&self, trend: LabTrendEntity) -> RepositoryResult<LabTrendEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO lab_trends (
                id, patient_id, test_code, test_name, values_json, unit,
                reference_low, reference_high, trend_direction, percent_change,
                first_value_date, last_value_date, data_points_count
            ) ",
        );

        qb.push_values([&trend], |mut b, t| {
            b.push_bind(&t.id)
                .push_bind(&t.patient_id)
                .push_bind(&t.test_code)
                .push_bind(&t.test_name)
                .push_bind(&t.values_json)
                .push_bind(&t.unit)
                .push_bind(t.reference_low)
                .push_bind(t.reference_high)
                .push_bind(&t.trend_direction)
                .push_bind(t.percent_change)
                .push_bind(t.first_value_date)
                .push_bind(t.last_value_date)
                .push_bind(t.data_points_count);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<LabTrendEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LabTrendEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_trends WHERE id = ");
        qb.push_bind(id);

        let trend = qb
            .build_query_as::<LabTrendEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(trend)
    }

    async fn get_by_patient_test(
        &self,
        patient_id: &str,
        test_code: &str,
    ) -> RepositoryResult<Option<LabTrendEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_trends WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND test_code = ").push_bind(test_code);

        let trend = qb
            .build_query_as::<LabTrendEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(trend)
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<LabTrendEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM lab_trends WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY test_name");

        let trends = qb
            .build_query_as::<LabTrendEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(trends)
    }

    async fn update(&self, trend: LabTrendEntity) -> RepositoryResult<LabTrendEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE lab_trends SET ");
        qb.push("values_json = ").push_bind(&trend.values_json);
        qb.push(", trend_direction = ")
            .push_bind(&trend.trend_direction);
        qb.push(", percent_change = ")
            .push_bind(trend.percent_change);
        qb.push(", last_value_date = ")
            .push_bind(trend.last_value_date);
        qb.push(", data_points_count = ")
            .push_bind(trend.data_points_count);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&trend.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<LabTrendEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}
