//! PostgreSQL implementations for Phase 3 Radiology, Blood Bank, and Pharmacy repositories.
//!
//! This module uses sqlx::QueryBuilder pattern for dynamic SQL construction instead of
//! manual $1, $2, $3... positional placeholders. This provides type-safe query building
//! and better maintainability.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// RADIOLOGY ORDER REPOSITORY
// =============================================================================

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

// =============================================================================
// RADIOLOGY REPORT REPOSITORY
// =============================================================================

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

// =============================================================================
// PATHOLOGY REPORT REPOSITORY
// =============================================================================

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

// =============================================================================
// BLOOD TYPE SCREEN REPOSITORY
// =============================================================================

/// PostgreSQL-backed blood type screen repository
#[derive(Debug, Clone)]
pub struct PgBloodTypeScreenRepository {
    pool: PgPool,
}

impl PgBloodTypeScreenRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl BloodTypeScreenRepository for PgBloodTypeScreenRepository {
    /// Bounded deployment-wide read, ordered on `idx_blood_type_performed`.
    /// Previously fell through to the trait default, so the blood-bank registry
    /// returned `list_all not implemented` on PostgreSQL only.
    async fn list_all(&self) -> RepositoryResult<Vec<BloodTypeScreenEntity>> {
        let rows = sqlx::query_as::<_, BloodTypeScreenEntity>(
            "SELECT * FROM blood_type_screens ORDER BY performed_at DESC LIMIT 500",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn create(
        &self,
        screen: BloodTypeScreenEntity,
    ) -> RepositoryResult<BloodTypeScreenEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO blood_type_screens (
                id, patient_id, specimen_id, abo_type, rh_type, abo_confirmation,
                rh_confirmation, weak_d_testing, weak_d_result, antibody_screen_result,
                antibodies_identified, antibody_titer, direct_antiglobulin_test,
                dat_specificity, special_requirements, historical_records_reviewed,
                discrepancy_notes, performed_by, verified_by, performed_at,
                verified_at, expiration_date,
                data
            ) ",
        );

        qb.push_values([&screen], |mut b, s| {
            b.push_bind(&s.id)
                .push_bind(&s.patient_id)
                .push_bind(&s.specimen_id)
                .push_bind(&s.abo_type)
                .push_bind(&s.rh_type)
                .push_bind(&s.abo_confirmation)
                .push_bind(&s.rh_confirmation)
                .push_bind(s.weak_d_testing)
                .push_bind(&s.weak_d_result)
                .push_bind(&s.antibody_screen_result)
                .push_bind(&s.antibodies_identified)
                .push_bind(&s.antibody_titer)
                .push_bind(&s.direct_antiglobulin_test)
                .push_bind(&s.dat_specificity)
                .push_bind(&s.special_requirements)
                .push_bind(s.historical_records_reviewed)
                .push_bind(&s.discrepancy_notes)
                .push_bind(&s.performed_by)
                .push_bind(&s.verified_by)
                .push_bind(s.performed_at)
                .push_bind(s.verified_at)
                .push_bind(s.expiration_date)
                .push_bind(&s.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<BloodTypeScreenEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<BloodTypeScreenEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM blood_type_screens WHERE id = ");
        qb.push_bind(id);

        let screen = qb
            .build_query_as::<BloodTypeScreenEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(screen)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BloodTypeScreenEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM blood_type_screens WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM blood_type_screens WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY performed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<BloodTypeScreenEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<BloodTypeScreenEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM blood_type_screens WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY performed_at DESC LIMIT 1");

        let screen = qb
            .build_query_as::<BloodTypeScreenEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(screen)
    }

    async fn update(
        &self,
        screen: BloodTypeScreenEntity,
    ) -> RepositoryResult<BloodTypeScreenEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE blood_type_screens SET ");
        qb.push("verified_by = ").push_bind(&screen.verified_by);
        qb.push(", verified_at = ").push_bind(screen.verified_at);
        qb.push(", discrepancy_notes = ")
            .push_bind(&screen.discrepancy_notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&screen.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<BloodTypeScreenEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// CROSSMATCH RECORD REPOSITORY
// =============================================================================

// =============================================================================
// TRANSFUSION RECORD REPOSITORY
// =============================================================================

// =============================================================================
// E-PRESCRIPTION REPOSITORY
// =============================================================================

// =============================================================================
// DRUG INTERACTION REPOSITORY
// =============================================================================

/// PostgreSQL-backed drug interaction repository
#[derive(Debug, Clone)]
pub struct PgDrugInteractionRepository {
    pool: PgPool,
}

impl PgDrugInteractionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DrugInteractionRepository for PgDrugInteractionRepository {
    async fn create(
        &self,
        interaction: DrugInteractionEntity,
    ) -> RepositoryResult<DrugInteractionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO drug_interactions (
                id, patient_id, prescription_id, drug1_name, drug1_code,
                drug2_name, drug2_code, interaction_type, severity,
                clinical_significance, mechanism, management, documentation_level,
                detected_at, acknowledged, acknowledged_by, acknowledged_at, override_reason
            ) ",
        );

        qb.push_values([&interaction], |mut b, i| {
            b.push_bind(&i.id)
                .push_bind(&i.patient_id)
                .push_bind(&i.prescription_id)
                .push_bind(&i.drug1_name)
                .push_bind(&i.drug1_code)
                .push_bind(&i.drug2_name)
                .push_bind(&i.drug2_code)
                .push_bind(&i.interaction_type)
                .push_bind(&i.severity)
                .push_bind(&i.clinical_significance)
                .push_bind(&i.mechanism)
                .push_bind(&i.management)
                .push_bind(&i.documentation_level)
                .push_bind(i.detected_at)
                .push_bind(i.acknowledged)
                .push_bind(&i.acknowledged_by)
                .push_bind(i.acknowledged_at)
                .push_bind(&i.override_reason);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<DrugInteractionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DrugInteractionEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM drug_interactions WHERE id = ");
        qb.push_bind(id);

        let interaction = qb
            .build_query_as::<DrugInteractionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(interaction)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<DrugInteractionEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM drug_interactions WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY detected_at DESC");

        let interactions = qb
            .build_query_as::<DrugInteractionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(interactions)
    }

    async fn get_unacknowledged(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<DrugInteractionEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM drug_interactions WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND acknowledged = false ORDER BY CASE severity WHEN 'contraindicated' THEN 1 WHEN 'major' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END, detected_at ASC");

        let items = qb
            .build_query_as::<DrugInteractionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn acknowledge(
        &self,
        id: &str,
        acknowledged_by: &str,
        override_reason: Option<&str>,
    ) -> RepositoryResult<DrugInteractionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE drug_interactions SET ");
        qb.push("acknowledged = true, acknowledged_by = ")
            .push_bind(acknowledged_by);
        qb.push(", acknowledged_at = NOW(), override_reason = ")
            .push_bind(override_reason);
        qb.push(" WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<DrugInteractionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// MEDICATION REMINDER REPOSITORY
// =============================================================================

/// PostgreSQL-backed medication reminder repository
#[derive(Debug, Clone)]
pub struct PgMedicationReminderRepository {
    pool: PgPool,
}

impl PgMedicationReminderRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MedicationReminderRepository for PgMedicationReminderRepository {
    async fn create(
        &self,
        reminder: MedicationReminderEntity,
    ) -> RepositoryResult<MedicationReminderEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO medication_reminders (
                id, patient_id, prescription_id, medication_name, dosage,
                scheduled_time, days_of_week, reminder_type, is_active,
                snooze_minutes, max_snoozes, escalation_contact,
                start_date, end_date, notes, data
            ) ",
        );

        qb.push_values([&reminder], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.prescription_id)
                .push_bind(&r.medication_name)
                .push_bind(&r.dosage)
                .push_bind(r.scheduled_time)
                .push_bind(&r.days_of_week)
                .push_bind(&r.reminder_type)
                .push_bind(r.is_active)
                .push_bind(r.snooze_minutes)
                .push_bind(r.max_snoozes)
                .push_bind(&r.escalation_contact)
                .push_bind(r.start_date)
                .push_bind(r.end_date)
                .push_bind(&r.notes)
                .push_bind(&r.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<MedicationReminderEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<MedicationReminderEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM medication_reminders WHERE id = ");
        qb.push_bind(id);

        let reminder = qb
            .build_query_as::<MedicationReminderEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(reminder)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<MedicationReminderEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM medication_reminders WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY scheduled_time");

        let reminders = qb
            .build_query_as::<MedicationReminderEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(reminders)
    }

    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<MedicationReminderEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM medication_reminders WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY scheduled_time");

        let reminders = qb
            .build_query_as::<MedicationReminderEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(reminders)
    }

    async fn update(
        &self,
        reminder: MedicationReminderEntity,
    ) -> RepositoryResult<MedicationReminderEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE medication_reminders SET ");
        qb.push("scheduled_time = ")
            .push_bind(reminder.scheduled_time);
        qb.push(", days_of_week = ")
            .push_bind(&reminder.days_of_week);
        qb.push(", is_active = ").push_bind(reminder.is_active);
        qb.push(", snooze_minutes = ")
            .push_bind(reminder.snooze_minutes);
        qb.push(", max_snoozes = ").push_bind(reminder.max_snoozes);
        qb.push(", end_date = ").push_bind(reminder.end_date);
        qb.push(", notes = ").push_bind(&reminder.notes);
        qb.push(", data = ").push_bind(&reminder.data);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&reminder.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<MedicationReminderEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn list_all_active(&self) -> RepositoryResult<Vec<MedicationReminderEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM medication_reminders WHERE is_active = true ORDER BY scheduled_time",
        );
        let reminders = qb
            .build_query_as::<MedicationReminderEntity>()
            .fetch_all(&self.pool)
            .await?;
        Ok(reminders)
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE medication_reminders SET is_active = false, updated_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);

        qb.build().execute(&self.pool).await?;

        Ok(())
    }
}

// =============================================================================
// ADHERENCE LOG REPOSITORY
// =============================================================================

/// PostgreSQL-backed adherence log repository
#[derive(Debug, Clone)]
pub struct PgAdherenceLogRepository {
    pool: PgPool,
}

impl PgAdherenceLogRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AdherenceLogRepository for PgAdherenceLogRepository {
    async fn create(&self, log: AdherenceLogEntity) -> RepositoryResult<AdherenceLogEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO adherence_logs (
                id, patient_id, reminder_id, prescription_id, medication_name,
                scheduled_time, action_taken, actual_time, reported_by, skip_reason,
                side_effects_reported, notes, device_id, location
            ) ",
        );

        qb.push_values([&log], |mut b, l| {
            b.push_bind(&l.id)
                .push_bind(&l.patient_id)
                .push_bind(&l.reminder_id)
                .push_bind(&l.prescription_id)
                .push_bind(&l.medication_name)
                .push_bind(l.scheduled_time)
                .push_bind(&l.action_taken)
                .push_bind(l.actual_time)
                .push_bind(&l.reported_by)
                .push_bind(&l.skip_reason)
                .push_bind(&l.side_effects_reported)
                .push_bind(&l.notes)
                .push_bind(&l.device_id)
                .push_bind(&l.location);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AdherenceLogEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AdherenceLogEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM adherence_logs WHERE id = ");
        qb.push_bind(id);

        let log = qb
            .build_query_as::<AdherenceLogEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(log)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        date_range: Option<DateRange>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AdherenceLogEntity>> {
        let (total, items) = match date_range {
            Some(range) => {
                let mut count_qb: QueryBuilder<Postgres> =
                    QueryBuilder::new("SELECT COUNT(*) FROM adherence_logs WHERE patient_id = ");
                count_qb.push_bind(patient_id);
                count_qb.push(" AND (");
                count_qb.push_bind(range.from);
                count_qb.push("::timestamptz IS NULL OR scheduled_time >= ");
                count_qb.push_bind(range.from);
                count_qb.push(") AND (");
                count_qb.push_bind(range.to);
                count_qb.push("::timestamptz IS NULL OR scheduled_time <= ");
                count_qb.push_bind(range.to);
                count_qb.push(")");

                let total = count_qb
                    .build_query_scalar::<i64>()
                    .fetch_one(&self.pool)
                    .await? as u64;

                let mut qb: QueryBuilder<Postgres> =
                    QueryBuilder::new("SELECT * FROM adherence_logs WHERE patient_id = ");
                qb.push_bind(patient_id);
                qb.push(" AND (");
                qb.push_bind(range.from);
                qb.push("::timestamptz IS NULL OR scheduled_time >= ");
                qb.push_bind(range.from);
                qb.push(") AND (");
                qb.push_bind(range.to);
                qb.push("::timestamptz IS NULL OR scheduled_time <= ");
                qb.push_bind(range.to);
                qb.push(") ORDER BY scheduled_time DESC LIMIT ");
                qb.push_bind(pagination.limit() as i32);
                qb.push(" OFFSET ");
                qb.push_bind(pagination.offset() as i32);

                let items = qb
                    .build_query_as::<AdherenceLogEntity>()
                    .fetch_all(&self.pool)
                    .await?;

                (total, items)
            }
            None => {
                let mut count_qb: QueryBuilder<Postgres> =
                    QueryBuilder::new("SELECT COUNT(*) FROM adherence_logs WHERE patient_id = ");
                count_qb.push_bind(patient_id);

                let total = count_qb
                    .build_query_scalar::<i64>()
                    .fetch_one(&self.pool)
                    .await? as u64;

                let mut qb: QueryBuilder<Postgres> =
                    QueryBuilder::new("SELECT * FROM adherence_logs WHERE patient_id = ");
                qb.push_bind(patient_id);
                qb.push(" ORDER BY scheduled_time DESC LIMIT ");
                qb.push_bind(pagination.limit() as i32);
                qb.push(" OFFSET ");
                qb.push_bind(pagination.offset() as i32);

                let items = qb
                    .build_query_as::<AdherenceLogEntity>()
                    .fetch_all(&self.pool)
                    .await?;

                (total, items)
            }
        };

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_reminder(
        &self,
        reminder_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AdherenceLogEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM adherence_logs WHERE reminder_id = ");
        count_qb.push_bind(reminder_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM adherence_logs WHERE reminder_id = ");
        qb.push_bind(reminder_id);
        qb.push(" ORDER BY scheduled_time DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<AdherenceLogEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_adherence_rate(
        &self,
        patient_id: &str,
        medication_name: &str,
        days: i32,
    ) -> RepositoryResult<f64> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT COUNT(*) FILTER (WHERE action_taken = 'taken') as taken_count, COUNT(*) as total_count FROM adherence_logs WHERE patient_id = "
        );
        qb.push_bind(patient_id);
        qb.push(" AND medication_name = ");
        qb.push_bind(medication_name);
        qb.push(" AND scheduled_time >= NOW() - (");
        qb.push_bind(days);
        qb.push("::integer || ' days')::interval");

        let result = qb
            .build_query_as::<(i64, i64)>()
            .fetch_one(&self.pool)
            .await?;

        let (taken_count, total_count) = result;
        if total_count == 0 {
            return Ok(0.0);
        }

        Ok((taken_count as f64 / total_count as f64) * 100.0)
    }
}
