/**
 * The workspace offers a role exactly the patient forms its own navigation
 * offers — never one the sidebar would refuse — with the common ones first.
 */
import { describe, expect, it } from 'vitest';
import { getNavForRole, rolesOwningRoute } from '../config/navigation';
import { PATIENT_FORM_IDS, patientFormOfPath, workspacePath, workspaceRail } from './forms';

describe('workspaceRail', () => {
  it.each(['Doctor', 'Nurse', 'LabTechnician', 'Pharmacist', 'Admin'] as const)(
    "offers %s only patient forms from that role's navigation",
    (role) => {
      const rail = workspaceRail(role);
      const navPaths = new Set(getNavForRole(role).flatMap((s) => s.items.map((i) => i.to)));
      for (const id of rail.byId.keys()) {
        expect(PATIENT_FORM_IDS.has(id)).toBe(true);
        expect(navPaths.has(`/${id}`)).toBe(true);
        expect(rolesOwningRoute(role, `/${id}`)).toEqual([]);
      }
    },
  );

  it('puts the doctor’s common forms first, in a fixed order', () => {
    expect(workspaceRail('Doctor').common.map((f) => f.id)).toEqual(
      ['soap', 'orders', 'e-prescribe', 'lab-results', 'progress-note', 'discharge'],
    );
  });

  it('gives a nurse vitals and the medication record among the common forms', () => {
    const common = workspaceRail('Nurse').common.map((f) => f.id);
    expect(common).toContain('vitals');
    expect(common).toContain('mar');
  });

  it('offers a paramedic no clinic forms beyond the ambulance handover', () => {
    expect([...workspaceRail('Paramedic').byId.keys()]).toEqual(['ems-handoff']);
  });
});

describe('workspace paths', () => {
  it('builds the chart home and form URLs', () => {
    expect(workspacePath('PAT-1')).toBe('/patients/PAT-1');
    expect(workspacePath('PAT-1', 'vitals')).toBe('/patients/PAT-1/vitals');
  });

  it('recognises a flat patient-form route and nothing else', () => {
    expect(patientFormOfPath('/vitals')).toBe('vitals');
    expect(patientFormOfPath('/dashboard')).toBeUndefined();
    expect(patientFormOfPath('/patients/PAT-1')).toBeUndefined();
  });
});
