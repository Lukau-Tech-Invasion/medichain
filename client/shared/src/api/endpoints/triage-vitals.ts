/**
 * MediChain API endpoints: Triage, vital signs and GCS.
 */

import { getApiClient } from '../client';
import type {
  GcsAssessmentRecord,
} from '../../types';

// ============================================================================
// Clinical Documentation
// ============================================================================

/**
 * Create a triage assessment
 */
/** The triage queue, highest acuity first. Answers `{ queue, total }`. */
export async function getTriageQueue(): Promise<unknown[]> {
  const response = await getApiClient().get<{ queue?: unknown[] }>('/api/clinical/triage/queue');
  return response.queue ?? [];
}

/**
 * Vital signs as `TriageVitalSigns` names them. This type used to say
 * `systolic_bp`/`diastolic_bp`; the server reads `bp_systolic`/`bp_diastolic`,
 * so a caller trusting it would have had both pressures silently dropped.
 */
export interface TriageVitalSignsInput {
  heart_rate?: number | null;
  respiratory_rate?: number | null;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  temperature_celsius?: number | null;
  oxygen_saturation?: number | null;
  pain_scale?: number | null;
  gcs_score?: number | null;
  blood_glucose?: number | null;
  weight_kg?: number | null;
}

export async function createTriageAssessment(data: {
  patient_id: string;
  esi_level: number;
  chief_complaint: string;
  vital_signs: TriageVitalSignsInput;
  pain_scale?: number | null;
  notes?: string | null;
}): Promise<{
  success: boolean;
  assessment_id: string;
  esi_level: number;
  expected_wait: string;
  has_critical_vitals: boolean;
  message: string;
}> {
  return getApiClient().post('/api/clinical/triage', data);
}

/** A patient's vitals flowsheet, raw as the server stores it. */
export async function getVitalsFlowsheet(patientId: string): Promise<unknown> {
  return getApiClient().get(`/api/clinical/vitals/flowsheet/${encodeURIComponent(patientId)}`);
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
/** Consciousness on the ACVPU scale (NEWS2). */
export type Acvpu = 'alert' | 'new_confusion' | 'voice' | 'pain' | 'unresponsive';

/** The NEWS2 observations; any may be absent. */
export interface News2Inputs {
  respiratory_rate?: number | null;
  oxygen_saturation?: number | null;
  on_oxygen?: boolean | null;
  systolic_bp?: number | null;
  heart_rate?: number | null;
  consciousness?: Acvpu | null;
  temperature_celsius?: number | null;
}

/** The server's NEWS2 (`clinical_scoring::News2Score`): never computed in a page (rule 8). */
export interface News2Score {
  /** Null when nothing was recorded -- not zero (rule 12). */
  total: number | null;
  band: 'low' | 'low_medium' | 'medium' | 'high' | null;
  parameters_measured: number;
  complete: boolean;
  not_measured: string[];
}

/** NEWS2 for observations not yet saved: the vitals form's live score. Nothing is stored. */
export async function previewNews2(inputs: News2Inputs): Promise<News2Score> {
  return getApiClient().post('/api/clinical/scoring/news2', inputs);
}

/** `AddVitalSignsRequest`: a field nobody measured is null, never a plausible default. */
export async function addVitalSigns(data: {
  patient_id: string;
  heart_rate?: number | null;
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  respiratory_rate?: number | null;
  oxygen_saturation?: number | null;
  temperature_celsius?: number | null;
  pain_scale?: number | null;
  gcs_total?: number | null;
  blood_glucose?: number | null;
  weight_kg?: number | null;
  notes?: string | null;
  consciousness?: Acvpu | null;
  on_oxygen?: boolean | null;
}): Promise<{
  success: boolean;
  reading_id: string;
  mean_arterial_pressure: number | null;
  critical_alerts: string[];
  message: string;
  news2?: News2Score;
}> {
  return getApiClient().post('/api/clinical/vitals', data);
}

// ============================================================================
// Missing Clinical Endpoints (Task 1)
// ============================================================================

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

export async function getPatientGCS(
  patientId: string
): Promise<{ patient_id: string; assessments: GcsAssessmentRecord[]; total: number }> {
  return getApiClient().get(`/api/clinical/patient/${patientId}/gcs`);
}

// ============================================================================
// Triage and vitals read-back
// ============================================================================

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
