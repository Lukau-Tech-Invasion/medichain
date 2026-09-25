/**
 * MediChain Clinical Domain Types
 *
 * Response/record shapes for the clinical documentation endpoints in
 * `api/src/clinical_endpoints/` and `api/src/clinical.rs`. Field names and
 * top-level shapes are derived directly from the corresponding Rust structs
 * (which serialize with default serde behavior: struct field names are
 * preserved as snake_case keys, unit enum variants serialize as their
 * variant name string, `Option<T>` serializes as `T | null`).
 *
 * Deeply-nested clinical sub-structures (e.g. a trauma assessment's primary
 * survey, a burn assessment's TBSA regions) are intentionally typed as
 * `Record<string, unknown>` rather than fully mirrored field-by-field — the
 * backend's clinical type surface (`api/src/clinical.rs`) is ~9,400 lines
 * and 450+ structs/enums, and none of these nested shapes are currently
 * destructured by any frontend caller (verified by repo-wide grep). Typing
 * the top level accurately turns `unknown` into a real, discoverable
 * interface without fabricating unverified nested field shapes.
 */

// ============================================================================
// Emergency Protocols
// ============================================================================

/**
 * One row of a per-patient emergency list (`GET /api/emergency/{type}/patient/{id}`).
 *
 * The lists return the repository's summary entity, not the full record the
 * by-id reads return: the id is `id`, only the columns below are typed, and
 * everything else the screen collected is in `data`. Reading the full-record
 * field names off a list row -- `event_id`, `mechanism_of_injury`,
 * `antibiotics_given` -- yields `undefined`, which the Emergency Protocols
 * page rendered as a blank ID and as "No" for every yes/no finding.
 *
 * Timestamps are epoch seconds. `null` means the field was not recorded.
 */
interface EmergencyListRow {
  id: string;
  patient_id: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CodeBlueListRow extends EmergencyListRow {
  location: string | null;
  code_called_at: number;
  team_arrived_at: number | null;
  initial_rhythm: string | null;
  witnessed: boolean | null;
  outcome: string;
  code_leader: string | null;
  documented_by: string;
  documented_at: number;
}

export interface TraumaListRow extends EmergencyListRow {
  mechanism: string;
  gcs: number | null;
  trauma_level: number | null;
  mtp_activated: boolean | null;
  disposition: string | null;
  assessed_by: string;
  assessed_at: number;
}

export interface StrokeListRow extends EmergencyListRow {
  nihss_total: number | null;
  stroke_type: string | null;
  tpa_eligible: boolean | null;
  tpa_given: boolean | null;
  hemorrhage: boolean | null;
  lvo_suspected: boolean | null;
  assessed_by: string;
  assessed_at: number;
}

export interface CardiacEventListRow extends EmergencyListRow {
  event_type: string;
  cath_lab_activated: boolean;
  pci_performed: boolean;
  door_to_balloon_minutes: number | null;
  documented_by: string;
  documented_at: number;
}

export interface SepsisListRow extends EmergencyListRow {
  severity: string;
  suspected_source: string;
  qsofa_score: number;
  /** Null when no organ system was measured -- not a SOFA of 0. */
  sofa_score: number | null;
  vasopressors_required: boolean;
  icu_admission: boolean;
  assessed_by: string;
  assessed_at: number;
}

// ============================================================================
// Nursing Documentation
// ============================================================================

export interface WoundAssessment {
  assessment_id: string;
  patient_id: string;
  wound_id: string;
  location: Record<string, unknown>;
  wound_type: string;
  etiology: string;
  measurements: Record<string, unknown>;
  wound_bed: Record<string, unknown>;
  wound_edges: string;
  periwound: string;
  drainage: Record<string, unknown>;
  odor: boolean;
  infection_signs: string[];
  pain_level: number | null;
  treatment: Record<string, unknown>;
  pressure_stage: string | null;
  photo_documented: boolean;
  photo_reference: string | null;
  assessed_by: string;
  assessed_at: number;
  next_assessment_due: string | null;
}

export interface IncidentReport {
  report_id: string;
  patient_id: string | null;
  incident_time: number;
  location: string;
  incident_type: string;
  description: string;
  witnesses: string[];
  immediate_actions: string[];
  condition_before: string | null;
  condition_after: string | null;
  post_incident_vitals: string | null;
  physician_notified: boolean;
  physician_name: string | null;
  notification_time: number | null;
  family_notified: boolean;
  interventions: string[];
  outcome: string;
  contributing_factors: string[];
  preventive_measures: string[];
  reported_by: string;
  reported_at: number;
  supervisor_reviewed: boolean;
  supervisor_name: string | null;
  review_time: number | null;
}

export interface FallRiskAssessment {
  assessment_id: string;
  patient_id: string;
  history_of_falling: Record<string, unknown>;
  secondary_diagnosis: Record<string, unknown>;
  ambulatory_aid: Record<string, unknown>;
  iv_heparin_lock: Record<string, unknown>;
  gait: Record<string, unknown>;
  mental_status: Record<string, unknown>;
  total_score: number;
  risk_level: string;
  interventions: string[];
  assessed_by: string;
  assessed_at: number;
}

// ============================================================================
// Specialty Emergency Documentation
// ============================================================================

// ============================================================================
// Laboratory
// ============================================================================

// ============================================================================
// Physician Documentation
// ============================================================================

export interface DischargeSummary {
  summary_id: string;
  patient_id: string;
  admission_date: string;
  discharge_date: string;
  length_of_stay_days: number;
  admitting_diagnosis: string;
  discharge_diagnoses: Record<string, unknown>[];
  principal_procedure: string | null;
  procedures: string[];
  hospital_course: string;
  significant_findings: string[];
  condition_at_discharge: string;
  disposition: string;
  medications: Record<string, unknown>[];
  med_reconciliation_complete: boolean;
  follow_up: Record<string, unknown>[];
  instructions_given: boolean;
  education: string[];
  pending_tests: string[];
  pending_results_plan: string | null;
  attending_physician: string;
  pcp_notified: boolean;
  dictated_by: string;
  dictation_time: number;
  signed_by: string | null;
  signature_time: number | null;
}

export interface AMADischarge {
  ama_id: string;
  patient_id: string;
  recommended_treatment: string;
  risks_explained: string[];
  potential_consequences: string[];
  patient_understands: boolean;
  patient_competent: boolean;
  capacity_assessment: boolean;
  patient_signed: boolean;
  signature_refused: boolean;
  witness: string;
  physician: string;
  follow_up_offered: boolean;
  prescriptions_offered: boolean;
  ama_time: number;
  documentation_time: number;
  documented_by: string;
}

export interface HistoryAndPhysical {
  hp_id: string;
  patient_id: string;
  exam_time: number;
  chief_complaint: string;
  hpi: string;
  past_medical_history: string[];
  past_surgical_history: string[];
  family_history: string[];
  social_history: Record<string, unknown>;
  medications: string[];
  allergies: Record<string, unknown>[];
  review_of_systems: Record<string, unknown>;
  physical_exam: Record<string, unknown>;
  assessment: string[];
  plan: string[];
  performed_by: string;
  cosigned_by: string | null;
}

/**
 * A progress note as `POST /api/clinical/progress-note` accepts it
 * (`CreateProgressNoteRequest`). Everything the form does not collect is
 * optional and left out when nobody entered it -- a required `code_status`
 * is how every note came to say "Full code".
 */
export interface ProgressNote {
  note_id: string;
  patient_id: string;
  /** Clinical workflow classification; legacy API callers default to daily. */
  note_type?: string;
  note_date: string;
  hospital_day?: number;
  post_op_day?: number;
  subjective: string;
  overnight_events?: string;
  vital_signs?: string;
  io_summary?: string;
  exam: string;
  labs_studies?: string;
  assessment: ProgressNoteProblem[];
  plan: string[];
  disposition?: string;
  code_status?: string;
  discussed_with?: string;
  author: string;
  note_time: number;
  cosigned_by: string | null;
}

export interface ProgressNoteProblem {
  problem_number: number;
  problem: string;
  /** improving | stable | worsening -- only when the clinician said so. */
  status?: string;
  plan: string;
}

// ============================================================================
// Surgical / Perioperative
// ============================================================================

// ============================================================================
// Diagnostics
// ============================================================================

// ============================================================================
// Immunization / History / Blood Bank
// ============================================================================

export interface ImmunizationRecord {
  record_id: string;
  patient_id: string;
  vaccine_name: string;
  cvx_code: string;
  manufacturer: string;
  lot_number: string;
  expiration_date: string;
  administration_date: string;
  dose_number: number;
  route: string;
  site: string;
  administered_by: string;
  vis_date: string;
  funding_source: string;
  registry_reported: boolean;
  adverse_reaction: string | null;
  notes: string | null;
}

export interface FamilyMedicalHistory {
  patient_id: string;
  family_members: FamilyHistoryMember[];
  genetic_conditions: GeneticCondition[];
  three_gen_complete: boolean;
  last_updated: number;
  updated_by: string;
}

export interface FamilyHistoryMember {
  relationship: string;
  living: boolean;
  current_age: number | null;
  age_at_death: number | null;
  cause_of_death: string | null;
  conditions: FamilyHistoryCondition[];
}

export interface FamilyHistoryCondition {
  condition: string;
  age_at_diagnosis: number | null;
  notes: string | null;
}

export interface GeneticCondition {
  condition_name: string;
  inheritance_pattern: string;
  affected_members: string[];
  genetic_testing_done: boolean;
  test_results: string | null;
}

// ============================================================================
// E-Prescription / Appointments / End-of-Life
// ============================================================================

export interface ElectronicPrescription {
  prescription_id: string;
  patient_id: string;
  prescriber_id: string;
  prescriber_name: string;
  prescriber_npi: string;
  prescriber_dea: string | null;
  medication: {
    rxcui: string | null;
    ndc: string | null;
    name: string;
    generic_name: string | null;
    strength: string;
    form: string;
    quantity: number;
    quantity_unit: string;
    days_supply: number;
    directions: string;
    daw_code: number;
  };
  pharmacy: Record<string, unknown>;
  status: string;
  created_at: number;
  signed_at: number | null;
  signature: Record<string, unknown> | null;
  transmitted_at: number | null;
  transmission_status: string | null;
  is_controlled: boolean;
  dea_schedule: string | null;
  dispensed_quantity: number;
  secondary_verification: Record<string, unknown>;
  refills_allowed: number;
  refills_remaining: number;
  last_filled: number | null;
  expires_at: number;
  pharmacy_notes: string | null;
  patient_instructions: string;
  diagnosis_codes: string[];
}

export interface Appointment {
  appointment_id: string;
  patient_id: string;
  provider_id: string;
  provider_name: string;
  appointment_type: string;
  visit_reason: string;
  scheduled_date: string;
  start_time: string;
  scheduled_time: number | null;
  duration_minutes: number;
  location: Record<string, unknown>;
  status: string;
  created_at: number;
  updated_at: number;
  created_by: string;
  booked_by: string | null;
  check_in_time: number | null;
  is_telehealth: boolean;
  reminders_sent: Record<string, unknown>[];
  instructions: string | null;
  insurance_verified: boolean;
  notes: string | null;
}

export interface SatisfactionSurveyResponseInput {
  question_id: string;
  question_text: string;
  response_type: 'Rating' | 'YesNo' | 'MultipleChoice' | 'FreeText';
  response_value: string;
}

export interface CreateSatisfactionSurveyInput {
  visit_id?: string;
  visit_date: string;
  department: string;
  survey_type: 'CAHPS' | 'HCAHPS' | 'Custom' | 'PostDischarge' | 'PostVisit';
  responses: SatisfactionSurveyResponseInput[];
  overall_rating: number;
  nps_score: number;
  comments?: string;
  anonymous: boolean;
  follow_up_requested: boolean;
  contact_method?: string;
}

// ============================================================================
// GCS / SAMPLE History
// ============================================================================

/** Response shape for GET /api/clinical/gcs/{id} (`GlasgowComaScale`). */
export interface GcsAssessmentRecord {
  assessment_id: string;
  patient_id: string;
  eye_response: string;
  verbal_response: string;
  motor_response: string;
  total_score: number;
  interpretation: string;
  pupil_assessment: Record<string, unknown> | null;
  notes: string | null;
  assessed_by: string;
  assessed_at: number;
}

// ============================================================================
// Create-response envelopes
//
// These mirror the exact ad-hoc `serde_json::json!({ ... })` bodies the
// backend handlers return (verified by reading each handler in
// `api/src/clinical_endpoints/`), not a single shared DTO — the backend
// does not use one envelope shape.
// ============================================================================

/** `{ id, success }` — used by most emergency/surgical assessment `create_*` handlers. */
export interface ClinicalCreateResult {
  id: string;
  success: boolean;
}

export interface AssessmentCreateResult {
  success: boolean;
  assessment_id: string;
}

export interface IncidentCreateResult {
  success: boolean;
  incident_id: string;
}

export interface RecordCreateResult {
  success: boolean;
  record_id: string;
}

export interface CollectionCreateResult {
  success: boolean;
  collection_id: string;
}

export interface FormCreateResult {
  success: boolean;
  form_id: string;
}

export interface QcCreateResult {
  success: boolean;
  qc_id: string;
  /** The server's verdict on the run (`clinical_scoring::westgard_single_run`). */
  passed: boolean;
  result: 'pass' | 'warning' | 'fail';
  z_score: number;
  violated_rules: string[];
  acceptable_range_low: number;
  acceptable_range_high: number;
}

export interface NotificationCreateResult {
  success: boolean;
  notification_id: string;
}

export interface OrderCreateResult {
  success: boolean;
  order_id: string;
}

export interface SummaryCreateResult {
  success: boolean;
  summary_id: string;
}

export interface InstructionsCreateResult {
  success: boolean;
  instructions_id: string;
}

export interface AmaCreateResult {
  success: boolean;
  ama_id: string;
}

export interface HpCreateResult {
  success: boolean;
  hp_id: string;
}

export interface ConsultCreateResult {
  success: boolean;
  consult_id: string;
}

export interface NoteCreateResult {
  success: boolean;
  note_id: string;
}

export interface EPrescriptionCreateResult {
  success: boolean;
  prescription_id: string;
  status: string;
  message: string;
}

export interface TelehealthSessionCreateResult {
  success: boolean;
  session_id: string;
  video_room_url: string;
  waiting_room_url: string;
  [key: string]: unknown;
}

export interface AppointmentCreateResult {
  success: boolean;
  appointment_id: string;
  message: string;
}

export interface FamilyGroupCreateResult {
  success: boolean;
  group_id: string;
  message: string;
}

export interface SymptomCheckCreateResult {
  success: boolean;
  session_id: string;
  questions: unknown;
  message: string;
}

export interface WearableDeviceCreateResult {
  success: boolean;
  device_id: string;
  message: string;
}

export interface AlertRuleCreateResult {
  success: boolean;
  rule_id: string;
  message: string;
}

export interface MedicationReminderCreateResult {
  success: boolean;
  reminder_id: string;
  message: string;
}

export interface AdherenceLogCreateResult {
  success: boolean;
  log_id: string;
  message: string;
}

// ============================================================================
// Additional domain records (engagement / telehealth / reference data)
// ============================================================================

export interface TelehealthSession {
  session_id: string;
  appointment_id: string | null;
  patient_id: string;
  provider_id: string;
  session_type: string;
  scheduled_start: number;
  /** How long the room was booked for. The join link's expiry derives from it. */
  duration_minutes: number;
  actual_start: number | null;
  actual_end: number | null;
  status: string;
  video_room_url: string;
  waiting_room_url: string;
  join_instructions: string;
  technical_requirements: string[];
  patient_joined_at: number | null;
  provider_joined_at: number | null;
  recording_enabled: boolean;
  recording_consent: boolean;
  chat_enabled: boolean;
  screen_share_enabled: boolean;
  quality_metrics: Record<string, unknown> | null;
  visit_notes: string | null;
  follow_up_scheduled: string | null;
}

export interface SymptomCheckSession {
  session_id: string;
  patient_id: string;
  started_at: number;
  completed_at: number | null;
  initial_symptoms: string[];
  conversation: Record<string, unknown>[];
  assessment: Record<string, unknown> | null;
  triage_recommendation: Record<string, unknown> | null;
  status: string;
}

export interface FamilyMember {
  patient_id: string;
  relationship: string;
  access_level: string;
  can_manage_appointments: boolean;
  can_view_records: boolean;
  can_manage_medications: boolean;
  can_book_appointments: boolean;
  is_minor: boolean;
  linked_at: number;
  linked_by: string;
}

export interface FamilyGroup {
  family_id: string;
  family_name: string;
  primary_account_id: string;
  members: FamilyMember[];
  created_at: number;
  last_modified: number;
}

export interface WearableDevice {
  device_id: string;
  patient_id: string;
  device_type: string;
  manufacturer: string;
  model: string;
  serial_number: string | null;
  firmware_version: string | null;
  connection_status: string;
  last_sync: number | null;
  paired_at: number;
  active: boolean;
  data_types: string[];
  sync_frequency_hours: number;
  battery_level: number | null;
}

export interface WearableReading {
  reading_id: string;
  device_id: string;
  patient_id: string;
  data_type: string;
  value: number;
  unit: string;
  secondary_value: number | null;
  recorded_at: number;
  synced_at: number;
  context: string | null;
  quality: string;
  flagged: boolean;
  flag_reason: string | null;
}

export interface WearableAlert {
  alert_id: string;
  rule_id: string;
  patient_id: string;
  reading_id: string;
  data_type: string;
  trigger_value: number;
  threshold: number;
  severity: string;
  message: string;
  created_at: number;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: number | null;
  action_taken: string | null;
}

// ============================================================================
// Round 19 (2026-07-22): response types for endpoints that previously
// returned Promise<Record<string, unknown>>/Promise<unknown> (13.1). Derived
// directly from each handler's actual JSON response, not just the request
// struct — several fields are documented as hardcoded/placeholder because the
// backend genuinely doesn't compute them yet (not a typing gap, a feature gap).
// ============================================================================

export interface EndTelehealthSessionResponse {
  success: true;
  session_id: string;
  duration_minutes: number;
  message: string;
}

/**
 * A policy's real financial terms, read off the stored insurance record and
 * shared by the eligibility and verification endpoints so the two surfaces
 * cannot quote different numbers for the same policy.
 *
 * A null amount means "not recorded on the policy", which is not the same as
 * zero — do not coalesce it to 0 for display.
 */
export interface PolicyFinancials {
  /** ISO 4217. Defaults to ZAR; amounts are not US dollars. */
  currency: string;
  copay: number | null;
  deductible: number | null;
  deductible_met: number;
  deductible_remaining: number | null;
  coinsurance_percent: number | null;
  out_of_pocket_max: number | null;
  out_of_pocket_met: number;
  out_of_pocket_remaining: number | null;
}

export interface DashboardMetricsResponse {
  success: true;
  metrics: {
    total_patients: number;
    total_medical_records: number;
    total_system_accesses: number;
    /**
     * Mean request latency measured from the same Prometheus histogram the
     * scrape endpoint serves. Null until the first request is observed.
     */
    avg_latency_ms: number | null;
    /**
     * Share of responses that were not 5xx, as a percentage. Null over an
     * empty sample — 100% from zero requests is a claim, not a measurement.
     */
    system_uptime: number | null;
    /** Seconds since the API process started. */
    uptime_seconds: number | null;
    total_requests: number;
    server_errors: number;
    blockchain_status: string;
  };
}

export interface AppointmentAnalyticsResponse {
  /** Keys are Rust Debug-formatted `AppointmentStatus` variants, e.g. "Scheduled". */
  status_distribution: Record<string, number>;
  total_appointments: number;
  completed_appointments: number;
  /** Null when no appointment falls in the range: 0% of nothing is not a measurement. */
  telehealth_percentage: number | null;
}

export interface QualityMetricsResponse {
  clinical_alerts_total: number;
  critical_alerts: number;
  /**
   * Percentage of access-log entries carrying a blockchain anchor. Null while
   * there are no entries to measure.
   */
  audit_logs_coverage: number | null;
  audit_entries_total: number;
  audit_entries_anchored: number;
  /**
   * Always null. A compliance score is a reviewed assessment against a control
   * framework, not something this endpoint derives; publishing a computed
   * number under that name invites an auditor to rely on it. Render the
   * measured indicators above instead.
   */
  compliance_score: null;
  compliance_score_basis: 'requires_reviewed_assessment';
}

/** A contact a responder can call. */
export interface EmergencyContactRef {
  name: string | null;
  phone: string | null;
  relationship: string | null;
  /** True only for a system-verified guardian relationship. */
  verified?: boolean;
}

export interface MedicalIdCard {
  patient_id: string;
  national_health_id: string;
  /** Decrypted from the profile; null when it could not be read. */
  name: string | null;
  /** Decrypted from the profile; null when it could not be read. */
  date_of_birth: string | null;
  photo: string | null;
  blood_type: { value: string; display_color: string };
  critical_allergies: Array<{ name: string; severity: string; reaction: string; display_color: string }>;
  allergies: Array<{ name: string; severity: string; reaction: string; display_color: string }>;
  organ_donor: { status: boolean; display_color: string };
  dnr_status: {
    status: boolean;
    verified: boolean;
    verified_by: string | null;
    verified_at: string | null;
    document_ref: string | null;
    display_color: string;
    warning: string | null;
  };
  chronic_conditions: string[];
  medications: string[];
  emergency_contacts: EmergencyContactRef[];
  primary_doctor: { name: string; phone: string | null } | null;
  community_health_worker: { name: string; phone: string | null } | null;
  languages: string[];
  primary_language: string | null;
  /**
   * True when the encrypted profile could not be decrypted. Distinguishes
   * "nothing recorded" from "we could not read it" — the arrays above are
   * empty in both cases, and only this flag tells them apart.
   */
  profile_unavailable: boolean;
  /** Always null today. */
  insurance: null;
  /** Always null today. */
  address: null;
  has_advanced_directives: false;
  advanced_directives_count: 0;
  preferences: { show_when_locked: boolean; enable_location_sharing: boolean; auto_notify_family: boolean };
  last_updated: string;
}

export interface VerifyInsuranceResponse {
  success: true;
  patient_id: string;
  verification:
    | {
        verified: true;
        verified_at: string;
        coverage_active: boolean;
        provider: string;
        policy_number: string | null;
        group_number: string | null;
        coverage_type: string | null;
        valid_from: string;
        valid_to: string | null;
        /**
         * The payer's own benefit schedule, or null when the payer supplied
         * none. Null means "not confirmed", never "not covered" — do not
         * render an absent schedule as a denial.
         */
        benefits: Record<string, unknown> | null;
        benefits_source: 'payer_schedule' | 'not_supplied_by_payer';
        /** The policy's real stored amounts. Nulls mean "not recorded". */
        financials: PolicyFinancials;
        prior_auth_required: boolean | null;
        prior_auth_phone: string | null;
        last_verified_date: string | null;
        verification_status: string | null;
      }
    | { verified: true; verified_at: string; coverage_active: false; message: string };
}
