/**
 * The patient a workspace has open. Inside it, `PatientSelect` adopts this
 * patient instead of asking for one — which is how 58 existing forms become
 * patient-first without each being rewritten.
 */
import { createContext, useContext } from 'react';
import type { EmsRunWithEvents } from '@medichain/shared';
import type { Patient } from '../components/PatientSelect';

export interface PatientWorkspaceValue {
  patientId: string;
  /** Directory identity, once loaded. */
  patient: Patient | null;
  /**
   * The patient's ambulance run from the last day, read once for the chart:
   * `undefined` while it is read, `null` when there is none.
   */
  ambulanceRun?: EmsRunWithEvents | null;
}

export const PatientWorkspaceContext = createContext<PatientWorkspaceValue | null>(null);

/** The open workspace patient, or null outside a workspace. */
export function usePatientWorkspace(): PatientWorkspaceValue | null {
  return useContext(PatientWorkspaceContext);
}
