/**
 * The patient's latest vital signs, beside the SOAP note's Objective section
 * (mockup c4: "From vitals 09:02").
 *
 * For reference only: nothing here is copied into the note, so the note never
 * claims a measurement its author did not take or check. A value nobody
 * recorded is left out rather than shown as a blank or a zero, and a reading
 * from an earlier day says so, so an old set never passes for this visit's.
 */
import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { formatTimestamp, getPatientLatestVitals, useTranslation } from '@medichain/shared';

interface Reading {
  timestamp: number;
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  heart_rate?: number | null;
  respiratory_rate?: number | null;
  oxygen_saturation?: number | null;
  temperature_celsius?: number | null;
}

type State =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'none' }
  | { kind: 'reading'; reading: Reading };

const known = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** When the reading was taken: the time alone today, the date as well otherwise. */
export function whenTaken(epochSeconds: number, now: Date = new Date()): string {
  const at = new Date(epochSeconds * 1000);
  const today = at.toDateString() === now.toDateString();
  return formatTimestamp(at, today ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' });
}

/** The measured values as "label value" pairs, in the order a clinician reads them. */
export function vitalPairs(r: Reading, t: (key: string) => string): [string, string][] {
  const pairs: [string, string][] = [];
  if (known(r.systolic_bp) && known(r.diastolic_bp)) pairs.push([t('docSOAPNote.vitalBp'), `${r.systolic_bp}/${r.diastolic_bp}`]);
  if (known(r.heart_rate)) pairs.push([t('docSOAPNote.vitalPulse'), String(r.heart_rate)]);
  if (known(r.respiratory_rate)) pairs.push([t('docSOAPNote.vitalResp'), String(r.respiratory_rate)]);
  if (known(r.oxygen_saturation)) pairs.push([t('docSOAPNote.vitalSpo2'), `${r.oxygen_saturation}%`]);
  if (known(r.temperature_celsius)) pairs.push([t('docSOAPNote.vitalTemp'), `${r.temperature_celsius.toFixed(1)} °C`]);
  return pairs;
}

export function LatestVitalsStrip({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    getPatientLatestVitals(patientId).then(
      (body) => {
        if (!active) return;
        const reading = (body as { reading?: Reading | null }).reading;
        setState(reading ? { kind: 'reading', reading } : { kind: 'none' });
      },
      () => active && setState({ kind: 'failed' }),
    );
    return () => { active = false; };
  }, [patientId]);

  if (state.kind === 'loading') return null;
  const box = 'mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm';
  if (state.kind === 'failed') {
    return <p role="status" className={`${box} text-content-secondary`}>{t('docSOAPNote.vitalsFailed')}</p>;
  }
  const pairs = state.kind === 'reading' ? vitalPairs(state.reading, t) : [];
  if (state.kind === 'none' || pairs.length === 0) {
    return <p className={`${box} text-content-muted`}>{t('docSOAPNote.noVitals')}</p>;
  }
  return (
    <div className={box} aria-label={t('docSOAPNote.latestVitals')} role="group">
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-content-muted">
        <Activity size={14} aria-hidden="true" />
        {t('docSOAPNote.fromVitals', { when: whenTaken(state.reading.timestamp) })}
      </span>
      {pairs.map(([label, value]) => (
        <span key={label} className="text-content-secondary">
          {label} <b className="font-semibold text-content">{value}</b>
        </span>
      ))}
      <span className="w-full text-xs text-content-muted">{t('docSOAPNote.vitalsReferenceOnly')}</span>
    </div>
  );
}
