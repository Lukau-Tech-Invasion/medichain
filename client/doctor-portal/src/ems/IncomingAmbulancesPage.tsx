/**
 * Ambulances coming to this hospital, summarised the way paramedics speak a
 * handover (ATMIST), with one button to receive the patient.
 *
 * Only runs whose destination is the caller's own facility appear (the server
 * filters; nationwide lists were the old behaviour). Receiving opens the
 * patient in the workspace at triage, with the ambulance story beside it.
 * Design: docs/FRONTEND_WORKFLOW_AND_MOTION_PLAN.md §3.3 (mockups c8, c9).
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck } from 'lucide-react';
import {
  formatTimestamp,
  getApiErrorMessage,
  listIncomingEmsRuns,
  receiveEmsRun,
  useSubmission,
  useTranslation,
} from '@medichain/shared';
import type { EmsRunWithEvents } from '@medichain/shared';
import { findDirectoryPatient } from '../components/PatientSelect';
import { summariseRun } from './runSummary';
import { workspacePath } from '../workspace/forms';

const REFRESH_MS = 20_000;

export default function IncomingAmbulancesPage() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<EmsRunWithEvents[] | null>(null);
  const [facility, setFacility] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    listIncomingEmsRuns().then(
      (r) => { setRuns(r.runs); setFacility(r.facility_id); setError(''); },
      (e) => setError(getApiErrorMessage(e, t('ems.incomingFailed'))),
    );
  }, [t]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    window.addEventListener('focus', load);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', load); };
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-content"><Truck className="h-7 w-7 text-critical" aria-hidden="true" />{t('ems.incomingTitle')}</h1>
        <p className="text-sm text-content-muted">{t('ems.incomingSubtitle')}</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-critical-subtle p-3 text-critical-subtle-fg">{error}</p>}
      {runs === null && !error && <p role="status" className="text-content-muted">{t('ems.loading')}</p>}
      {runs !== null && facility === null && (
        <p className="rounded-xl border border-border bg-surface p-4 text-content-secondary">{t('ems.noFacility')}</p>
      )}
      {runs?.length === 0 && facility !== null && (
        <p className="rounded-xl border border-border bg-surface p-4 text-content-secondary">{t('ems.noneIncoming')}</p>
      )}
      <ul className="space-y-4" aria-live="polite">
        {runs?.map((run) => <IncomingCard key={run.id} run={run} onChanged={load} />)}
      </ul>
    </div>
  );
}

function IncomingCard({ run, onChanged }: { run: EmsRunWithEvents; onChanged: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState<string | null>(null);
  const submission = useSubmission(`ems-receive-${run.id}`);
  const summary = summariseRun(run, run.events);

  useEffect(() => {
    if (!run.patient_id) return;
    let active = true;
    findDirectoryPatient(run.patient_id).then((p) => active && setName(p?.full_name ?? null), () => undefined);
    return () => { active = false; };
  }, [run.patient_id]);

  const receive = async () => {
    const result = await submission.run({ run: run.id }, () => receiveEmsRun(run.id));
    if (result.kind === 'failed') return;
    if (run.patient_id) navigate(workspacePath(run.patient_id, 'triage'), { state: { fromRun: run.id } });
    else onChanged();
  };

  const arrived = run.status === 'arrived';
  return (
    <li className={`mc-slide-in grid gap-0 overflow-hidden rounded-2xl border bg-surface md:grid-cols-[1fr_300px] ${arrived ? 'border-brand' : 'border-border'}`}>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold text-content">{name ?? run.unidentified_description ?? t('ems.unidentified')}</h2>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${arrived ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'}`}>
            {arrived ? t('ems.arrivedAt', { time: formatTimestamp(summary.times.handedOver ?? run.updated_at, { timeStyle: 'short' }) })
              : run.eta ? t('ems.eta', { time: formatTimestamp(run.eta, { timeStyle: 'short' }) }) : t('ems.status.en_route')}
          </span>
        </div>
        <dl className="grid grid-cols-[1.5rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-bold text-brand" title={t('ems.atmist.time')}>T</dt>
          <dd className="text-content">
            {[summary.times.dispatched && t('ems.timeCall', { time: formatTimestamp(summary.times.dispatched, { timeStyle: 'short' }) }),
              summary.times.onScene && t('ems.timeScene', { time: formatTimestamp(summary.times.onScene, { timeStyle: 'short' }) }),
              summary.times.leftScene && t('ems.timeLeft', { time: formatTimestamp(summary.times.leftScene, { timeStyle: 'short' }) })]
              .filter(Boolean).join(' · ') || t('ems.notRecorded')}
          </dd>
          <dt className="font-bold text-brand" title={t('ems.atmist.mechanism')}>M</dt>
          <dd className="text-content">{summary.mechanism ?? t('ems.notRecorded')}</dd>
          <dt className="font-bold text-brand" title={t('ems.atmist.injuries')}>I</dt>
          <dd className="text-content">{summary.findings.map((f) => f.text).join(' · ') || t('ems.notRecorded')}</dd>
          <dt className="font-bold text-brand" title={t('ems.atmist.treatment')}>T</dt>
          <dd className="text-content">
            {summary.treatments.map((x) => `${x.text} ${formatTimestamp(x.at, { timeStyle: 'short' })}`).join(' · ') || t('ems.notRecorded')}
          </dd>
        </dl>
      </div>
      <div className="flex flex-col gap-3 border-t border-border p-4 md:border-l md:border-t-0">
        <VitalsTrend summary={summary} />
        {submission.status === 'failed' && (
          <p role="alert" className="text-sm text-critical-subtle-fg">{getApiErrorMessage(submission.error, t('ems.receiveFailed'))}</p>
        )}
        <button type="button" onClick={() => void receive()} aria-disabled={submission.status === 'saving' || undefined}
          className="mc-press mt-auto min-h-[52px] rounded-xl bg-brand px-4 text-lg font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {submission.status === 'saving' ? t('common.saving') : t('ems.received')}
        </button>
      </div>
    </li>
  );
}

function VitalsTrend({ summary }: { summary: ReturnType<typeof summariseRun> }) {
  const { t } = useTranslation();
  const rows = summary.vitals.slice(-3);
  if (!rows.length) return <p className="text-sm text-content-muted">{t('ems.noVitals')}</p>;
  const line = (label: string, pick: (v: (typeof rows)[number]) => string | undefined) => (
    <tr>
      <th scope="row" className="pr-3 text-left font-normal text-content-muted">{label}</th>
      {rows.map((v) => <td key={v.at} className="px-2 text-right tabular-nums text-content">{pick(v) ?? '—'}</td>)}
    </tr>
  );
  return (
    <table className="text-sm">
      <caption className="sr-only">{t('ems.vitalsTrend')}</caption>
      <thead>
        <tr><td />{rows.map((v) => <th key={v.at} scope="col" className="px-2 text-right font-semibold text-content-muted">{formatTimestamp(v.at, { timeStyle: 'short' })}</th>)}</tr>
      </thead>
      <tbody>
        {line('BP', (v) => (v.systolic_bp !== undefined && v.diastolic_bp !== undefined ? `${v.systolic_bp}/${v.diastolic_bp}` : undefined))}
        {line('HR', (v) => v.heart_rate?.toString())}
        {line('SpO₂', (v) => (v.spo2 !== undefined ? `${v.spo2}%` : undefined))}
        {line('GCS', (v) => v.gcs?.toString())}
      </tbody>
    </table>
  );
}
