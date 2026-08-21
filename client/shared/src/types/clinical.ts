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

export interface CodeBlueRecord {
  event_id: string;
  patient_id: string;
  location: string;
  code_called_at: number;
  team_arrived_at: number | null;
  initial_rhythm: string;
  witnessed: boolean;
  cpr_started_at: number | null;
  cpr_metrics: Record<string, unknown> | null;
  defibrillations: Record<string, unknown>[];
  medications: Record<string, unknown>[];
  airway_management: Record<string, unknown> | null;
  vascular_access: Record<string, unknown>[];
  rosc_at: number | null;
  code_ended_at: number | null;
  outcome: string;
  duration_minutes: number | null;
  team_members: Record<string, unknown>[];
  code_leader: string;
  post_rosc_care: Record<string, unknown> | null;
  family_notified: boolean;
  family_notified_at: number | null;
  documented_by: string;
  documented_at: number;
}

export interface TraumaAssessment {
  assessment_id: string;
  patient_id: string;
  mechanism: string;
  mechanism_details: string;
  injury_time: number | null;
  primary_survey: Record<string, unknown>;
  secondary_survey: Record<string, unknown> | null;
  trauma_score: Record<string, unknown> | null;
  gcs: number;
  injuries: Record<string, unknown>[];
  photos_documented: boolean;
  photo_references: string[];
  blood_products: Record<string, unknown>[];
  mtp_activated: boolean;
  trauma_team_activated: boolean;
  trauma_activation_time: number | null;
  trauma_level: number | null;
  disposition: string;
  assessed_by: string;
  assessed_at: number;
}

export interface StrokeAssessment {
  assessment_id: string;
  patient_id: string;
  last_known_well: number;
  symptom_onset: number | null;
  door_time: number;
  ct_time: number | null;
  door_to_ct_minutes: number | null;
  nihss: Record<string, unknown>;
  nihss_total: number;
  ct_findings: string;
  hemorrhage: boolean;
  lvo_suspected: boolean;
  tpa_eligible: boolean;
  tpa_contraindications: string[];
  tpa_given: boolean;
  tpa_time: number | null;
  door_to_needle_minutes: number | null;
  thrombectomy_candidate: boolean;
  neuro_ir_activated: boolean;
  bp_management: string;
  stroke_type: string;
  assessed_by: string;
  assessed_at: number;
}

export interface CardiacEvent {
  event_id: string;
  patient_id: string;
  chief_complaint: string;
  symptom_onset: number | null;
  door_time: number;
  first_ecg_time: number | null;
  door_to_ecg_minutes: number | null;
  ecg_findings: Record<string, unknown>;
  biomarkers: Record<string, unknown>;
  event_type: string;
  timi_score: number | null;
  heart_score: number | null;
  cath_lab_activated: boolean;
  cath_lab_activation_time: number | null;
  pci_performed: boolean;
  door_to_balloon_minutes: number | null;
  culprit_vessel: string | null;
  interventions: string[];
  antiplatelet_therapy: string[];
  anticoagulation: string | null;
  complications: string[];
  disposition: string;
  documented_by: string;
  documented_at: number;
}

export interface SepsisAssessment {
  assessment_id: string;
  patient_id: string;
  suspected_source: string;
  sepsis_identified_at: number;
  sirs_criteria: Record<string, unknown>;
  qsofa: Record<string, unknown>;
  sofa_score: number | null;
  severity: string;
  lactate_levels: Record<string, unknown>[];
  hour_1_bundle: Record<string, unknown>;
  hour_3_bundle: Record<string, unknown> | null;
  cultures_before_abx: boolean;
  antibiotics: Record<string, unknown>[];
  time_to_antibiotics_minutes: number | null;
  fluid_resuscitation: Record<string, unknown>;
  vasopressors_required: boolean;
  vasopressors: string[];
  icu_admission: boolean;
  outcome: string | null;
  assessed_by: string;
  assessed_at: number;
}

export interface EMSHandoff {
  report_id: string;
  patient_id: string | null;
  unit_number: string;
  crew: string[];
  dispatch_time: number;
  on_scene_time: number;
  depart_scene_time: number;
  arrival_time: number;
  transport_minutes: number;
  scene_location: string;
  dispatch_reason: string;
  demographics: Record<string, unknown>;
  chief_complaint: string;
  mechanism: string | null;
  sample_history: Record<string, unknown> | null;
  vital_signs: Record<string, unknown>[];
  gcs: number | null;
  interventions: Record<string, unknown>[];
  medications: Record<string, unknown>[];
  iv_access: string[];
  ecg_rhythm: string | null;
  twelve_lead_transmitted: boolean;
  stroke_alert: boolean;
  stemi_alert: boolean;
  trauma_alert: boolean;
  trauma_level: number | null;
  receiving_physician: string | null;
  handoff_time: number;
  notes: string | null;
}

// ============================================================================
// Nursing Documentation
// ============================================================================

export interface MedicationAdministrationRecord {
  patient_id: string;
  date: string;
  scheduled_medications: Record<string, unknown>[];
  prn_medications: Record<string, unknown>[];
  infusions: Record<string, unknown>[];
}

export interface IntakeOutputRecord {
  patient_id: string;
  date: string;
  shift: string;
  intake: Record<string, unknown>[];
  output: Record<string, unknown>[];
  totals: Record<string, unknown>;
  fluid_restriction_ml: number | null;
  target_output_ml: number | null;
  documented_by: string;
}

export interface NursingCarePlan {
  care_plan_id: string;
  patient_id: string;
  admission_date: string;
  nursing_diagnoses: Record<string, unknown>[];
  goals: Record<string, unknown>[];
  interventions: Record<string, unknown>[];
  education_needs: Record<string, unknown>[];
  discharge_planning: Record<string, unknown>;
  created_by: string;
  created_at: number;
  updated_by: string;
  updated_at: number;
}

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

export interface IVSiteAssessment {
  assessment_id: string;
  patient_id: string;
  line_id: string;
  line_type: string;
  insertion_site: string;
  insertion_time: number;
  inserted_by: string;
  catheter_size: string;
  catheter_length_cm: number | null;
  lumens: number | null;
  site_assessment: Record<string, unknown>;
  dressing_type: string;
  dressing_date: string;
  tubing_change_date: string | null;
  flush_solution: string | null;
  current_infusions: string[];
  complications: string[];
  assessed_at: number;
  assessed_by: string;
}

export interface ShiftHandoff {
  handoff_id: string;
  patient_id: string;
  from_nurse: string;
  to_nurse: string;
  handoff_time: number;
  situation: Record<string, unknown>;
  background: Record<string, unknown>;
  assessment: Record<string, unknown>;
  recommendation: Record<string, unknown>;
  safety_checks: Record<string, unknown>;
  pending_tasks: Record<string, unknown>[];
  questions: string | null;
  acknowledged: boolean;
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

export interface BurnAssessment {
  assessment_id: string;
  patient_id: string;
  burn_cause: string;
  burn_time: number | null;
  tbsa_regions: Record<string, unknown>;
  total_tbsa_percent: number;
  burn_depths: Record<string, unknown>[];
  inhalation_injury: boolean;
  inhalation_signs: string[];
  circumferential: boolean;
  circumferential_locations: string[];
  escharotomy: Record<string, unknown> | null;
  fluid_resuscitation: Record<string, unknown>;
  pain_management: string;
  tetanus_updated: boolean;
  burn_center_criteria: boolean;
  photos_documented: boolean;
  photo_references: string[];
  assessed_by: string;
  assessed_at: number;
}

export interface PsychiatricAssessment {
  assessment_id: string;
  patient_id: string;
  chief_complaint: string;
  mental_status_exam: Record<string, unknown>;
  suicide_risk: Record<string, unknown>;
  homicidal_risk: Record<string, unknown>;
  substance_use: Record<string, unknown>;
  psych_history: Record<string, unknown>;
  psych_medications: string[];
  medication_compliant: boolean | null;
  social_history: Record<string, unknown>;
  legal_status: string;
  safety_precautions: string[];
  disposition: string;
  safety_plan: Record<string, unknown> | null;
  assessed_by: string;
  assessed_at: number;
}

export interface ToxicologyAssessment {
  assessment_id: string;
  patient_id: string;
  exposure_type: string;
  substances: Record<string, unknown>[];
  exposure_time: number | null;
  exposure_route: string;
  intent: string;
  symptoms: string[];
  toxidrome: string | null;
  poison_control_contacted: boolean;
  poison_control_case: string | null;
  poison_control_recs: string | null;
  decontamination: string[];
  antidotes: Record<string, unknown>[];
  lab_studies: Record<string, unknown>;
  supportive_care: string[];
  observation_hours: number | null;
  disposition: string;
  assessed_by: string;
  assessed_at: number;
}

export interface MassCasualtyIncident {
  incident_id: string;
  incident_name: string;
  location: string;
  incident_time: number;
  mci_level: string;
  estimated_casualties: number;
  patients: Record<string, unknown>[];
  triage_officer: string;
  incident_commander: string;
  resources: string[];
  status_updates: Record<string, unknown>[];
  deactivation_time: number | null;
}

export interface IntubationRecord {
  record_id: string;
  patient_id: string;
  indication: string;
  pre_assessment: Record<string, unknown>;
  preoxygenation: string;
  preoxygenation_spo2: number | null;
  medications: Record<string, unknown>[];
  laryngoscope: string;
  blade: string;
  cormack_lehane_grade: number;
  ett_size: number;
  ett_depth_cm: number;
  cuff_inflated: boolean;
  cuff_pressure_cmh2o: number | null;
  attempts: number;
  successful: boolean;
  confirmation: string[];
  etco2: number | null;
  cxr_ordered: boolean;
  complications: string[];
  ventilator_settings: Record<string, unknown> | null;
  performed_by: string;
  assisted_by: string | null;
  procedure_time: number;
}

export interface LacerationRepair {
  record_id: string;
  patient_id: string;
  location: string;
  mechanism: string;
  injury_time: number | null;
  wound: Record<string, unknown>;
  neuro_before: Record<string, unknown>;
  tetanus: Record<string, unknown>;
  anesthesia: Record<string, unknown>;
  wound_explored: boolean;
  exploration_findings: string | null;
  foreign_body: string | null;
  irrigated: boolean;
  irrigation: string | null;
  closure: Record<string, unknown>;
  neuro_after: Record<string, unknown>;
  dressing: string;
  antibiotics: string | null;
  follow_up: string;
  suture_removal_days: number | null;
  photo_documented: boolean;
  performed_by: string;
  procedure_time: number;
}

export interface SplintCastRecord {
  record_id: string;
  patient_id: string;
  indication: string;
  location: string;
  immobilization_type: string;
  specific_type: string;
  material: string;
  position: string;
  padding_adequate: boolean;
  nv_check_before: Record<string, unknown>;
  nv_check_after: Record<string, unknown>;
  instructions_given: boolean;
  instructions: string[];
  weight_bearing: string;
  follow_up: string;
  ortho_referral: boolean;
  applied_by: string;
  application_time: number;
}

export interface PediatricAssessment {
  assessment_id: string;
  patient_id: string;
  age: Record<string, unknown>;
  weight_kg: number;
  weight_method: string;
  vital_signs: Record<string, unknown>;
  pat: Record<string, unknown>;
  pain: Record<string, unknown>;
  development: string | null;
  history: Record<string, unknown>;
  immunizations: string;
  abuse_screening: Record<string, unknown>;
  guardian_present: boolean;
  guardian_name: string | null;
  guardian_relationship: string | null;
  assessed_by: string;
  assessed_at: number;
}

export interface ObstetricEmergency {
  assessment_id: string;
  patient_id: string;
  gestational_age: Record<string, unknown>;
  gravida: number;
  para: number;
  living: number;
  prenatal_care: boolean;
  pregnancy_complications: string[];
  chief_complaint: string;
  emergency_type: string;
  contractions: Record<string, unknown> | null;
  fetal_assessment: Record<string, unknown>;
  vaginal_bleeding: Record<string, unknown> | null;
  cervical_exam: Record<string, unknown> | null;
  interventions: string[];
  ob_consulted: boolean;
  disposition: string;
  assessed_by: string;
  assessed_at: number;
}

// ============================================================================
// Laboratory
// ============================================================================

export interface SpecimenCollection {
  collection_id: string;
  patient_id: string;
  accession_number: string;
  test_ordered: string;
  specimen_type: string;
  collection_site: string;
  collection_time: number;
  collected_by: string;
  collection_method: string;
  container_type: string;
  container_count: number;
  volume_ml: number | null;
  fasting: boolean | null;
  special_handling: string[];
  chain_of_custody: boolean;
  patient_id_verified: boolean;
  verification_method: string;
  labeling_complete: boolean;
  transport_time: number | null;
  condition_on_receipt: string | null;
}

export interface ChainOfCustody {
  form_id: string;
  specimen_id: string;
  patient_id: string;
  reason: string;
  chain: Record<string, unknown>[];
  seal_intact: boolean;
  storage_conditions_met: boolean;
  final_disposition: string;
}

export interface LabQCRecord {
  qc_id: string;
  date: string;
  instrument: string;
  test: string;
  qc_level: number;
  lot_number: string;
  expected_range: string;
  observed_value: number;
  unit: string;
  within_range: boolean;
  action_taken: string | null;
  reviewed_by: string;
  review_time: number;
  comments: string | null;
}

export interface CriticalValueNotification {
  notification_id: string;
  patient_id: string;
  test_name: string;
  critical_value: string;
  unit: string;
  critical_range: string;
  verified_by: string | null;
  verification_time: number | null;
  provider_notified: string;
  notification_time: number;
  notification_method: string;
  read_back_verified: boolean;
  provider_acknowledgment: string | null;
  lab_technician: string;
  comments: string | null;
}

export interface SpecimenRejection {
  rejection_id: string;
  accession_number: string;
  patient_id: string;
  test_ordered: string;
  rejection_reason: string;
  rejection_details: string;
  recollection_required: boolean;
  provider_notified: boolean;
  notification_time: number | null;
  disposed: boolean;
  disposal_time: number | null;
  rejected_by: string;
  rejection_time: number;
}

// ============================================================================
// Physician Documentation
// ============================================================================

export interface PhysicianOrder {
  order_id: string;
  patient_id: string;
  category: string;
  order_text: string;
  priority: string;
  start_time: number;
  end_time: number | null;
  frequency: string | null;
  instructions: string | null;
  ordering_provider: string;
  order_time: number;
  verbal_order: boolean;
  read_back: boolean | null;
  cosign_required: boolean;
  cosigned_by: string | null;
  status: string;
  acknowledged_by: string | null;
  acknowledged_time: number | null;
}

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

export interface DischargeInstructions {
  instructions_id: string;
  patient_id: string;
  diagnosis: string;
  activity_restrictions: string[];
  diet: string;
  wound_care: string | null;
  medication_instructions: string;
  warning_signs: string[];
  call_doctor_if: string[];
  go_to_er_if: string[];
  follow_up_care: string[];
  resources: string[];
  language: string;
  interpreter_used: boolean;
  patient_verbalized_understanding: boolean;
  teach_back_used: boolean;
  given_to: string;
  recipient_relationship: string | null;
  provided_by: string;
  provided_time: number;
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

export interface ConsultationNote {
  consult_id: string;
  patient_id: string;
  requesting_provider: string;
  consulting_provider: string;
  specialty: string;
  urgency: string;
  reason: string;
  clinical_question: string;
  request_time: number;
  response_time: number | null;
  history: string;
  exam_findings: string;
  studies_reviewed: string[];
  assessment: string;
  recommendations: string[];
  follow_up: string;
  consultant_signature: string | null;
  signature_time: number | null;
}

export interface ProgressNote {
  note_id: string;
  patient_id: string;
  note_date: string;
  hospital_day: number;
  post_op_day: number | null;
  subjective: string;
  overnight_events: string;
  vital_signs: string;
  io_summary: string | null;
  exam: string;
  labs_studies: string;
  assessment: Record<string, unknown>[];
  plan: string[];
  disposition: string | null;
  code_status: string;
  discussed_with: string | null;
  author: string;
  note_time: number;
  cosigned_by: string | null;
}

// ============================================================================
// Surgical / Perioperative
// ============================================================================

export interface PreOperativeAssessment {
  assessment_id: string;
  patient_id: string;
  scheduled_procedure: string;
  procedure_datetime: string;
  surgeon: string;
  anesthesiologist: string | null;
  npo_status: string;
  site_verified: boolean;
  site_marked: boolean;
  consent_signed: boolean;
  blood_type_confirmed: boolean;
  blood_available: boolean;
  allergies_reviewed: boolean;
  medications_reviewed: boolean;
  medications_held: string[];
  labs_reviewed: boolean;
  imaging_reviewed: boolean;
  asa_class: string;
  airway_assessment: string;
  cardiac_risk: string | null;
  dvt_prophylaxis: boolean;
  antibiotic_prophylaxis: string | null;
  special_equipment: string[];
  pre_op_vitals: string;
  iv_access: boolean;
  checklist_complete: boolean;
  notes: string | null;
  assessed_by: string;
  assessed_at: number;
}

export interface OperativeNote {
  note_id: string;
  patient_id: string;
  surgery_date: string;
  pre_op_diagnosis: string[];
  post_op_diagnosis: string[];
  procedure_performed: string;
  cpt_codes: string[];
  surgeons: Record<string, unknown>[];
  anesthesia_team: string[];
  anesthesia_type: string;
  surgical_approach: string;
  incision: string;
  findings: string;
  procedure_details: string;
  specimens: Record<string, unknown>[];
  estimated_blood_loss: number;
  fluids_given: string;
  blood_products: string[];
  drains: Record<string, unknown>[];
  implants: Record<string, unknown>[];
  wound_closure: string;
  dressing: string;
  complications: string | null;
  condition_at_end: string;
  disposition: string;
  time_in_or: number;
  time_out_or: number;
  dictated_by: string;
  dictation_time: number;
}

export interface PostOperativeNote {
  note_id: string;
  patient_id: string;
  surgery_date: string;
  procedure: string;
  post_op_day: number;
  condition: string;
  pain_score: number;
  pain_management: string;
  vitals_stable: boolean;
  diet: string;
  activity: string;
  wound: string;
  drain_output: string | null;
  io_balance: string | null;
  foley: string | null;
  dvt_prophylaxis: string;
  complications: string | null;
  labs: string | null;
  imaging: string | null;
  plan: string[];
  estimated_discharge: string | null;
  written_by: string;
  note_time: number;
}

export interface AnesthesiaRecord {
  record_id: string;
  patient_id: string;
  date: string;
  procedure: string;
  anesthesiologist: string;
  crna: string | null;
  asa_class: string;
  anesthesia_type: string;
  pre_assessment: Record<string, unknown>;
  airway: Record<string, unknown>;
  induction: Record<string, unknown>;
  maintenance: Record<string, unknown>;
  intraop_events: Record<string, unknown>[];
  vital_signs: Record<string, unknown>[];
  medications: Record<string, unknown>[];
  fluids: Record<string, unknown>[];
  blood_products: string[];
  emergence: Record<string, unknown>;
  anesthesia_time_minutes: number;
  complications: string[];
  pacu_handoff: Record<string, unknown>;
}

// ============================================================================
// Diagnostics
// ============================================================================

export interface RadiologyOrder {
  order_id: string;
  patient_id: string;
  study_type: string;
  body_part: string;
  laterality: string | null;
  indication: string;
  priority: string;
  ordering_provider: string;
  order_time: number;
  contrast: boolean;
  allergies_reviewed: boolean;
  creatinine_checked: boolean | null;
  pregnancy_checked: boolean | null;
  special_instructions: string | null;
  status: string;
}

export interface RadiologyReport {
  report_id: string;
  patient_id: string;
  order_id: string;
  accession_number: string;
  study_type: string;
  body_part: string;
  study_datetime: number;
  technique: string;
  contrast: string | null;
  comparison: string | null;
  clinical_history: string;
  findings: string;
  impression: string[];
  recommendations: string | null;
  critical_finding: boolean;
  critical_communicated: Record<string, unknown> | null;
  radiologist: string;
  status: string;
  preliminary_time: number | null;
  final_time: number | null;
  dicom_study_uid: string | null;
  image_ipfs_hash: string | null;
}

export interface PathologyReport {
  report_id: string;
  patient_id: string;
  accession_number: string;
  specimen_type: string;
  collection_date: string;
  received_date: string;
  clinical_history: string;
  specimen_source: string;
  gross_description: string;
  microscopic_description: string;
  special_stains: Record<string, unknown>[];
  ihc: Record<string, unknown>[];
  molecular: Record<string, unknown>[];
  diagnosis: string[];
  synoptic: Record<string, unknown> | null;
  comment: string | null;
  pathologist: string;
  report_date: string;
  status: string;
  addenda: Record<string, unknown>[];
}

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
  family_members: Record<string, unknown>[];
  genetic_conditions: Record<string, unknown>[];
  three_gen_complete: boolean;
  last_updated: number;
  updated_by: string;
}

export interface BloodTypeScreen {
  test_id: string;
  patient_id: string;
  abo_type: string;
  rh_type: string;
  antibody_screen: Record<string, unknown>;
  collection_time: number;
  expiration: number;
  performed_by: string;
  verified_by: string;
}

export interface TransfusionRecord {
  transfusion_id: string;
  patient_id: string;
  unit_number: string;
  product_type: string;
  abo_rh: string;
  indication: string;
  consent_obtained: boolean;
  pre_vitals: Record<string, unknown>;
  patient_verified: Record<string, unknown>;
  start_time: number;
  end_time: number | null;
  volume_ml: number;
  rate: number;
  monitoring_vitals: Record<string, unknown>[];
  reaction: Record<string, unknown> | null;
  post_vitals: Record<string, unknown> | null;
  administered_by: string;
}

// ============================================================================
// E-Prescription / Appointments / End-of-Life
// ============================================================================

export interface ElectronicPrescription {
  rx_id: string;
  patient_id: string;
  medication_name: string;
  generic_name: string;
  ndc_code: string | null;
  rxnorm_code: string | null;
  strength: string;
  form: string;
  directions: string;
  quantity: number;
  quantity_unit: string;
  days_supply: number;
  refills: number;
  daw: boolean;
  prescriber: Record<string, unknown>;
  pharmacy: Record<string, unknown>;
  written_date: string;
  effective_date: string;
  expiration_date: string;
  diagnosis_codes: string[];
  prior_auth: Record<string, unknown> | null;
  schedule: string | null;
  status: string;
  transmitted_at: number | null;
  pharmacist_notes: string | null;
  override_interactions: boolean;
  override_reason: string | null;
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

export interface DeathCertificate {
  certificate_id: string;
  patient_id: string;
  decedent_name: string;
  date_of_birth: string;
  date_of_death: string;
  time_of_death: string;
  place_of_death: Record<string, unknown>;
  manner_of_death: string;
  cause_of_death: Record<string, unknown>;
  autopsy_performed: boolean;
  autopsy_findings_available: boolean | null;
  certifying_physician: string;
  physician_license: string;
  date_certified: string;
  me_case: boolean;
  me_case_number: string | null;
}

export interface AutopsyRequest {
  request_id: string;
  patient_id: string;
  requesting_physician: string;
  reason: string;
  clinical_summary: string;
  questions: string[];
  family_consent: boolean;
  consent_signed_by: string | null;
  consenter_relationship: string | null;
  request_date: string;
  status: string;
  pathologist_assigned: string | null;
  scheduled_date: string | null;
}

export interface AutopsyReport {
  report_id: string;
  patient_id: string;
  autopsy_date: string;
  pathologist: string;
  external_exam: string;
  internal_exam: Record<string, unknown>;
  microscopic: string;
  toxicology: string | null;
  diagnoses: string[];
  cause_of_death: Record<string, unknown>;
  opinion: string;
  report_date: string;
}

export interface PatientSatisfactionSurvey {
  survey_id: string;
  patient_id: string;
  visit_id: string;
  visit_date: string;
  department: string;
  survey_type: string;
  responses: Record<string, unknown>[];
  overall_rating: number;
  nps_score: number;
  comments: string | null;
  submitted_at: number;
  anonymous: boolean;
  follow_up_requested: boolean;
  contact_method: string | null;
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

export interface SampleHistoryRecord {
  id: string;
  patient_id: string;
  signs_symptoms: unknown;
  past_medical_history: unknown;
  events_leading: string;
  last_intake: Record<string, unknown> | null;
  medications: unknown;
  allergies_snapshot: unknown;
  collected_by: string;
  collected_at: string;
  created_at: string;
  updated_at: string;
  facility_id: string | null;
  is_active: boolean;
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
}

export interface NotificationCreateResult {
  success: boolean;
  notification_id: string;
}

export interface RejectionCreateResult {
  success: boolean;
  rejection_id: string;
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

export interface InsuranceClaimCreateResult {
  success: boolean;
  claim_id: string;
  total_charge: number;
  [key: string]: unknown;
}

export interface CdsAlertCreateResult {
  success: boolean;
  alert_id: string;
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

export interface WearableReadingCreateResult {
  success: boolean;
  reading_id: string;
  is_abnormal: boolean;
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

export interface SyncDeviceCreateResult {
  success: boolean;
  device_id: string;
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

export interface DrugReference {
  drug_id: string;
  name: string;
  generic_name: string;
  brand_names: string[];
  drug_class: string;
  route: string;
  form: string;
  common_doses: string[];
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

export interface DemoInfo {
  project: string;
  hackathon: string;
  track: string;
  description: string;
  auth_mode: string;
  dev_mode: boolean;
  demo_login_endpoint: string;
  demo_instructions: { step_1: string; step_2: string; step_3: string; step_4: string };
  wallet_auth: { format: string; example: string; header: string; note: string };
  features: string[];
  endpoints: {
    auth: { register: string; login: string; me: string };
    patients: { register: string; update: string; list: string; get: string; my_records: string };
    emergency: { access: string; simulate_nfc: string; access_logs: string };
    rbac: { assign_role: string; revoke_role: string; list_users: string };
    health: string;
  };
  auth_header: string;
}

export interface PatientEmergencyRecords {
  patient_id: string;
  code_blues: Record<string, unknown>[];
  trauma_assessments: Record<string, unknown>[];
  stroke_assessments: Record<string, unknown>[];
  sepsis_assessments: Record<string, unknown>[];
}

/**
 * A nurse task. Medication tasks come from active medication reminders;
 * monitoring tasks come from outstanding `nursing` physician orders, classified
 * by what the order actually says. An order that is neither an observation nor
 * a dressing stays `nursing_care` rather than being forced into one of the two.
 */
export type NurseTask =
  | {
      id: string;
      type: 'medication_admin';
      patient_id: string;
      medication: string;
      dosage: string;
      scheduled_at: number;
      priority: 'high' | 'medium';
    }
  | {
      id: string;
      type: 'vital_signs' | 'wound_care' | 'nursing_care';
      patient_id: string;
      frequency: string;
      /** Last recorded execution, falling back to when the order was due. */
      last_done: number;
      priority: 'low' | 'medium' | 'high';
      instructions: string | null;
    };

export interface NurseTasksResponse {
  success: true;
  tasks: NurseTask[];
}

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

/**
 * `POST /api/insurance/eligibility`. This used to be shadowed by a second,
 * cruder handler registered on the same path (see IMPLEMENTATION_PLAN.md
 * Round 19) — that duplicate registration was removed, so this richer shape
 * (real policy-date/deductible/plan-type logic) is what actually runs now.
 */
export type CheckEligibilityResponse =
  | {
      success: true;
      check_id: string;
      patient_id: string;
      checked_at: number;
      eligible: false;
      coverage_active: false;
      plan_name: null;
      member_id: string;
      payer_id: string;
      message: string;
      benefits: null;
      service_coverage: null;
    }
  | {
      success: true;
      check_id: string;
      patient_id: string;
      checked_at: number;
      eligible: boolean;
      coverage_active: boolean;
      plan_name: string;
      plan_type: string | null;
      member_id: string;
      payer_id: string;
      payer_name: string;
      policy_number: string | null;
      group_number: string | null;
      effective_date: string;
      termination_date: string | null;
      benefits: PolicyFinancials;
      service_coverage: {
        service_type: string;
        covered: boolean;
        authorization_required: boolean;
        prior_auth_phone: string | null;
      };
    };

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

export interface PatientAnalyticsResponse {
  /**
   * Active patients per administrative gender, aggregated in the query.
   * Patients who supplied none are counted under `not_recorded`, so the
   * buckets always sum to `total_population`.
   */
  gender_distribution: Record<string, number>;
  total_population: number;
}

export interface AppointmentAnalyticsResponse {
  /** Keys are Rust Debug-formatted `AppointmentStatus` variants, e.g. "Scheduled". */
  status_distribution: Record<string, number>;
  total_appointments: number;
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

export interface LockscreenMedicalId {
  format: 'lockscreen';
  design: { background: string; text: string; accent: string };
  blood_type: { value: string; font_size: string; background: string; text_color: string };
  allergies_line: { text: string; font_size: string; color: string };
  dnr_line: {
    text: string;
    verified: boolean;
    verified_by: string | null;
    verified_at: string | null;
    document_ref: string | null;
    font_size: string;
    color: string;
    background: string;
  } | null;
  /** `value` is null when the encrypted profile could not be read. */
  name: { value: string | null; font_size: string };
  /**
   * Verified guardian when one exists, otherwise the patient's own first
   * recorded contact; null when neither is on file. `verified` distinguishes
   * the two — never present an unverified number as system-confirmed.
   */
  emergency_contact: EmergencyContactRef | null;
  qr_url: string;
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

export interface EmergencyMedicalId {
  type: 'EMERGENCY_MEDICAL_ID';
  warning: string;
  patient: { name: string; dob: string };
  blood_type: { value: string; compatible_donors: string[] };
  critical_allergies: Array<{ allergen: string; severity: string; reaction: string | null }>;
  dnr_status: {
    status: 'ACTIVE' | 'UNVERIFIED' | 'NOT_ON_FILE';
    verified: boolean;
    verified_by: string | null;
    verified_at: string | null;
    document_ref: string | null;
    warning: string | null;
    verify_directive?: boolean;
  };
  organ_donor: boolean;
  medications: string[];
  conditions: string[];
  emergency_contact: EmergencyContactRef | null;
  /** The patient's recorded language preference; null when they set none. */
  primary_language: string | null;
  access_logged: true;
  access_timestamp: string;
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
