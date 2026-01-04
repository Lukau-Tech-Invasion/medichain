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

export interface User {
  user_id: string;
  username: string;
  role: Role;
  created_at: string;
  created_by?: string;
}

// ============================================================================
// Patient Types
// ============================================================================

export type BloodType = 
  | 'A+' | 'A-' 
  | 'B+' | 'B-' 
  | 'AB+' | 'AB-' 
  | 'O+' | 'O-';

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

export interface EmergencyInfo {
  patient_id: string;
  blood_type: BloodType;
  allergies: string[];
  current_medications: string[];
  chronic_conditions: string[];
  emergency_contacts: EmergencyContact[];
  organ_donor: boolean;
  dnr_status: boolean;
  last_updated: string;
}

export interface PatientProfile {
  patient_id: string;
  full_name: string;
  date_of_birth: string;
  national_id: string;
  emergency_info: EmergencyInfo;
  created_at: string;
  last_updated: string;
}

export interface RegisterPatientRequest {
  full_name: string;
  date_of_birth: string;
  national_id: string;
  blood_type: string;
  allergies: string[];
  current_medications: string[];
  chronic_conditions: string[];
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  organ_donor: boolean;
  dnr_status: boolean;
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
// Helper Types
// ============================================================================

export type ApiResponse<T> = T | ApiError;

export function isApiError(response: ApiResponse<unknown>): response is ApiError {
  return (response as ApiError).success === false && 'error' in response;
}
