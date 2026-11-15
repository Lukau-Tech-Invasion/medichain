/**
 * Wards and roster (UX plan WP 5.1). An administrator creates wards and puts
 * doctors and nurses on them one shift at a time. Being on a ward's shift is
 * what lets a nurse open the charts of the patients admitted there, so each
 * change is confirmed (Class C) — the confirmation is asked for by the client
 * automatically when the server requires it.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ChoiceChips,
  NowButton,
  StatusBanner,
  SubmitButton,
  assignWardShift,
  cancelWardShift,
  createWard,
  formatTimestamp,
  getApiErrorMessage,
  listWardShifts,
  listWards,
  localNow,
  notifySuccess,
  useTranslation,
} from '@medichain/shared';
import type { Ward, WardKind, WardShift } from '@medichain/shared';
import StaffSelect from '../components/StaffSelect';

const KINDS: WardKind[] = ['general', 'emergency', 'icu', 'maternity', 'paediatric', 'surgical', 'other'];
const SHIFT_HOURS = ['8', '10', '12'] as const;

export default function WardRosterPage() {
  const { t } = useTranslation();
  const [wards, setWards] = useState<Ward[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | undefined>();

  const load = useCallback(() => {
    setError('');
    listWards().then(
      (r) => {
        setWards(r.wards);
        setSelected((current) => current ?? r.wards[0]?.id);
      },
      (e) => setError(getApiErrorMessage(e, t('wardRoster.loadFailed'))),
    );
  }, [t]);
  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-content">{t('wardRoster.title')}</h1>
        <p className="text-content-secondary">{t('wardRoster.subtitle')}</p>
      </header>
      {error && <StatusBanner kind="error" message={error} onRetry={load} />}
      {!error && !wards && <StatusBanner kind="loading" />}
      {wards && (
        <>
          {wards.length === 0 ? (
            <StatusBanner kind="empty" message={t('wardRoster.noWards')} />
          ) : (
            <ChoiceChips label={t('wardRoster.ward')} value={selected} onChange={setSelected}
              options={wards.map((w) => ({ value: w.id, label: w.name }))} />
          )}
          {selected && <Roster wardId={selected} />}
          <NewWard onCreated={(ward) => { setSelected(ward.id); load(); }} />
        </>
      )}
    </div>
  );
}

function NewWard({ onCreated }: { onCreated: (ward: Ward) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WardKind | undefined>();
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !kind) {
      setProblem(t('wardRoster.nameAndKind'));
      return;
    }
    setSaving(true);
    setProblem('');
    try {
      const { ward } = await createWard({ name: name.trim(), kind });
      notifySuccess(t('wardRoster.created', { name: ward.name }));
      setName('');
      setKind(undefined);
      onCreated(ward);
    } catch (e) {
      setProblem(getApiErrorMessage(e, t('wardRoster.createFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold text-content">{t('wardRoster.newWard')}</h2>
      {problem && <p role="alert" className="rounded-lg bg-caution-subtle p-3 text-caution-subtle-fg">{problem}</p>}
      <label className="block text-sm font-medium text-content-secondary">
        {t('wardRoster.name')}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
          className="mt-1 w-full rounded-lg border border-border-interactive bg-surface px-3 py-2 text-content" />
      </label>
      <ChoiceChips label={t('wardRoster.kind')} value={kind} onChange={setKind}
        options={KINDS.map((k) => ({ value: k, label: t(`wardRoster.kinds.${k}`) }))} />
      <SubmitButton status={saving ? 'saving' : 'idle'} label={t('wardRoster.create')} />
    </form>
  );
}

function Roster({ wardId }: { wardId: string }) {
  const { t } = useTranslation();
  const [shifts, setShifts] = useState<Array<{ shift: WardShift; clinician_name: string | null }> | null>(null);
  const [error, setError] = useState('');
  const [clinician, setClinician] = useState('');
  const [start, setStart] = useState('');
  const [hours, setHours] = useState<(typeof SHIFT_HOURS)[number] | undefined>();
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError('');
    listWardShifts(wardId).then((r) => setShifts(r.shifts), (e) => setError(getApiErrorMessage(e, t('wardRoster.loadFailed'))));
  }, [wardId, t]);
  useEffect(load, [load]);

  const assign = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!clinician || !start || !hours) {
      setProblem(t('wardRoster.shiftIncomplete'));
      return;
    }
    const startsAt = new Date(start);
    const endsAt = new Date(startsAt.getTime() + Number(hours) * 3_600_000);
    setSaving(true);
    setProblem('');
    try {
      await assignWardShift(wardId, { clinician_id: clinician, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() });
      notifySuccess(t('wardRoster.assigned'));
      setClinician('');
      setHours(undefined);
      load();
    } catch (e) {
      setProblem(getApiErrorMessage(e, t('wardRoster.assignFailed')));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (shiftId: string) => {
    try {
      await cancelWardShift(shiftId);
      load();
    } catch (e) {
      setError(getApiErrorMessage(e, t('wardRoster.cancelFailed')));
    }
  };

  return (
    <section aria-labelledby="roster-title" className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <h2 id="roster-title" className="text-lg font-semibold text-content">{t('wardRoster.roster')}</h2>
      {error && <StatusBanner kind="error" message={error} onRetry={load} />}
      {shifts && shifts.length === 0 && <StatusBanner kind="empty" message={t('wardRoster.noShifts')} />}
      {shifts && shifts.length > 0 && (
        <ul className="divide-y divide-border">
          {shifts.map(({ shift, clinician_name }) => (
            <li key={shift.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-content">{clinician_name ?? t('wardRoster.unknownClinician')}</span>
                <span className="block text-sm text-content-muted">
                  {formatTimestamp(shift.starts_at)} – {formatTimestamp(shift.ends_at)}
                  {shift.cancelled_at ? ` · ${t('wardRoster.cancelled')}` : ''}
                </span>
              </span>
              {!shift.cancelled_at && new Date(shift.ends_at) > new Date() && (
                <button type="button" onClick={() => void cancel(shift.id)}
                  className="min-h-[44px] rounded-lg border border-border-interactive px-3 text-sm text-content hover:bg-surface-sunken">
                  {t('wardRoster.cancelShift')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={assign} noValidate className="space-y-3 border-t border-border pt-4">
        <h3 className="font-semibold text-content">{t('wardRoster.addShift')}</h3>
        {problem && <p role="alert" className="rounded-lg bg-caution-subtle p-3 text-caution-subtle-fg">{problem}</p>}
        <StaffSelect label={t('wardRoster.clinician')} value={clinician} onChange={(id) => setClinician(id)} />
        <div className="flex flex-wrap items-end gap-2">
          <label className="block flex-1 text-sm font-medium text-content-secondary">
            {t('wardRoster.starts')}
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border-interactive bg-surface px-3 py-2 text-content" />
          </label>
          <NowButton label={t('wardRoster.starts')} onNow={setStart} />
          <button type="button" onClick={() => setStart(localNow('date') + 'T07:00')}
            className="min-h-[44px] rounded-lg border border-border-interactive px-3 text-sm font-semibold text-content hover:bg-surface-sunken">
            {t('wardRoster.dayShift')}
          </button>
          <button type="button" onClick={() => setStart(localNow('date') + 'T19:00')}
            className="min-h-[44px] rounded-lg border border-border-interactive px-3 text-sm font-semibold text-content hover:bg-surface-sunken">
            {t('wardRoster.nightShift')}
          </button>
        </div>
        <ChoiceChips label={t('wardRoster.length')} value={hours} onChange={setHours}
          options={SHIFT_HOURS.map((h) => ({ value: h, label: t('wardRoster.hours', { n: h }) }))} />
        <SubmitButton status={saving ? 'saving' : 'idle'} label={t('wardRoster.assign')} />
      </form>
    </section>
  );
}
