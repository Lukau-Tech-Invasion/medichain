//! Incident reports.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{DateRange, PaginatedResult, Pagination, RepositoryResult};

/// Incident Report entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct IncidentReportEntity {
    pub id: String,
    pub patient_id: Option<String>,
    pub reporter_id: String,
    pub incident_datetime: DateTime<Utc>,
    pub discovery_datetime: DateTime<Utc>,
    pub incident_type: String,
    pub severity: String,
    pub location: String,
    pub department: Option<String>,
    pub description: String,
    pub immediate_actions_taken: Option<String>,
    pub patient_outcome: Option<String>,
    pub patient_notified: bool,
    pub patient_notified_by: Option<String>,
    pub family_notified: bool,
    pub attending_notified: bool,
    pub supervisor_notified: bool,
    pub risk_management_notified: bool,
    pub witnesses: Option<serde_json::Value>,
    pub contributing_factors: Option<serde_json::Value>,
    pub root_cause: Option<String>,
    pub preventable: Option<bool>,
    pub similar_incidents_prior: bool,
    pub corrective_actions: Option<serde_json::Value>,
    pub follow_up_required: bool,
    pub follow_up_assigned_to: Option<String>,
    pub follow_up_due_date: Option<chrono::NaiveDate>,
    pub follow_up_completed: bool,
    pub follow_up_completed_at: Option<DateTime<Utc>>,
    pub investigation_status: Option<String>,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub review_comments: Option<String>,
    pub regulatory_reportable: bool,
    pub reported_to_agencies: Option<serde_json::Value>,
    pub confidential: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// The record as the form captured it.
    ///
    /// NOT `#[sqlx(skip)]`: `20260910000006` gave it a column. While it was
    /// skipped, PostgreSQL never selected or wrote it, so the blob was always
    /// `Value::Null` there and held the real content in memory — the same
    /// endpoint behaving one way in development and another against a database.
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Incident report repository trait
#[async_trait]
pub trait IncidentReportRepository: Send + Sync + fmt::Debug {
    async fn create(&self, report: IncidentReportEntity) -> RepositoryResult<IncidentReportEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<IncidentReportEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IncidentReportEntity>>;
    async fn update(&self, report: IncidentReportEntity) -> RepositoryResult<IncidentReportEntity>;
    async fn get_open_investigations(&self) -> RepositoryResult<Vec<IncidentReportEntity>>;
    async fn get_by_severity(&self, severity: &str) -> RepositoryResult<Vec<IncidentReportEntity>>;
    async fn get_by_type(
        &self,
        incident_type: &str,
        date_range: Option<DateRange>,
    ) -> RepositoryResult<Vec<IncidentReportEntity>>;
    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IncidentReportEntity>>;
}
