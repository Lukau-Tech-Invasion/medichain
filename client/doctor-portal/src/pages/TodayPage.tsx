/**
 * Today — what is waiting on this clinician, most urgent first, each item one
 * tap from the form that answers it with the patient already open (UX plan
 * WP 3.2, mockup c1).
 *
 * The order is fixed rather than learned: critical values, then consults,
 * results, refills, then the day's appointments, then the patient list.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  StatusBanner,
  WorkQueueItem,
  formatDateOnly,
  formatTimestamp,
  getApiErrorMessage,
  getDoctorToday,
  useTranslation,
} from '@medichain/shared';
import type { DoctorToday, TodayItem, TodayPatient } from '@medichain/shared';
import { workspacePath } from '../workspace/forms';

type Loaded = { today: DoctorToday; names: Map<string, TodayPatient> };

/** Where each kind of item is answered. */
const OPENS: Record<'critical_values' | 'consults' | 'results_to_review' | 'refills' | 'appointments', (item: TodayItem) => string> = {
  critical_values: (i) => workspacePath(i.patient_id, 'critical-value'),
  consults: (i) => workspacePath(i.patient_id, 'consult'),
  results_to_review: () => '/lab-review',
  refills: (i) => workspacePath(i.patient_id, 'e-prescribe'),
  appointments: (i) => workspacePath(i.patient_id),
};

const SECTIONS = ['critical_values', 'consults', 'results_to_review', 'refills', 'appointments'] as const;

export default function TodayPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    getDoctorToday().then(
      (r) => setState({ today: r.today, names: new Map(r.names.map((p) => [p.patient_id, p])) }),
      (e) => setError(getApiErrorMessage(e, t('today.loadFailed'))),
    );
  }, [t]);

  useEffect(load, [load]);

  if (error) return <div className="p-4 sm:p-6"><StatusBanner kind="error" message={error} onRetry={load} /></div>;
  if (!state) return <div className="p-4 sm:p-6"><StatusBanner kind="loading" /></div>;

  const { today, names } = state;
  const who = (id: string) => {
    const p = names.get(id);
    if (!p || !p.content_available) return { name: t('today.unreadablePatient'), detail: undefined };
    return { name: p.full_name, detail: p.date_of_birth ? `${t('patientSelect.born')} ${formatDateOnly(p.date_of_birth)}` : undefined };
  };
  const waiting = SECTIONS.reduce((n, s) => n + today[s].length, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-content">{t('today.title')}</h1>
        <p className="text-content-secondary">
          {formatDateOnly(today.date)} · {t('today.waiting', { n: waiting })}
        </p>
      </header>

      {today.unavailable.length > 0 && (
        <StatusBanner kind="partial" onRetry={load}
          message={t('today.partial', { sources: today.unavailable.map((s) => t(`today.section.${s}`)).join(', ') })} />
      )}

      {SECTIONS.map((section) => today[section].length > 0 && (
        <section key={section} aria-labelledby={`today-${section}`} className="space-y-2">
          <h2 id={`today-${section}`} className="text-lg font-semibold text-content">
            {t(`today.section.${section}`)} <span className="text-content-muted">({today[section].length})</span>
          </h2>
          <ul className="space-y-2">
            {today[section].map((item) => {
              const p = who(item.patient_id);
              return (
                <li key={item.id}>
                  <WorkQueueItem
                    title={item.title}
                    patientName={p.name}
                    patientDetail={p.detail}
                    meta={item.detail ?? undefined}
                    when={formatTimestamp(item.at)}
                    urgency={item.urgency}
                    urgencyLabel={t(`today.urgency.${item.urgency}`)}
                    to={OPENS[section](item)}
                    state={{ from: { pathname: '/today' } }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {waiting === 0 && today.unavailable.length === 0 && <StatusBanner kind="empty" message={t('today.nothingWaiting')} />}

      <section aria-labelledby="today-patients" className="space-y-2">
        <h2 id="today-patients" className="text-lg font-semibold text-content">
          {t('today.myPatients')} <span className="text-content-muted">({today.patients.length})</span>
        </h2>
        {today.patients.length === 0 ? (
          <StatusBanner kind="empty" message={t('today.noPatients')} />
        ) : (
          <ul className="space-y-2">
            {today.patients.map((p) => (
              <li key={p.patient_id}>
                <WorkQueueItem
                  title={p.content_available ? p.full_name : t('today.unreadablePatient')}
                  patientDetail={p.date_of_birth ? `${t('patientSelect.born')} ${formatDateOnly(p.date_of_birth)}` : undefined}
                  to={workspacePath(p.patient_id)}
                  state={{ from: { pathname: '/today' } }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
