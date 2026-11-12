/**
 * MediChain API endpoints: Medical records, PDF export and consent forms.
 */

import { getApiClient } from '../client';
import type {
  DownloadMedicalRecordRequest,
  DownloadMedicalRecordResponse,
  MedicalRecordReference,
  UploadMedicalRecordRequest,
  UploadMedicalRecordResponse,
} from '../../types';

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
  const filename = (doc.filename ?? 'medichain-document').replace(/\.pdf$/i, '');
  // Through the client, so the export carries the session, refreshes an
  // expired token, and sends the Idempotency-Key the middleware requires of a
  // keyed-subject POST -- all of which a hand-built `fetch` here had to
  // reproduce, and a failure surfaced as "PDF export failed: 401".
  const { blob } = await getApiClient().postBlob('/api/pdf/document', { ...doc, filename });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ============================================================================
// Medical Records (IPFS)
// ============================================================================

export async function uploadMedicalRecord(
  data: UploadMedicalRecordRequest,
  operationKey?: string
): Promise<UploadMedicalRecordResponse> {
  return getApiClient().post('/api/records/upload', data,
    operationKey ? { headers: { 'Idempotency-Key': operationKey } } : undefined);
}

export async function downloadMedicalRecord(
  data: DownloadMedicalRecordRequest
): Promise<DownloadMedicalRecordResponse> {
  return getApiClient().post('/api/records/download', data);
}

/**
 * A stored document's decrypted bytes, and the content type the server gave.
 *
 * `contentHash` is the record's IPFS content id -- or, for the synthetic
 * records the patient pages build (`lab-...`, `rx-...`), the id the download
 * handler resolves to the stored JSON record.
 */
export async function downloadRecordContent(
  contentHash: string,
  patientId?: string,
): Promise<{ blob: Blob; contentType: string }> {
  return getApiClient().getBlob(`/api/records/${encodeURIComponent(contentHash)}/download`, { patientId });
}

/**
 * The patient-scoped document reads in `api/src/handlers/patient_documents.rs`
 * (CLAUDE.md rule 10). Each answers an envelope named for what it holds --
 * `{ history_physicals }`, `{ summaries, instructions }`, `{ orders, reports }`.
 */
export type PatientDocumentKind =
  | 'soap'
  | 'history-physicals'
  | 'progress-notes'
  | 'wounds'
  | 'discharges'
  | 'imaging'
  | 'pathology'
  | 'consults'
  | 'care-plans'
  | 'blood'
  | 'procedures'
  | 'ama-discharges'
  | 'ems-handoffs'
  | 'medication-administrations'
  | 'emergency-care';

/**
 * One of a patient's document collections, with its envelope intact.
 *
 * `keepEnvelope` matters: the imaging read returns `orders` and `reports`
 * side by side, and the client's default unwrapping would hand back the
 * orders alone and discard every report.
 */
export async function getPatientDocuments(
  patientId: string,
  kind: PatientDocumentKind
): Promise<Record<string, unknown>> {
  return getApiClient().get(PATIENT_DOCUMENT_PATHS[kind](encodeURIComponent(patientId)), {
    keepEnvelope: true,
  });
}

/** Every section of a patient's record in one read (WP11), each paged. */
export interface RecordsSummary {
  patient_id: string;
  page: number;
  per_page: number;
  /** Each section as its own endpoint returns it, keyed by that endpoint's last path segment. */
  sections: Record<string, Record<string, unknown>>;
  /** Sections that could not be read: show the record as partial, never as empty. */
  unavailable: string[];
}

/** A patient's record sections in one request (WP11). */
export async function getRecordsSummary(patientId: string, page = 0, perPage?: number): Promise<RecordsSummary> {
  const query = new URLSearchParams({ page: String(page) });
  if (perPage !== undefined) query.set('per_page', String(perPage));
  return getApiClient().get(`/api/patients/${encodeURIComponent(patientId)}/records-summary?${query}`, {
    keepEnvelope: true,
  });
}

/** Each path spelled out, so the route-drift gate can check it against the API. */
const PATIENT_DOCUMENT_PATHS: Record<PatientDocumentKind, (id: string) => string> = {
  soap: (id) => `/api/clinical/patient/${id}/soap`,
  'history-physicals': (id) => `/api/clinical/patient/${id}/history-physicals`,
  'progress-notes': (id) => `/api/clinical/patient/${id}/progress-notes`,
  wounds: (id) => `/api/clinical/patient/${id}/wounds`,
  discharges: (id) => `/api/clinical/patient/${id}/discharges`,
  imaging: (id) => `/api/clinical/patient/${id}/imaging`,
  pathology: (id) => `/api/clinical/patient/${id}/pathology`,
  consults: (id) => `/api/clinical/patient/${id}/consults`,
  'care-plans': (id) => `/api/clinical/patient/${id}/care-plans`,
  blood: (id) => `/api/clinical/patient/${id}/blood`,
  procedures: (id) => `/api/clinical/patient/${id}/procedures`,
  'ama-discharges': (id) => `/api/clinical/patient/${id}/ama-discharges`,
  'ems-handoffs': (id) => `/api/clinical/patient/${id}/ems-handoffs`,
  'medication-administrations': (id) => `/api/clinical/patient/${id}/medication-administrations`,
  'emergency-care': (id) => `/api/clinical/patient/${id}/emergency-care`,
};

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
  /**
   * The patient's decision. Required: the server refuses a consent that does
   * not say (CONSENT_DECISION_REQUIRED), and without it the Sign button failed.
   */
  consent_given: boolean;
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
/** The consent type and wording version for research participation (WP7.4). */
export const RESEARCH_CONSENT_TYPE = 'CONSENT-RESEARCH';
export const RESEARCH_CONSENT_VERSION = 'research-consent-v1';

/** A patient's current research consent, as the app shows it. */
export interface ResearchConsent {
  consentId: string;
  /** Unix seconds. */
  signedAt: number;
  version: string | null;
}

/** The patient's active research consent, or `null` when they have none. */
export async function getResearchConsent(patientId: string): Promise<ResearchConsent | null> {
  const body = await getPatientConsents(patientId);
  const active = (body.consents as Array<Record<string, unknown>>)
    .filter((c) => c.consent_type === RESEARCH_CONSENT_TYPE && c.status === 'granted' && c.revoked !== true)
    .sort((a, b) => Number(b.signed_at) - Number(a.signed_at))[0];
  return active
    ? { consentId: String(active.consent_id), signedAt: Number(active.signed_at), version: (active.version as string | null) ?? null }
    : null;
}

/** Give research consent (POPIA s11(1)(a) and s27(1)(a): the patient's own consent). */
export async function giveResearchConsent(patientId: string): Promise<{ success: boolean; consent_id: string }> {
  return getApiClient().post('/api/consent/sign', {
    type_id: RESEARCH_CONSENT_TYPE,
    patient_id: patientId,
    consent_given: true,
    popia_section_11_basis: 'consent',
    special_information_basis: 'consent',
    privacy_notice_version: RESEARCH_CONSENT_VERSION,
  });
}
