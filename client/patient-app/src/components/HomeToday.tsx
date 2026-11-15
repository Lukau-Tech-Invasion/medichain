/**
 * Home's "Today" (mockup p1): the next dose still to take, the next visit and
 * the latest result. Each comes from its own read and is simply left out when
 * there is nothing to show or the read fails; nothing here is a guess.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, ChevronRight, FlaskConical, Pill } from 'lucide-react';
import {
  formatDateOnly,
  formatTimestamp,
  getPatientAdherence,
  getPatientAppointmentSummaries,
  getPatientLabSubmissions,
  getPatientReminders,
  logMedicationAdherence,
  useTranslation,
} from '@medichain/shared';
import type { LabResultSubmission, PatientAppointmentListItem } from '@medichain/shared';

export interface DueDose { reminderId: string; name: string; dosage: string; time: string }

const CLOSED = new Set(['cancelled', 'canceled', 'completed', 'no_show', 'noshow', 'declined']);
const RECENT_RESULT_DAYS = 14;

/** Today's doses of reminders nobody has marked taken today, earliest first. */
export function remainingDoses(
  reminders: Awaited<ReturnType<typeof getPatientReminders>>,
  adherence: Awaited<ReturnType<typeof getPatientAdherence>>,
  today: string,
): DueDose[] {
  const taken = new Set((adherence.logs ?? [])
    .filter((log) => (log.action_taken === 'taken' || log.action_taken === 'taken_late') && log.actual_time?.slice(0, 10) === today)
    .map((log) => log.reminder_id));
  const doses = (reminders.reminders ?? [])
    .filter((r) => !taken.has(r.reminder_id))
    .flatMap((r) => r.reminder_times.map((time) => ({ reminderId: r.reminder_id, name: r.medication_name, dosage: r.dosage, time })));
  doses.sort((a, b) => a.time.localeCompare(b.time));
  return doses;
}

/** Today's first dose of a reminder nobody has marked taken today. */
export function nextDueDose(
  reminders: Awaited<ReturnType<typeof getPatientReminders>>,
  adherence: Awaited<ReturnType<typeof getPatientAdherence>>,
  today: string,
): DueDose | null {
  return remainingDoses(reminders, adherence, today)[0] ?? null;
}

/** The earliest appointment from today on that is still going ahead. */
export function nextAppointment(items: PatientAppointmentListItem[], today: string): PatientAppointmentListItem | null {
  const open = items.filter((a) => !CLOSED.has(a.status.toLowerCase()) && a.scheduled_date.slice(0, 10) >= today);
  open.sort((a, b) => `${a.scheduled_date}${a.start_time ?? ''}`.localeCompare(`${b.scheduled_date}${b.start_time ?? ''}`));
  return open[0] ?? null;
}

/** The newest result the patient can see, however old. */
export function newestResult(items: LabResultSubmission[]): LabResultSubmission | null {
  const dated = items.filter((s) => Number.isFinite(Date.parse(s.reviewed_at ?? s.submitted_at)));
  dated.sort((a, b) => Date.parse(b.reviewed_at ?? b.submitted_at) - Date.parse(a.reviewed_at ?? a.submitted_at));
  return dated[0] ?? null;
}

/** The newest result the patient can see, if it is recent enough to be news. */
export function latestResult(items: LabResultSubmission[], now: number): LabResultSubmission | null {
  const newest = newestResult(items);
  if (!newest) return null;
  const ageDays = (now - Date.parse(newest.reviewed_at ?? newest.submitted_at)) / 86_400_000;
  return ageDays <= RECENT_RESULT_DAYS ? newest : null;
}

const rowClass = 'flex min-h-[64px] items-center gap-3 px-4 py-3';
const iconClass = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-brand';

export function HomeToday({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [dose, setDose] = useState<DueDose | null>(null);
  const [visit, setVisit] = useState<PatientAppointmentListItem | null>(null);
  const [result, setResult] = useState<LabResultSubmission | null>(null);
  const [doseError, setDoseError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadDose = useCallback(async () => {
    const [reminders, adherence] = await Promise.all([getPatientReminders(patientId), getPatientAdherence(patientId)]);
    setDose(nextDueDose(reminders, adherence, new Date().toISOString().slice(0, 10)));
  }, [patientId]);

  useEffect(() => {
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    loadDose().catch(() => { /* no reminder row rather than a guessed one */ });
    getPatientAppointmentSummaries(patientId)
      .then((body) => { if (!cancelled) setVisit(nextAppointment(body.appointments ?? [], today)); })
      .catch(() => {});
    getPatientLabSubmissions(patientId)
      .then((items) => { if (!cancelled) setResult(latestResult(items, Date.now())); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [patientId, loadDose]);

  const markTaken = async () => {
    if (!dose || saving) return;
    setSaving(true);
    try {
      // Ticked only once the server has it, then the next dose takes its place.
      await logMedicationAdherence({ reminder_id: dose.reminderId, action: 'taken' });
      setDoseError('');
      await loadDose();
    } catch {
      setDoseError(t('medications.doseNotRecorded'));
    } finally {
      setSaving(false);
    }
  };

  if (!dose && !visit && !result) return null;
  return (
    <section aria-labelledby="home-today" className="space-y-1.5">
      <h2 id="home-today" className="px-1 text-sm font-semibold text-content-secondary">{t('home.today')}</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {dose && (
          <li className={rowClass}>
            <span className={iconClass} aria-hidden="true"><Pill className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-content">{[dose.name, dose.dosage].filter(Boolean).join(' ')}</span>
              <span className="block text-sm text-content-muted">{t('home.due', { time: dose.time })}</span>
              {doseError && <span role="alert" className="block text-sm text-critical-subtle-fg">{doseError}</span>}
            </span>
            <button type="button" onClick={() => void markTaken()} aria-disabled={saving || undefined}
              className="min-h-[44px] rounded-xl bg-brand px-4 font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {saving ? t('common.saving') : t('home.taken')}
            </button>
          </li>
        )}
        {visit && (
          <li>
            <Link to="/appointments" className={`${rowClass} hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus`}>
              <span className={iconClass} aria-hidden="true"><Calendar className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-content">{visit.provider_name}</span>
                <span className="block truncate text-sm text-content-muted">
                  {[formatDateOnly(visit.scheduled_date), visit.start_time, typeof visit.location === 'string' ? visit.location : null]
                    .filter(Boolean).join(' · ')}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-content-muted" aria-hidden="true" />
            </Link>
          </li>
        )}
        {result && (
          <li>
            <Link to="/lab-results" className={`${rowClass} hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus`}>
              <span className={iconClass} aria-hidden="true"><FlaskConical className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-content">{t('home.latestResult')}</span>
                <span className="block truncate text-sm text-content-muted">
                  {[result.test_name, formatTimestamp(result.reviewed_at ?? result.submitted_at, { day: 'numeric', month: 'short' })].join(' · ')}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-content-muted" aria-hidden="true" />
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
