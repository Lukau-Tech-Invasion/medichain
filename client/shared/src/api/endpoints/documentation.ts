/**
 * MediChain API endpoints: Physician, surgical and specialty documentation, order sets and note templates.
 */

import type * as Requests from '../request-types.generated';
import { getApiClient } from '../client';
import type {
  AmaRegisterRow,
  AmaCreateResult,
  ClinicalCreateResult,
  ConsultCreateResult,
  DischargeSummary,
  HistoryAndPhysical,
  HpCreateResult,
  ImmunizationRecord,
  IncidentCreateResult,
  IncidentReport,
  InstructionsCreateResult,
  NoteCreateResult,
  OrderCreateResult,
  PreOpCreateResult,
  ProgressNote,
  SummaryCreateResult,
} from '../../types';
import { wrapListResponse } from './common';
import type { ListResponse } from './common';

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

export async function createConsult(data: Requests.CreateConsultRequest): Promise<ConsultCreateResult> {
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

// ============================================================================
// Surgical Documentation (Phase 9)
// ============================================================================

export async function createPreOp(data: Requests.CreatePreOpRequest): Promise<PreOpCreateResult> {
  return getApiClient().post('/api/surgical/pre-op', data);
}

export async function createOperativeNote(data: Requests.CreateOperativeNoteRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/operative-note', data);
}

export async function createPostOp(data: Requests.CreatePostOpNoteRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/post-op', data);
}

// ============================================================================
// Clinical Records (Specialty)
// ============================================================================

export async function createAMADischarge(data: unknown): Promise<AmaCreateResult> {
  return getApiClient().post('/api/clinical/ama', data);
}

export async function listAMADischarges(): Promise<AmaRegisterRow[]> {
  const response = await getApiClient().get<AmaRegisterRow[]>('/api/platform/list/ama-discharges');
  return response || [];
}

export async function createHistoryPhysical(data: Requests.CreateHpRequest): Promise<HpCreateResult> {
  return getApiClient().post('/api/clinical/hp', data);
}

/** Persist changes to an unsigned H&P draft; signed records require an addendum. */
export async function updateHistoryPhysicalDraft(hpId: string, data: Requests.CreateHpRequest): Promise<HpCreateResult> {
  return getApiClient().put(`/api/clinical/hp/${hpId}`, data);
}

/** Append an immutable amendment to a signed H&P. */
export async function addHistoryPhysicalAddendum(hpId: string, content: string): Promise<HpCreateResult> {
  return getApiClient().post(`/api/clinical/hp/${hpId}/addendum`, { content });
}

export async function listHistoryPhysicals(): Promise<HistoryAndPhysical[]> {
  return getApiClient().get('/api/clinical/hp');
}

// NOTE: no distinct "incident report" (plural) backend feature exists — the real
// endpoints are the singular `create_incident`/`get_incident` under `/api/emergency/incident`
// (see createIncident/getIncident above) plus an admin-wide list at `/api/platform/list/incidents`.
// Pointed at those real endpoints rather than the nonexistent `/api/clinical/incident-reports`.
/**
 * What the incident wizard submits. Mirrors `CreateIncidentRequest`.
 *
 * No id, reporter, timestamp or status: the server mints the first and takes
 * the rest from the session and the clock.
 */
export interface CreateIncidentReportRequest {
  type: string;
  severity: string;
  dateTime: string;
  location: string;
  department?: string;
  description: string;
  patientInvolved?: boolean;
  patientId?: string;
  staffInvolved?: string[];
  witnesses?: string[];
  immediateActions?: string;
}

export async function createIncidentReport(data: CreateIncidentReportRequest): Promise<IncidentCreateResult> {
  return getApiClient().post('/api/emergency/incident', data);
}

export async function listIncidentReports(): Promise<IncidentReport[]> {
  return getApiClient().get('/api/platform/list/incidents');
}

// ============================================================================
// Anesthesia (Phase 10)
// ============================================================================

export async function createAnesthesia(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/anesthesia', data);
}

// ============================================================================
// Immunization (Phase 13)
// ============================================================================

export async function createImmunization(data: Requests.CreateImmunizationRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/immunization', data);
}

/** The authenticated patient's own immunization history. */
export async function getMyImmunizations(): Promise<ImmunizationRecord[]> {
  const response = await getApiClient().get<{ immunizations: ImmunizationRecord[] }>(
    '/api/clinical/immunizations'
  );
  return response.immunizations;
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
/** Change a template its author (or an administrator) wrote. */
export async function updateNoteTemplate(
  templateId: string,
  data: CreateNoteTemplatePayload
): Promise<{ success: boolean; template: Record<string, unknown> }> {
  return getApiClient().put(`/api/templates/notes/${encodeURIComponent(templateId)}`, data);
}

export async function deactivateNoteTemplate(
  templateId: string
): Promise<{ success: boolean; template_id: string }> {
  return getApiClient().post(`/api/templates/notes/${encodeURIComponent(templateId)}/deactivate`, {});
}

// ============================================================================
// Immunization and consult lists
// ============================================================================

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

// ============================================================================
// Immunization and consult lists
// ============================================================================

/**
 * List all consultation notes
 */
export async function listConsults(): Promise<ListResponse<unknown>> {
  const items = await getApiClient().get<unknown[]>('/api/platform/list/consults');
  return wrapListResponse(items || []);
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

/** Create a SOAP note. Answers `{ note_id, ... }`. */
export async function createSoapNote(data: Requests.CreateSOAPNoteRequest): Promise<{ note_id?: string; success?: boolean }> {
  return getApiClient().post('/api/clinical/soap', data);
}

/** Every SOAP note on a patient's chart, newest first. */
export async function listPatientSoapNotes(patientId: string): Promise<StoredSoapNote[]> {
  const response = await getApiClient().get<{ notes?: StoredSoapNote[] } | StoredSoapNote[]>(
    `/api/clinical/patient/${encodeURIComponent(patientId)}/soap`
  );
  return Array.isArray(response) ? response : response.notes ?? [];
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
