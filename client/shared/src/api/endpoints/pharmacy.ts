/**
 * MediChain API endpoints: Prescribing, refills, reminders, interactions and pharmacy safety.
 */

import type * as Requests from '../request-types.generated';
import { getApiClient } from '../client';
import type {
  AdherenceLogCreateResult,
  EPrescriptionCreateResult,
  ElectronicPrescription,
  GrantBoundEmergencyAccessRequest,
  GrantBoundEmergencyAccessResponse,
  MedicationReminderCreateResult,
} from '../../types';

// ============================================================================
// Pharmacy safety decisions
// ============================================================================

/**
 * Record what a pharmacist did about an allergy alert.
 *
 * `refused_to_dispense` or `prescriber_queried`. Both need a reason: a refusal
 * nobody can account for is not a clinical decision, and the prescriber and
 * the patient both have to be able to find out why a medicine did not arrive.
 */
export async function recordPharmacyDecision(body: {
  patientId: string;
  allergen: string;
  decision: 'refused_to_dispense' | 'prescriber_queried';
  reason: string;
  prescriptionId?: string | null;
  prescriberId?: string | null;
}): Promise<{ success: boolean; id: string; decision: string }> {
  return getApiClient().post('/api/pharmacy/allergy-decisions', body);
}

/**
 * The controlled-substance dispensing register for a period.
 *
 * Bounds are ISO dates and both are optional; an absent bound means no bound
 * on that side, rather than a silent default period that would be wrong for
 * anyone asking about a different one.
 */
export async function controlledSubstanceReport(range: {
  from?: string;
  to?: string;
} = {}): Promise<{
  success: boolean;
  count: number;
  produced_at: string;
  events: Array<Record<string, unknown>>;
}> {
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const query = params.toString();
  return getApiClient().get(
    `/api/pharmacy/controlled-substances/report${query ? `?${query}` : ''}`
  );
}

// ============================================================================
// Barcode scanner preferences
// ============================================================================

export interface ScannerSettings {
  autoScan: boolean;
  vibrate: boolean;
  sound: boolean;
  continuous: boolean;
  /** Governs whether a scan is written to this clinician's durable history. */
  saveHistory: boolean;
}

/** Scans this clinician has made, newest first, as persisted server-side. */
export async function getMyBarcodeScans(): Promise<unknown[]> {
  const response = await getApiClient().get<unknown>('/api/barcode/scans/my');
  return Array.isArray(response) ? response : [];
}
export async function getScannerSettings(): Promise<{
  success: boolean;
  settings: ScannerSettings;
  historyClearedAt: string | null;
}> {
  return getApiClient().get('/api/barcode/settings');
}

export async function updateScannerSettings(
  settings: ScannerSettings
): Promise<{ success: boolean; settings: ScannerSettings }> {
  return getApiClient().put('/api/barcode/settings', settings);
}

/**
 * Clear this clinician's scan history view.
 *
 * Deletes nothing: a barcode scan is the record of somebody handling a
 * specimen, and ADR-0005 defers irreversible deletion. The list starts again
 * from now and the scans remain for anyone asking who handled what.
 */
export async function clearScanHistory(): Promise<{
  success: boolean;
  historyClearedAt: string;
  message: string;
}> {
  return getApiClient().post('/api/barcode/history/clear', {});
}

/** Request a context- and device-bound emergency summary grant. */
export async function grantBoundEmergencyAccess(
  data: GrantBoundEmergencyAccessRequest
): Promise<GrantBoundEmergencyAccessResponse> {
  return getApiClient().post('/api/emergency/access', data);
}

// ============================================================================
// E-Prescribing (Phase 16)
// ============================================================================

export async function createEPrescription(data: unknown): Promise<EPrescriptionCreateResult> {
  return getApiClient().post('/api/e-prescriptions', data);
}

export async function signEPrescription(
  prescriptionId: string,
  data: unknown
): Promise<{ success: boolean; prescription_id: string; status: string; signed_at: number; message: string }> {
  return getApiClient().post(`/api/e-prescriptions/${prescriptionId}/sign`, data);
}

export async function transmitEPrescription(
  prescriptionId: string
): Promise<{ success: boolean; prescription_id: string; status: string; transmitted_at: number; pharmacy: string; message: string }> {
  return getApiClient().post(`/api/e-prescriptions/${prescriptionId}/transmit`, {});
}

export async function getPatientEPrescriptions(
  patientId: string
): Promise<{ success: boolean; patient_id: string; prescriptions: ElectronicPrescription[]; count: number }> {
  return getApiClient().get(`/api/e-prescriptions/patient/${patientId}`);
}

// ============================================================================
// Prescription refill requests (WP7.1)
// ============================================================================

/** Where a refill request is in its life. */
export type RefillRequestStatus = 'requested' | 'approved' | 'denied' | 'cancelled';

/** A refill request as `/api/.../refill-requests` returns it. */
export interface RefillRequest {
  id: string;
  prescription_id: string;
  patient_id: string;
  medication_name: string;
  status: RefillRequestStatus;
  patient_note: string | null;
  /** Set when a doctor denied the request; the patient reads it. */
  denial_reason: string | null;
  decided_at: string | null;
  /** The new, unsigned prescription an approval created. */
  new_prescription_id: string | null;
  created_at: string;
}

/** Longest note a patient may attach (mirrors the API's limit). */
export const REFILL_NOTE_MAX_CHARS = 500;
/** Shortest and longest denial reason the API accepts. */
export const REFILL_DENIAL_REASON_MIN_CHARS = 10;
export const REFILL_DENIAL_REASON_MAX_CHARS = 500;

/** Ask for a refill of one of the caller's own prescriptions. */
export async function requestPrescriptionRefill(
  prescriptionId: string,
  note?: string
): Promise<{ success: boolean; request: RefillRequest }> {
  return getApiClient().post(
    `/api/e-prescriptions/${encodeURIComponent(prescriptionId)}/refill-requests`,
    { note: note?.trim() ? note.trim() : null }
  );
}

/** A patient's refill requests, newest first. */
export async function getPatientRefillRequests(
  patientId: string
): Promise<{ success: boolean; requests: RefillRequest[] }> {
  return getApiClient().get(`/api/patients/${encodeURIComponent(patientId)}/refill-requests`);
}

/** Withdraw one of the caller's own open refill requests. */
export async function cancelRefillRequest(
  requestId: string
): Promise<{ success: boolean; request: RefillRequest }> {
  return getApiClient().post(`/api/refill-requests/${encodeURIComponent(requestId)}/cancel`, {});
}

/** Open refill requests on the signed-in doctor's own prescriptions. */
export async function getRefillRequestQueue(): Promise<{ success: boolean; requests: RefillRequest[] }> {
  return getApiClient().get('/api/refill-requests/queue');
}

/** Approve a refill: returns the new, unsigned prescription's id to sign. */
export async function approveRefillRequest(
  requestId: string
): Promise<{ success: boolean; request: RefillRequest; new_prescription_id: string }> {
  return getApiClient().post(`/api/refill-requests/${encodeURIComponent(requestId)}/approve`, {});
}

/** Deny a refill with a reason the patient will read. */
export async function denyRefillRequest(
  requestId: string,
  reason: string
): Promise<{ success: boolean; request: RefillRequest }> {
  return getApiClient().post(`/api/refill-requests/${encodeURIComponent(requestId)}/deny`, {
    reason: reason.trim(),
  });
}

// ============================================================================
// Medication Reminders (Phase 20)
// ============================================================================

/** The frequencies `POST /api/reminders/medication` accepts. Anything else is refused. */
export type ReminderFrequency =
  | 'once'
  | 'daily'
  | 'twice_daily'
  | 'three_times_daily'
  | 'weekly'
  | 'as_needed';

export interface CreateMedicationReminderInput {
  patient_id: string;
  medication_name: string;
  dosage: string;
  frequency: ReminderFrequency | string;
  reminder_times: string[];
  start_date: string;
  end_date?: string;
  instructions?: string;
  /** The channels the scheduler will actually use. Omitted means push only. */
  push_notification?: boolean;
  sms?: boolean;
  email?: boolean;
}

/** One active medication reminder as returned by the medication-reminders API. */
export interface MedicationReminder {
  reminder_id: string;
  patient_id: string;
  medication_name: string;
  dosage: string;
  frequency: string;
  reminder_times: string[];
  start_date: string;
  end_date: string | null;
  instructions: string | null;
  active: boolean;
  created_at: number;
}

export async function createMedicationReminder(
  data: CreateMedicationReminderInput
): Promise<MedicationReminderCreateResult> {
  return getApiClient().post('/api/reminders/medication', data);
}

export async function getPatientReminders(
  patientId: string
): Promise<{ success: boolean; patient_id: string; reminders: MedicationReminder[]; count: number }> {
  return getApiClient().get(`/api/reminders/medication/${patientId}`);
}

/** What the patient did with the dose. Anything else is refused by the API. */
export type AdherenceAction = 'taken' | 'taken_late' | 'skipped' | 'snoozed' | 'missed';

export interface LogAdherenceInput {
  reminder_id: string;
  action: AdherenceAction;
  notes?: string;
}

/**
 * Record what happened to one scheduled dose.
 *
 * Typed because it was `unknown`, and `MedicationsPage` was sending
 * `{ patient_id, taken, taken_at }` — three fields the endpoint does not read
 * and none of the two it requires. Every call 400'd and the page swallowed it.
 */
export async function logMedicationAdherence(
  data: LogAdherenceInput
): Promise<AdherenceLogCreateResult> {
  // Queued when the device is offline. This is the case the offline story was
  // built for: a dose is taken at a time, and a patient with no signal must not
  // have to remember it until they next have one. The call still rejects with
  // `OfflineQueuedError`, so the page says "saved on this device, not yet sent"
  // rather than claiming the server has it.
  return getApiClient().post('/api/reminders/adherence', data, {
    queueWhenOffline: {
      category: 'medications',
      description: `Medication dose: ${data.action}`,
    },
  });
}

/** One logged dose, as `GET /api/reminders/adherence/{patient_id}` returns it. */
export interface AdherenceLog {
  id: string;
  patient_id: string;
  reminder_id: string | null;
  medication_name: string;
  action_taken: AdherenceAction | string;
  actual_time: string | null;
  reported_by: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * The doses a patient has logged.
 *
 * The write half of this has existed since adherence logging was built and had
 * no reader at all — the repository's four read methods had zero callers, so a
 * patient ticking off doses filled a table nothing could open.
 */
export async function getPatientAdherence(
  patientId: string
): Promise<{ success: boolean; patient_id: string; logs: AdherenceLog[]; count: number }> {
  return getApiClient().get(`/api/reminders/adherence/${patientId}`);
}

export async function deleteMedicationReminder(reminderId: string): Promise<{ success: boolean; message: string }> {
  return getApiClient().delete(`/api/reminders/medication/${reminderId}`);
}

// ============================================================================
// Drug Interactions (Phase 21)
// ============================================================================

/** One drug-drug interaction, as `clinical::DrugInteraction` serialises it. */
export interface DrugInteractionFinding {
  drug_a: string;
  drug_b: string;
  severity: 'None' | 'Minor' | 'Moderate' | 'Major' | 'Contraindicated';
  description: string;
  clinical_effects: string;
  management: string;
  evidence_level: string;
  source: string;
}

/** A prescribed medication that matches one of the patient's recorded allergies. */
export interface AllergyAlert {
  type: 'allergy';
  medication: string;
  allergen: string;
  severity: string | null;
  reaction: string | null;
  /**
   * Set when the medication does not name the allergen but belongs to its
   * drug class -- amoxicillin under a penicillin allergy. Null for a direct
   * match.
   */
  drug_class: string | null;
}

export interface DrugInteractionCheck {
  success: boolean;
  /** Null for a check run without a patient: nothing is filed. */
  check_id: string | null;
  patient_id: string | null;
  medications_checked: number;
  interactions_found: number;
  has_critical: boolean;
  interactions: DrugInteractionFinding[];
  allergy_alerts: AllergyAlert[];
  /** What was actually screened, so silence is never read as safety. */
  screened: { drug_drug: boolean; allergies: boolean; conditions: boolean };
  recommendation: string;
}

export async function checkDrugInteractions(data: Requests.CheckDrugInteractionsRequest): Promise<DrugInteractionCheck> {
  return getApiClient().post('/api/interactions/check', data);
}

// ============================================================================
// Barcode scanning
// ============================================================================

export async function scanBarcode(data: unknown): Promise<{
  success: boolean;
  barcode_value: string;
  entity_info: Record<string, unknown>;
  location: string | null;
  scanned_at: number;
}> {
  return getApiClient().post('/api/barcode/scan', data);
}

// ============================================================================
// Drug-interaction check history
// ============================================================================

/** One interaction found by a filed check, as the server stored it. */
export interface StoredDrugInteraction {
  drug_a: string;
  drug_b: string;
  severity: 'None' | 'Minor' | 'Moderate' | 'Major' | 'Contraindicated';
  description: string;
}

/** A drug-interaction check filed to a patient's chart. */
export interface StoredDrugInteractionCheck {
  result_id: string;
  patient_id: string;
  /** Unix seconds. */
  checked_at: number;
  new_medication: string;
  /** Absent on checks filed before the full list was kept. */
  medications_checked?: string[];
  interactions: StoredDrugInteraction[];
  overall_severity: string;
  safe_to_prescribe: boolean;
  checked_by: string;
}

/** The checks filed for one patient, newest first (clinicians). */
export async function getDrugInteractionHistory(
  patientId: string
): Promise<{ success: boolean; checks: StoredDrugInteractionCheck[]; count: number }> {
  return getApiClient().get(`/api/interactions/history/${encodeURIComponent(patientId)}`);
}

/** The patient register by recorded gender (administrators). */
export async function getPatientPopulation(): Promise<{
  total_population: number;
  /** Keyed by the recorded value; unrecorded genders have their own bucket. */
  gender_distribution: Record<string, number>;
}> {
  return getApiClient().get('/api/platform/analytics/patients');
}

/** A pharmacist's recorded decision about an allergy alert. */
export interface PharmacyDecision {
  decision_id: string;
  patient_id: string;
  allergen: string;
  decision: 'refused_to_dispense' | 'prescriber_queried';
  reason: string;
  prescription_id: string | null;
  decided_by: string;
  decided_at: string;
}

/** Every allergy decision recorded about a patient (their team, or themselves). */
export async function getPatientPharmacyDecisions(
  patientId: string
): Promise<{ success: boolean; decisions: PharmacyDecision[]; count: number }> {
  return getApiClient().get(`/api/clinical/patient/${encodeURIComponent(patientId)}/pharmacy-decisions`);
}

/**
 * A QR code a patient scans to join a telehealth session in the patient app.
 * 503 JOIN_URL_UNCONFIGURED until the deployment sets MEDICHAIN_APP_URL.
 */
export async function getTelehealthJoinQr(
  sessionId: string
): Promise<{ success: boolean; session_id: string; join_url: string; qr_png_base64: string }> {
  return getApiClient().get(`/api/telehealth/sessions/${encodeURIComponent(sessionId)}/qr`);
}
