/**
 * MediChain API endpoints: Blood bank orders, transfusions and unit stock.
 */

import type * as Requests from '../request-types.generated';
import { getApiClient } from '../client';
import type {
  ClinicalCreateResult,
} from '../../types';

// ============================================================================
// Blood Bank (Phase 15)
// ============================================================================

export async function createBloodTypeScreen(data: Requests.CreateBloodOrderRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/blood-type', data);
}

export interface TransfusionVitalsInput {
  bp?: string;
  hr?: number;
  temp?: number;
  rr?: number;
}

/** What the ward records when a unit is given. Mirrors `TransfusionInfoInput`. */
export interface TransfusionInfoInput {
  startTime?: string;
  endTime?: string;
  administeredBy?: string;
  /** The second person on the bedside check. */
  witnessedBy?: string;
  preVitals?: TransfusionVitalsInput;
  postVitals?: TransfusionVitalsInput;
  reactions?: string[];
  notes?: string;
}

/** Mirrors `CreateTransfusionRequest`. */
export interface CreateTransfusionRequest {
  orderId?: string;
  patientId: string;
  bloodType?: string;
  product?: string;
  units?: number;
  unitNumber?: string;
  status?: string;
  transfusionInfo?: TransfusionInfoInput;
}

export async function createTransfusion(data: CreateTransfusionRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/transfusion', data);
}

// ============================================================================
// Blood-unit stock inventory (WP7.5)
// ============================================================================

export type BloodProductCode = 'PackedRBC' | 'FFP' | 'Platelets' | 'Cryoprecipitate' | 'WholeBlood';
export type BloodUnitStatus = 'available' | 'reserved' | 'issued' | 'expired' | 'discarded';

/** One physical blood unit; `status` already reads `expired` past its date. */
export interface BloodUnit {
  id: string;
  unit_number: string;
  product_type: BloodProductCode;
  abo: 'A' | 'B' | 'AB' | 'O';
  rh: 'positive' | 'negative';
  collected_on: string;
  expires_on: string;
  status: BloodUnitStatus;
  location: string;
  reserved_for_patient_id: string | null;
  crossmatch_reference: string | null;
  issued_to_patient_id: string | null;
  transfusion_id: string | null;
  discard_reason: string | null;
}

/** Stock counts and alerts computed by the server. */
export interface BloodStockSummary {
  stock: Array<{ product_type: BloodProductCode; abo: string; rh: string; available: number }>;
  expiring_unit_ids: string[];
  low_stock_groups: string[];
  expiry_warning_days: number;
  low_stock_units: number;
  /** True until the thresholds carry a clinical sign-off. */
  thresholds_are_defaults: boolean;
}

export async function getBloodUnits(): Promise<{ success: boolean; units: BloodUnit[]; summary: BloodStockSummary }> {
  return getApiClient().get('/api/blood-bank/units');
}

export async function receiveBloodUnit(unit: {
  unit_number: string;
  product_type: BloodProductCode;
  abo: BloodUnit['abo'];
  rh: BloodUnit['rh'];
  collected_on: string;
  expires_on: string;
  location: string;
}): Promise<{ success: boolean; unit: BloodUnit }> {
  return getApiClient().post('/api/blood-bank/units', unit);
}

export async function reserveBloodUnit(
  unitId: string,
  patientId: string,
  crossmatchReference: string
): Promise<{ success: boolean; unit: BloodUnit }> {
  return getApiClient().post(`/api/blood-bank/units/${encodeURIComponent(unitId)}/reserve`, {
    patient_id: patientId,
    crossmatch_reference: crossmatchReference.trim(),
  });
}

export async function releaseBloodUnit(unitId: string): Promise<{ success: boolean; unit: BloodUnit }> {
  return getApiClient().post(`/api/blood-bank/units/${encodeURIComponent(unitId)}/release`, {});
}

export async function issueBloodUnit(unitId: string, transfusionId: string): Promise<{ success: boolean; unit: BloodUnit }> {
  return getApiClient().post(`/api/blood-bank/units/${encodeURIComponent(unitId)}/issue`, {
    transfusion_id: transfusionId.trim(),
  });
}

export async function discardBloodUnit(unitId: string, reason: string): Promise<{ success: boolean; unit: BloodUnit }> {
  return getApiClient().post(`/api/blood-bank/units/${encodeURIComponent(unitId)}/discard`, { reason: reason.trim() });
}

// ============================================================================
// Blood bank list
// ============================================================================

/**
 * List all blood-bank records currently available to the clinical register.
 *
 * Crossmatches have no standalone store yet, but both the order/type-screen
 * and transfusion-event repositories are included by the server. Do not turn
 * an omitted crossmatch subsystem into a claim that no transfusions exist.
 */
export async function listBloodBank(): Promise<{
  success: boolean;
  type_screens: { total: number; items: unknown[] };
  crossmatches: { total: number; items: unknown[] };
  transfusions: { total: number; items: unknown[] };
}> {
  const response = await getApiClient().get<{
    screens?: unknown[];
    transfusions?: unknown[];
  }>('/api/platform/list/blood-bank');
  // A malformed response must not look like an empty clinical register.
  if (!Array.isArray(response?.screens) || !Array.isArray(response?.transfusions)) {
    throw new Error('Blood-bank register response is invalid');
  }
  const screens = response.screens;
  const transfusions = response.transfusions;
  return {
    success: true,
    type_screens: { total: screens.length, items: screens },
    crossmatches: { total: 0, items: [] },
    transfusions: { total: transfusions.length, items: transfusions },
  };
}
