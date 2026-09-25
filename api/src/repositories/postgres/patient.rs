//! PostgreSQL implementation of PatientRepository.
//! Uses sqlx::QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::patient_search::PatientSearchCriteria;
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

/// The `WHERE` clause for a patient search: `PatientSearchCriteria::matches`,
/// in SQL. Every value is bound; nothing from the query is spliced into text.
fn push_search_predicate<'a>(
    qb: &mut QueryBuilder<'a, Postgres>,
    criteria: &'a PatientSearchCriteria,
) {
    qb.push("is_active = true AND (LOWER(id) = LOWER(")
        .push_bind(&criteria.identifier)
        .push(") OR LOWER(health_id) = LOWER(")
        .push_bind(&criteria.identifier)
        .push(") OR wallet_address = ")
        .push_bind(&criteria.identifier)
        .push(" OR national_id_hash = ")
        .push_bind(&criteria.national_id_hash);
    if !criteria.name_tokens.is_empty() {
        qb.push(" OR name_search_tokens @> ")
            .push_bind(&criteria.name_tokens);
    }
    qb.push(")");
}

#[async_trait]
impl PatientRepository for PgPatientRepository {
    async fn create(&self, patient: PatientEntity) -> RepositoryResult<PatientEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO patients (id, health_id, national_id_hash, national_id_type, first_name_encrypted, last_name_encrypted, date_of_birth_encrypted, gender, blood_type, phone_encrypted, email_encrypted, address_encrypted, emergency_contact_name_encrypted, emergency_contact_phone_encrypted, emergency_contact_relationship, organ_donor, dnr_status, dnr_verified_by, dnr_verified_at, dnr_document_ref, primary_provider_id, wallet_address, registered_by, is_verified, is_active, profile_extras_encrypted, name_search_tokens, key_version) "
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
                .push_bind(&p.dnr_verified_by)
                .push_bind(p.dnr_verified_at)
                .push_bind(&p.dnr_document_ref)
                .push_bind(&p.primary_provider_id)
                .push_bind(&p.wallet_address)
                .push_bind(&p.registered_by)
                .push_bind(p.is_verified)
                .push_bind(p.is_active)
                .push_bind(&p.profile_extras_encrypted)
                .push_bind(&p.name_search_tokens)
                .push_bind(p.key_version);
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
        qb.push(", dnr_verified_by = ")
            .push_bind(&patient.dnr_verified_by);
        qb.push(", dnr_verified_at = ")
            .push_bind(patient.dnr_verified_at);
        qb.push(", dnr_document_ref = ")
            .push_bind(&patient.dnr_document_ref);
        qb.push(", primary_provider_id = ")
            .push_bind(&patient.primary_provider_id);
        qb.push(", wallet_address = ")
            .push_bind(&patient.wallet_address);
        qb.push(", is_verified = ").push_bind(patient.is_verified);
        qb.push(", is_active = ").push_bind(patient.is_active);
        qb.push(", profile_extras_encrypted = ")
            .push_bind(&patient.profile_extras_encrypted);
        qb.push(", name_search_tokens = ")
            .push_bind(&patient.name_search_tokens);
        qb.push(", key_version = ").push_bind(patient.key_version);
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

    async fn list_keyset(
        &self,
        cursor: Option<(chrono::DateTime<chrono::Utc>, String)>,
        limit: u32,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM patients WHERE is_active = true")
            .fetch_one(&self.pool)
            .await?;
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM patients WHERE is_active = true");
        if let Some((updated_at, id)) = cursor {
            qb.push(" AND (updated_at < ")
                .push_bind(updated_at)
                .push(" OR (updated_at = ")
                .push_bind(updated_at)
                .push(" AND id > ")
                .push_bind(id)
                .push("))");
        }
        qb.push(" ORDER BY updated_at DESC, id ASC LIMIT ")
            .push_bind(limit as i64);
        let patients = qb
            .build_query_as::<PatientEntity>()
            .fetch_all(&self.pool)
            .await?;
        Ok(PaginatedResult::new(
            patients,
            count as u64,
            &Pagination::new(0, limit),
        ))
    }

    async fn search(
        &self,
        query: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let criteria = PatientSearchCriteria::new(query);

        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM patients WHERE ");
        push_search_predicate(&mut count_qb, &criteria);
        let count = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("SELECT * FROM patients WHERE ");
        push_search_predicate(&mut qb, &criteria);
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

    async fn search_keyset(
        &self,
        query: &str,
        cursor: Option<(chrono::DateTime<chrono::Utc>, String)>,
        limit: u32,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let criteria = PatientSearchCriteria::new(query);
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM patients WHERE ");
        push_search_predicate(&mut count_qb, &criteria);
        let count = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await?;

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("SELECT * FROM patients WHERE ");
        push_search_predicate(&mut qb, &criteria);
        if let Some((updated_at, id)) = cursor {
            qb.push(" AND (updated_at < ")
                .push_bind(updated_at)
                .push(" OR (updated_at = ")
                .push_bind(updated_at)
                .push(" AND id > ")
                .push_bind(id)
                .push("))");
        }
        qb.push(" ORDER BY updated_at DESC, id ASC LIMIT ")
            .push_bind(limit as i64);
        let patients = qb
            .build_query_as::<PatientEntity>()
            .fetch_all(&self.pool)
            .await?;
        Ok(PaginatedResult::new(
            patients,
            count as u64,
            &Pagination::new(0, limit),
        ))
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

    async fn list_unindexed_names(
        &self,
        after_id: Option<&str>,
        limit: u32,
    ) -> RepositoryResult<Vec<PatientEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM patients WHERE cardinality(name_search_tokens) = 0");
        if let Some(after_id) = after_id {
            qb.push(" AND id > ").push_bind(after_id);
        }
        qb.push(" ORDER BY id ASC LIMIT ").push_bind(limit as i64);
        Ok(qb
            .build_query_as::<PatientEntity>()
            .fetch_all(&self.pool)
            .await?)
    }

    async fn set_name_search_tokens(&self, id: &str, tokens: &[String]) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE patients SET name_search_tokens = ");
        qb.push_bind(tokens).push(" WHERE id = ").push_bind(id);
        let result = qb.build().execute(&self.pool).await?;
        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound(format!("Patient {id} not found")));
        }
        Ok(())
    }

    async fn count_by_gender(&self) -> RepositoryResult<std::collections::HashMap<String, u64>> {
        // COALESCE before LOWER so a NULL and an empty string land in the same
        // explicit bucket instead of becoming a NULL group the caller has to
        // guess at. Grouping in the query keeps the population off the heap.
        let rows = sqlx::query_as::<_, (String, i64)>(
            "SELECT COALESCE(NULLIF(LOWER(TRIM(gender)), ''), 'not_recorded') AS bucket, \
             COUNT(*) FROM patients WHERE is_active = true GROUP BY bucket",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|(bucket, count)| (bucket, count as u64))
            .collect())
    }
}
