/**
 * MediChain API endpoints: Patient registration, demographics, guardianship, family and medical ID.
 */

import type * as Requests from '../request-types.generated';
import { getApiClient } from '../client';
import type {
  ClinicalCreateResult,
  CreateSatisfactionSurveyInput,
  FamilyGroup,
  FamilyGroupCreateResult,
  FamilyHistoryMember,
  FamilyMedicalHistory,
  MedicalIdCard,
  PatientProfile,
  RegisterPatientRequest,
  RegisterPatientResponse,
} from '../../types';

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

/** Discovery fields only. Open the chart for clinical details and its access audit. */
export interface PatientDirectoryEntry {
  patient_id: string;
  full_name: string;
  date_of_birth: string;
  /** The MediChain Health ID on the patient's card; null when none was issued. */
  health_id?: string | null;
  /** Administrative gender as registered; null when none was recorded. */
  gender?: string | null;
  facility?: string | null;
  content_available?: boolean;
}

export async function getPatients(options: PatientListOptions = {}): Promise<PatientDirectoryEntry[]> {
  const params = new URLSearchParams();
  if (options.query?.trim()) params.set('q', options.query.trim());
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  const suffix = params.size ? `?${params.toString()}` : '';
  const response = await getApiClient().get<{ data: PatientDirectoryEntry[]; pagination: unknown }>(`/api/patients${suffix}`);
  // Handle both paginated response and direct array for backward compatibility
  if (Array.isArray(response)) {
    return response.filter((patient) => patient.content_available !== false);
  }
  return (response.data || []).filter((patient) => patient.content_available !== false);
}

/** A child in the directory, with the age in months the server computed. */
export interface PaediatricCaseloadEntry extends PatientDirectoryEntry {
  age_months: number;
}

/**
 * Every child the directory holds. The paediatrics page used to filter the
 * first 50 patients by date of birth in the browser; dates of birth are
 * encrypted, so the server filters and computes each age. `truncated` is true
 * when the scan stopped at its cap, so a partial caseload is never presented
 * as the whole.
 */
export async function getPaediatricCaseload(): Promise<{
  children: PaediatricCaseloadEntry[];
  truncated: boolean;
  unreadableCount: number;
}> {
  const response = await getApiClient().get<{
    data?: PaediatricCaseloadEntry[];
    truncated?: boolean;
    unreadable_count?: number;
  }>('/api/patients/paediatric-caseload', { keepEnvelope: true });
  return {
    children: (response.data ?? []).filter((child) => child.content_available !== false),
    truncated: Boolean(response.truncated),
    unreadableCount: response.unreadable_count ?? 0,
  };
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
  /**
   * Null when the patient did not give a date.
   *
   * The profile form marks both optional — only provider and policy number
   * carry an asterisk — and this being a bare `string` is why the page sent
   * `''`, which stored a policy "valid from ''". An empty string is a value;
   * an absent date is not.
   */
  valid_from?: string | null;
  valid_to?: string | null;
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

/** Ask the patient for access; the server identifies the authenticated provider. */
export async function requestPatientDocumentAccess(patientId: string, reason: string): Promise<{ request: PatientAccessRequest }> {
  return getApiClient().post(`/api/access/patient/${encodeURIComponent(patientId)}/requests`, { reason });
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
  guardian_user_id: string;
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
  guardian_user_id: string;
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

/** End a guardian relationship. */
/**
 * Change what a guardian may do for their ward (Admin; needs MFA step-up).
 *
 * `expires_at` is written as sent -- the server replaces it -- so pass the
 * relationship's current expiry to keep it.
 */
export async function updateGuardianPermissions(
  relationshipId: string,
  permissions: string[],
  expiresAt: string | null
): Promise<GuardianRelationship> {
  return getApiClient().put(`/api/guardians/${encodeURIComponent(relationshipId)}/permissions`, {
    permissions,
    expires_at: expiresAt,
  });
}

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
// Family History (Phase 14)
// ============================================================================

export async function createFamilyHistory(data: Requests.FamilyMedicalHistoryBody): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/family-history', data);
}

/** Add one relative without replacing the patient's existing family history. */
export async function appendFamilyHistoryMember(data: { patient_id: string; member: FamilyHistoryMember }): Promise<{ success: boolean; history: FamilyMedicalHistory }> {
  return getApiClient().post('/api/surgical/family-history/member', data);
}

export async function getFamilyHistory(patientId: string): Promise<FamilyMedicalHistory> {
  return getApiClient().get(`/api/surgical/family-history/${patientId}`);
}

/** The authenticated patient's own family history. */
export async function getMyFamilyHistory(): Promise<FamilyMedicalHistory> {
  return getApiClient().get('/api/clinical/family-history');
}

// ============================================================================
// Patient Satisfaction (Phase 19)
// ============================================================================

export async function createSatisfactionSurvey(
  data: CreateSatisfactionSurveyInput
): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/clinical/satisfaction-survey', data);
}

// ============================================================================
// Family Groups (Phase 22)
// ============================================================================

export async function createFamilyGroup(data: Requests.CreateFamilyGroupRequest): Promise<FamilyGroupCreateResult> {
  return getApiClient().post('/api/family/groups', data);
}

export async function addFamilyMember(
  groupId: string,
  data: Requests.AddFamilyMemberRequest
): Promise<{ success: boolean; message: string }> {
  return getApiClient().post(`/api/family/groups/${groupId}/members`, data);
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
// Medical ID preferences
// ============================================================================

export async function updateMedicalIdPreferences(
  patientId: string,
  data: unknown
): Promise<{ success: boolean; preferences: Record<string, unknown>; message: string }> {
  return getApiClient().post(`/api/medical-id/${patientId}/preferences`, data);
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

/** Fetch the patient's QR image using the authenticated API client. */
export async function getMedicalIdQr(patientId: string): Promise<{ qr_image_base64: string | null }> {
  return getApiClient().get(`/api/medical-id/${encodeURIComponent(patientId)}/qr`);
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

// ============================================================================
// National ID verification
// ============================================================================

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
