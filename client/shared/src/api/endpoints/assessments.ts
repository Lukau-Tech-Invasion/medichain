/**
 * MediChain API endpoints: Specialised assessments, procedures and specialty populations.
 */

import { getApiClient } from '../client';
import type {
  AssessFamilyHistoryRequest,
  AssessFamilyHistoryResult,
  AssessmentCreateResult,
  BurnCreateResult,
  CreateBurnRequest,
  CreateMciRequest,
  MciCreateResult,
  RecordCreateResult,
} from '../../types';

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

/** Read the patient's stored burn history; authority is enforced by the API. */
export async function getBurnForPatient(patientId: string): Promise<{ assessments: Array<{
  id: string; assessment_datetime: string; mechanism_of_injury: string;
  burn_agent?: string; tbsa_percentage: string | number; severity?: string; notes?: string;
}> }> {
  return getApiClient().get(`/api/clinical/burn/patient/${encodeURIComponent(patientId)}`);
}

export async function createBurn(data: CreateBurnRequest): Promise<BurnCreateResult> {
  return getApiClient().post('/api/clinical/burn', data);
}

/** Save an assessment, reusing a caller key when retrying the same unchanged draft. */
export async function createPsych(data: unknown, operationKey?: string): Promise<AssessmentCreateResult> {
  return getApiClient().post('/api/clinical/psych', data,
    operationKey ? { headers: { 'Idempotency-Key': operationKey } } : undefined);
}

export async function getPsychForPatient(patientId: string): Promise<{ assessments: unknown[] }> {
  return getApiClient().get(`/api/clinical/psych/patient/${patientId}`);
}

export async function createTox(data: unknown): Promise<AssessmentCreateResult> {
  return getApiClient().post('/api/clinical/tox', data);
}

/** Read saved toxicology records for the selected, authorised patient. */
export async function getToxForPatient(patientId: string): Promise<{ assessments: unknown[] }> {
  return getApiClient().get(`/api/clinical/tox/patient/${encodeURIComponent(patientId)}`);
}

export async function createMci(data: CreateMciRequest): Promise<MciCreateResult> {
  return getApiClient().post('/api/clinical/mci', data);
}

// ============================================================================
// Procedures (Phase 5)
// ============================================================================

export async function createIntubation(data: unknown): Promise<RecordCreateResult> {
  return getApiClient().post('/api/clinical/intubation', data);
}

export async function createLaceration(data: unknown): Promise<RecordCreateResult> {
  return getApiClient().post('/api/clinical/laceration', data);
}

export async function createSplint(data: unknown): Promise<RecordCreateResult> {
  return getApiClient().post('/api/clinical/splint', data);
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
export async function listPedsForPatient(patientId: string, page = 1): Promise<unknown[]> {
  // `ApiClient` unwraps a recognised `{items: [...]}` envelope, so this
  // resolves to the bare array. Reading `.items` off the result returned an
  // empty list for every child who HAD growth measurements, and was correct
  // only while the list was empty -- which is how it went unnoticed.
  const response = await getApiClient().get<unknown[] | { items?: unknown[] } | null>(
    `/api/clinical/peds/patient/${encodeURIComponent(patientId)}${page > 1 ? `?page=${page}&limit=100` : ''}`,
  );
  if (Array.isArray(response)) return response;
  return response?.items ?? [];
}

/** Submit a pediatric draft with an optional stable key for unchanged retries. */
export async function createPeds(data: unknown, operationKey?: string): Promise<AssessmentCreateResult> {
  return getApiClient().post('/api/clinical/peds', data,
    operationKey ? { headers: { 'Idempotency-Key': operationKey } } : undefined);
}

export async function createOb(data: unknown): Promise<AssessmentCreateResult> {
  return getApiClient().post('/api/clinical/ob', data);
}
