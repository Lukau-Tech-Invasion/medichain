/**
 * MediChain API endpoints: Health, languages, offline sync and FHIR.
 */

import type * as Requests from '../request-types.generated';
import { getApiClient } from '../client';
import type {
  AuditSealSummary,
} from '../../types';

// ============================================================================
// Health Check
// ============================================================================

export interface ServiceHealth {
  name: string;
  status: 'online' | 'degraded' | 'offline';
  latency_ms: number | null;
  message: string | null;
}

export interface DetailedHealthResponse {
  overall_status: string;
  version: string;
  uptime_seconds: number;
  timestamp: string;
  services: ServiceHealth[];
  /** Sealing state of the audit stream; absent when the server does not report it. */
  audit_seal?: AuditSealSummary;
}

export async function detailedHealthCheck(): Promise<DetailedHealthResponse> {
  return getApiClient().get('/api/health/detailed');
}

// ============================================================================
// Demo
// ============================================================================

// ============================================================================
// Languages (Phase 32)
// ============================================================================

export async function setLanguagePreference(data: Requests.SetLanguagePreferenceRequest): Promise<{ success: boolean; message: string }> {
  return getApiClient().post('/api/platform/languages/preference', data);
}

// ============================================================================
// Offline Sync (Phase 33)
// ============================================================================

export async function getSyncConflicts(): Promise<{ conflicts: Record<string, unknown>[] }> {
  return getApiClient().get('/api/sync/conflicts');
}

export async function resolveSyncConflict(
  conflictId: string,
  resolution: 'UseLocal' | 'UseServer' | 'Merge',
): Promise<{ success: boolean; conflict_id: string; resolution: string }> {
  return getApiClient().post(`/api/sync/conflicts/${conflictId}/resolve`, { resolution });
}

export async function downloadOfflineData(patientId: string): Promise<{
  patient: Record<string, unknown>;
  records: Record<string, unknown>[];
  vitals: Record<string, unknown>[];
  downloaded_at: number;
}> {
  return getApiClient().get(`/api/sync/download/${patientId}`);
}

// ============================================================================
// HL7 FHIR R4 API
//
// FHIR resource/Bundle shapes follow the HL7 FHIR R4 standard (external spec,
// not a MediChain-defined struct) — typed structurally rather than mirroring
// the full FHIR resource model.
// ============================================================================

// ============================================================================
// Missing FHIR Endpoints (Task 1)
// ============================================================================

// ============================================================================
// Organisation key directory
// ============================================================================

// ============================================================================
// Sync devices
// ============================================================================

/** Sync status for every device registered against this account. */
export async function listSyncDevices(): Promise<{
  success: boolean;
  count: number;
  devices: Record<string, unknown>[];
}> {
  return getApiClient().get('/api/sync/devices');
}
