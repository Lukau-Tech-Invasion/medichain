/**
 * MediChain API endpoints: Federation, managed devices, security incidents, retention and research exports.
 */

import { getApiClient } from '../client';

// ============================================================================
// Federation identity contexts (Phase 1)
// ============================================================================

export type IdentityContextType = 'patient' | 'professional';

export interface IdentityContext {
  id: string;
  person_id: string;
  user_id: string;
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
// Security alerts & breach declaration — Admin (Phase 11.4)
// ============================================================================

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
// Research exports (WP7.4) — administrators
// ============================================================================

/** One de-identified record as an export releases it. */
export interface ResearchRecord {
  pseudonym: string;
  age_band: string;
  sex: 'female' | 'male' | 'unknown';
  conditions: string[];
}

/** An export run and its governance state. */
export interface ResearchExportRun {
  id: string;
  purpose: string;
  proposed_by: string;
  status: 'proposed' | 'approved' | 'executed';
  required_approvals: number;
  approved_by: string[];
  consent_version: string;
  created_at: string;
  executed_at?: string;
  included_count?: number;
  withheld_count?: number;
}

export async function listResearchExports(): Promise<{ success: boolean; exports: ResearchExportRun[]; configured: boolean }> {
  return getApiClient().get('/api/research/exports');
}

export async function proposeResearchExport(purpose: string): Promise<{ success: boolean; export: ResearchExportRun }> {
  return getApiClient().post('/api/research/exports', { purpose: purpose.trim() });
}

export async function approveResearchExport(id: string): Promise<{ success: boolean; export: ResearchExportRun }> {
  return getApiClient().post(`/api/research/exports/${encodeURIComponent(id)}/approve`, {});
}

export async function executeResearchExport(
  id: string
): Promise<{ success: boolean; export: ResearchExportRun; records: ResearchRecord[] }> {
  // keepEnvelope: the client otherwise unwraps any `records` array and the
  // run summary beside it would be lost. noRetry: an export runs once.
  return getApiClient().post(`/api/research/exports/${encodeURIComponent(id)}/execute`, {}, {
    noRetry: true,
    keepEnvelope: true,
  });
}

export async function revokeConsent(
  consentId: string,
  reason?: string
): Promise<{ success: boolean; message?: string }> {
  return getApiClient().post(`/api/consent/${consentId}/revoke`, { reason: reason || null });
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
// Security incidents (administrators)
// ============================================================================

/** Something the detectors raised, or a breach an administrator declared. */
export interface SecurityAlert {
  id: string;
  /** `failed_auth_burst`, `abnormal_access` or `breach_declared`. */
  kind: string;
  severity: string;
  /** The account implicated, when one is known. */
  actor: string | null;
  message: string;
  /** Set on a declared breach: POPIA's 72-hour notification deadline. */
  notify_deadline: string | null;
  created_at: string;
}

/** The most recent security alerts, newest first (administrators). */
export async function listSecurityAlerts(): Promise<{ success: boolean; alerts: SecurityAlert[]; count: number }> {
  return getApiClient().get('/api/admin/security/alerts');
}

/**
 * Declare a data breach. Starts the 72-hour POPIA clock and notifies the
 * security officer and regulator contacts that are configured; the counts say
 * how many were actually reached. Needs an MFA step-up.
 */
export async function declareBreach(body: { description: string; actor?: string }): Promise<{
  success: boolean;
  alert: SecurityAlert;
  officers_notified: number;
  regulator_emails_notified: number;
  message: string;
}> {
  return getApiClient().post('/api/admin/security/breach', body);
}
