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
                contraindications_reviewed, patient_consent, vis_given, vis_date, notes, data
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
                .push_bind(&r.notes)
                .push_bind(&r.data);
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
        qb.push(", data = ").push_bind(&record.data);
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

    async fn list_all(&self) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM immunization_records ORDER BY administration_date DESC",
        );
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

// =============================================================================
// VACCINE INVENTORY REPOSITORY
// =============================================================================
