import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createAppointment,
  setAppointmentStatus,
  apiUrl,
  useTranslation,
} from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import PatientSelect from '../components/PatientSelect';
import { useCurrentProvider } from '../hooks/useCurrentProvider';
import {
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  Plus,
  Loader2,
  Video,
  MapPin,
  PlayCircle,
  UserCheck,
  AlertCircle,
} from 'lucide-react';

/**
 * The appointment lifecycle, as the server defines it.
 *
 * Not invented here: these are the `AppointmentStatus` variants the API stores
 * and returns. The page shows what exists rather than a parallel vocabulary.
 */
type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled'
  | 'waitlisted';

interface Appointment {
  appointment_id: string;
  patient_id: string;
  patient_name?: string;
  provider_id: string;
  provider_name?: string;
  appointment_type: string;
  visit_reason?: string;
  scheduled_date: string;
  start_time: string;
  status: string;
  is_telehealth?: boolean;
  location?: { facility_name?: string; department?: string; room?: string | null };
}

type Tab = 'today' | 'upcoming' | 'previous' | 'cancelled';

/** Statuses that mean the appointment is over, one way or another. */
const CLOSED: AppointmentStatus[] = ['completed', 'no_show', 'rescheduled'];
const CANCELLED: AppointmentStatus[] = ['cancelled'];

function normaliseStatus(raw: string): AppointmentStatus {
  // The API returns snake_case; tolerate the older PascalCase spelling so a
  // mixed-version deployment does not render every row as "unknown".
  const key = raw?.toLowerCase().replace(/[\s-]/g, '_') ?? '';
  const known: AppointmentStatus[] = [
    'scheduled', 'confirmed', 'checked_in', 'in_progress',
    'completed', 'cancelled', 'no_show', 'rescheduled', 'waitlisted',
  ];
  const compact = key.replace(/_/g, '');
  return known.find((s) => s === key || s.replace(/_/g, '') === compact) ?? 'scheduled';
}

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Which tab an appointment belongs in.
 *
 * Cancellation wins over the date: a cancelled appointment for today belongs
 * under Cancelled, not Today, or the day's list shows work that will not happen.
 */
function bucketFor(a: Appointment, today: string): Tab {
  const status = normaliseStatus(a.status);
  if (CANCELLED.includes(status)) return 'cancelled';
  if (CLOSED.includes(status)) return 'previous';
  if (a.scheduled_date === today) return 'today';
  return a.scheduled_date > today ? 'upcoming' : 'previous';
}

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  scheduled: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
  confirmed: 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100',
  checked_in: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  in_progress: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100',
  completed: 'bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100',
  cancelled: 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100',
  no_show: 'bg-orange-100 text-orange-900 dark:bg-orange-900 dark:text-orange-100',
  rescheduled: 'bg-purple-100 text-purple-900 dark:bg-purple-900 dark:text-purple-100',
  waitlisted: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
};

/**
 * The moves offered from each state, mirroring the server's transition table.
 *
 * Deliberately a subset: only the ones a clinician drives from this screen.
 * The server is the authority — anything shown here that it refuses comes back
 * as a 409 and is surfaced, rather than the UI pretending it worked.
 */
/** The statuses this screen can drive an appointment to. */
type DrivableStatus =
  | 'confirmed'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

const NEXT_ACTIONS: Partial<Record<AppointmentStatus, DrivableStatus[]>> = {
  scheduled: ['confirmed', 'checked_in', 'cancelled', 'no_show'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_progress', 'no_show'],
  in_progress: ['completed'],
};

const ACTION_ICON: Partial<Record<DrivableStatus, typeof CheckCircle>> = {
  confirmed: CheckCircle,
  checked_in: UserCheck,
  in_progress: PlayCircle,
  completed: CheckCircle,
  cancelled: XCircle,
  no_show: AlertCircle,
};

export default function AppointmentSchedulerPage() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToastActions();
  // The signed-in clinician *is* the provider. Nothing on this page asks who
  // they are — that was the Provider ID box (docs/WORKFLOW_AUDIT.md, WF-013).
  const provider = useCurrentProvider();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    patient_id: '',
    appointment_type: 'consultation',
    preferred_date: '',
    preferred_time: '',
    reason: '',
  });

  const today = todayISO();

  const fetchAppointments = useCallback(async () => {
    if (!provider.isAuthenticated) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(apiUrl(`/api/appointments/provider/${provider.providerId}`), {
        headers: { 'X-User-Id': provider.walletAddress },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setAppointments(data.appointments ?? []);
    } catch {
      // A failed load is an error state, not an empty list. Showing "no
      // appointments" when the request failed is how a clinician misses a day.
      setLoadError(t('docAppointments.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [provider.isAuthenticated, provider.providerId, provider.walletAddress, t]);

  useEffect(() => {
    void fetchAppointments();
  }, [fetchAppointments]);

  const buckets = useMemo(() => {
    const empty: Record<Tab, Appointment[]> = {
      today: [], upcoming: [], previous: [], cancelled: [],
    };
    for (const a of appointments) empty[bucketFor(a, today)].push(a);
    const byTime = (x: Appointment, y: Appointment) =>
      `${x.scheduled_date} ${x.start_time}`.localeCompare(`${y.scheduled_date} ${y.start_time}`);
    empty.today.sort(byTime);
    empty.upcoming.sort(byTime);
    empty.previous.sort((x, y) => byTime(y, x));
    empty.cancelled.sort((x, y) => byTime(y, x));
    return empty;
  }, [appointments, today]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // No provider_id: the server derives it from the session. Sending one
      // would be ignored at best and refused at worst.
      await createAppointment(formData);
      showSuccess(t('docAppointments.booked'));
      setShowForm(false);
      setFormData({
        patient_id: '', appointment_type: 'consultation',
        preferred_date: '', preferred_time: '', reason: '',
      });
      await fetchAppointments();
    } catch (err) {
      showError(err instanceof Error ? err.message : t('docAppointments.errorBooking'));
    } finally {
      setSubmitting(false);
    }
  };

  const advance = async (id: string, to: DrivableStatus) => {
    setBusy(`${id}-${to}`);
    try {
      let reason: string | undefined;
      if (to === 'cancelled') {
        reason = window.prompt(t('docAppointments.cancelReasonPrompt')) ?? '';
        if (!reason.trim()) {
          return; // Dismissed the prompt; leave the appointment alone.
        }
      }
      await setAppointmentStatus(id, to, reason);
      showSuccess(t(`docAppointments.moved_${to}`));
      await fetchAppointments();
    } catch (err) {
      // Surface what the server actually said — "that slot is gone",
      // "already completed" — rather than a generic failure.
      showError(err instanceof Error ? err.message : t('docAppointments.errorUpdate'));
    } finally {
      setBusy(null);
    }
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'today', label: t('docAppointments.tabToday') },
    { id: 'upcoming', label: t('docAppointments.tabUpcoming') },
    { id: 'previous', label: t('docAppointments.tabPrevious') },
    { id: 'cancelled', label: t('docAppointments.tabCancelled') },
  ];

  const rows = buckets[tab];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold dark:text-white">{t('docAppointments.title')}</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <Plus size={16} aria-hidden="true" />
          {showForm ? t('docAppointments.hideForm') : t('docAppointments.newAppointment')}
        </button>
      </div>
      {/* Says whose calendar this is, instead of asking. */}
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
        {t('docAppointments.scheduleFor', { name: provider.displayName })}
        {provider.department ? ` · ${provider.department}` : ''}
      </p>

      {showForm && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-6 mb-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">
            {t('docAppointments.scheduleNew')}
          </h2>
          <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
            <PatientSelect
              id="patient_id"
              label={t('docAppointments.patient')}
              value={formData.patient_id}
              onChange={(patientId) => setFormData({ ...formData, patient_id: patientId })}
              required
            />
            <div>
              <label htmlFor="appointment_type" className="block text-sm font-medium dark:text-gray-200">
                {t('docAppointments.appointmentType')}
              </label>
              <select
                id="appointment_type"
                value={formData.appointment_type}
                onChange={(e) => setFormData({ ...formData, appointment_type: e.target.value })}
                className="w-full border p-2 rounded dark:bg-slate-700 dark:border-slate-600"
                required
              >
                <option value="consultation">{t('docAppointments.type_consultation')}</option>
                <option value="follow-up">{t('docAppointments.type_followUp')}</option>
                <option value="procedure">{t('docAppointments.type_procedure')}</option>
                <option value="screening">{t('docAppointments.type_screening')}</option>
                <option value="vaccination">{t('docAppointments.type_vaccination')}</option>
                <option value="antenatal">{t('docAppointments.type_antenatal')}</option>
                <option value="telehealth">{t('docAppointments.type_telehealth')}</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="preferred_date" className="block text-sm font-medium dark:text-gray-200">
                  {t('docAppointments.date')}
                </label>
                <input
                  id="preferred_date"
                  type="date"
                  // An appointment cannot be booked into the past, and a date
                  // ten years out is a typo rather than a plan.
                  min={today}
                  max={`${new Date().getFullYear() + 2}-12-31`}
                  value={formData.preferred_date}
                  onChange={(e) => setFormData({ ...formData, preferred_date: e.target.value })}
                  className="w-full border p-2 rounded dark:bg-slate-700 dark:border-slate-600"
                  required
                />
              </div>
              <div>
                <label htmlFor="preferred_time" className="block text-sm font-medium dark:text-gray-200">
                  {t('docAppointments.time')}
                </label>
                <input
                  id="preferred_time"
                  type="time"
                  value={formData.preferred_time}
                  onChange={(e) => setFormData({ ...formData, preferred_time: e.target.value })}
                  className="w-full border p-2 rounded dark:bg-slate-700 dark:border-slate-600"
                  required
                />
              </div>
            </div>
            <div>
              <label htmlFor="reason" className="block text-sm font-medium dark:text-gray-200">
                {t('docAppointments.reason')}
              </label>
              <textarea
                id="reason"
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                className="w-full border p-2 rounded dark:bg-slate-700 dark:border-slate-600"
                rows={3}
                required
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {submitting && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {t('docAppointments.book')}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="border px-4 py-2 rounded hover:bg-gray-50 dark:hover:bg-slate-700 dark:text-gray-200"
              >
                {t('docAppointments.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow">
        <div role="tablist" aria-label={t('docAppointments.title')} className="flex border-b dark:border-slate-700">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px focus:outline-none focus-visible:ring-2 ${
                tab === id
                  ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
              }`}
            >
              {label}
              <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                {buckets[id].length}
              </span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto animate-spin text-blue-500 mb-2" size={32} aria-hidden="true" />
            <p className="text-gray-600 dark:text-gray-300">{t('docAppointments.loading')}</p>
          </div>
        ) : loadError ? (
          <div role="alert" className="p-8 text-center">
            <AlertCircle className="mx-auto mb-2 text-red-600" size={32} aria-hidden="true" />
            <p className="text-red-800 dark:text-red-300 mb-3">{loadError}</p>
            <button
              onClick={() => void fetchAppointments()}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:hover:bg-slate-700 dark:text-gray-200"
            >
              {t('docAppointments.retry')}
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <Calendar className="mx-auto mb-2 text-gray-300" size={40} aria-hidden="true" />
            <p className="text-gray-600 dark:text-gray-300 mb-3">
              {t(`docAppointments.empty_${tab}`)}
            </p>
            {(tab === 'today' || tab === 'upcoming') && (
              <button
                onClick={() => setShowForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {t('docAppointments.newAppointment')}
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y dark:divide-slate-700">
            {rows.map((a) => {
              const status = normaliseStatus(a.status);
              const actions = NEXT_ACTIONS[status] ?? [];
              return (
                <li key={a.appointment_id} className="p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {a.patient_name || a.patient_id}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[status]}`}>
                          {t(`docAppointments.status_${status}`)}
                        </span>
                        {a.is_telehealth && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-100 text-cyan-900 dark:bg-cyan-900 dark:text-cyan-100 inline-flex items-center gap-1">
                            <Video size={11} aria-hidden="true" />
                            {t('docAppointments.virtual')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <Calendar size={13} aria-hidden="true" />{a.scheduled_date}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock size={13} aria-hidden="true" />{a.start_time}
                        </span>
                        <span>{a.appointment_type}</span>
                        {!a.is_telehealth && a.location?.department && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={13} aria-hidden="true" />{a.location.department}
                          </span>
                        )}
                      </div>
                      {a.visit_reason && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{a.visit_reason}</p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {actions.map((to) => {
                        const Icon = ACTION_ICON[to] ?? CheckCircle;
                        const destructive = to === 'cancelled' || to === 'no_show';
                        return (
                          <button
                            key={to}
                            onClick={() => void advance(a.appointment_id, to)}
                            disabled={busy === `${a.appointment_id}-${to}`}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded disabled:opacity-50 ${
                              destructive
                                ? 'bg-red-50 text-red-800 hover:bg-red-100 dark:bg-red-900/40 dark:text-red-200'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                          >
                            {busy === `${a.appointment_id}-${to}` ? (
                              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                            ) : (
                              <Icon size={14} aria-hidden="true" />
                            )}
                            {t(`docAppointments.action_${to}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
