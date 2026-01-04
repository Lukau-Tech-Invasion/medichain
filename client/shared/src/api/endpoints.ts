/**
 * MediChain API Endpoints
 * 
 * Typed API functions for all MediChain endpoints.
 */

import { getApiClient } from './client';
import type {
  User,
  PatientProfile,
  RegisterPatientRequest,
  RegisterPatientResponse,
  EmergencyAccessRequest,
  EmergencyAccessResponse,
  AccessLogsResponse,
  HealthCheckResponse,
  IpfsHealthResponse,
  AssignRoleRequest,
  AssignRoleResponse,
  RevokeRoleRequest,
  RevokeRoleResponse,
  UploadMedicalRecordRequest,
  UploadMedicalRecordResponse,
  DownloadMedicalRecordRequest,
  DownloadMedicalRecordResponse,
  MedicalRecordReference,
  GenerateNFCCardRequest,
  GenerateNFCCardResponse,
  NFCCardInfo,
} from '../types';

// ============================================================================
// Health Check
// ============================================================================

export async function healthCheck(): Promise<HealthCheckResponse> {
  return getApiClient().get('/health');
}

export async function ipfsHealthCheck(): Promise<IpfsHealthResponse> {
  return getApiClient().get('/api/ipfs/health');
}

// ============================================================================
// Patient Management
// ============================================================================

export async function registerPatient(
  data: RegisterPatientRequest
): Promise<RegisterPatientResponse> {
  return getApiClient().post('/api/register', data);
}

export async function getPatients(): Promise<PatientProfile[]> {
  return getApiClient().get('/api/patients');
}

export async function getPatient(patientId: string): Promise<PatientProfile> {
  return getApiClient().get(`/api/patients/${patientId}`);
}

export async function updatePatient(
  patientId: string,
  data: Partial<{
    allergies: string[];
    current_medications: string[];
    chronic_conditions: string[];
    organ_donor: boolean;
    dnr_status: boolean;
    emergency_contact_name: string;
    emergency_contact_phone: string;
    emergency_contact_relationship: string;
  }>
): Promise<{ success: boolean; patient_id: string; updated_by: string; message: string }> {
  return getApiClient().put(`/api/patients/${patientId}`, data);
}

export async function getMyRecords(): Promise<PatientProfile | PatientProfile[]> {
  return getApiClient().get('/api/my-records');
}

// ============================================================================
// Emergency Access
// ============================================================================

export async function requestEmergencyAccess(
  data: EmergencyAccessRequest
): Promise<EmergencyAccessResponse> {
  return getApiClient().post('/api/emergency-access', data);
}

export async function simulateNfcTap(
  patientId: string
): Promise<{ success: boolean; nfc_tag_id: string; tag_data: unknown; qr_code_base64?: string; message: string }> {
  return getApiClient().post('/api/simulate-nfc-tap', { patient_id: patientId });
}

// ============================================================================
// Access Logs
// ============================================================================

export async function getAccessLogs(patientId: string): Promise<AccessLogsResponse> {
  return getApiClient().get(`/api/access-logs/${patientId}`);
}

// ============================================================================
// Role Management (Admin)
// ============================================================================

export async function getUsers(): Promise<User[]> {
  return getApiClient().get('/api/users');
}

export async function assignRole(data: AssignRoleRequest): Promise<AssignRoleResponse> {
  return getApiClient().post('/api/roles/assign', data);
}

export async function revokeRole(data: RevokeRoleRequest): Promise<RevokeRoleResponse> {
  return getApiClient().delete('/api/roles/revoke', data);
}

// ============================================================================
// Medical Records (IPFS)
// ============================================================================

export async function uploadMedicalRecord(
  data: UploadMedicalRecordRequest
): Promise<UploadMedicalRecordResponse> {
  return getApiClient().post('/api/records/upload', data);
}

export async function downloadMedicalRecord(
  data: DownloadMedicalRecordRequest
): Promise<DownloadMedicalRecordResponse> {
  return getApiClient().post('/api/records/download', data);
}

export async function getPatientRecords(
  patientId: string
): Promise<{ patient_id: string; records: MedicalRecordReference[]; total: number }> {
  return getApiClient().get(`/api/records/${patientId}`);
}

// ============================================================================
// NFC Card Management
// ============================================================================

export async function generateNFCCard(
  data: GenerateNFCCardRequest
): Promise<GenerateNFCCardResponse> {
  return getApiClient().post('/api/nfc/generate', data);
}

export async function nfcTap(
  cardHash: string
): Promise<{ success: boolean; patient_id?: string; card_hash: string; timestamp: number; error?: string }> {
  return getApiClient().post('/api/nfc/tap', { card_hash: cardHash });
}

export async function verifyQRCode(
  qrData: string
): Promise<{ success: boolean; patient_id: string; card_hash: string; verified: boolean; message: string }> {
  return getApiClient().post('/api/nfc/verify-qr', { qr_data: qrData });
}

export async function getCardInfo(patientId: string): Promise<NFCCardInfo> {
  return getApiClient().get(`/api/nfc/card/${patientId}`);
}

export async function suspendCard(cardHash: string): Promise<{ success: boolean; card_hash: string; message: string }> {
  return getApiClient().post('/api/nfc/suspend', { card_hash: cardHash });
}

export async function listNFCCards(): Promise<{ cards: NFCCardInfo[]; total: number }> {
  return getApiClient().get('/api/nfc/cards');
}

// ============================================================================
// Demo
// ============================================================================

export async function getDemoInfo(): Promise<unknown> {
  return getApiClient().get('/api/demo');
}

// ============================================================================
// Lab Results (Approval Workflow)
// ============================================================================

import type {
  SubmitLabResultRequest,
  SubmitLabResultResponse,
  ReviewLabResultRequest,
  ReviewLabResultResponse,
  PendingLabResultsResponse,
  LabResultSubmission,
} from '../types';

/**
 * Submit lab results for doctor review (LabTechnician, Doctor, Nurse, Admin)
 */
export async function submitLabResults(
  data: SubmitLabResultRequest
): Promise<SubmitLabResultResponse> {
  return getApiClient().post('/api/lab/submit', data);
}

/**
 * Get pending lab result submissions for review (Doctor, Nurse, Admin)
 */
export async function getPendingLabResults(): Promise<PendingLabResultsResponse> {
  return getApiClient().get('/api/lab/pending');
}

/**
 * Get all lab submissions with optional status filter (Doctor, Nurse, Admin)
 */
export async function getAllLabSubmissions(
  status?: 'pending' | 'approved' | 'rejected'
): Promise<{ submissions: LabResultSubmission[]; total: number }> {
  const url = status ? `/api/lab/submissions?status=${status}` : '/api/lab/submissions';
  return getApiClient().get(url);
}

/**
 * Get a specific lab submission by ID
 */
export async function getLabSubmission(
  submissionId: string
): Promise<LabResultSubmission> {
  return getApiClient().get(`/api/lab/submissions/${submissionId}`);
}

/**
 * Review (approve/reject) a lab result submission (Doctor, Nurse, Admin)
 */
export async function reviewLabResult(
  data: ReviewLabResultRequest
): Promise<ReviewLabResultResponse> {
  return getApiClient().post('/api/lab/review', data);
}

/**
 * Get lab submissions for a specific patient
 * Healthcare providers see all, patients only see approved
 */
export async function getPatientLabSubmissions(
  patientId: string
): Promise<{ patient_id: string; submissions: LabResultSubmission[]; total: number }> {
  return getApiClient().get(`/api/lab/patient/${patientId}`);
}
