//! Vital signs.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{DateRange, PaginatedResult, Pagination, RepositoryResult};

/// Vital signs entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct VitalSignsEntity {
    pub id: String,
    pub patient_id: String,
    /// Entered observations, absent on readings created before note persistence.
    #[serde(default)]
    pub notes: Option<String>,
    pub heart_rate: Option<i32>,
    pub respiratory_rate: Option<i32>,
    pub blood_pressure_systolic: Option<i32>,
    pub blood_pressure_diastolic: Option<i32>,
    pub mean_arterial_pressure: Option<i32>,
    pub temperature: Option<f64>,
    pub temperature_site: Option<String>,
    pub oxygen_saturation: Option<i32>,
    pub oxygen_delivery: Option<String>,
    pub fio2: Option<i32>,
    pub pain_scale: Option<i32>,
    pub gcs_score: Option<i32>,
    pub gcs_eye: Option<i32>,
    pub gcs_verbal: Option<i32>,
    pub gcs_motor: Option<i32>,
    /// mmol/L.
    pub blood_glucose: Option<f64>,
    pub weight_kg: Option<f64>,
    pub height_cm: Option<f64>,
    pub bmi: Option<f64>,
    pub position: Option<String>,
    pub activity_level: Option<String>,
    pub is_critical: bool,
    pub critical_values: Option<serde_json::Value>,
    pub recorded_at: DateTime<Utc>,
    pub recorded_by: String,
    pub facility_id: Option<String>,
    pub created_at: DateTime<Utc>,
    /// ACVPU (`clinical_scoring::Acvpu::as_str`); absent on older readings.
    #[serde(default)]
    #[sqlx(default)]
    pub consciousness: Option<String>,
}

/// Vital signs repository trait
#[async_trait]
pub trait VitalSignsRepository: Send + Sync + fmt::Debug {
    /// Create new vital signs record
    async fn create(&self, vitals: VitalSignsEntity) -> RepositoryResult<VitalSignsEntity>;

    /// Get vitals by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<VitalSignsEntity>;

    /// Get latest vitals for a patient
    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<VitalSignsEntity>>;

    /// Get vitals history for a patient
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<VitalSignsEntity>>;

    /// Get vitals within date range
    async fn get_by_date_range(
        &self,
        patient_id: &str,
        range: DateRange,
    ) -> RepositoryResult<Vec<VitalSignsEntity>>;

    /// Get critical vitals (last 24 hours)
    async fn get_critical(&self) -> RepositoryResult<Vec<VitalSignsEntity>>;
}
