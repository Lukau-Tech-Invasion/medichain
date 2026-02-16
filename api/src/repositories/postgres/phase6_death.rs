//! PostgreSQL implementations for Phase 13 Death Record repositories.
//!
//! Uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// DEATH RECORD REPOSITORY
// =============================================================================

/// PostgreSQL-backed death record repository
#[derive(Debug, Clone)]
pub struct PgDeathRecordRepository {
    pool: PgPool,
}

impl PgDeathRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DeathRecordRepository for PgDeathRecordRepository {
    async fn create(&self, record: DeathRecordEntity) -> RepositoryResult<DeathRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO death_records (
                id, patient_id, date_of_death, time_of_death, pronounced_datetime,
                pronounced_by, pronounced_by_name, place_of_death, facility_id, facility_name,
                death_address, county, state, country, immediate_cause, immediate_cause_duration,
                underlying_cause_a, underlying_cause_a_duration, underlying_cause_b,
                underlying_cause_b_duration, underlying_cause_c, underlying_cause_c_duration,
                other_significant_conditions, manner_of_death, autopsy_performed,
                autopsy_findings_available, autopsy_findings, medical_examiner_case,
                medical_examiner_number, certifier_type, certifier_id, certifier_name,
                certifier_license, certification_date, death_certificate_number,
                registration_date, registrar_district, disposition_method, disposition_date,
                funeral_home, tobacco_contributed, pregnancy_status, injury_at_work
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(r.date_of_death)
                .push_bind(r.time_of_death)
                .push_bind(r.pronounced_datetime)
                .push_bind(&r.pronounced_by)
                .push_bind(&r.pronounced_by_name)
                .push_bind(&r.place_of_death)
                .push_bind(&r.facility_id)
                .push_bind(&r.facility_name)
                .push_bind(&r.death_address)
                .push_bind(&r.county)
                .push_bind(&r.state)
                .push_bind(&r.country)
                .push_bind(&r.immediate_cause)
                .push_bind(&r.immediate_cause_duration)
                .push_bind(&r.underlying_cause_a)
                .push_bind(&r.underlying_cause_a_duration)
                .push_bind(&r.underlying_cause_b)
                .push_bind(&r.underlying_cause_b_duration)
                .push_bind(&r.underlying_cause_c)
                .push_bind(&r.underlying_cause_c_duration)
                .push_bind(&r.other_significant_conditions)
                .push_bind(&r.manner_of_death)
                .push_bind(r.autopsy_performed)
                .push_bind(r.autopsy_findings_available)
                .push_bind(&r.autopsy_findings)
                .push_bind(r.medical_examiner_case)
                .push_bind(&r.medical_examiner_number)
                .push_bind(&r.certifier_type)
                .push_bind(&r.certifier_id)
                .push_bind(&r.certifier_name)
                .push_bind(&r.certifier_license)
                .push_bind(r.certification_date)
                .push_bind(&r.death_certificate_number)
                .push_bind(r.registration_date)
                .push_bind(&r.registrar_district)
                .push_bind(&r.disposition_method)
                .push_bind(r.disposition_date)
                .push_bind(&r.funeral_home)
                .push_bind(r.tobacco_contributed)
                .push_bind(&r.pregnancy_status)
                .push_bind(r.injury_at_work);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<DeathRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DeathRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM death_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<DeathRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<DeathRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM death_records WHERE patient_id = ");
        qb.push_bind(patient_id);

        let record = qb
            .build_query_as::<DeathRecordEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_date_range(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> RepositoryResult<Vec<DeathRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM death_records WHERE date_of_death >= ");
        qb.push_bind(start_date);
        qb.push("::DATE AND date_of_death <= ");
        qb.push_bind(end_date);
        qb.push("::DATE ORDER BY date_of_death DESC");

        let items = qb
            .build_query_as::<DeathRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(&self, record: DeathRecordEntity) -> RepositoryResult<DeathRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE death_records SET ");
        qb.push("autopsy_findings_available = ")
            .push_bind(record.autopsy_findings_available);
        qb.push(", autopsy_findings = ")
            .push_bind(&record.autopsy_findings);
        qb.push(", death_certificate_number = ")
            .push_bind(&record.death_certificate_number);
        qb.push(", certification_date = ")
            .push_bind(record.certification_date);
        qb.push(", certifier_id = ").push_bind(&record.certifier_id);
        qb.push(", certifier_name = ")
            .push_bind(&record.certifier_name);
        qb.push(", disposition_method = ")
            .push_bind(&record.disposition_method);
        qb.push(", disposition_date = ")
            .push_bind(record.disposition_date);
        qb.push(", funeral_home = ").push_bind(&record.funeral_home);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<DeathRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_certificate_number(
        &self,
        certificate_number: &str,
    ) -> RepositoryResult<DeathRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM death_records WHERE death_certificate_number = ");
        qb.push_bind(certificate_number);

        let record = qb
            .build_query_as::<DeathRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_medical_examiner_cases(&self) -> RepositoryResult<Vec<DeathRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM death_records WHERE medical_examiner_case = true ORDER BY date_of_death DESC"
        );

        let items = qb
            .build_query_as::<DeathRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_pending_autopsies(&self) -> RepositoryResult<Vec<DeathRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM death_records WHERE autopsy_performed = true AND autopsy_findings_available = false ORDER BY date_of_death ASC",
        );

        let items = qb
            .build_query_as::<DeathRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// ORGAN DONATION RECORD REPOSITORY
// =============================================================================

/// PostgreSQL-backed organ donation record repository
#[derive(Debug, Clone)]
pub struct PgOrganDonationRecordRepository {
    pool: PgPool,
}

impl PgOrganDonationRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl OrganDonationRecordRepository for PgOrganDonationRecordRepository {
    async fn create(
        &self,
        record: OrganDonationRecordEntity,
    ) -> RepositoryResult<OrganDonationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO organ_donation_records (
                id, patient_id, death_record_id, registered_donor, registry_id,
                registration_date, consent_type, consenting_party, consenting_relationship,
                consent_datetime, donation_type, organs_donated, tissues_donated,
                opo_name, opo_contact, referral_datetime, evaluation_datetime,
                recovery_datetime, recovery_location, organs_recovered, organs_transplanted,
                tissues_recovered, recipients_helped, medical_suitability, exclusion_reasons, notes
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.death_record_id)
                .push_bind(r.registered_donor)
                .push_bind(&r.registry_id)
                .push_bind(r.registration_date)
                .push_bind(&r.consent_type)
                .push_bind(&r.consenting_party)
                .push_bind(&r.consenting_relationship)
                .push_bind(r.consent_datetime)
                .push_bind(&r.donation_type)
                .push_bind(&r.organs_donated)
                .push_bind(&r.tissues_donated)
                .push_bind(&r.opo_name)
                .push_bind(&r.opo_contact)
                .push_bind(r.referral_datetime)
                .push_bind(r.evaluation_datetime)
                .push_bind(r.recovery_datetime)
                .push_bind(&r.recovery_location)
                .push_bind(r.organs_recovered)
                .push_bind(r.organs_transplanted)
                .push_bind(r.tissues_recovered)
                .push_bind(r.recipients_helped)
                .push_bind(r.medical_suitability)
                .push_bind(&r.exclusion_reasons)
                .push_bind(&r.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<OrganDonationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<OrganDonationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM organ_donation_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<OrganDonationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<OrganDonationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM organ_donation_records WHERE patient_id = ");
        qb.push_bind(patient_id);

        let record = qb
            .build_query_as::<OrganDonationRecordEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_death_record(
        &self,
        death_record_id: &str,
    ) -> RepositoryResult<Option<OrganDonationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM organ_donation_records WHERE death_record_id = ");
        qb.push_bind(death_record_id);

        let record = qb
            .build_query_as::<OrganDonationRecordEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(record)
    }

    async fn update(
        &self,
        record: OrganDonationRecordEntity,
    ) -> RepositoryResult<OrganDonationRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE organ_donation_records SET ");
        qb.push("registered_donor = ")
            .push_bind(record.registered_donor);
        qb.push(", consent_type = ").push_bind(&record.consent_type);
        qb.push(", organs_donated = ")
            .push_bind(&record.organs_donated);
        qb.push(", tissues_donated = ")
            .push_bind(&record.tissues_donated);
        qb.push(", organs_recovered = ")
            .push_bind(record.organs_recovered);
        qb.push(", tissues_recovered = ")
            .push_bind(record.tissues_recovered);
        qb.push(", recovery_datetime = ")
            .push_bind(record.recovery_datetime);
        qb.push(", recovery_location = ")
            .push_bind(&record.recovery_location);
        qb.push(", organs_transplanted = ")
            .push_bind(record.organs_transplanted);
        qb.push(", recipients_helped = ")
            .push_bind(record.recipients_helped);
        qb.push(", notes = ").push_bind(&record.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<OrganDonationRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_registered_donors(&self) -> RepositoryResult<Vec<OrganDonationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM organ_donation_records WHERE registered_donor = true ORDER BY registration_date DESC",
        );

        let items = qb
            .build_query_as::<OrganDonationRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_pending_recovery(&self) -> RepositoryResult<Vec<OrganDonationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM organ_donation_records 
             WHERE consent_type IS NOT NULL 
             AND medical_suitability = true 
             AND recovery_datetime IS NULL 
             ORDER BY created_at ASC",
        );

        let items = qb
            .build_query_as::<OrganDonationRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_opo(&self, opo_name: &str) -> RepositoryResult<Vec<OrganDonationRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM organ_donation_records WHERE opo_name = ");
        qb.push_bind(opo_name);
        qb.push(" ORDER BY created_at DESC");

        let items = qb
            .build_query_as::<OrganDonationRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}
