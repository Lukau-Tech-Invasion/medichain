//! Application state (`AppState`) and its construction/loaders.
//!
//! Split out of `main.rs` (Phase 10.2). Re-exported at the crate root.

use crate::clinical::*;
use crate::ipfs::{IpfsClient, MedicalRecordReference};
use crate::nfc_simulator::CardRegistry;
use crate::repositories::*;
use crate::support::*;
use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

// ============================================================================
// Application State
// ============================================================================

pub struct AppState {
    /// PostgreSQL connection pool (optional - for persistent demo users)
    pub db_pool: Option<sqlx::PgPool>,
    /// Repository container for database abstraction layer
    /// Provides access to PatientRepository, AllergyRepository, etc.
    /// Uses memory backend by default, PostgreSQL when MEDICHAIN_STORAGE=postgres
    pub repositories: RepositoryContainer,
    pub nfc_tags: RwLock<HashMap<String, NfcTagData>>,
    pub access_logs: RwLock<Vec<AccessLogEntry>>,
    pub users: RwLock<HashMap<String, User>>,
    /// Medical record references (patient_id -> list of record refs)
    pub medical_records: RwLock<HashMap<String, Vec<MedicalRecordReference>>>,
    /// Lab result submissions pending approval (submission_id -> submission)
    pub lab_submissions: RwLock<HashMap<String, LabResultSubmission>>,
    /// IPFS client for encrypted document storage
    pub ipfs_client: IpfsClient,
    /// Substrate blockchain client (None if SUBSTRATE_WS_URL not set)
    pub substrate_client: Option<std::sync::Arc<crate::blockchain::SubstrateClient>>,
    /// WebSocket/SSE session manager for push notifications
    pub ws_manager: crate::websocket::WsSessionManager,
    /// Encryption key for medical records — the *current* version's key, for callers
    /// that don't need version-aware decryption (IPFS content, MFA secrets, etc.).
    /// Sourced from `encryption_keyring`'s current version, so it persists across
    /// restarts rather than being freshly randomized every process start.
    pub encryption_key: medichain_crypto::EncryptionKey,
    /// Versioned keyring backing `encryption_key` (Phase 6.3 — key rotation). New
    /// patient-PHI writes stamp `keyring.current_version()`; reads decrypt with
    /// whichever version the row was originally encrypted under.
    pub encryption_keyring: std::sync::Arc<crate::encryption_keyring::EncryptionKeyring>,
    /// Security subsystem: MFA enrollments + breach/anomaly detection state (Phase 11.3/11.4)
    pub security: crate::security::SecurityState,
    /// Phase 1 compatibility bridge for explicit professional/patient contexts.
    pub identity_contexts: crate::federation_identity::IdentityContextStore,
    /// Phase 2 public organisation-key directory; never contains private keys.
    pub organization_keys: crate::organization_keys::OrganizationKeyRegistry,
    /// Phase 4 device lifecycle; separate from clinician identities and NFC cards.
    pub device_lifecycle: crate::device_lifecycle::DeviceLifecycleStore,
    /// Phase 5 server-side grants; expires independently of any frontend timer.
    pub emergency_grants: crate::emergency_grants::EmergencyGrantStore,
    /// Patient-controlled standing access: provider requests + patient-approved
    /// grants backing the Consent Management page (consent-based, revocable —
    /// the counterpart to the break-glass `emergency_grants`).
    pub patient_access: crate::patient_access::PatientAccessService,
    /// Phase 6 patient-owned mobile devices and ciphertext access capabilities.
    pub mobile_records: crate::mobile_records::MobileRecordStore,
    /// One-time emergency-token JTIs retained until their expiry.
    pub used_emergency_tokens: RwLock<HashMap<String, i64>>,
    /// Phase 7 policy metadata for sensitive telehealth artifact retention.
    pub telehealth_retention: crate::telehealth_retention::TelehealthRetentionStore,
    /// Phase 8 local audit events for retryable chain anchoring and governance.
    pub audit_outbox: crate::audit_outbox::AuditOutbox,
    /// NFC Card registry for demo
    pub card_registry: CardRegistry,
    // ============================================================================
    // Clinical Documentation Storage (Phase 1)
    // ============================================================================
    /// Triage assessments (assessment_id -> TriageAssessment)
    pub triage_assessments: RwLock<HashMap<String, TriageAssessment>>,
    /// SOAP notes (note_id -> SOAPNote)
    pub soap_notes: RwLock<HashMap<String, SOAPNote>>,
    /// Glasgow Coma Scale assessments (assessment_id -> GlasgowComaScale)
    pub gcs_assessments: RwLock<HashMap<String, GlasgowComaScale>>,
    /// Vital signs flowsheets (patient_id -> VitalSignsFlowsheet)
    pub vital_signs: RwLock<HashMap<String, VitalSignsFlowsheet>>,
    /// EMS handoff reports (report_id -> EMSHandoff)
    pub ems_handoffs: RwLock<HashMap<String, EMSHandoff>>,
    /// Medication Administration Records (patient_id+date -> MAR)
    pub medication_records: RwLock<HashMap<String, MedicationAdministrationRecord>>,
    /// Intake/Output records (patient_id+date+shift -> IntakeOutputRecord)
    pub io_records: RwLock<HashMap<String, IntakeOutputRecord>>,
    /// Nursing care plans (care_plan_id -> NursingCarePlan)
    pub nursing_care_plans: RwLock<HashMap<String, NursingCarePlan>>,
    /// Wound assessments (assessment_id -> WoundAssessment)
    pub wound_assessments: RwLock<HashMap<String, WoundAssessment>>,
    /// IV site assessments (assessment_id -> IVSiteAssessment)
    pub iv_assessments: RwLock<HashMap<String, IVSiteAssessment>>,
    /// Shift handoffs (handoff_id -> ShiftHandoff)
    pub shift_handoffs: RwLock<HashMap<String, ShiftHandoff>>,
    /// Incident reports (report_id -> IncidentReport)
    pub incident_reports: RwLock<HashMap<String, IncidentReport>>,
    /// Fall risk assessments (assessment_id -> FallRiskAssessment)
    pub fall_risk_assessments: RwLock<HashMap<String, FallRiskAssessment>>,
    /// Burn assessments (assessment_id -> BurnAssessment)
    pub burn_assessments: RwLock<HashMap<String, BurnAssessment>>,
    /// Mass casualty incidents (incident_id -> MassCasualtyIncident)
    pub mci_records: RwLock<HashMap<String, MassCasualtyIncident>>,
    /// Intubation records (record_id -> IntubationRecord)
    pub intubation_records: RwLock<HashMap<String, IntubationRecord>>,
    /// Splint/cast records (record_id -> SplintCastRecord)
    pub splint_cast_records: RwLock<HashMap<String, SplintCastRecord>>,
    /// Pediatric assessments (assessment_id -> PediatricAssessment)
    pub pediatric_assessments: RwLock<HashMap<String, PediatricAssessment>>,
    /// Obstetric emergencies (assessment_id -> ObstetricEmergency)
    pub obstetric_emergencies: RwLock<HashMap<String, ObstetricEmergency>>,
    /// Chain of custody records (form_id -> ChainOfCustody)
    pub chain_of_custody: RwLock<HashMap<String, ChainOfCustody>>,
    /// Lab QC records (qc_id -> LabQCRecord)
    pub lab_qc_records: RwLock<HashMap<String, LabQCRecord>>,
    /// Critical value notifications (notification_id -> CriticalValueNotification)
    pub critical_values: RwLock<HashMap<String, CriticalValueNotification>>,
    /// Specimen rejections (rejection_id -> SpecimenRejection)
    pub specimen_rejections: RwLock<HashMap<String, SpecimenRejection>>,
    /// Physician orders (order_id -> PhysicianOrder)
    pub physician_orders: RwLock<HashMap<String, PhysicianOrder>>,
    /// Discharge summaries (summary_id -> DischargeSummary)
    pub discharge_summaries: RwLock<HashMap<String, DischargeSummary>>,
    /// Discharge instructions (instructions_id -> DischargeInstructions)
    pub discharge_instructions: RwLock<HashMap<String, DischargeInstructions>>,
    /// AMA discharges (ama_id -> AMADischarge)
    pub ama_discharges: RwLock<HashMap<String, AMADischarge>>,
    /// History & Physical documents (hp_id -> HistoryAndPhysical)
    pub history_physicals: RwLock<HashMap<String, HistoryAndPhysical>>,
    /// Progress notes (note_id -> ProgressNote)
    pub progress_notes: RwLock<HashMap<String, ProgressNote>>,
    // ============================================================================
    // Clinical Documentation Storage (Phase 9-19) - Complete Hospital System
    // ============================================================================
    /// Pre-operative assessments (assessment_id -> PreOperativeAssessment)
    pub pre_op_assessments: RwLock<HashMap<String, PreOperativeAssessment>>,
    /// Operative notes (note_id -> OperativeNote)
    pub operative_notes: RwLock<HashMap<String, OperativeNote>>,
    /// Post-operative notes (note_id -> PostOperativeNote)
    pub post_op_notes: RwLock<HashMap<String, PostOperativeNote>>,
    /// Anesthesia records (record_id -> AnesthesiaRecord)
    pub anesthesia_records: RwLock<HashMap<String, AnesthesiaRecord>>,
    /// Radiology orders (order_id -> RadiologyOrder)
    pub radiology_orders: RwLock<HashMap<String, RadiologyOrder>>,
    /// Radiology reports (report_id -> RadiologyReport)
    pub radiology_reports: RwLock<HashMap<String, RadiologyReport>>,
    /// Pathology reports (report_id -> PathologyReport)
    pub pathology_reports: RwLock<HashMap<String, PathologyReport>>,
    /// Immunization records (record_id -> ImmunizationRecord)
    pub immunization_records: RwLock<HashMap<String, ImmunizationRecord>>,
    /// Blood type screens (test_id -> BloodTypeScreen)
    pub blood_type_screens: RwLock<HashMap<String, BloodTypeScreen>>,
    /// Autopsy requests (request_id -> AutopsyRequest)
    pub autopsy_requests: RwLock<HashMap<String, AutopsyRequest>>,
    /// Autopsy reports (report_id -> AutopsyReport)
    pub autopsy_reports: RwLock<HashMap<String, AutopsyReport>>,
    /// Patient satisfaction surveys (survey_id -> PatientSatisfactionSurvey)
    pub satisfaction_surveys: RwLock<HashMap<String, PatientSatisfactionSurvey>>,
    // ============================================================================
    // Clinical Documentation Storage (Phase 20-33) - Extended Features
    // ============================================================================
    /// Medication reminders (reminder_id -> MedicationReminder)
    pub medication_reminders: RwLock<HashMap<String, crate::clinical::MedicationReminder>>,
    /// Medication adherence logs (log_id -> MedicationAdherenceLog)
    pub adherence_logs: RwLock<HashMap<String, crate::clinical::MedicationAdherenceLog>>,
    /// Drug interaction results (result_id -> DrugInteractionResult)
    pub drug_interactions: RwLock<HashMap<String, crate::clinical::DrugInteractionResult>>,
    /// Family groups (family_id -> FamilyGroup)
    pub family_groups: RwLock<HashMap<String, crate::clinical::FamilyGroup>>,
    /// Wearable devices (device_id -> WearableDevice)
    pub wearable_devices: RwLock<HashMap<String, crate::clinical::WearableDevice>>,
    /// Wearable readings (reading_id -> WearableReading)
    pub wearable_readings: RwLock<HashMap<String, crate::clinical::WearableReading>>,
    /// Wearable alert rules (rule_id -> WearableAlertRule)
    pub wearable_alert_rules: RwLock<HashMap<String, crate::clinical::WearableAlertRule>>,
    /// Wearable alerts (alert_id -> WearableAlert)
    pub wearable_alerts: RwLock<HashMap<String, crate::clinical::WearableAlert>>,
    /// Symptom check sessions (session_id -> SymptomCheckSession)
    pub symptom_sessions: RwLock<HashMap<String, crate::clinical::SymptomCheckSession>>,
    /// Telehealth sessions (session_id -> TelehealthSession)
    pub telehealth_sessions: RwLock<HashMap<String, crate::clinical::TelehealthSession>>,
    /// CDS alerts (alert_id -> CDSAlert)
    pub cds_alerts: RwLock<HashMap<String, crate::clinical::CDSAlert>>,
    /// Lab trend results (result_id -> LabTrendResult)
    pub lab_trends: RwLock<HashMap<String, crate::clinical::LabTrendResult>>,
    /// E-prescriptions with signing (prescription_id -> EPrescription)
    pub e_prescriptions_v2: RwLock<HashMap<String, crate::clinical::EPrescription>>,
    /// Insurance claims (claim_id -> InsuranceClaim)
    pub insurance_claims: RwLock<HashMap<String, crate::clinical::InsuranceClaim>>,
    /// Eligibility check responses (check_id -> EligibilityCheckResponse)
    pub eligibility_checks: RwLock<HashMap<String, crate::clinical::EligibilityCheckResponse>>,
    /// Language preferences (user_id -> LanguagePreference)
    pub language_preferences: RwLock<HashMap<String, crate::clinical::LanguagePreference>>,
    /// Sync conflicts (conflict_id -> SyncConflict)
    pub sync_conflicts: RwLock<HashMap<String, crate::clinical::SyncConflict>>,
    /// Patient allergies (patient_id -> Vec<AllergyInfo>)
    pub allergies: RwLock<HashMap<String, Vec<crate::clinical::AllergyInfo>>>,
    /// Server start time for uptime calculation
    pub start_time: std::time::Instant,
    // ============================================================================
    // Item 5: National ID Verification Service
    // ============================================================================
    /// Routes national-ID verification requests to the correct per-country verifier.
    /// Falls back to SHA3-256 stub when no real API key is configured.
    pub national_id_service: crate::national_id::NationalIdService,
    // ============================================================================
    // Item 6: Telehealth Service
    // ============================================================================
    /// Manages telehealth sessions via a configurable provider
    /// (internal / Daily.co / Twilio Video).
    pub telehealth_service: crate::telehealth::TelehealthService,
}

impl AppState {
    /// Create new AppState with optional PostgreSQL pool
    /// If pool is provided, demo users will be loaded from database
    pub fn new_with_pool(db_pool: Option<sqlx::PgPool>) -> Self {
        // Loaded from ENCRYPTION_KEYS so it survives restarts (see encryption_keyring.rs);
        // falls back to an ephemeral key with a loud warning if unset.
        let encryption_keyring =
            std::sync::Arc::new(crate::encryption_keyring::EncryptionKeyring::from_env());
        let encryption_key = encryption_keyring.current().clone();

        // Use new_with_pool_async for PostgreSQL backend support
        let repositories = RepositoryContainer::new_memory();
        log::info!("Repository backend: {:?}", repositories.backend);

        // Bound before `repositories` is moved into the struct literal below.
        let patient_access =
            crate::patient_access::PatientAccessService::new(repositories.patient_access.clone());

        let security = crate::security::SecurityState::new(db_pool.clone());
        let emergency_grants = crate::emergency_grants::EmergencyGrantStore::new();

        Self {
            db_pool,
            repositories,
            nfc_tags: RwLock::new(HashMap::new()),
            access_logs: RwLock::new(Vec::new()),
            users: RwLock::new(HashMap::new()),
            medical_records: RwLock::new(HashMap::new()),
            lab_submissions: RwLock::new(HashMap::new()),
            ipfs_client: IpfsClient::from_env(),
            substrate_client: None, // Use new_with_pool_async for blockchain support
            ws_manager: crate::websocket::WsSessionManager::new(),
            encryption_key,
            encryption_keyring,
            security,
            identity_contexts: crate::federation_identity::IdentityContextStore::new(),
            organization_keys: crate::organization_keys::OrganizationKeyRegistry::new(),
            device_lifecycle: crate::device_lifecycle::DeviceLifecycleStore::new(),
            emergency_grants,
            patient_access,
            mobile_records: crate::mobile_records::MobileRecordStore::new(),
            used_emergency_tokens: RwLock::new(HashMap::new()),
            telehealth_retention: crate::telehealth_retention::TelehealthRetentionStore::new(),
            audit_outbox: crate::audit_outbox::AuditOutbox::new(),
            card_registry: CardRegistry::new(),
            // Clinical documentation storage (Phase 1)
            triage_assessments: RwLock::new(HashMap::new()),
            soap_notes: RwLock::new(HashMap::new()),
            gcs_assessments: RwLock::new(HashMap::new()),
            vital_signs: RwLock::new(HashMap::new()),
            // Clinical documentation storage (Phase 2-8)
            ems_handoffs: RwLock::new(HashMap::new()),
            medication_records: RwLock::new(HashMap::new()),
            io_records: RwLock::new(HashMap::new()),
            nursing_care_plans: RwLock::new(HashMap::new()),
            wound_assessments: RwLock::new(HashMap::new()),
            iv_assessments: RwLock::new(HashMap::new()),
            shift_handoffs: RwLock::new(HashMap::new()),
            incident_reports: RwLock::new(HashMap::new()),
            fall_risk_assessments: RwLock::new(HashMap::new()),
            burn_assessments: RwLock::new(HashMap::new()),
            mci_records: RwLock::new(HashMap::new()),
            intubation_records: RwLock::new(HashMap::new()),
            splint_cast_records: RwLock::new(HashMap::new()),
            pediatric_assessments: RwLock::new(HashMap::new()),
            obstetric_emergencies: RwLock::new(HashMap::new()),
            chain_of_custody: RwLock::new(HashMap::new()),
            lab_qc_records: RwLock::new(HashMap::new()),
            critical_values: RwLock::new(HashMap::new()),
            specimen_rejections: RwLock::new(HashMap::new()),
            physician_orders: RwLock::new(HashMap::new()),
            discharge_summaries: RwLock::new(HashMap::new()),
            discharge_instructions: RwLock::new(HashMap::new()),
            ama_discharges: RwLock::new(HashMap::new()),
            history_physicals: RwLock::new(HashMap::new()),
            progress_notes: RwLock::new(HashMap::new()),
            // Clinical documentation storage (Phase 9-19)
            pre_op_assessments: RwLock::new(HashMap::new()),
            operative_notes: RwLock::new(HashMap::new()),
            post_op_notes: RwLock::new(HashMap::new()),
            anesthesia_records: RwLock::new(HashMap::new()),
            radiology_orders: RwLock::new(HashMap::new()),
            radiology_reports: RwLock::new(HashMap::new()),
            pathology_reports: RwLock::new(HashMap::new()),
            immunization_records: RwLock::new(HashMap::new()),
            blood_type_screens: RwLock::new(HashMap::new()),
            autopsy_requests: RwLock::new(HashMap::new()),
            autopsy_reports: RwLock::new(HashMap::new()),
            satisfaction_surveys: RwLock::new(HashMap::new()),
            // Patient portal storage
            medication_reminders: RwLock::new(HashMap::new()),
            adherence_logs: RwLock::new(HashMap::new()),
            drug_interactions: RwLock::new(HashMap::new()),
            family_groups: RwLock::new(HashMap::new()),
            wearable_devices: RwLock::new(HashMap::new()),
            wearable_readings: RwLock::new(HashMap::new()),
            wearable_alert_rules: RwLock::new(HashMap::new()),
            wearable_alerts: RwLock::new(HashMap::new()),
            symptom_sessions: RwLock::new(HashMap::new()),
            telehealth_sessions: RwLock::new(HashMap::new()),
            cds_alerts: RwLock::new(HashMap::new()),
            lab_trends: RwLock::new(HashMap::new()),
            e_prescriptions_v2: RwLock::new(HashMap::new()),
            insurance_claims: RwLock::new(HashMap::new()),
            eligibility_checks: RwLock::new(HashMap::new()),
            language_preferences: RwLock::new(HashMap::new()),
            // Offline sync storage
            sync_conflicts: RwLock::new(HashMap::new()),
            allergies: RwLock::new(HashMap::new()),
            start_time: std::time::Instant::now(),
            national_id_service: crate::national_id::NationalIdService::new(),
            telehealth_service: crate::telehealth::TelehealthService::new(),
        }
    }

    /// Create new AppState with optional PostgreSQL pool (async version)
    /// Pass substrate_client to enable blockchain integration.
    pub async fn new_with_pool_async(
        db_pool: Option<sqlx::PgPool>,
        substrate_client: Option<std::sync::Arc<crate::blockchain::SubstrateClient>>,
    ) -> Self {
        // Loaded from ENCRYPTION_KEYS so it survives restarts (see encryption_keyring.rs);
        // falls back to an ephemeral key with a loud warning if unset.
        let encryption_keyring =
            std::sync::Arc::new(crate::encryption_keyring::EncryptionKeyring::from_env());
        let encryption_key = encryption_keyring.current().clone();

        // Storage backend selection: set MEDICHAIN_STORAGE=postgres to enable PostgreSQL
        // The postgres feature is enabled by default in Cargo.toml
        let repositories = {
            #[cfg(feature = "postgres")]
            {
                match (
                    crate::repositories::StorageBackend::from_env(),
                    db_pool.as_ref(),
                ) {
                    (crate::repositories::StorageBackend::Postgres, Some(pool)) => {
                        match RepositoryContainer::new_postgres(pool.clone()).await {
                            Ok(pg_repos) => {
                                log::info!("Using PostgreSQL repository backend");
                                pg_repos
                            }
                            Err(e) => {
                                log::error!("PostgreSQL repository init failed: {}. Falling back to memory.", e);
                                RepositoryContainer::new_memory()
                            }
                        }
                    }
                    _ => RepositoryContainer::new_memory(),
                }
            }
            #[cfg(not(feature = "postgres"))]
            {
                RepositoryContainer::new_memory()
            }
        };
        log::info!("Repository backend: {:?}", repositories.backend);

        // Bound before `repositories` is moved into the struct literal below.
        let patient_access =
            crate::patient_access::PatientAccessService::new(repositories.patient_access.clone());

        let security = crate::security::SecurityState::new(db_pool.clone());
        let emergency_grants = match (repositories.backend, db_pool.clone()) {
            (crate::repositories::StorageBackend::Postgres, Some(pool)) => {
                crate::emergency_grants::EmergencyGrantStore::with_pool(pool)
            }
            _ => crate::emergency_grants::EmergencyGrantStore::new(),
        };
        let mobile_records = match (repositories.backend, db_pool.clone()) {
            (crate::repositories::StorageBackend::Postgres, Some(pool)) => {
                crate::mobile_records::MobileRecordStore::with_pool(pool)
            }
            _ => crate::mobile_records::MobileRecordStore::new(),
        };

        Self {
            db_pool,
            repositories,
            nfc_tags: RwLock::new(HashMap::new()),
            access_logs: RwLock::new(Vec::new()),
            users: RwLock::new(HashMap::new()),
            medical_records: RwLock::new(HashMap::new()),
            lab_submissions: RwLock::new(HashMap::new()),
            ipfs_client: IpfsClient::from_env(),
            substrate_client,
            ws_manager: crate::websocket::WsSessionManager::new(),
            encryption_key,
            encryption_keyring,
            security,
            identity_contexts: crate::federation_identity::IdentityContextStore::new(),
            organization_keys: crate::organization_keys::OrganizationKeyRegistry::new(),
            device_lifecycle: crate::device_lifecycle::DeviceLifecycleStore::new(),
            emergency_grants,
            patient_access,
            mobile_records,
            used_emergency_tokens: RwLock::new(HashMap::new()),
            telehealth_retention: crate::telehealth_retention::TelehealthRetentionStore::new(),
            audit_outbox: crate::audit_outbox::AuditOutbox::new(),
            card_registry: CardRegistry::new(),
            // Clinical documentation storage (Phase 1)
            triage_assessments: RwLock::new(HashMap::new()),
            soap_notes: RwLock::new(HashMap::new()),
            gcs_assessments: RwLock::new(HashMap::new()),
            vital_signs: RwLock::new(HashMap::new()),
            // Clinical documentation storage (Phase 2-8)
            ems_handoffs: RwLock::new(HashMap::new()),
            medication_records: RwLock::new(HashMap::new()),
            io_records: RwLock::new(HashMap::new()),
            nursing_care_plans: RwLock::new(HashMap::new()),
            wound_assessments: RwLock::new(HashMap::new()),
            iv_assessments: RwLock::new(HashMap::new()),
            shift_handoffs: RwLock::new(HashMap::new()),
            incident_reports: RwLock::new(HashMap::new()),
            fall_risk_assessments: RwLock::new(HashMap::new()),
            burn_assessments: RwLock::new(HashMap::new()),
            mci_records: RwLock::new(HashMap::new()),
            intubation_records: RwLock::new(HashMap::new()),
            splint_cast_records: RwLock::new(HashMap::new()),
            pediatric_assessments: RwLock::new(HashMap::new()),
            obstetric_emergencies: RwLock::new(HashMap::new()),
            chain_of_custody: RwLock::new(HashMap::new()),
            lab_qc_records: RwLock::new(HashMap::new()),
            critical_values: RwLock::new(HashMap::new()),
            specimen_rejections: RwLock::new(HashMap::new()),
            physician_orders: RwLock::new(HashMap::new()),
            discharge_summaries: RwLock::new(HashMap::new()),
            discharge_instructions: RwLock::new(HashMap::new()),
            ama_discharges: RwLock::new(HashMap::new()),
            history_physicals: RwLock::new(HashMap::new()),
            progress_notes: RwLock::new(HashMap::new()),
            // Surgical and imaging storage
            pre_op_assessments: RwLock::new(HashMap::new()),
            operative_notes: RwLock::new(HashMap::new()),
            post_op_notes: RwLock::new(HashMap::new()),
            anesthesia_records: RwLock::new(HashMap::new()),
            radiology_orders: RwLock::new(HashMap::new()),
            radiology_reports: RwLock::new(HashMap::new()),
            pathology_reports: RwLock::new(HashMap::new()),
            immunization_records: RwLock::new(HashMap::new()),
            blood_type_screens: RwLock::new(HashMap::new()),
            autopsy_requests: RwLock::new(HashMap::new()),
            autopsy_reports: RwLock::new(HashMap::new()),
            satisfaction_surveys: RwLock::new(HashMap::new()),
            // Patient portal storage
            medication_reminders: RwLock::new(HashMap::new()),
            adherence_logs: RwLock::new(HashMap::new()),
            drug_interactions: RwLock::new(HashMap::new()),
            family_groups: RwLock::new(HashMap::new()),
            wearable_devices: RwLock::new(HashMap::new()),
            wearable_readings: RwLock::new(HashMap::new()),
            wearable_alert_rules: RwLock::new(HashMap::new()),
            wearable_alerts: RwLock::new(HashMap::new()),
            symptom_sessions: RwLock::new(HashMap::new()),
            telehealth_sessions: RwLock::new(HashMap::new()),
            cds_alerts: RwLock::new(HashMap::new()),
            lab_trends: RwLock::new(HashMap::new()),
            e_prescriptions_v2: RwLock::new(HashMap::new()),
            insurance_claims: RwLock::new(HashMap::new()),
            eligibility_checks: RwLock::new(HashMap::new()),
            language_preferences: RwLock::new(HashMap::new()),
            // Offline sync storage
            sync_conflicts: RwLock::new(HashMap::new()),
            allergies: RwLock::new(HashMap::new()),
            start_time: std::time::Instant::now(),
            national_id_service: crate::national_id::NationalIdService::new(),
            telehealth_service: crate::telehealth::TelehealthService::new(),
        }
    }

    /// Create new AppState without PostgreSQL (legacy fallback)
    pub fn new() -> Self {
        Self::new_with_pool(None)
    }

    /// Load active users and their professional profiles into the authorization cache.
    pub async fn load_demo_users_from_db(&self) -> Result<usize, String> {
        let pool = match &self.db_pool {
            Some(p) => p,
            None => return Err("No database pool configured".to_string()),
        };

        let users_result = sqlx::query_as::<_, crate::models::DbUserWithProfile>(
            "SELECT u.*, p.department, p.specialty, p.license_number
             FROM users u
             LEFT JOIN user_profiles p ON p.user_id = u.id
             WHERE u.is_active = true AND u.status = 'active'",
        )
        .fetch_all(pool)
        .await;

        match users_result {
            Ok(rows) => {
                let mut users = self.users.write().map_err(|e| e.to_string())?;
                let mut count = 0;

                for row in rows {
                    let db_user = &row.user;
                    let user = User {
                        wallet_address: db_user.wallet_address.clone(),
                        username: db_user.username.clone(),
                        name: db_user
                            .name
                            .clone()
                            .unwrap_or_else(|| "Unknown".to_string()),
                        role: match db_user.role.as_str() {
                            "Admin" => Role::Admin,
                            "Doctor" => Role::Doctor,
                            "Nurse" => Role::Nurse,
                            "LabTechnician" => Role::LabTechnician,
                            "Pharmacist" => Role::Pharmacist,
                            "Patient" => Role::Patient,
                            _ => Role::Patient,
                        },
                        created_at: db_user.created_at,
                        created_by: db_user.created_by.clone(),
                        linked_patient_id: db_user.linked_patient_id.clone(),
                        email: db_user.email.clone(),
                        phone: None,
                        department: row.department.clone(),
                        specialty: row.specialty.clone(),
                        license_number: row.license_number.clone(),
                        status: db_user.status.clone(),
                        last_login: db_user.last_login_at,
                    };
                    users.insert(db_user.wallet_address.clone(), user);
                    count += 1;
                }

                Ok(count)
            }
            Err(e) => Err(format!("Failed to load users from database: {}", e)),
        }
    }

    /// Upsert a user into the persistent `users` table. No-op when no DB pool
    /// is configured (memory-only demo mode).
    ///
    /// Added 2026-07-22: `wallet_register`/`assign_role`/`update_user_profile`
    /// previously only wrote to the in-memory `self.users` map — every
    /// admin-registered user (and every profile edit) was silently lost on
    /// restart even with `MEDICHAIN_STORAGE=postgres` configured, since
    /// `load_demo_users_from_db` only re-seeds from what was actually
    /// persisted here.
    pub async fn persist_user(&self, user: &User) -> Result<(), String> {
        let pool = match &self.db_pool {
            Some(p) => p,
            None => return Ok(()),
        };

        let role = user.role.to_string();
        let status = normalized_user_status(&user.status);
        let is_active = status == "active";
        let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

        let user_id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO users (
                wallet_address, role, name, username, email, linked_patient_id,
                is_active, status, last_login_at, created_by, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (wallet_address) DO UPDATE SET
                role = EXCLUDED.role,
                name = EXCLUDED.name,
                username = EXCLUDED.username,
                email = EXCLUDED.email,
                linked_patient_id = EXCLUDED.linked_patient_id,
                is_active = EXCLUDED.is_active,
                status = EXCLUDED.status,
                last_login_at = EXCLUDED.last_login_at,
                updated_at = NOW()
            RETURNING id",
        )
        .bind(&user.wallet_address)
        .bind(&role)
        .bind(&user.name)
        .bind(&user.username)
        .bind(&user.email)
        .bind(&user.linked_patient_id)
        .bind(is_active)
        .bind(status)
        .bind(user.last_login)
        .bind(&user.created_by)
        .bind(user.created_at)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        // Always upsert the professional profile, including three NULL values.
        // Skipping the write when every field is None would make a "clear all"
        // profile edit survive only in memory and resurrect stale values after a
        // restart.
        sqlx::query(
            "INSERT INTO user_profiles (user_id, department, specialty, license_number)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id) DO UPDATE SET
                 department = EXCLUDED.department,
                 specialty = EXCLUDED.specialty,
                 license_number = EXCLUDED.license_number,
                 updated_at = NOW()",
        )
        .bind(user_id)
        .bind(&user.department)
        .bind(&user.specialty)
        .bind(&user.license_number)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Persist a user before publishing the change to the authorization cache.
    pub async fn persist_then_cache_user(&self, user: User) -> Result<(), String> {
        self.persist_user(&user).await?;
        self.users
            .write()
            .map_err(|_| "User cache is unavailable".to_string())?
            .insert(user.wallet_address.clone(), user);
        Ok(())
    }

    /// Bootstrap must inspect durable state, not only the active-user cache.
    pub async fn has_any_persisted_user(&self) -> Result<bool, String> {
        let Some(pool) = &self.db_pool else {
            return self
                .users
                .read()
                .map(|users| !users.is_empty())
                .map_err(|_| "User cache is unavailable".to_string());
        };
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM users)")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())
    }

    /// Soft-delete a user in the persistent `users` table (revoke access
    /// without destroying the audit record). No-op when no DB pool is
    /// configured. See `persist_user` for why this exists.
    pub async fn deactivate_user_in_db(&self, wallet_address: &str) -> Result<(), String> {
        let pool = match &self.db_pool {
            Some(p) => p,
            None => return Ok(()),
        };

        sqlx::query(
            "UPDATE users SET is_active = false, status = 'inactive', updated_at = NOW() \
             WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    /// Durably deactivate an account before evicting its cached permissions.
    pub async fn deactivate_then_evict_user(
        &self,
        wallet_address: &str,
    ) -> Result<Option<User>, String> {
        self.deactivate_user_in_db(wallet_address).await?;
        self.users
            .write()
            .map_err(|_| "User cache is unavailable".to_string())
            .map(|mut users| users.remove(wallet_address))
    }

    /// Load persisted MFA enrollments (decrypting secrets) and recent security
    /// alerts from PostgreSQL into the in-memory security state (Phase 11.3/11.4).
    /// Returns the number of MFA enrollments loaded.
    pub async fn load_security_from_db(&self) -> Result<usize, String> {
        let pool = match &self.db_pool {
            Some(p) => p,
            None => return Err("No database pool configured".to_string()),
        };

        // Recent alerts into the ring buffer.
        self.security.load_alerts_from_db().await;

        // MFA enrollments: decrypt each secret with the app encryption key.
        let rows: Vec<(String, Vec<u8>, bool, chrono::DateTime<Utc>)> = sqlx::query_as(
            "SELECT wallet_address, secret_encrypted, enabled, created_at FROM user_mfa",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to query user_mfa: {}", e))?;

        let mut loaded = 0usize;
        if let Ok(mut map) = self.security.mfa.write() {
            for (wallet, secret_encrypted, enabled, created_at) in rows {
                let secret_base32 =
                    match medichain_crypto::EncryptedData::from_bytes(&secret_encrypted)
                        .and_then(|ed| medichain_crypto::decrypt(&self.encryption_key, &ed))
                    {
                        Ok(bytes) => match String::from_utf8(bytes) {
                            Ok(s) => s,
                            Err(_) => {
                                log::warn!(
                                    "MFA secret for {} is not valid UTF-8; skipping",
                                    wallet
                                );
                                continue;
                            }
                        },
                        Err(e) => {
                            log::warn!("Failed to decrypt MFA secret: {e}");
                            continue;
                        }
                    };
                map.insert(
                    wallet,
                    crate::security::mfa::MfaRecord {
                        secret_base32,
                        enabled,
                        created_at,
                    },
                );
                loaded += 1;
            }
        }
        Ok(loaded)
    }

    /// Persist (upsert) an MFA enrollment with the secret encrypted at rest.
    /// No-op (Ok) on the memory backend.
    pub async fn persist_mfa_enrollment(
        &self,
        wallet: &str,
        secret_base32: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let Some(pool) = &self.db_pool else {
            return Ok(());
        };
        let encrypted = medichain_crypto::encrypt(&self.encryption_key, secret_base32.as_bytes())
            .map_err(|e| format!("encrypt MFA secret: {}", e))?
            .to_bytes();
        sqlx::query(
            "INSERT INTO user_mfa (wallet_address, secret_encrypted, enabled) VALUES ($1, $2, $3) \
             ON CONFLICT (wallet_address) DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted, enabled = EXCLUDED.enabled",
        )
        .bind(wallet)
        .bind(&encrypted)
        .bind(enabled)
        .execute(pool)
        .await
        .map_err(|e| format!("persist MFA enrollment: {}", e))?;
        Ok(())
    }

    /// Update the `enabled` flag of a persisted MFA enrollment. No-op on memory.
    pub async fn update_mfa_enabled(&self, wallet: &str, enabled: bool) -> Result<(), String> {
        let Some(pool) = &self.db_pool else {
            return Ok(());
        };
        let result = sqlx::query("UPDATE user_mfa SET enabled = $2 WHERE wallet_address = $1")
            .bind(wallet)
            .bind(enabled)
            .execute(pool)
            .await
            .map_err(|e| format!("update MFA enabled: {}", e))?;
        if result.rows_affected() != 1 {
            return Err("update MFA enabled: enrollment not found".to_string());
        }
        Ok(())
    }

    /// Delete a persisted MFA enrollment. No-op on memory.
    pub async fn delete_mfa_enrollment(&self, wallet: &str) -> Result<(), String> {
        let Some(pool) = &self.db_pool else {
            return Ok(());
        };
        let result = sqlx::query("DELETE FROM user_mfa WHERE wallet_address = $1")
            .bind(wallet)
            .execute(pool)
            .await
            .map_err(|e| format!("delete MFA enrollment: {}", e))?;
        if result.rows_affected() != 1 {
            return Err("delete MFA enrollment: enrollment not found".to_string());
        }
        Ok(())
    }

    /// Load demo patients from PostgreSQL into the patient repository
    /// Called at startup when DATABASE_URL is configured
    // The `nfc_tags` guard is explicitly `drop()`-ed before the repository-sync
    // loop's await points; clippy's await_holding_lock doesn't recognize manual
    // drops here.
    #[allow(clippy::await_holding_lock)]
    pub async fn load_patients_from_db(&self) -> Result<usize, String> {
        let pool = match &self.db_pool {
            Some(p) => p,
            None => return Err("No database pool configured".to_string()),
        };

        // Query patients with their demographics
        let query = r#"
            SELECT 
                p.id,
                p.health_id,
                p.national_id_hash,
                p.gender,
                p.blood_type,
                p.organ_donor,
                p.dnr_status,
                pd.full_name,
                pd.date_of_birth,
                pd.national_id,
                pd.allergies,
                pd.current_medications,
                pd.chronic_conditions,
                pd.emergency_contact_name,
                pd.emergency_contact_phone,
                p.emergency_contact_relationship,
                pd.languages
            FROM patients p
            LEFT JOIN patient_demographics pd ON p.id = pd.patient_id
            WHERE p.is_active = true
        "#;

        let rows = sqlx::query(query)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to load patients: {}", e))?;

        let mut nfc_tags = self.nfc_tags.write().map_err(|e| e.to_string())?;
        let mut count = 0;
        let mut to_repo: Vec<(PatientProfile, NfcTagData)> = Vec::new();

        for row in rows {
            use sqlx::Row;

            let patient_id: String = row.get("id");
            let full_name: Option<String> = row.get("full_name");
            let date_of_birth: Option<chrono::NaiveDate> = row.get("date_of_birth");
            let national_id: Option<String> = row.get("national_id");
            // `p.gender` is already in the SELECT above; it was previously
            // dropped on the floor here, so a stored gender never reached the UI.
            let gender: Option<String> = row.get("gender");
            let blood_type_str: Option<String> = row.get("blood_type");
            let organ_donor: bool = row.get("organ_donor");
            let dnr_status: bool = row.get("dnr_status");
            let emergency_contact_name: Option<String> = row.get("emergency_contact_name");
            let emergency_contact_phone: Option<String> = row.get("emergency_contact_phone");
            let emergency_contact_relationship: Option<String> =
                row.get("emergency_contact_relationship");

            // Parse JSON arrays
            let allergies_json: Option<serde_json::Value> = row.get("allergies");
            let medications_json: Option<serde_json::Value> = row.get("current_medications");
            let conditions_json: Option<serde_json::Value> = row.get("chronic_conditions");
            let languages_json: Option<serde_json::Value> = row.get("languages");

            // Parse blood type
            let blood_type = blood_type_str
                .and_then(|s| parse_blood_type(&s).ok())
                .unwrap_or(BloodType::OPositive); // Default to O+ (universal donor)

            // Parse JSON arrays to Vec<String>
            let allergies: Vec<String> = allergies_json
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            let current_medications: Vec<String> = medications_json
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            let chronic_conditions: Vec<String> = conditions_json
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            let languages: Vec<String> = languages_json
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_else(|| vec!["English".to_string()]);

            // Create emergency info
            let emergency_info = EmergencyInfo {
                patient_id: patient_id.clone(),
                blood_type,
                allergies: allergies
                    .iter()
                    .map(|name| Allergy {
                        name: name.clone(),
                        severity: AllergySeverity::Mild,
                        reaction: None,
                        verified_at: None,
                    })
                    .collect(),
                current_medications,
                chronic_conditions,
                emergency_contacts: vec![EmergencyContact {
                    name: emergency_contact_name.unwrap_or_default(),
                    phone: emergency_contact_phone.unwrap_or_default(),
                    relationship: emergency_contact_relationship.unwrap_or_default(),
                    priority: 1,
                    can_make_medical_decisions: false,
                    language: None,
                }],
                organ_donor,
                dnr_status,
                // DNR starts UNVERIFIED at registration; a provider attaches proof later.
                dnr_verified_by: None,
                dnr_verified_at: None,
                dnr_document_ref: None,
                languages,
                last_updated: Utc::now(),
            };

            // Create patient profile
            let patient = PatientProfile {
                patient_id: patient_id.clone(),
                full_name: full_name.unwrap_or_else(|| "Unknown".to_string()),
                date_of_birth: date_of_birth.map(|d| d.to_string()).unwrap_or_default(),
                time_of_birth: None,
                national_id: national_id.unwrap_or_default(),
                gender,
                phone: String::new(),
                emergency_info,
                address: None,
                insurance: None,
                primary_doctor: None,
                community_health_worker: None,
                preferences: PatientPreferences::default(),
                advanced_directives: vec![],
                family_notifications: None,
                created_at: Utc::now(),
                last_updated: Utc::now(),
            };

            // Also create NFC tag entry
            let nfc_tag_id = format!("NFC-{}", patient_id.replace("PAT-", ""));
            let hash = generate_nfc_hash(&patient_id, &nfc_tag_id);
            let nfc_tag = NfcTagData {
                tag_id: nfc_tag_id.clone(),
                patient_id: patient_id.clone(),
                hash,
                created_at: Utc::now(),
            };
            nfc_tags.insert(nfc_tag_id, nfc_tag.clone());
            to_repo.push((patient, nfc_tag));

            count += 1;
        }
        drop(nfc_tags);

        // In the memory-backend demo config (DATABASE_URL set but MEDICHAIN_STORAGE
        // unset), also populate the repositories so loaded demo patients are visible
        // through the repository read paths. Skipped for the Postgres backend, where
        // the repository reads the patients table directly (avoids duplicate inserts).
        if matches!(
            self.repositories.backend,
            crate::repositories::StorageBackend::Memory
        ) {
            for (profile, tag) in to_repo {
                let entity = patient_profile_to_entity(&profile, &self.encryption_keyring);
                let _ = self.repositories.patients.create(entity).await;
                let _ = self.repositories.nfc_tags.create(tag.into()).await;
            }
        }

        Ok(count)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Account states persisted by the users table. Unknown values fail closed.
pub const USER_STATUSES: [&str; 4] = ["active", "inactive", "suspended", "pending"];

pub fn normalized_user_status(status: &str) -> &'static str {
    match status {
        "active" => "active",
        "suspended" => "suspended",
        "pending" => "pending",
        _ => "inactive",
    }
}
