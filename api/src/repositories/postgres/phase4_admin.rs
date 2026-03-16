//! PostgreSQL implementations for Phase 5 Administrative & Scheduling repositories.
//!
//! This module uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use chrono::{NaiveDate, Utc};
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// APPOINTMENT REPOSITORY
// =============================================================================

/// PostgreSQL-backed appointment repository
#[derive(Debug, Clone)]
pub struct PgAppointmentRepository {
    pool: PgPool,
}

impl PgAppointmentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AppointmentRepository for PgAppointmentRepository {
    async fn create(&self, appointment: AppointmentEntity) -> RepositoryResult<AppointmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO appointments (
                id, patient_id, provider_id, appointment_type, scheduled_datetime,
                duration_minutes, status, location, room, reason_for_visit, visit_type,
                priority, recurring, recurrence_pattern, parent_appointment_id,
                insurance_verified, copay_amount, copay_collected, reminder_sent,
                reminder_sent_at, check_in_time, check_out_time, cancelled_at,
                cancellation_reason, cancelled_by, notes, created_by
            ) ",
        );

        qb.push_values([&appointment], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(&a.provider_id)
                .push_bind(&a.appointment_type)
                .push_bind(a.scheduled_datetime)
                .push_bind(a.duration_minutes)
                .push_bind(&a.status)
                .push_bind(&a.location)
                .push_bind(&a.room)
                .push_bind(&a.reason_for_visit)
                .push_bind(&a.visit_type)
                .push_bind(&a.priority)
                .push_bind(a.recurring)
                .push_bind(&a.recurrence_pattern)
                .push_bind(&a.parent_appointment_id)
                .push_bind(a.insurance_verified)
                .push_bind(a.copay_amount)
                .push_bind(a.copay_collected)
                .push_bind(a.reminder_sent)
                .push_bind(a.reminder_sent_at)
                .push_bind(a.check_in_time)
                .push_bind(a.check_out_time)
                .push_bind(a.cancelled_at)
                .push_bind(&a.cancellation_reason)
                .push_bind(&a.cancelled_by)
                .push_bind(&a.notes)
                .push_bind(&a.created_by);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AppointmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AppointmentEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM appointments WHERE id = ");
        qb.push_bind(id);

        let appointment = qb
            .build_query_as::<AppointmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(appointment)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM appointments WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM appointments WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY scheduled_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<AppointmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_provider(
        &self,
        provider_id: &str,
        date: NaiveDate,
    ) -> RepositoryResult<Vec<AppointmentEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM appointments WHERE provider_id = ");
        qb.push_bind(provider_id);
        qb.push(" AND DATE(scheduled_datetime) = ");
        qb.push_bind(date);
        qb.push(" ORDER BY scheduled_datetime ASC");

        let items = qb
            .build_query_as::<AppointmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(&self, appointment: AppointmentEntity) -> RepositoryResult<AppointmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE appointments SET ");
        qb.push("appointment_type = ")
            .push_bind(&appointment.appointment_type);
        qb.push(", scheduled_datetime = ")
            .push_bind(appointment.scheduled_datetime);
        qb.push(", duration_minutes = ")
            .push_bind(appointment.duration_minutes);
        qb.push(", status = ").push_bind(&appointment.status);
        qb.push(", location = ").push_bind(&appointment.location);
        qb.push(", room = ").push_bind(&appointment.room);
        qb.push(", reason_for_visit = ")
            .push_bind(&appointment.reason_for_visit);
        qb.push(", insurance_verified = ")
            .push_bind(appointment.insurance_verified);
        qb.push(", copay_collected = ")
            .push_bind(appointment.copay_collected);
        qb.push(", check_in_time = ")
            .push_bind(appointment.check_in_time);
        qb.push(", check_out_time = ")
            .push_bind(appointment.check_out_time);
        qb.push(", notes = ").push_bind(&appointment.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&appointment.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AppointmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn cancel(
        &self,
        id: &str,
        reason: &str,
        cancelled_by: &str,
    ) -> RepositoryResult<AppointmentEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE appointments SET ");
        qb.push("status = 'cancelled'");
        qb.push(", cancelled_at = ").push_bind(Utc::now());
        qb.push(", cancellation_reason = ").push_bind(reason);
        qb.push(", cancelled_by = ").push_bind(cancelled_by);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AppointmentEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_status(
        &self,
        status: &str,
        date: NaiveDate,
    ) -> RepositoryResult<Vec<AppointmentEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM appointments WHERE status = ");
        qb.push_bind(status);
        qb.push(" AND DATE(scheduled_datetime) = ");
        qb.push_bind(date);
        qb.push(" ORDER BY scheduled_datetime ASC");

        let items = qb
            .build_query_as::<AppointmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// PHYSICIAN ORDER REPOSITORY
// =============================================================================

/// PostgreSQL-backed physician order repository
#[derive(Debug, Clone)]
pub struct PgPhysicianOrderRepository {
    pool: PgPool,
}

impl PgPhysicianOrderRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PhysicianOrderRepository for PgPhysicianOrderRepository {
    async fn create(&self, order: PhysicianOrderEntity) -> RepositoryResult<PhysicianOrderEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO physician_orders (
                id, patient_id, ordering_provider_id, order_datetime, order_type,
                priority, status, order_details, indication, diagnosis_codes,
                start_datetime, end_datetime, frequency, duration, special_instructions,
                requires_cosign, cosigned_by, cosigned_at, verified_by, verified_at,
                executed_by, executed_at, discontinued_by, discontinued_at,
                discontinue_reason, linked_order_id, notes
            ) ",
        );

        qb.push_values([&order], |mut b, o| {
            b.push_bind(&o.id)
                .push_bind(&o.patient_id)
                .push_bind(&o.ordering_provider_id)
                .push_bind(o.order_datetime)
                .push_bind(&o.order_type)
                .push_bind(&o.priority)
                .push_bind(&o.status)
                .push_bind(&o.order_details)
                .push_bind(&o.indication)
                .push_bind(&o.diagnosis_codes)
                .push_bind(o.start_datetime)
                .push_bind(o.end_datetime)
                .push_bind(&o.frequency)
                .push_bind(&o.duration)
                .push_bind(&o.special_instructions)
                .push_bind(o.requires_cosign)
                .push_bind(&o.cosigned_by)
                .push_bind(o.cosigned_at)
                .push_bind(&o.verified_by)
                .push_bind(o.verified_at)
                .push_bind(&o.executed_by)
                .push_bind(o.executed_at)
                .push_bind(&o.discontinued_by)
                .push_bind(o.discontinued_at)
                .push_bind(&o.discontinue_reason)
                .push_bind(&o.linked_order_id)
                .push_bind(&o.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PhysicianOrderEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PhysicianOrderEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM physician_orders WHERE id = ");
        qb.push_bind(id);

        let order = qb
            .build_query_as::<PhysicianOrderEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(order)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PhysicianOrderEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM physician_orders WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM physician_orders WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY order_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<PhysicianOrderEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, order: PhysicianOrderEntity) -> RepositoryResult<PhysicianOrderEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE physician_orders SET ");
        qb.push("priority = ").push_bind(&order.priority);
        qb.push(", status = ").push_bind(&order.status);
        qb.push(", order_details = ")
            .push_bind(&order.order_details);
        qb.push(", special_instructions = ")
            .push_bind(&order.special_instructions);
        qb.push(", verified_by = ").push_bind(&order.verified_by);
        qb.push(", verified_at = ").push_bind(order.verified_at);
        qb.push(", executed_by = ").push_bind(&order.executed_by);
        qb.push(", executed_at = ").push_bind(order.executed_at);
        qb.push(", notes = ").push_bind(&order.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&order.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PhysicianOrderEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_pending_orders(&self) -> RepositoryResult<Vec<PhysicianOrderEntity>> {
        // Uses the v_pending_orders view
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM physician_orders 
             WHERE status IN ('pending', 'active')
             ORDER BY 
                CASE priority 
                    WHEN 'stat' THEN 1 
                    WHEN 'asap' THEN 2 
                    WHEN 'urgent' THEN 3 
                    ELSE 4 
                END,
                order_datetime ASC",
        );

        let items = qb
            .build_query_as::<PhysicianOrderEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_type(
        &self,
        order_type: &str,
        patient_id: &str,
    ) -> RepositoryResult<Vec<PhysicianOrderEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM physician_orders WHERE order_type = ");
        qb.push_bind(order_type);
        qb.push(" AND patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY order_datetime DESC");

        let items = qb
            .build_query_as::<PhysicianOrderEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn discontinue(
        &self,
        id: &str,
        reason: &str,
        discontinued_by: &str,
    ) -> RepositoryResult<PhysicianOrderEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE physician_orders SET ");
        qb.push("status = 'discontinued'");
        qb.push(", discontinued_at = ").push_bind(Utc::now());
        qb.push(", discontinue_reason = ").push_bind(reason);
        qb.push(", discontinued_by = ").push_bind(discontinued_by);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PhysicianOrderEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// DISCHARGE SUMMARY REPOSITORY
// =============================================================================

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
                signed_by, signed_at, addendum, addendum_by, addendum_at
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
                .push_bind(s.addendum_at);
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

// =============================================================================
// DISCHARGE INSTRUCTIONS REPOSITORY
// =============================================================================

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
                witness_signature, provided_by
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
                .push_bind(&i.provided_by);
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

// =============================================================================
// AMA DISCHARGE REPOSITORY
// =============================================================================

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
                witness_signature, patient_given_prescriptions, prescriptions_given,
                follow_up_offered, follow_up_instructions, patient_contact_info_verified,
                emergency_contact_notified, belongings_returned, security_escort,
                police_notified, social_work_notified, documentation_complete,
                physician_narrative, nurse_notes
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
                .push_bind(&d.nurse_notes);
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
        qb.push(", documentation_complete = ")
            .push_bind(discharge.documentation_complete);
        qb.push(", physician_narrative = ")
            .push_bind(&discharge.physician_narrative);
        qb.push(", nurse_notes = ")
            .push_bind(&discharge.nurse_notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&discharge.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AmaDischargeEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// SHIFT HANDOFF REPOSITORY
// =============================================================================

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
                acknowledged_by_incoming, acknowledged_at, handoff_tool_used
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
                .push_bind(&h.handoff_tool_used);
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

    async fn get_by_provider(
        &self,
        provider_id: &str,
        date: NaiveDate,
    ) -> RepositoryResult<Vec<ShiftHandoffEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM shift_handoffs 
             WHERE (outgoing_provider_id = ",
        );
        qb.push_bind(provider_id);
        qb.push(" OR incoming_provider_id = ");
        qb.push_bind(provider_id);
        qb.push(") AND DATE(handoff_datetime) = ");
        qb.push_bind(date);
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
        qb.push(", acknowledged_at = ").push_bind(Utc::now());
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
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

// =============================================================================
// INCIDENT REPORT REPOSITORY
// =============================================================================

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
                regulatory_reportable, reported_to_agencies, confidential
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
                .push_bind(r.confidential);
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
}
