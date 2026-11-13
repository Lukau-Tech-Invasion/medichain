/**
 * MediChain API endpoints: Emergency access, protocols, the NFC capsule and ambulance handover.
 */

import type * as Requests from '../request-types.generated';
import { getApiClient } from '../client';
import type {
  CardiacCreateResult,
  CardiacEventListRow,
  ClinicalCreateResult,
  CodeBlueListRow,
  CreateCardiacRequest,
  GenerateNFCCardRequest,
  GenerateNFCCardResponse,
  NFCCardInfo,
  SealStatus,
  SepsisCreateResult,
  SepsisListRow,
  StrokeListRow,
  TraumaListRow,
} from '../../types';

// ============================================================================
// Emergency Access
// ============================================================================

// ============================================================================
// NFC Card Management
// ============================================================================

export async function generateNFCCard(
  data: GenerateNFCCardRequest
): Promise<GenerateNFCCardResponse> {
  return getApiClient().post('/api/nfc/generate', data);
}

/** Returns null when the selected patient has not yet been issued a card. */
export async function getCardInfo(patientId: string): Promise<NFCCardInfo | null> {
  return getApiClient().get(`/api/nfc/card/${patientId}`);
}

export async function suspendCard(cardHash: string): Promise<{ success: boolean; card_hash: string; message: string }> {
  return getApiClient().post('/api/nfc/suspend', { card_hash: cardHash });
}

export async function listNFCCards(): Promise<{ cards: NFCCardInfo[]; total: number }> {
  return getApiClient().get('/api/nfc/cards');
}

// ============================================================================
// Emergency Protocols (Phase 2)
// ============================================================================

export async function createCodeBlue(data: Requests.CreateCodeBlueRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/code-blue', data);
}

/** A patient's resuscitation events, newest first, as summary rows. */
export async function getPatientCodeBlues(patientId: string): Promise<CodeBlueListRow[]> {
  return getApiClient().get(`/api/emergency/code-blue/patient/${encodeURIComponent(patientId)}`);
}

export async function createTrauma(data: Requests.CreateTraumaRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/trauma', data);
}

export async function getPatientTraumas(patientId: string): Promise<TraumaListRow[]> {
  return getApiClient().get(`/api/emergency/trauma/patient/${encodeURIComponent(patientId)}`);
}

export async function createStroke(data: Requests.CreateStrokeRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/emergency/stroke', data);
}

export async function getPatientStrokes(patientId: string): Promise<StrokeListRow[]> {
  return getApiClient().get(`/api/emergency/stroke/patient/${encodeURIComponent(patientId)}`);
}

export async function createCardiac(
  data: CreateCardiacRequest,
): Promise<CardiacCreateResult> {
  return getApiClient().post('/api/emergency/cardiac', data);
}

export async function getPatientCardiacEvents(patientId: string): Promise<CardiacEventListRow[]> {
  return getApiClient().get(`/api/emergency/cardiac/patient/${encodeURIComponent(patientId)}`);
}

export async function createSepsis(data: Requests.CreateSepsisRequest): Promise<SepsisCreateResult> {
  return getApiClient().post('/api/emergency/sepsis', data);
}

export async function getPatientSepsisAssessments(patientId: string): Promise<SepsisListRow[]> {
  return getApiClient().get(`/api/emergency/sepsis/patient/${encodeURIComponent(patientId)}`);
}

// ============================================================================
// Emergency capsule (the three-second NFC payload)
// ============================================================================
//
// Four endpoints implementing the POPIA requirement that emergency values be
// versioned, revocable and access-logged. None had a client function, so a
// capsule could never be published from the product: the blood type a paramedic
// reads at a bedside was whatever had last been written by a script.
//
// No plaintext travels on these. The encrypted capsule body is excluded from
// the entity server-side; what comes back is commitments and metadata.

/** One published version of a patient's emergency directive. */
export interface EmergencyCapsuleVersion {
  patient_id: string;
  version: number;
  /** Hex SHA3-256 commitment of the capsule. */
  commitment: string;
  key_version: number;
  created_by: string;
  created_at: string;
  revoked_at?: string | null;
  revoked_by?: string | null;
  revocation_reason?: string | null;
  /** Where this version's commitment stands in the sealed audit stream. */
  seal_status: SealStatus;
}

/**
 * Which emergency directive is in force, and which ones used to be.
 *
 * Revoked versions are included: that a DNR directive was in force between two
 * dates is part of the clinical record.
 */
export async function getEmergencyCapsuleVersions(patientId: string): Promise<{
  success: boolean;
  patient_id: string;
  current: EmergencyCapsuleVersion | null;
  count: number;
  versions: EmergencyCapsuleVersion[];
}> {
  return getApiClient().get(`/api/patients/${encodeURIComponent(patientId)}/emergency-capsule`);
}

/**
 * Publish a new capsule version from the patient's stored emergency
 * information, and seal its commitment.
 *
 * Call this after any change to blood type, allergies, organ-donor status or a
 * DNR directive: the previous version stays on file but stops being current.
 * Until this runs, the card a paramedic taps still carries the old values.
 */
export async function publishEmergencyCapsule(patientId: string): Promise<{
  success: boolean;
  patient_id: string;
  version: number;
  commitment: string;
  /** Where the new version's commitment stands in the sealed audit stream. */
  seal_status: SealStatus;
}> {
  return getApiClient().post(
    `/api/patients/${encodeURIComponent(patientId)}/emergency-capsule`,
    {}
  );
}

/**
 * Revoke a capsule version. The row is retained — revocation is never deletion,
 * because a directive having been in force is itself part of the record.
 */
export async function revokeEmergencyCapsule(
  patientId: string,
  version: number,
  reason?: string
): Promise<{
  success: boolean;
  patient_id: string;
  version: number;
  revoked_at?: string | null;
  revoked_by?: string | null;
}> {
  return getApiClient().post(
    `/api/patients/${encodeURIComponent(patientId)}/emergency-capsule/revoke`,
    { version, reason: reason || null }
  );
}

/** One break-glass read of a patient's emergency capsule. */
export interface EmergencyCapsuleAccess {
  id: string;
  patient_id: string;
  /** `null` when no capsule existed to read — a failed break-glass attempt is still an access. */
  capsule_version: number | null;
  accessed_by: string;
  /** The emergency grant the read happened under. */
  grant_id: string | null;
  reason_code: string;
  reason_text: string | null;
  /** The fields actually returned to the caller, not the ones requested. */
  fields_revealed: string[];
  /** Whether the capsule still matched its sealed commitment at read time. */
  commitment_verified: boolean;
  accessed_at: string;
}

/**
 * Who read this patient's emergency data, why, and which fields were revealed.
 *
 * Readable by the patient themself as well as by clinical staff: a data subject
 * asking "who saw my emergency information" is the question this log exists to
 * answer, and a log only clinicians can read does not answer it.
 */
export async function getEmergencyCapsuleAccessLog(patientId: string): Promise<{
  success: boolean;
  patient_id: string;
  count: number;
  accesses: EmergencyCapsuleAccess[];
}> {
  return getApiClient().get(
    `/api/patients/${encodeURIComponent(patientId)}/emergency-capsule/access-log`
  );
}

// ============================================================================
// Emergency medication
// ============================================================================

/**
 * Record a dose given during an emergency, onto the patient's MAR for today.
 *
 * A field nobody filled is omitted rather than sent empty: the handler reads
 * each key independently, and `dose: ""` would store a blank dose against a
 * real administration.
 */
export async function administerEmergencyMedication(payload: {
  patient_id: string;
  medication_name: string;
  medication_id?: string;
  dose?: string;
  route?: string;
  notes?: string;
}): Promise<{ success: boolean; record_id: string }> {
  return getApiClient().post('/api/emergency/administer-med', payload);
}

// ============================================================================
// Emergency contact notification
// ============================================================================

/** One contact's delivery outcome. `suppressed`: SMS is not configured. */
export interface EmergencyContactNotification {
  name: string;
  phone: string;
  relationship: string;
  status: 'sent' | 'suppressed' | 'failed';
}

/**
 * Text the patient's emergency contacts. Honours the patient's own opt-out
 * (refused as NOTIFICATIONS_DISABLED) and answers 503 when nobody was reached,
 * so a clinician is never told the family knows when it does not.
 */
export async function notifyEmergencyContacts(
  patientId: string,
  body: { emergency_type?: string; location?: string; message?: string } = {}
): Promise<{
  success: boolean;
  notifications_sent: number;
  notifications_attempted: number;
  notifications: EmergencyContactNotification[];
  message: string;
}> {
  return getApiClient().post(`/api/medical-id/${encodeURIComponent(patientId)}/emergency-notify`, body);
}

// ============================================================================
// Ambulance handover
// ============================================================================

/** One set of observations the crew took; only the readings they took. */
export interface EmsVitals {
  taken_at?: string;
  systolic_bp?: number;
  diastolic_bp?: number;
  heart_rate?: number;
  respiratory_rate?: number;
  spo2?: number;
  temperature_c?: number;
  glucose_mmol?: number;
}

/** What the receiving clinician records of the crew's handover. */
export interface CreateEmsHandoffBody {
  patient_id?: string;
  ems_agency: string;
  unit_number?: string;
  crew?: string[];
  incident_type?: string;
  scene_address?: string;
  dispatch_time?: string;
  on_scene_time?: string;
  departed_scene_time?: string;
  chief_complaint: string;
  mechanism_of_injury?: string;
  gcs_on_scene?: number;
  vital_signs?: EmsVitals[];
  interventions?: string[];
  medications_given?: Array<{ name: string; dose?: string; route?: string; given_at?: string }>;
  sample?: Partial<Record<'signs_symptoms' | 'allergies' | 'medications' | 'past_history' | 'last_intake' | 'events', string>>;
  trauma_alert?: boolean;
  stroke_alert?: boolean;
  stemi_alert?: boolean;
  sepsis_alert?: boolean;
  notes?: string;
}

/** A stored handover: what was recorded, plus who received it and when. */
export interface EmsHandoff extends CreateEmsHandoffBody {
  id: string;
  received_by: string;
  received_at: string;
}

/** Record a crew's handover. The server assigns the id and the receiver. */
export async function createEmsHandoff(body: CreateEmsHandoffBody): Promise<{ success: boolean; id: string }> {
  return getApiClient().post('/api/emergency/ems-handoff', body);
}

/** Handovers received in the last `hours` (default 24): the arrivals board. */
export async function listRecentEmsHandoffs(
  hours?: number
): Promise<{ success: boolean; hours: number; count: number; handoffs: EmsHandoff[] }> {
  const query = hours ? `?hours=${hours}` : '';
  return getApiClient().get(`/api/emergency/ems-handoffs${query}`);
}

// ---------------------------------------------------------------------------
// Ambulance run record (api/src/handlers/ems_runs.rs)
//
// A run is one patient a crew attends; its timeline is appended tap by tap.
// Leaving the scene with a destination is the pre-alert; "handed_over" is the
// one-button handover; the hospital's `receiveEmsRun` closes it.
// ---------------------------------------------------------------------------

export type EmsRunStatus = 'in_progress' | 'en_route' | 'arrived' | 'received' | 'cancelled' | 'no_transport';

export type EmsRunEventKind =
  | 'dispatched' | 'on_scene' | 'patient_contact' | 'identified' | 'vitals' | 'treatment'
  | 'medication' | 'note' | 'left_scene' | 'destination_changed' | 'handed_over'
  | 'received' | 'cancelled' | 'no_transport' | 'alert';

/** The pre-alerts a crew can raise; the server refuses any other. */
export const EMS_RUN_ALERTS = ['trauma', 'stemi', 'stroke', 'sepsis', 'cardiac_arrest'] as const;
export type EmsRunAlert = (typeof EMS_RUN_ALERTS)[number];

export interface EmsRun {
  id: string;
  status: EmsRunStatus;
  created_by: string;
  crew: string[];
  unit_number?: string | null;
  ems_agency?: string | null;
  patient_id?: string | null;
  unidentified_description?: string | null;
  chief_complaint?: string | null;
  incident_id?: string | null;
  /** Pre-alerts currently raised, in the order raised. */
  alerts?: EmsRunAlert[];
  destination_facility_id?: string | null;
  destination_name?: string | null;
  eta?: string | null;
  received_by?: string | null;
  received_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** Vitals as the crew records them; every reading optional (rule 12). */
export interface EmsRunVitals {
  systolic_bp?: number;
  diastolic_bp?: number;
  heart_rate?: number;
  respiratory_rate?: number;
  spo2?: number;
  gcs?: number;
  temperature_c?: number;
  glucose_mmol?: number;
}

export interface EmsRunEvent {
  id: string;
  run_id: string;
  kind: EmsRunEventKind;
  occurred_at: string;
  recorded_by: string;
  /** Vitals readings, a treatment `{ name }`, a medicine `{ name, dose, route }`, or a note `{ text }`. */
  payload: Record<string, unknown> | null;
}

export interface EmsRunWithEvents extends EmsRun {
  events: EmsRunEvent[];
}

/** How one observation moved, judged by the server (NEWS2 points; GCS higher is better). */
export type EmsVitalChange = 'better' | 'worse' | 'same';

/** First reading against the latest, computed in clinical_scoring.rs. */
export interface EmsVitalsTrend {
  direction: 'improving' | 'worsening' | 'mixed' | 'unchanged';
  respiratory_rate: EmsVitalChange | null;
  spo2: EmsVitalChange | null;
  systolic_bp: EmsVitalChange | null;
  heart_rate: EmsVitalChange | null;
  temperature: EmsVitalChange | null;
  gcs: EmsVitalChange | null;
  parameters_compared: number;
}

/** A run on the receiving board. */
export interface IncomingEmsRun extends EmsRunWithEvents {
  /** Null with fewer than two readings to compare. */
  vitals_trend?: EmsVitalsTrend | null;
  /** For an identified patient whose record could be read; the read is logged. */
  emergency?: {
    allergies: Array<{ name: string; severity: string }>;
    /** Null when the group is not known. */
    blood_type: string | null;
  } | null;
}

export interface CreateEmsRunBody {
  /** `RUN-` + 32 hex, chosen on the device so a run can start with no signal. */
  id?: string;
  unit_number?: string;
  ems_agency?: string;
  crew?: string[];
  patient_id?: string;
  unidentified_description?: string;
  chief_complaint?: string;
  incident_id?: string;
}

export interface AddEmsRunEventBody {
  kind: EmsRunEventKind;
  occurred_at?: string;
  payload?: Record<string, unknown>;
  destination_facility_id?: string;
  eta_minutes?: number;
  patient_id?: string;
  chief_complaint?: string;
}

/**
 * A handover queued without signal is no longer a handover a day later; it is
 * kept sealed on the device for 24 hours, then marked expired instead of sent.
 */
export const EMS_OFFLINE_LIFETIME_MS = 24 * 60 * 60 * 1000;

export async function createEmsRun(body: CreateEmsRunBody): Promise<EmsRunWithEvents> {
  return getApiClient().post('/api/ems/runs', body, {
    queueWhenOffline: { category: 'medical-records', description: 'Ambulance run started', expiresInMs: EMS_OFFLINE_LIFETIME_MS },
  });
}

/** The signed-in crew member's runs, newest first. */
export async function listOwnEmsRuns(): Promise<{ runs: EmsRun[] }> {
  return getApiClient().get('/api/ems/runs');
}

export async function getEmsRun(runId: string): Promise<EmsRunWithEvents> {
  return getApiClient().get(`/api/ems/runs/${encodeURIComponent(runId)}`);
}

/** One tap on the timeline; some also move the run (leaving, handing over). */
export async function addEmsRunEvent(
  runId: string,
  body: AddEmsRunEventBody,
): Promise<{ run: EmsRun; event: EmsRunEvent }> {
  return getApiClient().post(`/api/ems/runs/${encodeURIComponent(runId)}/events`, body, {
    queueWhenOffline: { category: 'medical-records', description: `Ambulance run entry: ${body.kind}`, expiresInMs: EMS_OFFLINE_LIFETIME_MS },
  });
}

/** Facilities a crew can take a patient to. */
export async function listEmsDestinations(): Promise<{ facilities: Array<{ id: string; name: string }> }> {
  return getApiClient().get('/api/ems/destinations');
}

/** Ambulances coming to the caller's own facility: the incoming board. */
export async function listIncomingEmsRuns(): Promise<{ facility_id: string | null; runs: IncomingEmsRun[] }> {
  return getApiClient().get('/api/ems/incoming');
}

/** The receiving clinician's one tap; it also lets them open the chart. */
export async function receiveEmsRun(runId: string): Promise<{ run: EmsRun }> {
  return getApiClient().post(`/api/ems/runs/${encodeURIComponent(runId)}/receive`, {});
}

/** The ambulance runs recorded about one patient (their team, or themselves). */
export async function getPatientEmsRuns(patientId: string): Promise<{ runs: EmsRunWithEvents[] }> {
  return getApiClient().get(`/api/clinical/patient/${encodeURIComponent(patientId)}/ems-runs`);
}

/** The ambulance handovers recorded about one patient (their team, or themselves). */
export async function getPatientEmsHandoffs(
  patientId: string
): Promise<{ success: boolean; handoffs: EmsHandoff[]; count: number }> {
  return getApiClient().get(`/api/clinical/patient/${encodeURIComponent(patientId)}/ems-handoffs`);
}
