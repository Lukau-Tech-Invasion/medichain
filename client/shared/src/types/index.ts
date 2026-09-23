/**
 * MediChain Shared Types
 * 
 * These types mirror the backend Rust structures for type safety.
 */

// ============================================================================
// User & Role Types
// ============================================================================

export type Role = 
  | 'Admin' 
  | 'Doctor' 
  | 'Nurse' 
  | 'LabTechnician' 
  | 'Pharmacist' 
  | 'Patient';

/**
 * User authenticated via blockchain wallet
 */
export interface User {
  /** SS58 encoded wallet address (primary identifier) */
  wallet_address: string;
  /** Optional display username */
  username?: string;
  /** Full name of the user */
  name: string;
  /** Role in the system */
  role: Role;
  /** When the user was created (ISO 8601) */
  created_at: string;
  /** Wallet address of admin who created this user */
  created_by?: string;
  /** Patient ID if this user is linked to a patient record */
  linked_patient_id?: string;
  /** Email address */
  email?: string;
  /** Phone number */
  phone?: string;
  /** Department (for healthcare workers) */
  department?: string;
  /** Specialty (for doctors) */
  specialty?: string;
  /** License/registration number */
  license_number?: string;
  /** User status: active, inactive, suspended, pending */
  status?: 'active' | 'inactive' | 'suspended' | 'pending';
  /** Last login timestamp (ISO 8601) */
  last_login?: string;
}

/**
 * User info returned from wallet auth endpoints
 */
export interface WalletUserInfo {
  wallet_address: string;
  name: string;
  username?: string;
  role: Role;
  created_at?: string;
  linked_patient_id?: string;
  email?: string;
  phone?: string;
  department?: string;
  specialty?: string;
  license_number?: string;
  status?: string;
  last_login?: string;
}

/**
 * What the signed-in user's role permits, as computed by the server.
 *
 * Mirrors the `Role` methods the API authorizes with, so the client no longer
 * keeps its own copy of the role hierarchy. Three copies existed before this:
 * `authStore.isHealthcareProvider`/`canEditMedicalRecords`, the
 * `HEALTHCARE_PROVIDER_ROLES`/`RECORD_EDITOR_ROLES` tables in the (unused)
 * shared `useAuth` hook, and the server itself — free to drift apart.
 *
 * **Affordance hints only.** Use these to decide what to render; never to
 * decide whether an operation is allowed. The server authorizes every request
 * on its own and ignores anything a client claims about its permissions.
 */
export interface UserPermissions {
  is_admin: boolean;
  is_healthcare_provider: boolean;
  can_view_medical_records: boolean;
  can_edit_medical_records: boolean;
}

/**
 * The authenticated caller's own identity — the `GET /api/auth/me` response.
 *
 * The single source for the frontend's provider context. Anything a form might
 * otherwise ask a signed-in clinician to type belongs here.
 */
export interface CurrentUser extends WalletUserInfo {
  permissions: UserPermissions;
}

/**
 * Request to bootstrap first admin
 */
export interface BootstrapAdminRequest {
  wallet_address: string;
  name: string;
  username?: string;
  secret_key: string;
}

/**
 * Response from bootstrap admin
 */
export interface BootstrapAdminResponse {
  success: boolean;
  admin: WalletUserInfo;
  message: string;
}

/**
 * Request to register a new user with wallet
 */
export interface WalletRegisterRequest {
  wallet_address: string;
  name: string;
  username?: string;
  role: string;
  linked_patient_id?: string;
  email?: string;
  phone?: string;
  department?: string;
  specialty?: string;
  license_number?: string;
}

/**
 * Response from wallet registration
 */
export interface WalletRegisterResponse {
  success: boolean;
  wallet_address: string;
  role: string;
  message: string;
}

/**
 * Request to login with wallet
 */
export interface WalletLoginRequest {
  wallet_address: string;
}

/**
 * Response from wallet login
 */
export interface WalletLoginResponse {
  success: boolean;
  user?: WalletUserInfo;
  message: string;
}

// ============================================================================
// Patient Types
// ============================================================================

export type BloodType = 
  | 'A+' | 'A-' 
  | 'B+' | 'B-' 
  | 'AB+' | 'AB-' 
  | 'O+' | 'O-';

/**
 * Allergy severity levels (FHIR R5 AllergyIntolerance compatible)
 */
export type AllergySeverity = 'mild' | 'moderate' | 'severe' | 'unknown';

/**
 * Structured allergy information with severity
 */
export interface Allergy {
  /** Name of the allergen (e.g., "Penicillin", "Peanuts") */
  name: string;
  /** Severity of the allergic reaction */
  severity: AllergySeverity;
  /** Clinical reaction description (optional) */
  reaction?: string;
  /** When the allergy was verified by a healthcare provider */
  verified_at?: string;
}

/**
 * Emergency contact information (enhanced with priority and decision authority)
 */
export interface EmergencyContact {
  /** Full name of the emergency contact */
  name: string;
  /** Phone number with country code (e.g., "+234-801-234-5678") */
  phone: string;
  /** Relationship to patient (e.g., "Spouse", "Mother", "Brother") */
  relationship: string;
  /** Priority order (1 = primary contact) */
  priority?: number;
  /** Can this contact make medical decisions for the patient? */
  can_make_medical_decisions?: boolean;
  /** Preferred language for communication (ISO 639-1 code) */
  language?: string;
}

/**
 * Insurance coverage type (FHIR Coverage compatible)
 */
export type InsuranceCoverageType = 
  | 'Public'
  | 'Private'
  | 'Employer'
  | 'NHIS'
  | 'Community'
  | 'None';

/**
 * Insurance information (FHIR Coverage resource compatible)
 */
export interface InsuranceInfo {
  /** Insurance provider name */
  provider: string;
  /** Policy number */
  policy_number: string;
  /** Group number (optional) */
  group_number?: string;
  /**
   * Coverage start date (ISO 8601), or null when the patient did not give one.
   *
   * Nullable because the profile form marks both dates optional — only
   * provider and policy number carry an asterisk. It used to be a bare
   * `string` and the page posted `''` for a blank date, which stored a policy
   * "valid from ''": not a date and not an absence, and any later question of
   * "is this cover current?" compares against it.
   */
  valid_from?: string | null;
  /** Coverage end date (ISO 8601), or null when the patient did not give one. */
  valid_to?: string | null;
  /** Type of coverage */
  coverage_type: InsuranceCoverageType;
  /** Is the insurance currently active? */
  is_active?: boolean;
}

/**
 * Geographic coordinates (for rural areas without formal addresses)
 */
export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Patient address (FHIR Address compatible)
 */
export interface Address {
  /** Street address line */
  street?: string;
  /** City */
  city: string;
  /** State/Province/Region */
  state?: string;
  /** Country (ISO 3166-1 alpha-2 code, e.g., "NG", "KE", "GH") */
  country: string;
  /** Postal/ZIP code */
  postal_code?: string;
  /** GPS coordinates for areas without formal addresses (critical for rural Africa) */
  coordinates?: GeoCoordinates;
}

/**
 * Healthcare provider information
 */
export interface HealthcareProvider {
  /** Provider's full name */
  name: string;
  /** Phone number with country code */
  phone: string;
  /** Healthcare facility name */
  facility?: string;
  /** Specialty (e.g., "General Practice", "Cardiology") */
  specialty?: string;
  /** License/registration number */
  license_number?: string;
}

/**
 * Patient preferences and settings
 */
export interface PatientPreferences {
  /** Show medical ID when device is locked (for emergency access) */
  show_when_locked?: boolean;
  /** Enable location sharing during emergencies */
  enable_location_sharing?: boolean;
  /** Automatically notify family/emergency contacts during emergency */
  auto_notify_family?: boolean;
  /** Preferred display language for medical ID (ISO 639-1 code) */
  display_language?: string;
}

/**
 * Advanced directives document reference
 */
export interface AdvancedDirectives {
  /** IPFS hash of the advanced directives document */
  ipfs_hash: string;
  /** Type of directive (e.g., "living_will", "healthcare_proxy", "dnr_order") */
  directive_type: string;
  /** Date the directive was signed (ISO 8601) */
  signed_date: string;
  /** Witness or notary information */
  witness_info?: string;
  /** When uploaded to system (Unix timestamp) */
  uploaded_at: number;
  /** Who uploaded the document */
  uploaded_by: string;
}

/**
 * Family notification settings
 */
export interface FamilyNotificationSettings {
  /** Enable automatic notifications */
  enabled?: boolean;
  /** Notification methods: "sms", "email", "push" */
  notification_methods?: string[];
  /** Delay before sending notifications (in minutes, 0 = immediate) */
  delay_minutes?: number;
  /** Custom message to include in notifications */
  custom_message?: string;
}

export interface EmergencyInfo {
  patient_id: string;
  blood_type: BloodType;
  /** Structured allergies with severity levels */
  allergies: Allergy[];
  current_medications: string[];
  chronic_conditions: string[];
  emergency_contacts: EmergencyContact[];
  organ_donor: boolean;
  dnr_status: boolean;
  /** 
   * Preferred languages for communication (ISO 639-1 codes, e.g., ["en", "yo", "ha"])
   * First language is primary. Critical for Africa's 2000+ languages.
   */
  languages?: string[];
  last_updated: string;
}

export interface PatientProfile {
  patient_id: string;
  /**
   * The wallet bound to this patient, from the row rather than the encrypted
   * profile. `null` when none was bound at registration.
   */
  wallet_address?: string | null;
  full_name: string;
  date_of_birth: string;
  /** Returned by the API for neonatal records, where the date alone is not enough. */
  time_of_birth?: string;
  national_id: string;
  /**
   * Both of these are returned by `PatientProfile` on the API side and were
   * missing here, so any screen reading them was reading an untyped field.
   */
  gender?: string;
  phone?: string;
  emergency_info: EmergencyInfo;
  /** Patient's address (optional, FHIR compatible) */
  address?: Address;
  /** Insurance information (optional, FHIR Coverage compatible) */
  insurance?: InsuranceInfo;
  /** Primary healthcare provider */
  primary_doctor?: HealthcareProvider;
  /** Community Health Worker (Africa-specific: critical for rural healthcare access) */
  community_health_worker?: HealthcareProvider;
  /** Patient preferences and settings (lock screen, notifications, etc.) */
  preferences?: PatientPreferences;
  /** Advanced directives documents (living will, healthcare proxy, etc.) */
  advanced_directives?: AdvancedDirectives[];
  /** Family notification settings */
  family_notifications?: FamilyNotificationSettings;
  created_at: string;
  last_updated: string;
}

export interface RegisterPatientRequest {
  full_name: string;
  wallet_address?: string;
  date_of_birth: string;
  national_id: string;
  blood_type: string;
  /** Allergies - simple strings (converted to Mild severity on backend) */
  allergies: string[];
  current_medications: string[];
  chronic_conditions: string[];
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  organ_donor: boolean;
  dnr_status: boolean;
  /** Preferred languages (ISO 639-1 codes), e.g., ["en", "yo", "ha"] */
  languages?: string[];
}

export interface RegisterPatientResponse {
  success: boolean;
  patient_id: string;
  nfc_tag_id: string;
  chain_status?: 'disabled' | 'pending' | 'finalized';
  blockchain_tx_hash?: string;
  message: string;
}

// ============================================================================
// Medical Records Types
// ============================================================================

export type RecordType = 
  | 'lab_result' 
  | 'imaging' 
  | 'prescription' 
  | 'consultation'
  | 'discharge_summary' 
  | 'vaccination' 
  | 'other';

export interface MedicalRecordReference {
  content_hash: string;
  metadata_hash: string;
  record_type: RecordType;
  uploaded_at: number;
  content_checksum: string;
}

export interface UploadMedicalRecordRequest {
  patient_id: string;
  content_base64: string;
  filename: string;
  content_type: string;
  record_type: RecordType;
}

export interface UploadMedicalRecordResponse {
  success: boolean;
  ipfs_hash: string;
  metadata_hash: string;
  record_reference: MedicalRecordReference;
  record_chain_status: 'disabled' | 'pending' | 'finalized';
  record_blockchain_tx_hash?: string;
  access_chain_status: 'disabled' | 'pending' | 'finalized';
  access_blockchain_tx_hash?: string;
  message: string;
}

export interface DownloadMedicalRecordRequest {
  content_hash: string;
  metadata_hash: string;
}

export interface DownloadMedicalRecordResponse {
  success: boolean;
  content_base64: string;
  filename: string;
  content_type: string;
  record_type: RecordType;
  uploaded_by: string;
  uploaded_at: number;
}

// ============================================================================
// NFC & Emergency Access Types
// ============================================================================

export interface NFCTagData {
  tag_id: string;
  patient_id: string;
  hash: string;
  created_at: string;
}

export interface EmergencyAccessRequest {
  nfc_tag_id: string;
  accessor_id: string;
  accessor_role: string;
  location?: string;
}

export interface EmergencyAccessResponse {
  success: boolean;
  access_id: string;
  emergency_info?: EmergencyInfo;
  chain_audit_status?: 'disabled' | 'pending' | 'finalized';
  blockchain_tx_hash?: string;
  message: string;
}

/** Strict emergency path: all authorisation bindings are enforced server-side. */
export interface GrantBoundEmergencyAccessRequest {
  nfc_tag_id: string;
  device_id: string;
  work_context_id: string;
  reason_code: string;
  reason_text?: string;
}

export interface GrantBoundEmergencyAccessResponse {
  grant_id: string;
  expires_at: string;
  emergency_info: EmergencyInfo;
}

export interface NFCCardInfo {
  card_id: string;
  patient_id: string;
  card_hash: string;
  national_id_type: string;
  status: 'Active' | 'Suspended' | 'Revoked';
  created_at: number;
  last_used_at?: number;
}

export interface GenerateNFCCardRequest {
  patient_id: string;
  national_id_type: string;
}

export interface GenerateNFCCardResponse {
  success: boolean;
  card_id: string;
  card_hash: string;
  qr_code_base64?: string;
  message: string;
}

// ============================================================================
// Access Log Types
// ============================================================================

export interface AccessLogEntry {
  access_id: string;
  patient_id: string;
  accessor_id: string;
  /**
   * The accessor's display name, when the server could resolve their wallet.
   *
   * Null for an accessor who is not a known user. A patient cannot resolve a
   * wallet themselves — the provider directory is staff-only — so without this
   * their own access log reads as a list of SS58 addresses.
   */
  accessor_name?: string | null;
  accessor_role: string;
  access_type: string;
  location?: string;
  timestamp: string;
  emergency: boolean;
}

export interface AccessLogsResponse {
  patient_id: string;
  access_logs: AccessLogEntry[];
  total_accesses: number;
}

// ============================================================================
// Real-Time Event Types
// ============================================================================

export interface PushEvent {
  /** One of: "cds_alert", "reminder_due", "lab_result", "notification" */
  event_type: string;
  /** Optional patient identifier the event relates to */
  patient_id?: string;
  /**
   * The event's own JSON body.
   *
   * The named fields are the ones consumers actually read — `Layout` in both
   * portals renders `message`, `title` and `severity` straight into a toast,
   * and `JitsiMeetComponent` keys off `session_id` and `event`. They were
   * reached through `any`, so a backend rename would have produced
   * `undefined` in a clinician's alert with nothing failing to say so.
   *
   * The index signature keeps the rest reachable without pretending it is
   * typed: the payload genuinely varies by `event_type`.
   */
  payload: {
    message?: string;
    title?: string;
    severity?: string;
    session_id?: string;
    event?: string;
    [key: string]: unknown;
  };
  /** Unix timestamp (seconds since epoch) */
  timestamp: number;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Normalized API error surfaced by the client (and passed to the `onError`
 * callback). Decoded from the canonical wire envelope {@link ApiErrorEnvelope}.
 */
export interface ApiError {
  success: false;
  error: string;
  code: string;
}

/**
 * Canonical error envelope returned by the backend (Phase 9.5):
 * `{ "error": { "code", "message", "details"? } }`.
 */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface HealthCheckResponse {
  status: string;
  version: string;
  timestamp: string;
  blockchain_connected: boolean;
}

export interface IpfsHealthResponse {
  ipfs_connected: boolean;
  api_url: string;
  gateway_url: string;
}

// ============================================================================
// Role Management Types
// ============================================================================

export interface AssignRoleRequest {
  wallet_address: string;
  name: string;
  username?: string;
  role: string;
}

export interface AssignRoleResponse {
  success: boolean;
  wallet_address: string;
  role: string;
  message: string;
}

export interface RevokeRoleRequest {
  wallet_address: string;
}

export interface RevokeRoleResponse {
  success: boolean;
  wallet_address: string;
  message: string;
}

// ============================================================================
// Lab Result Submission Types (with Doctor Approval Workflow)
// ============================================================================

export type LabResultStatus = 'pending' | 'approved' | 'rejected';

export interface LabResultSubmission {
  id: string;
  patient_id: string;
  patient_name: string;
  test_name: string;
  test_category: string;
  results: LabTestResult[];
  notes: string;
  submitted_by: string;
  submitted_at: string;
  status: LabResultStatus;
  reviewed_by?: string;
  reviewed_at?: string;
  rejection_reason?: string;
  content_hash?: string;
  metadata_hash?: string;
}

export interface LabTestResult {
  parameter: string;
  value: string;
  unit: string;
  reference_range: string;
  flag?: 'normal' | 'high' | 'low' | 'critical';
}

export interface SubmitLabResultRequest {
  patient_id: string;
  test_name: string;
  test_category: string;
  results: LabTestResult[];
  notes?: string;
}

export interface SubmitLabResultResponse {
  success: boolean;
  submission_id: string;
  message: string;
}

export interface ReviewLabResultRequest {
  submission_id: string;
  action: 'approve' | 'reject';
  rejection_reason?: string;
}

export interface ReviewLabResultResponse {
  success: boolean;
  submission_id: string;
  status: LabResultStatus;
  message: string;
}

export interface PendingLabResultsResponse {
  submissions: LabResultSubmission[];
  total: number;
}

// ============================================================================
// Dashboard Response Types (from /api/dashboard/* endpoints)
// ============================================================================

/**
 * Doctor Dashboard Response
 * GET /api/dashboard/doctor
 */
export interface DoctorDashboardResponse {
  role: 'Doctor';
  patients: {
    total: number;
    list: PatientProfile[];
  };
  pending_lab_approvals: LabResultSubmission[];
  critical_values: unknown[];
  recent_code_blues: unknown[];
  active_orders: unknown[];
  pending_consults: unknown[];
  alerts: {
    pending_labs_count: number;
    critical_values_count: number;
    code_blues_count: number;
  };
}

/**
 * Nurse Dashboard Response
 * GET /api/dashboard/nurse
 */
/**
 * One patient row on the nurse dashboard.
 *
 * This is `DashboardPatient` on the API side, serialised as-is. The optional
 * fields below are read by NurseDashboardPage and are **not returned by
 * `/api/dashboard/nurse`** — they are optional here because that is the truth,
 * not because they are sometimes absent. Typing them as required would let the
 * page keep reading fields that can never arrive.
 *
 * See docs/TECHNICAL_DEBT_REGISTER.md, "Nurse dashboard ward fields".
 */
export interface NurseDashboardPatient {
  patient_id: string;
  health_id: string;
  full_name: string;
  date_of_birth: string;
  gender: string;
  blood_type?: string | null;
  allergies: string[];
  current_medications: string[];
  medical_conditions: string[];
  emergency_contact?: unknown;
  /** False when the row exists but its PHI could not be decrypted. */
  content_available: boolean;

  // --- The ward-orientation half of the list. ---
  //
  // These are returned now. They were declared optional and marked "not
  // returned by the API" because `/api/dashboard/nurse` served a bare
  // `DashboardPatient`, which carries none of them — so the columns the page
  // renders were permanently blank, and `room` was worse, falling back to
  // "Pending" for every bed on the ward.
  //
  // They stay optional because each still depends on a record existing: a
  // patient with no triage assessment has no bed and no acuity, and a patient
  // who has never been assessed for falls has no band. Absent means "not
  // recorded", which is a different thing from low risk, and the page has to be
  // able to say so.

  /** Assigned bed, from the patient's most recent triage assessment. */
  room?: string;
  /** Emergency Severity Index, 1–5, from the same assessment. */
  esi_level?: number;
  /** `low` | `moderate` | `high`, from the most recent Morse Fall Scale assessment. */
  fall_risk?: string;
  /** Where the patient's live cannula is, if one is documented. */
  iv_site?: string;
  /** A wound has not been reassessed within the review interval. */
  wound_care_due?: boolean;
}

/**
 * One medication row. `MedicationReminder` on the API side.
 *
 * `route` and `scheduled_time` are read by the dashboard and not returned. The
 * page used to default `route` to `'PO'`, which told a nurse that every drug on
 * the ward list was oral — including the ones that are not.
 */
/**
 * One row of the ward drug round.
 *
 * Sourced from the medication administration record, not from
 * `medication_reminders`. The reminders feed is patient adherence — a drug
 * name, a dose and a list of times — and it has no route, no scheduled time
 * and no patient name, which is why this interface used to carry three fields
 * marked "not returned by the API" and the page defaulted `route` to `'PO'`.
 * That told a nurse every drug on the ward was oral, including the ones given
 * IV or IM.
 *
 * `route` and `scheduled_time` are still optional, because a MAR entry can be
 * written without them. Absent is shown as unknown — a question rather than a
 * wrong answer.
 */
export interface NurseDashboardMedication {
  record_id: string;
  patient_id: string;
  /** Resolved server-side; the name is encrypted at rest. */
  patient_name?: string;
  medication_name?: string | null;
  dosage?: string | null;
  route?: string | null;
  scheduled_time?: string | null;
  status?: string | null;
}

/** One flagged vital-signs reading. */
export interface NurseDashboardVital {
  flowsheet_id?: string;
  patient_id: string;
  patient_name?: string;
  abnormal_values?: string[];
  is_critical?: boolean;
}

/** One intake/output row. The API currently returns this array empty. */
export interface NurseDashboardIoRecord {
  patient_name?: string;
  total_intake?: number;
  total_output?: number;
}

/**
 * Nurse dashboard payload, as `/api/dashboard/nurse` actually returns it.
 *
 * The previous shape declared `role`, `care_plans`, `wound_assessments`,
 * `iv_assessments`, `recent_incidents`, `tasks.meds_due` and
 * `tasks.wounds_to_assess` — none of which the handler sends — and omitted
 * `critical_alerts`, which it does. Cross-checked against
 * `api/src/clinical_endpoints/workflow/dashboards.rs::nurse_dashboard`.
 */
export interface NurseDashboardResponse {
  nurse_id: string;
  patients: {
    total: number;
    list: NurseDashboardPatient[];
  };
  vitals_needing_attention: NurseDashboardVital[];
  fall_risk_patients: unknown[];
  io_records: NurseDashboardIoRecord[];
  medication_records: NurseDashboardMedication[];
  /** CDS alerts of severity "critical". Returned, and currently not rendered. */
  critical_alerts: unknown[];
  tasks: {
    vitals_due: number;
    /** Live cannulae on the ward. Was hardcoded `0` server-side. */
    ivs_to_check: number;
    /** Wounds not reassessed within the review interval. */
    wounds_to_assess: number;
  };
}

/**
 * Lab Technician Dashboard Response
 * GET /api/dashboard/lab
 */
/**
 * One row in the pending-test queue.
 *
 * Built field-by-field in the handler rather than serialised from an entity,
 * because the queue shows a person and a test: sending the raw row rendered
 * every line as "Unknown / Unknown Test".
 */
export interface LabQueueItem {
  id: string;
  accession_number: string;
  patient_id: string;
  patient_name: string;
  test_name: string;
  priority: string;
  status: string;
  time_in_lab: string;
}

/**
 * One rejected specimen. The serialised entity, plus `patient_name` and
 * `accession_number`, which the handler adds: the name is encrypted at rest and
 * only the API holds the keyring, and the entity's identifier for the specimen
 * is `specimen_id`.
 */
export interface LabRejection {
  id: string;
  specimen_id: string;
  patient_id: string;
  rejection_reason: string;
  rejection_category: string;
  detailed_notes?: string | null;
  rejected_by: string;
  rejected_at: string;
  recollection_required: boolean;
  notified_ordering_provider: boolean;
  /** Added by the handler: the entity's identifier for the specimen is `specimen_id`. */
  accession_number: string;
  /** Added by the handler: encrypted at rest, and only the API holds the keyring. */
  patient_name?: string;
}

/** One open recollection request. */
export interface LabRecollection {
  id: string;
  rejection_id: string;
  original_specimen_id: string;
  reason: string;
  status: string;
}

/**
 * One quality-control record — `LabQcRecordEntity`, serialised as-is.
 *
 * The dashboard read `analyzer_name`, `last_qc_time` and `status`. None of the
 * three exists: the entity calls them `instrument_name`, `performed_at` and
 * `passed`, so every row in the QC panel rendered blank.
 */
export interface LabQcRecord {
  id: string;
  instrument_id: string;
  instrument_name: string;
  qc_level: string;
  test_code: string;
  test_name: string;
  measured_value: number;
  unit: string;
  passed: boolean;
  performed_by: string;
  performed_at: string;
}

/**
 * One unacknowledged critical value — `CriticalValueEntity`, serialised as-is.
 *
 * The dashboard read `critical_value_id`, which does not exist (`id` does), so
 * every alert fell back to `String(Math.random())` for its React key.
 *
 * `patient_name` is genuinely absent: the entity carries only `patient_id`, and
 * the name is encrypted at rest. The handler already performs exactly this
 * enrichment for the rejections array a few lines above; doing the same here is
 * an API change, recorded in docs/TECHNICAL_DEBT_REGISTER.md under "Critical
 * value alerts do not name the patient".
 */
export interface LabCriticalNotification {
  id: string;
  patient_id: string;
  test_name: string;
  value: string;
  unit: string;
  severity: string;
  created_at: string;
  /** Not returned. See above. */
  patient_name?: string;
}

/**
 * Laboratory dashboard payload, as `/api/dashboard/lab` actually returns it.
 *
 * The previous shape declared `role`, `specimens`, `chain_of_custody`,
 * `available_panels`, `test_queue.approved_today` and an `alerts` block — none
 * of which the handler sends — and omitted `open_recollections`, which it does.
 * Cross-checked against
 * `api/src/clinical_endpoints/workflow/dashboards.rs::lab_dashboard`.
 */
export interface LabDashboardResponse {
  lab_tech_id: string;
  test_queue: {
    pending: LabQueueItem[];
    pending_count: number;
    approved_count: number;
  };
  qc_records: LabQcRecord[];
  rejections: LabRejection[];
  open_recollections: LabRecollection[];
  critical_notifications: LabCriticalNotification[];
}

/**
 * Admin Dashboard Response
 * GET /api/dashboard/admin
 */
export interface AdminDashboardResponse {
  role: 'Admin';
  system_stats: {
    total_users: number;
    total_patients: number;
    doctors: number;
    nurses: number;
    lab_technicians: number;
    pharmacists: number;
    patient_users: number;
  };
  users: User[];
  nfc_cards: {
    total: number;
    cards: unknown[];
  };
  lab_submissions: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  emergency_events: {
    code_blues: number;
    traumas: number;
    strokes: number;
    sepsis: number;
  };
  access_logs: unknown[];
}

/**
 * Patient Dashboard Response
 * GET /api/dashboard/patient
 */
export interface PatientDashboardResponse {
  /** Wallet identity of the authenticated patient. */
  user_id: string;
  /** Clinical record id resolved from the caller's linked patient identity. */
  patient_id: string;
  role: 'Patient';
  profile: PatientProfile;
  recent_lab_results: unknown[];
  medical_records: unknown[];
  vital_signs: unknown | null;
  soap_notes: unknown[];
  triage_history: unknown[];
}

/**
 * Messages Response
 * GET /api/messages
 */
export interface MessagesResponse {
  messages: unknown[];
  count: number;
  unread_count: number;
}

/**
 * Notifications Response
 * GET /api/notifications
 */
export interface NotificationsResponse {
  notifications: unknown[];
  count: number;
  unread_count: number;
}

/**
 * Pharmacist Dashboard Response
 * GET /api/dashboard/pharmacist
 * Note: This endpoint needs to be created in the backend
 */
/**
 * Pharmacist dashboard payload, as `/api/dashboard/pharmacist` actually returns
 * it.
 *
 * The previous shape declared `role`, `refill_requests`,
 * `controlled_substance_log`, `inventory_alerts` and an `alerts` block — none of
 * which the handler sends — and omitted `allergy_alerts`, which it does. The
 * sidebar read `alerts.pending_rx_count` and threw. Cross-checked against
 * `api/src/clinical_endpoints/workflow/dashboards.rs::pharmacist_dashboard`.
 */
export interface PharmacistDashboardResponse {
  pharmacist_id: string;
  prescriptions: {
    pending_fill: number;
    in_progress: number;
    completed_today: number;
    list: unknown[];
  };
  drug_interactions: unknown[];
  allergy_alerts: unknown[];
}

// ============================================================================
// Helper Types
// ============================================================================

export type ApiResponse<T> = T | ApiError;

export * from './clinical';
// Typed request/response shapes for the endpoints that score clinically. These
// replace `data: unknown` on the create functions, which is how four pages came
// to post payloads no handler read.
export * from './clinicalScoring';

export function isApiError(response: ApiResponse<unknown>): response is ApiError {
  return typeof response === 'object' && response !== null && (response as ApiError).success === false && 'error' in (response as object);
}
