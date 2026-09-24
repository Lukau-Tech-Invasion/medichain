//! PostgreSQL implementations for Phase 10 Insurance & Billing repositories.
//!
//! Uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// INSURANCE RECORD REPOSITORY
// =============================================================================

/// PostgreSQL-backed insurance record repository
#[derive(Debug, Clone)]
pub struct PgInsuranceRecordRepository {
    pool: PgPool,
}

impl PgInsuranceRecordRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl InsuranceRecordRepository for PgInsuranceRecordRepository {
    async fn create(
        &self,
        record: InsuranceRecordEntity,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO insurance_records (
                id, patient_id, insurance_type, payer_name, payer_id,
                plan_name, plan_type, policy_number, group_number,
                subscriber_id, subscriber_name, subscriber_relationship, subscriber_dob,
                effective_date, termination_date, is_active,
                copay_amount, currency, deductible_amount, deductible_met,
                out_of_pocket_max, out_of_pocket_met, coinsurance_percent,
                coverage_details, prior_auth_required,
                prior_auth_phone, claims_address, claims_phone, claims_fax,
                electronic_claims_eligible, verification_status,
                last_verified_date, last_verified_by, verification_notes,
                card_front_image_url, card_back_image_url, notes
            ) ",
        );

        qb.push_values([&record], |mut b, r| {
            b.push_bind(&r.id)
                .push_bind(&r.patient_id)
                .push_bind(&r.insurance_type)
                .push_bind(&r.payer_name)
                .push_bind(&r.payer_id)
                .push_bind(&r.plan_name)
                .push_bind(&r.plan_type)
                .push_bind(&r.policy_number)
                .push_bind(&r.group_number)
                .push_bind(&r.subscriber_id)
                .push_bind(&r.subscriber_name)
                .push_bind(&r.subscriber_relationship)
                .push_bind(r.subscriber_dob)
                .push_bind(r.effective_date)
                .push_bind(r.termination_date)
                .push_bind(r.is_active)
                .push_bind(r.copay_amount)
                .push_bind(&r.currency)
                .push_bind(r.deductible_amount)
                .push_bind(r.deductible_met)
                .push_bind(r.out_of_pocket_max)
                .push_bind(r.out_of_pocket_met)
                .push_bind(r.coinsurance_percent)
                .push_bind(&r.coverage_details)
                .push_bind(r.prior_auth_required)
                .push_bind(&r.prior_auth_phone)
                .push_bind(&r.claims_address)
                .push_bind(&r.claims_phone)
                .push_bind(&r.claims_fax)
                .push_bind(r.electronic_claims_eligible)
                .push_bind(&r.verification_status)
                .push_bind(r.last_verified_date)
                .push_bind(&r.last_verified_by)
                .push_bind(&r.verification_notes)
                .push_bind(&r.card_front_image_url)
                .push_bind(&r.card_back_image_url)
                .push_bind(&r.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<InsuranceRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<InsuranceRecordEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM insurance_records WHERE id = ");
        qb.push_bind(id);

        let record = qb
            .build_query_as::<InsuranceRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<InsuranceRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM insurance_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY effective_date DESC");

        let items = qb
            .build_query_as::<InsuranceRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_primary(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<InsuranceRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM insurance_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND insurance_type = 'primary' AND is_active = true LIMIT 1");

        let record = qb
            .build_query_as::<InsuranceRecordEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(record)
    }

    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<InsuranceRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM insurance_records WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true ORDER BY effective_date DESC");

        let items = qb
            .build_query_as::<InsuranceRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        record: InsuranceRecordEntity,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE insurance_records SET ");
        qb.push("plan_name = ").push_bind(&record.plan_name);
        qb.push(", policy_number = ")
            .push_bind(&record.policy_number);
        qb.push(", group_number = ").push_bind(&record.group_number);
        qb.push(", effective_date = ")
            .push_bind(record.effective_date);
        qb.push(", termination_date = ")
            .push_bind(record.termination_date);
        qb.push(", is_active = ").push_bind(record.is_active);
        qb.push(", copay_amount = ").push_bind(record.copay_amount);
        qb.push(", currency = ").push_bind(&record.currency);
        qb.push(", deductible_amount = ")
            .push_bind(record.deductible_amount);
        qb.push(", deductible_met = ")
            .push_bind(record.deductible_met);
        qb.push(", out_of_pocket_max = ")
            .push_bind(record.out_of_pocket_max);
        qb.push(", out_of_pocket_met = ")
            .push_bind(record.out_of_pocket_met);
        qb.push(", verification_status = ")
            .push_bind(&record.verification_status);
        qb.push(", notes = ").push_bind(&record.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&record.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<InsuranceRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn verify_eligibility(
        &self,
        id: &str,
        verified_by: &str,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE insurance_records SET ");
        qb.push("verification_status = 'verified', last_verified_by = ")
            .push_bind(verified_by);
        qb.push(", last_verified_date = CURRENT_DATE, updated_at = NOW() WHERE id = ")
            .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<InsuranceRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<InsuranceRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE insurance_records SET is_active = false, updated_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<InsuranceRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_expiring(&self, days: i32) -> RepositoryResult<Vec<InsuranceRecordEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM insurance_records WHERE is_active = true AND termination_date IS NOT NULL AND termination_date <= (CURRENT_DATE + INTERVAL '",
        );
        qb.push(days.to_string());
        qb.push(" days') ORDER BY termination_date ASC");

        let items = qb
            .build_query_as::<InsuranceRecordEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn set_primary(&self, patient_id: &str, record_id: &str) -> RepositoryResult<()> {
        let mut tx = self.pool.begin().await?;

        // 1. Mark all other records for this patient as not primary
        sqlx::query(
            "UPDATE insurance_records SET insurance_type = 'secondary' 
             WHERE patient_id = $1 AND insurance_type = 'primary'",
        )
        .bind(patient_id)
        .execute(&mut *tx)
        .await?;

        // 2. Set the specified record as primary
        sqlx::query(
            "UPDATE insurance_records SET insurance_type = 'primary', is_active = true 
             WHERE id = $1 AND patient_id = $2",
        )
        .bind(record_id)
        .bind(patient_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    async fn terminate(
        &self,
        id: &str,
        termination_date: chrono::NaiveDate,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE insurance_records SET ");
        qb.push("is_active = false, termination_date = ")
            .push_bind(termination_date);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<InsuranceRecordEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// BILLING CODE REPOSITORY
// =============================================================================
