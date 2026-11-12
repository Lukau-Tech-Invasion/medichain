/**
 * MediChain API endpoints: Symptom checker and symptom tracking.
 */

import type * as Requests from '../request-types.generated';
import { getApiClient } from '../client';
import type {
  SymptomCheckCreateResult,
  SymptomCheckSession,
} from '../../types';

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

export async function startSymptomCheck(data: Requests.StartSymptomCheckRequest): Promise<SymptomCheckCreateResult> {
  return getApiClient().post('/api/symptoms/start', data);
}

export async function submitSymptomAnswers(
  sessionId: string,
  data: Requests.SubmitSymptomAnswersRequest
): Promise<{ success: boolean; session: SymptomCheckSession }> {
  return getApiClient().post(`/api/symptoms/${sessionId}/answers`, data);
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
