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
  GrantBoundEmergencyAccessRequest,
  GrantBoundEmergencyAccessResponse,
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
  CodeBlueRecord,
  TraumaAssessment,
  StrokeAssessment,
  CardiacEvent,
  SepsisAssessment,
  EMSHandoff,
  MedicationAdministrationRecord,
  IntakeOutputRecord,
  NursingCarePlan,
  WoundAssessment,
  IVSiteAssessment,
  ShiftHandoff,
  IncidentReport,
  FallRiskAssessment,
  BurnAssessment,
  PsychiatricAssessment,
  ToxicologyAssessment,
  MassCasualtyIncident,
  IntubationRecord,
  LacerationRepair,
  SplintCastRecord,
  PediatricAssessment,
  ObstetricEmergency,
  SpecimenCollection,
  ChainOfCustody,
  LabQCRecord,
  CriticalValueNotification,
  SpecimenRejection,
  PhysicianOrder,
  DischargeSummary,
  DischargeInstructions,
  AMADischarge,
  HistoryAndPhysical,
  ConsultationNote,
  ProgressNote,
  PreOperativeAssessment,
  OperativeNote,
  PostOperativeNote,
  AnesthesiaRecord,
  RadiologyOrder,
  RadiologyReport,
  PathologyReport,
  ImmunizationRecord,
  FamilyMedicalHistory,
  BloodTypeScreen,
  TransfusionRecord,
  ElectronicPrescription,
  Appointment,
  DeathCertificate,
  AutopsyRequest,
  AutopsyReport,
  PatientSatisfactionSurvey,
  CreateSatisfactionSurveyInput,
  GcsAssessmentRecord,
  SampleHistoryRecord,
  ClinicalCreateResult,
  AssessmentCreateResult,
  IncidentCreateResult,
  RecordCreateResult,
  CollectionCreateResult,
  FormCreateResult,
  QcCreateResult,
  NotificationCreateResult,
  RejectionCreateResult,
  OrderCreateResult,
  SummaryCreateResult,
  InstructionsCreateResult,
  AmaCreateResult,
  HpCreateResult,
  ConsultCreateResult,
  NoteCreateResult,
  EPrescriptionCreateResult,
  InsuranceClaimCreateResult,
  CdsAlertCreateResult,
  TelehealthSessionCreateResult,
  AppointmentCreateResult,
  FamilyGroupCreateResult,
  SymptomCheckCreateResult,
  WearableDeviceCreateResult,
  WearableReadingCreateResult,
  AlertRuleCreateResult,
  MedicationReminderCreateResult,
  AdherenceLogCreateResult,
  SyncDeviceCreateResult,
  DoctorDashboardResponse,
  NurseDashboardResponse,
  LabDashboardResponse,
  AdminDashboardResponse,
  PatientDashboardResponse,
  PharmacistDashboardResponse,
  TelehealthSession,
  SymptomCheckSession,
  FamilyGroup,
  DrugReference,
  WearableDevice,
  WearableReading,
  WearableAlert,
  DemoInfo,
  PatientEmergencyRecords,
  NurseTasksResponse,
  EndTelehealthSessionResponse,
  CheckEligibilityResponse,
  DashboardMetricsResponse,
  PatientAnalyticsResponse,
  AppointmentAnalyticsResponse,
  QualityMetricsResponse,
  LockscreenMedicalId,
  MedicalIdCard,
  EmergencyMedicalId,
  VerifyInsuranceResponse,
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

export interface PatientAddressInput {
  street?: string | null;
  city: string;
  state?: string | null;
  country: string;
  postal_code?: string | null;
  coordinates?: { latitude: number; longitude: number } | null;
}

export interface PatientInsuranceInput {
  provider: string;
  policy_number: string;
  group_number?: string | null;
  valid_from: string;
  valid_to: string;
  coverage_type: 'Public' | 'Private' | 'Employer' | 'NHIS' | 'Community' | 'None';
  is_active: boolean;
}

export interface EmergencyContactInput {
  name: string;
  phone: string;
  relationship: string;
  can_make_medical_decisions?: boolean;
  language?: string | null;
}

/**
 * Update the demographic and administrative parts of a patient's own profile.
 *
 * Deliberately distinct from `updatePatient`, which carries clinical fields and
 * is restricted to providers: a patient is authoritative for where they live and
 * who insures them, but not for their own blood type.
 *
 * Omitted fields are left unchanged server-side, so a caller may send one
 * section at a time.
 */
export async function updateDemographics(
  patientId: string,
  data: Partial<{
    phone: string;
    gender: string;
    address: PatientAddressInput;
    insurance: PatientInsuranceInput;
    languages: string[];
  }>
): Promise<{ success: boolean; patient_id: string; message: string }> {
  return getApiClient().put(`/api/patients/${patientId}/demographics`, data);
}

/**
 * Replace a patient's entire emergency contact list.
 *
 * Whole-list replacement rather than per-index edits, so removing a contact
 * cannot shift the indices out from under a concurrent edit.
 */
export async function replaceEmergencyContacts(
  patientId: string,
  contacts: EmergencyContactInput[]
): Promise<{
  success: boolean;
  patient_id: string;
  contacts: Array<EmergencyContactInput & { priority: number }>;
  message: string;
}> {
  return getApiClient().put(`/api/patients/${patientId}/emergency-contacts`, { contacts });
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
/** One page of `/api/users`, plus the pagination block it returns. */
interface UsersPage {
  users?: User[];
  data?: User[];
  pagination?: { page: number; total_pages: number; total_items: number };
}

/**
 * Every user in the deployment.
 *
 * `/api/users` paginates at 20 per page. This used to request page 1 and
 * discard the `pagination` block entirely, so User Management rendered the
 * first 20 of 101 users under the heading "All Users" — an administrator could
 * not reach, search, deactivate or suspend the other 81, and nothing on the
 * screen suggested they existed.
 *
 * Pages are followed to exhaustion with a hard ceiling: this is an
 * administrative screen over a bounded staff directory, not a patient register,
 * and a runaway loop against a paginated endpoint is worse than a truncated
 * list. If the ceiling is ever hit, that is logged rather than passed off as
 * the complete set.
 */
export async function getUsers(): Promise<User[]> {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;

  const rowsOf = (response: User[] | UsersPage | null): User[] => {
    if (Array.isArray(response)) return response;
    if (response && typeof response === 'object') {
      if (Array.isArray(response.users)) return response.users;
      if (Array.isArray(response.data)) return response.data;
    }
    console.warn('[MediChain] Unexpected users API response format:', response);
    return [];
  };

  try {
    const all: User[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await getApiClient().get<User[] | UsersPage | null>(
        `/api/users?page=${page}&limit=${PAGE_SIZE}`
      );
      const rows = rowsOf(response);
      all.push(...rows);

      // A bare array means the endpoint is not paginating; one request is all
      // there is. Otherwise stop once the server says there is no further page,
      // or once a page comes back short.
      if (Array.isArray(response) || rows.length < PAGE_SIZE) break;
      const totalPages = (response as UsersPage)?.pagination?.total_pages;
      if (typeof totalPages === 'number' && page >= totalPages) break;

      if (page === MAX_PAGES) {
        console.warn(
          `[MediChain] getUsers stopped at the ${MAX_PAGES}-page ceiling; the list is truncated.`
        );
      }
    }
    return all;
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
  WalletUserInfo,
  CurrentUser,
  Role,
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

/** Request an opaque, single-use wallet-signing challenge. */
export async function requestWalletChallenge(walletAddress: string): Promise<WalletChallenge> {
  return getApiClient().post('/api/auth/challenge', { wallet_address: walletAddress });
}

/**
 * Sign in with an employee identifier and a password-derived proof.
 *
 * Returns the caller's encrypted keystore, not a session: the client still has
 * to open it and sign the auth challenge before it holds any authority. See
 * `auth/credentials.ts` for why the proof, not the password, is what travels.
 */
export async function staffLogin(body: {
  identifier: string;
  auth_proof: string;
}): Promise<{
  success: boolean;
  wallet_address: string;
  encrypted_keystore: string;
  name: string;
  role: Role;
}> {
  return getApiClient().post('/api/auth/staff/login', body);
}

/**
 * Bind an employee identifier and password to the caller's own wallet.
 *
 * Authenticated by the existing wallet-signature path, so only someone who
 * already controls the key can enrol credentials against it. Onboarding only.
 */
export async function enrolCredentials(body: {
  login_id: string;
  auth_proof: string;
  encrypted_keystore: string;
}): Promise<{ success: boolean; login_id: string; message: string }> {
  return getApiClient().post('/api/auth/credentials', body);
}

/**
 * Fetch the signed-in user's own identity in full: wallet, role, department,
 * specialty, licence, and the server's view of what their role permits.
 *
 * This is the authoritative provider context. Screens read from it instead of
 * asking the clinician to re-enter details the session already holds.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  return getApiClient().get('/api/auth/me');
}

// ============================================================================
// JWT authentication (Phase 9.4)
// ============================================================================

export interface JwtIssueRequest {
  wallet_address: string;
  challenge_id: string;
  nonce: string;
  /** Hex sr25519 signature over the issued login challenge message. */
  signature: string;
}

export interface WalletChallenge {
  success: boolean;
  challenge: {
    challenge_id: string;
    nonce: string;
    message: string;
    expires_in_secs: number;
  };
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
): Promise<JwtIssueResponse> {
  return getApiClient().post('/api/auth/jwt/refresh', { refresh_token: refreshToken });
}

/** Request a context- and device-bound emergency summary grant. */
export async function grantBoundEmergencyAccess(
  data: GrantBoundEmergencyAccessRequest
): Promise<GrantBoundEmergencyAccessResponse> {
  return getApiClient().post('/api/emergency/access', data);
}

// ============================================================================
// Federation identity contexts (Phase 1)
// ============================================================================

export type IdentityContextType = 'patient' | 'professional';

export interface IdentityContext {
  id: string;
  person_id: string;
  wallet_address: string;
  context_type: IdentityContextType;
  patient_profile_id?: string;
  organization_id?: string;
  facility_id?: string;
  assignment_id?: string;
  role?: string;
  created_at: string;
  expires_at: string;
}

export interface IdentityContextResponse {
  success: boolean;
  access_token: string;
  token_type: string;
  expires_in: number;
  context: IdentityContext;
}

/** Enter the authenticated user's professional work context. */
export async function enterWorkContext(): Promise<IdentityContextResponse> {
  return getApiClient().post('/api/identity/context/work', {});
}

/** Enter the authenticated user's personal patient context. */
export async function enterPatientContext(): Promise<IdentityContextResponse> {
  return getApiClient().post('/api/identity/context/patient', {});
}

/** Replace the active context and require clients to discard the previous token. */
export async function switchIdentityContext(
  context: IdentityContextType
): Promise<IdentityContextResponse> {
  return getApiClient().post('/api/identity/context/switch', { context });
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

export interface SaveUserSettingsResponse {
  success: boolean;
  message: string;
  user_id: string;
}

/** Load the current authenticated account's persisted UI preferences. */
export async function getUserSettings<T extends object>(): Promise<T> {
  return getApiClient().get<T>('/api/settings');
}

/** Persist the current authenticated account's UI preferences. */
export async function saveUserSettings<T extends object>(settings: T): Promise<SaveUserSettingsResponse> {
  return getApiClient().post<SaveUserSettingsResponse>('/api/settings', settings);
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
  // Identity is resolved by the one helper that owns the Bearer-vs-legacy
  // decision. Building it by hand here used to send the wallet address
  // alongside a valid Bearer token, putting that identifier on every export.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...client.getSessionHeaders(),
  };

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

/**
 * A patient's encrypted document references.
 *
 * Returns the bare array, not the `{patient_id, records, total}` envelope the
 * endpoint sends: `ApiClient.request` normalises any response carrying a
 * `records` array down to that array (see "Response Normalization" in
 * `client.ts`). The declared type used to describe the wire shape instead, so
 * every caller that destructured `{ records }` got `undefined` and threw on the
 * first array method — with no type error, because the annotation was simply
 * wrong.
 */
export async function getPatientRecords(
  patientId: string
): Promise<MedicalRecordReference[]> {
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

/** Patient-only self-verification of a physically-tapped NFC card (not a provider lookup by ID). */
export async function verifyMyNfcCard(
  cardHash: string
): Promise<{ success: boolean; status: string | null; last_used_at: number | null; message: string }> {
  return getApiClient().post('/api/nfc/verify-mine', { card_hash: cardHash });
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

export async function getDemoInfo(): Promise<DemoInfo> {
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

export async function createCodeBlue(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/code-blue', data);
}

export async function getCodeBlue(eventId: string): Promise<CodeBlueRecord> {
  return getApiClient().get(`/api/emergency/code-blue/${eventId}`);
}

export async function getPatientCodeBlues(patientId: string): Promise<CodeBlueRecord[]> {
  return getApiClient().get(`/api/emergency/code-blue/patient/${patientId}`);
}

export async function createTrauma(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/trauma', data);
}

export async function getTrauma(assessmentId: string): Promise<TraumaAssessment> {
  return getApiClient().get(`/api/emergency/trauma/${assessmentId}`);
}

export async function createStroke(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/stroke', data);
}

export async function getStroke(assessmentId: string): Promise<StrokeAssessment> {
  return getApiClient().get(`/api/emergency/stroke/${assessmentId}`);
}

export async function createCardiac(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/cardiac', data);
}

export async function getCardiac(eventId: string): Promise<CardiacEvent> {
  return getApiClient().get(`/api/emergency/cardiac/${eventId}`);
}

export async function createSepsis(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/sepsis', data);
}

export async function getSepsis(assessmentId: string): Promise<SepsisAssessment> {
  return getApiClient().get(`/api/emergency/sepsis/${assessmentId}`);
}

export async function createEmsHandoff(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/ems-handoff', data);
}

export async function getEmsHandoff(reportId: string): Promise<EMSHandoff> {
  return getApiClient().get(`/api/emergency/ems-handoff/${reportId}`);
}

export async function getPatientEmergencyRecords(patientId: string): Promise<PatientEmergencyRecords> {
  return getApiClient().get(`/api/emergency/patient/${patientId}`);
}

// ============================================================================
// Nursing Documentation (Phase 3)
// ============================================================================

export async function createMar(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/mar', data);
}

// NOTE: the backend's `GET /api/emergency/mar/{patient_id}/{medication_id}` looks up
// a composite `"{patient_id}:{medication_id}"` id, but `createMar` stores records under
// `"MAR-{patient_id}-{date}"` — the two id schemes don't match, so this lookup can never
// find a record `createMar` actually wrote. Backend bug, not just a path fix; tracked
// separately. Path corrected here so it at least reaches the real handler.
export async function getMar(patientId: string, medicationId: string): Promise<MedicationAdministrationRecord> {
  return getApiClient().get(`/api/emergency/mar/${patientId}/${medicationId}`);
}

export async function listMar(): Promise<unknown[]> {
  const response = await getApiClient().get<unknown>('/api/emergency/mar/list');
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

export async function administerMedication(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/nursing/mar/administer', data);
}

export async function createIo(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/io', data);
}

// NOTE: the backend route is `{patient_id}/{type}/{timestamp}` but `get_io` ignores the
// middle segment and reconstructs its lookup id from `{patient_id}` + the THIRD segment
// (which must be the record's date, matching `create_io`'s `IO-{patient_id}-{date}` id) —
// so `shift` here must actually be a date string, not a shift name. No current caller;
// flagging for whoever wires this up next rather than guessing at a fix with no usage to verify against.
export async function getIo(patientId: string, date: string, shift: string): Promise<IntakeOutputRecord> {
  return getApiClient().get(`/api/emergency/io/${patientId}/${date}/${shift}`);
}

export async function listIo(): Promise<IntakeOutputRecord[]> {
  return getApiClient().get('/api/emergency/io/list');
}

export async function recordFluid(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/record-fluid', data);
}

export async function createCarePlan(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/care-plan', data);
}

export async function getCarePlan(planId: string): Promise<NursingCarePlan> {
  return getApiClient().get(`/api/emergency/care-plan/${planId}`);
}

export async function listCarePlans(): Promise<NursingCarePlan[]> {
  return getApiClient().get('/api/emergency/care-plan/list');
}

export async function createWound(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/wound', data);
}

export async function getWound(assessmentId: string): Promise<WoundAssessment> {
  return getApiClient().get(`/api/emergency/wound/${assessmentId}`);
}

export async function createIvSite(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/iv-site', data);
}

export async function getIvSite(assessmentId: string): Promise<IVSiteAssessment> {
  return getApiClient().get(`/api/emergency/iv-site/${assessmentId}`);
}

export async function createShiftHandoff(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/handoff', data);
}

export async function getShiftHandoff(handoffId: string): Promise<ShiftHandoff> {
  return getApiClient().get(`/api/emergency/handoff/${handoffId}`);
}

export async function createIncident(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/incident', data);
}

export async function getIncident(reportId: string): Promise<IncidentReport> {
  return getApiClient().get(`/api/emergency/incident/${reportId}`);
}

export async function createFallRisk(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/fall-risk', data);
}

export async function getFallRisk(assessmentId: string): Promise<FallRiskAssessment> {
  return getApiClient().get(`/api/emergency/fall-risk/${assessmentId}`);
}

export async function getNurseTasks(): Promise<NurseTasksResponse> {
  return getApiClient().get('/api/nurse/tasks');
}

// ============================================================================
// Specialized Assessments (Phase 4)
// ============================================================================

export async function createBurn(data: unknown): Promise<AssessmentCreateResult> {
  return getApiClient().post('/api/clinical/burn', data);
}

export async function getBurn(assessmentId: string): Promise<BurnAssessment> {
  return getApiClient().get(`/api/clinical/burn/${assessmentId}`);
}

export async function createPsych(data: unknown): Promise<AssessmentCreateResult> {
  return getApiClient().post('/api/clinical/psych', data);
}

export async function getPsychForPatient(patientId: string): Promise<{ assessments: unknown[] }> {
  return getApiClient().get(`/api/clinical/psych/patient/${patientId}`);
}

export async function getPsych(assessmentId: string): Promise<PsychiatricAssessment> {
  return getApiClient().get(`/api/clinical/psych/${assessmentId}`);
}

export async function createTox(data: unknown): Promise<AssessmentCreateResult> {
  return getApiClient().post('/api/clinical/tox', data);
}

export async function getTox(assessmentId: string): Promise<ToxicologyAssessment> {
  return getApiClient().get(`/api/clinical/tox/${assessmentId}`);
}

export async function createMci(data: unknown): Promise<IncidentCreateResult> {
  return getApiClient().post('/api/clinical/mci', data);
}

export async function getMci(incidentId: string): Promise<MassCasualtyIncident> {
  return getApiClient().get(`/api/clinical/mci/${incidentId}`);
}

// ============================================================================
// Procedures (Phase 5)
// ============================================================================

export async function createIntubation(data: unknown): Promise<RecordCreateResult> {
  return getApiClient().post('/api/clinical/intubation', data);
}

export async function getIntubation(recordId: string): Promise<IntubationRecord> {
  return getApiClient().get(`/api/clinical/intubation/${recordId}`);
}

export async function createLaceration(data: unknown): Promise<RecordCreateResult> {
  return getApiClient().post('/api/clinical/laceration', data);
}

export async function getLaceration(recordId: string): Promise<LacerationRepair> {
  return getApiClient().get(`/api/clinical/laceration/${recordId}`);
}

export async function createSplint(data: unknown): Promise<RecordCreateResult> {
  return getApiClient().post('/api/clinical/splint', data);
}

export async function getSplint(recordId: string): Promise<SplintCastRecord> {
  return getApiClient().get(`/api/clinical/splint/${recordId}`);
}

// ============================================================================
// Specialty Populations (Phase 6)
// ============================================================================

/**
 * One patient's pediatric assessments, newest first.
 *
 * Patient-scoped by design: the pediatrics page charts one child's growth
 * series, and an all-patients read would expose every child's record to
 * satisfy a single patient's page.
 */
export async function listPedsForPatient(
  patientId: string,
): Promise<{ success: boolean; items: unknown[] }> {
  const response = await getApiClient().get<{ success?: boolean; items?: unknown[] } | null>(
    `/api/clinical/peds/patient/${encodeURIComponent(patientId)}`,
  );
  return { success: true, items: response?.items ?? [] };
}

export async function createPeds(data: unknown): Promise<AssessmentCreateResult> {
  return getApiClient().post('/api/clinical/peds', data);
}

export async function getPeds(assessmentId: string): Promise<PediatricAssessment> {
  return getApiClient().get(`/api/clinical/peds/${assessmentId}`);
}

export async function createOb(data: unknown): Promise<AssessmentCreateResult> {
  return getApiClient().post('/api/clinical/ob', data);
}

export async function getOb(assessmentId: string): Promise<ObstetricEmergency> {
  return getApiClient().get(`/api/clinical/ob/${assessmentId}`);
}

// ============================================================================
// Laboratory (Phase 7)
// ============================================================================

export async function createSpecimen(data: unknown): Promise<CollectionCreateResult> {
  return getApiClient().post('/api/clinical/specimen', data);
}

export async function getSpecimen(collectionId: string): Promise<SpecimenCollection> {
  return getApiClient().get(`/api/clinical/specimen/${collectionId}`);
}

export async function createChainOfCustody(data: unknown): Promise<FormCreateResult> {
  return getApiClient().post('/api/clinical/chain-of-custody', data);
}

export async function getChainOfCustody(formId: string): Promise<ChainOfCustody> {
  return getApiClient().get(`/api/clinical/chain-of-custody/${formId}`);
}

export async function createLabQc(data: unknown): Promise<QcCreateResult> {
  return getApiClient().post('/api/clinical/lab-qc', data);
}

export async function getLabQc(qcId: string): Promise<LabQCRecord> {
  return getApiClient().get(`/api/clinical/lab-qc/${qcId}`);
}

export async function createCriticalValue(data: unknown): Promise<NotificationCreateResult> {
  return getApiClient().post('/api/clinical/critical-value', data);
}

export async function getCriticalValue(notificationId: string): Promise<CriticalValueNotification> {
  return getApiClient().get(`/api/clinical/critical-value/${notificationId}`);
}

export async function createSpecimenRejection(data: unknown): Promise<RejectionCreateResult> {
  return getApiClient().post('/api/clinical/specimen-rejection', data);
}

export async function getSpecimenRejection(rejectionId: string): Promise<SpecimenRejection> {
  return getApiClient().get(`/api/clinical/specimen-rejection/${rejectionId}`);
}

// ============================================================================
// Physician Documentation (Phase 8)
// ============================================================================

export async function createOrder(data: unknown): Promise<OrderCreateResult> {
  return getApiClient().post('/api/clinical/order', data);
}

export async function getOrder(orderId: string): Promise<PhysicianOrder> {
  return getApiClient().get(`/api/clinical/order/${orderId}`);
}

export async function listOrders(): Promise<{ success: boolean; orders: PhysicianOrder[] }> {
  return getApiClient().get('/api/clinical/orders');
}

export async function createDischargeSummary(data: unknown): Promise<SummaryCreateResult> {
  return getApiClient().post('/api/clinical/discharge-summary', data);
}

export async function getDischargeSummary(summaryId: string): Promise<DischargeSummary> {
  return getApiClient().get(`/api/clinical/discharge-summary/${summaryId}`);
}

export async function listDischarges(): Promise<{ success: boolean; discharges: DischargeSummary[] }> {
  return getApiClient().get('/api/clinical/discharges');
}

export async function approveDischarge(
  summaryId: string
): Promise<{ success: boolean; message: string; summary_id: string; signed_by: string }> {
  return getApiClient().post(`/api/clinical/discharges/${summaryId}/approve`, {});
}

export async function createDischargeInstructions(data: unknown): Promise<InstructionsCreateResult> {
  return getApiClient().post('/api/clinical/discharge-instructions', data);
}

export async function getDischargeInstructions(instructionsId: string): Promise<DischargeInstructions> {
  return getApiClient().get(`/api/clinical/discharge-instructions/${instructionsId}`);
}

export async function createAma(data: unknown): Promise<AmaCreateResult> {
  return getApiClient().post('/api/clinical/ama', data);
}

export async function getAma(amaId: string): Promise<AMADischarge> {
  return getApiClient().get(`/api/clinical/ama/${amaId}`);
}

export async function createHp(data: unknown): Promise<HpCreateResult> {
  return getApiClient().post('/api/clinical/hp', data);
}

export async function getHp(hpId: string): Promise<HistoryAndPhysical> {
  return getApiClient().get(`/api/clinical/hp/${hpId}`);
}

export async function createConsult(data: unknown): Promise<ConsultCreateResult> {
  return getApiClient().post('/api/clinical/consult', data);
}

/**
 * Record a consultant's response, completing the consultation.
 *
 * The response is the answer the requesting clinician is waiting on. Until
 * this existed the portal kept it in local state only, so a specialist's
 * assessment survived exactly as long as the browser tab.
 */
export async function respondToConsult(
  consultId: string,
  body: { assessment: string; recommendations: string; follow_up?: string }
): Promise<{
  success: boolean;
  consult_id: string;
  status: string | null;
  completed_at: string | null;
  consulting_provider: string;
}> {
  return getApiClient().put(`/api/clinical/consult/${consultId}/response`, body);
}

export async function getConsult(consultId: string): Promise<ConsultationNote> {
  return getApiClient().get(`/api/clinical/consult/${consultId}`);
}

export async function createProgressNote(data: unknown): Promise<NoteCreateResult> {
  return getApiClient().post('/api/clinical/progress-note', data);
}

export async function getProgressNote(noteId: string): Promise<ProgressNote> {
  return getApiClient().get(`/api/clinical/progress-note/${noteId}`);
}

// ============================================================================
// Surgical Documentation (Phase 9)
// ============================================================================

export async function createPreOp(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/pre-op', data);
}

export async function getPreOp(assessmentId: string): Promise<PreOperativeAssessment> {
  return getApiClient().get(`/api/surgical/pre-op/${assessmentId}`);
}

export async function createOperativeNote(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/operative-note', data);
}

export async function getOperativeNote(noteId: string): Promise<OperativeNote> {
  return getApiClient().get(`/api/surgical/operative-note/${noteId}`);
}

export async function createPostOp(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/post-op', data);
}

export async function getPostOp(noteId: string): Promise<PostOperativeNote> {
  return getApiClient().get(`/api/surgical/post-op/${noteId}`);
}

// ============================================================================
// Clinical Records (Specialty)
// ============================================================================

export async function createAMADischarge(data: unknown): Promise<AmaCreateResult> {
  return getApiClient().post('/api/clinical/ama', data);
}

export async function listAMADischarges(): Promise<AMADischarge[]> {
  const response = await getApiClient().get<AMADischarge[]>('/api/platform/list/ama-discharges');
  return response || [];
}

export async function createHistoryPhysical(data: unknown): Promise<HpCreateResult> {
  return getApiClient().post('/api/clinical/hp', data);
}

export async function getHistoryPhysical(hpId: string): Promise<HistoryAndPhysical> {
  return getApiClient().get(`/api/clinical/hp/${hpId}`);
}

export async function listHistoryPhysicals(): Promise<HistoryAndPhysical[]> {
  return getApiClient().get('/api/clinical/hp');
}

// NOTE: no distinct "incident report" (plural) backend feature exists — the real
// endpoints are the singular `create_incident`/`get_incident` under `/api/emergency/incident`
// (see createIncident/getIncident above) plus an admin-wide list at `/api/platform/list/incidents`.
// Pointed at those real endpoints rather than the nonexistent `/api/clinical/incident-reports`.
export async function createIncidentReport(data: unknown): Promise<IncidentCreateResult> {
  return getApiClient().post('/api/emergency/incident', data);
}

export async function listIncidentReports(): Promise<IncidentReport[]> {
  return getApiClient().get('/api/platform/list/incidents');
}

// NOTE: same situation as incident reports above — real endpoints are `create_io`
// (`/api/emergency/io`, see createIo above) and the admin-wide list at
// `/api/platform/list/intake-output`, not the nonexistent `/api/clinical/intake-output`.
export async function createIntakeOutput(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/io', data);
}

export async function listIntakeOutput(): Promise<IntakeOutputRecord[]> {
  return getApiClient().get('/api/platform/list/intake-output');
}

// ============================================================================
// Anesthesia (Phase 10)
// ============================================================================

export async function createAnesthesia(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/anesthesia', data);
}

export async function getAnesthesia(recordId: string): Promise<AnesthesiaRecord> {
  return getApiClient().get(`/api/surgical/anesthesia/${recordId}`);
}

export async function listAnesthesia(): Promise<AnesthesiaRecord[]> {
  return getApiClient().get('/api/surgical/anesthesia/list');
}

// ============================================================================
// Radiology (Phase 11)
// ============================================================================

export async function createRadiologyOrder(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/radiology/order', data);
}

export async function getRadiologyOrder(orderId: string): Promise<RadiologyOrder> {
  return getApiClient().get(`/api/surgical/radiology/order/${orderId}`);
}

export async function createRadiologyReport(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/radiology/report', data);
}

export async function getRadiologyReport(reportId: string): Promise<RadiologyReport> {
  return getApiClient().get(`/api/surgical/radiology/report/${reportId}`);
}

// ============================================================================
// Pathology (Phase 12)
// ============================================================================

export async function createPathology(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/pathology', data);
}

export async function getPathology(reportId: string): Promise<PathologyReport> {
  return getApiClient().get(`/api/surgical/pathology/${reportId}`);
}

// ============================================================================
// Immunization (Phase 13)
// ============================================================================

export async function createImmunization(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/immunization', data);
}

export async function getImmunization(recordId: string): Promise<ImmunizationRecord> {
  return getApiClient().get(`/api/surgical/immunization/${recordId}`);
}

// ============================================================================
// Family History (Phase 14)
// ============================================================================

export async function createFamilyHistory(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/family-history', data);
}

export async function getFamilyHistory(patientId: string): Promise<FamilyMedicalHistory> {
  return getApiClient().get(`/api/surgical/family-history/${patientId}`);
}

// ============================================================================
// Blood Bank (Phase 15)
// ============================================================================

export async function createBloodTypeScreen(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/blood-type', data);
}

export async function getBloodTypeScreen(testId: string): Promise<BloodTypeScreen> {
  return getApiClient().get(`/api/surgical/blood-type/${testId}`);
}

export async function createTransfusion(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/transfusion', data);
}

export async function getTransfusion(transfusionId: string): Promise<TransfusionRecord> {
  return getApiClient().get(`/api/surgical/transfusion/${transfusionId}`);
}

// ============================================================================
// E-Prescribing (Phase 16)
// ============================================================================

export async function createEPrescription(data: unknown): Promise<EPrescriptionCreateResult> {
  return getApiClient().post('/api/e-prescriptions', data);
}

export async function signEPrescription(
  prescriptionId: string,
  data: unknown
): Promise<{ success: boolean; prescription_id: string; status: string; signed_at: number; message: string }> {
  return getApiClient().post(`/api/e-prescriptions/${prescriptionId}/sign`, data);
}

export async function transmitEPrescription(
  prescriptionId: string
): Promise<{ success: boolean; prescription_id: string; status: string; transmitted_at: number; pharmacy: string; message: string }> {
  return getApiClient().post(`/api/e-prescriptions/${prescriptionId}/transmit`, {});
}

export async function getEPrescription(
  prescriptionId: string
): Promise<{ success: boolean; prescription: ElectronicPrescription }> {
  return getApiClient().get(`/api/e-prescriptions/${prescriptionId}`);
}

export async function getPatientEPrescriptions(
  patientId: string
): Promise<{ success: boolean; patient_id: string; prescriptions: ElectronicPrescription[]; count: number }> {
  return getApiClient().get(`/api/e-prescriptions/patient/${patientId}`);
}

// ============================================================================
// Appointments (Phase 17)
// ============================================================================

export async function createAppointment(data: unknown): Promise<AppointmentCreateResult> {
  return getApiClient().post('/api/appointments', data);
}

/** A clinician a patient can choose to book with. */
export interface BookableProvider {
  wallet_address: string;
  name: string;
  role: string;
  username?: string;
  specialty?: string | null;
}

/**
 * Registered clinicians, optionally narrowed to one role (e.g. `'doctor'`).
 *
 * Readable by any registered caller, patients included, because choosing who
 * to book with requires knowing who exists. Returns only professional
 * identity - never other patients.
 */
export async function getProviders(
  role?: string
): Promise<{ success: boolean; providers: BookableProvider[]; count: number }> {
  const query = role ? `?role=${encodeURIComponent(role)}` : '';
  return getApiClient().get(`/api/providers${query}`);
}

/**
 * Advance an appointment through its lifecycle.
 *
 * The server enforces the transition table and the caller's rights, so a
 * rejected move comes back as 409 INVALID_TRANSITION or 403, not as a silent
 * no-op. `reason` is required when cancelling.
 */
export async function setAppointmentStatus(
  appointmentId: string,
  status:
    | 'scheduled'
    | 'confirmed'
    | 'checked_in'
    | 'in_progress'
    | 'completed'
    | 'cancelled'
    | 'no_show'
    // The party who did not book refuses the proposed time. Distinct from
    // 'cancelled', which either party may do to an already-agreed appointment.
    | 'declined',
  reason?: string
): Promise<{ success: boolean; appointment_id: string; status: string; message: string }> {
  return getApiClient().post(`/api/appointments/${appointmentId}/status`, { status, reason });
}

export async function getAppointment(appointmentId: string): Promise<Appointment> {
  return getApiClient().get(`/api/appointments/${appointmentId}`);
}

export async function getPatientAppointments(
  patientId: string
): Promise<{ success: boolean; appointments: Appointment[]; count: number }> {
  return getApiClient().get(`/api/appointments/patient/${patientId}`);
}

export async function getProviderAppointments(
  providerId: string
): Promise<{ success: boolean; appointments: Appointment[]; count: number }> {
  return getApiClient().get(`/api/appointments/provider/${providerId}`);
}

export async function cancelAppointment(
  appointmentId: string,
  data: unknown
): Promise<{ success: boolean; message: string }> {
  return getApiClient().post(`/api/appointments/${appointmentId}/cancel`, data);
}

export async function checkInAppointment(appointmentId: string): Promise<{ success: boolean; message: string }> {
  return getApiClient().post(`/api/appointments/${appointmentId}/check-in`, {});
}

export async function getAvailableSlots(
  providerId: string,
  date: string
): Promise<{ success: boolean; provider_id: string; date: string; available_slots: string[]; slot_duration_minutes: number }> {
  return getApiClient().get(`/api/appointments/slots/${providerId}/${date}`);
}

// ============================================================================
// Death Certificate & Autopsy (Phase 18)
// ============================================================================

export async function createDeathCertificate(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/death-certificate', data);
}

export async function getDeathCertificate(certificateId: string): Promise<DeathCertificate> {
  return getApiClient().get(`/api/surgical/death-certificate/${certificateId}`);
}

export async function createAutopsyRequest(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/autopsy', data);
}

export async function getAutopsyRequest(requestId: string): Promise<AutopsyRequest> {
  return getApiClient().get(`/api/surgical/autopsy/${requestId}`);
}

export async function createAutopsyReport(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/autopsy/report', data);
}

export async function getAutopsyReport(reportId: string): Promise<AutopsyReport> {
  return getApiClient().get(`/api/surgical/autopsy/report/${reportId}`);
}

// ============================================================================
// Patient Satisfaction (Phase 19)
// ============================================================================

export async function createSatisfactionSurvey(
  data: CreateSatisfactionSurveyInput
): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/clinical/satisfaction-survey', data);
}

export async function getSatisfactionSurvey(surveyId: string): Promise<PatientSatisfactionSurvey> {
  return getApiClient().get(`/api/surgical/satisfaction-survey/${surveyId}`);
}

// ============================================================================
// Medication Reminders (Phase 20)
// ============================================================================

export async function createMedicationReminder(data: unknown): Promise<MedicationReminderCreateResult> {
  return getApiClient().post('/api/reminders/medication', data);
}

export async function getPatientReminders(
  patientId: string
): Promise<{ success: boolean; patient_id: string; reminders: Record<string, unknown>[]; count: number }> {
  return getApiClient().get(`/api/reminders/medication/${patientId}`);
}

export async function logMedicationAdherence(data: unknown): Promise<AdherenceLogCreateResult> {
  return getApiClient().post('/api/reminders/adherence', data);
}

export async function deleteMedicationReminder(reminderId: string): Promise<{ success: boolean; message: string }> {
  return getApiClient().delete(`/api/reminders/medication/${reminderId}`);
}

// ============================================================================
// Drug Interactions (Phase 21)
// ============================================================================

export async function getDrugDatabase(): Promise<{ success: boolean; drugs: DrugReference[]; count: number }> {
  return getApiClient().get('/api/drugs');
}

export async function getInteractionDatabase(): Promise<{
  success: boolean;
  interactions: Record<string, unknown>[];
  count: number;
}> {
  return getApiClient().get('/api/interactions');
}

export async function checkDrugInteractions(data: unknown): Promise<{
  success: boolean;
  check_id: string;
  patient_id: string;
  medications_checked: number;
  interactions_found: number;
  has_critical: boolean;
  interactions: Record<string, unknown>[];
  allergy_alerts: Record<string, unknown>[];
  recommendation: string;
}> {
  return getApiClient().post('/api/interactions/check', data);
}

export async function getInteractionHistory(
  patientId: string
): Promise<{ success: boolean; patient_id: string; checks: Record<string, unknown>[]; count: number }> {
  return getApiClient().get(`/api/interactions/history/${patientId}`);
}

// ============================================================================
// Family Groups (Phase 22)
// ============================================================================

export async function createFamilyGroup(data: unknown): Promise<FamilyGroupCreateResult> {
  return getApiClient().post('/api/family/groups', data);
}

export async function addFamilyMember(
  groupId: string,
  data: unknown
): Promise<{ success: boolean; message: string }> {
  return getApiClient().post(`/api/family/groups/${groupId}/members`, data);
}

export async function getFamilyGroup(groupId: string): Promise<{ success: boolean; group: FamilyGroup }> {
  return getApiClient().get(`/api/family/groups/${groupId}`);
}

export async function getMyFamilyGroups(): Promise<{ success: boolean; groups: FamilyGroup[]; count: number }> {
  return getApiClient().get('/api/family/my-groups');
}

export async function removeFamilyMember(
  groupId: string,
  patientId: string
): Promise<{ success: boolean; message: string }> {
  return getApiClient().delete(`/api/family/groups/${groupId}/members/${patientId}`);
}

// ============================================================================
// Wearables (Phase 24)
// ============================================================================

export async function registerWearableDevice(data: unknown): Promise<WearableDeviceCreateResult> {
  return getApiClient().post('/api/wearables/devices', data);
}

export async function getWearableDevices(): Promise<{ success: boolean; devices: WearableDevice[]; count: number }> {
  return getApiClient().get('/api/wearables/devices');
}

export async function submitWearableReading(data: unknown): Promise<WearableReadingCreateResult> {
  return getApiClient().post('/api/wearables/readings', data);
}

export async function getWearableReadings(
  patientId: string,
  type?: string
): Promise<{ success: boolean; readings: WearableReading[]; count: number }> {
  const url = type ? `/api/wearables/readings/${patientId}?type=${type}` : `/api/wearables/readings/${patientId}`;
  return getApiClient().get(url);
}

export async function createWearableAlertRule(data: unknown): Promise<AlertRuleCreateResult> {
  return getApiClient().post('/api/wearables/alerts/rules', data);
}

export async function getWearableAlerts(): Promise<{ success: boolean; alerts: WearableAlert[]; count: number }> {
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

export async function startSymptomCheck(data: unknown): Promise<SymptomCheckCreateResult> {
  return getApiClient().post('/api/symptoms/start', data);
}

export async function submitSymptomAnswers(
  sessionId: string,
  data: unknown
): Promise<{ success: boolean; session: SymptomCheckSession }> {
  return getApiClient().post(`/api/symptoms/${sessionId}/answers`, data);
}

export async function getSymptomSession(
  sessionId: string
): Promise<{ success: boolean; session: SymptomCheckSession }> {
  return getApiClient().get(`/api/symptoms/${sessionId}`);
}

export async function getSymptomCheckerHistory(
  patientId: string
): Promise<{ success: boolean; patient_id: string; sessions: SymptomCheckSession[]; count: number }> {
  return getApiClient().get(`/api/symptoms/history/${patientId}`);
}

// ============================================================================
// Telehealth (Phase 26)
// ============================================================================

export async function createTelehealthSession(data: unknown): Promise<TelehealthSessionCreateResult> {
  return getApiClient().post('/api/telehealth/sessions', data);
}

export async function getTelehealthSession(
  sessionId: string
): Promise<{ success: boolean; session: TelehealthSession }> {
  return getApiClient().get(`/api/telehealth/sessions/${sessionId}`);
}

export async function joinTelehealthSession(
  sessionId: string
): Promise<{ jitsi?: Record<string, unknown> | null; video_room_url?: string | null; role?: string; subject?: string | null }> {
  return getApiClient().post(`/api/telehealth/sessions/${sessionId}/join`, {});
}

export async function endTelehealthSession(sessionId: string, data?: unknown): Promise<EndTelehealthSessionResponse> {
  return getApiClient().post(`/api/telehealth/sessions/${sessionId}/end`, data || {});
}

/** Relay a telehealth lifecycle event (Phase 7): SSE-broadcast + audit-logged. */
export async function telehealthEvent(
  sessionId: string,
  eventType: string,
  detail?: string
): Promise<{ success: boolean }> {
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

export async function submitDeviceCheck(data: unknown): Promise<{
  success: boolean;
  ready_for_telehealth: boolean;
  check_id: string;
  issues: string[];
  recommendations: string[];
  details: Record<string, unknown>;
}> {
  return getApiClient().post('/api/telehealth/device-check', data);
}

export async function getPatientTelehealthSessions(
  patientId: string
): Promise<{ success: boolean; patient_id: string; sessions: TelehealthSession[]; count: number }> {
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

export async function createCdsAlert(data: unknown): Promise<CdsAlertCreateResult> {
  return getApiClient().post('/api/cds/alerts', data);
}

export async function getCdsAlerts(
  params?: Record<string, string>
): Promise<{ success: boolean; alerts: Record<string, unknown>[]; count: number }> {
  const query = new URLSearchParams(params).toString();
  return getApiClient().get(`/api/cds/alerts?${query}`);
}

export async function getCdsAlert(alertId: string): Promise<{ success: boolean; alert: Record<string, unknown> }> {
  return getApiClient().get(`/api/cds/alerts/${alertId}`);
}

export async function respondToCdsAlert(
  alertId: string,
  data: unknown
): Promise<{ success: boolean; alert_id: string; status: string; message: string }> {
  return getApiClient().post(`/api/cds/alerts/${alertId}/respond`, data);
}

export async function getPatientCdsAlerts(
  patientId: string
): Promise<{ success: boolean; patient_id: string; alerts: Record<string, unknown>[]; count: number }> {
  return getApiClient().get(`/api/cds/patient/${patientId}/alerts`);
}

// ============================================================================
// Lab Trends (Phase 28)
// ============================================================================

export async function getLabTrends(
  patientId: string,
  testCode?: string
): Promise<{
  success: boolean;
  patient_id: string;
  trends: Record<string, unknown>[];
  count: number;
  statistics: Record<string, unknown>;
  per_test_statistics: Record<string, unknown>;
}> {
  const url = testCode ? `/api/lab-trends/patient/${patientId}?test_code=${testCode}` : `/api/lab-trends/patient/${patientId}`;
  return getApiClient().get(url);
}

export async function analyzeLabTrends(data: unknown): Promise<{
  success: boolean;
  patient_id: string;
  trends: Record<string, unknown>[];
  count: number;
  aggregate_statistics: Record<string, unknown>;
}> {
  return getApiClient().post('/api/lab-trends/analyze', data);
}

export async function getLabTrendResult(resultId: string): Promise<{ success: boolean; trend: Record<string, unknown> }> {
  return getApiClient().get(`/api/lab-trends/${resultId}`);
}

// ============================================================================
// Insurance Claims (Phase 30)
// ============================================================================

export async function createInsuranceClaim(data: unknown): Promise<InsuranceClaimCreateResult> {
  return getApiClient().post('/api/insurance/claims', data);
}

export async function submitInsuranceClaim(
  claimId: string
): Promise<{ success: boolean; claim_id: string; payer_claim_number: string; status: string; submitted_at: number; message: string }> {
  return getApiClient().post(`/api/insurance/claims/${claimId}/submit`, {});
}

export async function getInsuranceClaim(claimId: string): Promise<{ success: boolean; claim: Record<string, unknown> }> {
  return getApiClient().get(`/api/insurance/claims/${claimId}`);
}

export async function getPatientInsuranceClaims(
  patientId: string,
  pagination?: { cursor?: string | null; limit?: number }
): Promise<{
  success: boolean;
  patient_id: string;
  claims: Record<string, unknown>[];
  count: number;
  next_cursor?: string | null;
}> {
  const params = new URLSearchParams();
  if (pagination?.cursor) params.set('cursor', pagination.cursor);
  if (pagination?.limit) params.set('limit', String(pagination.limit));
  const query = params.toString();
  return getApiClient().get(
    `/api/insurance/claims/patient/${patientId}${query ? `?${query}` : ''}`
  );
}

export async function checkInsuranceEligibility(data: unknown): Promise<CheckEligibilityResponse> {
  return getApiClient().post('/api/insurance/eligibility', data);
}

// ============================================================================
// Analytics (Phase 31)
// ============================================================================

export async function getDashboardMetrics(params: Record<string, string>): Promise<DashboardMetricsResponse> {
  const query = new URLSearchParams(params).toString();
  return getApiClient().get(`/api/platform/analytics/dashboard?${query}`);
}

export async function getPatientAnalytics(): Promise<PatientAnalyticsResponse> {
  return getApiClient().get('/api/platform/analytics/patients');
}

export async function getAppointmentAnalytics(): Promise<AppointmentAnalyticsResponse> {
  return getApiClient().get('/api/platform/analytics/appointments');
}

export async function getQualityMetrics(): Promise<QualityMetricsResponse> {
  return getApiClient().get('/api/platform/analytics/quality');
}

// ============================================================================
// Languages (Phase 32)
// ============================================================================

export async function getSupportedLanguages(): Promise<{
  success: boolean;
  languages: { code: string; name: string; native_name: string }[];
}> {
  return getApiClient().get('/api/platform/languages');
}

export async function setLanguagePreference(data: unknown): Promise<{ success: boolean; message: string }> {
  return getApiClient().post('/api/platform/languages/preference', data);
}

export async function getLanguagePreference(userId: string): Promise<{
  user_id: string;
  preferred_language: string;
  secondary_language: string | null;
  reading_proficiency: string;
  needs_interpreter: boolean;
  interpreter_language: string | null;
  updated_at: number;
}> {
  return getApiClient().get(`/api/platform/languages/preference/${userId}`);
}

export async function translateContent(
  data: unknown
): Promise<{ success: boolean; original_content: string; translated_content: string; target_language: string }> {
  return getApiClient().post('/api/platform/translate', data);
}

// ============================================================================
// SMS Preferences (Phase 5.3)
// ============================================================================

export async function optOutOfSms(phoneNumber: string): Promise<{ success: boolean; message: string }> {
  return getApiClient().post('/api/notifications/sms/opt-out', { phone_number: phoneNumber });
}

export async function optInToSms(phoneNumber: string): Promise<{ success: boolean; message: string }> {
  return getApiClient().post('/api/notifications/sms/opt-in', { phone_number: phoneNumber });
}

export async function getSmsOptOutStatus(
  phoneNumber: string
): Promise<{ phone_number: string; opted_out: boolean }> {
  return getApiClient().get(`/api/notifications/sms/opt-out/${encodeURIComponent(phoneNumber)}`);
}

// ============================================================================
// Push Notifications (Phase 5.2 — FCM device registration)
// ============================================================================

export async function registerDeviceToken(
  token: string,
  deviceType?: string,
  deviceName?: string
): Promise<{ success: boolean; status: string }> {
  return getApiClient().post('/api/notifications/register-device', {
    token,
    device_type: deviceType,
    device_name: deviceName,
  });
}

// ============================================================================
// Offline Sync (Phase 33)
// ============================================================================

export async function getSyncStatus(deviceId: string): Promise<{
  device_id: string;
  last_successful_sync: number;
  pending_server_changes: number;
  status: string;
}> {
  return getApiClient().get(`/api/sync/status/${deviceId}`);
}

export async function registerSyncDevice(data: unknown): Promise<SyncDeviceCreateResult> {
  return getApiClient().post('/api/sync/register', data);
}

export async function getSyncConflicts(): Promise<{ conflicts: Record<string, unknown>[] }> {
  return getApiClient().get('/api/sync/conflicts');
}

export async function resolveSyncConflict(
  conflictId: string,
  resolution: 'UseLocal' | 'UseServer' | 'Merge',
): Promise<{ success: boolean; conflict_id: string; resolution: string }> {
  return getApiClient().post(`/api/sync/conflicts/${conflictId}/resolve`, { resolution });
}

export async function performSync(
  data: unknown
): Promise<{ success: boolean; processed: number; conflicts: Record<string, unknown>[]; sync_timestamp: number }> {
  return getApiClient().post('/api/sync', data);
}

export async function getSyncQueue(
  deviceId: string
): Promise<{ device_id: string; queue: Record<string, unknown>[]; count: number }> {
  return getApiClient().get(`/api/sync/queue/${deviceId}`);
}

export async function downloadOfflineData(patientId: string): Promise<{
  patient: Record<string, unknown>;
  records: Record<string, unknown>[];
  vitals: Record<string, unknown>[];
  downloaded_at: number;
}> {
  return getApiClient().get(`/api/sync/download/${patientId}`);
}

// ============================================================================
// System & Misc
// ============================================================================

export async function getOrderSets(): Promise<{ success: boolean; order_sets: Record<string, unknown>[] }> {
  return getApiClient().get('/api/order-sets');
}

export async function getNoteTemplates(): Promise<{
  success: boolean;
  templates: Record<string, unknown>[];
  count: number;
}> {
  return getApiClient().get('/api/templates/notes');
}

export async function useNoteTemplate(
  data: unknown
): Promise<{ success: boolean; template_id: string; generated_note: string; timestamp: number }> {
  return getApiClient().post('/api/templates/notes/use', data);
}

export async function generateBarcode(
  data: unknown
): Promise<{ success: boolean; barcode: Record<string, unknown>; message: string }> {
  return getApiClient().post('/api/barcode/generate', data);
}

export async function scanBarcode(data: unknown): Promise<{
  success: boolean;
  barcode_value: string;
  entity_info: Record<string, unknown>;
  location: string | null;
  scanned_at: number;
}> {
  return getApiClient().post('/api/barcode/scan', data);
}

export async function trackBarcode(
  barcodeValue: string
): Promise<{ barcode_id: string; history: Record<string, unknown>[] }> {
  return getApiClient().get(`/api/barcode/${barcodeValue}/history`);
}

export async function updateMedicalIdPreferences(
  patientId: string,
  data: unknown
): Promise<{ success: boolean; preferences: Record<string, unknown>; message: string }> {
  return getApiClient().post(`/api/medical-id/${patientId}/preferences`, data);
}

export async function triggerEmergencyNotification(
  patientId: string,
  data: unknown
): Promise<{ success: boolean; patient_id: string; notifications_sent: number; notifications: Record<string, unknown>[]; message: string }> {
  return getApiClient().post(`/api/medical-id/${patientId}/emergency-notify`, data);
}

export async function getLockscreenMedicalId(patientId: string): Promise<LockscreenMedicalId> {
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
export async function getPatientDashboard(): Promise<PatientDashboardResponse> {
  return getApiClient().get('/api/dashboard/patient');
}

/**
 * Get doctor dashboard data
 */
export async function getDoctorDashboard(): Promise<DoctorDashboardResponse> {
  return getApiClient().get('/api/dashboard/doctor');
}

/**
 * Get nurse dashboard data
 */
export async function getNurseDashboard(): Promise<NurseDashboardResponse> {
  return getApiClient().get('/api/dashboard/nurse');
}

/**
 * Get lab tech dashboard data
 */
export async function getLabDashboard(): Promise<LabDashboardResponse> {
  return getApiClient().get('/api/dashboard/lab');
}

/**
 * Get admin dashboard data
 */
export async function getAdminDashboard(): Promise<AdminDashboardResponse> {
  return getApiClient().get('/api/dashboard/admin');
}

/**
 * Get pharmacist dashboard data
 */
export async function getPharmacistDashboard(): Promise<PharmacistDashboardResponse> {
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
export async function getMedicalId(patientId: string): Promise<MedicalIdCard> {
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
export async function getEmergencyMedicalId(patientId: string): Promise<EmergencyMedicalId> {
  return getApiClient().get(`/api/medical-id/${patientId}/emergency`);
}

// ============================================================================
// Insurance
// ============================================================================

/**
 * Verify patient insurance
 */
export async function verifyInsurance(patientId: string): Promise<VerifyInsuranceResponse> {
  return getApiClient().post('/api/insurance/verify', { patient_id: patientId });
}

/**
 * Check eligibility for a service.
 * NOTE: the backend previously had two handlers duplicate-registered on this
 * route (a crude one that only read `patient_id`/`service_code`, and this
 * richer one) — the crude registration has been removed so the real
 * `EligibilityCheckRequest` shape (payer/member/subscriber/service fields) is
 * what actually runs; the signature here was widened to match. No caller used
 * the old 2-arg form yet.
 */
export async function checkEligibility(request: {
  patient_id: string;
  payer_id: string;
  member_id: string;
  subscriber_dob: string;
  service_type: string;
  service_date: string;
}): Promise<CheckEligibilityResponse> {
  return getApiClient().post('/api/insurance/eligibility', request);
}

// ============================================================================
// HL7 FHIR R4 API
//
// FHIR resource/Bundle shapes follow the HL7 FHIR R4 standard (external spec,
// not a MediChain-defined struct) — typed structurally rather than mirroring
// the full FHIR resource model.
// ============================================================================

/**
 * Get FHIR Patient resource
 */
export async function fhirGetPatient(patientId: string): Promise<Record<string, unknown>> {
  return getApiClient().get(`/api/fhir/r4/Patient/${patientId}`);
}

/**
 * Get FHIR AllergyIntolerance resources
 */
export async function fhirGetAllergies(patientId: string): Promise<Record<string, unknown>> {
  return getApiClient().get(`/api/fhir/r4/AllergyIntolerance?patient=${patientId}`);
}

/**
 * Get FHIR Condition resources
 */
export async function fhirGetConditions(patientId: string): Promise<Record<string, unknown>> {
  return getApiClient().get(`/api/fhir/r4/Condition?patient=${patientId}`);
}

/**
 * Get FHIR Observation resources (vital signs)
 */
export async function fhirGetObservations(patientId: string): Promise<Record<string, unknown>> {
  return getApiClient().get(`/api/fhir/r4/Observation?patient=${patientId}`);
}

/**
 * Get FHIR server capability statement
 */
export async function fhirCapabilityStatement(): Promise<Record<string, unknown>> {
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

export async function createSampleHistory(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/clinical/sample', data);
}

export async function getSampleHistory(
  patientId: string
): Promise<{ success: boolean; history: SampleHistoryRecord }> {
  return getApiClient().get(`/api/clinical/sample/${patientId}`);
}

export async function createGCS(data: unknown): Promise<{
  success: boolean;
  assessment_id: string;
  total_score: number;
  interpretation: string;
  is_comatose: boolean;
  needs_airway: boolean;
  message: string;
}> {
  return getApiClient().post('/api/clinical/gcs', data);
}

export async function getGCS(assessmentId: string): Promise<GcsAssessmentRecord> {
  return getApiClient().get(`/api/clinical/gcs/${assessmentId}`);
}

export async function getPatientGCS(
  patientId: string
): Promise<{ patient_id: string; assessments: GcsAssessmentRecord[]; total: number }> {
  return getApiClient().get(`/api/clinical/patient/${patientId}/gcs`);
}

// ============================================================================
// Missing FHIR Endpoints (Task 1)
// ============================================================================

export async function fhirGetMedications(patientId: string): Promise<Record<string, unknown>> {
  return getApiClient().get(`/api/fhir/r4/MedicationStatement?patient=${patientId}`);
}

export async function fhirGetEncounters(patientId: string): Promise<Record<string, unknown>> {
  return getApiClient().get(`/api/fhir/r4/Encounter?patient=${patientId}`);
}

export async function fhirGetDiagnosticReports(patientId: string): Promise<Record<string, unknown>> {
  return getApiClient().get(`/api/fhir/r4/DiagnosticReport?patient=${patientId}`);
}

export async function fhirGetProcedures(patientId: string): Promise<Record<string, unknown>> {
  return getApiClient().get(`/api/fhir/r4/Procedure?patient=${patientId}`);
}

export async function fhirGetImmunizations(patientId: string): Promise<Record<string, unknown>> {
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

/** Wrap a bare-array admin-list response in the `{success, total, items}` shape. */
function wrapListResponse<T>(items: T[]): ListResponse<T> {
  return { success: true, total: items.length, items };
}

/**
 * List all chain of custody records
 */
export async function listChainOfCustody(): Promise<ListResponse<unknown>> {
  const items = await getApiClient().get<unknown[]>('/api/platform/list/chain-of-custody');
  return wrapListResponse(items || []);
}

/**
 * List all lab QC records
 */
export async function listLabQc(): Promise<ListResponse<unknown>> {
  const items = await getApiClient().get<unknown[]>('/api/platform/list/lab-qc');
  return wrapListResponse(items || []);
}

/**
 * List all critical value notifications
 */
export async function listCriticalValues(): Promise<ListResponse<unknown>> {
  const items = await getApiClient().get<unknown[]>('/api/platform/list/critical-values');
  return wrapListResponse(items || []);
}

/**
 * List all radiology orders and reports.
 *
 * Both halves are real reads. `reports` used to be hardcoded empty because the
 * backend had no reports registry; it now has one, so a finalized report is
 * reachable from a list view rather than only through the order that produced
 * it.
 */
export async function listRadiology(): Promise<{
  success: boolean;
  orders: { total: number; items: unknown[] };
  reports: { total: number; items: unknown[] };
}> {
  const [orders, reports] = await Promise.all([
    getApiClient().get<unknown[]>('/api/platform/list/radiology-orders'),
    getApiClient().get<unknown[]>('/api/platform/list/radiology-reports'),
  ]);
  return {
    success: true,
    orders: { total: (orders || []).length, items: orders || [] },
    reports: { total: (reports || []).length, items: reports || [] },
  };
}

/**
 * List all pathology reports
 */
export async function listPathology(): Promise<ListResponse<unknown>> {
  const items = await getApiClient().get<unknown[]>('/api/platform/list/pathology');
  return wrapListResponse(items || []);
}

/**
 * List all immunization records and schedules.
 * NOTE: the backend only has an admin list for records, not schedules — `schedules`
 * is always empty until a `/api/platform/list/immunization-schedules` endpoint exists.
 */
export async function listImmunizations(): Promise<{
  success: boolean;
  records: { total: number; items: unknown[] };
  schedules: { total: number; items: unknown[] };
}> {
  const records = (await getApiClient().get<unknown[]>('/api/platform/list/immunizations')) || [];
  return {
    success: true,
    records: { total: records.length, items: records },
    schedules: { total: 0, items: [] },
  };
}

/**
 * List all blood bank records.
 * NOTE: the backend only tracks type/screen records today (returned as
 * `type_screens`) — `crossmatches`/`transfusions` are always empty until their
 * repositories gain a `list_all()` admin view.
 */
export async function listBloodBank(): Promise<{
  success: boolean;
  type_screens: { total: number; items: unknown[] };
  crossmatches: { total: number; items: unknown[] };
  transfusions: { total: number; items: unknown[] };
}> {
  const response = await getApiClient().get<{ screens: unknown[] }>('/api/platform/list/blood-bank');
  const screens = response?.screens || [];
  return {
    success: true,
    type_screens: { total: screens.length, items: screens },
    crossmatches: { total: 0, items: [] },
    transfusions: { total: 0, items: [] },
  };
}

/**
 * List all autopsy records (requests + reports)
 */
export async function listAutopsy(): Promise<{
  success: boolean;
  requests: { total: number; items: unknown[] };
  reports: { total: number; items: unknown[] };
}> {
  const [requests, reports] = await Promise.all([
    getApiClient().get<unknown[]>('/api/platform/list/autopsy'),
    getApiClient().get<unknown[]>('/api/platform/list/autopsy-reports'),
  ]);
  return {
    success: true,
    requests: { total: (requests || []).length, items: requests || [] },
    reports: { total: (reports || []).length, items: reports || [] },
  };
}

/**
 * List all consultation notes
 */
export async function listConsults(): Promise<ListResponse<unknown>> {
  const items = await getApiClient().get<unknown[]>('/api/platform/list/consults');
  return wrapListResponse(items || []);
}

/**
 * List all CDS alerts
 */
export async function listCdsAlerts(): Promise<ListResponse<unknown>> {
  const items = await getApiClient().get<unknown[]>('/api/platform/list/cds-alerts');
  return wrapListResponse(items || []);
}
