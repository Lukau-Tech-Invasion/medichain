//! PostgreSQL implementations for Phase 12 Immunization repositories.
//!
//! Uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// IMMUNIZATION RECORD REPOSITORY
// =============================================================================

/// PostgreSQL-backed immunization record repository
#[derive(Debug, Clone)]
pub struct PgImmunizationRecordRepository {
    pool: PgPool,
}

impl PgImmunizationRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ImmunizationRecordRepository for PgImmunizationRecordRepository {
    async fn create(
        &self,
        record: ImmunizationRecordEntity,
    ) -> RepositoryResult<ImmunizationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO immunization_records (
                id, patient_id, vaccine_type, vaccine_name, manufacturer,
                lot_number, ndc_code, cvx_code, mvx_code, administration_date,
                administration_time, administered_by, administered_by_name,
                administration_site, route, dose_amount, dose_unit, dose_number,
                series_complete, facility_id, facility_name, facility_address,
                vfc_eligibility, funding_source, information_source,
                documentation_type, reaction_observed, reaction_details,
                contraindications_reviewed, patient_consent, vis_given, vis_date, notes
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.vaccine_type)
                .push_bind(&r.vaccine_name)
                .push_bind(&r.manufacturer)
                .push_bind(&r.lot_number)
                .push_bind(&r.ndc_code)
                .push_bind(&r.cvx_code)
                .push_bind(&r.mvx_code)
                .push_bind(r.administration_date)
                .push_bind(r.administration_time)
                .push_bind(&r.administered_by)
                .push_bind(&r.administered_by_name)
                .push_bind(&r.administration_site)
                .push_bind(&r.route)
                .push_bind(&r.dose_amount)
                .push_bind(&r.dose_unit)
                .push_bind(r.dose_number)
                .push_bind(r.series_complete)
                .push_bind(&r.facility_id)
                .push_bind(&r.facility_name)
                .push_bind(&r.facility_address)
                .push_bind(&r.vfc_eligibility)
                .push_bind(&r.funding_source)
                .push_bind(&r.information_source)
                .push_bind(&r.documentation_type)
                .push_bind(r.reaction_observed)
                .push_bind(&r.reaction_details)
                .push_bind(r.contraindications_reviewed)
                .push_bind(r.patient_consent)
                .push_bind(r.vis_given)
                .push_bind(r.vis_date)
                .push_bind(&r.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ImmunizationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ImmunizationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM immunization_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<ImmunizationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM immunization_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY administration_date DESC");

        let items = qb
            .build_query_as::<ImmunizationRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_vaccine_type(
        &self,
        patient_id: &str,
        vaccine_type: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM immunization_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND vaccine_type = ");
        qb.push_bind(vaccine_type);
        qb.push(" ORDER BY administration_date DESC");

        let items = qb
            .build_query_as::<ImmunizationRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        record: ImmunizationRecordEntity,
    ) -> RepositoryResult<ImmunizationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE immunization_records SET ");
        qb.push("reaction_observed = ")
            .push_bind(record.reaction_observed);
        qb.push(", reaction_details = ")
            .push_bind(&record.reaction_details);
        qb.push(", series_complete = ")
            .push_bind(record.series_complete);
        qb.push(", notes = ").push_bind(&record.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ImmunizationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_recent(
        &self,
        patient_id: &str,
        days: i32,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM immunization_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND administration_date >= CURRENT_DATE - ");
        qb.push_bind(days);
        qb.push("::INTEGER ORDER BY administration_date DESC");

        let items = qb
            .build_query_as::<ImmunizationRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_lot_number(
        &self,
        lot_number: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM immunization_records WHERE lot_number = ");
        qb.push_bind(lot_number);
        qb.push(" ORDER BY administration_date DESC");

        let items = qb
            .build_query_as::<ImmunizationRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// IMMUNIZATION SCHEDULE REPOSITORY
// =============================================================================

/// PostgreSQL-backed immunization schedule repository
#[derive(Debug, Clone)]
pub struct PgImmunizationScheduleRepository {
    pool: PgPool,
}

impl PgImmunizationScheduleRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ImmunizationScheduleRepository for PgImmunizationScheduleRepository {
    async fn create(
        &self,
        schedule: ImmunizationScheduleEntity,
    ) -> RepositoryResult<ImmunizationScheduleEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO immunization_schedules (
                id, patient_id, vaccine_type, due_date, earliest_date,
                latest_date, dose_number, is_overdue, status,
                completed_immunization_id, skip_reason, reminder_sent, reminder_date
            ) ",
        );

        qb.push_values([&schedule], |mut b, s| {
            b.push_bind(&s.id)
                .push_bind(&s.patient_id)
                .push_bind(&s.vaccine_type)
                .push_bind(s.due_date)
                .push_bind(s.earliest_date)
                .push_bind(s.latest_date)
                .push_bind(s.dose_number)
                .push_bind(s.is_overdue)
                .push_bind(&s.status)
                .push_bind(&s.completed_immunization_id)
                .push_bind(&s.skip_reason)
                .push_bind(s.reminder_sent)
                .push_bind(s.reminder_date);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ImmunizationScheduleEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ImmunizationScheduleEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM immunization_schedules WHERE id = ");
        qb.push_bind(id);

        let schedule = qb
            .build_query_as::<ImmunizationScheduleEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(schedule)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ImmunizationScheduleEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM immunization_schedules WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY due_date ASC");

        let items = qb
            .build_query_as::<ImmunizationScheduleEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_due(&self, patient_id: &str) -> RepositoryResult<Vec<ImmunizationScheduleEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM immunization_schedules WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND status = 'due' ORDER BY due_date ASC");

        let items = qb
            .build_query_as::<ImmunizationScheduleEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_overdue(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ImmunizationScheduleEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM immunization_schedules WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND status = 'due' AND due_date < CURRENT_DATE ORDER BY due_date ASC");

        let items = qb
            .build_query_as::<ImmunizationScheduleEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        schedule: ImmunizationScheduleEntity,
    ) -> RepositoryResult<ImmunizationScheduleEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE immunization_schedules SET ");
        qb.push("due_date = ").push_bind(schedule.due_date);
        qb.push(", earliest_date = ")
            .push_bind(schedule.earliest_date);
        qb.push(", latest_date = ").push_bind(schedule.latest_date);
        qb.push(", is_overdue = ").push_bind(schedule.is_overdue);
        qb.push(", status = ").push_bind(&schedule.status);
        qb.push(", reminder_sent = ")
            .push_bind(schedule.reminder_sent);
        qb.push(", reminder_date = ")
            .push_bind(schedule.reminder_date);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&schedule.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ImmunizationScheduleEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn complete(
        &self,
        id: &str,
        immunization_id: &str,
    ) -> RepositoryResult<ImmunizationScheduleEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE immunization_schedules SET ");
        qb.push("status = 'completed', completed_immunization_id = ")
            .push_bind(immunization_id);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ImmunizationScheduleEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn skip(&self, id: &str, reason: &str) -> RepositoryResult<ImmunizationScheduleEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE immunization_schedules SET ");
        qb.push("status = 'skipped', skip_reason = ")
            .push_bind(reason);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ImmunizationScheduleEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// VACCINE INVENTORY REPOSITORY
// =============================================================================

/// PostgreSQL-backed vaccine inventory repository
#[derive(Debug, Clone)]
pub struct PgVaccineInventoryRepository {
    pool: PgPool,
}

impl PgVaccineInventoryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl VaccineInventoryRepository for PgVaccineInventoryRepository {
    async fn create(
        &self,
        inventory: VaccineInventoryEntity,
    ) -> RepositoryResult<VaccineInventoryEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO vaccine_inventory (
                id, facility_id, vaccine_type, vaccine_name, manufacturer,
                lot_number, ndc_code, quantity_received, quantity_remaining,
                unit_of_measure, storage_location, storage_temperature_min,
                storage_temperature_max, temperature_monitored, received_date,
                expiration_date, first_use_date, status, recall_number,
                disposal_date, disposal_reason
            ) ",
        );

        qb.push_values([&inventory], |mut b, i| {
            b.push_bind(&i.id)
                .push_bind(&i.facility_id)
                .push_bind(&i.vaccine_type)
                .push_bind(&i.vaccine_name)
                .push_bind(&i.manufacturer)
                .push_bind(&i.lot_number)
                .push_bind(&i.ndc_code)
                .push_bind(i.quantity_received)
                .push_bind(i.quantity_remaining)
                .push_bind(&i.unit_of_measure)
                .push_bind(&i.storage_location)
                .push_bind(i.storage_temperature_min)
                .push_bind(i.storage_temperature_max)
                .push_bind(i.temperature_monitored)
                .push_bind(i.received_date)
                .push_bind(i.expiration_date)
                .push_bind(i.first_use_date)
                .push_bind(&i.status)
                .push_bind(&i.recall_number)
                .push_bind(i.disposal_date)
                .push_bind(&i.disposal_reason);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<VaccineInventoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<VaccineInventoryEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM vaccine_inventory WHERE id = ");
        qb.push_bind(id);

        let inventory = qb
            .build_query_as::<VaccineInventoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(inventory)
    }

    async fn get_by_facility(
        &self,
        facility_id: &str,
    ) -> RepositoryResult<Vec<VaccineInventoryEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM vaccine_inventory WHERE facility_id = ");
        qb.push_bind(facility_id);
        qb.push(" ORDER BY expiration_date ASC");

        let items = qb
            .build_query_as::<VaccineInventoryEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_available(
        &self,
        facility_id: &str,
        vaccine_type: &str,
    ) -> RepositoryResult<Vec<VaccineInventoryEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM vaccine_inventory WHERE facility_id = ");
        qb.push_bind(facility_id);
        qb.push(" AND vaccine_type = ");
        qb.push_bind(vaccine_type);
        qb.push(
            " AND status = 'available' AND quantity_remaining > 0 ORDER BY expiration_date ASC",
        );

        let items = qb
            .build_query_as::<VaccineInventoryEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        inventory: VaccineInventoryEntity,
    ) -> RepositoryResult<VaccineInventoryEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE vaccine_inventory SET ");
        qb.push("quantity_remaining = ")
            .push_bind(inventory.quantity_remaining);
        qb.push(", status = ").push_bind(&inventory.status);
        qb.push(", storage_location = ")
            .push_bind(&inventory.storage_location);
        qb.push(", disposal_date = ")
            .push_bind(inventory.disposal_date);
        qb.push(", disposal_reason = ")
            .push_bind(&inventory.disposal_reason);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&inventory.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<VaccineInventoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn decrement_quantity(
        &self,
        id: &str,
        amount: i32,
    ) -> RepositoryResult<VaccineInventoryEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE vaccine_inventory SET 
             quantity_remaining = GREATEST(0, quantity_remaining - ",
        );
        qb.push_bind(amount);
        qb.push("), first_use_date = COALESCE(first_use_date, CURRENT_DATE),");
        qb.push(" status = CASE WHEN quantity_remaining - ");
        qb.push_bind(amount);
        qb.push(" <= 0 THEN 'depleted' ELSE status END, updated_at = NOW() WHERE id = ");
        qb.push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<VaccineInventoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_expiring_soon(&self, days: i32) -> RepositoryResult<Vec<VaccineInventoryEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM vaccine_inventory 
             WHERE status = 'available' 
             AND expiration_date <= CURRENT_DATE + ",
        );
        qb.push_bind(days);
        qb.push("::INTEGER ORDER BY expiration_date ASC");

        let items = qb
            .build_query_as::<VaccineInventoryEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn mark_recalled(
        &self,
        lot_number: &str,
        recall_number: &str,
    ) -> RepositoryResult<Vec<VaccineInventoryEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE vaccine_inventory SET status = 'recalled', recall_number = ");
        qb.push_bind(recall_number);
        qb.push(", updated_at = NOW() WHERE lot_number = ");
        qb.push_bind(lot_number);
        qb.push(" RETURNING *");

        let items = qb
            .build_query_as::<VaccineInventoryEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}
