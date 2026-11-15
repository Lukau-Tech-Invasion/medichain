//! PostgreSQL repositories for radiology orders and reports, pathology reports.
//!
//! This module uses sqlx::QueryBuilder pattern for dynamic SQL construction instead of
//! manual $1, $2, $3... positional placeholders. This provides type-safe query building
//! and better maintainability.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

/// PostgreSQL-backed radiology order repository
#[derive(Debug, Clone)]
pub struct PgRadiologyOrderRepository {
    pool: PgPool,
}

impl PgRadiologyOrderRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl RadiologyOrderRepository for PgRadiologyOrderRepository {
    /// The trait supplies a DEFAULT `list_all` that returns
    /// `NotFound("list_all not implemented")`. Memory overrides it; this
    /// PostgreSQL impl did not, so the registry endpoint 500'd at RUNTIME
    /// instead of failing to compile — and because every end-to-end test ran
    /// against memory, nobody saw it (Horizon HZ-026).
    async fn list_all(&self) -> RepositoryResult<Vec<RadiologyOrderEntity>> {
        // Bounded: these registries are deployment-wide reads and must not be
        // able to pull an unbounded result set into memory.
        let rows = sqlx::query_as::<_, RadiologyOrderEntity>(
            "SELECT * FROM radiology_orders ORDER BY created_at DESC LIMIT 500",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn create(&self, order: RadiologyOrderEntity) -> RepositoryResult<RadiologyOrderEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO radiology_orders (
                id, patient_id, ordering_provider_id, modality, study_type,
                body_part, laterality, priority, status, clinical_indication,
                diagnosis_codes, contrast_required, contrast_type, sedation_required,
                patient_prep_instructions, special_instructions, scheduled_datetime,
                completed_datetime, performing_technologist_id, accession_number,
                record_json
            ) ",
        );

        qb.push_values([&order], |mut b, o| {
            b.push_bind(&o.id)
                .push_bind(&o.patient_id)
                .push_bind(&o.ordering_provider_id)
                .push_bind(&o.modality)
                .push_bind(&o.study_type)
                .push_bind(&o.body_part)
                .push_bind(&o.laterality)
                .push_bind(&o.priority)
                .push_bind(&o.status)
                .push_bind(&o.clinical_indication)
                .push_bind(&o.diagnosis_codes)
                .push_bind(o.contrast_required)
                .push_bind(&o.contrast_type)
                .push_bind(o.sedation_required)
                .push_bind(&o.patient_prep_instructions)
                .push_bind(&o.special_instructions)
                .push_bind(o.scheduled_datetime)
                .push_bind(o.completed_datetime)
                .push_bind(&o.performing_technologist_id)
                .push_bind(&o.accession_number)
                .push_bind(&o.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RadiologyOrderEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<RadiologyOrderEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM radiology_orders WHERE id = ");
        qb.push_bind(id);

        let order = qb
            .build_query_as::<RadiologyOrderEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(order)
    }

    async fn get_by_accession(
        &self,
        accession_number: &str,
    ) -> RepositoryResult<Option<RadiologyOrderEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM radiology_orders WHERE accession_number = ");
        qb.push_bind(accession_number);

        let order = qb
            .build_query_as::<RadiologyOrderEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(order)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RadiologyOrderEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM radiology_orders WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM radiology_orders WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY created_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<RadiologyOrderEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, order: RadiologyOrderEntity) -> RepositoryResult<RadiologyOrderEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE radiology_orders SET ");
        qb.push("status = ").push_bind(&order.status);
        qb.push(", scheduled_datetime = ")
            .push_bind(order.scheduled_datetime);
        qb.push(", completed_datetime = ")
            .push_bind(order.completed_datetime);
        qb.push(", performing_technologist_id = ")
            .push_bind(&order.performing_technologist_id);
        qb.push(", accession_number = ")
            .push_bind(&order.accession_number);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&order.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RadiologyOrderEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_pending_by_modality(
        &self,
        modality: &str,
    ) -> RepositoryResult<Vec<RadiologyOrderEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM radiology_orders WHERE modality = ");
        qb.push_bind(modality);
        qb.push(" AND status IN ('ordered', 'scheduled', 'in_progress') ORDER BY CASE priority WHEN 'stat' THEN 1 WHEN 'asap' THEN 2 WHEN 'urgent' THEN 3 ELSE 4 END, created_at ASC");

        let items = qb
            .build_query_as::<RadiologyOrderEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

/// PostgreSQL-backed radiology report repository
#[derive(Debug, Clone)]
pub struct PgRadiologyReportRepository {
    pool: PgPool,
}

impl PgRadiologyReportRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl RadiologyReportRepository for PgRadiologyReportRepository {
    /// Bounded deployment-wide read. Backs the radiology reports registry,
    /// which had no endpoint at all — the reading worklist showed orders but
    /// never the reports written against them.
    async fn list_all(&self) -> RepositoryResult<Vec<RadiologyReportEntity>> {
        let rows = sqlx::query_as::<_, RadiologyReportEntity>(
            "SELECT * FROM radiology_reports ORDER BY created_at DESC LIMIT 500",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn create(
        &self,
        report: RadiologyReportEntity,
    ) -> RepositoryResult<RadiologyReportEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO radiology_reports (
                id, order_id, patient_id, radiologist_id, study_datetime,
                report_datetime, comparison_studies, technique, findings,
                impression, recommendations, critical_finding,
                critical_finding_communicated, communicated_to, communicated_at,
                communication_method, addendum, addendum_datetime, addendum_by,
                status, image_count, pacs_study_uid, record_json
            ) ",
        );

        qb.push_values([&report], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.order_id)
                .push_bind(&r.patient_id)
                .push_bind(&r.radiologist_id)
                .push_bind(r.study_datetime)
                .push_bind(r.report_datetime)
                .push_bind(&r.comparison_studies)
                .push_bind(&r.technique)
                .push_bind(&r.findings)
                .push_bind(&r.impression)
                .push_bind(&r.recommendations)
                .push_bind(r.critical_finding)
                .push_bind(r.critical_finding_communicated)
                .push_bind(&r.communicated_to)
                .push_bind(r.communicated_at)
                .push_bind(&r.communication_method)
                .push_bind(&r.addendum)
                .push_bind(r.addendum_datetime)
                .push_bind(&r.addendum_by)
                .push_bind(&r.status)
                .push_bind(r.image_count)
                .push_bind(&r.pacs_study_uid)
                .push_bind(&r.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RadiologyReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<RadiologyReportEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM radiology_reports WHERE id = ");
        qb.push_bind(id);

        let report = qb
            .build_query_as::<RadiologyReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(report)
    }

    async fn get_by_order(
        &self,
        order_id: &str,
    ) -> RepositoryResult<Option<RadiologyReportEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM radiology_reports WHERE order_id = ");
        qb.push_bind(order_id);

        let report = qb
            .build_query_as::<RadiologyReportEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(report)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RadiologyReportEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM radiology_reports WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM radiology_reports WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY report_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<RadiologyReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        report: RadiologyReportEntity,
    ) -> RepositoryResult<RadiologyReportEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE radiology_reports SET ");
        qb.push("findings = ").push_bind(&report.findings);
        qb.push(", impression = ").push_bind(&report.impression);
        qb.push(", recommendations = ")
            .push_bind(&report.recommendations);
        qb.push(", status = ").push_bind(&report.status);
        qb.push(", critical_finding_communicated = ")
            .push_bind(report.critical_finding_communicated);
        qb.push(", communicated_to = ")
            .push_bind(&report.communicated_to);
        qb.push(", communicated_at = ")
            .push_bind(report.communicated_at);
        qb.push(", communication_method = ")
            .push_bind(&report.communication_method);
        qb.push(", addendum = ").push_bind(&report.addendum);
        qb.push(", addendum_datetime = ")
            .push_bind(report.addendum_datetime);
        qb.push(", addendum_by = ").push_bind(&report.addendum_by);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&report.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<RadiologyReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_critical_findings(&self) -> RepositoryResult<Vec<RadiologyReportEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM radiology_reports WHERE critical_finding = true AND (critical_finding_communicated IS NULL OR critical_finding_communicated = false) ORDER BY report_datetime ASC"
        );

        let items = qb
            .build_query_as::<RadiologyReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

/// PostgreSQL-backed pathology report repository
#[derive(Debug, Clone)]
pub struct PgPathologyReportRepository {
    pool: PgPool,
}

impl PgPathologyReportRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PathologyReportRepository for PgPathologyReportRepository {
    /// The trait supplies a DEFAULT `list_all` that returns
    /// `NotFound("list_all not implemented")`. Memory overrides it; this
    /// PostgreSQL impl did not, so the registry endpoint 500'd at RUNTIME
    /// instead of failing to compile — and because every end-to-end test ran
    /// against memory, nobody saw it (Horizon HZ-026).
    async fn list_all(&self) -> RepositoryResult<Vec<PathologyReportEntity>> {
        // Bounded: these registries are deployment-wide reads and must not be
        // able to pull an unbounded result set into memory.
        let rows = sqlx::query_as::<_, PathologyReportEntity>(
            "SELECT * FROM pathology_reports ORDER BY created_at DESC LIMIT 500",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn create(
        &self,
        report: PathologyReportEntity,
    ) -> RepositoryResult<PathologyReportEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO pathology_reports (
                id, patient_id, specimen_id, ordering_provider_id, pathologist_id,
                specimen_type, specimen_source, collection_date, received_date,
                report_date, clinical_history, gross_description, microscopic_description,
                special_stains, immunohistochemistry, molecular_studies, diagnosis,
                staging, tnm_classification, margin_status, lymph_node_status,
                comments, addendum, addendum_datetime, addendum_by, status, synoptic_report,
                record_json
            ) ",
        );

        qb.push_values([&report], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.specimen_id)
                .push_bind(&r.ordering_provider_id)
                .push_bind(&r.pathologist_id)
                .push_bind(&r.specimen_type)
                .push_bind(&r.specimen_source)
                .push_bind(r.collection_date)
                .push_bind(r.received_date)
                .push_bind(r.report_date)
                .push_bind(&r.clinical_history)
                .push_bind(&r.gross_description)
                .push_bind(&r.microscopic_description)
                .push_bind(&r.special_stains)
                .push_bind(&r.immunohistochemistry)
                .push_bind(&r.molecular_studies)
                .push_bind(&r.diagnosis)
                .push_bind(&r.staging)
                .push_bind(&r.tnm_classification)
                .push_bind(&r.margin_status)
                .push_bind(&r.lymph_node_status)
                .push_bind(&r.comments)
                .push_bind(&r.addendum)
                .push_bind(r.addendum_datetime)
                .push_bind(&r.addendum_by)
                .push_bind(&r.status)
                .push_bind(&r.synoptic_report)
                .push_bind(&r.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PathologyReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PathologyReportEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM pathology_reports WHERE id = ");
        qb.push_bind(id);

        let report = qb
            .build_query_as::<PathologyReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(report)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PathologyReportEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM pathology_reports WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM pathology_reports WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY report_date DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<PathologyReportEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_specimen(
        &self,
        specimen_id: &str,
    ) -> RepositoryResult<Option<PathologyReportEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM pathology_reports WHERE specimen_id = ");
        qb.push_bind(specimen_id);

        let report = qb
            .build_query_as::<PathologyReportEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(report)
    }

    async fn update(
        &self,
        report: PathologyReportEntity,
    ) -> RepositoryResult<PathologyReportEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE pathology_reports SET ");
        qb.push("pathologist_id = ")
            .push_bind(&report.pathologist_id);
        qb.push(", report_date = ").push_bind(report.report_date);
        qb.push(", gross_description = ")
            .push_bind(&report.gross_description);
        qb.push(", microscopic_description = ")
            .push_bind(&report.microscopic_description);
        qb.push(", special_stains = ")
            .push_bind(&report.special_stains);
        qb.push(", immunohistochemistry = ")
            .push_bind(&report.immunohistochemistry);
        qb.push(", molecular_studies = ")
            .push_bind(&report.molecular_studies);
        qb.push(", diagnosis = ").push_bind(&report.diagnosis);
        qb.push(", staging = ").push_bind(&report.staging);
        qb.push(", tnm_classification = ")
            .push_bind(&report.tnm_classification);
        qb.push(", margin_status = ")
            .push_bind(&report.margin_status);
        qb.push(", lymph_node_status = ")
            .push_bind(&report.lymph_node_status);
        qb.push(", comments = ").push_bind(&report.comments);
        qb.push(", addendum = ").push_bind(&report.addendum);
        qb.push(", addendum_datetime = ")
            .push_bind(report.addendum_datetime);
        qb.push(", addendum_by = ").push_bind(&report.addendum_by);
        qb.push(", status = ").push_bind(&report.status);
        qb.push(", synoptic_report = ")
            .push_bind(&report.synoptic_report);
        qb.push(", record_json = ").push_bind(&report.data);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&report.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PathologyReportEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}
