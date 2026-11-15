/**
 * Which screens work on one patient, and how a role's workspace lists them.
 *
 * The list is the 58 routes whose page selects a patient (`<PatientSelect>`),
 * measured 2026-10-30. Labels, icons, groups and — most importantly — who may
 * open each one come from the role's own navigation (`config/navigation.ts`),
 * so the workspace can never offer a form the sidebar would refuse.
 */
import type { LucideIcon } from 'lucide-react';
import { getNavForRole, type Role } from '../config/navigation';

/** Route segments of every patient-scoped form. */
export const PATIENT_FORM_IDS: ReadonlySet<string> = new Set([
  'ama', 'anesthesia', 'appointments', 'autopsy', 'blood-bank', 'burn', 'cardiac', 'care-plan',
  'cds-alerts', 'chain-of-custody', 'claims-eob', 'code-blue', 'consult', 'critical-value',
  'death-certificate', 'discharge', 'drug-interactions', 'e-prescribe', 'emergency-protocols',
  'ems-handoff', 'fall-risk', 'family-history', 'health-id-cards', 'history-physical', 'imaging',
  'immunization', 'incident-report', 'intake-output', 'intubation', 'iv-site', 'lab-results',
  'laceration-repair', 'mar', 'medication-admin', 'nursing', 'nursing-care-plan', 'obstetrics',
  'operative-note', 'orders', 'pathology', 'pediatrics', 'post-op', 'pre-op', 'progress-note',
  'psych', 'retention', 'sepsis', 'shift-handoff', 'soap', 'specimen', 'splint', 'stroke',
  'telehealth', 'toxicology', 'trauma', 'triage', 'vitals', 'wound-care',
]);

/**
 * The few forms each role opens most, shown first. Fixed rather than learned so
 * the rail does not move under a clinician's hand.
 */
const COMMON: Partial<Record<Role, string[]>> = {
  Doctor: ['soap', 'orders', 'e-prescribe', 'lab-results', 'progress-note', 'discharge'],
  Nurse: ['vitals', 'mar', 'intake-output', 'wound-care', 'care-plan', 'progress-note'],
  LabTechnician: ['specimen', 'lab-results', 'chain-of-custody', 'critical-value'],
  Pharmacist: ['e-prescribe', 'medication-admin', 'drug-interactions', 'orders'],
  Admin: ['health-id-cards', 'death-certificate'],
};

export interface WorkspaceForm {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The navigation section it sits in, e.g. "Patient Care". */
  group: string;
}

export interface WorkspaceRail {
  common: WorkspaceForm[];
  /** Every patient form the role may open, grouped as its sidebar groups them. */
  groups: Array<{ label: string; forms: WorkspaceForm[] }>;
  byId: Map<string, WorkspaceForm>;
}

/** The forms `role` may open inside a patient's workspace. */
export function workspaceRail(role: Role): WorkspaceRail {
  const byId = new Map<string, WorkspaceForm>();
  const groups: WorkspaceRail['groups'] = [];
  for (const section of getNavForRole(role)) {
    const forms: WorkspaceForm[] = [];
    for (const item of section.items) {
      const id = item.to.replace(/^\//, '');
      if (!PATIENT_FORM_IDS.has(id) || byId.has(id)) continue;
      const form = { id, label: item.label, icon: item.icon, group: section.label };
      byId.set(id, form);
      forms.push(form);
    }
    if (forms.length) groups.push({ label: section.label, forms });
  }
  const common = (COMMON[role] ?? []).map((id) => byId.get(id)).filter((f): f is WorkspaceForm => Boolean(f));
  return { common, groups, byId };
}

/** The workspace URL for a form, or the chart home when `form` is absent. */
export function workspacePath(patientId: string, form?: string): string {
  const base = `/patients/${encodeURIComponent(patientId)}`;
  return form ? `${base}/${form}` : base;
}

/** The patient form a flat route like `/vitals` is, if it is one. */
export function patientFormOfPath(pathname: string): string | undefined {
  const segment = pathname.replace(/^\//, '').split('/')[0];
  return PATIENT_FORM_IDS.has(segment) ? segment : undefined;
}
