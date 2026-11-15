/**
 * MediChain API endpoints: Clinical decision support alerts and rules.
 */

import { getApiClient } from '../client';

// ============================================================================
// CDS (Phase 27)
// ============================================================================

export async function getPatientCdsAlerts(
  patientId: string
): Promise<{
  success: boolean;
  patient_id: string;
  alerts: PatientCdsAlert[];
  count: number;
}> {
  return getApiClient().get(`/api/cds/patient/${patientId}/alerts`);
}

/** Patient-safe CDS alert projection returned by the alert-history endpoint. */
export interface PatientCdsAlert {
  alert_id: string;
  title: string;
  description: string;
  severity: 'Informational' | 'Low' | 'Medium' | 'High' | 'Critical';
  alert_type: string;
  created_at: number;
  status: string;
}

// ============================================================================
// CDS rules
// ============================================================================

// ---------------------------------------------------------------------------
// CDS rules — the rules themselves, not the alerts they produce
// ---------------------------------------------------------------------------

/** One thing a rule does when it fires (`CdsRuleActionInput`). */
export interface CdsRuleActionPayload {
  type: string;
  message: string;
  severity: string;
  notifyRoles?: string[];
  blockAction?: boolean;
  suggestedAction?: string;
  escalateTo?: string;
}

/** What the rule builder submits (`CreateCdsRuleRequest`). */
export interface CreateCdsRulePayload {
  name: string;
  category: string;
  description: string;
  severity: string;
  triggerType: string;
  conditions: unknown[];
  actions: CdsRuleActionPayload[];
  status?: string;
  priority?: number;
  isEnabled?: boolean;
  testMode?: boolean;
  targetRoles?: string[];
  evidenceLevel?: string;
  references?: string[];
}

/** The CDS rules in force. Readable by clinical staff; written by admins. */
export async function listCdsRules(): Promise<{
  success: boolean;
  count: number;
  rules: Record<string, unknown>[];
}> {
  return getApiClient().get('/api/admin/cds/rules');
}

/** Write a rule. Administrators only. */
export async function createCdsRule(
  data: CreateCdsRulePayload
): Promise<{ success: boolean; rule: Record<string, unknown> }> {
  return getApiClient().post('/api/admin/cds/rules', data);
}

/** Turn a rule on or off. Refused with 409 if it changed meanwhile. */
export async function setCdsRuleEnablement(
  ruleId: string,
  isEnabled: boolean
): Promise<{ success: boolean; rule: Record<string, unknown> }> {
  return getApiClient().post(
    `/api/admin/cds/rules/${encodeURIComponent(ruleId)}/enablement`,
    { isEnabled }
  );
}

/** Stop a rule firing. Retired, not deleted: the audit trail names it. */
export async function retireCdsRule(
  ruleId: string
): Promise<{ success: boolean; rule_id: string }> {
  return getApiClient().post(`/api/admin/cds/rules/${encodeURIComponent(ruleId)}/retire`, {});
}
