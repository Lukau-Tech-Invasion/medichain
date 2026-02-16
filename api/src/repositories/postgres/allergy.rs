//! PostgreSQL implementation of AllergyRepository.
//! Uses sqlx::QueryBuilder pattern for type-safe query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::{AllergyEntity, AllergyRepository, RepositoryError, RepositoryResult};

/// PostgreSQL-backed allergy repository
#[derive(Debug, Clone)]
pub struct PgAllergyRepository {
    pool: PgPool,
}

impl PgAllergyRepository {
    /// Create a new PostgreSQL allergy repository
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AllergyRepository for PgAllergyRepository {
    async fn create(&self, allergy: AllergyEntity) -> RepositoryResult<AllergyEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO allergies (
                id, patient_id, allergen, allergen_type, reaction, severity,
                onset_date, last_occurrence, verified, verified_by, verified_at,
                source, created_by, is_active
            ) ",
        );

        qb.push_values([&allergy], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.patient_id)
                .push_bind(&a.allergen)
                .push_bind(&a.allergen_type)
                .push_bind(&a.reaction)
                .push_bind(&a.severity)
                .push_bind(a.onset_date)
                .push_bind(a.last_occurrence)
                .push_bind(a.verified)
                .push_bind(&a.verified_by)
                .push_bind(a.verified_at)
                .push_bind(&a.source)
                .push_bind(&a.created_by)
                .push_bind(a.is_active);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AllergyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AllergyEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM allergies WHERE id = ");
        qb.push_bind(id);
        qb.push(" AND is_active = true");

        let allergy = qb
            .build_query_as::<AllergyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(allergy)
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<AllergyEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM allergies WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY created_at DESC");

        let allergies = qb
            .build_query_as::<AllergyEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(allergies)
    }

    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<AllergyEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM allergies WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY severity DESC, allergen ASC");

        let allergies = qb
            .build_query_as::<AllergyEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(allergies)
    }

    async fn update(&self, allergy: AllergyEntity) -> RepositoryResult<AllergyEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE allergies SET ");
        qb.push("allergen = ").push_bind(&allergy.allergen);
        qb.push(", allergen_type = ")
            .push_bind(&allergy.allergen_type);
        qb.push(", reaction = ").push_bind(&allergy.reaction);
        qb.push(", severity = ").push_bind(&allergy.severity);
        qb.push(", onset_date = ").push_bind(allergy.onset_date);
        qb.push(", last_occurrence = ")
            .push_bind(allergy.last_occurrence);
        qb.push(", verified = ").push_bind(allergy.verified);
        qb.push(", verified_by = ").push_bind(&allergy.verified_by);
        qb.push(", verified_at = ").push_bind(allergy.verified_at);
        qb.push(", source = ").push_bind(&allergy.source);
        qb.push(", is_active = ").push_bind(allergy.is_active);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&allergy.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<AllergyEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE allergies SET is_active = false, updated_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);

        let result = qb.build().execute(&self.pool).await?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound(format!(
                "Allergy {} not found",
                id
            )));
        }

        Ok(())
    }

    async fn has_allergen(&self, patient_id: &str, allergen: &str) -> RepositoryResult<bool> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM allergies WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND allergen ILIKE ");
        qb.push_bind(allergen);
        qb.push(" AND is_active = true");

        let count: (i64,) = qb.build_query_as().fetch_one(&self.pool).await?;

        Ok(count.0 > 0)
    }

    async fn get_severe_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<AllergyEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM allergies WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true AND (severity = 'Severe' OR severity = 'LifeThreatening') ORDER BY severity DESC, allergen ASC");

        let allergies = qb
            .build_query_as::<AllergyEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(allergies)
    }
}
