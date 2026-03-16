//! PostgreSQL implementations for Phase 11 Family History & Genetics repositories.
//!
//! Uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// FAMILY MEDICAL HISTORY REPOSITORY
// =============================================================================

/// PostgreSQL-backed family medical history repository
#[derive(Debug, Clone)]
pub struct PgFamilyMedicalHistoryRepository {
    pool: PgPool,
}

impl PgFamilyMedicalHistoryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl FamilyMedicalHistoryRepository for PgFamilyMedicalHistoryRepository {
    async fn create(
        &self,
        history: FamilyMedicalHistoryEntity,
    ) -> RepositoryResult<FamilyMedicalHistoryEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO family_medical_history (
                id, patient_id, relationship, relationship_type, relative_name,
                relative_dob, relative_gender, living_status, age_at_death,
                cause_of_death, conditions, cancer_history, cardiac_history,
                diabetes_history, mental_health_history, genetic_conditions,
                hereditary_risk_score, genetic_testing_recommended,
                genetic_counseling_received, notes, verified, verified_by,
                verified_date, source
            ) ",
        );

        qb.push_values([&history], |mut b, h| {
            b.push_bind(&h.id)
                .push_bind(&h.patient_id)
                .push_bind(&h.relationship)
                .push_bind(&h.relationship_type)
                .push_bind(&h.relative_name)
                .push_bind(h.relative_dob)
                .push_bind(&h.relative_gender)
                .push_bind(&h.living_status)
                .push_bind(h.age_at_death)
                .push_bind(&h.cause_of_death)
                .push_bind(&h.conditions)
                .push_bind(&h.cancer_history)
                .push_bind(&h.cardiac_history)
                .push_bind(&h.diabetes_history)
                .push_bind(&h.mental_health_history)
                .push_bind(&h.genetic_conditions)
                .push_bind(h.hereditary_risk_score)
                .push_bind(h.genetic_testing_recommended)
                .push_bind(h.genetic_counseling_received)
                .push_bind(&h.notes)
                .push_bind(h.verified)
                .push_bind(&h.verified_by)
                .push_bind(h.verified_date)
                .push_bind(&h.source);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<FamilyMedicalHistoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<FamilyMedicalHistoryEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM family_medical_history WHERE id = ");
        qb.push_bind(id);

        let history = qb
            .build_query_as::<FamilyMedicalHistoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(history)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<FamilyMedicalHistoryEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM family_medical_history WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY relationship");

        let items = qb
            .build_query_as::<FamilyMedicalHistoryEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_relationship(
        &self,
        patient_id: &str,
        relationship: &str,
    ) -> RepositoryResult<Vec<FamilyMedicalHistoryEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM family_medical_history WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND relationship = ");
        qb.push_bind(relationship);

        let items = qb
            .build_query_as::<FamilyMedicalHistoryEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        history: FamilyMedicalHistoryEntity,
    ) -> RepositoryResult<FamilyMedicalHistoryEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE family_medical_history SET ");
        qb.push("conditions = ").push_bind(&history.conditions);
        qb.push(", cancer_history = ")
            .push_bind(&history.cancer_history);
        qb.push(", cardiac_history = ")
            .push_bind(&history.cardiac_history);
        qb.push(", diabetes_history = ")
            .push_bind(&history.diabetes_history);
        qb.push(", mental_health_history = ")
            .push_bind(&history.mental_health_history);
        qb.push(", genetic_conditions = ")
            .push_bind(&history.genetic_conditions);
        qb.push(", hereditary_risk_score = ")
            .push_bind(history.hereditary_risk_score);
        qb.push(", notes = ").push_bind(&history.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&history.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<FamilyMedicalHistoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("DELETE FROM family_medical_history WHERE id = ");
        qb.push_bind(id);

        qb.build().execute(&self.pool).await?;

        Ok(())
    }

    async fn verify(
        &self,
        id: &str,
        verified_by: &str,
    ) -> RepositoryResult<FamilyMedicalHistoryEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE family_medical_history SET ");
        qb.push("verified = true, verified_by = ")
            .push_bind(verified_by);
        qb.push(", verified_date = CURRENT_DATE, updated_at = NOW() WHERE id = ")
            .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<FamilyMedicalHistoryEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// GENETIC TEST RESULT REPOSITORY
// =============================================================================

/// PostgreSQL-backed genetic test result repository
#[derive(Debug, Clone)]
pub struct PgGeneticTestResultRepository {
    pool: PgPool,
}

impl PgGeneticTestResultRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl GeneticTestResultRepository for PgGeneticTestResultRepository {
    async fn create(
        &self,
        result: GeneticTestResultEntity,
    ) -> RepositoryResult<GeneticTestResultEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO genetic_test_results (
                id, patient_id, test_type, panel_name, lab_name, lab_accession,
                ordered_by, ordered_date, collected_date, reported_date,
                result_status, variants, interpretation, clinical_significance,
                recommendations, follow_up_required, genetic_counseling_provided,
                counselor_name, counseling_date, report_url, report_ipfs_hash,
                consent_form_signed
            ) ",
        );

        qb.push_values([&result], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.test_type)
                .push_bind(&r.panel_name)
                .push_bind(&r.lab_name)
                .push_bind(&r.lab_accession)
                .push_bind(&r.ordered_by)
                .push_bind(r.ordered_date)
                .push_bind(r.collected_date)
                .push_bind(r.reported_date)
                .push_bind(&r.result_status)
                .push_bind(&r.variants)
                .push_bind(&r.interpretation)
                .push_bind(&r.clinical_significance)
                .push_bind(&r.recommendations)
                .push_bind(r.follow_up_required)
                .push_bind(r.genetic_counseling_provided)
                .push_bind(&r.counselor_name)
                .push_bind(r.counseling_date)
                .push_bind(&r.report_url)
                .push_bind(&r.report_ipfs_hash)
                .push_bind(r.consent_form_signed);
        });

        qb.push(" RETURNING *");

        let entity = qb
            .build_query_as::<GeneticTestResultEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(entity)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<GeneticTestResultEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM genetic_test_results WHERE id = ");
        qb.push_bind(id);

        let result = qb
            .build_query_as::<GeneticTestResultEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<GeneticTestResultEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM genetic_test_results WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY reported_date DESC");

        let items = qb
            .build_query_as::<GeneticTestResultEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_test_type(
        &self,
        patient_id: &str,
        test_type: &str,
    ) -> RepositoryResult<Vec<GeneticTestResultEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM genetic_test_results WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND test_type = ");
        qb.push_bind(test_type);
        qb.push(" ORDER BY reported_date DESC");

        let items = qb
            .build_query_as::<GeneticTestResultEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        result: GeneticTestResultEntity,
    ) -> RepositoryResult<GeneticTestResultEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE genetic_test_results SET ");
        qb.push("result_status = ").push_bind(&result.result_status);
        qb.push(", variants = ").push_bind(&result.variants);
        qb.push(", interpretation = ")
            .push_bind(&result.interpretation);
        qb.push(", clinical_significance = ")
            .push_bind(&result.clinical_significance);
        qb.push(", recommendations = ")
            .push_bind(&result.recommendations);
        qb.push(", follow_up_required = ")
            .push_bind(result.follow_up_required);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&result.id);
        qb.push(" RETURNING *");

        let entity = qb
            .build_query_as::<GeneticTestResultEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(entity)
    }

    async fn get_pathogenic(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<GeneticTestResultEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM genetic_test_results WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND clinical_significance IN ('pathogenic', 'likely_pathogenic') ORDER BY reported_date DESC");

        let items = qb
            .build_query_as::<GeneticTestResultEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}
