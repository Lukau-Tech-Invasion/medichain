/**
 * The ambulance story, pinned above whatever the receiving team does next
 * (c9; UX plan WP 2.6): what happened, how the vitals moved from the crew's
 * first reading to their last, what was given, and the whole timeline one tap
 * away. It stays on every form of the chart, because triage, the trauma
 * assessment and the first orders are all written against it.
 *
 * Only a run from the last 24 hours is shown; an older one is history, read
 * from the chart.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Truck } from 'lucide-react';
import { getPatientEmsRuns, useTranslation } from '@medichain/shared';
import type { EmsRunWithEvents } from '@medichain/shared';
import { usePatientWorkspace } from '../workspace/PatientWorkspaceContext';
import { firstAndLatest, handoverComplaint, summariseRun, type RunSummary, type TimedVitals, type VitalKey } from './runSummary';
import { RunTimeline } from './RunTimeline';

const RECENT_MS = 24 * 60 * 60 * 1000;

/** The patient's most recent run, if it started within the last day. */
export function recentRun(runs: EmsRunWithEvents[], now = Date.now()): EmsRunWithEvents | null {
  const recent = runs
    .filter((r) => now - Date.parse(r.created_at) < RECENT_MS)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return recent[0] ?? null;
}

/**
 * Reads the patient's recent run. `undefined` while it is being read, `null`
 * when there is none -- or the read failed: the band is a convenience, and the
 * run is still on the chart's own ambulance history.
 */
export function useFetchedRecentRun(patientId: string | null | undefined, enabled = true): EmsRunWithEvents | null | undefined {
  const [run, setRun] = useState<EmsRunWithEvents | null | undefined>(undefined);
  useEffect(() => {
    setRun(undefined);
    if (!patientId || !enabled) return undefined;
    let active = true;
    getPatientEmsRuns(patientId).then(
      (r) => active && setRun(Array.isArray(r?.runs) ? recentRun(r.runs) : null),
      () => active && setRun(null),
    );
    return () => { active = false; };
  }, [patientId, enabled]);
  return run;
}

/**
 * The recent run for a patient: the workspace's copy when this patient is the
 * one open there (read once for the whole chart), otherwise read here.
 */
export function useRecentAmbulanceRun(patientId: string | null | undefined): EmsRunWithEvents | null | undefined {
  const workspace = usePatientWorkspace();
  const shared = Boolean(patientId) && workspace?.patientId === patientId;
  const fetched = useFetchedRecentRun(patientId, !shared);
  return shared ? workspace?.ambulanceRun : fetched;
}

const MOVES: Array<{ label: string; key: VitalKey; unit?: string }> = [
  { label: 'HR', key: 'heart_rate' },
  { label: 'SpO₂', key: 'spo2', unit: '%' },
  { label: 'GCS', key: 'gcs' },
];

/** "BP 92/58 → 104/66 · HR 118 → 106 · SpO₂ 91 → 96%", the latest emphasised. */
function VitalsMoves({ summary }: { summary: RunSummary }) {
  const parts: Array<{ label: string; first: string | null; latest: string }> = [];
  const withBp = summary.vitals.filter((v) => v.systolic_bp !== undefined);
  if (withBp.length) {
    const bp = (v: TimedVitals) => (v.diastolic_bp === undefined ? `${v.systolic_bp}` : `${v.systolic_bp}/${v.diastolic_bp}`);
    const first = withBp[0];
    const latest = withBp[withBp.length - 1];
    parts.push({ label: 'BP', first: first === latest ? null : bp(first), latest: bp(latest) });
  }
  for (const m of MOVES) {
    const r = firstAndLatest(summary, m.key);
    if (!r) continue;
    const unit = m.unit ?? '';
    parts.push({ label: m.label, first: r.first.at === r.latest.at ? null : `${r.first.value}`, latest: `${r.latest.value}${unit}` });
  }
  if (!parts.length) return null;
  return (
    <span>
      {parts.map((p, i) => (
        <span key={p.label}>
          {i > 0 && ' · '}
          {p.label} {p.first !== null && <>{p.first} → </>}<b>{p.latest}</b>
        </span>
      ))}
    </span>
  );
}

export function AmbulanceBand({ run }: { run: EmsRunWithEvents | null | undefined }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!run) return null;
  const summary = summariseRun(run, run.events);
  const complaint = handoverComplaint(summary);
  const treatments = summary.treatments.map((x) => x.text).join(' · ');
  const timelineId = `ambulance-timeline-${run.id}`;
  return (
    <aside aria-label={t('emsStrip.label')} className="shrink-0 border-b border-border">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 bg-brand-subtle px-4 py-2 text-sm text-brand-subtle-fg lg:px-6">
        <span className="inline-flex items-center gap-2 font-bold"><Truck className="h-4 w-4" aria-hidden="true" />{t('emsStrip.title')}</span>
        {complaint && <span>{complaint}</span>}
        <VitalsMoves summary={summary} />
        {treatments && <span>{treatments}</span>}
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={timelineId}
          className="mc-press ml-auto inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-current px-3 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {t('emsStrip.fullTimeline')}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>
      {open && <div className="max-h-64 overflow-y-auto bg-surface px-4 pb-3 lg:px-6"><RunTimeline id={timelineId} run={run} /></div>}
    </aside>
  );
}
