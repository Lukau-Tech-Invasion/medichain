//! Insurance records.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::RepositoryResult;

/// Default currency for monetary entities: ZAR (South African Rand).
/// Used by `#[serde(default = ...)]` so deserialized records without an explicit
/// currency fall back to the African denomination rather than implicit US dollars.
pub(crate) fn default_currency_zar() -> Option<String> {
    Some("ZAR".to_string())
}

/// Insurance record entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct InsuranceRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub insurance_type: String,
    pub payer_name: String,
    pub payer_id: Option<String>,
    pub plan_name: Option<String>,
    pub plan_type: Option<String>,
    pub policy_number: String,
    pub group_number: Option<String>,
    pub subscriber_id: String,
    pub subscriber_name: Option<String>,
    pub subscriber_relationship: Option<String>,
    pub subscriber_dob: Option<chrono::NaiveDate>,
    pub effective_date: chrono::NaiveDate,
    pub termination_date: Option<chrono::NaiveDate>,
    pub is_active: bool,
    pub copay_amount: Option<rust_decimal::Decimal>,
    /// ISO 4217 currency code for all monetary amounts on this record.
    /// Defaults to ZAR (South African Rand) — amounts are NOT US dollars.
    #[serde(default = "default_currency_zar")]
    pub currency: Option<String>,
    pub deductible_amount: Option<rust_decimal::Decimal>,
    pub deductible_met: Option<rust_decimal::Decimal>,
    pub out_of_pocket_max: Option<rust_decimal::Decimal>,
    pub out_of_pocket_met: Option<rust_decimal::Decimal>,
    pub coinsurance_percent: Option<rust_decimal::Decimal>,
    pub coverage_details: Option<serde_json::Value>,
    pub prior_auth_required: Option<bool>,
    pub prior_auth_phone: Option<String>,
    pub claims_address: Option<String>,
    pub claims_phone: Option<String>,
    pub claims_fax: Option<String>,
    pub electronic_claims_eligible: Option<bool>,
    pub verification_status: Option<String>,
    pub last_verified_date: Option<chrono::NaiveDate>,
    pub last_verified_by: Option<String>,
    pub verification_notes: Option<String>,
    pub card_front_image_url: Option<String>,
    pub card_back_image_url: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Insurance record repository trait
#[async_trait]
pub trait InsuranceRecordRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        record: InsuranceRecordEntity,
    ) -> RepositoryResult<InsuranceRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<InsuranceRecordEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<InsuranceRecordEntity>>;
    async fn update(
        &self,
        record: InsuranceRecordEntity,
    ) -> RepositoryResult<InsuranceRecordEntity>;
    /// Get active insurance by patient (default to get_by_patient filtered)
    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<InsuranceRecordEntity>> {
        // Default: use get_active if available
        self.get_active(patient_id).await
    }
    /// Verify insurance record
    async fn verify(
        &self,
        id: &str,
        verified_by: &str,
        _notes: Option<&str>,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        // Default: use verify_eligibility
        self.verify_eligibility(id, verified_by).await
    }
    /// Deactivate insurance record
    async fn deactivate(&self, id: &str) -> RepositoryResult<InsuranceRecordEntity>;
    /// Get insurance records expiring within days
    async fn get_expiring(&self, days: i32) -> RepositoryResult<Vec<InsuranceRecordEntity>>;
    /// Get primary insurance for a patient
    async fn get_primary(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<InsuranceRecordEntity>>;
    /// Get all active insurance records for a patient
    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<InsuranceRecordEntity>>;
    /// Verify eligibility for an insurance record
    async fn verify_eligibility(
        &self,
        id: &str,
        verified_by: &str,
    ) -> RepositoryResult<InsuranceRecordEntity>;

    /// Designate an insurance record as primary for the patient
    async fn set_primary(&self, patient_id: &str, record_id: &str) -> RepositoryResult<()>;

    /// Terminate an insurance record (mark inactive and set termination date)
    async fn terminate(
        &self,
        id: &str,
        termination_date: chrono::NaiveDate,
    ) -> RepositoryResult<InsuranceRecordEntity>;
}
