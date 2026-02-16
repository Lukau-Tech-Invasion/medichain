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
  | 'public' 
  | 'private' 
  | 'employer' 
  | 'nhis' 
  | 'community' 
  | 'none';

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
  /** Coverage start date (ISO 8601) */
  valid_from: string;
  /** Coverage end date (ISO 8601) */
  valid_to: string;
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
  full_name: string;
  date_of_birth: string;
  national_id: string;
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
  message: string;
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
// API Response Types
// ============================================================================

export interface ApiError {
  success: false;
  error: string;
  code: string;
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
  user_id: string;
  username: string;
  role: string;
}

export interface AssignRoleResponse {
  success: boolean;
  user_id: string;
  role: string;
  message: string;
}

export interface RevokeRoleRequest {
  user_id: string;
}

export interface RevokeRoleResponse {
  success: boolean;
  user_id: string;
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
export interface NurseDashboardResponse {
  role: 'Nurse';
  patients: {
    total: number;
    list: PatientProfile[];
  };
  care_plans: unknown[];
  vitals_needing_attention: unknown[];
  medication_records: unknown[];
  io_records: unknown[];
  wound_assessments: unknown[];
  iv_assessments: unknown[];
  fall_risk_patients: unknown[];
  recent_incidents: unknown[];
  tasks: {
    vitals_due: number;
    meds_due: number;
    wounds_to_assess: number;
    ivs_to_check: number;
  };
}

/**
 * Lab Technician Dashboard Response
 * GET /api/dashboard/lab
 */
export interface LabDashboardResponse {
  role: 'LabTechnician';
  test_queue: {
    pending: LabResultSubmission[];
    approved_today: LabResultSubmission[];
    pending_count: number;
    approved_count: number;
  };
  specimens: unknown[];
  rejections: unknown[];
  qc_records: unknown[];
  critical_notifications: unknown[];
  chain_of_custody: unknown[];
  available_panels: unknown[];
  alerts: {
    pending_tests: number;
    critical_values: number;
    rejections_today: number;
  };
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
  role: 'Patient';
  patient_id: string;
  profile: PatientProfile;
  recent_visits: unknown[];
  medications: unknown[];
  lab_results: unknown[];
  appointments: unknown[];
  total_visits: number;
}

/**
 * Messages Response
 * GET /api/messages
 */
export interface MessagesResponse {
  messages: unknown[];
  unread_count: number;
}

/**
 * Notifications Response
 * GET /api/notifications
 */
export interface NotificationsResponse {
  notifications: unknown[];
  unread_count: number;
}

/**
 * Pharmacist Dashboard Response
 * GET /api/dashboard/pharmacist
 * Note: This endpoint needs to be created in the backend
 */
export interface PharmacistDashboardResponse {
  role: 'Pharmacist';
  prescriptions: {
    pending_fill: number;
    in_progress: number;
    completed_today: number;
    list: unknown[];
  };
  drug_interactions: unknown[];
  refill_requests: unknown[];
  controlled_substance_log: unknown[];
  inventory_alerts: unknown[];
  alerts: {
    pending_rx_count: number;
    interactions_count: number;
    low_inventory_count: number;
  };
}

// ============================================================================
// Helper Types
// ============================================================================

export type ApiResponse<T> = T | ApiError;

export function isApiError(response: ApiResponse<unknown>): response is ApiError {
  return typeof response === 'object' && response !== null && (response as ApiError).success === false && 'error' in (response as object);
}
