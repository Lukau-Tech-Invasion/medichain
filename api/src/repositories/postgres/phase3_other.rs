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
    async fn create(&self, order: RadiologyOrderEntity) -> RepositoryResult<RadiologyOrderEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO radiology_orders (
                id, patient_id, ordering_provider_id, modality, study_type,
                body_part, laterality, priority, status, clinical_indication,
                diagnosis_codes, contrast_required, contrast_type, sedation_required,
                patient_prep_instructions, special_instructions, scheduled_datetime,
                completed_datetime, performing_technologist_id, accession_number
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
                .push_bind(&o.accession_number);
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
                status, image_count, pacs_study_uid
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
                .push_bind(&r.pacs_study_uid);
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
                comments, addendum, addendum_datetime, addendum_by, status, synoptic_report
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
                .push_bind(&r.synoptic_report);
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
        qb.push("diagnosis = ").push_bind(&report.diagnosis);
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
                verified_at, expiration_date
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
                .push_bind(s.expiration_date);
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

/// PostgreSQL-backed crossmatch record repository
#[derive(Debug, Clone)]
pub struct PgCrossmatchRecordRepository {
    pool: PgPool,
}

impl PgCrossmatchRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CrossmatchRecordRepository for PgCrossmatchRecordRepository {
    async fn create(
        &self,
        record: CrossmatchRecordEntity,
    ) -> RepositoryResult<CrossmatchRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO crossmatch_records (
                id, patient_id, blood_type_screen_id, unit_number, product_type,
                product_abo, product_rh, donation_date, expiration_date,
                crossmatch_type, result, incompatibility_details, special_processing,
                irradiated, leukoreduced, washed, volume_reduced, reserved_until,
                issued_at, issued_to, returned_at, return_reason, performed_by,
                verified_by, performed_at
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.blood_type_screen_id)
                .push_bind(&r.unit_number)
                .push_bind(&r.product_type)
                .push_bind(&r.product_abo)
                .push_bind(&r.product_rh)
                .push_bind(r.donation_date)
                .push_bind(r.expiration_date)
                .push_bind(&r.crossmatch_type)
                .push_bind(&r.result)
                .push_bind(&r.incompatibility_details)
                .push_bind(&r.special_processing)
                .push_bind(r.irradiated)
                .push_bind(r.leukoreduced)
                .push_bind(r.washed)
                .push_bind(r.volume_reduced)
                .push_bind(r.reserved_until)
                .push_bind(r.issued_at)
                .push_bind(&r.issued_to)
                .push_bind(r.returned_at)
                .push_bind(&r.return_reason)
                .push_bind(&r.performed_by)
                .push_bind(&r.verified_by)
                .push_bind(r.performed_at);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<CrossmatchRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<CrossmatchRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM crossmatch_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<CrossmatchRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_unit(
        &self,
        unit_number: &str,
    ) -> RepositoryResult<Option<CrossmatchRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM crossmatch_records WHERE unit_number = ");
        qb.push_bind(unit_number);
        qb.push(" ORDER BY performed_at DESC LIMIT 1");

        let record = qb
            .build_query_as::<CrossmatchRecordEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CrossmatchRecordEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM crossmatch_records WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM crossmatch_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY performed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<CrossmatchRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        record: CrossmatchRecordEntity,
    ) -> RepositoryResult<CrossmatchRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE crossmatch_records SET ");
        qb.push("reserved_until = ")
            .push_bind(record.reserved_until);
        qb.push(", issued_at = ").push_bind(record.issued_at);
        qb.push(", issued_to = ").push_bind(&record.issued_to);
        qb.push(", returned_at = ").push_bind(record.returned_at);
        qb.push(", return_reason = ")
            .push_bind(&record.return_reason);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<CrossmatchRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_reserved_units(&self) -> RepositoryResult<Vec<CrossmatchRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM crossmatch_records WHERE reserved_until > NOW() AND issued_at IS NULL ORDER BY reserved_until ASC"
        );

        let items = qb
            .build_query_as::<CrossmatchRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// TRANSFUSION RECORD REPOSITORY
// =============================================================================

/// PostgreSQL-backed transfusion record repository
#[derive(Debug, Clone)]
pub struct PgTransfusionRecordRepository {
    pool: PgPool,
}

impl PgTransfusionRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TransfusionRecordRepository for PgTransfusionRecordRepository {
    async fn create(
        &self,
        record: TransfusionRecordEntity,
    ) -> RepositoryResult<TransfusionRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO transfusion_records (
                id, patient_id, crossmatch_id, unit_number, product_type, volume_ml,
                ordering_provider_id, indication, pre_transfusion_vitals,
                pre_transfusion_labs, start_time, end_time, flow_rate_ml_hr,
                administering_nurse_id, verifying_nurse_id, bedside_verification_time,
                patient_identification_method, vitals_15_min, vitals_1_hr, vitals_post,
                reaction_occurred, reaction_type, reaction_severity, reaction_symptoms,
                reaction_time, reaction_interventions, transfusion_completed,
                volume_transfused_ml, reason_not_completed, post_transfusion_labs, notes
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.crossmatch_id)
                .push_bind(&r.unit_number)
                .push_bind(&r.product_type)
                .push_bind(r.volume_ml)
                .push_bind(&r.ordering_provider_id)
                .push_bind(&r.indication)
                .push_bind(&r.pre_transfusion_vitals)
                .push_bind(&r.pre_transfusion_labs)
                .push_bind(r.start_time)
                .push_bind(r.end_time)
                .push_bind(r.flow_rate_ml_hr)
                .push_bind(&r.administering_nurse_id)
                .push_bind(&r.verifying_nurse_id)
                .push_bind(r.bedside_verification_time)
                .push_bind(&r.patient_identification_method)
                .push_bind(&r.vitals_15_min)
                .push_bind(&r.vitals_1_hr)
                .push_bind(&r.vitals_post)
                .push_bind(r.reaction_occurred)
                .push_bind(&r.reaction_type)
                .push_bind(&r.reaction_severity)
                .push_bind(&r.reaction_symptoms)
                .push_bind(r.reaction_time)
                .push_bind(&r.reaction_interventions)
                .push_bind(r.transfusion_completed)
                .push_bind(r.volume_transfused_ml)
                .push_bind(&r.reason_not_completed)
                .push_bind(&r.post_transfusion_labs)
                .push_bind(&r.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TransfusionRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<TransfusionRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM transfusion_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<TransfusionRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TransfusionRecordEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM transfusion_records WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM transfusion_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY start_time DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<TransfusionRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        record: TransfusionRecordEntity,
    ) -> RepositoryResult<TransfusionRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE transfusion_records SET ");
        qb.push("end_time = ").push_bind(record.end_time);
        qb.push(", vitals_15_min = ")
            .push_bind(&record.vitals_15_min);
        qb.push(", vitals_1_hr = ").push_bind(&record.vitals_1_hr);
        qb.push(", vitals_post = ").push_bind(&record.vitals_post);
        qb.push(", reaction_occurred = ")
            .push_bind(record.reaction_occurred);
        qb.push(", reaction_type = ")
            .push_bind(&record.reaction_type);
        qb.push(", reaction_severity = ")
            .push_bind(&record.reaction_severity);
        qb.push(", reaction_symptoms = ")
            .push_bind(&record.reaction_symptoms);
        qb.push(", reaction_time = ")
            .push_bind(record.reaction_time);
        qb.push(", reaction_interventions = ")
            .push_bind(&record.reaction_interventions);
        qb.push(", transfusion_completed = ")
            .push_bind(record.transfusion_completed);
        qb.push(", volume_transfused_ml = ")
            .push_bind(record.volume_transfused_ml);
        qb.push(", reason_not_completed = ")
            .push_bind(&record.reason_not_completed);
        qb.push(", post_transfusion_labs = ")
            .push_bind(&record.post_transfusion_labs);
        qb.push(", notes = ").push_bind(&record.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<TransfusionRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_reactions(
        &self,
        date_range: Option<DateRange>,
    ) -> RepositoryResult<Vec<TransfusionRecordEntity>> {
        let items = match date_range {
            Some(range) => {
                let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                    "SELECT * FROM transfusion_records WHERE reaction_occurred = true AND (",
                );
                qb.push_bind(range.from);
                qb.push("::timestamptz IS NULL OR start_time >= ");
                qb.push_bind(range.from);
                qb.push(") AND (");
                qb.push_bind(range.to);
                qb.push("::timestamptz IS NULL OR start_time <= ");
                qb.push_bind(range.to);
                qb.push(") ORDER BY start_time DESC");

                qb.build_query_as::<TransfusionRecordEntity>()
                    .fetch_all(&self.pool)
                    .await?
            }
            None => {
                let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                    "SELECT * FROM transfusion_records WHERE reaction_occurred = true ORDER BY start_time DESC"
                );

                qb.build_query_as::<TransfusionRecordEntity>()
                    .fetch_all(&self.pool)
                    .await?
            }
        };

        Ok(items)
    }
}

// =============================================================================
// E-PRESCRIPTION REPOSITORY
// =============================================================================

/// PostgreSQL-backed e-prescription repository
#[derive(Debug, Clone)]
pub struct PgEPrescriptionRepository {
    pool: PgPool,
}

impl PgEPrescriptionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl EPrescriptionRepository for PgEPrescriptionRepository {
    async fn create(
        &self,
        prescription: EPrescriptionEntity,
    ) -> RepositoryResult<EPrescriptionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO e_prescriptions (
                id, patient_id, prescriber_id, medication_name, medication_code,
                ndc_code, rxnorm_code, strength, strength_unit, dosage_form,
                route, frequency, duration_days, quantity, quantity_unit,
                refills_authorized, refills_remaining, daw_code, sig, diagnosis_codes,
                indication, is_controlled, schedule, prior_authorization_required,
                prior_authorization_number, pharmacy_id, pharmacy_name, pharmacy_npi,
                status, sent_at, filled_at, fill_number, notes
            ) ",
        );

        qb.push_values([&prescription], |mut b, p| {
            b.push_bind(&p.id)
                .push_bind(&p.patient_id)
                .push_bind(&p.prescriber_id)
                .push_bind(&p.medication_name)
                .push_bind(&p.medication_code)
                .push_bind(&p.ndc_code)
                .push_bind(&p.rxnorm_code)
                .push_bind(&p.strength)
                .push_bind(&p.strength_unit)
                .push_bind(&p.dosage_form)
                .push_bind(&p.route)
                .push_bind(&p.frequency)
                .push_bind(p.duration_days)
                .push_bind(p.quantity)
                .push_bind(&p.quantity_unit)
                .push_bind(p.refills_authorized)
                .push_bind(p.refills_remaining)
                .push_bind(&p.daw_code)
                .push_bind(&p.sig)
                .push_bind(&p.diagnosis_codes)
                .push_bind(&p.indication)
                .push_bind(p.is_controlled)
                .push_bind(&p.schedule)
                .push_bind(p.prior_authorization_required)
                .push_bind(&p.prior_authorization_number)
                .push_bind(&p.pharmacy_id)
                .push_bind(&p.pharmacy_name)
                .push_bind(&p.pharmacy_npi)
                .push_bind(&p.status)
                .push_bind(p.sent_at)
                .push_bind(p.filled_at)
                .push_bind(p.fill_number)
                .push_bind(&p.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<EPrescriptionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<EPrescriptionEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM e_prescriptions WHERE id = ");
        qb.push_bind(id);

        let prescription = qb
            .build_query_as::<EPrescriptionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(prescription)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EPrescriptionEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM e_prescriptions WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM e_prescriptions WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY created_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<EPrescriptionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_prescriber(
        &self,
        prescriber_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EPrescriptionEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM e_prescriptions WHERE prescriber_id = ");
        count_qb.push_bind(prescriber_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM e_prescriptions WHERE prescriber_id = ");
        qb.push_bind(prescriber_id);
        qb.push(" ORDER BY created_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<EPrescriptionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        prescription: EPrescriptionEntity,
    ) -> RepositoryResult<EPrescriptionEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE e_prescriptions SET ");
        qb.push("status = ").push_bind(&prescription.status);
        qb.push(", refills_remaining = ")
            .push_bind(prescription.refills_remaining);
        qb.push(", sent_at = ").push_bind(prescription.sent_at);
        qb.push(", filled_at = ").push_bind(prescription.filled_at);
        qb.push(", fill_number = ")
            .push_bind(prescription.fill_number);
        qb.push(", notes = ").push_bind(&prescription.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&prescription.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<EPrescriptionEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_active_controlled(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<EPrescriptionEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM e_prescriptions WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_controlled = true AND status IN ('pending', 'sent', 'filled') ORDER BY created_at DESC");

        let items = qb
            .build_query_as::<EPrescriptionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EPrescriptionEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM e_prescriptions");
        let count: (i64,) = count_qb.build_query_as().fetch_one(&self.pool).await?;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM e_prescriptions ORDER BY created_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let items = qb
            .build_query_as::<EPrescriptionEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, count.0 as u64, &pagination))
    }
}

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
                start_date, end_date, notes
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
                .push_bind(&r.notes);
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
