import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  apiUrl,
  useTranslation,
  setAppointmentStatus,
  createAppointment,
  getProviders,
  getAvailableSlots,
} from '@medichain/shared';
import type { BookableProvider } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  Calendar,
  Clock,
  MapPin,
  User,
  Phone,
  Video,
  Plus,
  Loader2,
  Wifi,
  WifiOff,
  CheckCircle,
  XCircle,
  AlertCircle,
  FileText,
} from 'lucide-react';

interface Appointment {
  id: string;
  type: 'in-person' | 'telehealth';
  status:
    | 'scheduled'
    | 'confirmed'
    | 'checked_in'
    | 'in_progress'
    | 'completed'
    | 'cancelled'
    | 'declined'
    | 'no_show';
  /** Which side still owes an answer while the booking is only a proposal. */
  awaitingConfirmationFrom?: 'patient' | 'provider' | null;
  provider: string;
  specialty: string;
  date: string;
  time: string;
  duration: number;
  location?: string;
  reason: string;
  notes?: string;
  phoneNumber?: string;
  videoLink?: string;
}

type AppointmentStatus = Appointment['status'];

/**
 * End of the appointment's day, in the viewer's own timezone.
 *
 * `date` is a bare `YYYY-MM-DD`, which `new Date(...)` parses as UTC midnight.
 * Comparing that against `new Date()` (the current instant) filed an
 * appointment booked for *today* under "past" the moment it was created, and
 * shifted the boundary by the UTC offset for everyone outside UTC. Splitting
 * on the end of the appointment's local day keeps a same-day appointment
 * upcoming until that day is genuinely over.
 */
function endOfAppointmentDay(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return new Date(date);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function normalizeStatus(value: string): AppointmentStatus {
  const status = value.toLowerCase().replace(/[ _-]/g, '');
  // Every status the server can return needs a case here. This used to fall
  // through to 'scheduled' for anything it did not recognise, so a visit that
  // was already checked in, in progress, or marked a no-show was shown to the
  // patient as merely "Scheduled". That is now actively misleading: 'scheduled'
  // means "a proposed time nobody has agreed to yet", and the confirm/decline
  // controls hang off it.
  if (status === 'confirmed') return 'confirmed';
  if (status === 'checkedin') return 'checked_in';
  if (status === 'inprogress') return 'in_progress';
  if (status === 'completed') return 'completed';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (status === 'declined') return 'declined';
  if (status === 'noshow') return 'no_show';
  return 'scheduled';
}

function normalizeAppointmentType(value?: string, isTelehealth?: boolean): Appointment['type'] {
  if (isTelehealth || value?.toLowerCase().includes('telehealth')) return 'telehealth';
  return 'in-person';
}

function displayTime(startTime?: string, scheduledTime?: number | string): string {
  if (startTime) return startTime;
  if (typeof scheduledTime === 'number') {
    return new Date(scheduledTime * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return scheduledTime || '';
}

/**
 * AppointmentsPage - Patient appointment management
 * 
 * Features:
 * - View upcoming appointments
 * - See past appointments
 * - Request new appointments
 * - Manage appointment details
 * 
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function AppointmentsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { patient, isAuthenticated } = usePatientAuthStore();
  /** Appointment currently being changed, so its buttons can disable. */
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Surfaced verbatim from the server, so a refusal explains itself. */
  const [actionError, setActionError] = useState<string | null>(null);
  const statusLabel = (s: string) =>
    ({
      scheduled: t('appointments.statusScheduled'),
      confirmed: t('appointments.statusConfirmed'),
      completed: t('appointments.statusCompleted'),
      cancelled: t('appointments.statusCancelled'),
      declined: t('appointments.statusDeclined'),
      checked_in: t('appointments.statusCheckedIn'),
      in_progress: t('appointments.statusInProgress'),
      no_show: t('appointments.statusNoShow'),
    }[s] || s.charAt(0).toUpperCase() + s.slice(1));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    if (patient) {
      loadAppointments();
    }
  }, [patient]);

  /**
   * Move an appointment through the lifecycle.
   *
   * The server decides which transitions a patient may make - confirm and
   * cancel only - and refuses the rest, so this does not set policy. It
   * reloads from the source of truth afterwards rather than optimistically
   * editing local state, so what the screen shows is what was stored.
   */
  const changeStatus = async (id: string, to: 'confirmed' | 'cancelled' | 'declined') => {
    setBusyId(id);
    setActionError(null);
    try {
      let reason: string | undefined;
      if (to === 'cancelled') {
        reason = window.prompt(t('appointments.cancelReasonPrompt')) ?? '';
        if (!reason.trim()) return;
      }
      await setAppointmentStatus(id, to, reason);
      await loadAppointments();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('appointments.actionFailed'));
    } finally {
      setBusyId(null);
    }
  };

  // ---- Self-service booking -------------------------------------------------
  // The API has always accepted a patient booking for themselves; there was
  // simply no screen for it, so the tile was disabled (WF-012). A patient
  // booking is a *proposal*: the server marks it awaiting the provider, who
  // must confirm before it can proceed.
  const [bookingOpen, setBookingOpen] = useState(false);
  const [providers, setProviders] = useState<BookableProvider[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState({
    providerId: '',
    date: '',
    time: '',
    type: 'consultation',
    reason: '',
  });
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  /** Earliest bookable day: today, in the viewer's own timezone. */
  const minBookingDate = (() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  })();

  const openBooking = async () => {
    setBookingOpen(true);
    setBookingError(null);
    if (providers.length > 0) return;
    try {
      const result = await getProviders('doctor');
      setProviders(result.providers ?? []);
    } catch {
      setBookingError(t('appointments.bookLoadProvidersFailed'));
    }
  };

  /**
   * Slots come from the provider's own calendar, so they are re-fetched
   * whenever the provider or the date changes. Any previously chosen time is
   * cleared: it belonged to a different day and may no longer be free.
   */
  const refreshSlots = async (providerId: string, date: string) => {
    setBooking(prev => ({ ...prev, time: '' }));
    if (!providerId || !date) {
      setSlots([]);
      return;
    }
    setSlotsLoading(true);
    try {
      const result = await getAvailableSlots(providerId, date);
      setSlots(result.available_slots ?? []);
    } catch {
      setSlots([]);
      setBookingError(t('appointments.bookLoadSlotsFailed'));
    } finally {
      setSlotsLoading(false);
    }
  };

  const submitBooking = async () => {
    if (!patient) return;
    setBookingBusy(true);
    setBookingError(null);
    try {
      await createAppointment({
        patient_id: patient.healthId,
        provider_id: booking.providerId,
        appointment_type: booking.type,
        preferred_date: booking.date,
        preferred_time: booking.time,
        reason: booking.reason,
      });
      setBookingOpen(false);
      setBooking({ providerId: '', date: '', time: '', type: 'consultation', reason: '' });
      setSlots([]);
      await loadAppointments();
    } catch (err) {
      // Surfaced verbatim: a refused slot (409) or an unknown type (400) should
      // explain itself rather than read as a generic failure.
      setBookingError(err instanceof Error ? err.message : t('appointments.bookFailed'));
    } finally {
      setBookingBusy(false);
    }
  };

  const bookingReady =
    booking.providerId !== '' &&
    booking.date !== '' &&
    booking.time !== '' &&
    booking.reason.trim() !== '';

  const loadAppointments = async () => {
    if (!patient) return;
    
    setLoading(true);
    try {
      const patientId = patient.healthId;
      
      const response = await fetch(apiUrl(`/api/appointments/patient/${patientId}`), {
        headers: { 
          'X-User-Id': patient.walletAddress,
          'X-Health-Id': patient.healthId,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setApiConnected(true);
        
        const appts: Appointment[] = (data.appointments || []).map((a: {
          appointment_id: string;
          type?: string;
          appointment_type?: string;
          status: string;
          provider_name: string;
          specialty: string;
          scheduled_date: string;
          start_time?: string;
          scheduled_time?: number | string;
          duration_minutes: number;
          location?: string | { telehealth_link?: string | null };
          reason?: string;
          visit_reason?: string;
          notes?: string;
          is_telehealth?: boolean;
          telehealth_session_id?: string;
          awaiting_confirmation_from?: 'patient' | 'provider' | null;
        }) => ({
          id: a.appointment_id,
          type: normalizeAppointmentType(a.appointment_type || a.type, a.is_telehealth),
          status: normalizeStatus(a.status),
          awaitingConfirmationFrom: a.awaiting_confirmation_from ?? null,
          provider: a.provider_name,
          specialty: a.specialty,
          date: a.scheduled_date,
          time: displayTime(a.start_time, a.scheduled_time),
          duration: a.duration_minutes || 30,
          location: typeof a.location === 'string' ? a.location : undefined,
          reason: a.visit_reason || a.reason || 'No reason provided',
          notes: a.notes,
          // Only a provisioned session yields a link. Without one the card
          // shows the waiting state rather than a Join button, because there
          // is genuinely no meeting to join yet.
          videoLink:
            a.telehealth_session_id && typeof a.location === 'object'
              ? a.location?.telehealth_link ?? undefined
              : undefined,
        }));
        
        setAppointments(appts);
      } else {
        setApiConnected(false);
      }
    } catch {
      setApiConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const now = new Date();

  const upcomingAppointments = appointments.filter(
    a =>
      a.status !== 'completed' &&
      a.status !== 'cancelled' &&
      a.status !== 'declined' &&
      a.status !== 'no_show' &&
      endOfAppointmentDay(a.date) >= now
  );

  const pastAppointments = appointments.filter(
    a =>
      a.status === 'completed' ||
      a.status === 'cancelled' ||
      a.status === 'declined' ||
      a.status === 'no_show' ||
      endOfAppointmentDay(a.date) < now
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'bg-ok-subtle text-ok-subtle-fg';
      case 'scheduled': return 'bg-notice-subtle text-notice-subtle-fg';
      case 'completed': return 'bg-surface-sunken text-content-secondary';
      case 'cancelled': return 'bg-critical-subtle text-critical-subtle-fg';
      case 'declined': return 'bg-critical-subtle text-critical-subtle-fg';
      case 'checked_in': return 'bg-caution-subtle text-caution-subtle-fg';
      case 'in_progress': return 'bg-surface-sunken text-content-secondary';
      case 'no_show': return 'bg-critical-subtle text-critical-subtle-fg';
      default: return 'bg-surface-sunken text-content-secondary';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed': return <CheckCircle className="w-4 h-4" />;
      case 'scheduled': return <Clock className="w-4 h-4" />;
      case 'completed': return <CheckCircle className="w-4 h-4" />;
      case 'cancelled': return <XCircle className="w-4 h-4" />;
      case 'declined': return <XCircle className="w-4 h-4" />;
      case 'checked_in': return <CheckCircle className="w-4 h-4" />;
      case 'in_progress': return <Clock className="w-4 h-4" />;
      case 'no_show': return <AlertCircle className="w-4 h-4" />;
      default: return <AlertCircle className="w-4 h-4" />;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content">{t('appointments.title')}</h1>
          <p className="text-content-muted">{t('appointments.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? t('common.live') : t('common.demo')}
          </span>
        </div>
      </div>

      {actionError && (
        <div role="alert" className="rounded-lg border border-critical bg-critical-subtle p-3 text-sm text-critical-subtle-fg">
          {actionError}
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => void openBooking()}
          className="patient-card flex items-center gap-3 p-4 hover:border-brand border-2 border-transparent text-left focus:outline-none focus-visible:ring-2"
        >
          <div className="w-12 h-12 bg-brand-subtle rounded-xl flex items-center justify-center">
            <Plus className="w-6 h-6 text-brand" aria-hidden="true" />
          </div>
          <div className="text-left">
            <div className="font-medium text-content">{t('appointments.bookNew')}</div>
            <div className="text-sm text-content-muted">{t('appointments.bookNewHint')}</div>
          </div>
        </button>
        
        <button
          type="button"
          onClick={() => navigate('/telehealth')}
          className="patient-card flex items-center gap-3 p-4 hover:border-brand border-2 border-transparent text-left focus:outline-none focus-visible:ring-2"
        >
          <div className="w-12 h-12 bg-info-light rounded-xl flex items-center justify-center">
            <Video className="w-6 h-6 text-info" aria-hidden="true" />
          </div>
          <div className="text-left">
            <div className="font-medium text-content">{t('appointments.telehealth')}</div>
            <div className="text-sm text-content-muted">{t('appointments.virtualVisit')}</div>
          </div>
        </button>
      </div>

      {bookingOpen && (
        <div className="patient-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-content">{t('appointments.bookTitle')}</h2>
            <button
              type="button"
              onClick={() => setBookingOpen(false)}
              className="text-sm text-content-muted hover:text-content-secondary"
            >
              {t('appointments.bookClose')}
            </button>
          </div>

          {/* Stated up front, because it is the part a patient would not
              expect: the clinic still has to agree to the time they pick. */}
          <p className="text-sm text-content-muted bg-surface-sunken rounded-lg p-3">
            {t('appointments.bookNeedsConfirmation')}
          </p>

          <label className="block">
            <span className="text-sm text-content-secondary">{t('appointments.bookProvider')}</span>
            <select
              value={booking.providerId}
              onChange={e => {
                const providerId = e.target.value;
                setBooking(prev => ({ ...prev, providerId }));
                void refreshSlots(providerId, booking.date);
              }}
              className="mt-1 w-full px-3 py-2 border border-border-strong rounded-lg"
            >
              <option value="">{t('appointments.bookSelectProvider')}</option>
              {providers.map((provider, index) => (
                <option key={`${provider.wallet_address}-${index}`} value={provider.wallet_address}>
                  {provider.specialty
                    ? `${provider.name} - ${provider.specialty}`
                    : provider.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm text-content-secondary">{t('appointments.bookDate')}</span>
            <input
              type="date"
              value={booking.date}
              min={minBookingDate}
              onChange={e => {
                const date = e.target.value;
                setBooking(prev => ({ ...prev, date }));
                void refreshSlots(booking.providerId, date);
              }}
              className="mt-1 w-full px-3 py-2 border border-border-strong rounded-lg"
            />
          </label>

          <div>
            <span className="text-sm text-content-secondary">{t('appointments.bookTime')}</span>
            {!booking.providerId || !booking.date ? (
              <p className="mt-1 text-sm text-content-muted">
                {t('appointments.bookPickProviderFirst')}
              </p>
            ) : slotsLoading ? (
              <p className="mt-1 text-sm text-content-muted">
                {t('appointments.bookLoadingSlots')}
              </p>
            ) : slots.length === 0 ? (
              <p className="mt-1 text-sm text-content-muted">{t('appointments.bookNoSlots')}</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-2">
                {slots.map(slot => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setBooking(prev => ({ ...prev, time: slot }))}
                    aria-pressed={booking.time === slot}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${
                      booking.time === slot
                        ? 'bg-primary-500 text-white border-brand'
                        : 'border-border-strong text-content-secondary hover:bg-surface-sunken'
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-sm text-content-secondary">{t('appointments.bookType')}</span>
            <select
              value={booking.type}
              onChange={e => setBooking(prev => ({ ...prev, type: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border border-border-strong rounded-lg"
            >
              {/* Only types the server's `parse_appointment_type` accepts; an
                  unrecognised one is refused with a 400, not defaulted. */}
              <option value="consultation">{t('appointments.typeConsultation')}</option>
              <option value="follow-up">{t('appointments.typeFollowUp')}</option>
              <option value="routine">{t('appointments.typeRoutine')}</option>
              <option value="telehealth">{t('appointments.typeTelehealth')}</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm text-content-secondary">{t('appointments.bookReason')}</span>
            <textarea
              value={booking.reason}
              onChange={e => setBooking(prev => ({ ...prev, reason: e.target.value }))}
              rows={2}
              className="mt-1 w-full px-3 py-2 border border-border-strong rounded-lg"
              placeholder={t('appointments.bookReasonPlaceholder')}
            />
          </label>

          {bookingError && (
            <p role="alert" className="text-sm text-danger">
              {bookingError}
            </p>
          )}

          <button
            type="button"
            onClick={() => void submitBooking()}
            disabled={!bookingReady || bookingBusy}
            className="w-full py-2 bg-primary-500 text-brand-fg rounded-lg font-medium hover:bg-brand disabled:opacity-50"
          >
            {bookingBusy ? t('appointments.bookSubmitting') : t('appointments.bookSubmit')}
          </button>
        </div>
      )}

      {/* Upcoming Summary */}
      {upcomingAppointments.length > 0 && (
        <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-2xl p-6 text-white">
          <h2 className="text-lg font-semibold mb-2">{t('appointments.nextAppointment')}</h2>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-surface/20 rounded-xl flex items-center justify-center">
              {upcomingAppointments[0].type === 'telehealth' ? (
                <Video className="w-7 h-7" />
              ) : (
                <User className="w-7 h-7" />
              )}
            </div>
            <div>
              <p className="font-medium">{upcomingAppointments[0].provider}</p>
              <p className="text-white/80 text-sm">{upcomingAppointments[0].specialty}</p>
              <p className="text-white/80 text-sm">
                {formatDate(upcomingAppointments[0].date)} {t('appointments.at')} {upcomingAppointments[0].time}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab('upcoming')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'upcoming'
              ? 'border-brand text-brand'
              : 'border-transparent text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('appointments.upcomingCount', { count: upcomingAppointments.length })}
        </button>
        <button
          onClick={() => setActiveTab('past')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'past'
              ? 'border-brand text-brand'
              : 'border-transparent text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('appointments.pastCount', { count: pastAppointments.length })}
        </button>
      </div>

      {/* Appointments List */}
      <div className="space-y-4">
        {(activeTab === 'upcoming' ? upcomingAppointments : pastAppointments).map(appointment => (
          <div key={appointment.id} className="patient-card">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  appointment.type === 'telehealth' ? 'bg-info-light' : 'bg-brand-subtle'
                }`}>
                  {appointment.type === 'telehealth' ? (
                    <Video className={`w-6 h-6 ${appointment.type === 'telehealth' ? 'text-info' : 'text-brand'}`} />
                  ) : (
                    <User className="w-6 h-6 text-brand" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-content">{appointment.provider}</h3>
                  <p className="text-sm text-content-muted">{appointment.specialty}</p>
                </div>
              </div>
              <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}>
                {getStatusIcon(appointment.status)}
                {statusLabel(appointment.status)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="flex items-center gap-2 text-sm text-content-muted">
                <Calendar className="w-4 h-4 text-content-muted" />
                {formatDate(appointment.date)}
              </div>
              <div className="flex items-center gap-2 text-sm text-content-muted">
                <Clock className="w-4 h-4 text-content-muted" />
                {appointment.time} ({appointment.duration} {t('appointments.minShort')})
              </div>
            </div>

            {appointment.location && (
              <div className="flex items-center gap-2 text-sm text-content-muted mb-3">
                <MapPin className="w-4 h-4 text-content-muted" />
                {appointment.location}
              </div>
            )}

            <div className="bg-surface-sunken rounded-lg p-3 mb-3">
              <p className="text-xs text-content-muted mb-1">{t('appointments.reason')}</p>
              <p className="text-sm text-content">{appointment.reason}</p>
            </div>

            {appointment.notes && (
              <p className="flex items-center gap-1.5 text-sm text-content-muted italic">
                <FileText className="w-4 h-4 shrink-0" aria-hidden="true" /> {appointment.notes}
              </p>
            )}

            {/* A booking is a proposal until the other side agrees. Confirm and
                Decline appear only while the answer is genuinely the patient's
                to give; when the clinic booked and the patient has already
                answered - or when the patient booked and the clinic has not -
                the card says who is being waited on instead of offering a
                button that the server would refuse. */}
            {appointment.status === 'scheduled' &&
              appointment.awaitingConfirmationFrom === 'provider' && (
                <p className="mt-4 text-sm text-content-muted bg-surface-sunken rounded-lg p-3">
                  {t('appointments.awaitingProvider')}
                </p>
              )}

            {appointment.status === 'scheduled' && (
              <div className="flex gap-2 mt-4">
                {appointment.awaitingConfirmationFrom === 'patient' && (
                  <>
                    <button
                      type="button"
                      onClick={() => void changeStatus(appointment.id, 'confirmed')}
                      disabled={busyId === appointment.id}
                      className="flex-1 py-2 bg-primary-500 text-brand-fg rounded-lg font-medium hover:bg-brand transition-colors text-sm disabled:opacity-50"
                    >
                      {t('appointments.confirm')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void changeStatus(appointment.id, 'declined')}
                      disabled={busyId === appointment.id}
                      className="flex-1 py-2 border border-danger text-danger rounded-lg font-medium hover:bg-critical-subtle transition-colors text-sm disabled:opacity-50"
                    >
                      {t('appointments.decline')}
                    </button>
                  </>
                )}
                {/* Was "Reschedule", which had no handler and nothing behind
                    it: the API models rescheduling as booking a replacement,
                    which this app cannot do yet. Cancel is offered instead
                    because it is a transition the server genuinely permits a
                    patient to make. */}
                <button
                  type="button"
                  onClick={() => void changeStatus(appointment.id, 'cancelled')}
                  disabled={busyId === appointment.id}
                  className="flex-1 py-2 border border-border-strong text-content-secondary rounded-lg font-medium hover:bg-surface-sunken transition-colors text-sm disabled:opacity-50"
                >
                  {t('appointments.cancelAppointment')}
                </button>
              </div>
            )}

            {appointment.type === 'telehealth' && appointment.status !== 'completed' && appointment.status !== 'cancelled' && (
              <div className="flex gap-2 mt-4">
                {/* Only offered when a session actually exists. A Join button
                    with no session behind it claims a meeting has been created
                    when none has. Appointment-to-session linking is not built
                    yet (WF-014), so for now this usually renders the waiting
                    state - which is the truth. */}
                {appointment.videoLink ? (
                  <a
                    href={appointment.videoLink}
                    className="flex-1 py-2 bg-info text-white rounded-lg font-medium hover:bg-blue-600 transition-colors text-sm flex items-center justify-center gap-2"
                  >
                    <Video className="w-4 h-4" aria-hidden="true" />
                    {t('appointments.joinVideo')}
                  </a>
                ) : (
                  <p className="flex-1 py-2 text-sm text-content-muted flex items-center justify-center gap-2">
                    <Video className="w-4 h-4 text-content-muted" aria-hidden="true" />
                    {t('appointments.joinNotReady')}
                  </p>
                )}
                {appointment.phoneNumber && (
                  <button className="py-2 px-4 border border-border-strong text-content-secondary rounded-lg font-medium hover:bg-surface-sunken transition-colors text-sm flex items-center gap-2" aria-label={`Call ${appointment.provider}`}>
                    <Phone className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {((activeTab === 'upcoming' && upcomingAppointments.length === 0) || 
          (activeTab === 'past' && pastAppointments.length === 0)) && (
          <div className="text-center py-12">
            <Calendar className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
            <p className="text-content-muted">
              {activeTab === 'upcoming' ? t('appointments.noUpcoming') : t('appointments.noPast')}
            </p>
            {activeTab === 'upcoming' && (
              <button className="mt-4 px-6 py-2 bg-primary-500 text-brand-fg rounded-lg font-medium hover:bg-brand transition-colors">
                {t('appointments.bookAppointment')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
