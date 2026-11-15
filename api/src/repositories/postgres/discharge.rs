//! PostgreSQL repositories for discharge: summaries, instructions, discharge against medical advice.
//!
//! This module uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

/// PostgreSQL-backed discharge summary repository
#[derive(Debug, Clone)]
pub struct PgDischargeSummaryRepository {
    pool: PgPool,
}

impl PgDischargeSummaryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DischargeSummaryRepository for PgDischargeSummaryRepository {
    async fn create(
        &self,
        summary: DischargeSummaryEntity,
    ) -> RepositoryResult<DischargeSummaryEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO discharge_summaries (
                id, patient_id, encounter_id, attending_physician_id, admission_datetime,
                discharge_datetime, admission_diagnosis, discharge_diagnosis,
                principal_diagnosis, secondary_diagnoses, procedures_performed,
                hospital_course, condition_at_discharge, discharge_disposition,
                discharge_destination, discharge_medications, medication_changes,
                follow_up_appointments, follow_up_instructions, diet_instructions,
                activity_restrictions, wound_care_instructions, warning_signs,
                pending_results, pending_studies, primary_care_notified,
                specialist_follow_up, durable_medical_equipment, home_health_orders,
                physical_therapy_orders, dictated_by, dictated_at, transcribed_by,
                signed_by, signed_at, addendum, addendum_by, addendum_at, data
            ) ",
        );

        qb.push_values([&summary], |mut b, s| {
            b.push_bind(&s.id)
                .push_bind(&s.patient_id)
                .push_bind(&s.encounter_id)
                .push_bind(&s.attending_physician_id)
                .push_bind(s.admission_datetime)
                .push_bind(s.discharge_datetime)
                .push_bind(&s.admission_diagnosis)
                .push_bind(&s.discharge_diagnosis)
                .push_bind(&s.principal_diagnosis)
                .push_bind(&s.secondary_diagnoses)
                .push_bind(&s.procedures_performed)
                .push_bind(&s.hospital_course)
                .push_bind(&s.condition_at_discharge)
                .push_bind(&s.discharge_disposition)
                .push_bind(&s.discharge_destination)
                .push_bind(&s.discharge_medications)
                .push_bind(&s.medication_changes)
                .push_bind(&s.follow_up_appointments)
                .push_bind(&s.follow_up_instructions)
                .push_bind(&s.diet_instructions)
                .push_bind(&s.activity_restrictions)
                .push_bind(&s.wound_care_instructions)
                .push_bind(&s.warning_signs)
                .push_bind(&s.pending_results)
                .push_bind(&s.pending_studies)
                .push_bind(s.primary_care_notified)
                .push_bind(&s.specialist_follow_up)
                .push_bind(&s.durable_medical_equipment)
                .push_bind(&s.home_health_orders)
                .push_bind(&s.physical_therapy_orders)
                .push_bind(&s.dictated_by)
                .push_bind(s.dictated_at)
                .push_bind(&s.transcribed_by)
                .push_bind(&s.signed_by)
                .push_bind(s.signed_at)
                .push_bind(&s.addendum)
                .push_bind(&s.addendum_by)
                .push_bind(s.addendum_at)
                // The blob the read handlers serve. Omitted here until
                // `20260910000003`, so every summary read back as `null` on
                // PostgreSQL while the typed columns held the record.
                .push_bind(&s.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<DischargeSummaryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DischargeSummaryEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM discharge_summaries WHERE id = ");
        qb.push_bind(id);

        let summary = qb
            .build_query_as::<DischargeSummaryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(summary)
    }

    async fn get_by_encounter(
        &self,
        encounter_id: &str,
    ) -> RepositoryResult<Option<DischargeSummaryEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM discharge_summaries WHERE encounter_id = ");
        qb.push_bind(encounter_id);

        let summary = qb
            .build_query_as::<DischargeSummaryEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(summary)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<DischargeSummaryEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM discharge_summaries WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM discharge_summaries WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY discharge_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<DischargeSummaryEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<DischargeSummaryEntity>> {
        let total = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM discharge_summaries")
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM discharge_summaries ORDER BY discharge_datetime DESC LIMIT ",
        );
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<DischargeSummaryEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        summary: DischargeSummaryEntity,
    ) -> RepositoryResult<DischargeSummaryEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE discharge_summaries SET ");
        qb.push("hospital_course = ")
            .push_bind(&summary.hospital_course);
        qb.push(", condition_at_discharge = ")
            .push_bind(&summary.condition_at_discharge);
        qb.push(", discharge_disposition = ")
            .push_bind(&summary.discharge_disposition);
        qb.push(", discharge_medications = ")
            .push_bind(&summary.discharge_medications);
        qb.push(", follow_up_instructions = ")
            .push_bind(&summary.follow_up_instructions);
        qb.push(", signed_by = ").push_bind(&summary.signed_by);
        qb.push(", signed_at = ").push_bind(summary.signed_at);
        qb.push(", addendum = ").push_bind(&summary.addendum);
        qb.push(", addendum_by = ").push_bind(&summary.addendum_by);
        qb.push(", addendum_at = ").push_bind(summary.addendum_at);
        // `data` is the blob the read handlers actually serve, so an update
        // that omits it reports success while every reader keeps seeing the
        // values the record was first created with.
        qb.push(", data = ").push_bind(&summary.data);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&summary.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<DischargeSummaryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

/// PostgreSQL-backed discharge instructions repository
#[derive(Debug, Clone)]
pub struct PgDischargeInstructionsRepository {
    pool: PgPool,
}

impl PgDischargeInstructionsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DischargeInstructionsRepository for PgDischargeInstructionsRepository {
    async fn create(
        &self,
        instructions: DischargeInstructionsEntity,
    ) -> RepositoryResult<DischargeInstructionsEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO discharge_instructions (
                id, patient_id, discharge_summary_id, visit_date, diagnosis_summary,
                medications_list, new_medications, stopped_medications, changed_medications,
                diet_instructions, activity_level, activity_restrictions, wound_care,
                follow_up_appointments, return_precautions, emergency_instructions,
                contact_numbers, patient_education_materials, language, reading_level,
                special_instructions, equipment_needed, home_health_arranged,
                transportation_arranged, pharmacy_notified, printed_at, emailed_at,
                patient_portal_posted, acknowledged_by_patient, acknowledged_at,
                witness_signature, provided_by,
                data
            ) ",
        );

        qb.push_values([&instructions], |mut b, i| {
            b.push_bind(&i.id)
                .push_bind(&i.patient_id)
                .push_bind(&i.discharge_summary_id)
                .push_bind(i.visit_date)
                .push_bind(&i.diagnosis_summary)
                .push_bind(&i.medications_list)
                .push_bind(&i.new_medications)
                .push_bind(&i.stopped_medications)
                .push_bind(&i.changed_medications)
                .push_bind(&i.diet_instructions)
                .push_bind(&i.activity_level)
                .push_bind(&i.activity_restrictions)
                .push_bind(&i.wound_care)
                .push_bind(&i.follow_up_appointments)
                .push_bind(&i.return_precautions)
                .push_bind(&i.emergency_instructions)
                .push_bind(&i.contact_numbers)
                .push_bind(&i.patient_education_materials)
                .push_bind(&i.language)
                .push_bind(&i.reading_level)
                .push_bind(&i.special_instructions)
                .push_bind(&i.equipment_needed)
                .push_bind(i.home_health_arranged)
                .push_bind(i.transportation_arranged)
                .push_bind(i.pharmacy_notified)
                .push_bind(i.printed_at)
                .push_bind(i.emailed_at)
                .push_bind(i.patient_portal_posted)
                .push_bind(i.acknowledged_by_patient)
                .push_bind(i.acknowledged_at)
                .push_bind(&i.witness_signature)
                .push_bind(&i.provided_by)
                .push_bind(&i.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<DischargeInstructionsEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DischargeInstructionsEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM discharge_instructions WHERE id = ");
        qb.push_bind(id);

        let instructions = qb
            .build_query_as::<DischargeInstructionsEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(instructions)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<DischargeInstructionsEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM discharge_instructions WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM discharge_instructions WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY visit_date DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<DischargeInstructionsEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_summary(
        &self,
        summary_id: &str,
    ) -> RepositoryResult<Option<DischargeInstructionsEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM discharge_instructions WHERE discharge_summary_id = ");
        qb.push_bind(summary_id);

        let instructions = qb
            .build_query_as::<DischargeInstructionsEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(instructions)
    }

    async fn update(
        &self,
        instructions: DischargeInstructionsEntity,
    ) -> RepositoryResult<DischargeInstructionsEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE discharge_instructions SET ");
        qb.push("diagnosis_summary = ")
            .push_bind(&instructions.diagnosis_summary);
        qb.push(", medications_list = ")
            .push_bind(&instructions.medications_list);
        qb.push(", follow_up_appointments = ")
            .push_bind(&instructions.follow_up_appointments);
        qb.push(", return_precautions = ")
            .push_bind(&instructions.return_precautions);
        qb.push(", acknowledged_by_patient = ")
            .push_bind(instructions.acknowledged_by_patient);
        qb.push(", acknowledged_at = ")
            .push_bind(instructions.acknowledged_at);
        qb.push(", printed_at = ")
            .push_bind(instructions.printed_at);
        qb.push(", emailed_at = ")
            .push_bind(instructions.emailed_at);
        // `data` is the blob the read handlers actually serve, so an update
        // that omits it reports success while every reader keeps seeing the
        // values the record was first created with.
        qb.push(", data = ").push_bind(&instructions.data);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&instructions.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<DischargeInstructionsEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

/// PostgreSQL-backed AMA discharge repository
#[derive(Debug, Clone)]
pub struct PgAmaDischargeRepository {
    pool: PgPool,
}

impl PgAmaDischargeRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AmaDischargeRepository for PgAmaDischargeRepository {
    async fn create(&self, discharge: AmaDischargeEntity) -> RepositoryResult<AmaDischargeEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO ama_discharges (
                id, patient_id, encounter_id, discharge_datetime, attending_physician_id,
                reason_for_leaving, risks_explained, specific_risks_discussed,
                patient_verbalized_understanding, decision_making_capacity,
                capacity_assessment, alternatives_offered, patient_refused_alternatives,
                ama_form_signed, ama_form_refused_reason, witness_present, witness_name,
                witness_signature, patient_signature, patient_signature_at,
                witness_signature_at, signatures_collected_by,
                patient_given_prescriptions, prescriptions_given,
                follow_up_offered, follow_up_instructions, patient_contact_info_verified,
                emergency_contact_notified, belongings_returned, security_escort,
                police_notified, social_work_notified, documentation_complete,
                physician_narrative, nurse_notes,
                data
            ) ",
        );

        qb.push_values([&discharge], |mut b, d| {
            b.push_bind(&d.id)
                .push_bind(&d.patient_id)
                .push_bind(&d.encounter_id)
                .push_bind(d.discharge_datetime)
                .push_bind(&d.attending_physician_id)
                .push_bind(&d.reason_for_leaving)
                .push_bind(&d.risks_explained)
                .push_bind(&d.specific_risks_discussed)
                .push_bind(d.patient_verbalized_understanding)
                .push_bind(d.decision_making_capacity)
                .push_bind(&d.capacity_assessment)
                .push_bind(&d.alternatives_offered)
                .push_bind(d.patient_refused_alternatives)
                .push_bind(d.ama_form_signed)
                .push_bind(&d.ama_form_refused_reason)
                .push_bind(d.witness_present)
                .push_bind(&d.witness_name)
                .push_bind(&d.witness_signature)
                .push_bind(&d.patient_signature)
                .push_bind(d.patient_signature_at)
                .push_bind(d.witness_signature_at)
                .push_bind(&d.signatures_collected_by)
                .push_bind(d.patient_given_prescriptions)
                .push_bind(&d.prescriptions_given)
                .push_bind(d.follow_up_offered)
                .push_bind(&d.follow_up_instructions)
                .push_bind(d.patient_contact_info_verified)
                .push_bind(d.emergency_contact_notified)
                .push_bind(d.belongings_returned)
                .push_bind(d.security_escort)
                .push_bind(d.police_notified)
                .push_bind(d.social_work_notified)
                .push_bind(d.documentation_complete)
                .push_bind(&d.physician_narrative)
                .push_bind(&d.nurse_notes)
                .push_bind(&d.data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AmaDischargeEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AmaDischargeEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM ama_discharges WHERE id = ");
        qb.push_bind(id);

        let discharge = qb
            .build_query_as::<AmaDischargeEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(discharge)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AmaDischargeEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM ama_discharges WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM ama_discharges WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY discharge_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<AmaDischargeEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_encounter(
        &self,
        encounter_id: &str,
    ) -> RepositoryResult<Option<AmaDischargeEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM ama_discharges WHERE encounter_id = ");
        qb.push_bind(encounter_id);

        let discharge = qb
            .build_query_as::<AmaDischargeEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(discharge)
    }

    async fn update(&self, discharge: AmaDischargeEntity) -> RepositoryResult<AmaDischargeEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE ama_discharges SET ");
        qb.push("ama_form_signed = ")
            .push_bind(discharge.ama_form_signed);
        qb.push(", witness_signature = ")
            .push_bind(&discharge.witness_signature);
        // The signature columns move with the boolean beside them. An update
        // that set `ama_form_signed` without them would report a signed
        // discharge holding no signature, which is the state these columns
        // exist to make impossible.
        qb.push(", patient_signature = ")
            .push_bind(&discharge.patient_signature);
        qb.push(", patient_signature_at = ")
            .push_bind(discharge.patient_signature_at);
        qb.push(", witness_signature_at = ")
            .push_bind(discharge.witness_signature_at);
        qb.push(", signatures_collected_by = ")
            .push_bind(&discharge.signatures_collected_by);
        qb.push(", documentation_complete = ")
            .push_bind(discharge.documentation_complete);
        qb.push(", physician_narrative = ")
            .push_bind(&discharge.physician_narrative);
        qb.push(", nurse_notes = ")
            .push_bind(&discharge.nurse_notes);
        // `data` is the blob the read handlers actually serve, so an update
        // that omits it reports success while every reader keeps seeing the
        // values the record was first created with.
        qb.push(", data = ").push_bind(&discharge.data);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&discharge.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AmaDischargeEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AmaDischargeEntity>> {
        let total = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM ama_discharges")
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM ama_discharges ORDER BY discharge_datetime DESC LIMIT ",
        );
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<AmaDischargeEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }
}
