/**
 * "Arrived by ambulance": the crew's run, pinned where the receiving team
 * works on the patient (UX plan WP 2.6). Shows the latest crew vitals and,
 * where the form can take them, one tap to use them -- the nurse confirms or
 * corrects each value rather than retyping what the crew already measured.
 *
 * Only a run from the last 24 hours is shown; an older one is history, read
 * from the chart.
 */
import { useEffect, useState } from 'react';
import { Siren } from 'lucide-react';
import { formatTimestamp, getPatientEmsRuns, useTranslation } from '@medichain/shared';
import type { EmsRunVitals, EmsRunWithEvents } from '@medichain/shared';
import { latestVitals, summariseRun } from './runSummary';

const RECENT_MS = 24 * 60 * 60 * 1000;

/** The patient's most recent run, if it started within the last day. */
export function recentRun(runs: EmsRunWithEvents[], now = Date.now()): EmsRunWithEvents | null {
  const recent = runs
    .filter((r) => now - Date.parse(r.created_at) < RECENT_MS)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return recent[0] ?? null;
}

export function AmbulanceRunStrip({ patientId, onUseVitals }: {
  patientId: string | null | undefined;
  onUseVitals?: (vitals: EmsRunVitals) => void;
}) {
  const { t } = useTranslation();
  const [run, setRun] = useState<EmsRunWithEvents | null>(null);

  useEffect(() => {
    setRun(null);
    if (!patientId) return undefined;
    let active = true;
    // A failed or malformed read shows nothing: the strip is a convenience,
    // and the run is still on the chart's own ambulance history.
    getPatientEmsRuns(patientId).then(
      (r) => active && setRun(Array.isArray(r?.runs) ? recentRun(r.runs) : null),
      () => undefined,
    );
    return () => { active = false; };
  }, [patientId]);

  if (!run) return null;
  const summary = summariseRun(run, run.events);
  const vitals = latestVitals(summary);
  const parts = vitals ? [
    vitals.systolic_bp !== undefined ? `BP ${vitals.systolic_bp}${vitals.diastolic_bp !== undefined ? `/${vitals.diastolic_bp}` : ''}` : null,
    vitals.heart_rate !== undefined ? `HR ${vitals.heart_rate}` : null,
    vitals.respiratory_rate !== undefined ? `RR ${vitals.respiratory_rate}` : null,
    vitals.spo2 !== undefined ? `SpO₂ ${vitals.spo2}%` : null,
    vitals.gcs !== undefined ? `GCS ${vitals.gcs}` : null,
  ].filter(Boolean) : [];

  return (
    <aside aria-label={t('emsStrip.label')} className="flex flex-wrap items-center gap-3 rounded-xl border border-caution bg-caution-subtle p-3 text-caution-subtle-fg">
      <Siren className="h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {t('emsStrip.arrived', { time: formatTimestamp(summary.times.handedOver ?? run.created_at) })}
          {summary.mechanism ? ` · ${summary.mechanism}` : ''}
        </p>
        {vitals && (
          <p className="text-sm">{t('emsStrip.lastVitals', { time: formatTimestamp(vitals.at), values: parts.join(' · ') })}</p>
        )}
      </div>
      {vitals && onUseVitals && (
        <button type="button" onClick={() => onUseVitals(vitals)}
          className="mc-press min-h-[44px] rounded-lg border border-current px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {t('emsStrip.useVitals')}
        </button>
      )}
    </aside>
  );
}
