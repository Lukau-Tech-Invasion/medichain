//! Emergency medical services: handoffs, mass-casualty records, chain of custody.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{PaginatedResult, Pagination, RepositoryResult};

/// EMS Handoff entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct EmsHandoffEntity {
    pub id: String,
    pub patient_id: Option<String>,
    pub receiving_provider_id: String,
    pub handoff_datetime: DateTime<Utc>,
    pub ems_agency: String,
    pub ems_unit_number: Option<String>,
    pub crew_members: serde_json::Value,
    pub run_number: Option<String>,
    pub dispatch_time: Option<DateTime<Utc>>,
    pub on_scene_time: Option<DateTime<Utc>>,
    pub transport_start_time: Option<DateTime<Utc>>,
    pub arrival_time: DateTime<Utc>,
    pub scene_address: Option<String>,
    pub incident_type: Option<String>,
    pub chief_complaint: String,
    pub mechanism_of_injury: Option<String>,
    pub patient_found: Option<String>,
    pub mental_status_on_scene: Option<String>,
    pub gcs_on_scene: Option<i32>,
    pub vital_signs_on_scene: Option<serde_json::Value>,
    pub vital_signs_transport: Option<serde_json::Value>,
    pub vital_signs_arrival: Option<serde_json::Value>,
    pub interventions_performed: Option<serde_json::Value>,
    pub medications_given: Option<serde_json::Value>,
    pub iv_access_obtained: bool,
    pub iv_details: Option<serde_json::Value>,
    pub airway_management: Option<String>,
    pub cpr_performed: bool,
    pub aed_used: bool,
    pub shocks_delivered: Option<i32>,
    pub spinal_immobilization: bool,
    pub splinting_performed: bool,
    pub tourniquet_applied: bool,
    pub bleeding_controlled: Option<bool>,
    pub patient_belongings: Option<serde_json::Value>,
    pub family_at_scene: bool,
    pub family_contact_info: Option<String>,
    pub police_at_scene: bool,
    pub police_report_number: Option<String>,
    pub trauma_alert: bool,
    pub stroke_alert: bool,
    pub stemi_alert: bool,
    pub sepsis_alert: bool,
    pub report_received_by: Option<String>,
    pub report_received_time: Option<DateTime<Utc>>,
    pub verbal_report_complete: bool,
    pub ems_documentation_received: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// The record as the form captured it.
    ///
    /// NOT `#[sqlx(skip)]`: `20260911000001` gave it a column, and the
    /// insert binds it. While it was skipped, PostgreSQL never selected or
    /// wrote this field, so the blob was permanently `Value::Null` there while
    /// holding the whole record in memory — the same endpoint behaving one way
    /// in development and another against a database, with nothing in the
    /// response to say which.
    #[serde(default)]
    pub data: serde_json::Value,
}

/// MCI Record entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct MciRecordEntity {
    pub id: String,
    pub incident_id: String,
    pub incident_name: String,
    pub incident_datetime: DateTime<Utc>,
    pub incident_location: String,
    pub incident_type: String,
    pub activation_level: String,
    pub incident_commander: Option<String>,
    pub medical_branch_director: Option<String>,
    pub hospital_incident_command_activated: bool,
    pub patient_id: Option<String>,
    pub triage_tag_number: Option<String>,
    pub triage_category: String,
    pub start_triage_category: Option<String>,
    pub arrival_datetime: Option<DateTime<Utc>>,
    pub arrival_mode: Option<String>,
    pub ems_agency: Option<String>,
    pub treatment_area: Option<String>,
    pub injuries: Option<serde_json::Value>,
    pub mechanism_of_injury: Option<String>,
    pub decontamination_required: bool,
    pub decontamination_completed: bool,
    pub treatments_provided: Option<serde_json::Value>,
    pub disposition: Option<String>,
    pub disposition_datetime: Option<DateTime<Utc>>,
    pub destination: Option<String>,
    pub family_notified: bool,
    pub family_reunification_completed: bool,
    pub patient_tracking_updated: bool,
    pub media_release_authorized: bool,
    pub special_circumstances: Option<String>,
    pub created_by: String,
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

/// Chain of Custody entity
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct ChainOfCustodyEntity {
    pub id: String,
    pub patient_id: Option<String>,
    pub case_number: Option<String>,
    pub evidence_type: String,
    pub evidence_description: String,
    pub quantity: i32,
    pub unit_of_measure: Option<String>,
    pub collection_datetime: DateTime<Utc>,
    pub collection_location: Option<String>,
    pub collected_by: String,
    pub collection_witnessed_by: Option<String>,
    pub collection_method: Option<String>,
    pub packaging_description: Option<String>,
    pub seal_number: Option<String>,
    pub storage_location: Option<String>,
    pub storage_requirements: Option<String>,
    pub current_custodian_id: String,
    pub transfers: serde_json::Value,
    pub law_enforcement_agency: Option<String>,
    pub law_enforcement_officer: Option<String>,
    pub law_enforcement_badge: Option<String>,
    pub warrant_number: Option<String>,
    pub court_order_number: Option<String>,
    pub released_to: Option<String>,
    pub release_datetime: Option<DateTime<Utc>>,
    pub release_authorized_by: Option<String>,
    pub release_documentation: Option<String>,
    pub destruction_authorized: bool,
    pub destruction_datetime: Option<DateTime<Utc>>,
    pub destruction_method: Option<String>,
    pub destruction_witnessed_by: Option<String>,
    pub status: String,
    pub photos_taken: bool,
    pub photo_references: Option<serde_json::Value>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// The record as the form captured it.
    ///
    /// NOT `#[sqlx(skip)]`: `20260911000001` gave it a column, and the
    /// insert binds it. While it was skipped, PostgreSQL never selected or
    /// wrote this field, so the blob was permanently `Value::Null` there while
    /// holding the whole record in memory — the same endpoint behaving one way
    /// in development and another against a database, with nothing in the
    /// response to say which.
    #[serde(default)]
    pub data: serde_json::Value,
}

/// EMS handoff repository trait
#[async_trait]
pub trait EmsHandoffRepository: Send + Sync + fmt::Debug {
    async fn create(&self, handoff: EmsHandoffEntity) -> RepositoryResult<EmsHandoffEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<EmsHandoffEntity>;
    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EmsHandoffEntity>>;
    async fn update(&self, handoff: EmsHandoffEntity) -> RepositoryResult<EmsHandoffEntity>;
    async fn get_recent(&self, hours: i32) -> RepositoryResult<Vec<EmsHandoffEntity>>;
    async fn get_alerts(&self) -> RepositoryResult<Vec<EmsHandoffEntity>>;
}

/// MCI record repository trait
#[async_trait]
pub trait MciRecordRepository: Send + Sync + fmt::Debug {
    async fn create(&self, record: MciRecordEntity) -> RepositoryResult<MciRecordEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<MciRecordEntity>;
    async fn get_by_incident(&self, incident_id: &str) -> RepositoryResult<Vec<MciRecordEntity>>;
    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<MciRecordEntity>>;
    async fn update(&self, record: MciRecordEntity) -> RepositoryResult<MciRecordEntity>;
    async fn get_active_incidents(&self) -> RepositoryResult<Vec<MciRecordEntity>>;
    async fn get_by_triage_category(
        &self,
        incident_id: &str,
        category: &str,
    ) -> RepositoryResult<Vec<MciRecordEntity>>;
}

/// Chain of custody repository trait
/// One hand-over in a chain of custody.
#[derive(Debug, Clone)]
pub struct CustodyTransfer {
    pub new_custodian: String,
    pub location: String,
    /// The custody-status column after the hand-over.
    pub status: String,
    /// The entry appended to `transfers`.
    pub entry: serde_json::Value,
    /// The whole record document after the hand-over.
    pub data: serde_json::Value,
}

#[async_trait]
pub trait ChainOfCustodyRepository: Send + Sync + fmt::Debug {
    async fn create(&self, record: ChainOfCustodyEntity) -> RepositoryResult<ChainOfCustodyEntity>;
    async fn get_by_id(&self, id: &str) -> RepositoryResult<ChainOfCustodyEntity>;
    async fn get_by_patient(&self, patient_id: &str)
        -> RepositoryResult<Vec<ChainOfCustodyEntity>>;
    async fn get_by_case(&self, case_number: &str) -> RepositoryResult<Vec<ChainOfCustodyEntity>>;
    async fn update(&self, record: ChainOfCustodyEntity) -> RepositoryResult<ChainOfCustodyEntity>;
    /// Record a hand-over, conditional on the record being unchanged since
    /// `expected_updated_at`; `Ok(None)` means somebody else wrote first.
    ///
    /// The unconditional version this replaces read the transfer list and wrote
    /// it back in two statements, so two simultaneous hand-overs kept one --
    /// a gap in a chain of custody is what a court challenge points at.
    async fn transfer(
        &self,
        id: &str,
        expected_updated_at: DateTime<Utc>,
        transfer: CustodyTransfer,
    ) -> RepositoryResult<Option<ChainOfCustodyEntity>>;
    async fn get_by_custodian(
        &self,
        custodian_id: &str,
    ) -> RepositoryResult<Vec<ChainOfCustodyEntity>>;
    async fn list_all(&self) -> RepositoryResult<Vec<ChainOfCustodyEntity>>;
}
