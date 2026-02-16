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
                copay_amount, deductible_amount, deductible_met,
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

    // TODO: Move these extension methods outside trait impl block
    // async fn set_primary(...)
    // async fn terminate(...)
}

// =============================================================================
// BILLING CODE REPOSITORY
// =============================================================================

/// PostgreSQL-backed billing code repository
#[derive(Debug, Clone)]
pub struct PgBillingCodeRepository {
    pool: PgPool,
}

impl PgBillingCodeRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl BillingCodeRepository for PgBillingCodeRepository {
    async fn create(&self, code: BillingCodeEntity) -> RepositoryResult<BillingCodeEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO billing_codes (
                id, code_type, code, description, short_description,
                category, subcategory, effective_date, termination_date,
                is_active, billable, requires_modifier, common_modifiers,
                relative_value_units, global_period_days, age_restrictions,
                gender_restrictions, place_of_service_restrictions,
                requires_prior_auth, typical_duration_minutes, add_on_code,
                parent_code, laterality_applicable, notes, last_updated_by
            ) ",
        );

        qb.push_values([&code], |mut b, c| {
            b.push_bind(&c.id)
                .push_bind(&c.code_type)
                .push_bind(&c.code)
                .push_bind(&c.description)
                .push_bind(&c.short_description)
                .push_bind(&c.category)
                .push_bind(&c.subcategory)
                .push_bind(c.effective_date)
                .push_bind(c.termination_date)
                .push_bind(c.is_active)
                .push_bind(c.billable)
                .push_bind(c.requires_modifier)
                .push_bind(&c.common_modifiers)
                .push_bind(c.relative_value_units)
                .push_bind(c.global_period_days)
                .push_bind(&c.age_restrictions)
                .push_bind(&c.gender_restrictions)
                .push_bind(&c.place_of_service_restrictions)
                .push_bind(c.requires_prior_auth)
                .push_bind(c.typical_duration_minutes)
                .push_bind(c.add_on_code)
                .push_bind(&c.parent_code)
                .push_bind(c.laterality_applicable)
                .push_bind(&c.notes)
                .push_bind(&c.last_updated_by);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<BillingCodeEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<BillingCodeEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM billing_codes WHERE id = ");
        qb.push_bind(id);

        let code = qb
            .build_query_as::<BillingCodeEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(code)
    }

    async fn get_by_code(
        &self,
        code_type: &str,
        code: &str,
    ) -> RepositoryResult<Option<BillingCodeEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM billing_codes WHERE code_type = ");
        qb.push_bind(code_type);
        qb.push(" AND code = ");
        qb.push_bind(code);
        qb.push(" AND is_active = true LIMIT 1");

        let result = qb
            .build_query_as::<BillingCodeEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(result)
    }

    async fn search(
        &self,
        query: &str,
        code_type: Option<&str>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BillingCodeEntity>> {
        let search_pattern = format!("%{}%", query.to_lowercase());

        // Count query
        let mut count_qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT COUNT(*) FROM billing_codes WHERE is_active = true AND (LOWER(code) LIKE ",
        );
        count_qb.push_bind(&search_pattern);
        count_qb.push(" OR LOWER(description) LIKE ");
        count_qb.push_bind(&search_pattern);
        count_qb.push(")");
        if let Some(ct) = code_type {
            count_qb.push(" AND code_type = ");
            count_qb.push_bind(ct);
        }

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        // Data query
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM billing_codes WHERE is_active = true AND (LOWER(code) LIKE ",
        );
        qb.push_bind(&search_pattern);
        qb.push(" OR LOWER(description) LIKE ");
        qb.push_bind(&search_pattern);
        qb.push(")");
        if let Some(ct) = code_type {
            qb.push(" AND code_type = ");
            qb.push_bind(ct);
        }
        qb.push(" ORDER BY code LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<BillingCodeEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_category(&self, category: &str) -> RepositoryResult<Vec<BillingCodeEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM billing_codes WHERE category = ");
        qb.push_bind(category);
        qb.push(" AND is_active = true ORDER BY code");

        let items = qb
            .build_query_as::<BillingCodeEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(&self, code: BillingCodeEntity) -> RepositoryResult<BillingCodeEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE billing_codes SET ");
        qb.push("description = ").push_bind(&code.description);
        qb.push(", short_description = ")
            .push_bind(&code.short_description);
        qb.push(", category = ").push_bind(&code.category);
        qb.push(", subcategory = ").push_bind(&code.subcategory);
        qb.push(", is_active = ").push_bind(code.is_active);
        qb.push(", termination_date = ")
            .push_bind(code.termination_date);
        qb.push(", common_modifiers = ")
            .push_bind(&code.common_modifiers);
        qb.push(", relative_value_units = ")
            .push_bind(code.relative_value_units);
        qb.push(", requires_prior_auth = ")
            .push_bind(code.requires_prior_auth);
        qb.push(", notes = ").push_bind(&code.notes);
        qb.push(", last_updated_by = ")
            .push_bind(&code.last_updated_by);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&code.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<BillingCodeEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<BillingCodeEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE billing_codes SET is_active = false, updated_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<BillingCodeEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn list_by_type(
        &self,
        code_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BillingCodeEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM billing_codes WHERE code_type = ");
        count_qb.push_bind(code_type);
        count_qb.push(" AND is_active = true");

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM billing_codes WHERE code_type = ");
        qb.push_bind(code_type);
        qb.push(" AND is_active = true ORDER BY code LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<BillingCodeEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }
}
