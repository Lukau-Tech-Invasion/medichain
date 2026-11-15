/**
 * MediChain API endpoints: Lab results, laboratory quality records and trends.
 */

import type * as Requests from '../request-types.generated';
import { getApiClient } from '../client';
import type {
  CollectionCreateResult,
  FormCreateResult,
  LabResultSubmission,
  NotificationCreateResult,
  QcCreateResult,
  ReviewLabResultRequest,
  ReviewLabResultResponse,
  SubmitLabResultRequest,
  SubmitLabResultResponse,
} from '../../types';
import { wrapListResponse } from './common';
import type { ListResponse } from './common';

// ============================================================================
// Lab Results (Approval Workflow)
// ============================================================================

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
/** Map persisted enum spellings to UI statuses; reject unsupported workflow states. */
function normalizeLabSubmission(submission: LabResultSubmission): LabResultSubmission {
  const status = String(submission.status).toLowerCase();
  if (status !== 'pending' && status !== 'approved' && status !== 'rejected') {
    throw new Error('The laboratory result has an unsupported review status.');
  }
  return { ...submission, status };
}

export async function getPendingLabResults(): Promise<LabResultSubmission[]> {
  const submissions = await getApiClient().get<LabResultSubmission[]>('/api/lab/pending');
  return submissions.map(normalizeLabSubmission);
}

/**
 * Get all lab submissions with optional status filter (Doctor, Nurse, Admin)
 */
export async function getAllLabSubmissions(
  status?: 'pending' | 'approved' | 'rejected'
): Promise<LabResultSubmission[]> {
  const url = status ? `/api/lab/submissions?status=${status}` : '/api/lab/submissions';
  const submissions = await getApiClient().get<LabResultSubmission[]>(url);
  return submissions.map(normalizeLabSubmission);
}

/**
 * Review (approve/reject) a lab result submission (Doctor, Nurse, Admin)
 */
export async function reviewLabResult(
  data: ReviewLabResultRequest
): Promise<ReviewLabResultResponse> {
  const response = await getApiClient().post<Omit<ReviewLabResultResponse, 'status'> & {
    status?: ReviewLabResultResponse['status']; new_status?: string;
  }>('/api/lab/review', data);
  const status = response.status ?? (
    response.new_status === 'approve' ? 'approved' :
    response.new_status === 'reject' ? 'rejected' : undefined
  );
  if (status !== 'approved' && status !== 'rejected') {
    throw new Error('The laboratory review outcome could not be verified.');
  }
  return { ...response, status };
}

/** Why a laboratory refused a specimen; the values the server accepts. */
export type SpecimenRejectionCategory =
  | 'collection_error'
  | 'transport_error'
  | 'labeling_error'
  | 'specimen_quality'
  | 'container_issue'
  | 'other';

/**
 * Reject a collected specimen.
 *
 * The patient comes from the specimen and the author from the session; the
 * ordering provider is told separately, with `notifyRejectionOrderingProvider`,
 * and another sample is asked for with `requestSpecimenRecollection`.
 */
export async function rejectSpecimen(body: {
  specimen_id: string;
  rejection_reason: string;
  rejection_category: SpecimenRejectionCategory;
  detailed_notes?: string;
  recollection_required: boolean;
}): Promise<{ success: boolean; rejection_id: string }> {
  return getApiClient().post('/api/clinical/specimen-rejection', body);
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

/**
 * Withdraw a pending or approved verification. The earlier decision stays on
 * record; the server needs a reason, and only a party to the check (or an
 * administrator) may withdraw it.
 */
export async function revokePrescriptionVerification(prescriptionId: string, reason: string): Promise<void> {
  await getApiClient().post(
    `/api/e-prescriptions/${encodeURIComponent(prescriptionId)}/verification/revoke`,
    { reason }
  );
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

/** Stop asking for another sample. The server requires, and keeps, the reason. */
export async function cancelSpecimenRecollection(
  recollectionId: string,
  reason: string
): Promise<{ success: boolean; recollection: SpecimenRecollectionRequest }> {
  return getApiClient().post(
    `/api/clinical/specimen-recollection/${encodeURIComponent(recollectionId)}/cancel`,
    { reason }
  );
}

/**
 * Get lab submissions for a specific patient
 * Healthcare providers see all, patients only see approved
 */
export async function getPatientLabSubmissions(
  patientId: string
): Promise<LabResultSubmission[]> {
  const submissions = await getApiClient().get<LabResultSubmission[]>(`/api/lab/patient/${patientId}`);
  return submissions.map(normalizeLabSubmission);
}

// ============================================================================
// Laboratory (Phase 7)
// ============================================================================

export async function createSpecimen(data: Requests.CreateSpecimenRequest): Promise<CollectionCreateResult> {
  return getApiClient().post('/api/clinical/specimen', data);
}

export async function createChainOfCustody(data: Requests.CreateChainOfCustodyRequest): Promise<FormCreateResult> {
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

export async function createLabQc(data: Requests.CreateLabQcRequest): Promise<QcCreateResult> {
  return getApiClient().post('/api/clinical/lab-qc', data);
}

/** Persist a calibration run; the server assigns its ID, operator and time. */
export async function createLabCalibration(data: Requests.CreateLabCalibrationRequest): Promise<{ calibration: unknown }> {
  return getApiClient().post('/api/clinical/lab-calibrations', data);
}

/**
 * A critical result being reported. Mirrors `CreateCriticalValueRequest`.
 * Which bound was crossed is decided by the server, so it is not a field.
 */
export interface CreateCriticalValueRequest {
  patientId: string;
  analyte: string;
  testCode?: string;
  value: number;
  unit?: string;
  criticalLevel?: string;
  reportedBy?: string;
  reportedAt?: string;
  orderingProvider?: string;
  notificationStatus?: string;
  labPanelId?: string;
  patientName?: string;
  notificationId?: string;
}

export async function createCriticalValue(data: CreateCriticalValueRequest): Promise<NotificationCreateResult> {
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
  per_test_statistics: Record<string, unknown>;
}> {
  const url = testCode
    ? `/api/lab-trends/patient/${encodeURIComponent(patientId)}?test_code=${encodeURIComponent(testCode)}`
    : `/api/lab-trends/patient/${encodeURIComponent(patientId)}`;
  return getApiClient().get(url);
}

// ============================================================================
// Laboratory lists
// ============================================================================

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
