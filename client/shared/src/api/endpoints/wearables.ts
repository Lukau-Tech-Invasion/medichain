/**
 * MediChain API endpoints: Wearable and patient-owned devices, readings and alert rules.
 */

import type * as Requests from '../request-types.generated';
import { getApiClient } from '../client';
import type {
  AlertRuleCreateResult,
  WearableAlert,
  WearableDevice,
  WearableDeviceCreateResult,
  WearableReading,
} from '../../types';

// ============================================================================
// Wearables (Phase 24)
// ============================================================================

export async function registerWearableDevice(data: Requests.RegisterWearableRequest): Promise<WearableDeviceCreateResult> {
  return getApiClient().post('/api/wearables/devices', data);
}

export async function getWearableDevices(): Promise<{ success: boolean; devices: WearableDevice[]; count: number }> {
  return getApiClient().get('/api/wearables/devices');
}

export async function getWearableReadings(
  patientId: string,
  type?: string
): Promise<{ success: boolean; readings: WearableReading[]; count: number }> {
  const url = type ? `/api/wearables/readings/${patientId}?type=${type}` : `/api/wearables/readings/${patientId}`;
  return getApiClient().get(url);
}

export async function createWearableAlertRule(data: Requests.CreateAlertRuleRequest): Promise<AlertRuleCreateResult> {
  return getApiClient().post('/api/wearables/alerts/rules', data);
}

export async function getWearableAlerts(): Promise<{ success: boolean; alerts: WearableAlert[]; count: number }> {
  return getApiClient().get('/api/wearables/alerts');
}

// ============================================================================
// Patient-owned mobile devices
// ============================================================================
//
// Four endpoints, all of which write, and none with a client function. A device
// id is returned exactly once — in the response to the registration that
// created it — so a patient who lost a phone had no way to name the device they
// wanted revoked. `GET /api/mobile/devices` is new.

/** A device this patient has registered against their records. */
export interface PatientMobileDevice {
  id: string;
  patient_id: string;
  device_label: string;
  platform: string;
  /** The device's public half. The private key never leaves the device. */
  public_key: string;
  status: string;
  last_synchronised_at?: string | null;
  revoked_at?: string | null;
  revocation_reason?: string | null;
}

/**
 * The devices the signed-in patient has registered.
 *
 * Scoped to the caller: the screen asking this is "my devices", and there is no
 * id for it to send. Revoked devices are included and marked, because someone
 * who has just lost a phone needs to see the revocation took effect.
 */
export async function listMyMobileDevices(): Promise<{
  success: boolean;
  count: number;
  devices: PatientMobileDevice[];
}> {
  return getApiClient().get('/api/mobile/devices');
}

/**
 * Revoke a device and invalidate the content capabilities it holds.
 *
 * The row is kept and marked revoked rather than removed: a patient needs to
 * see that the phone they lost can no longer open anything.
 */
export async function revokeMobileDevice(
  deviceId: string,
  reason: string
): Promise<PatientMobileDevice> {
  return getApiClient().post(`/api/mobile/devices/${encodeURIComponent(deviceId)}/revoke`, {
    reason,
  });
}

// ============================================================================
// Wearable alerting
// ============================================================================
//
// A patient could connect a device and stream readings, and nothing could ever
// alert them: `createWearableAlertRule` had no caller anywhere, `getWearableAlerts`
// had none either, and the endpoint that lists saved rules had no client
// function at all. So a rule could be stored and never seen, checked or
// corrected — which is why the threshold direction being wrong server-side went
// unnoticed.

/** One threshold rule, as the server stores it. */
export interface WearableAlertRule {
  rule_id: string;
  patient_id: string;
  /** A tagged enum server-side: a plain string for the known types. */
  data_type: string | Record<string, string>;
  /** `Above` | `Below` | `OutsideRange` | `ChangeRate` | `AbsenceOfData` */
  threshold_type: string;
  /** For a band this is the HIGH bound; `secondary_threshold` is the low one. */
  threshold_value: number;
  secondary_threshold?: number | null;
  severity: string;
  notify_patient: boolean;
  notify_provider: boolean;
  provider_id?: string | null;
  active: boolean;
  /** Unix seconds. */
  created_at: number;
}

/**
 * The alert rules this caller has set.
 *
 * `POST` has stored them since the feature was built and nothing read them
 * back, so a patient could not see, check or correct a rule once saved.
 */
export async function listWearableAlertRules(): Promise<{
  success: boolean;
  count: number;
  rules: WearableAlertRule[];
}> {
  return getApiClient().get('/api/wearables/alert-rules');
}

/** A wearable model the deployment knows how to take readings from. */
export interface SupportedWearable {
  manufacturer: string;
  models: string[];
  data_types: string[];
}

/**
 * Which wearables this deployment supports.
 *
 * Reference data, served rather than hardcoded in a component — the same reason
 * clinical thresholds come from the scoring catalogue. The page and the server
 * each carried their own list and the two disagreed.
 */
export async function getSupportedWearables(): Promise<{
  success: boolean;
  /** The server's own key. Checked against a live response, not guessed. */
  supported_manufacturers: SupportedWearable[];
}> {
  return getApiClient().get('/api/wearables/supported');
}

// ============================================================================
// Disconnecting a device
// ============================================================================

/**
 * Disconnect a wearable this patient registered.
 *
 * Deactivates rather than deletes: readings already taken were taken, and which
 * device produced them is part of reading them correctly. `is_active: false`
 * stops the device without rewriting history.
 */
export async function disconnectWearableDevice(deviceId: string): Promise<{
  success: boolean;
  device_id: string;
  is_active: boolean;
  connection_status?: string | null;
}> {
  return getApiClient().post(
    `/api/wearables/devices/${encodeURIComponent(deviceId)}/disconnect`,
    {}
  );
}
