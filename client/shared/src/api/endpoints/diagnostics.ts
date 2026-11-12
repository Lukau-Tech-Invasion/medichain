/**
 * MediChain API endpoints: Radiology and pathology.
 */

import type * as Requests from '../request-types.generated';
import { getApiClient } from '../client';
import type {
  ClinicalCreateResult,
} from '../../types';
import { wrapListResponse } from './common';
import type { ListResponse } from './common';

// ============================================================================
// Radiology (Phase 11)
// ============================================================================

export async function createRadiologyOrder(data: Requests.RadiologyOrder): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/radiology/order', data);
}

/** List durable radiology orders for clinical order-entry screens. */
export async function listRadiologyOrders(): Promise<ListResponse<unknown>> {
  const items = await getApiClient().get<unknown[]>('/api/platform/list/radiology-orders');
  return wrapListResponse(items || []);
}

export async function createRadiologyReport(data: Requests.RadiologyReport): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/radiology/report', data);
}

// ============================================================================
// Pathology (Phase 12)
// ============================================================================

export async function createPathology(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/pathology', data);
}

/** Save the editable fields of an accessioned pathology report. */
export async function updatePathologyReport(reportId: string, data: Requests.UpdatePathologyReportRequest): Promise<ClinicalCreateResult> {
  return getApiClient().put(`/api/surgical/pathology/${reportId}`, data);
}

// ============================================================================
// Radiology and pathology lists
// ============================================================================

/**
 * List all radiology orders and reports.
 *
 * Both halves are real reads. `reports` used to be hardcoded empty because the
 * backend had no reports registry; it now has one, so a finalized report is
 * reachable from a list view rather than only through the order that produced
 * it.
 */
export async function listRadiology(): Promise<{
  success: boolean;
  orders: { total: number; items: unknown[] };
  reports: { total: number; items: unknown[] };
}> {
  const [orders, reports] = await Promise.all([
    getApiClient().get<unknown[]>('/api/platform/list/radiology-orders'),
    getApiClient().get<unknown[]>('/api/platform/list/radiology-reports'),
  ]);
  return {
    success: true,
    orders: { total: (orders || []).length, items: orders || [] },
    reports: { total: (reports || []).length, items: reports || [] },
  };
}

/**
 * List all pathology reports
 */
export async function listPathology(): Promise<ListResponse<unknown>> {
  const items = await getApiClient().get<unknown[]>('/api/platform/list/pathology');
  return wrapListResponse(items || []);
}
