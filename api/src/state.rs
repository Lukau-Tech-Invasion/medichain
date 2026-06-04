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
    pub patients: RwLock<HashMap<String, PatientProfile>>,
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
    /// Encryption key for medical records (in production: per-patient keys from HSM)
    pub encryption_key: medichain_crypto::EncryptionKey,
    /// Security subsystem: MFA enrollments + breach/anomaly detection state (Phase 11.3/11.4)
    pub security: crate::security::SecurityState,
    /// NFC Card registry for demo
    pub card_registry: CardRegistry,
    // ============================================================================
    // Clinical Documentation Storage (Phase 1)
    // ============================================================================
    /// Triage assessments (assessment_id -> TriageAssessment)
    pub triage_assessments: RwLock<HashMap<String, TriageAssessment>>,
    /// SOAP notes (note_id -> SOAPNote)
    pub soap_notes: RwLock<HashMap<String, SOAPNote>>,
    /// SAMPLE histories (patient_id -> SAMPLEHistory)
    pub sample_histories: RwLock<HashMap<String, SAMPLEHistory>>,
    /// Glasgow Coma Scale assessments (assessment_id -> GlasgowComaScale)
    pub gcs_assessments: RwLock<HashMap<String, GlasgowComaScale>>,
    /// Vital signs flowsheets (patient_id -> VitalSignsFlowsheet)
    pub vital_signs: RwLock<HashMap<String, VitalSignsFlowsheet>>,
    /// Lab panel templates (panel_name -> LabPanelTemplate)
    pub lab_panels: RwLock<HashMap<String, LabPanelTemplate>>,
    // ============================================================================
    // Clinical Documentation Storage (Phase 2-8) - New Types
    // ============================================================================
    /// Code Blue records (event_id -> CodeBlueRecord)
    pub code_blue_records: RwLock<HashMap<String, CodeBlueRecord>>,
    /// Trauma assessments (assessment_id -> TraumaAssessment)
    pub trauma_assessments: RwLock<HashMap<String, TraumaAssessment>>,
    /// Stroke assessments (assessment_id -> StrokeAssessment)
    pub stroke_assessments: RwLock<HashMap<String, StrokeAssessment>>,
    /// Cardiac events (event_id -> CardiacEvent)
    pub cardiac_events: RwLock<HashMap<String, CardiacEvent>>,
    /// Sepsis assessments (assessment_id -> SepsisAssessment)
    pub sepsis_assessments: RwLock<HashMap<String, SepsisAssessment>>,
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
    /// Psychiatric assessments (assessment_id -> PsychiatricAssessment)
    pub psych_assessments: RwLock<HashMap<String, PsychiatricAssessment>>,
    /// Toxicology assessments (assessment_id -> ToxicologyAssessment)
    pub tox_assessments: RwLock<HashMap<String, ToxicologyAssessment>>,
    /// Mass casualty incidents (incident_id -> MassCasualtyIncident)
    pub mci_records: RwLock<HashMap<String, MassCasualtyIncident>>,
    /// Intubation records (record_id -> IntubationRecord)
    pub intubation_records: RwLock<HashMap<String, IntubationRecord>>,
    /// Laceration repairs (record_id -> LacerationRepair)
    pub laceration_records: RwLock<HashMap<String, LacerationRepair>>,
    /// Splint/cast records (record_id -> SplintCastRecord)
    pub splint_cast_records: RwLock<HashMap<String, SplintCastRecord>>,
    /// Pediatric assessments (assessment_id -> PediatricAssessment)
    pub pediatric_assessments: RwLock<HashMap<String, PediatricAssessment>>,
    /// Obstetric emergencies (assessment_id -> ObstetricEmergency)
    pub obstetric_emergencies: RwLock<HashMap<String, ObstetricEmergency>>,
    /// Specimen collections (collection_id -> SpecimenCollection)
    pub specimen_collections: RwLock<HashMap<String, SpecimenCollection>>,
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
    /// Consultation notes (consult_id -> ConsultationNote)
    pub consult_notes: RwLock<HashMap<String, ConsultationNote>>,
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
    /// Immunization schedules (patient_id -> ImmunizationSchedule)
    pub immunization_schedules: RwLock<HashMap<String, ImmunizationSchedule>>,
    /// Family medical histories (patient_id -> FamilyMedicalHistory)
    pub family_histories: RwLock<HashMap<String, FamilyMedicalHistory>>,
    /// Blood type screens (test_id -> BloodTypeScreen)
    pub blood_type_screens: RwLock<HashMap<String, BloodTypeScreen>>,
    /// Crossmatch records (crossmatch_id -> CrossmatchRecord)
    pub crossmatch_records: RwLock<HashMap<String, CrossmatchRecord>>,
    /// Transfusion records (transfusion_id -> TransfusionRecord)
    pub transfusion_records: RwLock<HashMap<String, TransfusionRecord>>,
    /// Electronic prescriptions (rx_id -> ElectronicPrescription)
    pub e_prescriptions: RwLock<HashMap<String, ElectronicPrescription>>,
    /// Appointments (appointment_id -> Appointment)
    pub appointments: RwLock<HashMap<String, Appointment>>,
    /// Death certificates (certificate_id -> DeathCertificate)
    pub death_certificates: RwLock<HashMap<String, DeathCertificate>>,
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
    /// Family link requests (request_id -> FamilyLinkRequest)
    pub family_link_requests: RwLock<HashMap<String, crate::clinical::FamilyLinkRequest>>,
    /// Provider schedules (provider_id -> ProviderSchedule)
    pub provider_schedules: RwLock<HashMap<String, crate::clinical::ProviderSchedule>>,
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
    /// Device checks (check_id -> DeviceCheck)
    pub device_checks: RwLock<HashMap<String, crate::clinical::DeviceCheck>>,
    /// Waiting room entries (entry_id -> WaitingRoomEntry)
    pub waiting_room: RwLock<HashMap<String, crate::clinical::WaitingRoomEntry>>,
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
    /// Supported languages list
    pub supported_languages: RwLock<Vec<crate::clinical::SupportedLanguage>>,
    /// Sync statuses (device_id -> SyncStatus)
    pub sync_statuses: RwLock<HashMap<String, crate::clinical::SyncStatus>>,
    /// Sync queue (queue_id -> SyncQueueItem)
    pub sync_queue: RwLock<HashMap<String, crate::clinical::SyncQueueItem>>,
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
        // In production, keys would be managed by HSM/key vault
        let encryption_key =
            medichain_crypto::EncryptionKey::generate().expect("Failed to generate encryption key");

        // Initialize lab panels from standard templates
        let mut lab_panels_map = HashMap::new();
        for panel in crate::clinical::get_standard_lab_panels() {
            lab_panels_map.insert(panel.name.clone(), panel);
        }

        // Use new_with_pool_async for PostgreSQL backend support
        let repositories = RepositoryContainer::new_memory();
        log::info!("Repository backend: {:?}", repositories.backend);

        let security = crate::security::SecurityState::new(db_pool.clone());

        Self {
            db_pool,
            repositories,
            patients: RwLock::new(HashMap::new()),
            nfc_tags: RwLock::new(HashMap::new()),
            access_logs: RwLock::new(Vec::new()),
            users: RwLock::new(HashMap::new()),
            medical_records: RwLock::new(HashMap::new()),
            lab_submissions: RwLock::new(HashMap::new()),
            ipfs_client: IpfsClient::from_env(),
            substrate_client: None, // Use new_with_pool_async for blockchain support
            ws_manager: crate::websocket::WsSessionManager::new(),
            encryption_key,
            security,
            card_registry: CardRegistry::new(),
            // Clinical documentation storage (Phase 1)
            triage_assessments: RwLock::new(HashMap::new()),
            soap_notes: RwLock::new(HashMap::new()),
            sample_histories: RwLock::new(HashMap::new()),
            gcs_assessments: RwLock::new(HashMap::new()),
            vital_signs: RwLock::new(HashMap::new()),
            lab_panels: RwLock::new(lab_panels_map),
            // Clinical documentation storage (Phase 2-8)
            code_blue_records: RwLock::new(HashMap::new()),
            trauma_assessments: RwLock::new(HashMap::new()),
            stroke_assessments: RwLock::new(HashMap::new()),
            cardiac_events: RwLock::new(HashMap::new()),
            sepsis_assessments: RwLock::new(HashMap::new()),
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
            psych_assessments: RwLock::new(HashMap::new()),
            tox_assessments: RwLock::new(HashMap::new()),
            mci_records: RwLock::new(HashMap::new()),
            intubation_records: RwLock::new(HashMap::new()),
            laceration_records: RwLock::new(HashMap::new()),
            splint_cast_records: RwLock::new(HashMap::new()),
            pediatric_assessments: RwLock::new(HashMap::new()),
            obstetric_emergencies: RwLock::new(HashMap::new()),
            specimen_collections: RwLock::new(HashMap::new()),
            chain_of_custody: RwLock::new(HashMap::new()),
            lab_qc_records: RwLock::new(HashMap::new()),
            critical_values: RwLock::new(HashMap::new()),
            specimen_rejections: RwLock::new(HashMap::new()),
            physician_orders: RwLock::new(HashMap::new()),
            discharge_summaries: RwLock::new(HashMap::new()),
            discharge_instructions: RwLock::new(HashMap::new()),
            ama_discharges: RwLock::new(HashMap::new()),
            history_physicals: RwLock::new(HashMap::new()),
            consult_notes: RwLock::new(HashMap::new()),
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
            immunization_schedules: RwLock::new(HashMap::new()),
            family_histories: RwLock::new(HashMap::new()),
            blood_type_screens: RwLock::new(HashMap::new()),
            crossmatch_records: RwLock::new(HashMap::new()),
            transfusion_records: RwLock::new(HashMap::new()),
            e_prescriptions: RwLock::new(HashMap::new()),
            appointments: RwLock::new(HashMap::new()),
            death_certificates: RwLock::new(HashMap::new()),
            autopsy_requests: RwLock::new(HashMap::new()),
            autopsy_reports: RwLock::new(HashMap::new()),
            satisfaction_surveys: RwLock::new(HashMap::new()),
            // Clinical documentation storage (Phase 20-33) - Extended Features
            medication_reminders: RwLock::new(HashMap::new()),
            adherence_logs: RwLock::new(HashMap::new()),
            drug_interactions: RwLock::new(HashMap::new()),
            family_groups: RwLock::new(HashMap::new()),
            family_link_requests: RwLock::new(HashMap::new()),
            provider_schedules: RwLock::new(HashMap::new()),
            wearable_devices: RwLock::new(HashMap::new()),
            wearable_readings: RwLock::new(HashMap::new()),
            wearable_alert_rules: RwLock::new(HashMap::new()),
            wearable_alerts: RwLock::new(HashMap::new()),
            symptom_sessions: RwLock::new(HashMap::new()),
            telehealth_sessions: RwLock::new(HashMap::new()),
            device_checks: RwLock::new(HashMap::new()),
            waiting_room: RwLock::new(HashMap::new()),
            cds_alerts: RwLock::new(HashMap::new()),
            lab_trends: RwLock::new(HashMap::new()),
            e_prescriptions_v2: RwLock::new(HashMap::new()),
            insurance_claims: RwLock::new(HashMap::new()),
            eligibility_checks: RwLock::new(HashMap::new()),
            language_preferences: RwLock::new(HashMap::new()),
            supported_languages: RwLock::new(get_default_supported_languages()),
            sync_statuses: RwLock::new(HashMap::new()),
            sync_queue: RwLock::new(HashMap::new()),
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
        // In production, keys would be managed by HSM/key vault
        let encryption_key =
            medichain_crypto::EncryptionKey::generate().expect("Failed to generate encryption key");

        // Initialize lab panels from standard templates
        let mut lab_panels_map = HashMap::new();
        for panel in crate::clinical::get_standard_lab_panels() {
            lab_panels_map.insert(panel.name.clone(), panel);
        }

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

        let security = crate::security::SecurityState::new(db_pool.clone());

        Self {
            db_pool,
            repositories,
            patients: RwLock::new(HashMap::new()),
            nfc_tags: RwLock::new(HashMap::new()),
            access_logs: RwLock::new(Vec::new()),
            users: RwLock::new(HashMap::new()),
            medical_records: RwLock::new(HashMap::new()),
            lab_submissions: RwLock::new(HashMap::new()),
            ipfs_client: IpfsClient::from_env(),
            substrate_client,
            ws_manager: crate::websocket::WsSessionManager::new(),
            encryption_key,
            security,
            card_registry: CardRegistry::new(),
            // Clinical documentation storage (Phase 1)
            triage_assessments: RwLock::new(HashMap::new()),
            soap_notes: RwLock::new(HashMap::new()),
            sample_histories: RwLock::new(HashMap::new()),
            gcs_assessments: RwLock::new(HashMap::new()),
            vital_signs: RwLock::new(HashMap::new()),
            lab_panels: RwLock::new(lab_panels_map.clone()),
            // Clinical documentation storage (Phase 2-8)
            code_blue_records: RwLock::new(HashMap::new()),
            trauma_assessments: RwLock::new(HashMap::new()),
            stroke_assessments: RwLock::new(HashMap::new()),
            cardiac_events: RwLock::new(HashMap::new()),
            sepsis_assessments: RwLock::new(HashMap::new()),
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
            psych_assessments: RwLock::new(HashMap::new()),
            tox_assessments: RwLock::new(HashMap::new()),
            mci_records: RwLock::new(HashMap::new()),
            intubation_records: RwLock::new(HashMap::new()),
            laceration_records: RwLock::new(HashMap::new()),
            splint_cast_records: RwLock::new(HashMap::new()),
            pediatric_assessments: RwLock::new(HashMap::new()),
            obstetric_emergencies: RwLock::new(HashMap::new()),
            specimen_collections: RwLock::new(HashMap::new()),
            chain_of_custody: RwLock::new(HashMap::new()),
            lab_qc_records: RwLock::new(HashMap::new()),
            critical_values: RwLock::new(HashMap::new()),
            specimen_rejections: RwLock::new(HashMap::new()),
            physician_orders: RwLock::new(HashMap::new()),
            discharge_summaries: RwLock::new(HashMap::new()),
            discharge_instructions: RwLock::new(HashMap::new()),
            ama_discharges: RwLock::new(HashMap::new()),
            history_physicals: RwLock::new(HashMap::new()),
            consult_notes: RwLock::new(HashMap::new()),
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
            immunization_schedules: RwLock::new(HashMap::new()),
            family_histories: RwLock::new(HashMap::new()),
            blood_type_screens: RwLock::new(HashMap::new()),
            crossmatch_records: RwLock::new(HashMap::new()),
            transfusion_records: RwLock::new(HashMap::new()),
            e_prescriptions: RwLock::new(HashMap::new()),
            appointments: RwLock::new(HashMap::new()),
            death_certificates: RwLock::new(HashMap::new()),
            autopsy_requests: RwLock::new(HashMap::new()),
            autopsy_reports: RwLock::new(HashMap::new()),
            satisfaction_surveys: RwLock::new(HashMap::new()),
            // Patient portal storage
            medication_reminders: RwLock::new(HashMap::new()),
            adherence_logs: RwLock::new(HashMap::new()),
            drug_interactions: RwLock::new(HashMap::new()),
            family_groups: RwLock::new(HashMap::new()),
            family_link_requests: RwLock::new(HashMap::new()),
            provider_schedules: RwLock::new(HashMap::new()),
            wearable_devices: RwLock::new(HashMap::new()),
            wearable_readings: RwLock::new(HashMap::new()),
            wearable_alert_rules: RwLock::new(HashMap::new()),
            wearable_alerts: RwLock::new(HashMap::new()),
            symptom_sessions: RwLock::new(HashMap::new()),
            telehealth_sessions: RwLock::new(HashMap::new()),
            device_checks: RwLock::new(HashMap::new()),
            waiting_room: RwLock::new(HashMap::new()),
            cds_alerts: RwLock::new(HashMap::new()),
            lab_trends: RwLock::new(HashMap::new()),
            e_prescriptions_v2: RwLock::new(HashMap::new()),
            insurance_claims: RwLock::new(HashMap::new()),
            eligibility_checks: RwLock::new(HashMap::new()),
            language_preferences: RwLock::new(HashMap::new()),
            // Offline sync storage
            sync_statuses: RwLock::new(HashMap::new()),
            sync_queue: RwLock::new(HashMap::new()),
            sync_conflicts: RwLock::new(HashMap::new()),
            allergies: RwLock::new(HashMap::new()),
            supported_languages: RwLock::new(get_default_supported_languages()),
            start_time: std::time::Instant::now(),
            national_id_service: crate::national_id::NationalIdService::new(),
            telehealth_service: crate::telehealth::TelehealthService::new(),
        }
    }

    /// Create new AppState without PostgreSQL (legacy fallback)
    pub fn new() -> Self {
        Self::new_with_pool(None)
    }

    /// Load demo users from PostgreSQL into in-memory store
    /// Called at startup when DATABASE_URL is configured
    pub async fn load_demo_users_from_db(&self) -> Result<usize, String> {
        let pool = match &self.db_pool {
            Some(p) => p,
            None => return Err("No database pool configured".to_string()),
        };

        let users_result = sqlx::query_as::<_, crate::models::DbUser>(
            "SELECT * FROM users WHERE is_active = true",
        )
        .fetch_all(pool)
        .await;

        match users_result {
            Ok(db_users) => {
                let mut users = self.users.write().map_err(|e| e.to_string())?;
                let mut count = 0;

                for db_user in db_users {
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
                        phone: None,          // Loaded from profile separately
                        department: None,     // Loaded from profile separately
                        specialty: None,      // Loaded from profile separately
                        license_number: None, // Loaded from profile separately
                        status: if db_user.is_active {
                            "active".to_string()
                        } else {
                            "inactive".to_string()
                        },
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
                            log::warn!("Failed to decrypt MFA secret for {}: {}", wallet, e);
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
        sqlx::query("UPDATE user_mfa SET enabled = $2 WHERE wallet_address = $1")
            .bind(wallet)
            .bind(enabled)
            .execute(pool)
            .await
            .map_err(|e| format!("update MFA enabled: {}", e))?;
        Ok(())
    }

    /// Delete a persisted MFA enrollment. No-op on memory.
    pub async fn delete_mfa_enrollment(&self, wallet: &str) -> Result<(), String> {
        let Some(pool) = &self.db_pool else {
            return Ok(());
        };
        sqlx::query("DELETE FROM user_mfa WHERE wallet_address = $1")
            .bind(wallet)
            .execute(pool)
            .await
            .map_err(|e| format!("delete MFA enrollment: {}", e))?;
        Ok(())
    }

    /// Load demo patients from PostgreSQL into in-memory store
    /// Called at startup when DATABASE_URL is configured
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

        let mut patients = self.patients.write().map_err(|e| e.to_string())?;
        let mut nfc_tags = self.nfc_tags.write().map_err(|e| e.to_string())?;
        let mut count = 0;
        let mut to_repo: Vec<(PatientProfile, NfcTagData)> = Vec::new();

        for row in rows {
            use sqlx::Row;

            let patient_id: String = row.get("id");
            let full_name: Option<String> = row.get("full_name");
            let date_of_birth: Option<chrono::NaiveDate> = row.get("date_of_birth");
            let national_id: Option<String> = row.get("national_id");
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
                languages,
                last_updated: Utc::now(),
            };

            // Create patient profile
            let patient = PatientProfile {
                patient_id: patient_id.clone(),
                full_name: full_name.unwrap_or_else(|| "Unknown".to_string()),
                date_of_birth: date_of_birth.map(|d| d.to_string()).unwrap_or_default(),
                national_id: national_id.unwrap_or_default(),
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

            patients.insert(patient_id.clone(), patient.clone());

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
        drop(patients);
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
                let entity = patient_profile_to_entity(&profile, &self.encryption_key);
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
