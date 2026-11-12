/**
 * MediChain API endpoints: Nursing documentation, the nursing worklist, wards and admissions.
 */

import type * as Requests from '../request-types.generated';
import { getApiClient } from '../client';
import type {
  ClinicalCreateResult,
  CreateFallRiskRequest,
  FallRiskAssessment,
  FallRiskCreateResult,
  IvSiteCreateResult,
  WoundAssessment,
} from '../../types';

// ============================================================================
// Nursing Documentation (Phase 3)
// ============================================================================

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

// The nursing ward board. The first two answer `{ records }`, which the client
// unwraps to the array; care plans answer `{ plans }`, which it does not.

/** Today's medication administration records for the ward. */
export async function listWardMar(): Promise<unknown[]> {
  return getApiClient().get('/api/nursing/mar');
}

/** Intake/output records for the ward. */
export async function listWardIntakeOutput(): Promise<unknown[]> {
  return getApiClient().get('/api/nursing/intake-output');
}

/** Nursing care plans for the ward. */
export async function listWardCarePlans(): Promise<unknown[]> {
  const response = await getApiClient().get<{ plans?: unknown[] }>('/api/nursing/care-plans');
  return response.plans ?? [];
}

/** One fluid entry (intake or output) against a patient's record for today. */
export async function recordWardFluid(data: {
  patient_id: string;
  entry_type: string;
  fluid_type: string;
  amount_ml: number;
  notes: string;
  time: string;
}): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/nursing/intake-output/record', data);
}

export async function createCarePlan(data: Requests.CreateCarePlanRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/care-plan', data);
}

export async function createWound(data: Requests.CreateWoundRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/wound', data);
}

export async function getWound(assessmentId: string): Promise<WoundAssessment> {
  return getApiClient().get(`/api/emergency/wound/${assessmentId}`);
}

export async function createIvSite(data: Requests.CreateIvSiteRequest): Promise<IvSiteCreateResult> {
  return getApiClient().post('/api/emergency/iv-site', data);
}

export async function createShiftHandoff(data: Requests.CreateShiftHandoffRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/handoff', data);
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

// ============================================================================
// Intake and output
// ============================================================================

// NOTE: same situation as incident reports above — real endpoints are `create_io`
// (`/api/emergency/io`, see createIo above) and the admin-wide list at
// `/api/platform/list/intake-output`, not the nonexistent `/api/clinical/intake-output`.
/**
 * One intake or output entry. Mirrors `CreateIoEntryRequest`; the server
 * normalises `amount` to millilitres from `unit`.
 */
export interface CreateIoEntryRequest {
  patientId: string;
  type: 'intake' | 'output';
  category: string;
  amount: number;
  unit?: 'ml' | 'cc' | 'oz';
  source?: string;
  notes?: string;
  shift?: string;
}

export async function createIntakeOutput(data: CreateIoEntryRequest): Promise<ClinicalCreateResult> {
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
// Intake and output read-back
// ============================================================================

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

// ============================================================================
// Nursing worklist
// ============================================================================

/** One outstanding nursing order from the physician order book. */
export interface NursingOrderTask {
  id: string;
  /** `vital_signs`, `wound_care` or `nursing_care`. */
  type: string;
  patient_id: string;
  frequency: string;
  /** Unix seconds: the last execution, or when a never-executed order was due. */
  last_done: number;
  priority: 'high' | 'medium' | 'low';
  instructions: string | null;
}

/** The nursing work outstanding on the order book (Nurse, Admin). */
export async function getNurseTasks(): Promise<{ success: boolean; tasks: NursingOrderTask[] }> {
  return getApiClient().get('/api/nurse/tasks');
}

// ============================================================================
// Wards, roster and admissions (UX plan Phase 5). Creating a ward and changing
// the roster are Class C: the client confirms them through the transaction
// authorizer automatically.
// ============================================================================

export type WardKind = 'general' | 'emergency' | 'icu' | 'maternity' | 'paediatric' | 'surgical' | 'other';

export interface Ward {
  id: string;
  facility_id: string;
  name: string;
  kind: WardKind;
  created_by: string;
  created_at: string;
  retired_at: string | null;
}

export interface WardShift {
  id: string;
  ward_id: string;
  clinician_id: string;
  starts_at: string;
  ends_at: string;
  assigned_by: string;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
}

export interface Admission {
  id: string;
  patient_id: string;
  ward_id: string;
  bed_label: string | null;
  admitted_at: string;
  admitted_by: string;
  discharged_at: string | null;
  discharged_by: string | null;
}

export async function listWards(): Promise<{ facility_id: string | null; wards: Ward[] }> {
  return getApiClient().get('/api/wards');
}

export async function createWard(body: { name: string; kind: WardKind; facility_id?: string }): Promise<{ ward: Ward }> {
  return getApiClient().post('/api/wards', body);
}

export async function listWardShifts(wardId: string): Promise<{ shifts: Array<{ shift: WardShift; clinician_name: string | null }> }> {
  return getApiClient().get(`/api/wards/${encodeURIComponent(wardId)}/shifts`);
}

export async function assignWardShift(wardId: string, body: { clinician_id: string; starts_at: string; ends_at: string }): Promise<{ shift: WardShift }> {
  return getApiClient().post(`/api/wards/${encodeURIComponent(wardId)}/shifts`, body);
}

export async function cancelWardShift(shiftId: string): Promise<{ shift: WardShift }> {
  return getApiClient().post(`/api/wards/shifts/${encodeURIComponent(shiftId)}/cancel`, {});
}

export async function admitPatient(body: { patient_id: string; ward_id: string; bed_label?: string }): Promise<{ admission: Admission }> {
  return getApiClient().post('/api/admissions', body);
}

export async function dischargeAdmission(admissionId: string): Promise<{ admission: Admission }> {
  return getApiClient().post(`/api/admissions/${encodeURIComponent(admissionId)}/discharge`, {});
}

export interface MyWardPatient {
  admission: Admission;
  full_name: string | null;
  date_of_birth: string | null;
  content_available: boolean;
}

/** Patients on the wards the caller is rostered on right now. */
export async function getMyWard(): Promise<{ shifts: WardShift[]; wards: Ward[]; patients: MyWardPatient[] }> {
  // Three lists side by side: the default unwrap would hand back `patients`
  // alone, and the panel read every reply as a failure.
  return getApiClient().get('/api/nursing/my-ward', { keepEnvelope: true });
}

/** The patient's own admissions (rule 10). */
export async function getPatientAdmissions(patientId: string): Promise<{ admissions: Array<{ admission: Admission; ward_name: string | null }> }> {
  return getApiClient().get(`/api/clinical/patient/${encodeURIComponent(patientId)}/admissions`);
}

/** What the caller recorded per patient since `since`, plus their ward roster (UX plan WP 5.6). */
export interface HandoffDraftPatient {
  patient_id: string;
  full_name: string | null;
  date_of_birth: string | null;
  bed_label: string | null;
  recorded: Array<{ resource_type: string; count: number; last_at: string | null }>;
  /**
   * `included`: `sbar` holds the drafted lines. `not_permitted`: the caller
   * has no treating link to this patient. `unavailable`: a record, or the
   * audit row the read needs, could not be read or written.
   */
  content: 'included' | 'not_permitted' | 'unavailable';
  sbar: HandoffDraftSbar | null;
}

/** Where a drafted handoff line came from (mockup c2's source chips). */
export type HandoffLineSource = 'vitals' | 'mar' | 'chart' | 'io' | 'note' | 'order';

export interface HandoffDraftLine {
  text: string;
  source: HandoffLineSource;
  /** When the source was recorded; null for standing chart facts. */
  at: string | null;
}

export interface HandoffDraftSbar {
  situation: HandoffDraftLine[];
  background: HandoffDraftLine[];
  assessment: HandoffDraftLine[];
  recommendation: HandoffDraftLine[];
}

export async function getShiftHandoffDraft(since?: string): Promise<{ since: string; patients: HandoffDraftPatient[] }> {
  const suffix = since ? `?since=${encodeURIComponent(since)}` : '';
  // `since` beside `patients`: the default unwrap returned the bare list, so
  // `.patients` was undefined and every draft read as empty.
  return getApiClient().get(`/api/shift-handoff/draft${suffix}`, { keepEnvelope: true });
}
