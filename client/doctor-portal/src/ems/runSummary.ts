/**
 * A run's timeline, read the way a paramedic speaks a handover.
 *
 * The receiving team hears ATMIST — Age, Time, Mechanism, Injuries, Signs,
 * Treatment — and structured handovers cut their questions and the handover's
 * length (RCEM; IMIST-AMBO). Every reading and every medicine keeps its time,
 * as EMS data standards record it, so the trend is visible: was the pressure
 * recovering or falling when they left the road?
 *
 * Nothing is inferred: a section with nothing recorded says so (rule 12).
 */
import type { EmsRun, EmsRunAlert, EmsRunEvent, EmsRunVitals } from '@medichain/shared';

export interface TimedVitals extends EmsRunVitals {
  at: string;
}

export interface TimedEntry {
  at: string;
  text: string;
}

export interface RunSummary {
  /** Dispatch, scene, leaving and handover times, when recorded. */
  times: { dispatched?: string; onScene?: string; leftScene?: string; handedOver?: string };
  mechanism: string | null;
  findings: TimedEntry[];
  vitals: TimedVitals[];
  treatments: TimedEntry[];
  notes: TimedEntry[];
}

const VITAL_KEYS: Array<keyof EmsRunVitals> = [
  'systolic_bp', 'diastolic_bp', 'heart_rate', 'respiratory_rate', 'spo2', 'gcs', 'temperature_c', 'glucose_mmol',
];

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function vitalsOf(payload: Record<string, unknown> | null): EmsRunVitals {
  const out: EmsRunVitals = {};
  for (const key of VITAL_KEYS) {
    const v = payload?.[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/** "Sodium chloride 0.9% 500 mL IV" from a medicine payload. */
export function medicineText(payload: Record<string, unknown> | null): string {
  return [str(payload?.name), str(payload?.dose), str(payload?.route)].filter(Boolean).join(' ');
}

export function summariseRun(run: EmsRun, events: EmsRunEvent[]): RunSummary {
  const ordered = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const first = (kind: EmsRunEvent['kind']) => ordered.find((e) => e.kind === kind)?.occurred_at;
  const summary: RunSummary = {
    times: {
      dispatched: first('dispatched'),
      onScene: first('on_scene'),
      leftScene: first('left_scene'),
      handedOver: first('handed_over'),
    },
    mechanism: run.chief_complaint ?? null,
    findings: [],
    vitals: [],
    treatments: [],
    notes: [],
  };
  for (const e of ordered) {
    const p = e.payload;
    if (e.kind === 'vitals') {
      const v = vitalsOf(p);
      if (Object.keys(v).length) summary.vitals.push({ at: e.occurred_at, ...v });
    } else if (e.kind === 'treatment' && str(p?.name)) {
      summary.treatments.push({ at: e.occurred_at, text: str(p?.name)! });
    } else if (e.kind === 'medication' && medicineText(p)) {
      summary.treatments.push({ at: e.occurred_at, text: medicineText(p) });
    } else if (e.kind === 'on_scene' && str(p?.text)) {
      summary.findings.push({ at: e.occurred_at, text: str(p?.text)! });
    } else if (e.kind === 'note' && str(p?.text)) {
      (p?.finding ? summary.findings : summary.notes).push({ at: e.occurred_at, text: str(p?.text)! });
    }
  }
  return summary;
}

/** One timeline entry's content in a line: "BP 92/58 · HR 118", "Splint left forearm". */
export function describeEvent(e: EmsRunEvent): string {
  const p = e.payload ?? {};
  if (e.kind === 'vitals') {
    const parts = [
      p.systolic_bp !== undefined && p.diastolic_bp !== undefined ? `BP ${p.systolic_bp}/${p.diastolic_bp}` : null,
      p.heart_rate !== undefined ? `HR ${p.heart_rate}` : null,
      p.respiratory_rate !== undefined ? `RR ${p.respiratory_rate}` : null,
      p.spo2 !== undefined ? `SpO₂ ${p.spo2}%` : null,
      p.gcs !== undefined ? `GCS ${p.gcs}` : null,
      p.temperature_c !== undefined ? `${p.temperature_c} °C` : null,
      p.glucose_mmol !== undefined ? `Glucose ${p.glucose_mmol}` : null,
    ].filter(Boolean);
    return parts.join(' · ');
  }
  if (e.kind === 'medication') return medicineText(e.payload);
  if (e.kind === 'treatment') return String(p.name ?? '');
  if (e.kind === 'note' || e.kind === 'on_scene') return String(p.text ?? '');
  return '';
}

type Translate = (key: string, values?: Record<string, string>) => string;

/** A timeline entry's heading: its kind, or which pre-alert was raised or withdrawn. */
export function eventLabel(e: EmsRunEvent, t: Translate): string {
  if (e.kind !== 'alert') return t(`ems.kind.${e.kind}`);
  const alert = t(`ems.alerts.${String(e.payload?.alert ?? '')}`);
  return e.payload?.raised === false ? t('ems.alertWithdrawn', { alert }) : t('ems.alertRaised', { alert });
}

/**
 * The pre-alerts raised: the server's set, with any entries still queued on
 * this device applied in order -- a crew with no signal sees what they tapped.
 */
export function activeAlerts(run: EmsRun, events: Array<EmsRunEvent & { pending?: boolean }>): EmsRunAlert[] {
  const alerts = [...(run.alerts ?? [])];
  for (const e of events) {
    if (e.kind !== 'alert' || !e.pending) continue;
    const alert = e.payload?.alert as EmsRunAlert;
    const at = alerts.indexOf(alert);
    if (at >= 0) alerts.splice(at, 1);
    if (e.payload?.raised === true) alerts.push(alert);
  }
  return alerts;
}

/** The latest reading of each vital, for pre-filling triage — with its time. */
export function latestVitals(summary: RunSummary): (EmsRunVitals & { at: string }) | null {
  if (!summary.vitals.length) return null;
  return summary.vitals[summary.vitals.length - 1];
}
