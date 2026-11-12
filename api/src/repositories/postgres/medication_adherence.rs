//! PostgreSQL repositories for medication reminders and the adherence log.
//!
//! This module uses sqlx::QueryBuilder pattern for dynamic SQL construction instead of
//! manual $1, $2, $3... positional placeholders. This provides type-safe query building
//! and better maintainability.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

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
