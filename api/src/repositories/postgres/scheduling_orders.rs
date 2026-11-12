//! PostgreSQL repositories for appointments and physician orders.
//!
//! This module uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use chrono::{NaiveDate, Utc};
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

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
                cancellation_reason, cancelled_by, notes, created_by, data
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
                .push_bind(&a.created_by)
                .push_bind(&a.data);
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
        qb.push(", data = ").push_bind(&appointment.data);
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

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>> {
        let total = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appointments")
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM appointments ORDER BY scheduled_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<AppointmentEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_provider_all(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM appointments WHERE provider_id = ");
        count_qb.push_bind(provider_id);
        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM appointments WHERE provider_id = ");
        qb.push_bind(provider_id);
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
}

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
                discontinue_reason, linked_order_id, notes, data
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
                .push_bind(&o.notes)
                // The blob the read handlers serve. Omitted until
                // `20260910000005`, so every order read back as `null`.
                .push_bind(&o.data);
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
            QueryBuilder::new("SELECT COUNT(*) FROM physician_orders");
        if patient_id != "all" {
            count_qb.push(" WHERE patient_id = ");
            count_qb.push_bind(patient_id);
        }

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("SELECT * FROM physician_orders");
        if patient_id != "all" {
            qb.push(" WHERE patient_id = ");
            qb.push_bind(patient_id);
        }
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
        // `data` is the blob the read handlers actually serve, so an update
        // that omits it reports success while every reader keeps seeing the
        // values the record was first created with.
        qb.push(", data = ").push_bind(&order.data);
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
