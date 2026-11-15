/**
 * Triage from the ambulance's values (c9): the crew's latest reading of each
 * vital, and the complaint as they handed it over, put into the triage form --
 * each labelled with where it came from until somebody changes it.
 *
 * Only empty fields are filled; what the nurse typed is never overwritten.
 * Values arrive by a tap on "Use ambulance values", or by themselves when the
 * chart was opened from "Received" on the incoming board -- the hand-over is
 * the moment the team takes on the crew's findings. Either way the form says
 * the values must be checked, and nothing it does not hold is sent (rule 9).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EmsRunWithEvents } from '@medichain/shared';
import { useRecentAmbulanceRun } from './AmbulanceRunStrip';
import { handoverComplaint, latestReadings, summariseRun, type VitalKey } from './runSummary';

export type TriageVitalField =
  | 'heart_rate' | 'respiratory_rate' | 'bp_systolic' | 'bp_diastolic' | 'temperature_celsius'
  | 'oxygen_saturation' | 'gcs_score' | 'blood_glucose';

/** The triage field each crew reading fills. */
export const CREW_TO_TRIAGE: Record<TriageVitalField, VitalKey> = {
  heart_rate: 'heart_rate',
  respiratory_rate: 'respiratory_rate',
  bp_systolic: 'systolic_bp',
  bp_diastolic: 'diastolic_bp',
  temperature_celsius: 'temperature_c',
  oxygen_saturation: 'spo2',
  gcs_score: 'gcs',
  blood_glucose: 'glucose_mmol',
};

/** Where a value came from: the time the crew took it, or the hand-over (complaint). */
export type Carried = Partial<Record<TriageVitalField | 'chief_complaint', string | true>>;

export interface AmbulanceTriageValues {
  vitals: Partial<Record<TriageVitalField, { value: number; at: string }>>;
  complaint: string | null;
}

export function ambulanceTriageValues(run: EmsRunWithEvents): AmbulanceTriageValues {
  const summary = summariseRun(run, run.events);
  const readings = latestReadings(summary);
  const vitals: AmbulanceTriageValues['vitals'] = {};
  for (const [field, key] of Object.entries(CREW_TO_TRIAGE) as Array<[TriageVitalField, VitalKey]>) {
    const r = readings[key];
    if (r) vitals[field] = r;
  }
  return { vitals, complaint: handoverComplaint(summary) };
}

type Vitals = Record<TriageVitalField, number | null>;

export function useAmbulanceTriage<V extends Vitals>(args: {
  patientId: string | null | undefined;
  vitals: V;
  setVitals: (update: (v: V) => V) => void;
  complaint: string;
  setComplaint: (value: string) => void;
  /** The run the chart was opened from on the incoming board, if any. */
  fromRun?: string | null;
}) {
  const { patientId, vitals, setVitals, complaint, setComplaint, fromRun } = args;
  const run = useRecentAmbulanceRun(patientId);
  const values = useMemo(() => (run ? ambulanceTriageValues(run) : null), [run]);
  const [carried, setCarried] = useState<Carried>({});
  // A new patient on the standalone page starts with nothing carried.
  useEffect(() => setCarried({}), [patientId]);

  const fillable = (Object.keys(values?.vitals ?? {}) as TriageVitalField[]).filter((f) => vitals[f] === null);
  const complaintFillable = Boolean(values?.complaint) && !complaint.trim();
  const available = fillable.length > 0 || complaintFillable;

  const apply = useCallback(() => {
    if (!values) return;
    const next: Carried = {};
    for (const field of fillable) next[field] = values.vitals[field]!.at;
    setVitals((v) => {
      const filled = { ...v };
      for (const field of fillable) if (filled[field] === null) filled[field] = values.vitals[field]!.value as V[TriageVitalField];
      return filled;
    });
    if (complaintFillable && values.complaint) {
      setComplaint(values.complaint);
      next.chief_complaint = true;
    }
    setCarried((c) => ({ ...c, ...next }));
  }, [values, fillable, complaintFillable, setVitals, setComplaint]);

  // Opened from "Received": the crew's values are put in once, by themselves.
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoDone.current || !run || !fromRun || run.id !== fromRun) return;
    autoDone.current = true;
    apply();
  }, [run, fromRun, apply]);

  /** A field the nurse changed is theirs now, not the crew's. */
  const forget = useCallback((field: keyof Carried) => {
    setCarried((c) => {
      if (!(field in c)) return c;
      const next = { ...c };
      delete next[field];
      return next;
    });
  }, []);

  return { available, carried, apply, forget, clear: () => setCarried({}) };
}
