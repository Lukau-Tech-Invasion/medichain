import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, useTranslation, setAppointmentStatus } from '@medichain/shared';
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
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
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
  const changeStatus = async (id: string, to: 'confirmed' | 'cancelled') => {
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
          type: string;
          status: string;
          provider_name: string;
          specialty: string;
          scheduled_date: string;
          scheduled_time: string;
          duration_minutes: number;
          location?: string | { telehealth_link?: string | null };
          reason: string;
          notes?: string;
          is_telehealth?: boolean;
          telehealth_session_id?: string;
        }) => ({
          id: a.appointment_id,
          type: a.type || 'in-person',
          status: a.status || 'scheduled',
          provider: a.provider_name,
          specialty: a.specialty,
          date: a.scheduled_date,
          time: a.scheduled_time,
          duration: a.duration_minutes || 30,
          location: typeof a.location === 'string' ? a.location : undefined,
          reason: a.reason,
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

  const upcomingAppointments = appointments.filter(a => 
    a.status !== 'completed' && a.status !== 'cancelled' && new Date(a.date) >= new Date()
  );
  
  const pastAppointments = appointments.filter(a => 
    a.status === 'completed' || a.status === 'cancelled' || new Date(a.date) < new Date()
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'bg-green-100 text-green-700';
      case 'scheduled': return 'bg-blue-100 text-blue-700';
      case 'completed': return 'bg-neutral-100 text-neutral-700';
      case 'cancelled': return 'bg-red-100 text-red-700';
      default: return 'bg-neutral-100 text-neutral-700';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed': return <CheckCircle className="w-4 h-4" />;
      case 'scheduled': return <Clock className="w-4 h-4" />;
      case 'completed': return <CheckCircle className="w-4 h-4" />;
      case 'cancelled': return <XCircle className="w-4 h-4" />;
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
          <h1 className="text-2xl font-bold text-neutral-900">{t('appointments.title')}</h1>
          <p className="text-neutral-500">{t('appointments.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? t('common.live') : t('common.demo')}
          </span>
        </div>
      </div>

      {actionError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        {/* Self-service booking has no patient-facing flow yet: the API accepts
            a patient booking for themselves, but no screen collects a provider
            and a slot. Marked unavailable rather than left as a button that
            silently does nothing (docs/WORKFLOW_AUDIT.md, WF-012). */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="patient-card flex items-center gap-3 p-4 border-2 border-transparent opacity-60 cursor-not-allowed text-left"
        >
          <div className="w-12 h-12 bg-neutral-100 rounded-xl flex items-center justify-center">
            <Plus className="w-6 h-6 text-neutral-400" aria-hidden="true" />
          </div>
          <div className="text-left">
            <div className="font-medium text-neutral-900">{t('appointments.bookNew')}</div>
            <div className="text-sm text-neutral-500">
              {t('appointments.bookNewUnavailable')}
            </div>
          </div>
        </button>
        
        <button
          type="button"
          onClick={() => navigate('/telehealth')}
          className="patient-card flex items-center gap-3 p-4 hover:border-primary-200 border-2 border-transparent text-left focus:outline-none focus-visible:ring-2"
        >
          <div className="w-12 h-12 bg-info-light rounded-xl flex items-center justify-center">
            <Video className="w-6 h-6 text-info" aria-hidden="true" />
          </div>
          <div className="text-left">
            <div className="font-medium text-neutral-900">{t('appointments.telehealth')}</div>
            <div className="text-sm text-neutral-500">{t('appointments.virtualVisit')}</div>
          </div>
        </button>
      </div>

      {/* Upcoming Summary */}
      {upcomingAppointments.length > 0 && (
        <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-2xl p-6 text-white">
          <h2 className="text-lg font-semibold mb-2">{t('appointments.nextAppointment')}</h2>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center">
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
      <div className="flex gap-2 border-b border-neutral-200">
        <button
          onClick={() => setActiveTab('upcoming')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'upcoming'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          {t('appointments.upcomingCount', { count: upcomingAppointments.length })}
        </button>
        <button
          onClick={() => setActiveTab('past')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'past'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
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
                  appointment.type === 'telehealth' ? 'bg-info-light' : 'bg-primary-100'
                }`}>
                  {appointment.type === 'telehealth' ? (
                    <Video className={`w-6 h-6 ${appointment.type === 'telehealth' ? 'text-info' : 'text-primary-600'}`} />
                  ) : (
                    <User className="w-6 h-6 text-primary-600" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-neutral-900">{appointment.provider}</h3>
                  <p className="text-sm text-neutral-500">{appointment.specialty}</p>
                </div>
              </div>
              <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}>
                {getStatusIcon(appointment.status)}
                {statusLabel(appointment.status)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="flex items-center gap-2 text-sm text-neutral-600">
                <Calendar className="w-4 h-4 text-neutral-400" />
                {formatDate(appointment.date)}
              </div>
              <div className="flex items-center gap-2 text-sm text-neutral-600">
                <Clock className="w-4 h-4 text-neutral-400" />
                {appointment.time} ({appointment.duration} {t('appointments.minShort')})
              </div>
            </div>

            {appointment.location && (
              <div className="flex items-center gap-2 text-sm text-neutral-600 mb-3">
                <MapPin className="w-4 h-4 text-neutral-400" />
                {appointment.location}
              </div>
            )}

            <div className="bg-neutral-50 rounded-lg p-3 mb-3">
              <p className="text-xs text-neutral-500 mb-1">{t('appointments.reason')}</p>
              <p className="text-sm text-neutral-900">{appointment.reason}</p>
            </div>

            {appointment.notes && (
              <p className="flex items-center gap-1.5 text-sm text-neutral-500 italic">
                <FileText className="w-4 h-4 shrink-0" aria-hidden="true" /> {appointment.notes}
              </p>
            )}

            {appointment.status === 'scheduled' && (
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => void changeStatus(appointment.id, 'confirmed')}
                  disabled={busyId === appointment.id}
                  className="flex-1 py-2 bg-primary-500 text-white rounded-lg font-medium hover:bg-primary-600 transition-colors text-sm disabled:opacity-50"
                >
                  {t('appointments.confirm')}
                </button>
                {/* Was "Reschedule", which had no handler and nothing behind
                    it: the API models rescheduling as booking a replacement,
                    which this app cannot do yet. Cancel is offered instead
                    because it is a transition the server genuinely permits a
                    patient to make. */}
                <button
                  type="button"
                  onClick={() => void changeStatus(appointment.id, 'cancelled')}
                  disabled={busyId === appointment.id}
                  className="flex-1 py-2 border border-neutral-300 text-neutral-700 rounded-lg font-medium hover:bg-neutral-50 transition-colors text-sm disabled:opacity-50"
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
                  <p className="flex-1 py-2 text-sm text-neutral-600 flex items-center justify-center gap-2">
                    <Video className="w-4 h-4 text-neutral-400" aria-hidden="true" />
                    {t('appointments.joinNotReady')}
                  </p>
                )}
                {appointment.phoneNumber && (
                  <button className="py-2 px-4 border border-neutral-300 text-neutral-700 rounded-lg font-medium hover:bg-neutral-50 transition-colors text-sm flex items-center gap-2" aria-label={`Call ${appointment.provider}`}>
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
            <p className="text-neutral-500">
              {activeTab === 'upcoming' ? t('appointments.noUpcoming') : t('appointments.noPast')}
            </p>
            {activeTab === 'upcoming' && (
              <button className="mt-4 px-6 py-2 bg-primary-500 text-white rounded-lg font-medium hover:bg-primary-600 transition-colors">
                {t('appointments.bookAppointment')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
