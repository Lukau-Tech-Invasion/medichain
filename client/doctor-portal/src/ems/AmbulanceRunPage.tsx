/**
 * The paramedic's run: scan once, tap as you work, hand over with one button.
 *
 * Every tap is an entry on the run's timeline with its own time; leaving the
 * scene with a destination sends the pre-alert; "Hand over" needs nothing
 * typed, because everything already recorded is the handover.
 * Design: docs/FRONTEND_WORKFLOW_AND_MOTION_PLAN.md §3 (mockups c6, c7).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, Stethoscope, FileText, MapPin, Send, Syringe, Truck } from 'lucide-react';
import {
  addEmsRunEvent,
  confirmDialog,
  createEmsRun,
  formatTimestamp,
  getApiErrorMessage,
  getEmsRun,
  listOwnEmsRuns,
  useSubmission,
  useTranslation,
} from '@medichain/shared';
import { EMS_RUN_ALERTS } from '@medichain/shared';
import type { AddEmsRunEventBody, EmsRun, EmsRunAlert } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import { addPendingEvent, newRunId, putLocalRun, putRun, useLocalRun, type LocalEvent } from './runStore';
import { usePatientStore } from '../store/patientStore';
import { EntrySheet, type EntryKind } from './EntrySheet';
import { LeaveSceneSheet } from './LeaveSceneSheet';
import { activeAlerts, describeEvent, eventLabel } from './runSummary';
import { crewBody, readCrewDetails, saveCrewDetails, type CrewDetails } from './crewDetails';

const OPEN: EmsRun['status'][] = ['in_progress', 'en_route', 'arrived'];

export default function AmbulanceRunPage() {
  const { runId } = useParams<{ runId?: string }>();
  return runId ? <RunView runId={runId} /> : <StartRun />;
}

/** No run open: resume one, or start one from the patient just scanned. */
function StartRun() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const scanned = usePatientStore((s) => s.currentEmergency);
  const [runs, setRuns] = useState<EmsRun[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const submission = useSubmission('ems-run-start');

  useEffect(() => {
    listOwnEmsRuns().then((r) => setRuns(r.runs), (e) => setLoadError(getApiErrorMessage(e, t('ems.loadFailed'))));
  }, [t]);

  const userId = useAuthStore((s) => s.user?.userId);
  const [crewDetails, setCrewDetails] = useState<CrewDetails>(() => readCrewDetails(userId));
  const [description, setDescription] = useState('');
  const start = async (patientId?: string) => {
    // The id is chosen here so a run can start with no signal; the server
    // stores it insert-only, so a chosen id can never overwrite another run.
    const crew = crewBody(crewDetails);
    // A description is for a patient nobody has identified; a scanned card names them.
    const described = !patientId && description.trim() ? { unidentified_description: description.trim() } : {};
    const body = { id: newRunId(), ...crew, ...described, ...(patientId ? { patient_id: patientId } : {}) };
    saveCrewDetails(userId, crewDetails);
    const result = await submission.run(body, () => createEmsRun(body));
    if (result.kind === 'saved') putRun(result.value);
    if (result.kind === 'queued') {
      const now = new Date().toISOString();
      putLocalRun({
        id: body.id, status: 'in_progress', created_by: userId ?? '', crew: crew.crew ?? [], unit_number: crew.unit_number ?? null,
        patient_id: patientId ?? null, unidentified_description: described.unidentified_description ?? null,
        created_at: now, updated_at: now,
      });
    }
    if (result.kind === 'saved' || result.kind === 'queued') navigate(`/ems-run/${encodeURIComponent(body.id)}`);
  };

  const open = (runs ?? []).filter((r) => OPEN.includes(r.status));
  return (
    <div className="mx-auto max-w-xl space-y-5 p-4">
      <h1 className="flex items-center gap-2 text-2xl font-bold text-content">
        <Truck className="h-7 w-7 text-critical" aria-hidden="true" /> {t('ems.title')}
      </h1>
      {loadError && <p role="alert" className="rounded-lg bg-critical-subtle p-3 text-sm text-critical-subtle-fg">{loadError}</p>}
      {open.length > 0 && (
        <section aria-labelledby="open-runs" className="space-y-2">
          <h2 id="open-runs" className="text-sm font-semibold uppercase tracking-wide text-content-muted">{t('ems.openRuns')}</h2>
          {open.map((r) => (
            <button key={r.id} type="button" onClick={() => navigate(`/ems-run/${encodeURIComponent(r.id)}`)}
              className="mc-press flex min-h-[56px] w-full items-center justify-between rounded-xl border border-border bg-surface px-4 text-left hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <span className="font-semibold text-content">{r.destination_name ?? t('ems.noDestinationYet')}</span>
              <span className="text-sm text-content-muted">{t(`ems.status.${r.status}`)} · {formatTimestamp(r.created_at, { timeStyle: 'short' })}</span>
            </button>
          ))}
        </section>
      )}
      <section aria-labelledby="start-run" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <h2 id="start-run" className="text-lg font-semibold text-content">{t('ems.startTitle')}</h2>
        {/* Shown to the receiving hospital; kept on this device for the next run.
            ux-allow(no-form): two start buttons share these fields, so Enter has no single action to submit */}
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <label className="block text-sm font-semibold text-content">
            {t('ems.unitLabel')}
            <input value={crewDetails.unit} onChange={(e) => setCrewDetails((d) => ({ ...d, unit: e.target.value }))}
              maxLength={40} autoComplete="off"
              className="mt-1 min-h-[48px] w-full rounded-lg border border-border-interactive bg-surface px-3 text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
          </label>
          <label className="block text-sm font-semibold text-content">
            {t('ems.crewLabel')}
            <input value={crewDetails.crew} onChange={(e) => setCrewDetails((d) => ({ ...d, crew: e.target.value }))}
              maxLength={300} autoComplete="off" aria-describedby="crew-hint"
              className="mt-1 min-h-[48px] w-full rounded-lg border border-border-interactive bg-surface px-3 text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
            <span id="crew-hint" className="mt-1 block text-xs font-normal text-content-muted">{t('ems.crewHint')}</span>
          </label>
        </div>
        {scanned ? (
          <button type="button" onClick={() => void start(scanned.patientId)}
            className="mc-press flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-lg font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {t('ems.startForScanned', { name: scanned.fullName ?? t('ems.scannedPatient') })}
          </button>
        ) : (
          <button type="button" onClick={() => navigate('/emergency', { state: { returnTo: '/ems-run' } })}
            className="mc-press flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-lg font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {t('ems.scanCard')}
          </button>
        )}
        <div className="space-y-2 rounded-xl border border-border p-3">
          <label className="block text-sm font-semibold text-content">
            {t('ems.descriptionLabel')}
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} autoComplete="off"
              aria-describedby="description-hint"
              className="mt-1 min-h-[48px] w-full rounded-lg border border-border-interactive bg-surface px-3 text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
            <span id="description-hint" className="mt-1 block text-xs font-normal text-content-muted">{t('ems.descriptionHint')}</span>
          </label>
          <button type="button" onClick={() => void start()}
            className="min-h-[48px] w-full rounded-xl border border-border-interactive px-4 font-semibold text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {t('ems.startUnidentified')}
          </button>
        </div>
        {submission.status === 'failed' && (
          <p role="alert" className="text-sm text-critical-subtle-fg">{getApiErrorMessage(submission.error, t('ems.saveFailed'))}</p>
        )}
      </section>
    </div>
  );
}

/** One open run: who, where to, quick entries, the timeline, the one button. */
function RunView({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const scanned = usePatientStore((s) => s.currentEmergency);
  const userId = useAuthStore((s) => s.user?.userId);
  const run = useLocalRun(runId);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState<EntryKind | null>(null);
  const [leaving, setLeaving] = useState(false);
  const submission = useSubmission(`ems-${runId}`);

  // The server's copy when reachable; without signal the device's copy stands.
  const load = useCallback(() => {
    getEmsRun(runId).then((r) => { putRun(r); setError(''); }, (e) => setError(getApiErrorMessage(e, t('ems.loadFailed'))));
  }, [runId, t]);
  useEffect(load, [load]);

  const record = async (body: AddEmsRunEventBody, destinationName?: string) => {
    const result = await submission.run(body, () => addEmsRunEvent(runId, body));
    if (result.kind === 'saved' || result.kind === 'duplicate') load();
    if (result.kind === 'queued') addPendingEvent(runId, body, userId ?? '', destinationName);
    return result.kind === 'saved' || result.kind === 'duplicate' || result.kind === 'queued';
  };

  if (!run && error) return <p role="alert" className="m-4 rounded-lg bg-critical-subtle p-3 text-critical-subtle-fg">{error}</p>;
  if (!run) return <p role="status" className="m-4 text-content-muted">{t('ems.loading')}</p>;
  const unsent = run.events.filter((e) => e.pending).length;

  const patient = scanned && scanned.patientId === run.patient_id ? scanned : null;
  const onScene = run.events.some((e) => e.kind === 'on_scene');
  const closed = !OPEN.includes(run.status);

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <p className="flex items-center gap-2 font-bold text-content"><Truck className="h-5 w-5 text-critical" aria-hidden="true" />{t('ems.runLabel')}</p>
        <span className="rounded-full bg-caution-subtle px-3 py-1 text-sm font-semibold text-caution-subtle-fg">{t(`ems.status.${run.status}`)}</span>
      </header>
      <div className="flex-1 space-y-4 p-4 pb-32">
        {unsent > 0 && (
          <p role="status" className="rounded-lg border border-caution bg-caution-subtle p-3 text-sm font-semibold text-caution-subtle-fg">
            {t('ems.notSentYet', { n: String(unsent) })}
          </p>
        )}
        <PatientCard run={run} patient={patient} />
        {run.destination_name && (
          <div className="flex items-center gap-3 rounded-xl border border-brand bg-surface p-3">
            <MapPin className="h-5 w-5 text-brand" aria-hidden="true" />
            <div>
              <p className="font-semibold text-content">{run.destination_name}</p>
              <p className="text-sm text-content-muted">
                {run.eta ? t('ems.eta', { time: formatTimestamp(run.eta, { timeStyle: 'short' }) }) : t('ems.preAlertSent')}
              </p>
            </div>
          </div>
        )}
        {!closed && (
          <>
            {!onScene && (
              <button type="button" onClick={() => void record({ kind: 'on_scene' })}
                className="mc-press min-h-[48px] w-full rounded-xl border-2 border-brand px-4 font-semibold text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {t('ems.arrivedOnScene')}
              </button>
            )}
            <div className="grid grid-cols-4 gap-2" role="group" aria-label={t('ems.addEntry')}>
              <QuickButton icon={Activity} label={t('ems.entry.vitals')} onClick={() => setEntry('vitals')} />
              <QuickButton icon={Stethoscope} label={t('ems.entry.treatment')} onClick={() => setEntry('treatment')} />
              <QuickButton icon={Syringe} label={t('ems.entry.medication')} onClick={() => setEntry('medication')} />
              <QuickButton icon={FileText} label={t('ems.entry.note')} onClick={() => setEntry('note')} />
            </div>
            <PreAlerts raised={activeAlerts(run, run.events)}
              onToggle={(alert, raise) => void record({ kind: 'alert', payload: { alert, raised: raise } })} />
          </>
        )}
        {submission.status === 'failed' && (
          <p role="alert" className="rounded-lg bg-critical-subtle p-3 text-sm text-critical-subtle-fg">{getApiErrorMessage(submission.error, t('ems.saveFailed'))}</p>
        )}
        <Timeline events={run.events} />
      </div>
      <PrimaryAction run={run} busy={submission.status === 'saving'} onLeave={() => setLeaving(true)}
        onHandOver={() => void record({ kind: 'handed_over' })}
        onNoTransport={async () => {
          if (await confirmDialog({ message: t('ems.noTransportConfirm'), destructive: true })) void record({ kind: 'no_transport' });
        }} />
      {entry && <EntrySheet kind={entry} onClose={() => setEntry(null)} onSave={(body) => record(body)} />}
      {leaving && <LeaveSceneSheet onClose={() => setLeaving(false)} onLeave={(body, name) => record(body, name)} />}
    </div>
  );
}

function PatientCard({ run, patient }: { run: EmsRun; patient: ReturnType<typeof usePatientStore.getState>['currentEmergency'] }) {
  const { t } = useTranslation();
  if (!run.patient_id) {
    return <div className="rounded-xl border border-border bg-surface p-3 text-content-secondary">{run.unidentified_description ?? t('ems.unidentified')}</div>;
  }
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
      <p className="font-semibold text-content">{patient?.fullName ?? t('ems.identifiedPatient')}</p>
      {patient && (
        <div className="flex flex-wrap gap-2">
          {patient.allergies.map((a) => (
            <span key={a} className="rounded-full bg-critical-subtle px-3 py-1 text-sm font-semibold text-critical-subtle-fg">{a}</span>
          ))}
          {patient.bloodType && <span className="rounded-full bg-notice-subtle px-3 py-1 text-sm font-semibold text-notice-subtle-fg">{patient.bloodType}</span>}
        </div>
      )}
    </div>
  );
}

/** The hospital activates a team for each; tapping again withdraws it. */
function PreAlerts({ raised, onToggle }: { raised: EmsRunAlert[]; onToggle: (alert: EmsRunAlert, raise: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="pre-alerts" className="space-y-2">
      <h2 id="pre-alerts" className="text-sm font-semibold uppercase tracking-wide text-content-muted">{t('ems.preAlerts')}</h2>
      <div className="flex flex-wrap gap-2">
        {EMS_RUN_ALERTS.map((alert) => {
          const on = raised.includes(alert);
          return (
            <button key={alert} type="button" aria-pressed={on} onClick={() => onToggle(alert, !on)}
              className={`mc-press min-h-[44px] rounded-full border-2 px-4 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${on
                ? 'border-critical bg-critical-subtle text-critical-subtle-fg'
                : 'border-border-interactive text-content hover:bg-surface-sunken'}`}>
              {t(`ems.alerts.${alert}`)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function QuickButton({ icon: Icon, label, onClick }: { icon: typeof Activity; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="mc-press flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface text-sm font-semibold text-content-secondary hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
      <Icon className="h-6 w-6 text-brand" aria-hidden="true" />
      {label}
    </button>
  );
}

function Timeline({ events }: { events: LocalEvent[] }) {
  const { t } = useTranslation();
  const newestFirst = useMemo(() => [...events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)), [events]);
  if (!events.length) return <p className="text-sm text-content-muted">{t('ems.timelineEmpty')}</p>;
  return (
    <section aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="mb-2 text-sm font-semibold uppercase tracking-wide text-content-muted">{t('ems.timeline')}</h2>
      <ol className="relative space-y-3 border-l-2 border-border-strong pl-4" aria-live="polite">
        {newestFirst.map((e) => (
          <li key={e.id} className="mc-enter">
            <p className="text-sm font-semibold text-content">
              <span className="mr-2 tabular-nums text-content-muted">{formatTimestamp(e.occurred_at, { timeStyle: 'short' })}</span>
              {eventLabel(e, t)}
              {e.pending && <span className="ml-2 rounded-full bg-caution-subtle px-2 py-0.5 text-xs font-semibold text-caution-subtle-fg">{t('ems.pending')}</span>}
            </p>
            {describeEvent(e) && <p className="text-sm tabular-nums text-content-secondary">{describeEvent(e)}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function PrimaryAction({ run, busy, onLeave, onHandOver, onNoTransport }: {
  run: EmsRun; busy: boolean; onLeave: () => void; onHandOver: () => void; onNoTransport: () => void;
}) {
  const { t } = useTranslation();
  const bar = 'fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]';
  const big = 'mc-press flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-lg font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
  if (run.status === 'in_progress') {
    return (
      <div className={bar}>
        <div className="mx-auto max-w-xl space-y-2">
          <button type="button" aria-disabled={busy || undefined} onClick={onLeave} className={big}><Truck className="h-5 w-5" aria-hidden="true" />{t('ems.leaveScene')}</button>
          <button type="button" onClick={onNoTransport} className="w-full text-sm text-content-muted underline">{t('ems.noTransport')}</button>
        </div>
      </div>
    );
  }
  if (run.status === 'en_route') {
    return (
      <div className={bar}>
        <div className="mx-auto max-w-xl">
          <button type="button" aria-disabled={busy || undefined} onClick={onHandOver} className={big}>
            <Send className="h-5 w-5" aria-hidden="true" />{t('ems.handOverTo', { name: run.destination_name ?? '' })}
          </button>
          <p className="mt-1 text-center text-xs text-content-muted">{t('ems.handOverHint')}</p>
        </div>
      </div>
    );
  }
  return (
    <div className={bar}>
      <p className="mx-auto max-w-xl text-center font-semibold text-content" role="status">
        {run.status === 'arrived' ? t('ems.awaitingReceipt')
          : run.status === 'received' ? t('ems.receivedAt', { time: formatTimestamp(run.received_at, { timeStyle: 'short' }) })
          : t(`ems.status.${run.status}`)}
      </p>
    </div>
  );
}
