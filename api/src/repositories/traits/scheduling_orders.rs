//! Appointments and physician orders.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{PaginatedResult, Pagination, RepositoryError, RepositoryResult};

/// Appointment entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct AppointmentEntity {
    pub id: String,
    pub patient_id: String,
    pub provider_id: String,
    pub appointment_type: String,
    pub scheduled_datetime: DateTime<Utc>,
    pub duration_minutes: i32,
    pub status: String,
    pub location: Option<String>,
    pub room: Option<String>,
    pub reason_for_visit: Option<String>,
    pub visit_type: Option<String>,
    pub priority: Option<String>,
    pub recurring: bool,
    pub recurrence_pattern: Option<String>,
    pub parent_appointment_id: Option<String>,
    pub insurance_verified: bool,
    pub copay_amount: Option<rust_decimal::Decimal>,
    pub copay_collected: bool,
    pub reminder_sent: bool,
    pub reminder_sent_at: Option<DateTime<Utc>>,
    pub check_in_time: Option<DateTime<Utc>>,
    pub check_out_time: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancellation_reason: Option<String>,
    pub cancelled_by: Option<String>,
    pub notes: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Physician Order entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct PhysicianOrderEntity {
    pub id: String,
    pub patient_id: String,
    pub ordering_provider_id: String,
    pub order_datetime: DateTime<Utc>,
    pub order_type: String,
    pub priority: String,
    pub status: String,
    pub order_details: serde_json::Value,
    pub indication: Option<String>,
    pub diagnosis_codes: Option<serde_json::Value>,
    pub start_datetime: Option<DateTime<Utc>>,
    pub end_datetime: Option<DateTime<Utc>>,
    pub frequency: Option<String>,
    pub duration: Option<String>,
    pub special_instructions: Option<String>,
    pub requires_cosign: bool,
    pub cosigned_by: Option<String>,
    pub cosigned_at: Option<DateTime<Utc>>,
    pub verified_by: Option<String>,
    pub verified_at: Option<DateTime<Utc>>,
    pub executed_by: Option<String>,
    pub executed_at: Option<DateTime<Utc>>,
    pub discontinued_by: Option<String>,
    pub discontinued_at: Option<DateTime<Utc>>,
    pub discontinue_reason: Option<String>,
    pub linked_order_id: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// The order as the ordering screen composed it.
    ///
    /// NOT `#[sqlx(skip)]` any more: `20260910000005` gave it a column. While it
    /// was skipped, `update` bound a column that did not exist, so every status
    /// change on an order was a 500 on PostgreSQL.
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Appointment repository trait
#[async_trait]
pub trait AppointmentRepository: Send + Sync + fmt::Debug {
    async fn create(&self, appointment: AppointmentEntity) -> RepositoryResult<AppointmentEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<AppointmentEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>>;
    async fn get_by_provider(
        &self,
        provider_id: &str,
        date: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<AppointmentEntity>>;
    async fn update(&self, appointment: AppointmentEntity) -> RepositoryResult<AppointmentEntity>;
    async fn cancel(
        &self,
        id: &str,
        reason: &str,
        cancelled_by: &str,
    ) -> RepositoryResult<AppointmentEntity>;
    async fn get_by_status(
        &self,
        status: &str,
        date: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<AppointmentEntity>>;
    /// List all appointments with pagination (for analytics views)
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>> {
        let _ = pagination;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Get all appointments for a provider (no date filter), paginated
    async fn get_by_provider_all(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AppointmentEntity>> {
        let _ = (provider_id, pagination);
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
}

/// Physician order repository trait
#[async_trait]
pub trait PhysicianOrderRepository: Send + Sync + fmt::Debug {
    async fn create(&self, order: PhysicianOrderEntity) -> RepositoryResult<PhysicianOrderEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<PhysicianOrderEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PhysicianOrderEntity>>;
    async fn update(&self, order: PhysicianOrderEntity) -> RepositoryResult<PhysicianOrderEntity>;
    async fn get_pending_orders(&self) -> RepositoryResult<Vec<PhysicianOrderEntity>>;
    async fn get_by_type(
        &self,
        order_type: &str,
        patient_id: &str,
    ) -> RepositoryResult<Vec<PhysicianOrderEntity>>;
    async fn discontinue(
        &self,
        id: &str,
        reason: &str,
        discontinued_by: &str,
    ) -> RepositoryResult<PhysicianOrderEntity>;
}
