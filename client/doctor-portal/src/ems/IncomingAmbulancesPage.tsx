/**
 * Ambulances coming to this hospital, summarised the way paramedics speak a
 * handover (ATMIST), with one button to receive the patient.
 *
 * Only runs whose destination is the caller's own facility appear (the server
 * filters; nationwide lists were the old behaviour). Receiving opens the
 * patient in the workspace at triage, with the ambulance story beside it.
 * Design: docs/FRONTEND_WORKFLOW_AND_MOTION_PLAN.md §3.3 (mockups c8, c9).
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck } from 'lucide-react';
import {
  formatDateOnly,
  formatTimestamp,
  getApiErrorMessage,
  listIncomingEmsRuns,
  receiveEmsRun,
  useSubmission,
  useTranslation,
} from '@medichain/shared';
import type { EmsRunWithEvents } from '@medichain/shared';
import { findDirectoryPatient, type Patient } from '../components/PatientSelect';
import { describeEvent, summariseRun } from './runSummary';
import { workspacePath } from '../workspace/forms';
import { ageInYears, initials } from '../workspace/identity';

const REFRESH_MS = 20_000;

/**
 * The board's order: ambulances at the door first (longest waiting at the
 * top), then those on their way by arrival time; one with no ETA goes last.
 */
export function boardOrder(runs: EmsRunWithEvents[]): EmsRunWithEvents[] {
  const arrived = (r: EmsRunWithEvents) => r.status === 'arrived';
  const when = (r: EmsRunWithEvents) => (arrived(r) ? r.updated_at : r.eta) ?? '\uffff';
  return [...runs].sort((a, b) => Number(arrived(b)) - Number(arrived(a)) || when(a).localeCompare(when(b)));
}

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
        {runs && boardOrder(runs).map((run) => <IncomingCard key={run.id} run={run} onChanged={load} />)}
      </ul>
    </div>
  );
}

function IncomingCard({ run, onChanged }: { run: EmsRunWithEvents; onChanged: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [person, setPerson] = useState<Patient | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const submission = useSubmission(`ems-receive-${run.id}`);
  const summary = summariseRun(run, run.events);

  useEffect(() => {
    if (!run.patient_id) return;
    let active = true;
    findDirectoryPatient(run.patient_id).then((p) => active && setPerson(p), () => undefined);
    return () => { active = false; };
  }, [run.patient_id]);

  const receive = async () => {
    const result = await submission.run({ run: run.id }, () => receiveEmsRun(run.id));
    if (result.kind === 'failed') return;
    // One fewer ambulance: the sidebar's count should not wait for its next poll.
    window.dispatchEvent(new Event('medichain:sidebar-refresh'));
    if (run.patient_id) navigate(workspacePath(run.patient_id, 'triage'), { state: { fromRun: run.id } });
    else onChanged();
  };

  const arrived = run.status === 'arrived';
  const name = person?.full_name ?? null;
  const years = ageInYears(person?.date_of_birth);
  const sex = person?.gender ?? null;
  const unit = crewLine(run, t);
  // Who this is, the way a receiving team matches a person to a record.
  const identity = run.patient_id
    ? [sex, years !== null ? t('workspace.years', { n: String(years) }) : null,
      person?.date_of_birth ? t('workspace.born', { date: formatDateOnly(person.date_of_birth) }) : null,
      person?.health_id ? t('workspace.healthId', { id: person.health_id }) : null, unit]
    : [unit, t('ems.notIdentifiedYet')];
  const ageLine = run.patient_id
    ? [years !== null ? t('workspace.years', { n: String(years) }) : null, sex].filter(Boolean).join(' · ')
    : run.unidentified_description ?? '';
  return (
    <li className={`mc-slide-in grid gap-0 overflow-hidden rounded-2xl border bg-surface md:grid-cols-[minmax(0,1fr)_300px] ${arrived ? 'border-brand' : 'border-border'}`}>
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <span aria-hidden="true"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold ${run.patient_id ? 'bg-brand-subtle text-brand-subtle-fg' : 'border-2 border-dashed border-border-strong text-content-muted'}`}>
            {run.patient_id ? initials(name ?? '') : '?'}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-content">{name ?? run.unidentified_description ?? t('ems.unidentified')}</h2>
            {/* Each part wraps whole: a Health ID split across lines cannot be read back. */}
            <p className="text-sm text-content-secondary">
              {identity.filter(Boolean).map((part, i) => (
                <Fragment key={i}>{i > 0 && ' · '}<span className="inline-block max-w-full [overflow-wrap:anywhere]">{part}</span></Fragment>
              ))}
            </p>
          </div>
          <span className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold ${arrived ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'}`}>
            {arrived ? t('ems.arrivedAt', { time: formatTimestamp(summary.times.handedOver ?? run.updated_at, { timeStyle: 'short' }) })
              : run.eta ? t('ems.eta', { time: formatTimestamp(run.eta, { timeStyle: 'short' }) }) : t('ems.status.en_route')}
          </span>
        </div>
        <dl className="grid grid-cols-[1.5rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-bold text-brand" title={t('ems.atmist.age')}>A</dt>
          <dd className="text-content">{ageLine || t('ems.notRecorded')}</dd>
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
        {run.events.length > 0 && (
          <div>
            <button type="button" onClick={() => setTimelineOpen((v) => !v)} aria-expanded={timelineOpen}
              aria-controls={`timeline-${run.id}`}
              className="text-sm font-semibold text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {timelineOpen ? t('ems.hideTimeline') : t('ems.fullTimeline', { n: String(run.events.length) })}
            </button>
            {timelineOpen && <RunTimeline id={`timeline-${run.id}`} run={run} />}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 border-t border-border p-4 md:border-l md:border-t-0">
        <VitalsTrend summary={summary} />
        {submission.status === 'failed' && (
          <p role="alert" className="text-sm text-critical-subtle-fg">{getApiErrorMessage(submission.error, t('ems.receiveFailed'))}</p>
        )}
        {/* An ambulance still on its way can be received too -- the crew may not
            have tapped "handed over" -- but it is not the board's main action. */}
        <button type="button" onClick={() => void receive()} aria-disabled={submission.status === 'saving' || undefined}
          className={arrived
            ? 'mc-press mt-auto min-h-[52px] rounded-xl bg-brand px-4 text-lg font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus'
            : 'mt-auto min-h-[44px] rounded-lg border border-border-interactive px-3 text-sm font-semibold text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus'}>
          {submission.status === 'saving' ? t('common.saving') : arrived ? t('ems.received') : t('ems.receivedEarly')}
        </button>
      </div>
    </li>
  );
}

/** "Unit 14 (P. Mokoena)", whichever parts the crew recorded; null when neither. */
function crewLine(run: EmsRunWithEvents, t: (key: string, values?: Record<string, string>) => string): string | null {
  const crew = run.crew.filter((c) => c.trim()).join(', ');
  if (run.unit_number) return crew ? `${t('ems.unit', { unit: run.unit_number })} (${crew})` : t('ems.unit', { unit: run.unit_number });
  return crew || null;
}

/** Every entry the crew made, oldest first -- the order a handover is told in. */
function RunTimeline({ id, run }: { id: string; run: EmsRunWithEvents }) {
  const { t } = useTranslation();
  const ordered = [...run.events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  return (
    <ol id={id} className="mt-2 space-y-1 border-l-2 border-border-strong pl-3 text-sm">
      {ordered.map((e) => (
        <li key={e.id}>
          <span className="mr-2 tabular-nums text-content-muted">{formatTimestamp(e.occurred_at, { timeStyle: 'short' })}</span>
          <span className="font-semibold text-content">{t(`ems.kind.${e.kind}`)}</span>
          {describeEvent(e) && <span className="text-content-secondary"> · {describeEvent(e)}</span>}
        </li>
      ))}
    </ol>
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
