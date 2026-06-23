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

export interface ServiceHealth {
  name: string;
  status: 'online' | 'degraded' | 'offline';
  latency_ms: number | null;
  message: string | null;
}

export interface DetailedHealthResponse {
  overall_status: string;
  version: string;
  uptime_seconds: number;
  timestamp: string;
  services: ServiceHealth[];
}

export async function detailedHealthCheck(): Promise<DetailedHealthResponse> {
  return getApiClient().get('/api/health/detailed');
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
  const response = await getApiClient().get<{ data: PatientProfile[]; pagination: unknown }>('/api/patients');
  // Handle both paginated response and direct array for backward compatibility
  if (Array.isArray(response)) {
    return response;
  }
  return response.data || [];
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

export async function addEmergencyContact(
  patientId: string,
  contact: {
    name: string;
    phone: string;
    relationship: string;
  }
): Promise<{ 
  success: boolean; 
  patient_id: string; 
  contact: { name: string; phone: string; relationship: string };
  message: string;
}> {
  return getApiClient().post(`/api/patients/${patientId}/emergency-contacts`, contact);
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

/**
 * Get all users (Admin only)
 * Returns empty array if API returns error or unexpected format
 */
export async function getUsers(): Promise<User[]> {
  try {
    const response = await getApiClient().get<User[] | { users?: User[]; data?: User[] } | null>('/api/users');
    
    // Handle various response formats defensively
    if (Array.isArray(response)) {
      return response;
    }
    
    // Handle wrapped response formats
    if (response && typeof response === 'object') {
      if ('users' in response && Array.isArray(response.users)) {
        return response.users;
      }
      if ('data' in response && Array.isArray(response.data)) {
        return response.data;
      }
    }
    
    console.warn('[MediChain] Unexpected users API response format:', response);
    return [];
  } catch (error) {
    console.error('[MediChain] Failed to fetch users:', error);
    return [];
  }
}

/**
 * Get a single user by wallet address (Admin or self)
 */
export async function getUserDetails(walletAddress: string): Promise<User | null> {
  try {
    const response = await getApiClient().get<User>(`/api/users/${walletAddress}`);
    return response;
  } catch (error) {
    console.error('[MediChain] Failed to fetch user details:', error);
    return null;
  }
}

/**
 * Update user profile request
 */
export interface UpdateUserProfileRequest {
  email?: string;
  phone?: string;
  department?: string;
  specialty?: string;
  license_number?: string;
  status?: 'active' | 'inactive' | 'suspended' | 'pending';
  name?: string;
}

/**
 * Update a user's profile (Admin or self)
 */
export async function updateUserProfile(
  walletAddress: string,
  data: UpdateUserProfileRequest
): Promise<{ success: boolean; wallet_address: string; message: string }> {
  return getApiClient().put(`/api/users/${walletAddress}`, data);
}

export async function assignRole(data: AssignRoleRequest): Promise<AssignRoleResponse> {
  return getApiClient().post('/api/roles/assign', data);
}

export async function revokeRole(data: RevokeRoleRequest): Promise<RevokeRoleResponse> {
  return getApiClient().delete('/api/roles/revoke', data);
}

// ============================================================================
// Wallet Authentication
// ============================================================================

import type {
  BootstrapAdminRequest,
  BootstrapAdminResponse,
  WalletRegisterRequest,
  WalletRegisterResponse,
  WalletLoginRequest,
  WalletLoginResponse,
  WalletUserInfo,
} from '../types';

/**
 * Demo login request (development mode only)
 */
export interface DemoLoginRequest {
  wallet_address: string;
  role: string;
  name?: string;
}

/**
 * Demo login response
 */
export interface DemoLoginResponse {
  success: boolean;
  wallet_address: string;
  role: string;
  name: string;
  message: string;
}

/**
 * Demo login - creates a temporary user for testing (development mode only)
 * This endpoint auto-registers the wallet if it doesn't exist
 */
export async function demoLogin(data: DemoLoginRequest): Promise<DemoLoginResponse> {
  return getApiClient().post('/api/auth/demo-login', data);
}

/**
 * Bootstrap the first admin user (only works when no users exist)
 */
export async function bootstrapAdmin(data: BootstrapAdminRequest): Promise<BootstrapAdminResponse> {
  return getApiClient().post('/api/auth/bootstrap', data);
}

/**
 * Register a new user with wallet address (Admin only)
 */
export async function walletRegister(data: WalletRegisterRequest): Promise<WalletRegisterResponse> {
  return getApiClient().post('/api/auth/register', data);
}

/**
 * Login with wallet address - validates wallet exists and returns user info
 */
export async function walletLogin(data: WalletLoginRequest): Promise<WalletLoginResponse> {
  return getApiClient().post('/api/auth/login', data);
}

/**
 * Get current user info from wallet address
 */
export async function getCurrentUser(): Promise<WalletUserInfo> {
  return getApiClient().get('/api/auth/me');
}

// ============================================================================
// JWT authentication (Phase 9.4)
// ============================================================================

export interface JwtIssueRequest {
  wallet_address: string;
  /** Hex sr25519 signature over `<timestamp>:<wallet_address>` (omit only in demo mode). */
  signature?: string;
  timestamp?: number;
}

export interface JwtIssueResponse {
  success: boolean;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  mfa: boolean;
  mfa_required: boolean;
}

/** Issue JWT access + refresh tokens after a verified wallet signature challenge. */
export async function issueJwt(data: JwtIssueRequest): Promise<JwtIssueResponse> {
  return getApiClient().post('/api/auth/jwt', data);
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshJwt(
  refreshToken: string
): Promise<{ success: boolean; access_token: string; token_type: string; expires_in: number }> {
  return getApiClient().post('/api/auth/jwt/refresh', { refresh_token: refreshToken });
}

// ============================================================================
// Multi-factor authentication — TOTP (Phase 11.3)
// ============================================================================

export interface MfaEnrollResponse {
  success: boolean;
  secret: string;
  otpauth_uri: string;
  qr_code_base64?: string;
}

/** Begin TOTP enrollment; returns the secret + provisioning QR. */
export async function mfaEnroll(): Promise<MfaEnrollResponse> {
  return getApiClient().post('/api/auth/mfa/enroll', {});
}

/** Confirm enrollment by verifying the first code, activating MFA. */
export async function mfaVerify(code: string): Promise<{ success: boolean; message: string }> {
  return getApiClient().post('/api/auth/mfa/verify', { code });
}

/** Step up the current session to MFA-satisfied; returns a new access token. */
export async function mfaChallenge(
  code: string
): Promise<{ success: boolean; access_token: string; token_type: string; expires_in: number; mfa: boolean }> {
  return getApiClient().post('/api/auth/mfa/challenge', { code });
}

/** Report MFA enrollment status for the current user. */
export async function mfaStatus(): Promise<{ success: boolean; enrolled: boolean; enabled: boolean }> {
  return getApiClient().get('/api/auth/mfa/status');
}

/** Disable MFA after verifying a current code. */
export async function mfaDisable(code: string): Promise<{ success: boolean; message: string }> {
  return getApiClient().post('/api/auth/mfa/disable', { code });
}

// ============================================================================
// Security alerts & breach declaration — Admin (Phase 11.4)
// ============================================================================

export interface SecurityAlert {
  id: string;
  kind: string;
  severity: string;
  actor?: string | null;
  message: string;
  notify_deadline?: string | null;
  created_at: string;
}

/** List recent security alerts (Admin only). */
export async function getSecurityAlerts(): Promise<{ success: boolean; alerts: SecurityAlert[]; count: number }> {
  return getApiClient().get('/api/admin/security/alerts');
}

/** Declare a data breach (Admin only); starts the POPIA 72-hour clock. */
export async function declareBreach(
  description: string,
  actor?: string
): Promise<{ success: boolean; alert: SecurityAlert; message: string }> {
  return getApiClient().post('/api/admin/security/breach', { description, actor });
}

/** Per-facility CDS rule thresholds (numeric cut-offs keyed by rule). */
export type CdsThresholds = Record<string, number>;

/** Get a facility's effective CDS thresholds (Admin only; engine defaults if unset). */
export async function getCdsThresholds(
  facilityId: string
): Promise<{ facility_id: string; thresholds: CdsThresholds }> {
  return getApiClient().get(`/api/admin/cds/thresholds/${facilityId}`);
}

/** Upsert a facility's CDS thresholds (Admin only); partial bodies merge with defaults. */
export async function setCdsThresholds(
  facilityId: string,
  thresholds: Partial<CdsThresholds>
): Promise<{ facility_id: string; thresholds: CdsThresholds; message: string }> {
  return getApiClient().put(`/api/admin/cds/thresholds/${facilityId}`, thresholds);
}

/** Get the CDS audit trail (Admin only); optionally filtered by patient. */
export async function getCdsAudit(
  patientId?: string
): Promise<{ count: number; entries: unknown[] }> {
  const q = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : '';
  return getApiClient().get(`/api/admin/cds/audit${q}`);
}

// ============================================================================
// Insurance cards CRUD (Phase 13.4)
// ============================================================================

/** An insurance card is an open JSON shape; `patient_id` is required on create. */
export type InsuranceCard = Record<string, unknown> & { id?: string; patient_id: string };

/** List a patient's insurance cards. */
export async function getInsuranceCards(
  patientId: string
): Promise<{ success: boolean; cards: InsuranceCard[]; count: number }> {
  return getApiClient().get(`/api/insurance/cards/${patientId}`);
}

/** Create an insurance card (body must include `patient_id`). */
export async function createInsuranceCard(
  card: InsuranceCard
): Promise<{ success: boolean; card: InsuranceCard }> {
  return getApiClient().post('/api/insurance/cards', card);
}

/** Replace an existing insurance card. */
export async function updateInsuranceCard(
  id: string,
  card: InsuranceCard
): Promise<{ success: boolean; card: InsuranceCard }> {
  return getApiClient().put(`/api/insurance/cards/${id}`, card);
}

/** Delete an insurance card. */
export async function deleteInsuranceCard(
  id: string
): Promise<{ success: boolean; message: string }> {
  return getApiClient().delete(`/api/insurance/cards/${id}`);
}

/** Upload a card image (base64); stored encrypted on IPFS, hash saved on the card. */
export async function uploadInsuranceCardImage(
  id: string,
  imageBase64: string,
  contentType?: string
): Promise<{ success: boolean; image_ipfs_hash: string }> {
  return getApiClient().post(`/api/insurance/cards/${id}/image`, {
    image_base64: imageBase64,
    content_type: contentType,
  });
}

// ============================================================================
// PDF export (Phase 13.3)
// ============================================================================

export interface PdfSectionInput {
  heading: string;
  lines: string[];
}

export interface PdfDocumentInput {
  title: string;
  subtitle?: string;
  sections: PdfSectionInput[];
  filename?: string;
}

/**
 * Render `doc` to a PDF via the API and trigger a browser download.
 * Powers "Export as PDF" buttons (lab results, prescriptions, visit summaries).
 */
export async function exportDocumentToPdf(doc: PdfDocumentInput): Promise<void> {
  const client = getApiClient();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = client.getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const uid = client.getUserId();
  if (uid) headers['X-User-Id'] = uid;

  const resp = await fetch(`${client.getBaseUrl()}/api/pdf/document`, {
    method: 'POST',
    headers,
    body: JSON.stringify(doc),
  });
  if (!resp.ok) throw new Error(`PDF export failed: ${resp.status}`);

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.filename ?? 'medichain-document'}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

// ============================================================================
// Emergency Protocols (Phase 2)
// ============================================================================

export async function createCodeBlue(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/code-blue', data);
}

export async function getCodeBlue(eventId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/code-blue/${eventId}`);
}

export async function getPatientCodeBlues(patientId: string): Promise<unknown[]> {
  return getApiClient().get(`/api/clinical/code-blue/patient/${patientId}`);
}

export async function createTrauma(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/trauma', data);
}

export async function getTrauma(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/trauma/${assessmentId}`);
}

export async function createStroke(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/stroke', data);
}

export async function getStroke(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/stroke/${assessmentId}`);
}

export async function createCardiac(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/cardiac', data);
}

export async function getCardiac(eventId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/cardiac/${eventId}`);
}

export async function createSepsis(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/sepsis', data);
}

export async function getSepsis(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/sepsis/${assessmentId}`);
}

export async function createEmsHandoff(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/ems-handoff', data);
}

export async function getEmsHandoff(reportId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/ems-handoff/${reportId}`);
}

export async function getPatientEmergencyRecords(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/patient/${patientId}/emergency`);
}

// ============================================================================
// Nursing Documentation (Phase 3)
// ============================================================================

export async function createMar(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/mar', data);
}

export async function getMar(patientId: string, date: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/mar/${patientId}/${date}`);
}

export async function listMar(): Promise<unknown[]> {
  const response = await getApiClient().get<unknown>('/api/nursing/mar');
  // Handle different response formats from API
  if (response && typeof response === 'object') {
    // API returns { success: true, records: [...] }
    if ('records' in response) {
      return (response as { records: unknown[] }).records || [];
    }
    // Also handle paginated response format { data: [...] }
    if ('data' in response) {
      return (response as { data: unknown[] }).data || [];
    }
  }
  return Array.isArray(response) ? response : [];
}

export async function administerMedication(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/nursing/mar/administer', data);
}

export async function createIo(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/io', data);
}

export async function getIo(patientId: string, date: string, shift: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/io/${patientId}/${date}/${shift}`);
}

export async function listIo(): Promise<unknown> {
  return getApiClient().get('/api/nursing/intake-output');
}

export async function recordFluid(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/nursing/intake-output/record', data);
}

export async function createCarePlan(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/care-plan', data);
}

export async function getCarePlan(planId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/care-plan/${planId}`);
}

export async function listCarePlans(): Promise<unknown> {
  return getApiClient().get('/api/nursing/care-plans');
}

export async function createWound(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/wound', data);
}

export async function getWound(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/wound/${assessmentId}`);
}

export async function createIvSite(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/iv-site', data);
}

export async function getIvSite(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/iv-site/${assessmentId}`);
}

export async function createShiftHandoff(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/shift-handoff', data);
}

export async function getShiftHandoff(handoffId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/shift-handoff/${handoffId}`);
}

export async function createIncident(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/incident', data);
}

export async function getIncident(reportId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/incident/${reportId}`);
}

export async function createFallRisk(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/fall-risk', data);
}

export async function getFallRisk(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/fall-risk/${assessmentId}`);
}

export async function getNurseTasks(): Promise<unknown> {
  return getApiClient().get('/api/tasks/nurse');
}

// ============================================================================
// Specialized Assessments (Phase 4)
// ============================================================================

export async function createBurn(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/burn', data);
}

export async function getBurn(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/burn/${assessmentId}`);
}

export async function createPsych(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/psych', data);
}

export async function getPsych(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/psych/${assessmentId}`);
}

export async function createTox(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/tox', data);
}

export async function getTox(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/tox/${assessmentId}`);
}

export async function createMci(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/mci', data);
}

export async function getMci(incidentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/mci/${incidentId}`);
}

// ============================================================================
// Procedures (Phase 5)
// ============================================================================

export async function createIntubation(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/intubation', data);
}

export async function getIntubation(recordId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/intubation/${recordId}`);
}

export async function createLaceration(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/laceration', data);
}

export async function getLaceration(recordId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/laceration/${recordId}`);
}

export async function createSplint(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/splint', data);
}

export async function getSplint(recordId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/splint/${recordId}`);
}

// ============================================================================
// Specialty Populations (Phase 6)
// ============================================================================

export async function createPeds(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/peds', data);
}

export async function getPeds(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/peds/${assessmentId}`);
}

export async function createOb(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/ob', data);
}

export async function getOb(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/ob/${assessmentId}`);
}

// ============================================================================
// Laboratory (Phase 7)
// ============================================================================

export async function createSpecimen(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/specimen', data);
}

export async function getSpecimen(collectionId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/specimen/${collectionId}`);
}

export async function createChainOfCustody(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/chain-of-custody', data);
}

export async function getChainOfCustody(formId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/chain-of-custody/${formId}`);
}

export async function createLabQc(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/lab-qc', data);
}

export async function getLabQc(qcId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/lab-qc/${qcId}`);
}

export async function createCriticalValue(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/critical-value', data);
}

export async function getCriticalValue(notificationId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/critical-value/${notificationId}`);
}

export async function createSpecimenRejection(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/specimen-rejection', data);
}

export async function getSpecimenRejection(rejectionId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/specimen-rejection/${rejectionId}`);
}

// ============================================================================
// Physician Documentation (Phase 8)
// ============================================================================

export async function createOrder(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/order', data);
}

export async function getOrder(orderId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/order/${orderId}`);
}

export async function listOrders(): Promise<unknown> {
  return getApiClient().get('/api/clinical/orders');
}

export async function createDischargeSummary(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/discharge-summary', data);
}

export async function getDischargeSummary(summaryId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/discharge-summary/${summaryId}`);
}

export async function listDischarges(): Promise<unknown> {
  return getApiClient().get('/api/clinical/discharges');
}

export async function approveDischarge(summaryId: string): Promise<unknown> {
  return getApiClient().post(`/api/clinical/discharges/${summaryId}/approve`, {});
}

export async function createDischargeInstructions(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/discharge-instructions', data);
}

export async function getDischargeInstructions(instructionsId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/discharge-instructions/${instructionsId}`);
}

export async function createAma(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/ama', data);
}

export async function getAma(amaId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/ama/${amaId}`);
}

export async function createHp(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/hp', data);
}

export async function getHp(hpId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/hp/${hpId}`);
}

export async function createConsult(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/consult', data);
}

export async function getConsult(consultId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/consult/${consultId}`);
}

export async function createProgressNote(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/progress-note', data);
}

export async function getProgressNote(noteId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/progress-note/${noteId}`);
}

// ============================================================================
// Surgical Documentation (Phase 9)
// ============================================================================

export async function createPreOp(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/pre-op', data);
}

export async function getPreOp(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/pre-op/${assessmentId}`);
}

export async function createOperativeNote(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/operative-note', data);
}

export async function getOperativeNote(noteId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/operative-note/${noteId}`);
}

export async function createPostOp(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/post-op', data);
}

export async function getPostOp(noteId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/post-op/${noteId}`);
}

// ============================================================================
// Clinical Records (Specialty)
// ============================================================================

export async function createAMADischarge(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/ama', data);
}

export async function listAMADischarges(): Promise<unknown[]> {
  const response = await getApiClient().get<any>('/api/clinical/ama-discharges');
  return response || [];
}

export async function createHistoryPhysical(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/hp', data);
}

export async function getHistoryPhysical(hpId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/hp/${hpId}`);
}

export async function listHistoryPhysicals(): Promise<unknown[]> {
  return getApiClient().get('/api/clinical/hp');
}

export async function createIncidentReport(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/incident-reports', data);
}

export async function listIncidentReports(): Promise<unknown[]> {
  return getApiClient().get('/api/clinical/incident-reports');
}

export async function createIntakeOutput(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/intake-output', data);
}

export async function listIntakeOutput(): Promise<unknown[]> {
  return getApiClient().get('/api/clinical/intake-output');
}

// ============================================================================
// Anesthesia (Phase 10)
// ============================================================================

export async function createAnesthesia(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/anesthesia', data);
}

export async function getAnesthesia(recordId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/anesthesia/${recordId}`);
}

export async function listAnesthesia(): Promise<unknown[]> {
  return getApiClient().get('/api/clinical/anesthesia');
}

// ============================================================================
// Radiology (Phase 11)
// ============================================================================

export async function createRadiologyOrder(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/radiology/order', data);
}

export async function getRadiologyOrder(orderId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/radiology/order/${orderId}`);
}

export async function createRadiologyReport(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/radiology/report', data);
}

export async function getRadiologyReport(reportId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/radiology/report/${reportId}`);
}

// ============================================================================
// Pathology (Phase 12)
// ============================================================================

export async function createPathology(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/pathology', data);
}

export async function getPathology(reportId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/pathology/${reportId}`);
}

// ============================================================================
// Immunization (Phase 13)
// ============================================================================

export async function createImmunization(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/immunization', data);
}

export async function getImmunization(recordId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/immunization/${recordId}`);
}

// ============================================================================
// Family History (Phase 14)
// ============================================================================

export async function createFamilyHistory(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/family-history', data);
}

export async function getFamilyHistory(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/family-history/${patientId}`);
}

// ============================================================================
// Blood Bank (Phase 15)
// ============================================================================

export async function createBloodTypeScreen(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/blood-bank/type-screen', data);
}

export async function getBloodTypeScreen(testId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/blood-bank/type-screen/${testId}`);
}

export async function createTransfusion(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/blood-bank/transfusion', data);
}

export async function getTransfusion(transfusionId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/blood-bank/transfusion/${transfusionId}`);
}

// ============================================================================
// E-Prescribing (Phase 16)
// ============================================================================

export async function createEPrescription(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/e-prescriptions', data);
}

export async function signEPrescription(prescriptionId: string, data: unknown): Promise<unknown> {
  return getApiClient().post(`/api/e-prescriptions/${prescriptionId}/sign`, data);
}

export async function transmitEPrescription(prescriptionId: string): Promise<unknown> {
  return getApiClient().post(`/api/e-prescriptions/${prescriptionId}/transmit`, {});
}

export async function getEPrescription(prescriptionId: string): Promise<unknown> {
  return getApiClient().get(`/api/e-prescriptions/${prescriptionId}`);
}

export async function getPatientEPrescriptions(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/e-prescriptions/patient/${patientId}`);
}

// ============================================================================
// Appointments (Phase 17)
// ============================================================================

export async function createAppointment(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/appointments', data);
}

export async function getAppointment(appointmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/appointments/${appointmentId}`);
}

export async function getPatientAppointments(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/appointments/patient/${patientId}`);
}

export async function getProviderAppointments(providerId: string): Promise<unknown> {
  return getApiClient().get(`/api/appointments/provider/${providerId}`);
}

export async function cancelAppointment(appointmentId: string, data: unknown): Promise<unknown> {
  return getApiClient().post(`/api/appointments/${appointmentId}/cancel`, data);
}

export async function checkInAppointment(appointmentId: string): Promise<unknown> {
  return getApiClient().post(`/api/appointments/${appointmentId}/check-in`, {});
}

export async function getAvailableSlots(providerId: string, date: string): Promise<unknown> {
  return getApiClient().get(`/api/appointments/slots/${providerId}/${date}`);
}

// ============================================================================
// Death Certificate & Autopsy (Phase 18)
// ============================================================================

export async function createDeathCertificate(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/surgical/death-certificate', data);
}

export async function getDeathCertificate(certificateId: string): Promise<unknown> {
  return getApiClient().get(`/api/surgical/death-certificate/${certificateId}`);
}

export async function createAutopsyRequest(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/autopsy/request', data);
}

export async function getAutopsyRequest(requestId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/autopsy/request/${requestId}`);
}

export async function createAutopsyReport(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/autopsy/report', data);
}

export async function getAutopsyReport(reportId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/autopsy/report/${reportId}`);
}

// ============================================================================
// Patient Satisfaction (Phase 19)
// ============================================================================

export async function createSatisfactionSurvey(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/satisfaction-survey', data);
}

export async function getSatisfactionSurvey(surveyId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/satisfaction-survey/${surveyId}`);
}

// ============================================================================
// Medication Reminders (Phase 20)
// ============================================================================

export async function createMedicationReminder(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/reminders/medication', data);
}

export async function getPatientReminders(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/reminders/medication/${patientId}`);
}

export async function logMedicationAdherence(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/reminders/adherence', data);
}

export async function deleteMedicationReminder(reminderId: string): Promise<unknown> {
  return getApiClient().delete(`/api/reminders/medication/${reminderId}`);
}

// ============================================================================
// Drug Interactions (Phase 21)
// ============================================================================

export async function getDrugDatabase(): Promise<unknown> {
  return getApiClient().get('/api/drugs');
}

export async function getInteractionDatabase(): Promise<unknown> {
  return getApiClient().get('/api/interactions');
}

export async function checkDrugInteractions(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/interactions/check', data);
}

export async function getInteractionHistory(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/interactions/history/${patientId}`);
}

// ============================================================================
// Family Groups (Phase 22)
// ============================================================================

export async function createFamilyGroup(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/family/groups', data);
}

export async function addFamilyMember(groupId: string, data: unknown): Promise<unknown> {
  return getApiClient().post(`/api/family/groups/${groupId}/members`, data);
}

export async function getFamilyGroup(groupId: string): Promise<unknown> {
  return getApiClient().get(`/api/family/groups/${groupId}`);
}

export async function getMyFamilyGroups(): Promise<unknown> {
  return getApiClient().get('/api/family/my-groups');
}

export async function removeFamilyMember(groupId: string, patientId: string): Promise<unknown> {
  return getApiClient().delete(`/api/family/groups/${groupId}/members/${patientId}`);
}

// ============================================================================
// Wearables (Phase 24)
// ============================================================================

export async function registerWearableDevice(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/wearables/devices', data);
}

export async function getWearableDevices(): Promise<unknown> {
  return getApiClient().get('/api/wearables/devices');
}

export async function submitWearableReading(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/wearables/readings', data);
}

export async function getWearableReadings(patientId: string, type?: string): Promise<unknown> {
  const url = type ? `/api/wearables/readings/${patientId}?type=${type}` : `/api/wearables/readings/${patientId}`;
  return getApiClient().get(url);
}

export async function createWearableAlertRule(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/wearables/alert-rules', data);
}

export async function getWearableAlerts(): Promise<unknown> {
  return getApiClient().get('/api/wearables/alerts');
}

// ============================================================================
// Symptom Checker (Phase 25)
// ============================================================================

export interface SymptomAnalysisRequest {
  symptoms: string[];
  patient_age?: number;
  patient_gender?: 'male' | 'female' | 'other';
  existing_conditions?: string[];
  current_medications?: string[];
}

export interface SymptomAnalysisResult {
  possible_conditions: Array<{
    condition_name: string;
    probability: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    icd10_code?: string;
  }>;
  triage_level: 'self_care' | 'schedule_appointment' | 'urgent_care' | 'emergency';
  triage_message: string;
  recommendations: string[];
  red_flags: string[];
  self_care_advice: string[];
  when_to_seek_care: string[];
  disclaimer: string;
}

export async function analyzeSymptoms(data: SymptomAnalysisRequest): Promise<SymptomAnalysisResult> {
  return getApiClient().post('/api/symptoms/analyze', data);
}

export async function startSymptomCheck(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/symptoms/start', data);
}

export async function submitSymptomAnswers(sessionId: string, data: unknown): Promise<unknown> {
  return getApiClient().post(`/api/symptoms/${sessionId}/answers`, data);
}

export async function getSymptomSession(sessionId: string): Promise<unknown> {
  return getApiClient().get(`/api/symptoms/${sessionId}`);
}

export async function getSymptomCheckerHistory(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/symptoms/history/${patientId}`);
}

// ============================================================================
// Telehealth (Phase 26)
// ============================================================================

export async function createTelehealthSession(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/telehealth/sessions', data);
}

export async function getTelehealthSession(sessionId: string): Promise<unknown> {
  return getApiClient().get(`/api/telehealth/sessions/${sessionId}`);
}

export async function joinTelehealthSession(sessionId: string): Promise<unknown> {
  return getApiClient().post(`/api/telehealth/sessions/${sessionId}/join`, {});
}

export async function endTelehealthSession(sessionId: string, data?: unknown): Promise<unknown> {
  return getApiClient().post(`/api/telehealth/sessions/${sessionId}/end`, data || {});
}

/** Relay a telehealth lifecycle event (Phase 7): SSE-broadcast + audit-logged. */
export async function telehealthEvent(
  sessionId: string,
  eventType: string,
  detail?: string
): Promise<unknown> {
  return getApiClient().post(`/api/telehealth/sessions/${sessionId}/event`, {
    event_type: eventType,
    detail,
  });
}

/** Start/stop recording (Phase 6, moderator-only; starting requires consent). */
export async function telehealthRecording(
  sessionId: string,
  action: 'start' | 'stop',
  consent?: boolean
): Promise<{ success: boolean; recording_enabled?: boolean }> {
  return getApiClient().post(`/api/telehealth/sessions/${sessionId}/recording`, {
    action,
    consent,
  });
}

export async function submitDeviceCheck(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/telehealth/device-check', data);
}

export async function getPatientTelehealthSessions(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/telehealth/patient/${patientId}/sessions`);
}

/**
 * Fetch the in-app QR code for single-tap mobile join (Phase 4). The QR encodes
 * the in-browser PWA join URL — scanning it keeps the patient inside MediChain
 * (no native-app download).
 */
export async function getTelehealthJoinQr(
  sessionId: string
): Promise<{ success: boolean; join_url: string; qr_png_base64: string }> {
  return getApiClient().get(`/api/telehealth/sessions/${sessionId}/qr`);
}

// ============================================================================
// CDS (Phase 27)
// ============================================================================

export async function createCdsAlert(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/cds/alerts', data);
}

export async function getCdsAlerts(params?: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams(params).toString();
  return getApiClient().get(`/api/cds/alerts?${query}`);
}

export async function getCdsAlert(alertId: string): Promise<unknown> {
  return getApiClient().get(`/api/cds/alerts/${alertId}`);
}

export async function respondToCdsAlert(alertId: string, data: unknown): Promise<unknown> {
  return getApiClient().post(`/api/cds/alerts/${alertId}/respond`, data);
}

export async function getPatientCdsAlerts(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/cds/patient/${patientId}/alerts`);
}

// ============================================================================
// Lab Trends (Phase 28)
// ============================================================================

export async function getLabTrends(patientId: string, testCode?: string): Promise<unknown> {
  const url = testCode ? `/api/lab-trends/patient/${patientId}?test_code=${testCode}` : `/api/lab-trends/patient/${patientId}`;
  return getApiClient().get(url);
}

export async function analyzeLabTrends(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/lab-trends/analyze', data);
}

export async function getLabTrendResult(resultId: string): Promise<unknown> {
  return getApiClient().get(`/api/lab-trends/${resultId}`);
}

// ============================================================================
// Insurance Claims (Phase 30)
// ============================================================================

export async function createInsuranceClaim(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/insurance/claims', data);
}

export async function submitInsuranceClaim(claimId: string): Promise<unknown> {
  return getApiClient().post(`/api/insurance/claims/${claimId}/submit`, {});
}

export async function getInsuranceClaim(claimId: string): Promise<unknown> {
  return getApiClient().get(`/api/insurance/claims/${claimId}`);
}

export async function getPatientInsuranceClaims(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/insurance/claims/patient/${patientId}`);
}

export async function checkInsuranceEligibility(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/insurance/eligibility', data);
}

// ============================================================================
// Analytics (Phase 31)
// ============================================================================

export async function getDashboardMetrics(params: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams(params).toString();
  return getApiClient().get(`/api/analytics/dashboard?${query}`);
}

export async function getPatientAnalytics(): Promise<unknown> {
  return getApiClient().get('/api/analytics/patients');
}

export async function getAppointmentAnalytics(): Promise<unknown> {
  return getApiClient().get('/api/analytics/appointments');
}

export async function getQualityMetrics(): Promise<unknown> {
  return getApiClient().get('/api/analytics/quality');
}

// ============================================================================
// Languages (Phase 32)
// ============================================================================

export async function getSupportedLanguages(): Promise<unknown> {
  return getApiClient().get('/api/languages');
}

export async function setLanguagePreference(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/languages/preference', data);
}

export async function getLanguagePreference(userId: string): Promise<unknown> {
  return getApiClient().get(`/api/languages/preference/${userId}`);
}

export async function translateContent(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/languages/translate', data);
}

// ============================================================================
// Offline Sync (Phase 33)
// ============================================================================

export async function getSyncStatus(deviceId: string): Promise<unknown> {
  return getApiClient().get(`/api/sync/status/${deviceId}`);
}

export async function registerSyncDevice(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/sync/register', data);
}

export async function getSyncConflicts(): Promise<unknown> {
  return getApiClient().get('/api/sync/conflicts');
}

export async function resolveSyncConflict(
  conflictId: string,
  resolution: 'UseLocal' | 'UseServer' | 'Merge',
): Promise<unknown> {
  return getApiClient().post(`/api/sync/conflicts/${conflictId}/resolve`, { resolution });
}

export async function performSync(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/sync', data);
}

export async function getSyncQueue(deviceId: string): Promise<unknown> {
  return getApiClient().get(`/api/sync/queue/${deviceId}`);
}

export async function downloadOfflineData(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/sync/download/${patientId}`);
}

// ============================================================================
// System & Misc
// ============================================================================

export async function getOrderSets(): Promise<unknown> {
  return getApiClient().get('/api/order-sets');
}

export async function getNoteTemplates(): Promise<unknown> {
  return getApiClient().get('/api/templates/notes');
}

export async function useNoteTemplate(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/templates/notes/use', data);
}

export async function generateBarcode(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/barcode/generate', data);
}

export async function scanBarcode(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/barcode/scan', data);
}

export async function trackBarcode(barcodeValue: string): Promise<unknown> {
  return getApiClient().get(`/api/barcode/track/${barcodeValue}`);
}

export async function updateMedicalIdPreferences(patientId: string, data: unknown): Promise<unknown> {
  return getApiClient().post(`/api/medical-id/${patientId}/preferences`, data);
}

export async function triggerEmergencyNotification(patientId: string, data: unknown): Promise<unknown> {
  return getApiClient().post(`/api/medical-id/${patientId}/emergency-notify`, data);
}

export async function getLockscreenMedicalId(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/medical-id/${patientId}/lockscreen`);
}
// ============================================================================
// Clinical Documentation
// ============================================================================

/**
 * Create a triage assessment
 */
export async function createTriageAssessment(data: {
  patient_id: string;
  esi_level: number;
  chief_complaint: string;
  vital_signs: {
    heart_rate?: number;
    systolic_bp?: number;
    diastolic_bp?: number;
    respiratory_rate?: number;
    oxygen_saturation?: number;
    temperature_celsius?: number;
  };
  pain_scale?: number;
  notes?: string;
}): Promise<{ success: boolean; assessment_id: string; esi_level: number; message: string }> {
  return getApiClient().post('/api/clinical/triage', data);
}

/**
 * Get vital signs for a patient
 */
export async function getPatientVitals(
  patientId: string
): Promise<{ patient_id: string; readings: unknown[]; total: number }> {
  return getApiClient().get(`/api/clinical/patient/${patientId}/vitals`);
}

/**
 * Add vital signs reading
 */
export async function addVitalSigns(data: {
  patient_id: string;
  heart_rate?: number;
  systolic_bp?: number;
  diastolic_bp?: number;
  respiratory_rate?: number;
  oxygen_saturation?: number;
  temperature_celsius?: number;
  pain_scale?: number;
  notes?: string;
}): Promise<{ success: boolean; reading_id: string; message: string }> {
  return getApiClient().post('/api/clinical/vitals', data);
}

// ============================================================================
// Dashboards
// ============================================================================

/**
 * Get patient dashboard data
 */
export async function getPatientDashboard(): Promise<unknown> {
  return getApiClient().get('/api/dashboard/patient');
}

/**
 * Get doctor dashboard data
 */
export async function getDoctorDashboard(): Promise<unknown> {
  return getApiClient().get('/api/dashboard/doctor');
}

/**
 * Get nurse dashboard data
 */
export async function getNurseDashboard(): Promise<unknown> {
  return getApiClient().get('/api/dashboard/nurse');
}

/**
 * Get lab tech dashboard data
 */
export async function getLabDashboard(): Promise<unknown> {
  return getApiClient().get('/api/dashboard/lab');
}

/**
 * Get admin dashboard data
 */
export async function getAdminDashboard(): Promise<unknown> {
  return getApiClient().get('/api/dashboard/admin');
}

/**
 * Get pharmacist dashboard data
 */
export async function getPharmacistDashboard(): Promise<unknown> {
  return getApiClient().get('/api/dashboard/pharmacist');
}

// ============================================================================
// Messaging & Notifications
// ============================================================================

/**
 * Send a secure message
 */
export async function sendMessage(data: {
  recipient_id: string;
  subject: string;
  content: string;
  priority?: string;
}): Promise<{ success: boolean; message_id: string }> {
  return getApiClient().post('/api/messages/send', data);
}

/**
 * Get inbox messages
 */
export async function getMessages(): Promise<{ messages: unknown[]; unread_count: number }> {
  return getApiClient().get('/api/messages');
}

/**
 * Get notifications
 */
export async function getNotifications(): Promise<{ notifications: unknown[]; unread_count: number }> {
  return getApiClient().get('/api/notifications');
}

// ============================================================================
// Medical ID
// ============================================================================

/**
 * Get full medical ID data
 */
export async function getMedicalId(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/medical-id/${patientId}`);
}

/**
 * Get medical ID QR code
 */
export async function getMedicalIdQR(patientId: string): Promise<{ qr_base64: string }> {
  return getApiClient().get(`/api/medical-id/${patientId}/qr`);
}

/**
 * Get emergency view of medical ID
 */
export async function getEmergencyMedicalId(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/medical-id/${patientId}/emergency`);
}

// ============================================================================
// Insurance
// ============================================================================

/**
 * Verify patient insurance
 */
export async function verifyInsurance(patientId: string): Promise<unknown> {
  return getApiClient().post('/api/insurance/verify', { patient_id: patientId });
}

/**
 * Check eligibility for a service
 */
export async function checkEligibility(
  patientId: string,
  serviceCode: string
): Promise<unknown> {
  return getApiClient().post('/api/insurance/eligibility', {
    patient_id: patientId,
    service_code: serviceCode,
  });
}

// ============================================================================
// HL7 FHIR R4 API
// ============================================================================

/**
 * Get FHIR Patient resource
 */
export async function fhirGetPatient(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/fhir/r4/Patient/${patientId}`);
}

/**
 * Get FHIR AllergyIntolerance resources
 */
export async function fhirGetAllergies(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/fhir/r4/AllergyIntolerance?patient=${patientId}`);
}

/**
 * Get FHIR Condition resources
 */
export async function fhirGetConditions(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/fhir/r4/Condition?patient=${patientId}`);
}

/**
 * Get FHIR Observation resources (vital signs)
 */
export async function fhirGetObservations(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/fhir/r4/Observation?patient=${patientId}`);
}

/**
 * Get FHIR server capability statement
 */
export async function fhirCapabilityStatement(): Promise<unknown> {
  return getApiClient().get('/api/fhir/r4/metadata');
}

// ============================================================================
// Consent Forms
// ============================================================================

/**
 * Get available consent form types
 */
export async function getConsentTypes(): Promise<{ consent_types: unknown[] }> {
  return getApiClient().get('/api/consent/types');
}

/**
 * Sign a consent form
 */
export async function signConsent(data: {
  patient_id: string;
  consent_type: string;
}): Promise<{ success: boolean; consent_id: string }> {
  return getApiClient().post('/api/consent/sign', data);
}

/**
 * Get patient's signed consents
 */
export async function getPatientConsents(
  patientId: string
): Promise<{ consents: unknown[] }> {
  return getApiClient().get(`/api/consent/patient/${patientId}`);
}

// ============================================================================
// Symptom Tracking
// ============================================================================

/**
 * Log a symptom
 */
export async function logSymptom(data: {
  patient_id: string;
  symptom: string;
  severity: number;
  notes?: string;
}): Promise<{ success: boolean }> {
  return getApiClient().post('/api/symptoms/log', data);
}

/**
 * Get symptom history
 */
export async function getSymptomHistory(
  patientId: string
): Promise<{ symptoms: unknown[] }> {
  return getApiClient().get(`/api/symptoms/${patientId}`);
}

// ============================================================================
// Missing Clinical Endpoints (Task 1)
// ============================================================================

export async function createSampleHistory(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/sample', data);
}

export async function getSampleHistory(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/sample/${patientId}`);
}

export async function createGCS(data: unknown): Promise<unknown> {
  return getApiClient().post('/api/clinical/gcs', data);
}

export async function getGCS(assessmentId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/gcs/${assessmentId}`);
}

export async function getPatientGCS(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/patient/${patientId}/gcs`);
}

// ============================================================================
// Missing FHIR Endpoints (Task 1)
// ============================================================================

export async function fhirGetMedications(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/fhir/r4/MedicationStatement?patient=${patientId}`);
}

export async function fhirGetEncounters(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/fhir/r4/Encounter?patient=${patientId}`);
}

export async function fhirGetDiagnosticReports(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/fhir/r4/DiagnosticReport?patient=${patientId}`);
}

export async function fhirGetProcedures(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/fhir/r4/Procedure?patient=${patientId}`);
}

export async function fhirGetImmunizations(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/fhir/r4/Immunization?patient=${patientId}`);
}

// ============================================================================
// List Endpoints for Frontend Pages
// ============================================================================

export interface ListResponse<T> {
  success: boolean;
  total: number;
  items: T[];
}

/**
 * List all chain of custody records
 */
export async function listChainOfCustody(): Promise<ListResponse<unknown>> {
  return getApiClient().get('/api/clinical/chain-of-custody');
}

/**
 * List all lab QC records
 */
export async function listLabQc(): Promise<ListResponse<unknown>> {
  return getApiClient().get('/api/clinical/lab-qc');
}

/**
 * List all critical value notifications
 */
export async function listCriticalValues(): Promise<ListResponse<unknown>> {
  return getApiClient().get('/api/clinical/critical-values');
}

/**
 * List all radiology orders and reports
 */
export async function listRadiology(): Promise<{
  success: boolean;
  orders: { total: number; items: unknown[] };
  reports: { total: number; items: unknown[] };
}> {
  return getApiClient().get('/api/clinical/radiology/orders');
}

/**
 * List all pathology reports
 */
export async function listPathology(): Promise<ListResponse<unknown>> {
  return getApiClient().get('/api/clinical/pathology');
}

/**
 * List all immunization records and schedules
 */
export async function listImmunizations(): Promise<{
  success: boolean;
  records: { total: number; items: unknown[] };
  schedules: { total: number; items: unknown[] };
}> {
  return getApiClient().get('/api/clinical/immunizations');
}

/**
 * List all blood bank records
 */
export async function listBloodBank(): Promise<{
  success: boolean;
  type_screens: { total: number; items: unknown[] };
  crossmatches: { total: number; items: unknown[] };
  transfusions: { total: number; items: unknown[] };
}> {
  return getApiClient().get('/api/clinical/blood-bank');
}

/**
 * List all autopsy records
 */
export async function listAutopsy(): Promise<{
  success: boolean;
  requests: { total: number; items: unknown[] };
  reports: { total: number; items: unknown[] };
}> {
  return getApiClient().get('/api/clinical/autopsy');
}

/**
 * List all consultation notes
 */
export async function listConsults(): Promise<ListResponse<unknown>> {
  return getApiClient().get('/api/clinical/consults');
}

/**
 * List all CDS alerts
 */
export async function listCdsAlerts(): Promise<ListResponse<unknown>> {
  return getApiClient().get('/api/clinical/cds-alerts');
}
