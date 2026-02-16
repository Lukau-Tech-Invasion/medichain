//! PostgreSQL implementations for Phase 3 Surgical & Procedures repositories.
//!
//! This module uses sqlx::QueryBuilder to eliminate manual positional placeholders ($1, $2, etc.)
//! and provides a cleaner, more maintainable approach to SQL query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// PRE-OP ASSESSMENT REPOSITORY
// =============================================================================

/// PostgreSQL-backed pre-op assessment repository
#[derive(Debug, Clone)]
pub struct PgPreOpAssessmentRepository {
    pool: PgPool,
}

impl PgPreOpAssessmentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PreOpAssessmentRepository for PgPreOpAssessmentRepository {
    async fn create(
        &self,
        assessment: PreOpAssessmentEntity,
    ) -> RepositoryResult<PreOpAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO pre_op_assessments (
                id, patient_id, procedure_name, procedure_code, scheduled_date,
                surgeon_id, anesthesiologist_id, asa_classification, mallampati_score,
                airway_assessment, cardiac_assessment, pulmonary_assessment,
                renal_assessment, hepatic_assessment, medications_reviewed,
                allergies_confirmed, npo_status, labs_reviewed, ekg_reviewed,
                chest_xray_reviewed, consent_signed, blood_type_confirmed,
                risk_score, assessment_notes, assessed_by, assessed_at,
                cleared_for_surgery, clearance_conditions
            ) ",
        );

        qb.push_values([&assessment], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(&a.procedure_name)
                .push_bind(&a.procedure_code)
                .push_bind(a.scheduled_date)
                .push_bind(&a.surgeon_id)
                .push_bind(&a.anesthesiologist_id)
                .push_bind(&a.asa_classification)
                .push_bind(a.mallampati_score)
                .push_bind(&a.airway_assessment)
                .push_bind(&a.cardiac_assessment)
                .push_bind(&a.pulmonary_assessment)
                .push_bind(&a.renal_assessment)
                .push_bind(&a.hepatic_assessment)
                .push_bind(&a.medications_reviewed)
                .push_bind(a.allergies_confirmed)
                .push_bind(&a.npo_status)
                .push_bind(&a.labs_reviewed)
                .push_bind(a.ekg_reviewed)
                .push_bind(a.chest_xray_reviewed)
                .push_bind(a.consent_signed)
                .push_bind(a.blood_type_confirmed)
                .push_bind(a.risk_score)
                .push_bind(&a.assessment_notes)
                .push_bind(&a.assessed_by)
                .push_bind(a.assessed_at)
                .push_bind(a.cleared_for_surgery)
                .push_bind(&a.clearance_conditions);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PreOpAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PreOpAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM pre_op_assessments WHERE id = ");
        qb.push_bind(id);

        let assessment = qb
            .build_query_as::<PreOpAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(assessment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PreOpAssessmentEntity>> {
        // Count query
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM pre_op_assessments WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        // Data query
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM pre_op_assessments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<PreOpAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_surgeon(
        &self,
        surgeon_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PreOpAssessmentEntity>> {
        // Count query
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM pre_op_assessments WHERE surgeon_id = ");
        count_qb.push_bind(surgeon_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        // Data query
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM pre_op_assessments WHERE surgeon_id = ");
        qb.push_bind(surgeon_id);
        qb.push(" ORDER BY assessed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<PreOpAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        assessment: PreOpAssessmentEntity,
    ) -> RepositoryResult<PreOpAssessmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE pre_op_assessments SET ");

        qb.push("asa_classification = ")
            .push_bind(&assessment.asa_classification);
        qb.push(", mallampati_score = ")
            .push_bind(assessment.mallampati_score);
        qb.push(", airway_assessment = ")
            .push_bind(&assessment.airway_assessment);
        qb.push(", cardiac_assessment = ")
            .push_bind(&assessment.cardiac_assessment);
        qb.push(", pulmonary_assessment = ")
            .push_bind(&assessment.pulmonary_assessment);
        qb.push(", renal_assessment = ")
            .push_bind(&assessment.renal_assessment);
        qb.push(", hepatic_assessment = ")
            .push_bind(&assessment.hepatic_assessment);
        qb.push(", medications_reviewed = ")
            .push_bind(&assessment.medications_reviewed);
        qb.push(", allergies_confirmed = ")
            .push_bind(assessment.allergies_confirmed);
        qb.push(", npo_status = ").push_bind(&assessment.npo_status);
        qb.push(", labs_reviewed = ")
            .push_bind(&assessment.labs_reviewed);
        qb.push(", ekg_reviewed = ")
            .push_bind(assessment.ekg_reviewed);
        qb.push(", chest_xray_reviewed = ")
            .push_bind(assessment.chest_xray_reviewed);
        qb.push(", consent_signed = ")
            .push_bind(assessment.consent_signed);
        qb.push(", blood_type_confirmed = ")
            .push_bind(assessment.blood_type_confirmed);
        qb.push(", risk_score = ").push_bind(assessment.risk_score);
        qb.push(", assessment_notes = ")
            .push_bind(&assessment.assessment_notes);
        qb.push(", cleared_for_surgery = ")
            .push_bind(assessment.cleared_for_surgery);
        qb.push(", clearance_conditions = ")
            .push_bind(&assessment.clearance_conditions);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&assessment.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PreOpAssessmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_scheduled(
        &self,
        date_range: DateRange,
    ) -> RepositoryResult<Vec<PreOpAssessmentEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM pre_op_assessments WHERE scheduled_date IS NOT NULL");

        qb.push(" AND (");
        qb.push_bind(date_range.from);
        qb.push("::timestamptz IS NULL OR scheduled_date >= ");
        qb.push_bind(date_range.from);
        qb.push(") AND (");
        qb.push_bind(date_range.to);
        qb.push("::timestamptz IS NULL OR scheduled_date <= ");
        qb.push_bind(date_range.to);
        qb.push(") ORDER BY scheduled_date ASC");

        let items = qb
            .build_query_as::<PreOpAssessmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// OPERATIVE NOTE REPOSITORY
// =============================================================================

/// PostgreSQL-backed operative note repository
#[derive(Debug, Clone)]
pub struct PgOperativeNoteRepository {
    pool: PgPool,
}

impl PgOperativeNoteRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl OperativeNoteRepository for PgOperativeNoteRepository {
    async fn create(&self, note: OperativeNoteEntity) -> RepositoryResult<OperativeNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO operative_notes (
                id, patient_id, pre_op_assessment_id, procedure_name, procedure_codes,
                preoperative_diagnosis, postoperative_diagnosis, surgeon_id,
                assistant_surgeons, anesthesiologist_id, anesthesia_type,
                scrub_nurse_id, circulating_nurse_id, start_time, end_time,
                incision_time, closure_time, estimated_blood_loss_ml, fluids_given_ml,
                blood_products_given, specimens_collected, implants_used, drains_placed,
                operative_findings, procedure_description, complications,
                disposition, post_op_orders
            ) ",
        );

        qb.push_values([&note], |mut b, n| {
            b.push_bind(&n.id)
                .push_bind(&n.patient_id)
                .push_bind(&n.pre_op_assessment_id)
                .push_bind(&n.procedure_name)
                .push_bind(&n.procedure_codes)
                .push_bind(&n.preoperative_diagnosis)
                .push_bind(&n.postoperative_diagnosis)
                .push_bind(&n.surgeon_id)
                .push_bind(&n.assistant_surgeons)
                .push_bind(&n.anesthesiologist_id)
                .push_bind(&n.anesthesia_type)
                .push_bind(&n.scrub_nurse_id)
                .push_bind(&n.circulating_nurse_id)
                .push_bind(n.start_time)
                .push_bind(n.end_time)
                .push_bind(n.incision_time)
                .push_bind(n.closure_time)
                .push_bind(n.estimated_blood_loss_ml)
                .push_bind(n.fluids_given_ml)
                .push_bind(&n.blood_products_given)
                .push_bind(&n.specimens_collected)
                .push_bind(&n.implants_used)
                .push_bind(&n.drains_placed)
                .push_bind(&n.operative_findings)
                .push_bind(&n.procedure_description)
                .push_bind(&n.complications)
                .push_bind(&n.disposition)
                .push_bind(&n.post_op_orders);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<OperativeNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<OperativeNoteEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM operative_notes WHERE id = ");
        qb.push_bind(id);

        let note = qb
            .build_query_as::<OperativeNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(note)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<OperativeNoteEntity>> {
        // Count query
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM operative_notes WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        // Data query
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM operative_notes WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY start_time DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<OperativeNoteEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_surgeon(
        &self,
        surgeon_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<OperativeNoteEntity>> {
        // Count query
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM operative_notes WHERE surgeon_id = ");
        count_qb.push_bind(surgeon_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        // Data query
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM operative_notes WHERE surgeon_id = ");
        qb.push_bind(surgeon_id);
        qb.push(" ORDER BY start_time DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<OperativeNoteEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, note: OperativeNoteEntity) -> RepositoryResult<OperativeNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE operative_notes SET ");

        qb.push("postoperative_diagnosis = ")
            .push_bind(&note.postoperative_diagnosis);
        qb.push(", procedure_description = ")
            .push_bind(&note.procedure_description);
        qb.push(", operative_findings = ")
            .push_bind(&note.operative_findings);
        qb.push(", complications = ").push_bind(&note.complications);
        qb.push(", disposition = ").push_bind(&note.disposition);
        qb.push(", post_op_orders = ")
            .push_bind(&note.post_op_orders);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&note.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<OperativeNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// POST-OP NOTE REPOSITORY
// =============================================================================

/// PostgreSQL-backed post-op note repository
#[derive(Debug, Clone)]
pub struct PgPostOpNoteRepository {
    pool: PgPool,
}

impl PgPostOpNoteRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PostOpNoteRepository for PgPostOpNoteRepository {
    async fn create(&self, note: PostOpNoteEntity) -> RepositoryResult<PostOpNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO post_op_notes (
                id, patient_id, operative_note_id, post_op_day, note_date,
                provider_id, pain_level, pain_management, vital_signs,
                wound_assessment, drain_output, diet_status, ambulation_status,
                voiding_status, bowel_function, lab_results_reviewed, complications,
                plan, discharge_criteria_met, estimated_discharge_date
            ) ",
        );

        qb.push_values([&note], |mut b, n| {
            b.push_bind(&n.id)
                .push_bind(&n.patient_id)
                .push_bind(&n.operative_note_id)
                .push_bind(n.post_op_day)
                .push_bind(n.note_date)
                .push_bind(&n.provider_id)
                .push_bind(n.pain_level)
                .push_bind(&n.pain_management)
                .push_bind(&n.vital_signs)
                .push_bind(&n.wound_assessment)
                .push_bind(&n.drain_output)
                .push_bind(&n.diet_status)
                .push_bind(&n.ambulation_status)
                .push_bind(&n.voiding_status)
                .push_bind(&n.bowel_function)
                .push_bind(&n.lab_results_reviewed)
                .push_bind(&n.complications)
                .push_bind(&n.plan)
                .push_bind(n.discharge_criteria_met)
                .push_bind(n.estimated_discharge_date);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PostOpNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PostOpNoteEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM post_op_notes WHERE id = ");
        qb.push_bind(id);

        let note = qb
            .build_query_as::<PostOpNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(note)
    }

    async fn get_by_operative_note(
        &self,
        operative_note_id: &str,
    ) -> RepositoryResult<Vec<PostOpNoteEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM post_op_notes WHERE operative_note_id = ");
        qb.push_bind(operative_note_id);
        qb.push(" ORDER BY post_op_day");

        let notes = qb
            .build_query_as::<PostOpNoteEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(notes)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PostOpNoteEntity>> {
        // Count query
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM post_op_notes WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        // Data query
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM post_op_notes WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY note_date DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<PostOpNoteEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, note: PostOpNoteEntity) -> RepositoryResult<PostOpNoteEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE post_op_notes SET ");

        qb.push("pain_level = ").push_bind(note.pain_level);
        qb.push(", pain_management = ")
            .push_bind(&note.pain_management);
        qb.push(", vital_signs = ").push_bind(&note.vital_signs);
        qb.push(", wound_assessment = ")
            .push_bind(&note.wound_assessment);
        qb.push(", drain_output = ").push_bind(&note.drain_output);
        qb.push(", diet_status = ").push_bind(&note.diet_status);
        qb.push(", ambulation_status = ")
            .push_bind(&note.ambulation_status);
        qb.push(", voiding_status = ")
            .push_bind(&note.voiding_status);
        qb.push(", bowel_function = ")
            .push_bind(&note.bowel_function);
        qb.push(", lab_results_reviewed = ")
            .push_bind(&note.lab_results_reviewed);
        qb.push(", complications = ").push_bind(&note.complications);
        qb.push(", plan = ").push_bind(&note.plan);
        qb.push(", discharge_criteria_met = ")
            .push_bind(note.discharge_criteria_met);
        qb.push(", estimated_discharge_date = ")
            .push_bind(note.estimated_discharge_date);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&note.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PostOpNoteEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// ANESTHESIA RECORD REPOSITORY
// =============================================================================

/// PostgreSQL-backed anesthesia record repository
#[derive(Debug, Clone)]
pub struct PgAnesthesiaRecordRepository {
    pool: PgPool,
}

impl PgAnesthesiaRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AnesthesiaRecordRepository for PgAnesthesiaRecordRepository {
    async fn create(
        &self,
        record: AnesthesiaRecordEntity,
    ) -> RepositoryResult<AnesthesiaRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO anesthesia_records (
                id, patient_id, operative_note_id, anesthesiologist_id, crna_id,
                anesthesia_type, asa_classification, airway_management,
                induction_agents, maintenance_agents, neuromuscular_blockers,
                reversal_agents, vasopressors, intraop_fluids, blood_products,
                monitoring, vital_signs_timeline, events, complications,
                emergence_time, extubation_time, pacu_arrival_time, pacu_discharge_time,
                aldrete_score_arrival, aldrete_score_discharge, post_anesthesia_orders
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.operative_note_id)
                .push_bind(&r.anesthesiologist_id)
                .push_bind(&r.crna_id)
                .push_bind(&r.anesthesia_type)
                .push_bind(&r.asa_classification)
                .push_bind(&r.airway_management)
                .push_bind(&r.induction_agents)
                .push_bind(&r.maintenance_agents)
                .push_bind(&r.neuromuscular_blockers)
                .push_bind(&r.reversal_agents)
                .push_bind(&r.vasopressors)
                .push_bind(&r.intraop_fluids)
                .push_bind(&r.blood_products)
                .push_bind(&r.monitoring)
                .push_bind(&r.vital_signs_timeline)
                .push_bind(&r.events)
                .push_bind(&r.complications)
                .push_bind(r.emergence_time)
                .push_bind(r.extubation_time)
                .push_bind(r.pacu_arrival_time)
                .push_bind(r.pacu_discharge_time)
                .push_bind(r.aldrete_score_arrival)
                .push_bind(r.aldrete_score_discharge)
                .push_bind(&r.post_anesthesia_orders);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AnesthesiaRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AnesthesiaRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM anesthesia_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<AnesthesiaRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AnesthesiaRecordEntity>> {
        // Count query
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM anesthesia_records WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        // Data query
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM anesthesia_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY created_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<AnesthesiaRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_provider(
        &self,
        anesthesiologist_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AnesthesiaRecordEntity>> {
        // Count query
        let mut count_qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT COUNT(*) FROM anesthesia_records WHERE anesthesiologist_id = ",
        );
        count_qb.push_bind(anesthesiologist_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        // Data query
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM anesthesia_records WHERE anesthesiologist_id = ");
        qb.push_bind(anesthesiologist_id);
        qb.push(" ORDER BY created_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<AnesthesiaRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        record: AnesthesiaRecordEntity,
    ) -> RepositoryResult<AnesthesiaRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE anesthesia_records SET ");

        qb.push("vital_signs_timeline = ")
            .push_bind(&record.vital_signs_timeline);
        qb.push(", events = ").push_bind(&record.events);
        qb.push(", complications = ")
            .push_bind(&record.complications);
        qb.push(", emergence_time = ")
            .push_bind(record.emergence_time);
        qb.push(", extubation_time = ")
            .push_bind(record.extubation_time);
        qb.push(", pacu_arrival_time = ")
            .push_bind(record.pacu_arrival_time);
        qb.push(", pacu_discharge_time = ")
            .push_bind(record.pacu_discharge_time);
        qb.push(", aldrete_score_arrival = ")
            .push_bind(record.aldrete_score_arrival);
        qb.push(", aldrete_score_discharge = ")
            .push_bind(record.aldrete_score_discharge);
        qb.push(", post_anesthesia_orders = ")
            .push_bind(&record.post_anesthesia_orders);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AnesthesiaRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// INTUBATION RECORD REPOSITORY
// =============================================================================

/// PostgreSQL-backed intubation record repository
#[derive(Debug, Clone)]
pub struct PgIntubationRecordRepository {
    pool: PgPool,
}

impl PgIntubationRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl IntubationRecordRepository for PgIntubationRecordRepository {
    async fn create(
        &self,
        record: IntubationRecordEntity,
    ) -> RepositoryResult<IntubationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO intubation_records (
                id, patient_id, indication, urgency, intubator_id, assistant_id,
                pre_oxygenation, pre_oxygenation_method, induction_agents,
                paralytic_agent, paralytic_dose, laryngoscope_type, blade_size,
                ett_size, ett_depth_cm, cuff_pressure_cmh2o, attempts, view_grade,
                adjuncts_used, difficult_airway, difficult_airway_features,
                complications, verification_methods, post_intubation_vitals, performed_at
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.indication)
                .push_bind(&r.urgency)
                .push_bind(&r.intubator_id)
                .push_bind(&r.assistant_id)
                .push_bind(r.pre_oxygenation)
                .push_bind(&r.pre_oxygenation_method)
                .push_bind(&r.induction_agents)
                .push_bind(&r.paralytic_agent)
                .push_bind(&r.paralytic_dose)
                .push_bind(&r.laryngoscope_type)
                .push_bind(&r.blade_size)
                .push_bind(r.ett_size)
                .push_bind(r.ett_depth_cm)
                .push_bind(r.cuff_pressure_cmh2o)
                .push_bind(r.attempts)
                .push_bind(&r.view_grade)
                .push_bind(&r.adjuncts_used)
                .push_bind(r.difficult_airway)
                .push_bind(&r.difficult_airway_features)
                .push_bind(&r.complications)
                .push_bind(&r.verification_methods)
                .push_bind(&r.post_intubation_vitals)
                .push_bind(r.performed_at);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<IntubationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<IntubationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM intubation_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<IntubationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IntubationRecordEntity>> {
        // Count query
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM intubation_records WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        // Data query
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM intubation_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY performed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<IntubationRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_difficult_airways(&self) -> RepositoryResult<Vec<IntubationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM intubation_records WHERE difficult_airway = ");
        qb.push_bind(true);
        qb.push(" ORDER BY performed_at DESC");

        let items = qb
            .build_query_as::<IntubationRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        record: IntubationRecordEntity,
    ) -> RepositoryResult<IntubationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE intubation_records SET ");

        qb.push("complications = ").push_bind(&record.complications);
        qb.push(", verification_methods = ")
            .push_bind(&record.verification_methods);
        qb.push(", post_intubation_vitals = ")
            .push_bind(&record.post_intubation_vitals);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<IntubationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// LACERATION REPAIR REPOSITORY
// =============================================================================

/// PostgreSQL-backed laceration repair repository
#[derive(Debug, Clone)]
pub struct PgLacerationRepairRepository {
    pool: PgPool,
}

impl PgLacerationRepairRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl LacerationRepairRepository for PgLacerationRepairRepository {
    async fn create(
        &self,
        repair: LacerationRepairEntity,
    ) -> RepositoryResult<LacerationRepairEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO laceration_repairs (
                id, patient_id, location, length_cm, depth_cm, width_cm, mechanism,
                contamination_level, wound_age_hours, tetanus_status, tetanus_given,
                anesthesia_type, anesthetic_agent, anesthetic_volume_ml,
                irrigation_solution, irrigation_volume_ml, debridement_performed,
                closure_technique, suture_material, suture_size, number_of_sutures,
                deep_sutures_placed, skin_adhesive_used, steri_strips_applied,
                dressing_applied, complications, aftercare_instructions,
                follow_up_date, suture_removal_date, performed_by, performed_at
            ) ",
        );

        qb.push_values([&repair], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.location)
                .push_bind(r.length_cm)
                .push_bind(r.depth_cm)
                .push_bind(r.width_cm)
                .push_bind(&r.mechanism)
                .push_bind(&r.contamination_level)
                .push_bind(r.wound_age_hours)
                .push_bind(&r.tetanus_status)
                .push_bind(r.tetanus_given)
                .push_bind(&r.anesthesia_type)
                .push_bind(&r.anesthetic_agent)
                .push_bind(r.anesthetic_volume_ml)
                .push_bind(&r.irrigation_solution)
                .push_bind(r.irrigation_volume_ml)
                .push_bind(r.debridement_performed)
                .push_bind(&r.closure_technique)
                .push_bind(&r.suture_material)
                .push_bind(&r.suture_size)
                .push_bind(r.number_of_sutures)
                .push_bind(r.deep_sutures_placed)
                .push_bind(r.skin_adhesive_used)
                .push_bind(r.steri_strips_applied)
                .push_bind(&r.dressing_applied)
                .push_bind(&r.complications)
                .push_bind(&r.aftercare_instructions)
                .push_bind(r.follow_up_date)
                .push_bind(r.suture_removal_date)
                .push_bind(&r.performed_by)
                .push_bind(r.performed_at);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<LacerationRepairEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LacerationRepairEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM laceration_repairs WHERE id = ");
        qb.push_bind(id);

        let repair = qb
            .build_query_as::<LacerationRepairEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(repair)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LacerationRepairEntity>> {
        // Count query
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM laceration_repairs WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        // Data query
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM laceration_repairs WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY performed_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<LacerationRepairEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_pending_followups(&self) -> RepositoryResult<Vec<LacerationRepairEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM laceration_repairs WHERE follow_up_date IS NOT NULL AND follow_up_date >= CURRENT_DATE ORDER BY follow_up_date ASC"
        );

        let items = qb
            .build_query_as::<LacerationRepairEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        repair: LacerationRepairEntity,
    ) -> RepositoryResult<LacerationRepairEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE laceration_repairs SET ");

        qb.push("complications = ").push_bind(&repair.complications);
        qb.push(", aftercare_instructions = ")
            .push_bind(&repair.aftercare_instructions);
        qb.push(", follow_up_date = ")
            .push_bind(repair.follow_up_date);
        qb.push(", suture_removal_date = ")
            .push_bind(repair.suture_removal_date);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&repair.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<LacerationRepairEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// SPLINT/CAST RECORD REPOSITORY
// =============================================================================

/// PostgreSQL-backed splint/cast record repository
#[derive(Debug, Clone)]
pub struct PgSplintCastRecordRepository {
    pool: PgPool,
}

impl PgSplintCastRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SplintCastRecordRepository for PgSplintCastRecordRepository {
    async fn create(
        &self,
        record: SplintCastRecordEntity,
    ) -> RepositoryResult<SplintCastRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO splint_cast_records (
                id, patient_id, injury_type, injury_location, laterality,
                fracture_type, immobilization_type, material, position, padding_type,
                neurovascular_check_pre, neurovascular_check_post, xray_pre, xray_post,
                reduction_performed, reduction_technique, anesthesia_type, complications,
                weight_bearing_status, elevation_instructions, ice_instructions,
                follow_up_date, follow_up_provider, removal_date, applied_by, applied_at
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.injury_type)
                .push_bind(&r.injury_location)
                .push_bind(&r.laterality)
                .push_bind(&r.fracture_type)
                .push_bind(&r.immobilization_type)
                .push_bind(&r.material)
                .push_bind(&r.position)
                .push_bind(&r.padding_type)
                .push_bind(&r.neurovascular_check_pre)
                .push_bind(&r.neurovascular_check_post)
                .push_bind(r.xray_pre)
                .push_bind(r.xray_post)
                .push_bind(r.reduction_performed)
                .push_bind(&r.reduction_technique)
                .push_bind(&r.anesthesia_type)
                .push_bind(&r.complications)
                .push_bind(&r.weight_bearing_status)
                .push_bind(r.elevation_instructions)
                .push_bind(r.ice_instructions)
                .push_bind(r.follow_up_date)
                .push_bind(&r.follow_up_provider)
                .push_bind(r.removal_date)
                .push_bind(&r.applied_by)
                .push_bind(r.applied_at);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SplintCastRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SplintCastRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM splint_cast_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<SplintCastRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<SplintCastRecordEntity>> {
        // Count query
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM splint_cast_records WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        // Data query
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM splint_cast_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY applied_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<SplintCastRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<SplintCastRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM splint_cast_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND removal_date IS NULL ORDER BY applied_at DESC");

        let items = qb
            .build_query_as::<SplintCastRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        record: SplintCastRecordEntity,
    ) -> RepositoryResult<SplintCastRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE splint_cast_records SET ");

        qb.push("complications = ").push_bind(&record.complications);
        qb.push(", follow_up_date = ")
            .push_bind(record.follow_up_date);
        qb.push(", follow_up_provider = ")
            .push_bind(&record.follow_up_provider);
        qb.push(", removal_date = ").push_bind(record.removal_date);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SplintCastRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}
