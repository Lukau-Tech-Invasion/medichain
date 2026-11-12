/**
 * MediChain API endpoints: Sign-in, credentials, MFA, session assurance, roles and access logs.
 */

import { getApiClient } from '../client';
import type {
  AccessLogsResponse,
  AssignRoleRequest,
  AssignRoleResponse,
  CurrentUser,
  RevokeRoleRequest,
  RevokeRoleResponse,
  Role,
  User,
} from '../../types';

// ============================================================================
// Access Logs
// ============================================================================

/**
 * Fetch who has accessed a patient's record.
 *
 * @param patientId - The patient record id (e.g. `PAT-001`).
 * @param options - Optional 1-indexed `page` and page size `limit`.
 * @returns One page of access-log entries, newest first.
 */
export async function getAccessLogs(
  patientId: string,
  options?: { page?: number; limit?: number },
): Promise<AccessLogsResponse> {
  const params = new URLSearchParams();
  if (options?.page) params.set('page', String(options.page));
  if (options?.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  const id = encodeURIComponent(patientId);
  return getApiClient().get(`/api/access-logs/${id}${query ? `?${query}` : ''}`);
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
  userId: string,
  data: UpdateUserProfileRequest
): Promise<{ success: boolean; user_id: string; message: string }> {
  return getApiClient().put(`/api/users/${userId}`, data);
}

export async function assignRole(data: AssignRoleRequest): Promise<AssignRoleResponse> {
  return getApiClient().post('/api/roles/assign', data);
}

export async function revokeRole(data: RevokeRoleRequest): Promise<RevokeRoleResponse> {
  return getApiClient().delete('/api/roles/revoke', data);
}

// ============================================================================
// Sign-in and credentials
// ============================================================================

/** A seeded demo account the sign-in screen offers as a one-click login. */
export interface DemoCredential {
  login_id: string;
  password: string;
  name: string;
  role: string;
}

/**
 * The seeded demo accounts, in a demo deployment only.
 *
 * Outside one the server answers 403 `DEV_MODE_REQUIRED`, which the typed
 * client throws; callers treat that as "no demo accounts", not as an error.
 */
export async function getDemoCredentials(): Promise<{ success: boolean; credentials: DemoCredential[] }> {
  return getApiClient().get('/api/auth/demo-credentials');
}

/** The account a sign-in or activation answered for. */
export interface SignedInUser {
  user_id: string;
  name: string;
  role: Role;
  /** Set for a patient account: the record the account is linked to. */
  linked_patient_id?: string | null;
}

/**
 * The body `POST /api/auth/login` and `POST /api/auth/credentials/redeem`
 * answer with. The refresh token is not read from it: it travels as an
 * HttpOnly cookie the browser holds.
 */
export interface LoginResponse {
  success: boolean;
  /** Absent when `mfa_required` and no code was supplied. */
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  /** The account has an authenticator enrolled. */
  mfa: boolean;
  /** A one-time code is still needed before a session is issued. */
  mfa_required: boolean;
  user?: SignedInUser;
}

/**
 * Sign in with a login id (Employee ID for staff, username for patients) and a
 * password proof from `deriveAuthProof`. The password itself never travels.
 * `totp_code` is sent on the second attempt when the first answered
 * `mfa_required`.
 */
export async function login(body: {
  identifier: string;
  auth_proof: string;
  totp_code?: string;
}): Promise<LoginResponse> {
  return getApiClient().post('/api/auth/login', body);
}

/**
 * Turn a one-time activation or reset code into a password (and, for a
 * patient, a username). Answers like `login`, so the caller is signed in.
 *
 * Setting a password is the one time it travels: the server checks its
 * strength (422 with a `PASSWORD_*` code and a sentence to show) and derives
 * the sign-in proof itself. Signing in still sends only the proof.
 */
export async function redeemCredential(body: {
  identifier: string;
  code: string;
  password: string;
  username?: string;
}): Promise<LoginResponse> {
  return getApiClient().post('/api/auth/credentials/redeem', body);
}

/**
 * Change the signed-in person's password. Other sessions are ended. The
 * current password is proved, never sent; the new one is sent for its
 * strength check (see `redeemCredential`).
 */
export async function changePassword(body: {
  current_auth_proof: string;
  new_password: string;
}): Promise<{ success: boolean; message?: string }> {
  return getApiClient().post('/api/auth/credentials/change', body);
}

/**
 * Create a staff account (Admin; needs a step-up). The account stays
 * `pending` until an administrator activates it, and the one-time credential
 * code is shown once: nothing can show it again.
 */
export async function registerStaff(body: {
  name: string;
  role: string;
  login_id: string;
  email?: string;
}): Promise<{
  success: boolean;
  user_id: string;
  status: string;
  activation_required: boolean;
  credential_code: string;
  credential_expires_at: string;
}> {
  return getApiClient().post('/api/auth/register', body);
}

/** A one-time code an administrator hands over; shown once, never stored. */
export interface CredentialGrant {
  credential_code: string;
  expires_at: string;
}

/** Issue a fresh credential code for a user who cannot sign in (Admin; step-up). */
export async function resetUserCredential(userId: string): Promise<CredentialGrant> {
  return getApiClient().post(`/api/admin/users/${encodeURIComponent(userId)}/credential-reset`, {});
}

/** Remove a user's authenticator, for someone who lost their device (Admin; step-up). */
export async function resetUserMfa(userId: string): Promise<{ success: boolean }> {
  return getApiClient().post(`/api/admin/users/${encodeURIComponent(userId)}/mfa-reset`, {});
}

/** Issue a new activation code for a registered patient who has not activated yet. */
export async function reissuePatientActivationCode(patientId: string): Promise<{
  success: boolean;
  activation_code: string;
  activation_expires_at: string;
}> {
  return getApiClient().post(`/api/patients/${encodeURIComponent(patientId)}/activation-code`, {});
}

/**
 * Fetch the signed-in user's own identity in full: user id, role, department,
 * specialty, licence, and the server's view of what their role permits.
 *
 * This is the authoritative provider context. Screens read from it instead of
 * asking the clinician to re-enter details the session already holds.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  return getApiClient().get('/api/auth/me');
}

/** Set the signed-in clinician's profile picture, or clear it with `null`. */
export async function setMyAvatar(
  avatar: string | null
): Promise<{ success: boolean; updatedAt?: string }> {
  return getApiClient().post('/api/users/me/avatar', { avatar });
}

/** One clinician's profile picture, or `null` when they have not set one. */
export async function getUserAvatar(
  userId: string
): Promise<{ success: boolean; avatar: string | null }> {
  return getApiClient().get(`/api/users/${encodeURIComponent(userId)}/avatar`);
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

/**
 * Which factor completes a transaction authorization: the current TOTP code, or
 * the account password when no authenticator is enrolled.
 */
export type RequiredFactor = 'totp' | 'password';

/** What a Class C authorization is bound to: the exact request it will permit. */
export interface TransactionIntentRequest {
  action: string;
  method: string;
  path: string;
  /** SHA-256 hex of the exact body bytes to be sent. Omit for a request with no body. */
  body_digest?: string;
  resource_id?: string;
  expected_state?: string;
  idempotency_key?: string;
}

/** A server-issued, single-use challenge bound to this session and one request. */
export interface TransactionChallenge {
  challenge_id: string;
  expires_in_secs: number;
  required_factor: RequiredFactor;
}

/**
 * Begin a Class C authorization for one exact mutation (ADR-0008).
 *
 * The server may answer with the challenge at the top level or under
 * `challenge`; both are accepted so the client does not depend on the wrapper.
 */
export async function requestTransactionChallenge(
  intent: TransactionIntentRequest
): Promise<TransactionChallenge> {
  const body = await getApiClient().post<TransactionChallenge & { challenge?: TransactionChallenge }>(
    '/api/auth/transaction/challenge',
    intent
  );
  return body.challenge ?? body;
}

/**
 * Complete a Class C challenge with a current TOTP code, or the password proof
 * when `required_factor` is `password`. Send exactly one of `code` / `auth_proof`.
 */
export async function verifyTransactionChallenge(body: {
  challenge_id: string;
  code?: string;
  auth_proof?: string;
}): Promise<{ success: boolean; authorization_id?: string }> {
  return getApiClient().post('/api/auth/transaction/verify', body);
}
