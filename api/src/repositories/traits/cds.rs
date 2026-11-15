//! Clinical decision support alerts.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{PaginatedResult, Pagination, RepositoryError, RepositoryResult};

/// CDS alert entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct CdsAlertEntity {
    pub id: String,
    pub patient_id: String,
    pub encounter_id: Option<String>,
    pub provider_id: String,
    pub alert_datetime: DateTime<Utc>,
    pub alert_type: String,
    pub alert_category: String,
    pub severity: String,
    pub alert_title: String,
    pub alert_message: String,
    pub clinical_evidence: Option<String>,
    pub recommendation: Option<String>,
    pub source_system: Option<String>,
    pub rule_id: Option<String>,
    pub rule_version: Option<String>,
    pub trigger_data: Option<serde_json::Value>,
    pub related_order_id: Option<String>,
    pub related_medication_id: Option<String>,
    pub related_lab_id: Option<String>,
    pub status: String,
    pub acknowledged_by: Option<String>,
    pub acknowledged_datetime: Option<DateTime<Utc>>,
    pub override_reason: Option<String>,
    pub override_justification: Option<String>,
    pub action_taken: Option<String>,
    pub action_datetime: Option<DateTime<Utc>>,
    pub auto_resolved: Option<bool>,
    pub resolution_reason: Option<String>,
    pub was_helpful: Option<bool>,
    pub feedback_notes: Option<String>,
    pub displayed_duration_seconds: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// CDS alert repository trait
#[async_trait]
pub trait CdsAlertRepository: Send + Sync + fmt::Debug {
    async fn create(&self, alert: CdsAlertEntity) -> RepositoryResult<CdsAlertEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<CdsAlertEntity>;
    /// Total alerts, and how many are critical severity, for the quality
    /// dashboard. Returned together so the two numbers cannot disagree.
    async fn count_by_severity(&self) -> RepositoryResult<(u64, u64)>;
    /// Replace an existing alert in its entirety (used to round-trip response payloads
    /// the narrower acknowledge/override_alert methods can't capture).
    async fn update(&self, alert: CdsAlertEntity) -> RepositoryResult<CdsAlertEntity> {
        let _ = alert;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Get alerts by patient with optional active_only filter
    async fn get_by_patient(
        &self,
        patient_id: &str,
        active_only: bool,
    ) -> RepositoryResult<Vec<CdsAlertEntity>>;
    /// Acknowledge an alert with optional reason
    async fn acknowledge(
        &self,
        id: &str,
        by: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<CdsAlertEntity>;
    /// Override an alert with reason
    async fn override_alert(
        &self,
        id: &str,
        by: &str,
        reason: &str,
    ) -> RepositoryResult<CdsAlertEntity>;
    /// Get alerts by encounter ID
    async fn get_by_encounter(&self, encounter_id: &str) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let _ = encounter_id;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Get unacknowledged alerts, optionally filtered by patient
    async fn get_unacknowledged(
        &self,
        patient_id: Option<&str>,
    ) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let _ = patient_id;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Dismiss an alert
    async fn dismiss(&self, id: &str) -> RepositoryResult<CdsAlertEntity> {
        let _ = id;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Get alerts by rule ID with pagination
    async fn get_by_rule(
        &self,
        rule_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CdsAlertEntity>> {
        let _ = (rule_id, pagination);
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// Get high severity alerts
    async fn get_high_severity(&self) -> RepositoryResult<Vec<CdsAlertEntity>> {
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
    /// List all alerts with pagination (for admin/analytics views)
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CdsAlertEntity>> {
        let _ = pagination;
        Err(RepositoryError::NotFound("Not implemented".to_string()))
    }
}
