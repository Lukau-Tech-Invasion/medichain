/**
 * "My patients" for a nurse: the patients admitted to the wards they are
 * rostered on right now, by bed (UX plan WP 5.4).
 *
 * The nursing dashboard's patient list was the first 15 rows of the patients
 * table — whoever registered first, on any ward or none. This list comes from
 * the roster and admissions, and when the nurse is not rostered it says so and
 * says who can fix it, rather than showing somebody else's patients.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  StatusBanner,
  WorkQueueItem,
  formatDateOnly,
  formatTimestamp,
  getApiErrorMessage,
  getMyWard,
  useTranslation,
} from '@medichain/shared';
import type { MyWardPatient, Ward, WardShift } from '@medichain/shared';
import { workspacePath } from '../workspace/forms';

type Loaded = { shifts: WardShift[]; wards: Ward[]; patients: MyWardPatient[] };

export default function MyWardPanel() {
  const { t } = useTranslation();
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    getMyWard().then(
      (r) => {
        // A reply without the three lists is a failure, not "not rostered".
        if (r && Array.isArray(r.shifts) && Array.isArray(r.wards) && Array.isArray(r.patients)) setState(r);
        else setError(t('myWard.loadFailed'));
      },
      (e) => setError(getApiErrorMessage(e, t('myWard.loadFailed'))),
    );
  }, [t]);
  useEffect(load, [load]);

  const wardNames = state?.wards.map((w) => w.name).join(', ');
  const until = state?.shifts.reduce<string | null>((latest, s) => (!latest || s.ends_at > latest ? s.ends_at : latest), null);

  return (
    <section aria-labelledby="my-ward-title" className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow">
      <header>
        <h3 id="my-ward-title" className="font-semibold text-content">
          {t('myWard.title')}{wardNames ? ` — ${wardNames}` : ''}
        </h3>
        {until && <p className="text-sm text-content-muted">{t('myWard.onShiftUntil', { time: formatTimestamp(until) })}</p>}
      </header>
      {error && <StatusBanner kind="error" message={error} onRetry={load} />}
      {!error && !state && <StatusBanner kind="loading" />}
      {state && state.shifts.length === 0 && <StatusBanner kind="empty" message={t('myWard.notRostered')} />}
      {state && state.shifts.length > 0 && state.patients.length === 0 && <StatusBanner kind="empty" message={t('myWard.noAdmissions')} />}
      {state && state.patients.length > 0 && (
        <ul className="space-y-2">
          {state.patients.map((p) => (
            <li key={p.admission.id}>
              <WorkQueueItem
                title={p.content_available && p.full_name ? p.full_name : t('today.unreadablePatient')}
                patientDetail={p.date_of_birth ? `${t('patientSelect.born')} ${formatDateOnly(p.date_of_birth)}` : undefined}
                meta={p.admission.bed_label ? t('myWard.bed', { bed: p.admission.bed_label }) : undefined}
                to={workspacePath(p.admission.patient_id)}
                opensPatient
                state={{ from: { pathname: '/dashboard' } }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
