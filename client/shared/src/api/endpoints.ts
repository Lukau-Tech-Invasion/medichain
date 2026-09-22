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
  CreateCardiacRequest,
  CardiacCreateResult,
  CreateFallRiskRequest,
  FallRiskCreateResult,
  CreateBurnRequest,
  BurnCreateResult,
  CreateMciRequest,
  MciCreateResult,
  IvSiteCreateResult,
  PreOpCreateResult,
  AssessFamilyHistoryRequest,
  AssessFamilyHistoryResult,
  SepsisCreateResult,
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

export interface PatientListOptions {
  /** Server-side whole-token name or identifier search. */
  query?: string;
  /** Bounded roster page size; the API clamps this to its own maximum. */
  limit?: number;
  /** Opaque continuation cursor returned by the preceding page. */
  cursor?: string;
}

export async function getPatients(options: PatientListOptions = {}): Promise<PatientProfile[]> {
  const params = new URLSearchParams();
  if (options.query?.trim()) params.set('q', options.query.trim());
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  const suffix = params.size ? `?${params.toString()}` : '';
  const response = await getApiClient().get<{ data: PatientProfile[]; pagination: unknown }>(`/api/patients${suffix}`);
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

/**
 * Change the password behind an employee identifier.
 *
 * A rotation, not a reset. The caller derives both values from the old
 * password locally, opens its own keystore, re-encrypts the keypair under the
 * new password, and sends proof it knew the old one. The server never sees
 * either password and never holds the key — which is the same property that
 * makes a forgotten password unrecoverable here, by design.
 *
 * `rotateStaffPassword` in `auth/credentials.ts` does the derivation; call
 * that rather than assembling this body by hand.
 */
export async function rotateCredentials(body: {
  loginId: string;
  currentAuthProof: string;
  newAuthProof: string;
  newEncryptedKeystore: string;
}): Promise<{ success: boolean; message: string }> {
  return getApiClient().post('/api/auth/staff/rotate-credentials', body);
}

/** Set the signed-in clinician's profile picture, or clear it with `null`. */
export async function setMyAvatar(
  avatar: string | null
): Promise<{ success: boolean; updatedAt?: string }> {
  return getApiClient().post('/api/users/me/avatar', { avatar });
}

/** One clinician's profile picture, or `null` when they have not set one. */
export async function getUserAvatar(
  walletAddress: string
): Promise<{ success: boolean; avatar: string | null }> {
  return getApiClient().get(`/api/users/${encodeURIComponent(walletAddress)}/avatar`);
}

// ============================================================================
// Death certificate drafts
// ============================================================================

/** The fields a certificate carries while it is still being written. */
export interface DeathCertificateDraft {
  patient_id: string;
  deceased_name?: string | null;
  date_of_birth?: string | null;
  date_of_death?: string | null;
  time_of_death?: string | null;
  place_of_death?: string | null;
  manner_of_death?: string | null;
  cause_of_death?: string | null;
  other_conditions?: string[];
  certifier_name?: string | null;
  certifier_license?: string | null;
  certifier_type?: string | null;
}

/**
 * Start a certificate without filing it.
 *
 * `createDeathCertificate` requires deceased name, date, place, cause and
 * certifier, because a filed certificate missing any of them is void. A draft
 * requires only the patient it concerns.
 */
export async function draftDeathCertificate(
  draft: DeathCertificateDraft
): Promise<{ success: boolean; id: string; status: string }> {
  return getApiClient().post('/api/surgical/death-certificate/draft', draft);
}

/** Revise a draft. Refused once the certificate has been filed. */
export async function updateDeathCertificateDraft(
  id: string,
  draft: DeathCertificateDraft
): Promise<{ success: boolean; id: string; status: string }> {
  return getApiClient().put(
    `/api/surgical/death-certificate/${encodeURIComponent(id)}`,
    draft
  );
}

/**
 * File a draft as a certificate.
 *
 * This is where the legal-instrument checks run, so an incomplete draft is
 * refused here rather than stored as a void certificate.
 */
export async function fileDeathCertificate(
  id: string
): Promise<{ success: boolean; id: string; status: string }> {
  return getApiClient().post(
    `/api/surgical/death-certificate/${encodeURIComponent(id)}/file`,
    {}
  );
}

// ============================================================================
// Pharmacy safety decisions
// ============================================================================

/**
 * Record what a pharmacist did about an allergy alert.
 *
 * `refused_to_dispense` or `prescriber_queried`. Both need a reason: a refusal
 * nobody can account for is not a clinical decision, and the prescriber and
 * the patient both have to be able to find out why a medicine did not arrive.
 */
export async function recordPharmacyDecision(body: {
  patientId: string;
  allergen: string;
  decision: 'refused_to_dispense' | 'prescriber_queried';
  reason: string;
  prescriptionId?: string | null;
  prescriberId?: string | null;
}): Promise<{ success: boolean; id: string; decision: string }> {
  return getApiClient().post('/api/pharmacy/allergy-decisions', body);
}

/** Every dispensing decision recorded for one patient. */
export async function listPharmacyDecisions(
  patientId: string
): Promise<{ success: boolean; decisions: Array<Record<string, unknown>> }> {
  return getApiClient().get(
    `/api/pharmacy/allergy-decisions/patient/${encodeURIComponent(patientId)}`
  );
}

/**
 * The controlled-substance dispensing register for a period.
 *
 * Bounds are ISO dates and both are optional; an absent bound means no bound
 * on that side, rather than a silent default period that would be wrong for
 * anyone asking about a different one.
 */
export async function controlledSubstanceReport(range: {
  from?: string;
  to?: string;
} = {}): Promise<{
  success: boolean;
  count: number;
  produced_at: string;
  events: Array<Record<string, unknown>>;
}> {
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const query = params.toString();
  return getApiClient().get(
    `/api/pharmacy/controlled-substances/report${query ? `?${query}` : ''}`
  );
}

// ============================================================================
// AMA signatures
// ============================================================================

/**
 * Record the signatures on an against-medical-advice discharge.
 *
 * Either a patient signature or a stated reason they would not sign — never
 * neither, because a request carrying no signature and no reason would mark
 * the form handled while leaving the record exactly as unevidenced as before.
 * Signatures are taken once; a second attempt is refused.
 */
export async function collectAmaSignatures(
  amaId: string,
  body: {
    patientSignature?: string | null;
    refusedReason?: string | null;
    witnessName?: string | null;
    witnessSignature?: string | null;
  }
): Promise<{ success: boolean; id: string; signed: boolean }> {
  return getApiClient().post(
    `/api/clinical/ama/${encodeURIComponent(amaId)}/signatures`,
    body
  );
}

// ============================================================================
// Barcode scanner preferences
// ============================================================================

export interface ScannerSettings {
  autoScan: boolean;
  vibrate: boolean;
  sound: boolean;
  continuous: boolean;
  /** Governs whether a scan is written to this clinician's durable history. */
  saveHistory: boolean;
}

export async function getScannerSettings(): Promise<{
  success: boolean;
  settings: ScannerSettings;
  historyClearedAt: string | null;
}> {
  return getApiClient().get('/api/barcode/settings');
}

export async function updateScannerSettings(
  settings: ScannerSettings
): Promise<{ success: boolean; settings: ScannerSettings }> {
  return getApiClient().put('/api/barcode/settings', settings);
}

/**
 * Clear this clinician's scan history view.
 *
 * Deletes nothing: a barcode scan is the record of somebody handling a
 * specimen, and ADR-0005 defers irreversible deletion. The list starts again
 * from now and the scans remain for anyone asking who handled what.
 */
export async function clearScanHistory(): Promise<{
  success: boolean;
  historyClearedAt: string;
  message: string;
}> {
  return getApiClient().post('/api/barcode/history/clear', {});
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
// Managed devices and the federation boundary
// ============================================================================

/** An organisation this deployment federates with, and its facilities. */
export interface OrganizationSummary {
  id: string;
  name: string;
  organization_type: string;
  status: string;
  facilities: Array<{
    id: string;
    organization_id: string;
    name: string;
    facility_type: string;
    status: string;
  }>;
}

/**
 * The organisations an administrator may enrol a device against.
 *
 * Organisations were writable only by migration and readable only by foreign
 * key, so a device-enrolment form had to ask for an identifier nobody could
 * look up. `backend` says whether the answer came from the database or from
 * the legacy boundary the memory backend actually assigns.
 */
export async function listOrganizations(): Promise<{
  success: boolean;
  backend: string;
  organizations: OrganizationSummary[];
}> {
  return getApiClient().get('/api/organizations');
}

/** An approved hospital device, as the lifecycle store holds it. */
export interface ManagedDevice {
  id: string;
  organization_id: string;
  facility_id?: string | null;
  device_name: string;
  device_type: string;
  hardware_fingerprint: string;
  platform?: string | null;
  status: string;
  current_key_id?: string | null;
  last_seen_at?: string | null;
  last_rotation_at?: string | null;
  next_rotation_at: string;
  revoked_at?: string | null;
  revocation_reason?: string | null;
}

/**
 * Every enrolled device.
 *
 * The only device read used to be `/api/devices/compliance`, which returns
 * only *non-compliant* devices -- so a healthy fleet was indistinguishable
 * from no fleet, and the id needed to issue an emergency grant existed only in
 * the HTTP response of the enrolment call that created it.
 */
export async function listManagedDevices(): Promise<{
  success: boolean;
  count: number;
  devices: ManagedDevice[];
}> {
  return getApiClient().get('/api/devices');
}

/** Enrol an approved device. It cannot reach clinical data until it is rotated. */
export async function enrollManagedDevice(payload: {
  organization_id: string;
  facility_id?: string | null;
  device_name: string;
  device_type: string;
  hardware_fingerprint: string;
  platform?: string | null;
}): Promise<ManagedDevice> {
  return getApiClient().post('/api/devices/enroll', payload);
}

/**
 * Record a newly provisioned device credential and reset the rotation clock.
 * This is what moves a device from `enrolled` to `active`; an enrolled device
 * that has never rotated cannot open a record.
 */
export async function rotateManagedDevice(
  deviceId: string,
  keyId: string
): Promise<ManagedDevice> {
  return getApiClient().post(`/api/devices/${deviceId}/rotate`, { key_id: keyId });
}

/** Permanently stop a device from using its cached or future credentials. */
export async function revokeManagedDevice(
  deviceId: string,
  reason: string
): Promise<ManagedDevice> {
  return getApiClient().post(`/api/devices/${deviceId}/revoke`, { reason });
}

/** The narrow view of a device a clinician is allowed to choose between. */
export interface UsableDevice {
  id: string;
  device_name: string;
  device_type: string;
  facility_id?: string | null;
}

/**
 * The devices this clinician may bind emergency access to, right now.
 *
 * Separate from `listManagedDevices` on purpose: that one carries hardware
 * fingerprints and key ids, which is administrative data no clinician should
 * hold. This carries only what makes the choice possible, and only for devices
 * that pass the same access check the grant will apply -- a device offered here
 * and refused at issuance would be worse than no list at all.
 */
export async function listUsableDevices(): Promise<{
  success: boolean;
  count: number;
  devices: UsableDevice[];
}> {
  return getApiClient().get('/api/devices/available');
}

/** Devices needing administrative remediation before they regain access. */
export async function getDeviceCompliance(): Promise<ManagedDevice[]> {
  return getApiClient().get('/api/devices/compliance');
}

/** A break-glass emergency access grant, as the server stores it. */
export interface EmergencyAccessGrant {
  id: string;
  patient_id: string;
  requesting_person_id: string;
  organization_id: string;
  facility_id?: string | null;
  device_id: string;
  reason_code: string;
  reason_text?: string | null;
  scopes: string[];
  issued_at: string;
  expires_at: string;
  revoked_at?: string | null;
  revoked_reason?: string | null;
  status: string;
}

/**
 * Every emergency grant issued recently. Administrators only.
 *
 * A grant could previously be read only by its own id, which nobody holds
 * unless they issued it — so break-glass access could not be reviewed, and the
 * revoke endpoint was unreachable because finding a grant meant already knowing
 * its id. Revoked and expired grants are included: during an incident review
 * "who has access" and "who had it" are the same question.
 */
export async function listEmergencyGrants(): Promise<{
  success: boolean;
  grants: EmergencyAccessGrant[];
  count: number;
}> {
  return getApiClient().get('/api/emergency/grants');
}

/** Cut short a break-glass grant before it expires. */
export async function revokeEmergencyGrant(
  grantId: string,
  reason?: string
): Promise<{ success: boolean; message?: string }> {
  return getApiClient().post(`/api/emergency/grants/${grantId}/revoke`, {
    reason: reason || null,
  });
}

// ============================================================================
// Patient-controlled record access
// ============================================================================

// camelCase because the server's `AccessGrantEntity` / `AccessRequestEntity`
// carry `#[serde(rename_all = "camelCase")]`. A snake_case description of them
// type-checks and reads `undefined` for every field.

export interface PatientAccessGrant {
  id: string;
  providerId: string;
  providerName: string;
  providerRole: string;
  organization: string;
  accessType: 'full' | 'limited' | 'emergency';
  grantedAt: string;
  expiresAt: string | null;
  status: 'active' | 'expired' | 'revoked';
  lastAccessed: string | null;
  accessCount: number;
  sourceRequestId?: string | null;
}

export interface PatientAccessRequest {
  id: string;
  providerId: string;
  providerName: string;
  providerRole: string;
  organization: string;
  requestedAt: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
}

export async function listPatientAccessGrants(patientId: string): Promise<{ grants: PatientAccessGrant[] }> {
  return getApiClient().get(`/api/access/patient/${encodeURIComponent(patientId)}/grants`);
}

export async function listPatientAccessRequests(patientId: string): Promise<{ requests: PatientAccessRequest[] }> {
  return getApiClient().get(`/api/access/patient/${encodeURIComponent(patientId)}/requests`);
}

/** Approve a provider request for a user-selected, server-bounded time window. */
export async function approvePatientAccessRequest(
  requestId: string,
  expiresAt: string
): Promise<{ request: PatientAccessRequest; grant: PatientAccessGrant }> {
  return getApiClient().post(`/api/access/requests/${encodeURIComponent(requestId)}/approve`, {
    expires_at: expiresAt,
  });
}

export async function denyPatientAccessRequest(requestId: string): Promise<{ request: PatientAccessRequest }> {
  return getApiClient().post(`/api/access/requests/${encodeURIComponent(requestId)}/deny`, {});
}

export async function revokePatientAccessGrant(grantId: string): Promise<{ grant: PatientAccessGrant }> {
  return getApiClient().post(`/api/access/grants/${encodeURIComponent(grantId)}/revoke`, {});
}

// ============================================================================
// Guardianship — who may act for a patient
// ============================================================================

/** A recorded guardian relationship, as the server stores it. */
export interface GuardianRelationship {
  id: string;
  guardian_wallet: string;
  ward_patient_id: string;
  relationship_type: string;
  permissions: string[];
  verified_by: string;
  verified_at: string;
  active: boolean;
  expires_at?: string | null;
  revoked_at?: string | null;
  revoked_reason?: string | null;
  authority_evidence_type?: string | null;
  authority_evidence_reference?: string | null;
}

/**
 * Who may act for this patient.
 *
 * Returns relationships whether active or not: a revoked or expired
 * guardianship is part of the answer, and omitting it would hide that someone
 * once could act for this person.
 */
export async function getGuardiansForWard(
  wardPatientId: string
): Promise<{ success: boolean; relationships: GuardianRelationship[]; count: number }> {
  return getApiClient().get(`/api/guardians/ward/${wardPatientId}`);
}

/** The wards the signed-in caller may act for. Caller-scoped: it takes no id. */
export async function getMyWards(): Promise<{
  success: boolean;
  relationships: GuardianRelationship[];
  count: number;
}> {
  return getApiClient().get('/api/guardians/mine');
}

/**
 * Record a verified guardian relationship.
 *
 * Privileged: `require_privileged_assurance` gates this, so outside demo mode
 * the caller must be MFA-enrolled and stepped up.
 */
export async function verifyGuardian(data: {
  guardian_wallet: string;
  ward_patient_id: string;
  relationship_type: string;
  permissions: string[];
  expires_at?: string | null;
  authority_evidence_type?: string | null;
  authority_evidence_reference?: string | null;
  authority_issuing_authority?: string | null;
  authority_verified_by_role?: string | null;
}): Promise<{ success: boolean; relationship_id?: string; message?: string }> {
  return getApiClient().post('/api/guardians/verify', data);
}

/** Amend what an existing guardian may do. */
export async function updateGuardianPermissions(
  relationshipId: string,
  permissions: string[]
): Promise<{ success: boolean; message?: string }> {
  return getApiClient().put(`/api/guardians/${relationshipId}/permissions`, { permissions });
}

/** End a guardian relationship. */
export async function revokeGuardian(
  relationshipId: string,
  reason?: string
): Promise<{ success: boolean; message?: string }> {
  return getApiClient().post('/api/guardians/revoke', {
    relationship_id: relationshipId,
    reason: reason || null,
  });
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

/**
 * The CDS audit trail (Admin only); optionally filtered by patient.
 *
 * The handler pages with a cursor and returns `next_cursor`; this used to
 * discard both, so a caller could only ever see the first page and had no way
 * to tell whether there was more.
 */
export async function getCdsAudit(
  patientId?: string,
  options?: { cursor?: string; limit?: number }
): Promise<{ count: number; entries: unknown[]; next_cursor?: string | null }> {
  const params = new URLSearchParams();
  if (patientId) params.set('patient_id', patientId);
  if (options?.cursor) params.set('cursor', options.cursor);
  if (options?.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  return getApiClient().get(`/api/admin/cds/audit${query ? `?${query}` : ''}`);
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
  side: 'front' | 'back',
  imageBase64: string,
  contentType?: string
): Promise<{
  success: boolean;
  image_ipfs_hash: string;
  metadata_ipfs_hash: string;
  side: 'front' | 'back';
}> {
  return getApiClient().post(`/api/insurance/cards/${id}/image`, {
    side,
    image_base64: imageBase64,
    content_type: contentType,
  });
}

/** Read one authorised, encrypted insurance-card image. */
export async function downloadInsuranceCardImage(
  id: string,
  side: 'front' | 'back'
): Promise<{ success: boolean; content_base64: string; content_type: string }> {
  return getApiClient().get(`/api/insurance/cards/${encodeURIComponent(id)}/image/${side}`);
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
  // `getMutationHeaders`, not `getSessionHeaders`: this is a POST, and the
  // idempotency middleware refuses a keyed-subject mutation without a key.
  // `/api/pdf/document` is not on the middleware's allowlist — that list is
  // only the identity-establishing endpoints, which have no subject yet.
  const headers: Record<string, string> = {
    ...client.getMutationHeaders(),
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

/** Returns null when the selected patient has not yet been issued a card. */
export async function getCardInfo(patientId: string): Promise<NFCCardInfo | null> {
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
  LabResultSubmission,
} from '../types';

/** One test within a standard lab panel, as the server defines it. */
export interface LabTestTemplate {
  name: string;
  code?: string | null;
  unit: string;
  reference_range_male: string;
  reference_range_female: string;
  reference_range_pediatric?: string | null;
  critical_low?: number | null;
  critical_high?: number | null;
}

/** A standard lab panel template. */
export interface LabPanelTemplate {
  name: string;
  code: string;
  description: string;
  tests: LabTestTemplate[];
}

/**
 * The standard lab panels, from the server.
 *
 * `GET /api/clinical/lab-panels` has existed as long as the lab feature and had
 * no caller, so the units and reference ranges it defines were unavailable to
 * any screen. A result-entry form needs exactly this: rule 8 of the project
 * brief says a page never decides a clinical threshold, it asks for one.
 */
export async function getLabPanels(): Promise<{
  total: number;
  panels: LabPanelTemplate[];
}> {
  return getApiClient().get('/api/clinical/lab-panels');
}

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
 *
 * Returns a bare array, NOT the `{ submissions, total }` envelope the server
 * sends. `ApiClient.get` unwraps any object whose `submissions` key holds an
 * array (see `client.ts`), so a caller reading `data.submissions` gets
 * `undefined` and renders an empty queue. The old signature said
 * `PendingLabResultsResponse` and TypeScript could not catch the difference,
 * because the unwrap is a runtime cast.
 */
export async function getPendingLabResults(): Promise<LabResultSubmission[]> {
  return getApiClient().get('/api/lab/pending');
}

/**
 * Get all lab submissions with optional status filter (Doctor, Nurse, Admin)
 */
export async function getAllLabSubmissions(
  status?: 'pending' | 'approved' | 'rejected'
): Promise<LabResultSubmission[]> {
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
 * Tell the ordering provider that their specimen was rejected.
 *
 * Refused with 409 ALREADY_NOTIFIED if they have already been told — a
 * provider receiving the same rejection twice has to work out whether it is
 * one specimen or two — and 422 NO_ORDERING_PROVIDER when the specimen has no
 * order on record, which is the one case where there is genuinely nobody to
 * tell.
 */
export async function notifyRejectionOrderingProvider(
  rejectionId: string
): Promise<{
  success: boolean;
  rejection_id: string;
  ordering_provider_id: string;
  notified_at: string | null;
}> {
  return getApiClient().post(
    `/api/clinical/specimen-rejection/${rejectionId}/notify`,
    {}
  );
}

/** The result of a dispensing step (SCR-013). */
export interface DispenseResult {
  success: boolean;
  prescription_id: string;
  dispense_event_id?: string;
  status: string;
  dispensed_now?: number;
  dispensed_total: number;
  prescribed_quantity?: number;
  remaining?: number;
}

/**
 * A pharmacy acknowledges a transmitted prescription.
 *
 * Refused 409 if it is not Transmitted -- including when a colleague has
 * already received it, which is the common case rather than an error.
 */
export async function receivePrescription(prescriptionId: string): Promise<DispenseResult> {
  return getApiClient().post(`/api/e-prescriptions/${prescriptionId}/receive`, {});
}

/** A pharmacist begins preparing the medicine. Received -> InProgress. */
export async function startPrescriptionFill(prescriptionId: string): Promise<DispenseResult> {
  return getApiClient().post(`/api/e-prescriptions/${prescriptionId}/start`, {});
}

/**
 * Hand over medicine, in whole or in part.
 *
 * Refused 400 QUANTITY_EXCEEDS_REMAINING for more than the prescription still
 * owes, and 409 DISPENSE_RACE_DETECTED when another fill was recorded while
 * this one was being prepared -- re-read the prescription and dispense the
 * remainder rather than retrying blindly.
 */
export async function dispensePrescription(
  prescriptionId: string,
  quantity: number,
  notes?: string
): Promise<DispenseResult> {
  return getApiClient().post(`/api/e-prescriptions/${prescriptionId}/dispense`, {
    quantity,
    notes,
  });
}

/** Start the server-governed distinct-pharmacist verification workflow. */
export async function requestPrescriptionVerification(prescriptionId: string): Promise<void> {
  await getApiClient().post(`/api/e-prescriptions/${prescriptionId}/verification/request`, {});
}

/** Approve or reject a pending verification as the distinct second pharmacist. */
export async function decidePrescriptionVerification(
  prescriptionId: string,
  approve: boolean,
  reason?: string
): Promise<void> {
  await getApiClient().post(`/api/e-prescriptions/${prescriptionId}/verification/decide`, {
    approve,
    reason,
  });
}

/**
 * Correct a dispense that should not have been recorded.
 *
 * The original event is kept and marked; a correction entry is added. Requires
 * a reason and is audited.
 */
export async function reverseDispense(
  prescriptionId: string,
  dispenseEventId: string,
  reason: string
): Promise<DispenseResult> {
  return getApiClient().post(`/api/e-prescriptions/${prescriptionId}/dispense/reverse`, {
    dispense_event_id: dispenseEventId,
    reason,
  });
}

/** The dispensing history, corrections included. Never pruned. */
export async function getDispenseEvents(
  prescriptionId: string
): Promise<{ dispense_events: Record<string, unknown>[] }> {
  return getApiClient().get(`/api/e-prescriptions/${prescriptionId}/dispense-events`);
}

/** A request for another sample after a specimen was rejected (SCR-009b). */
export interface SpecimenRecollectionRequest {
  id: string;
  rejection_id: string;
  original_specimen_id: string;
  patient_id: string;
  ordering_provider_id: string | null;
  requested_by: string;
  reason: string;
  /** `requested` -> `collected` | `cancelled`. Terminal states are terminal. */
  status: 'requested' | 'collected' | 'cancelled';
  requested_at: string;
  /** The specimen that replaced the rejected one. Null until completion. */
  replacement_specimen_id: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

/**
 * Ask for another sample after a rejection.
 *
 * Distinct from `notifyRejectionOrderingProvider`: telling the ordering
 * provider their specimen failed and asking the patient to attend again are
 * different acts aimed at different people. Both may be needed; neither implies
 * the other.
 *
 * Refused with 409 RECOLLECTION_ALREADY_OPEN when one is already open for this
 * rejection. Two technicians looking at the same rejected specimen will both
 * press this, and the patient must not be called in twice for one failure.
 */
export async function requestSpecimenRecollection(
  rejectionId: string,
  reason: string
): Promise<{ success: boolean; recollection: SpecimenRecollectionRequest }> {
  return getApiClient().post(
    `/api/clinical/specimen-rejection/${rejectionId}/recollect`,
    { reason }
  );
}

/**
 * Record the replacement specimen and close the request.
 *
 * The replacement is a different specimen, not an edit of the rejected one --
 * 400 REPLACEMENT_IS_ORIGINAL if they are the same. Refused with 409
 * RECOLLECTION_NOT_OPEN once completed or cancelled, so a retry cannot record a
 * second replacement over the first.
 */
export async function completeSpecimenRecollection(
  recollectionId: string,
  replacementSpecimenId: string
): Promise<{ success: boolean; recollection: SpecimenRecollectionRequest }> {
  return getApiClient().post(
    `/api/clinical/specimen-recollection/${recollectionId}/complete`,
    { replacement_specimen_id: replacementSpecimenId }
  );
}

/** Stop asking for another sample. Requires a reason, and is audited. */
export async function cancelSpecimenRecollection(
  recollectionId: string,
  reason: string
): Promise<{ success: boolean; recollection: SpecimenRecollectionRequest }> {
  return getApiClient().post(
    `/api/clinical/specimen-recollection/${recollectionId}/cancel`,
    { reason }
  );
}

/**
 * Every recollection ever raised for a rejection, newest first.
 *
 * Includes cancelled and completed attempts deliberately: the rejected specimen
 * stays visible and so does every attempt to replace it.
 */
export async function getRecollectionsForRejection(
  rejectionId: string
): Promise<{ recollections: SpecimenRecollectionRequest[] }> {
  return getApiClient().get(
    `/api/clinical/specimen-rejection/${rejectionId}/recollections`
  );
}

/** The laboratory's queue of samples still awaited. */
export async function getOpenSpecimenRecollections(): Promise<{
  recollections: SpecimenRecollectionRequest[];
}> {
  return getApiClient().get('/api/clinical/specimen-recollections/open');
}

/**
 * Get lab submissions for a specific patient
 * Healthcare providers see all, patients only see approved
 */
export async function getPatientLabSubmissions(
  patientId: string
): Promise<LabResultSubmission[]> {
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

export async function createCardiac(
  data: CreateCardiacRequest,
): Promise<CardiacCreateResult> {
  return getApiClient().post('/api/emergency/cardiac', data);
}

export async function getCardiac(eventId: string): Promise<CardiacEvent> {
  return getApiClient().get(`/api/emergency/cardiac/${eventId}`);
}

export async function createSepsis(data: unknown): Promise<SepsisCreateResult> {
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

/** Medication administrations stored in daily MAR records, newest first. */
export async function listMarAdministrations(patientId?: string): Promise<unknown[]> {
  const query = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : '';
  const response = await getApiClient().get<{ administrations?: unknown[] }>(`/api/emergency/mar/administrations${query}`);
  return response.administrations ?? [];
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

export async function createIvSite(data: unknown): Promise<IvSiteCreateResult> {
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

export async function createFallRisk(
  data: CreateFallRiskRequest,
): Promise<FallRiskCreateResult> {
  return getApiClient().post('/api/emergency/fall-risk', data);
}

/**
 * A patient's fall-risk assessments, most recent first.
 *
 * `FallRiskPage`'s History tab rendered an always-empty array: the repository
 * had the read and no route reached it, so the tab could not populate and was
 * indistinguishable from a patient never assessed.
 */
export async function listPatientFallRisk(patientId: string): Promise<FallRiskAssessment[]> {
  return getApiClient().get(`/api/emergency/fall-risk/patient/${patientId}`);
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

/**
 * Assess a family history for referral, one condition category at a time.
 *
 * Stateless: it stores nothing and the request carries no identifiers, only
 * relationships and ages. It exists so `clinical_scoring::family_history_assessment`
 * is the only implementation of this scale — the page used to band hereditary
 * risk by counting relatives and issue an automatic genetics referral from that
 * count.
 */
export async function assessFamilyHistory(
  data: AssessFamilyHistoryRequest,
): Promise<AssessFamilyHistoryResult> {
  return getApiClient().post('/api/clinical/family-history/assess', data);
}

export async function createBurn(data: CreateBurnRequest): Promise<BurnCreateResult> {
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

export async function createMci(data: CreateMciRequest): Promise<MciCreateResult> {
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
export async function listPedsForPatient(patientId: string): Promise<unknown[]> {
  // `ApiClient` unwraps a recognised `{items: [...]}` envelope, so this
  // resolves to the bare array. Reading `.items` off the result returned an
  // empty list for every child who HAD growth measurements, and was correct
  // only while the list was empty -- which is how it went unnoticed.
  const response = await getApiClient().get<unknown[] | { items?: unknown[] } | null>(
    `/api/clinical/peds/patient/${encodeURIComponent(patientId)}`,
  );
  if (Array.isArray(response)) return response;
  return response?.items ?? [];
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

/** What a custody hand-over records (`TransferCustodyRequest`). */
export interface CustodyTransferPayload {
  transferredTo: string;
  location: string;
  condition?: string;
  sealIntact: boolean;
  /** A witness's name. Nothing here captures a signature. */
  witness?: string;
  notes?: string;
}

/**
 * Record a specimen hand-over. The server takes "from" as whoever holds the
 * specimen now, and refuses (409) if the record changed while this was open.
 */
export async function transferChainOfCustody(
  formId: string,
  data: CustodyTransferPayload
): Promise<{ success: boolean; record: Record<string, unknown> }> {
  return getApiClient().post(
    `/api/clinical/chain-of-custody/${encodeURIComponent(formId)}/transfers`,
    data
  );
}

export async function getChainOfCustody(formId: string): Promise<ChainOfCustody> {
  return getApiClient().get(`/api/clinical/chain-of-custody/${formId}`);
}

export async function createLabQc(data: unknown): Promise<QcCreateResult> {
  return getApiClient().post('/api/clinical/lab-qc', data);
}

/** Persist a calibration run; the server assigns its ID, operator and time. */
export async function createLabCalibration(data: unknown): Promise<{ calibration: unknown }> {
  return getApiClient().post('/api/clinical/lab-calibrations', data);
}

export async function getLabQc(qcId: string): Promise<LabQCRecord> {
  return getApiClient().get(`/api/clinical/lab-qc/${qcId}`);
}

export async function createCriticalValue(data: unknown): Promise<NotificationCreateResult> {
  return getApiClient().post('/api/clinical/critical-value', data);
}

/** What the read-back form submits (`AcknowledgeCriticalValueRequest`). */
export interface CriticalValueAcknowledgment {
  notifiedProvider: string;
  notificationMethod: 'phone' | 'in-person' | 'secure-message' | 'page';
  readBackValue: string;
  acknowledgmentNotes?: string;
}

/**
 * Record that a clinician was told of a critical value and read it back.
 * The server judges the read-back and closes the notification exactly once.
 */
export async function acknowledgeCriticalValue(
  notificationId: string,
  data: CriticalValueAcknowledgment
): Promise<Record<string, unknown>> {
  return getApiClient().post(
    `/api/clinical/critical-value/${encodeURIComponent(notificationId)}/acknowledge`,
    data
  );
}

/** Withdraw a notification raised in error. It is kept, marked cancelled. */
export async function cancelCriticalValue(
  notificationId: string,
  reason: string
): Promise<Record<string, unknown>> {
  return getApiClient().post(
    `/api/clinical/critical-value/${encodeURIComponent(notificationId)}/cancel`,
    { reason }
  );
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

/** The compact clinical-order request accepted by the physician-order API. */
export interface CreatePhysicianOrderInput {
  patient_id: string;
  category: string;
  order_text: string;
  priority?: string;
  instructions?: string | null;
  frequency?: string | null;
  cosign_required?: boolean;
}

/** The list projection the orders endpoint actually returns. */
export interface PhysicianOrderListItem {
  order_id: string;
  patient_id: string;
  order_type: string;
  order_details: string;
  priority: string;
  status: string;
  notes: string | null;
  ordering_provider: string;
  ordered_at: string;
}

export async function createOrder(data: CreatePhysicianOrderInput): Promise<OrderCreateResult> {
  return getApiClient().post('/api/clinical/order', data);
}

export async function getOrder(orderId: string): Promise<PhysicianOrder> {
  return getApiClient().get(`/api/clinical/order/${orderId}`);
}

/**
 * The physician order list.
 *
 * Returns the bare array, which is what a caller actually receives: the API
 * answers `{"orders": [...]}` and `ApiClient` unwraps a recognised list
 * envelope before this function returns. Declaring the envelope here was a
 * fiction TypeScript could not catch, and the orders screen believed it --
 * reading `data.orders` (undefined) and `data.success` (undefined), so it
 * cleared the list it had just loaded and showed "Failed to connect to
 * server" on every visit while the endpoint answered 200.
 */
export async function listOrders(): Promise<PhysicianOrderListItem[]> {
  return getApiClient().get('/api/clinical/orders');
}

export async function updateOrderStatus(
  orderId: string,
  status: string
): Promise<{ success: boolean; order_id: string; status: string }> {
  return getApiClient().put(`/api/clinical/orders/${encodeURIComponent(orderId)}/status`, { status });
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

/** Persisted progress-note fields returned by the clinician registry. */
export interface ProgressNoteListItem {
  id: string;
  patient_id: string;
  note_type: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan_content: string | null;
  cosigned_by: string | null;
  cosigned_at: string | null;
  created_by: string;
  status: string;
  created_at: string;
  updated_at: string;
  /** Present on the in-memory backend; PostgreSQL returns the typed columns. */
  data?: Partial<ProgressNote>;
}

/** List the bounded, authorised clinician progress-note registry. */
export async function listProgressNotes(): Promise<ProgressNoteListItem[]> {
  return getApiClient().get('/api/platform/list/progress-notes');
}

export async function createProgressNote(data: ProgressNote): Promise<NoteCreateResult> {
  return getApiClient().post('/api/clinical/progress-note', data);
}

export async function getProgressNote(noteId: string): Promise<ProgressNote> {
  return getApiClient().get(`/api/clinical/progress-note/${noteId}`);
}

// ============================================================================
// Surgical Documentation (Phase 9)
// ============================================================================

export async function createPreOp(data: unknown): Promise<PreOpCreateResult> {
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

/** Persist changes to an unsigned H&P draft; signed records require an addendum. */
export async function updateHistoryPhysicalDraft(hpId: string, data: unknown): Promise<HpCreateResult> {
  return getApiClient().put(`/api/clinical/hp/${hpId}`, data);
}

/** Append an immutable amendment to a signed H&P. */
export async function addHistoryPhysicalAddendum(hpId: string, content: string): Promise<HpCreateResult> {
  return getApiClient().post(`/api/clinical/hp/${hpId}/addendum`, { content });
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

/**
 * One stored intake/output row.
 *
 * Distinct from `IntakeOutputRecord`, which is the shape a nurse submits —
 * `intake`/`output` arrays and a `totals` object. What comes back from the list
 * endpoint is the persisted row, already totalled. The return type here used to
 * name the submit shape, so every field the page reads was untyped.
 */
export interface IntakeOutputRow {
  id: string;
  patient_id: string;
  record_date: string;
  shift: string;
  total_intake: number;
  total_output: number;
  net_balance: number;
  entries?: Record<string, unknown>[];
  [key: string]: unknown;
}

export async function listIntakeOutput(): Promise<IntakeOutputRow[]> {
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

/** List durable radiology orders for clinical order-entry screens. */
export async function listRadiologyOrders(): Promise<ListResponse<unknown>> {
  const items = await getApiClient().get<unknown[]>('/api/platform/list/radiology-orders');
  return wrapListResponse(items || []);
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

/** Save the editable fields of an accessioned pathology report. */
export async function updatePathologyReport(reportId: string, data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().put(`/api/surgical/pathology/${reportId}`, data);
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

/** The authenticated patient's own immunization history. */
export async function getMyImmunizations(): Promise<ImmunizationRecord[]> {
  const response = await getApiClient().get<{ immunizations: ImmunizationRecord[] }>(
    '/api/clinical/immunizations'
  );
  return response.immunizations;
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

/** The authenticated patient's own family history. */
export async function getMyFamilyHistory(): Promise<FamilyMedicalHistory> {
  return getApiClient().get('/api/clinical/family-history');
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

/** Appointment list item returned by the patient-scope scheduling route. */
export interface PatientAppointmentListItem {
  appointment_id: string;
  /** Legacy instances used `type`; current API responses use `appointment_type`. */
  type?: string;
  appointment_type?: string;
  status: string;
  provider_name: string;
  specialty?: string;
  scheduled_date: string;
  start_time?: string;
  scheduled_time?: number | string | null;
  duration_minutes?: number;
  location?: string | { telehealth_link?: string | null };
  reason?: string;
  visit_reason?: string;
  notes?: string;
  is_telehealth?: boolean;
  telehealth_session_id?: string;
  awaiting_confirmation_from?: 'patient' | 'provider' | null;
}

/**
 * List appointments visible to a patient or their treating provider.
 *
 * Authentication is applied by the shared client; the API determines whether
 * the caller owns this patient's record or is a healthcare provider.
 */
export async function getPatientAppointments(
  patientId: string
): Promise<{ success: boolean; appointments: Appointment[]; count: number }> {
  return getApiClient().get(`/api/appointments/patient/${patientId}`);
}

/**
 * Patient-facing appointment summaries, including the derived confirmation
 * owner and optional telehealth link used by the patient portal.
 *
 * Kept distinct from `getPatientAppointments`: older clinical consumers need
 * the full persisted appointment record, while this route's presentation
 * contract deliberately permits a compact summary.
 */
export async function getPatientAppointmentSummaries(
  patientId: string
): Promise<{ success: boolean; appointments: PatientAppointmentListItem[]; count: number }> {
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

/** One weekday a provider works. `weekday` is ISO-8601: 1 = Monday … 7 = Sunday. */
export interface ProviderWorkingDay {
  weekday: number;
  /** `HH:MM`, facility wall-clock — the same clock an appointment carries. */
  start: string;
  end: string;
  /** An unavailable span inside the day. Both ends or neither; the API refuses one. */
  break_start?: string | null;
  break_end?: string | null;
}

/** A dated exception: leave, a conference, an operating list. */
export interface ProviderBlockedTime {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Absent start and end mean the whole day. */
  start?: string | null;
  end?: string | null;
  reason?: string | null;
}

export interface ProviderSchedule {
  provider_id: string;
  working_days: ProviderWorkingDay[];
  blocked: ProviderBlockedTime[];
  slot_minutes: number;
  updated_by?: string | null;
  updated_at?: number | null;
}

/**
 * Read a provider's published working hours.
 *
 * Answers 200 with `has_schedule: false` rather than 404 when none is set.
 * "This provider has not published hours" is a real answer and a booking screen
 * has to tell it apart from "no such provider": with no schedule the default
 * clinic grid still applies, so the provider is bookable, not unavailable.
 */
export async function getProviderSchedule(providerId: string): Promise<{
  success: boolean;
  has_schedule: boolean;
  schedule?: ProviderSchedule;
  provider_id?: string;
  message?: string;
}> {
  return getApiClient().get(`/api/providers/${providerId}/schedule`);
}

/**
 * Publish a provider's working hours.
 *
 * A provider may set their own; an administrator may set anyone's. A clinician
 * setting a colleague's is refused `403 FORBIDDEN` — a diary somebody else can
 * quietly rewrite is one nobody can rely on.
 */
export async function setProviderSchedule(
  providerId: string,
  data: {
    working_days: ProviderWorkingDay[];
    blocked: ProviderBlockedTime[];
    slot_minutes?: number;
  }
): Promise<{ success: boolean; provider_id: string; working_days: number; message: string }> {
  return getApiClient().put(`/api/providers/${providerId}/schedule`, data);
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

/** The frequencies `POST /api/reminders/medication` accepts. Anything else is refused. */
export type ReminderFrequency =
  | 'once'
  | 'daily'
  | 'twice_daily'
  | 'three_times_daily'
  | 'weekly'
  | 'as_needed';

export interface CreateMedicationReminderInput {
  patient_id: string;
  medication_name: string;
  dosage: string;
  frequency: ReminderFrequency | string;
  reminder_times: string[];
  start_date: string;
  end_date?: string;
  instructions?: string;
  /** The channels the scheduler will actually use. Omitted means push only. */
  push_notification?: boolean;
  sms?: boolean;
  email?: boolean;
}

/** One active medication reminder as returned by the medication-reminders API. */
export interface MedicationReminder {
  reminder_id: string;
  patient_id: string;
  medication_name: string;
  dosage: string;
  frequency: string;
  reminder_times: string[];
  start_date: string;
  end_date: string | null;
  instructions: string | null;
  active: boolean;
  created_at: number;
}

export async function createMedicationReminder(
  data: CreateMedicationReminderInput
): Promise<MedicationReminderCreateResult> {
  return getApiClient().post('/api/reminders/medication', data);
}

export async function getPatientReminders(
  patientId: string
): Promise<{ success: boolean; patient_id: string; reminders: MedicationReminder[]; count: number }> {
  return getApiClient().get(`/api/reminders/medication/${patientId}`);
}

/** What the patient did with the dose. Anything else is refused by the API. */
export type AdherenceAction = 'taken' | 'taken_late' | 'skipped' | 'snoozed' | 'missed';

export interface LogAdherenceInput {
  reminder_id: string;
  action: AdherenceAction;
  notes?: string;
}

/**
 * Record what happened to one scheduled dose.
 *
 * Typed because it was `unknown`, and `MedicationsPage` was sending
 * `{ patient_id, taken, taken_at }` — three fields the endpoint does not read
 * and none of the two it requires. Every call 400'd and the page swallowed it.
 */
export async function logMedicationAdherence(
  data: LogAdherenceInput
): Promise<AdherenceLogCreateResult> {
  // Queued when the device is offline. This is the case the offline story was
  // built for: a dose is taken at a time, and a patient with no signal must not
  // have to remember it until they next have one. The call still rejects with
  // `OfflineQueuedError`, so the page says "saved on this device, not yet sent"
  // rather than claiming the server has it.
  return getApiClient().post('/api/reminders/adherence', data, {
    queueWhenOffline: {
      category: 'medications',
      description: `Medication dose: ${data.action}`,
    },
  });
}

/** One logged dose, as `GET /api/reminders/adherence/{patient_id}` returns it. */
export interface AdherenceLog {
  id: string;
  patient_id: string;
  reminder_id: string | null;
  medication_name: string;
  action_taken: AdherenceAction | string;
  actual_time: string | null;
  reported_by: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * The doses a patient has logged.
 *
 * The write half of this has existed since adherence logging was built and had
 * no reader at all — the repository's four read methods had zero callers, so a
 * patient ticking off doses filled a table nothing could open.
 */
export async function getPatientAdherence(
  patientId: string
): Promise<{ success: boolean; patient_id: string; logs: AdherenceLog[]; count: number }> {
  return getApiClient().get(`/api/reminders/adherence/${patientId}`);
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

/**
 * What `POST /api/symptoms/analyze` actually answers.
 *
 * The previous declaration described a flat object with `triage_message`,
 * `recommendations`, `self_care_advice` and `when_to_seek_care`. The endpoint
 * sends none of those: everything is nested under `assessment`, and the fields
 * are `recommendation`, `specific_advice`, `next_steps` and `self_care`.
 *
 * TypeScript could not catch it because the API client's response is generic —
 * the declared type was simply a fiction, and `SymptomCheckerPage` read
 * `apiResult.triage_level` off the top level, got `undefined`, and fell to the
 * `default:` arm of its severity map. A patient reporting chest pain **with**
 * shortness of breath — which this endpoint correctly triages as `emergency`
 * and answers with "Call 911 or your local emergency number immediately" — was
 * shown **"mild"**.
 */
export interface SymptomAssessment {
  possible_conditions: Array<{
    condition_name: string;
    probability: number;
    severity: string;
    description: string;
    icd10_code?: string;
  }>;
  triage_level: 'self_care' | 'schedule_appointment' | 'urgent_care' | 'emergency' | 'low';
  /** The headline advice, e.g. "Seek emergency care immediately". */
  recommendation: string;
  red_flags: string[];
  specific_advice: string[];
  next_steps: string[];
  self_care: string[];
  context_notes: {
    age_considerations: string[];
    gender_considerations: string[];
    condition_interactions: string[];
    medication_notes: string[];
  };
}

export interface SymptomAnalysisResult extends SymptomAssessment {
  disclaimer: string;
}

/**
 * The assessment, flattened.
 *
 * Unwrapped here rather than at each call site so there is one place that knows
 * the envelope's shape. `disclaimer` sits outside `assessment` on the wire and
 * is folded back in, because every caller that shows the advice must also show
 * the disclaimer that qualifies it.
 */
export async function analyzeSymptoms(data: SymptomAnalysisRequest): Promise<SymptomAnalysisResult> {
  const response = await getApiClient().post<{
    assessment: SymptomAssessment;
    disclaimer: string;
  }>('/api/symptoms/analyze', data);
  return { ...response.assessment, disclaimer: response.disclaimer };
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

export interface CreateTelehealthSessionInput {
  patient_id: string;
  scheduled_start: number;
  session_type: string;
  /** Minutes. The join link's expiry is derived from it, so it is not cosmetic. */
  duration_minutes: number;
  appointment_id?: string;
  recording_enabled?: boolean;
}

export async function createTelehealthSession(
  data: CreateTelehealthSessionInput
): Promise<TelehealthSessionCreateResult> {
  return getApiClient().post('/api/telehealth/sessions', data);
}

/**
 * The signed-in caller's own telehealth sessions.
 *
 * A clinician's whole telehealth list, without having to name a patient first.
 * `TelehealthPage` showed nothing at all until a patient id was typed in, which
 * is the wrong shape for a screen whose job is "what am I seeing today".
 */
export async function listMyTelehealthSessions(): Promise<{
  success: boolean;
  sessions: TelehealthSession[];
  count: number;
  next_cursor?: string | null;
}> {
  return getApiClient().get('/api/telehealth/sessions');
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
): Promise<{
  success: boolean;
  patient_id: string;
  alerts: PatientCdsAlert[];
  count: number;
}> {
  return getApiClient().get(`/api/cds/patient/${patientId}/alerts`);
}

/** Patient-safe CDS alert projection returned by the alert-history endpoint. */
export interface PatientCdsAlert {
  alert_id: string;
  title: string;
  description: string;
  severity: 'Informational' | 'Low' | 'Medium' | 'High' | 'Critical';
  alert_type: string;
  created_at: number;
  status: string;
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

/**
 * Translate content through the deployment's configured provider.
 *
 * `machine_translated` and `clinically_verified` are not decoration and a
 * caller must render them. A mistranslated dose instruction is a dosing error
 * with a language barrier in front of it, and the reader cannot notice.
 * `clinically_verified` is always false: nothing in this system reviews a
 * machine translation.
 *
 * Throws `503 TRANSLATION_PROVIDER_UNAVAILABLE` when the deployment has no
 * provider, and `502 TRANSLATION_PROVIDER_ERROR` when it has one that could
 * not be reached. Neither ever returns the untranslated content.
 */
export async function translateContent(data: {
  content: string;
  target_language: string;
  context?: string;
}): Promise<{
  success: boolean;
  original_content: string;
  translated_content: string;
  target_language: string;
  detected_source_language: string | null;
  provider: string;
  machine_translated: boolean;
  clinically_verified: boolean;
}> {
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

/** One order inside a bundle (`OrderSetItemInput`). */
export interface OrderSetItemPayload {
  type: string;
  description: string;
  instructions?: string;
  priority: string;
  duration?: string;
  frequency?: string;
  route?: string;
}

/** What the order-set form submits (`CreateOrderSetRequest`). */
export interface CreateOrderSetPayload {
  name: string;
  type: string;
  specialty: string;
  description: string;
  indication?: string;
  orders: OrderSetItemPayload[];
  tags?: string[];
}

/**
 * Draft an order set. It is saved awaiting a pharmacist's review and is not
 * orderable until one approves it.
 */
export async function createOrderSet(
  data: CreateOrderSetPayload
): Promise<{ success: boolean; order_set: Record<string, unknown> }> {
  return getApiClient().post('/api/clinical/order-sets', data);
}

/** A pharmacist's decision on a draft. A rejection carries its reason. */
export async function decideOrderSet(
  setId: string,
  decision: 'approved' | 'rejected',
  notes?: string
): Promise<{ success: boolean; order_set: Record<string, unknown> }> {
  return getApiClient().post(`/api/clinical/order-sets/${encodeURIComponent(setId)}/approval`, {
    decision,
    notes,
  });
}

/** Retire an order set. It is hidden, not deleted. */
export async function deactivateOrderSet(
  setId: string
): Promise<{ success: boolean; set_id: string }> {
  return getApiClient().post(
    `/api/clinical/order-sets/${encodeURIComponent(setId)}/deactivate`,
    {}
  );
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
): Promise<{
  success: boolean;
  template_id: string;
  rendered_content: Record<string, unknown>;
  /** The same text in the order it was written; an object does not keep order. */
  rendered_sections?: { title: string; content: string }[];
  timestamp: number;
}> {
  return getApiClient().post('/api/templates/notes/use', data);
}

/** What `POST /api/templates/notes` accepts (`CreateNoteTemplateRequest`). */
export interface CreateNoteTemplatePayload {
  name: string;
  type: string;
  category: string;
  description?: string;
  sections: { title: string; content: string; required?: boolean }[];
  macros?: string[];
  tags?: string[];
}

/** Save a template every clinician in the facility can use. */
export async function createNoteTemplate(
  data: CreateNoteTemplatePayload
): Promise<{ success: boolean; template: Record<string, unknown> }> {
  return getApiClient().post('/api/templates/notes', data);
}

/** Retire a clinician-authored template. It is hidden, not deleted. */
export async function deactivateNoteTemplate(
  templateId: string
): Promise<{ success: boolean; template_id: string }> {
  return getApiClient().post(`/api/templates/notes/${encodeURIComponent(templateId)}/deactivate`, {});
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

/** The stable wire representation returned by the patient vitals flowsheet. */
export interface PatientVitalReading {
  reading_id: string;
  timestamp: number;
  recorded_at: string;
  recorded_by: string;
  heart_rate: number | null;
  respiratory_rate: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  temperature_celsius: number | null;
  oxygen_saturation: number | null;
  pain_scale: number | null;
  gcs_total: number | null;
  blood_glucose: number | null;
  weight_kg: number | null;
}

/** Get vital signs for a patient. */
export async function getPatientVitals(
  patientId: string
): Promise<{ patient_id: string; readings: PatientVitalReading[]; total: number; critical_alerts: unknown[] }> {
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
export interface SecureMessage {
  message_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  recipient_id: string;
  recipient_name?: string;
  subject: string;
  content: string;
  priority: string;
  related_patient_id: string | null;
  sent_at: number;
  read: boolean;
  thread_id: string;
}

export interface MessageConversation {
  id: string;
  providerId: string;
  providerName: string;
  providerRole: string | null;
  specialty: string | null;
  lastMessage: string | null;
  lastMessageTime: number | null;
  unreadCount: number;
  messages: SecureMessage[];
}

export interface SecureMessagesResponse {
  success: boolean;
  folder: string;
  messages: SecureMessage[];
  conversations: MessageConversation[];
  count: number;
  unread_count: number;
}

export async function sendMessage(data: {
  recipient_id: string;
  subject: string;
  content: string;
  priority?: string;
  related_patient_id?: string;
  thread_id?: string;
  reply_to?: string;
}): Promise<{ success: boolean; message: SecureMessage; info: string }> {
  return getApiClient().post('/api/messages/send', data);
}

/** The caller's persisted message copies, optionally limited to a mailbox. */
export async function getMessages(folder: 'inbox' | 'sent' | 'all' = 'inbox'): Promise<SecureMessagesResponse> {
  return getApiClient().get(`/api/messages?folder=${folder}`);
}

/** Persist that the authenticated recipient opened a message. */
export async function markMessageRead(messageId: string): Promise<{
  success: boolean;
  message_id: string;
  read: boolean;
}> {
  return getApiClient().post(`/api/messages/${encodeURIComponent(messageId)}/read`, {});
}

/**
 * Get notifications
 */
export interface InboxNotification {
  id: string;
  type: string;
  priority: string;
  title: string;
  timestamp: number;
  patient_id?: string;
}

export async function getNotifications(): Promise<{
  success: boolean;
  notifications: InboxNotification[];
  count: number;
  unread_count: number;
  /** Unix seconds of this caller's read marker; 0 when they never have. */
  read_at: number;
}> {
  return getApiClient().get('/api/notifications');
}

/**
 * Mark everything up to now as read.
 *
 * A marker, not a per-entry flag: the list is derived from live clinical state,
 * so its entries are not rows anybody can flag.
 */
export async function markNotificationsRead(): Promise<{
  success: boolean;
  read_at: number;
}> {
  return getApiClient().post('/api/notifications/read', {});
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
 * MediChain's published FHIR Patient transaction profile.
 *
 * The standard Patient shape is intentionally structural here. The API
 * requires the listed emergency extensions because MediChain cannot safely
 * create an emergency-health record without those explicitly supplied facts.
 */
export interface FhirPatientCreateResource {
  resourceType: 'Patient';
  identifier: Array<{ system: 'urn:medichain:national-id'; value: string }>;
  name: Array<{ text?: string; given?: string[]; family?: string }>;
  birthDate: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  telecom?: Array<{ system: 'phone'; value: string }>;
  contact: Array<{
    relationship: Array<{ text?: string; coding?: Array<{ display?: string }> }>;
    name: { text: string };
    telecom: Array<{ system: 'phone'; value: string }>;
  }>;
  extension: Array<
    | {
        url: 'https://medichain.health/fhir/StructureDefinition/emergency-blood-type';
        valueCode: string;
      }
    | {
        url:
          | 'https://medichain.health/fhir/StructureDefinition/organ-donor'
          | 'https://medichain.health/fhir/StructureDefinition/dnr-status';
        valueBoolean: boolean;
      }
  >;
}

/** A single-entry FHIR R4 transaction supported by MediChain's ingest API. */
export interface FhirPatientTransactionBundle {
  resourceType: 'Bundle';
  type: 'transaction';
  entry: Array<{
    resource: FhirPatientCreateResource;
    request: { method: 'POST'; url: 'Patient' };
  }>;
}

/** The FHIR transaction response returned after durable patient registration. */
export interface FhirTransactionResponse {
  resourceType: 'Bundle';
  type: 'transaction-response';
  entry: Array<{ response: { status: string; location?: string } }>;
}

/**
 * Create a patient through the declared FHIR R4 transaction profile.
 *
 * The server currently accepts exactly one `POST Patient` entry and rejects
 * unsupported/multi-entry transactions before any data is persisted.
 */
export async function fhirCreatePatient(
  bundle: FhirPatientTransactionBundle
): Promise<FhirTransactionResponse> {
  return getApiClient().post('/api/fhir/r4/Bundle', bundle);
}

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

/**
 * Withdraw a consent the patient previously signed.
 *
 * `POST /api/consent/{id}/revoke` has existed with no caller: the patient
 * application could **sign** a consent and never take it back. Withdrawing
 * consent is a right, not a feature — under POPIA a data subject may withdraw
 * at any time — and a screen that can only sign is a screen that records
 * agreement it cannot let go of.
 *
 * The reason is optional on purpose: a patient does not owe one.
 */
export async function revokeConsent(
  consentId: string,
  reason?: string
): Promise<{ success: boolean; message?: string }> {
  return getApiClient().post(`/api/consent/${consentId}/revoke`, { reason: reason || null });
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
  category?: string;
  duration?: string;
  notes?: string;
  triggers?: string[];
  relieved_by?: string[];
}): Promise<{ success: boolean }> {
  return getApiClient().post('/api/symptoms/log', data);
}

/**
 * Get symptom history
 */
export async function getSymptomHistory(
  patientId: string
): Promise<{
  success: boolean;
  patient_id: string;
  entries: Array<{
    id: string;
    symptom: string;
    category?: string | null;
    severity: number;
    timestamp: string;
    duration?: string | null;
    notes?: string | null;
    triggers?: string[];
    relievedBy?: string[];
  }>;
  total_entries: number;
}> {
  return getApiClient().get(`/api/symptoms/${patientId}`);
}

/** Retract a diary entry while preserving its clinical audit history. */
export async function retractSymptom(
  patientId: string,
  entryId: string
): Promise<{ success: boolean; entry_id: string; message: string }> {
  return getApiClient().post(`/api/symptoms/${patientId}/${entryId}/retract`);
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

/** What the server computed when a GCS assessment was filed. */
export interface GcsCreateResult {
  success: boolean;
  assessment_id: string;
  total_score: number;
  interpretation: string;
  is_comatose: boolean;
  needs_airway: boolean;
  message: string;
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

/** List durable instrument calibration runs separately from QC measurements. */
export async function listLabCalibrations(): Promise<ListResponse<unknown>> {
  const items = await getApiClient().get<unknown[]>('/api/platform/list/lab-calibrations');
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
 * List all blood-bank records currently available to the clinical register.
 *
 * Crossmatches have no standalone store yet, but both the order/type-screen
 * and transfusion-event repositories are included by the server. Do not turn
 * an omitted crossmatch subsystem into a claim that no transfusions exist.
 */
export async function listBloodBank(): Promise<{
  success: boolean;
  type_screens: { total: number; items: unknown[] };
  crossmatches: { total: number; items: unknown[] };
  transfusions: { total: number; items: unknown[] };
}> {
  const response = await getApiClient().get<{
    screens?: unknown[];
    transfusions?: unknown[];
  }>('/api/platform/list/blood-bank');
  const screens = response?.screens || [];
  const transfusions = response?.transfusions || [];
  return {
    success: true,
    type_screens: { total: screens.length, items: screens },
    crossmatches: { total: 0, items: [] },
    transfusions: { total: transfusions.length, items: transfusions },
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

// ---------------------------------------------------------------------------
// CDS rules — the rules themselves, not the alerts they produce
// ---------------------------------------------------------------------------

/** One thing a rule does when it fires (`CdsRuleActionInput`). */
export interface CdsRuleActionPayload {
  type: string;
  message: string;
  severity: string;
  notifyRoles?: string[];
  blockAction?: boolean;
  suggestedAction?: string;
  escalateTo?: string;
}

/** What the rule builder submits (`CreateCdsRuleRequest`). */
export interface CreateCdsRulePayload {
  name: string;
  category: string;
  description: string;
  severity: string;
  triggerType: string;
  conditions: unknown[];
  actions: CdsRuleActionPayload[];
  status?: string;
  priority?: number;
  isEnabled?: boolean;
  testMode?: boolean;
  targetRoles?: string[];
  evidenceLevel?: string;
  references?: string[];
}

/** The CDS rules in force. Readable by clinical staff; written by admins. */
export async function listCdsRules(): Promise<{
  success: boolean;
  count: number;
  rules: Record<string, unknown>[];
}> {
  return getApiClient().get('/api/admin/cds/rules');
}

/** Write a rule. Administrators only. */
export async function createCdsRule(
  data: CreateCdsRulePayload
): Promise<{ success: boolean; rule: Record<string, unknown> }> {
  return getApiClient().post('/api/admin/cds/rules', data);
}

/** Turn a rule on or off. Refused with 409 if it changed meanwhile. */
export async function setCdsRuleEnablement(
  ruleId: string,
  isEnabled: boolean
): Promise<{ success: boolean; rule: Record<string, unknown> }> {
  return getApiClient().post(
    `/api/admin/cds/rules/${encodeURIComponent(ruleId)}/enablement`,
    { isEnabled }
  );
}

/** Stop a rule firing. Retired, not deleted: the audit trail names it. */
export async function retireCdsRule(
  ruleId: string
): Promise<{ success: boolean; rule_id: string }> {
  return getApiClient().post(`/api/admin/cds/rules/${encodeURIComponent(ruleId)}/retire`, {});
}

// ---------------------------------------------------------------------------
// Reading back a record the screen itself wrote
// ---------------------------------------------------------------------------

/**
 * A stored clinical record, in the shape the screen that wrote it uses.
 *
 * Several procedure handlers (`create_intubation`, `create_splint`,
 * `create_burn`, `create_anesthesia`) persist the **whole submission** in the
 * record's `data` blob alongside a queryable projection in typed columns. The
 * blob is therefore already in the screen's own shape -- its camelCase names,
 * its nested objects -- and is the faithful thing to render.
 *
 * Two things the blob cannot carry, which this overlays from the typed row:
 *
 *   * the **id**, which is server-assigned, so a screen echoing its own
 *     submission has nothing to open a detail view with; and
 *   * any column the server stamped rather than accepted -- the performing
 *     clinician, for instance. The blob records what the client *claimed*; the
 *     column records who was actually signed in, and the second is the one to
 *     show.
 *
 * Pass `authoritative` as { screenField: entityColumn } for that second case.
 *
 * # Why this exists
 *
 * Every one of those pages kept its list in local React state --
 * `setRecords([newRecord, ...records])` -- and never read anything back. The
 * screen showed what you typed this session and emptied on reload, while the
 * record sat in the database. This is the other half of the fix.
 */
export function fromStoredRecord<T>(
  raw: Record<string, unknown>,
  authoritative: Record<string, string> = {}
): T {
  const blob = (raw.data ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...blob };

  // The server-assigned primary key always wins over anything in the blob.
  if (raw.id !== undefined && raw.id !== null) merged.id = raw.id;

  for (const [screenField, column] of Object.entries(authoritative)) {
    const value = raw[column];
    if (value !== undefined && value !== null && value !== '') {
      merged[screenField] = value;
    }
  }
  return merged as T;
}

/**
 * Pull the row array out of whatever envelope a list endpoint used.
 *
 * These endpoints are not consistent with each other -- some return a bare
 * array, some `{ records: [...] }`, some `{ data: [...] }` -- and a screen that
 * guesses wrong renders an empty list rather than an error, which is the
 * failure mode hardest to notice.
 */
export function rowsOfResponse(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === 'object') {
    const envelope = body as Record<string, unknown>;
    for (const key of ['records', 'data', 'items', 'assessments', 'repairs']) {
      if (Array.isArray(envelope[key])) return envelope[key] as Record<string, unknown>[];
    }
  }
  return [];
}

// ============================================================================
// Data retention (POPIA)
// ============================================================================
//
// Eleven endpoints, none of which had a client function or a screen. The
// workflow they implement is a legal obligation with a deliberate maker-checker
// shape -- assess, request a token bound to that exact record set, have an
// administrator decide it, then execute -- and none of it could be carried out
// by a person. A compliance control nobody can operate is not a control.
//
// Nothing here deletes. Execution restricts processing (storage only) and
// writes a register entry; see `api/src/retention` for why that boundary is
// deliberate.

/** What one policy's assessment found. */
export interface PolicyAssessment {
  policy_id: string;
  policy_name: string;
  entity_type: string;
  evaluated: number;
  due: number;
  not_due: number;
  held: number;
  excluded: number;
  due_patient_ids: string[];
  /** Set when the policy itself is unusable, rather than silently skipped. */
  configuration_error?: string | null;
}

/** A whole retention assessment run. */
export interface RetentionAssessment {
  assessed_on: string;
  policies: PolicyAssessment[];
  total_due: number;
  total_held: number;
  /** Always 0. Present so the report cannot be misread as having deleted anything. */
  records_deleted: number;
  /**
   * Set when the assessment could not actually be carried out. An assessment
   * that did not run is not an assessment that found nothing, and a screen that
   * renders `total_due: 0` without checking this manufactures false assurance
   * about a legal obligation.
   */
  incomplete_reason?: string | null;
}

/** Today's retention position. Read-only: nothing is disposed of by asking. */
export async function getRetentionReport(): Promise<{
  success: boolean;
  assessment: RetentionAssessment;
}> {
  return getApiClient().get('/api/admin/retention/report');
}

/** One recorded assessment run. */
export interface RetentionJobRun {
  id: string;
  policy_id?: string | null;
  job_type: string;
  started_at?: string | null;
  completed_at?: string | null;
  entity_type: string;
  date_threshold: string;
  status?: string | null;
  records_evaluated?: number | null;
  records_archived?: number | null;
  records_deleted?: number | null;
  records_skipped?: number | null;
  error_count?: number | null;
  run_by?: string | null;
  dry_run?: boolean | null;
  created_at?: string | null;
}

/**
 * The assessments that have already run.
 *
 * The point of recording a run is to show, later, that the policy was applied
 * on a given date. A record nobody can retrieve proves nothing.
 */
export async function listRetentionRuns(): Promise<{
  success: boolean;
  count: number;
  runs: RetentionJobRun[];
}> {
  return getApiClient().get('/api/admin/retention/runs');
}

/** A litigation or regulatory hold. */
export interface LegalHold {
  id: string;
  patient_id?: string | null;
  entity_type?: string | null;
  reason: string;
  reference?: string | null;
  applied_by: string;
  applied_at: string;
  released_by?: string | null;
  released_at?: string | null;
  release_reason?: string | null;
  created_at?: string | null;
}

export async function listLegalHolds(): Promise<{
  success: boolean;
  count: number;
  holds: LegalHold[];
}> {
  return getApiClient().get('/api/admin/retention/holds');
}

/**
 * Place a hold. At least one of `patient_id` or `entity_type` must be given --
 * a hold scoped to neither would cover nothing while looking like protection.
 */
export async function createLegalHold(payload: {
  patient_id?: string | null;
  entity_type?: string | null;
  reason: string;
  reference?: string | null;
}): Promise<{ success: boolean; hold: LegalHold }> {
  return getApiClient().post('/api/admin/retention/holds', payload);
}

/**
 * Release a hold. The row stays: the period during which records were held is
 * itself part of the audit trail.
 */
export async function releaseLegalHold(
  holdId: string,
  reason?: string
): Promise<{ success: boolean; hold: LegalHold }> {
  return getApiClient().post(`/api/admin/retention/holds/${encodeURIComponent(holdId)}/release`, {
    reason: reason || null,
  });
}

/** An approval token bound to one exact assessment. */
export interface RetentionApproval {
  token: string;
  assessment_digest: string;
  assessed_on: string;
  due_count: number;
  requested_by: string;
  requested_at: string;
  approved_by?: string | null;
  approved_at?: string | null;
  executed_by?: string | null;
  executed_at?: string | null;
  /** pending | approved | executed | rejected | expired */
  status: string;
  expires_at: string;
  rejection_reason?: string | null;
}

export async function listRetentionApprovals(): Promise<{
  success: boolean;
  count: number;
  approvals: RetentionApproval[];
}> {
  return getApiClient().get('/api/admin/retention/approvals');
}

/**
 * Run an assessment and mint a token bound to its exact contents.
 *
 * The token authorises acting on *that* record set and no other; execution
 * re-assesses and aborts if the set has moved.
 */
export async function requestRetentionApproval(): Promise<{
  success: boolean;
  approval: RetentionApproval;
  assessment: RetentionAssessment;
  note?: string;
}> {
  return getApiClient().post('/api/admin/retention/approvals', {});
}

/** Approve or reject a pending token. */
export async function decideRetentionApproval(
  token: string,
  approved: boolean,
  reason?: string
): Promise<{ success: boolean; approval: RetentionApproval }> {
  return getApiClient().post(`/api/admin/retention/approvals/${encodeURIComponent(token)}/decide`, {
    approved,
    reason: reason || null,
  });
}

/**
 * What executing an approved token actually did.
 *
 * Field names taken from a live response, not from the handler's type: the
 * outcome is assembled as `serde_json` and nothing would have caught a name
 * that never arrives.
 */
export interface RetentionExecutionOutcome {
  token: string;
  restricted: number;
  registered: number;
  skipped_for_hold: number;
  /** Always 0. Destructive execution is not built. */
  deleted: number;
  failed: unknown[];
}

/**
 * Execute an approved token: restrict processing and register the decision.
 * Nothing is deleted. A 409 means the record set moved since approval.
 */
export async function executeRetentionApproval(
  token: string
): Promise<{ success: boolean; outcome: RetentionExecutionOutcome; note?: string }> {
  return getApiClient().post(
    `/api/admin/retention/approvals/${encodeURIComponent(token)}/execute`,
    {}
  );
}

/** A record whose processing is limited to storage. */
export interface ProcessingRestriction {
  id: string;
  patient_id: string;
  entity_type: string;
  reason: string;
  policy_id?: string | null;
  approval_token?: string | null;
  restricted_by: string;
  restricted_at: string;
  lifted_by?: string | null;
  lifted_at?: string | null;
  lift_reason?: string | null;
}

export async function listProcessingRestrictions(): Promise<{
  success: boolean;
  count: number;
  restrictions: ProcessingRestriction[];
}> {
  return getApiClient().get('/api/admin/retention/restrictions');
}

/**
 * Restore ordinary processing. The restriction row is retained -- that
 * processing was restricted between two dates is the auditable fact.
 */
export async function liftProcessingRestriction(
  id: string,
  reason?: string
): Promise<{ success: boolean; restriction: ProcessingRestriction }> {
  return getApiClient().post(`/api/admin/retention/restrictions/${encodeURIComponent(id)}/lift`, {
    reason: reason || null,
  });
}

/** One line of evidence that a retention decision was carried out. */
export interface DeletionRegisterEntry {
  id: string;
  patient_id: string;
  entity_type: string;
  /** `restricted` today; destructive execution is not built. */
  action: string;
  policy_id?: string | null;
  policy_name?: string | null;
  basis: string;
  approval_token?: string | null;
  executed_by: string;
  executed_at: string;
}

/**
 * The deletion register: what was acted on, under which policy, on whose
 * authority. Carries no clinical payload by design.
 */
export async function getDeletionRegister(): Promise<{
  success: boolean;
  count: number;
  entries: DeletionRegisterEntry[];
}> {
  return getApiClient().get('/api/admin/retention/register');
}

// ============================================================================
// Emergency capsule (the three-second NFC payload)
// ============================================================================
//
// Four endpoints implementing the POPIA requirement that emergency values be
// versioned, revocable and access-logged. None had a client function, so a
// capsule could never be published from the product: the blood type a paramedic
// reads at a bedside was whatever had last been written by a script.
//
// No plaintext travels on these. The encrypted capsule body is excluded from
// the entity server-side; what comes back is commitments and metadata.

/** One published version of a patient's emergency directive. */
export interface EmergencyCapsuleVersion {
  patient_id: string;
  version: number;
  /** Hex SHA3-256 commitment, as published on-chain. */
  commitment: string;
  key_version: number;
  created_by: string;
  created_at: string;
  revoked_at?: string | null;
  revoked_by?: string | null;
  revocation_reason?: string | null;
  chain_tx_hash?: string | null;
  /**
   * `false` with a hash present means a placeholder, not an anchored
   * commitment. Showing the hash without this would claim an anchoring that
   * never happened.
   */
  chain_finalized: boolean;
}

/**
 * Which emergency directive is in force, and which ones used to be.
 *
 * Revoked versions are included: that a DNR directive was in force between two
 * dates is part of the clinical record.
 */
export async function getEmergencyCapsuleVersions(patientId: string): Promise<{
  success: boolean;
  patient_id: string;
  current: EmergencyCapsuleVersion | null;
  count: number;
  versions: EmergencyCapsuleVersion[];
}> {
  return getApiClient().get(`/api/patients/${encodeURIComponent(patientId)}/emergency-capsule`);
}

/**
 * Publish a new capsule version from the patient's stored emergency
 * information, and anchor its commitment.
 *
 * Call this after any change to blood type, allergies, organ-donor status or a
 * DNR directive: the previous version stays on file but stops being current.
 * Until this runs, the card a paramedic taps still carries the old values.
 */
export async function publishEmergencyCapsule(patientId: string): Promise<{
  success: boolean;
  patient_id: string;
  version: number;
  commitment: string;
  /** `finalized` | `pending` | `disabled` — never a bare hash. */
  anchoring: string;
  blockchain_tx_hash?: string | null;
}> {
  return getApiClient().post(
    `/api/patients/${encodeURIComponent(patientId)}/emergency-capsule`,
    {}
  );
}

/**
 * Revoke a capsule version. The row is retained — revocation is never deletion,
 * because a directive having been in force is itself part of the record.
 */
export async function revokeEmergencyCapsule(
  patientId: string,
  version: number,
  reason?: string
): Promise<{
  success: boolean;
  patient_id: string;
  version: number;
  revoked_at?: string | null;
  revoked_by?: string | null;
}> {
  return getApiClient().post(
    `/api/patients/${encodeURIComponent(patientId)}/emergency-capsule/revoke`,
    { version, reason: reason || null }
  );
}

/** One break-glass read of a patient's emergency capsule. */
export interface EmergencyCapsuleAccess {
  id: string;
  patient_id: string;
  /** `null` when no capsule existed to read — a failed break-glass attempt is still an access. */
  capsule_version: number | null;
  accessed_by: string;
  /** The emergency grant the read happened under. */
  grant_id: string | null;
  reason_code: string;
  reason_text: string | null;
  /** The fields actually returned to the caller, not the ones requested. */
  fields_revealed: string[];
  /** Whether the capsule still matched its on-chain commitment at read time. */
  commitment_verified: boolean;
  accessed_at: string;
}

/**
 * Who read this patient's emergency data, why, and which fields were revealed.
 *
 * Readable by the patient themself as well as by clinical staff: a data subject
 * asking "who saw my emergency information" is the question this log exists to
 * answer, and a log only clinicians can read does not answer it.
 */
export async function getEmergencyCapsuleAccessLog(patientId: string): Promise<{
  success: boolean;
  patient_id: string;
  count: number;
  accesses: EmergencyCapsuleAccess[];
}> {
  return getApiClient().get(
    `/api/patients/${encodeURIComponent(patientId)}/emergency-capsule/access-log`
  );
}

// ============================================================================
// Patient-owned mobile devices
// ============================================================================
//
// Four endpoints, all of which write, and none with a client function. A device
// id is returned exactly once — in the response to the registration that
// created it — so a patient who lost a phone had no way to name the device they
// wanted revoked. `GET /api/mobile/devices` is new.

/** A device this patient has registered against their records. */
export interface PatientMobileDevice {
  id: string;
  patient_id: string;
  device_label: string;
  platform: string;
  /** The device's public half. The private key never leaves the device. */
  public_key: string;
  status: string;
  last_synchronised_at?: string | null;
  revoked_at?: string | null;
  revocation_reason?: string | null;
}

/**
 * The devices the signed-in patient has registered.
 *
 * Scoped to the caller: the screen asking this is "my devices", and there is no
 * id for it to send. Revoked devices are included and marked, because someone
 * who has just lost a phone needs to see the revocation took effect.
 */
export async function listMyMobileDevices(): Promise<{
  success: boolean;
  count: number;
  devices: PatientMobileDevice[];
}> {
  return getApiClient().get('/api/mobile/devices');
}

/**
 * Register a device's public key. The private half stays on the device — this
 * call carries the public key only, and the server never sees a secret.
 */
export async function registerMobileDevice(payload: {
  device_label: string;
  platform: string;
  public_key: string;
}): Promise<PatientMobileDevice> {
  return getApiClient().post('/api/mobile/devices/register', payload);
}

/**
 * Revoke a device and invalidate the content capabilities it holds.
 *
 * The row is kept and marked revoked rather than removed: a patient needs to
 * see that the phone they lost can no longer open anything.
 */
export async function revokeMobileDevice(
  deviceId: string,
  reason: string
): Promise<PatientMobileDevice> {
  return getApiClient().post(`/api/mobile/devices/${encodeURIComponent(deviceId)}/revoke`, {
    reason,
  });
}

/**
 * A short-lived token letting one active device show the medical ID on a locked
 * screen. Expires in minutes and is scoped to reading that one thing.
 */
export async function issueLockscreenToken(deviceId: string): Promise<{
  token: string;
  token_type: string;
  expires_in: number;
  device_id: string;
}> {
  return getApiClient().post(
    `/api/mobile/devices/${encodeURIComponent(deviceId)}/lockscreen-token`,
    {}
  );
}

/**
 * Authorise one device to open one record.
 *
 * Returns a capability over a ciphertext reference — never a plaintext
 * download. The record stays encrypted; the device is handed permission to
 * fetch and decrypt it, and that permission expires.
 */
export async function authoriseMobileRecord(payload: {
  device_id: string;
  record_id: string;
  encrypted_content_reference: string;
  watermark_text?: string | null;
}): Promise<Record<string, unknown>> {
  return getApiClient().post('/api/mobile/records/authorise', payload);
}

// ============================================================================
// Wearable alerting
// ============================================================================
//
// A patient could connect a device and stream readings, and nothing could ever
// alert them: `createWearableAlertRule` had no caller anywhere, `getWearableAlerts`
// had none either, and the endpoint that lists saved rules had no client
// function at all. So a rule could be stored and never seen, checked or
// corrected — which is why the threshold direction being wrong server-side went
// unnoticed.

/** One threshold rule, as the server stores it. */
export interface WearableAlertRule {
  rule_id: string;
  patient_id: string;
  /** A tagged enum server-side: a plain string for the known types. */
  data_type: string | Record<string, string>;
  /** `Above` | `Below` | `OutsideRange` | `ChangeRate` | `AbsenceOfData` */
  threshold_type: string;
  /** For a band this is the HIGH bound; `secondary_threshold` is the low one. */
  threshold_value: number;
  secondary_threshold?: number | null;
  severity: string;
  notify_patient: boolean;
  notify_provider: boolean;
  provider_id?: string | null;
  active: boolean;
  /** Unix seconds. */
  created_at: number;
}

/**
 * The alert rules this caller has set.
 *
 * `POST` has stored them since the feature was built and nothing read them
 * back, so a patient could not see, check or correct a rule once saved.
 */
export async function listWearableAlertRules(): Promise<{
  success: boolean;
  count: number;
  rules: WearableAlertRule[];
}> {
  return getApiClient().get('/api/wearables/alert-rules');
}

/** A wearable model the deployment knows how to take readings from. */
export interface SupportedWearable {
  manufacturer: string;
  models: string[];
  data_types: string[];
}

/**
 * Which wearables this deployment supports.
 *
 * Reference data, served rather than hardcoded in a component — the same reason
 * clinical thresholds come from the scoring catalogue. The page and the server
 * each carried their own list and the two disagreed.
 */
export async function getSupportedWearables(): Promise<{
  success: boolean;
  /** The server's own key. Checked against a live response, not guessed. */
  supported_manufacturers: SupportedWearable[];
}> {
  return getApiClient().get('/api/wearables/supported');
}

// ============================================================================
// Clinical read-back
// ============================================================================
//
// Each of these existed server-side with no client function. The pattern is the
// same one this codebase keeps finding: a screen writes a record and then has
// no way to fetch it again, so nothing can confirm what was stored, and a
// clinician returning to a note sees whatever the form last held in memory.

/** One SOAP note as stored. */
export interface StoredSoapNote {
  note_id: string;
  patient_id: string;
  [key: string]: unknown;
}

/**
 * Fetch a SOAP note by its id.
 *
 * Nothing could read a note back after writing it. A clinician who navigated
 * away and returned had no way to see what had actually been recorded.
 */
export async function getSoapNote(noteId: string): Promise<StoredSoapNote> {
  return getApiClient().get(`/api/clinical/soap/${encodeURIComponent(noteId)}`);
}

/**
 * Append an addendum to a SOAP note.
 *
 * The correct way to change a clinical note after the fact: the original stays
 * exactly as written and the correction is appended with its own author and
 * timestamp. Overwriting would destroy what was relied on at the time, which is
 * why the endpoint exists and why no page should offer an edit instead.
 */
export async function addSoapAddendum(
  noteId: string,
  content: string
): Promise<{ success: boolean; addendum_id: string; message: string }> {
  // `content` is the field name the handler reads; it rejects anything else
  // with MISSING_FIELD. Checked against the handler, not assumed from the
  // parameter's meaning.
  return getApiClient().post(`/api/clinical/soap/${encodeURIComponent(noteId)}/addendum`, {
    content,
  });
}

/** One triage assessment as stored. */
export interface StoredTriageAssessment {
  assessment_id: string;
  patient_id: string;
  esi_level: string;
  chief_complaint: string;
  performed_by: string;
  performed_at: number;
  [key: string]: unknown;
}

/** Fetch a triage assessment by its id, to confirm what was recorded. */
export async function getTriageAssessment(
  assessmentId: string
): Promise<StoredTriageAssessment> {
  return getApiClient().get(`/api/clinical/triage/${encodeURIComponent(assessmentId)}`);
}

/** All triage assessments the authenticated caller may read for one patient. */
export async function getPatientTriageAssessments(
  patientId: string
): Promise<{ patient_id: string; assessments: StoredTriageAssessment[]; total: number }> {
  return getApiClient().get(`/api/clinical/patient/${encodeURIComponent(patientId)}/triage`);
}

/**
 * The most recent vital signs recorded for a patient.
 *
 * A single reading rather than the whole series — what a clinician wants at the
 * top of a record, and what a dashboard tile needs without pulling a history.
 */
export async function getPatientLatestVitals(
  patientId: string
): Promise<Record<string, unknown>> {
  return getApiClient().get(
    `/api/clinical/patient/${encodeURIComponent(patientId)}/vitals/latest`
  );
}

/**
 * One lab panel template by name.
 *
 * `getLabPanels` lists them; this returns the tests a single panel contains, so
 * an order form can show what it is about to order rather than a bare name.
 */
export async function getLabPanel(panelName: string): Promise<Record<string, unknown>> {
  return getApiClient().get(`/api/clinical/lab-panels/${encodeURIComponent(panelName)}`);
}

// ============================================================================
// Medical identities a person may act for
// ============================================================================

/** One medical record this account may open. */
export interface MedicalIdentitySummary {
  patient_id: string;
  /** `self`, or the guardianship type for a ward. */
  relationship: string;
  full_name?: string | null;
  date_of_birth?: string | null;
  permissions: string[];
}

/**
 * Every medical record the signed-in person may act for: their own, plus any
 * ward they hold an active, unexpired guardianship over.
 *
 * Caller-scoped on purpose — the question is "whose records may I open", and
 * the caller has no id to send. Expired and revoked guardianships are filtered
 * out server-side, because this list is an offer to act, not a history.
 */
export async function listMyMedicalIdentities(): Promise<{
  identities: MedicalIdentitySummary[];
}> {
  return getApiClient().get('/api/identity/my-medical-identities');
}

/**
 * Claim an existing medical record as your own.
 *
 * Proves the claim with a national ID and date of birth checked against what
 * was stored at registration — so a record created for a walk-in patient can
 * later be attached to the account that person signs in with, without an
 * administrator moving data between records by hand.
 */
export async function claimMedicalIdentity(payload: {
  patient_id: string;
  national_id: string;
  date_of_birth: string;
}): Promise<{ success: boolean; patient_id: string; message?: string }> {
  return getApiClient().post('/api/identity/claim', payload);
}

// ============================================================================
// Organisation key directory
// ============================================================================

/** A registered organisation signing/encryption key. */
export interface OrganizationKey {
  key_id: string;
  organization_id: string;
  facility_id?: string | null;
  version: number;
  purpose: string;
  algorithm: string;
  public_key: string;
  status: string;
  [key: string]: unknown;
}

/** The key an organisation is currently using for a given purpose. */
export async function getActiveOrganizationKey(
  organizationId: string
): Promise<{ success: boolean; key?: OrganizationKey | null }> {
  return getApiClient().get(
    `/api/organizations/${encodeURIComponent(organizationId)}/keys/active`
  );
}

/**
 * Register a public key against an organisation.
 *
 * Only the public half travels: `proof_of_possession` demonstrates the holder
 * controls the private key without ever sending it. A key arrives `pending` and
 * has to be transitioned before anything will use it.
 */
export async function registerOrganizationKey(
  organizationId: string,
  payload: {
    organization_id: string;
    facility_id?: string | null;
    key_id: string;
    version: number;
    purpose: string;
    algorithm: string;
    public_key: string;
    proof_of_possession: string;
  }
): Promise<{ success: boolean; key?: OrganizationKey }> {
  return getApiClient().post(
    `/api/organizations/${encodeURIComponent(organizationId)}/keys`,
    payload
  );
}

/** Move a registered key between states (pending → active → retired). */
export async function transitionOrganizationKey(
  organizationId: string,
  keyId: string,
  status: string
): Promise<{ success: boolean; key?: OrganizationKey }> {
  return getApiClient().post(
    `/api/organizations/${encodeURIComponent(organizationId)}/keys/${encodeURIComponent(keyId)}/status`,
    { status }
  );
}

// ============================================================================
// Session assurance
// ============================================================================

/**
 * What the current session already proves.
 *
 * Lets a screen prompt for a step-up *before* starting a privileged workflow
 * rather than discovering the requirement from a rejected mutation halfway
 * through. `class_b` is the elevated state `useStepUp` otherwise has to
 * recover into.
 */
export async function getSessionAssurance(): Promise<{
  success: boolean;
  class_a: boolean;
  class_b: boolean;
  step_up_ttl_secs: number;
}> {
  return getApiClient().get('/api/auth/assurance');
}

// ============================================================================
// Reads and actions that existed server-side with no client function
// ============================================================================

/**
 * Eligibility checks already run for a patient.
 *
 * `POST /api/insurance/eligibility` has run checks since the feature was built
 * and nothing could read one back, so a clinic that checked a patient's cover on
 * Monday had to check it again on Tuesday — paying for the query twice and
 * losing the record of what the insurer said the first time.
 */
export async function getEligibilityChecks(patientId: string): Promise<{
  success: boolean;
  patient_id: string;
  count: number;
  checks: Record<string, unknown>[];
}> {
  return getApiClient().get(
    `/api/insurance/eligibility/${encodeURIComponent(patientId)}`
  );
}

/** The medication reminders scheduled for a patient. */
export async function getMedicationReminders(patientId: string): Promise<{
  success: boolean;
  patient_id: string;
  count: number;
  reminders: Record<string, unknown>[];
}> {
  return getApiClient().get(
    `/api/medications/reminders/${encodeURIComponent(patientId)}`
  );
}

/** One staff member, as the directory exposes them. */
export interface StaffMember {
  wallet_address: string;
  name: string;
  role: string;
  [key: string]: unknown;
}

/**
 * Every non-patient account, paginated.
 *
 * Distinct from the provider directory, which exposes only public identity
 * fields for patients choosing somebody to message. This is the administrative
 * roster.
 */
export async function getAllStaff(options?: { page?: number; limit?: number }): Promise<{
  success: boolean;
  staff: StaffMember[];
  count: number;
  pagination: Record<string, unknown>;
}> {
  const params = new URLSearchParams();
  if (options?.page) params.set('page', String(options.page));
  if (options?.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  return getApiClient().get(`/api/staff/all${query ? `?${query}` : ''}`);
}

/**
 * Withdraw a pending or approved secondary verification.
 *
 * The prior decision is kept — revoking says the check no longer applies, not
 * that it never happened, and erasing it would remove the evidence a second
 * pharmacist had once approved the dispense.
 */
export async function revokeSecondaryVerification(
  prescriptionId: string,
  reason: string
): Promise<{ success: boolean; message?: string }> {
  return getApiClient().post(
    `/api/e-prescriptions/${encodeURIComponent(prescriptionId)}/verification/revoke`,
    { reason }
  );
}

/**
 * Every death certificate on the register.
 *
 * The page rendered filed certificates from local component state, because the
 * only endpoint was `GET /api/surgical/death-certificate/{id}` — findable only
 * by somebody who already knew the id, which is not a register. Registrars,
 * coroners and families all arrive without one.
 */
export async function listDeathCertificates(): Promise<Record<string, unknown>[]> {
  return getApiClient().get('/api/platform/list/death-certificates');
}

/** Sync status for every device registered against this account. */
export async function listSyncDevices(): Promise<{
  success: boolean;
  count: number;
  devices: Record<string, unknown>[];
}> {
  return getApiClient().get('/api/sync/devices');
}

/** Whether the telehealth provider is reachable, before a consultation starts. */
export async function getTelehealthHealth(): Promise<Record<string, unknown>> {
  return getApiClient().get('/api/health/telehealth');
}

// ============================================================================
// The last of the endpoints that had no client function
// ============================================================================

/**
 * Record a dose given during an emergency, onto the patient's MAR for today.
 *
 * A field nobody filled is omitted rather than sent empty: the handler reads
 * each key independently, and `dose: ""` would store a blank dose against a
 * real administration.
 */
export async function administerEmergencyMedication(payload: {
  patient_id: string;
  medication_name: string;
  medication_id?: string;
  dose?: string;
  route?: string;
  notes?: string;
}): Promise<{ success: boolean; record_id: string }> {
  return getApiClient().post('/api/emergency/administer-med', payload);
}

/** Verify a national ID against the issuing country's register. */
export async function verifyNationalId(payload: {
  id_number: string;
  country: string;
}): Promise<{ success: boolean; [key: string]: unknown }> {
  return getApiClient().post('/api/national-id/verify', payload);
}

/** A manual national-ID verification case. The submitted identifier is never returned. */
export interface NationalIdManualReview {
  id: string;
  country: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  evidence_reference: string | null;
}

/** List identity cases awaiting or carrying an administrator decision. */
export async function listNationalIdManualReviews(): Promise<{
  success: boolean;
  reviews: NationalIdManualReview[];
}> {
  return getApiClient().get('/api/admin/national-id-reviews');
}

/** Record an evidenced administrator decision for one pending identity case. */
export async function decideNationalIdManualReview(
  reviewId: string,
  payload: { approved: boolean; evidence_reference: string },
): Promise<{ success: boolean; status: 'approved' | 'rejected' }> {
  return getApiClient().post(
    `/api/admin/national-id-reviews/${encodeURIComponent(reviewId)}/decision`,
    payload,
  );
}

/**
 * Exchange a scanned NFC hash for a short-lived access token.
 *
 * The hash is not itself a credential: accepting it directly as a PHI-release
 * credential meant a value captured once could be replayed. This trades it for
 * a token bound to a device and a stated reason.
 */
export async function exchangeNfcHashForToken(payload: {
  patient_id: string;
  nfc_hash: string;
  device_id: string;
  reason_code: string;
}): Promise<Record<string, unknown>> {
  return getApiClient().post('/api/emergency/nfc-token', payload);
}

/** The single-tap join URL for a telehealth session. */
export function telehealthJoinUrl(sessionId: string): string {
  return `/api/telehealth/join/${encodeURIComponent(sessionId)}`;
}

/**
 * One emergency grant, readable by the professional who was issued it.
 *
 * Distinct from the administrator's `listEmergencyGrants`: this answers "what
 * am I currently allowed to see, and until when", which is the clinician's own
 * question about their own break-glass session.
 */
export async function getEmergencyGrant(grantId: string): Promise<EmergencyAccessGrant> {
  return getApiClient().get(`/api/emergency/grants/${encodeURIComponent(grantId)}`);
}

/**
 * This patient's fluid balance.
 *
 * Reachable only ward-wide before this, through provider-only listings — so the
 * person whose intake and output it is could not see it.
 */
export async function getPatientIntakeOutput(patientId: string): Promise<{
  success: boolean;
  patient_id: string;
  count: number;
  /** The handler's own key — checked against it, not inferred from the route. */
  intake_output: Record<string, unknown>[];
}> {
  return getApiClient().get(
    `/api/clinical/patient/${encodeURIComponent(patientId)}/intake-output`
  );
}

/**
 * Disconnect a wearable this patient registered.
 *
 * Deactivates rather than deletes: readings already taken were taken, and which
 * device produced them is part of reading them correctly. `is_active: false`
 * stops the device without rewriting history.
 */
export async function disconnectWearableDevice(deviceId: string): Promise<{
  success: boolean;
  device_id: string;
  is_active: boolean;
  connection_status?: string | null;
}> {
  return getApiClient().post(
    `/api/wearables/devices/${encodeURIComponent(deviceId)}/disconnect`,
    {}
  );
}
