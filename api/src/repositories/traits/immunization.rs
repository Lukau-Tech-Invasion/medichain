//! Immunization records.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::common::RepositoryResult;

/// Immunization record entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ImmunizationRecordEntity {
    pub id: String,
    pub patient_id: String,
    pub vaccine_type: String,
    pub vaccine_name: String,
    pub manufacturer: Option<String>,
    pub lot_number: Option<String>,
    pub ndc_code: Option<String>,
    pub cvx_code: Option<String>,
    pub mvx_code: Option<String>,
    pub administration_date: chrono::NaiveDate,
    pub administration_time: Option<chrono::NaiveTime>,
    pub administered_by: Option<String>,
    pub administered_by_name: Option<String>,
    pub administration_site: Option<String>,
    pub route: Option<String>,
    pub dose_amount: Option<String>,
    pub dose_unit: Option<String>,
    pub dose_number: Option<i32>,
    pub series_complete: Option<bool>,
    pub facility_id: Option<String>,
    pub facility_name: Option<String>,
    pub facility_address: Option<String>,
    pub vfc_eligibility: Option<String>,
    pub funding_source: Option<String>,
    pub information_source: Option<String>,
    pub documentation_type: Option<String>,
    pub reaction_observed: Option<bool>,
    pub reaction_details: Option<String>,
    pub contraindications_reviewed: Option<bool>,
    pub patient_consent: Option<bool>,
    pub vis_given: Option<bool>,
    pub vis_date: Option<chrono::NaiveDate>,
    pub notes: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Immunization record repository trait
#[async_trait]
pub trait ImmunizationRecordRepository: Send + Sync {
    async fn create(
        &self,
        record: ImmunizationRecordEntity,
    ) -> RepositoryResult<ImmunizationRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ImmunizationRecordEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>>;
    async fn get_by_vaccine_type(
        &self,
        patient_id: &str,
        vaccine_type: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>>;
    async fn update(
        &self,
        record: ImmunizationRecordEntity,
    ) -> RepositoryResult<ImmunizationRecordEntity>;
    async fn get_recent(
        &self,
        patient_id: &str,
        days: i32,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>>;
    async fn get_by_lot_number(
        &self,
        lot_number: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>>;
    /// Return every immunization record across all patients. Used by admin/list
    /// endpoints. Default returns NotFound so backends opt-in.
    async fn list_all(&self) -> RepositoryResult<Vec<ImmunizationRecordEntity>>;
}
