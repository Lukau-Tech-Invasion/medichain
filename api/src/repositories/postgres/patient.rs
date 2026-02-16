//! PostgreSQL implementation of PatientRepository.
//! Uses sqlx::QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::{
    PaginatedResult, Pagination, PatientEntity, PatientRepository, RepositoryError,
    RepositoryResult,
};

/// PostgreSQL-backed patient repository
#[derive(Debug, Clone)]
pub struct PgPatientRepository {
    pool: PgPool,
}

impl PgPatientRepository {
    /// Create a new PostgreSQL patient repository
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PatientRepository for PgPatientRepository {
    async fn create(&self, patient: PatientEntity) -> RepositoryResult<PatientEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO patients (id, health_id, national_id_hash, national_id_type, first_name_encrypted, last_name_encrypted, date_of_birth_encrypted, gender, blood_type, phone_encrypted, email_encrypted, address_encrypted, emergency_contact_name_encrypted, emergency_contact_phone_encrypted, emergency_contact_relationship, organ_donor, dnr_status, primary_provider_id, wallet_address, registered_by, is_verified, is_active) "
        );

        qb.push_values([&patient], |mut b, p| {
            b.push_bind(&p.id)
                .push_bind(&p.health_id)
                .push_bind(&p.national_id_hash)
                .push_bind(&p.national_id_type)
                .push_bind(&p.first_name_encrypted)
                .push_bind(&p.last_name_encrypted)
                .push_bind(&p.date_of_birth_encrypted)
                .push_bind(&p.gender)
                .push_bind(&p.blood_type)
                .push_bind(&p.phone_encrypted)
                .push_bind(&p.email_encrypted)
                .push_bind(&p.address_encrypted)
                .push_bind(&p.emergency_contact_name_encrypted)
                .push_bind(&p.emergency_contact_phone_encrypted)
                .push_bind(&p.emergency_contact_relationship)
                .push_bind(p.organ_donor)
                .push_bind(p.dnr_status)
                .push_bind(&p.primary_provider_id)
                .push_bind(&p.wallet_address)
                .push_bind(&p.registered_by)
                .push_bind(p.is_verified)
                .push_bind(p.is_active);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PatientEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PatientEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM patients WHERE id = ");
        qb.push_bind(id);
        qb.push(" AND is_active = true");

        let patient = qb
            .build_query_as::<PatientEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(patient)
    }

    async fn get_by_health_id(&self, health_id: &str) -> RepositoryResult<PatientEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM patients WHERE health_id = ");
        qb.push_bind(health_id);
        qb.push(" AND is_active = true");

        let patient = qb
            .build_query_as::<PatientEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(patient)
    }

    async fn get_by_national_id_hash(&self, hash: &str) -> RepositoryResult<PatientEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM patients WHERE national_id_hash = ");
        qb.push_bind(hash);
        qb.push(" AND is_active = true");

        let patient = qb
            .build_query_as::<PatientEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(patient)
    }

    async fn get_by_wallet(&self, wallet: &str) -> RepositoryResult<PatientEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM patients WHERE wallet_address = ");
        qb.push_bind(wallet);
        qb.push(" AND is_active = true");

        let patient = qb
            .build_query_as::<PatientEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(patient)
    }

    async fn update(&self, patient: PatientEntity) -> RepositoryResult<PatientEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE patients SET ");
        qb.push("health_id = ").push_bind(&patient.health_id);
        qb.push(", national_id_hash = ")
            .push_bind(&patient.national_id_hash);
        qb.push(", national_id_type = ")
            .push_bind(&patient.national_id_type);
        qb.push(", first_name_encrypted = ")
            .push_bind(&patient.first_name_encrypted);
        qb.push(", last_name_encrypted = ")
            .push_bind(&patient.last_name_encrypted);
        qb.push(", date_of_birth_encrypted = ")
            .push_bind(&patient.date_of_birth_encrypted);
        qb.push(", gender = ").push_bind(&patient.gender);
        qb.push(", blood_type = ").push_bind(&patient.blood_type);
        qb.push(", phone_encrypted = ")
            .push_bind(&patient.phone_encrypted);
        qb.push(", email_encrypted = ")
            .push_bind(&patient.email_encrypted);
        qb.push(", address_encrypted = ")
            .push_bind(&patient.address_encrypted);
        qb.push(", emergency_contact_name_encrypted = ")
            .push_bind(&patient.emergency_contact_name_encrypted);
        qb.push(", emergency_contact_phone_encrypted = ")
            .push_bind(&patient.emergency_contact_phone_encrypted);
        qb.push(", emergency_contact_relationship = ")
            .push_bind(&patient.emergency_contact_relationship);
        qb.push(", organ_donor = ").push_bind(patient.organ_donor);
        qb.push(", dnr_status = ").push_bind(patient.dnr_status);
        qb.push(", primary_provider_id = ")
            .push_bind(&patient.primary_provider_id);
        qb.push(", wallet_address = ")
            .push_bind(&patient.wallet_address);
        qb.push(", is_verified = ").push_bind(patient.is_verified);
        qb.push(", is_active = ").push_bind(patient.is_active);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&patient.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<PatientEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE patients SET is_active = false, updated_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);

        let result = qb.build().execute(&self.pool).await?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound(format!(
                "Patient {} not found",
                id
            )));
        }

        Ok(())
    }

    async fn list(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM patients WHERE is_active = true");

        let count = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM patients WHERE is_active = true ORDER BY created_at DESC LIMIT ",
        );
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let patients = qb
            .build_query_as::<PatientEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(patients, count as u64, &pagination))
    }

    async fn search(
        &self,
        query: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let search_pattern = format!("%{}%", query);

        let mut count_qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT COUNT(*) FROM patients WHERE is_active = true AND (health_id ILIKE ",
        );
        count_qb.push_bind(&search_pattern);
        count_qb.push(" OR wallet_address ILIKE ");
        count_qb.push_bind(&search_pattern);
        count_qb.push(" OR national_id_hash ILIKE ");
        count_qb.push_bind(&search_pattern);
        count_qb.push(")");

        let count = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM patients WHERE is_active = true AND (health_id ILIKE ",
        );
        qb.push_bind(&search_pattern);
        qb.push(" OR wallet_address ILIKE ");
        qb.push_bind(&search_pattern);
        qb.push(" OR national_id_hash ILIKE ");
        qb.push_bind(&search_pattern);
        qb.push(") ORDER BY created_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let patients = qb
            .build_query_as::<PatientEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(patients, count as u64, &pagination))
    }

    async fn get_by_provider(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let mut count_qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT COUNT(*) FROM patients WHERE is_active = true AND primary_provider_id = ",
        );
        count_qb.push_bind(provider_id);

        let count = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM patients WHERE is_active = true AND primary_provider_id = ",
        );
        qb.push_bind(provider_id);
        qb.push(" ORDER BY created_at DESC LIMIT ");
        qb.push_bind(pagination.limit() as i64);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i64);

        let patients = qb
            .build_query_as::<PatientEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(patients, count as u64, &pagination))
    }

    async fn count(&self) -> RepositoryResult<u64> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM patients WHERE is_active = true");

        let count = qb.build_query_scalar::<i64>().fetch_one(&self.pool).await?;

        Ok(count as u64)
    }
}
