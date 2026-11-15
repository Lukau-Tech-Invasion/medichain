/**
 * MediChain API endpoints: Telehealth sessions.
 */

import { getApiClient } from '../client';
import type {
  EndTelehealthSessionResponse,
  SealSignature,
  SealStatus,
  TelehealthSession,
  TelehealthSessionCreateResult,
} from '../../types';

// ============================================================================
// Telehealth (Phase 26)
// ============================================================================

export interface CreateTelehealthSessionInput {
  patient_id: string;
  scheduled_start: number;
  session_type: string;
  /** Minutes. The join link's expiry is derived from it, so it is not cosmetic. */
  duration_minutes: number;
  appointment_id?: string;
  recording_enabled?: boolean;
}

export async function createTelehealthSession(
  data: CreateTelehealthSessionInput
): Promise<TelehealthSessionCreateResult> {
  return getApiClient().post('/api/telehealth/sessions', data);
}

/**
 * The signed-in caller's own telehealth sessions.
 *
 * A clinician's whole telehealth list, without having to name a patient first.
 * `TelehealthPage` showed nothing at all until a patient id was typed in, which
 * is the wrong shape for a screen whose job is "what am I seeing today".
 */
export async function listMyTelehealthSessions(): Promise<{
  success: boolean;
  sessions: TelehealthSession[];
  count: number;
  next_cursor?: string | null;
}> {
  return getApiClient().get('/api/telehealth/sessions');
}

export async function joinTelehealthSession(
  sessionId: string
): Promise<{ jitsi?: Record<string, unknown> | null; video_room_url?: string | null; role?: string; subject?: string | null }> {
  return getApiClient().post(`/api/telehealth/sessions/${sessionId}/join`, {});
}

export async function endTelehealthSession(sessionId: string, data?: unknown): Promise<EndTelehealthSessionResponse> {
  return getApiClient().post(`/api/telehealth/sessions/${sessionId}/end`, data || {});
}

/** Relay a telehealth lifecycle event (Phase 7): SSE-broadcast + audit-logged. */
export async function telehealthEvent(
  sessionId: string,
  eventType: string,
  detail?: string
): Promise<{ success: boolean }> {
  return getApiClient().post(`/api/telehealth/sessions/${sessionId}/event`, {
    event_type: eventType,
    detail,
  });
}

/** Start/stop recording (Phase 6, moderator-only; starting requires consent). */
export async function telehealthRecording(
  sessionId: string,
  action: 'start' | 'stop',
  consent?: boolean
): Promise<{ success: boolean; recording_enabled?: boolean }> {
  return getApiClient().post(`/api/telehealth/sessions/${sessionId}/recording`, {
    action,
    consent,
  });
}

/** The code a chart read is refused with when there is no care relationship (WP9). */
export const CARE_RELATIONSHIP_REQUIRED = 'CARE_RELATIONSHIP_REQUIRED';

/** Break the glass on a patient's chart (WP9): reason required, time-limited, patient told. */
export async function breakGlass(
  patientId: string,
  reason: string
): Promise<{ success: boolean; grant_id: string; expires_at: string }> {
  return getApiClient().post(`/api/patients/${encodeURIComponent(patientId)}/break-glass`, { reason });
}

/** A server-issued chart access context (WP10). */
export interface AccessContext {
  access_context_id: string;
  authority_type: string;
  expires_at: string;
}

/** Declare why a chart is being opened; the server checks authority first (WP10). */
export async function openAccessContext(patientId: string, reason: string): Promise<AccessContext> {
  return getApiClient().post(`/api/patients/${encodeURIComponent(patientId)}/access-context`, { reason });
}

/** A proof step: the sibling hash and which side it sits on. */
export interface MerkleProofStep {
  sibling: string;
  side: 'left' | 'right';
}

/** One access-log row's verification against its Merkle batch (WP8). */
export interface RowVerification {
  access_log_id: string;
  accessed_at: string;
  integrity: 'intact' | 'mismatch' | 'unbatched';
  batch_id: number | null;
  leaf_index: number | null;
  merkle_root: string | null;
  proof: MerkleProofStep[];
  /** Where the row's batch stands; null = the row is not in a batch yet. */
  seal_status: SealStatus | null;
  /** Hash of the sealed batch that contains the row. */
  batch_hash: string | null;
  /**
   * Whether the batch signature checked out. `unsigned` means the batch was
   * sealed without a key (weaker than `valid`); null when there is no batch.
   */
  signature: SealSignature | null;
  sealed_at: string | null;
  exported_at: string | null;
}

/** The public key that signs sealed batches. */
export interface SealKey {
  key_id: string;
  algorithm: 'ed25519';
  public_key: string;
}

/**
 * The emergency capsule checked against its sealed commitment. `unsealed`: no
 * sealed commitment exists yet, so the card cannot be verified.
 */
export type CapsuleVerification = 'match' | 'mismatch' | 'unsealed' | 'none';

/** A patient's record verification (WP8). */
export interface RecordVerification {
  patient_id: string;
  emergency_capsule: CapsuleVerification;
  access_logs: RowVerification[];
  rows_checked_limit: number;
  /** Null when batches are sealed without a signing key. */
  seal_key: SealKey | null;
}

/** Verify a patient's emergency capsule and access history. */
export async function verifyPatientRecord(patientId: string): Promise<RecordVerification> {
  return getApiClient().get(`/api/patients/${encodeURIComponent(patientId)}/verify`, { keepEnvelope: true });
}

/** Which side of a consultation the caller is on. */
export type RecordingParty = 'provider' | 'patient';

/** A consultation's recording state, as its clinician or patient sees it (WP7.6). */
export interface RecordingStatus {
  session_id: string;
  /** False: "Recording is not set up for this clinic". */
  configured: boolean;
  provider_consented: boolean;
  patient_consented: boolean;
  recording: boolean;
  your_party: RecordingParty;
}

/** A stored consultation recording (metadata; opening it is audited). */
export interface TelehealthRecording {
  id: string;
  session_id: string;
  content_type: string;
  size_bytes: number;
  recording_started_at: string;
  created_at: string;
}

/** The recording state of a consultation. */
export async function getRecordingStatus(sessionId: string): Promise<RecordingStatus> {
  return getApiClient().get(`/api/telehealth/sessions/${encodeURIComponent(sessionId)}/recording-status`);
}

/** Give or withdraw the caller's own consent to recording. */
export async function setRecordingConsent(sessionId: string, consent: boolean): Promise<RecordingStatus> {
  return getApiClient().post(`/api/telehealth/sessions/${encodeURIComponent(sessionId)}/recording-consent`, {
    consent,
  });
}

/** The recordings of a consultation (its clinician or patient). */
export async function listTelehealthRecordings(sessionId: string): Promise<{ recordings: TelehealthRecording[] }> {
  return getApiClient().get(`/api/telehealth/sessions/${encodeURIComponent(sessionId)}/recordings`, {
    keepEnvelope: true,
  });
}

/** Download a recording (audited as a disclosure on the patient's record). */
export async function downloadTelehealthRecording(recordingId: string): Promise<{ blob: Blob; contentType: string }> {
  return getApiClient().getBlob(`/api/telehealth/recordings/${encodeURIComponent(recordingId)}`);
}

export async function getPatientTelehealthSessions(
  patientId: string
): Promise<{ success: boolean; patient_id: string; sessions: TelehealthSession[]; count: number }> {
  return getApiClient().get(`/api/telehealth/patient/${patientId}/sessions`);
}
