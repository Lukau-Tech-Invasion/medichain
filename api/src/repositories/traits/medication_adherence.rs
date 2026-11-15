//! Medication reminders and the adherence log.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{DateRange, PaginatedResult, Pagination, RepositoryResult};

/// Medication reminder entity (patient medication reminder schedules)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MedicationReminderEntity {
    pub id: String,
    pub patient_id: String,
    pub prescription_id: Option<String>,
    pub medication_name: String,
    pub dosage: Option<String>,
    pub scheduled_time: chrono::NaiveTime,
    pub days_of_week: serde_json::Value,
    pub reminder_type: String,
    pub is_active: bool,
    pub snooze_minutes: Option<i32>,
    pub max_snoozes: Option<i32>,
    pub escalation_contact: Option<String>,
    pub start_date: chrono::NaiveDate,
    pub end_date: Option<chrono::NaiveDate>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Extras packed by the legacy `MedicationReminder` model (reminder_times vec,
    /// frequency enum, created_by, notification_prefs). Memory backend round-trips
    /// this; Postgres backend does not persist it (no schema column).
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Adherence log entity (medication adherence tracking)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AdherenceLogEntity {
    pub id: String,
    pub patient_id: String,
    pub reminder_id: Option<String>,
    pub prescription_id: Option<String>,
    pub medication_name: String,
    pub scheduled_time: DateTime<Utc>,
    pub action_taken: String,
    pub actual_time: Option<DateTime<Utc>>,
    pub reported_by: Option<String>,
    pub skip_reason: Option<String>,
    pub side_effects_reported: Option<serde_json::Value>,
    pub notes: Option<String>,
    pub device_id: Option<String>,
    pub location: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

/// Medication reminder repository trait
#[async_trait]
pub trait MedicationReminderRepository: Send + Sync + fmt::Debug {
    async fn create(
        &self,
        reminder: MedicationReminderEntity,
    ) -> RepositoryResult<MedicationReminderEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<MedicationReminderEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<MedicationReminderEntity>>;
    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<MedicationReminderEntity>>;
    async fn update(
        &self,
        reminder: MedicationReminderEntity,
    ) -> RepositoryResult<MedicationReminderEntity>;
    async fn deactivate(&self, id: &str) -> RepositoryResult<()>;
    /// Return all active reminders across all patients. Used by the background
    /// notification dispatcher to scan for due times. Default implementation returns
    /// an error so backends opt-in by overriding.
    async fn list_all_active(&self) -> RepositoryResult<Vec<MedicationReminderEntity>>;
}

/// Adherence log repository trait
#[async_trait]
pub trait AdherenceLogRepository: Send + Sync + fmt::Debug {
    async fn create(&self, log: AdherenceLogEntity) -> RepositoryResult<AdherenceLogEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<AdherenceLogEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        date_range: Option<DateRange>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AdherenceLogEntity>>;
    async fn get_by_reminder(
        &self,
        reminder_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AdherenceLogEntity>>;
    async fn get_adherence_rate(
        &self,
        patient_id: &str,
        medication_name: &str,
        days: i32,
    ) -> RepositoryResult<f64>;
}
