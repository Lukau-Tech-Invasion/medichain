import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import {
  createTelehealthSession,
  endTelehealthSession,
  getApiErrorMessage,
  getPatientTelehealthSessions,
  joinTelehealthSession,
  listMyTelehealthSessions,
  useTranslation,
} from '@medichain/shared';
import { Video, Plus, ExternalLink, Square, Calendar, Clock, User, Loader2 } from 'lucide-react';
import PatientSelect from '../components/PatientSelect';
import { JitsiMeetComponent } from '@medichain/shared';

/** Jitsi IFrame-API credentials returned by the join endpoint (Phase 1). */
interface JitsiCredentials {
  domain: string;
  room: string;
  jwt?: string | null;
  moderator: boolean;
  expires_in: number;
}

interface JoinResponse {
  jitsi?: JitsiCredentials | null;
  video_room_url?: string | null;
  role?: string;
  subject?: string | null;
}

interface TelehealthSession {
  session_id: string;
  patient_id: string;
  provider_id: string;
  scheduled_start: number;
  duration_minutes: number;
  session_type: string;
  status: string;
  join_url?: string;
  ended_at?: number;
}

export default function TelehealthPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [sessions, setSessions] = useState<TelehealthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [patientId, setPatientId] = useState('');
  const [activeCallUrl, setActiveCallUrl] = useState<string | null>(null);
  // Jitsi IFrame-API call (preferred over the raw-iframe fallback).
  const [activeCall, setActiveCall] = useState<JitsiCredentials | null>(null);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [activeSubject, setActiveSubject] = useState<string | undefined>(undefined);

  const [formData, setFormData] = useState({
    patient_id: '',
    session_type: 'VideoVisit',
    scheduled_start_date: '',
    scheduled_start_time: '',
    duration_minutes: 30,
  });

  // No patient filter means "my sessions", not "no sessions". This screen
  // used to render an empty list until a patient id was typed in, so a
  // clinician opening their own telehealth list saw nothing and had no way to
  // discover what they were seeing today.
  const fetchSessions = useCallback(async (pid: string) => {
    if (!user) return;
    setLoading(true);
    try {
      const data = pid
        ? await getPatientTelehealthSessions(pid)
        : await listMyTelehealthSessions();
      setSessions(data.sessions ?? []);
      setError('');
    } catch (e) {
      console.error(e);
      // Said out loud. A failed fetch used to leave the previous list on
      // screen with no indication it was stale.
      setError(getApiErrorMessage(e, t('docTelehealth.errLoad')));
    } finally {
      setLoading(false);
    }
  }, [user, t]);

  useEffect(() => {
    void fetchSessions(patientId);
  }, [patientId, fetchSessions]);

  /**
   * Deep-link auto-join (Phase 4): when the page is opened via the in-app QR /
   * redirect (`/telehealth?session=...&join=1`), join straight into the call —
   * no native app, no extra taps. Runs once on mount.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('session');
    if (sid && params.get('join') === '1') {
      void joinBySessionId(sid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    try {
      const scheduledStart = formData.scheduled_start_date && formData.scheduled_start_time
        ? Math.floor(new Date(`${formData.scheduled_start_date}T${formData.scheduled_start_time}`).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      // Through the typed client rather than a hand-rolled fetch: the client
      // is what attaches the session headers and the Idempotency-Key the
      // middleware refuses an authenticated mutation without, and duplicating
      // that here is how a header gets forgotten.
      await createTelehealthSession({
        patient_id: formData.patient_id,
        scheduled_start: scheduledStart,
        duration_minutes: formData.duration_minutes,
        session_type: formData.session_type,
      });

      setSuccess(t('docTelehealth.created'));
      setShowForm(false);
      setFormData({ patient_id: '', session_type: 'VideoVisit', scheduled_start_date: '', scheduled_start_time: '', duration_minutes: 30 });
      // Re-read whichever list is on screen. Re-reading only when a patient
      // filter was set meant a session booked from the unfiltered list did not
      // appear until the page was reloaded.
      await fetchSessions(patientId);
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setError(t('docTelehealth.errConnect'));
    }
  };

  const handleEndSession = async (sessionId: string) => {
    if (!user) return;
    setActionLoading(sessionId);
    try {
      await endTelehealthSession(sessionId);
      setSuccess(t('docTelehealth.sessionEnded'));
      // Re-read instead of stamping `status: 'ended'` locally. That string is
      // not a status this API has -- it serializes `Completed` -- so the badge
      // the clinician was left looking at was a value no backend would ever
      // send, and the recorded end time was invisible until a reload.
      await fetchSessions(patientId);
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setError(getApiErrorMessage(e, t('docTelehealth.errEnd')));
    } finally {
      setActionLoading(null);
    }
  };

  /**
   * Join a session: ask the backend for Jitsi credentials (domain/room/JWT) and
   * open the IFrame-API call. Falls back to the raw-iframe URL if the provider
   * doesn't return credentials.
   */
  const handleJoin = async (session: TelehealthSession) => {
    setError('');
    try {
      const resp = (await joinTelehealthSession(session.session_id)) as JoinResponse;
      if (resp.jitsi && resp.jitsi.domain && resp.jitsi.room) {
        setActiveSessionId(session.session_id);
        setActiveSubject(resp.subject ?? undefined);
        setActiveCall(resp.jitsi);
      } else if (resp.video_room_url || session.join_url) {
        setActiveCallUrl(resp.video_room_url || session.join_url!);
      } else {
        setError(t('docTelehealth.errNoRoom'));
      }
    } catch (e) {
      // Fall back to the join URL if the join call fails but a URL exists.
      if (session.join_url) {
        setActiveCallUrl(session.join_url);
      } else {
        setError(getApiErrorMessage(e, t('docTelehealth.errJoin')));
      }
    }
  };

  /** Join by id only (used by the deep-link/QR flow, which has no session row). */
  const joinBySessionId = async (sessionId: string) => {
    setError('');
    try {
      const resp = (await joinTelehealthSession(sessionId)) as JoinResponse;
      if (resp.jitsi && resp.jitsi.domain && resp.jitsi.room) {
        setActiveSessionId(sessionId);
        setActiveSubject(resp.subject ?? undefined);
        setActiveCall(resp.jitsi);
      } else if (resp.video_room_url) {
        setActiveCallUrl(resp.video_room_url);
      } else {
        setError(t('docTelehealth.errNoRoom'));
      }
    } catch (e) {
      setError(getApiErrorMessage(e, t('docTelehealth.errJoin')));
    }
  };

  // `TelehealthStatus` serializes as `Scheduled`, `InProgress`, `Completed`
  // and so on. Every case here was lowercase, so no session ever matched: the
  // badge fell to the default grey and the label rendered the raw enum name.
  const statusColor = (status: string) => {
    switch (status) {
      case 'Scheduled': return 'bg-notice-subtle text-notice-subtle-fg';
      case 'WaitingRoom': return 'bg-notice-subtle text-notice-subtle-fg';
      case 'InProgress': return 'bg-ok-subtle text-ok-subtle-fg';
      case 'OnHold': return 'bg-warning-subtle text-warning-subtle-fg';
      case 'Completed': return 'bg-surface-sunken text-content-secondary';
      case 'Cancelled': return 'bg-critical-subtle text-critical-subtle-fg';
      case 'NoShow': return 'bg-critical-subtle text-critical-subtle-fg';
      case 'TechnicalIssue': return 'bg-critical-subtle text-critical-subtle-fg';
      default: return 'bg-surface-sunken text-content-secondary';
    }
  };

  const statusLabel = (status: string): string => {
    const map: Record<string, string> = {
      Scheduled: t('docTelehealth.statusScheduled'),
      WaitingRoom: t('docTelehealth.statusWaitingRoom'),
      InProgress: t('docTelehealth.statusActive'),
      OnHold: t('docTelehealth.statusOnHold'),
      Completed: t('docTelehealth.statusEnded'),
      Cancelled: t('docTelehealth.statusCancelled'),
      NoShow: t('docTelehealth.statusNoShow'),
      TechnicalIssue: t('docTelehealth.statusTechnicalIssue'),
    };
    return map[status] ?? status;
  };

  // A session is over when the API says it is over. Compared against the same
  // spellings the badge uses, so the Join button and the badge cannot disagree
  // -- which they did: `'ended'` never matched `Completed`, so every finished
  // session still offered a Join button.
  const isOver = (status: string): boolean =>
    ['Completed', 'Cancelled', 'NoShow'].includes(status);

  // Keyed on the spellings the API stores and returns, not on a vocabulary
  // this page invented. The four it used to offer -- video_consultation,
  // follow_up, mental_health, urgent_care -- were in no backend match arm, so
  // every one of them fell through to a video visit, and the list then rendered
  // the stored `VideoVisit` as a raw enum name because that was in no map here.
  const sessionTypeLabel = (type: string): string => {
    const map: Record<string, string> = {
      VideoVisit: t('docTelehealth.typeVideo'),
      PhoneCall: t('docTelehealth.typePhone'),
      SecureMessage: t('docTelehealth.typeMessage'),
      AsyncVideo: t('docTelehealth.typeAsyncVideo'),
      RemoteMonitoring: t('docTelehealth.typeMonitoring'),
      VirtualGroupVisit: t('docTelehealth.typeGroup'),
    };
    return map[type] ?? type;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-content flex items-center gap-2">
            <Video className="text-blue-500" size={24} />
            {t('docTelehealth.title')}
          </h1>
          <p className="text-content-muted text-sm mt-1">{t('docTelehealth.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          <Plus size={16} />
          {t('docTelehealth.newSession')}
        </button>
      </div>

      {success && (
        <div className="mb-4 p-3 bg-ok-subtle border border-ok text-ok-subtle-fg rounded-lg text-sm">{success}</div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-critical-subtle border border-critical text-critical-subtle-fg rounded-lg text-sm">{error}</div>
      )}

      {/* Patient Selector */}
      <div className="bg-surface rounded-xl shadow p-4 mb-6">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            {/* A remembered patient id is not something anyone has; search by name. */}
            <PatientSelect
              id="telehealth-patient-id"
              label={t('docTelehealth.viewForPatient')}
              value={patientId}
              onChange={(selectedPatientId) => setPatientId(selectedPatientId)}
            />
          </div>
          <button
            onClick={() => fetchSessions(patientId)}
            className="px-4 py-2 bg-surface-sunken text-content-secondary rounded-lg hover:bg-surface-sunken text-sm"
          >
            {t('docTelehealth.search')}
          </button>
        </div>
      </div>

      {/* Sessions List */}
      <div className="bg-surface rounded-xl shadow mb-6">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-content flex items-center gap-2">
            <Calendar size={18} />
            {t('docTelehealth.sessions')}
          </h2>
        </div>
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto animate-spin text-blue-500 mb-2" size={32} />
            <p className="text-content-muted">{t('docTelehealth.loading')}</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-content-muted">
            <Video className="mx-auto mb-2 text-gray-300" size={40} />
            <p>{t('docTelehealth.noSessions')}</p>
            {!patientId && <p className="text-sm mt-1">{t('docTelehealth.enterPatientHint')}</p>}
          </div>
        ) : (
          <div className="divide-y">
            {sessions.map((session) => (
              <div key={session.session_id} className="p-4 flex items-center justify-between hover:bg-surface-sunken">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-content">{sessionTypeLabel(session.session_type)}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(session.status)}`}>
                      {statusLabel(session.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-content-muted min-h-[24px] py-1">
                    <span className="flex items-center gap-1">
                      <User size={13} />
                      {t('docTelehealth.patientLabel', { id: session.patient_id })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar size={13} />
                      {new Date(session.scheduled_start * 1000).toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={13} />
                      {t('docTelehealth.durationMinutes', { minutes: session.duration_minutes })}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  {!isOver(session.status) && (
                    <button
                      onClick={() => handleJoin(session)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-ok text-ok-fg text-sm rounded hover:bg-ok"
                    >
                      <Video size={14} />
                      {t('docTelehealth.join')}
                    </button>
                  )}
                  {(session.status === 'active' || session.status === 'scheduled') && (
                    <button
                      onClick={() => handleEndSession(session.session_id)}
                      disabled={actionLoading === session.session_id}
                      className="flex items-center gap-1 px-3 py-1.5 bg-critical-subtle text-critical-subtle-fg text-sm rounded hover:bg-red-200 disabled:opacity-50"
                    >
                      {actionLoading === session.session_id ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                      {t('docTelehealth.end')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-surface rounded-xl shadow p-6">
          <h2 className="font-semibold text-content mb-4">{t('docTelehealth.scheduleNew')}</h2>
          <form onSubmit={handleCreate} className="max-w-lg space-y-4">
            <div>
              <PatientSelect
                id="telehealth-form-patient"
                label={t('docTelehealth.patientId')}
                value={formData.patient_id}
                onChange={(selectedPatientId) => setFormData({ ...formData, patient_id: selectedPatientId })}
                required
              />
            </div>
            <div>
              <label htmlFor="telehealth-session-type" className="block text-sm font-medium text-content-secondary">{t('docTelehealth.sessionType')}</label>
              <select
                id="telehealth-session-type"
                value={formData.session_type}
                onChange={e => setFormData({ ...formData, session_type: e.target.value })}
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="VideoVisit">{t('docTelehealth.typeVideo')}</option>
                <option value="PhoneCall">{t('docTelehealth.typePhone')}</option>
                <option value="SecureMessage">{t('docTelehealth.typeMessage')}</option>
                <option value="AsyncVideo">{t('docTelehealth.typeAsyncVideo')}</option>
                <option value="RemoteMonitoring">{t('docTelehealth.typeMonitoring')}</option>
                <option value="VirtualGroupVisit">{t('docTelehealth.typeGroup')}</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="telehealth-date" className="block text-sm font-medium text-content-secondary">{t('docTelehealth.date')}</label>
                <input
                  id="telehealth-date"
                  type="date"
                  value={formData.scheduled_start_date}
                  onChange={e => setFormData({ ...formData, scheduled_start_date: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label htmlFor="telehealth-time" className="block text-sm font-medium text-content-secondary">{t('docTelehealth.time')}</label>
                <input
                  id="telehealth-time"
                  type="time"
                  value={formData.scheduled_start_time}
                  onChange={e => setFormData({ ...formData, scheduled_start_time: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  required
                />
              </div>
            </div>
            <div>
              <label htmlFor="telehealth-duration" className="block text-sm font-medium text-content-secondary">{t('docTelehealth.duration')}</label>
              <input
                id="telehealth-duration"
                type="number"
                min={15}
                max={120}
                value={formData.duration_minutes}
                onChange={e => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) })}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                {t('docTelehealth.schedule')}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="border px-4 py-2 rounded-lg hover:bg-surface-sunken">
                {t('docTelehealth.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Jitsi IFrame-API call (Phase 2) — JWT auth + lifecycle events. */}
      {activeCall && (
        <JitsiMeetComponent
          sessionId={activeSessionId}
          domain={activeCall.domain}
          room={activeCall.room}
          jwt={activeCall.jwt ?? undefined}
          displayName={user?.username || t('docTelehealth.careProvider')}
          isModerator={activeCall.moderator}
          subject={activeSubject}
          onClose={() => setActiveCall(null)}
        />
      )}

      {/* Fallback: raw iframe for providers that don't return Jitsi credentials. */}
      {!activeCall && activeCallUrl && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between p-3 bg-gray-900 text-white">
            <span className="flex items-center gap-2 font-medium">
              <Video size={20} /> {t('docTelehealth.videoCall')}
            </span>
            <div className="flex items-center gap-2">
              <a
                href={activeCallUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-gray-700 hover:bg-gray-600"
              >
                <ExternalLink size={16} /> {t('docTelehealth.openNewTab')}
              </a>
              <button
                onClick={() => setActiveCallUrl(null)}
                className="px-3 py-1.5 text-sm rounded-lg bg-critical hover:bg-critical"
              >
                {t('docTelehealth.leaveCall')}
              </button>
            </div>
          </div>
          <iframe
            title={t('docTelehealth.videoCallTitle')}
            src={activeCallUrl}
            className="flex-1 w-full border-0"
            allow="camera; microphone; fullscreen; display-capture; autoplay"
          />
        </div>
      )}
    </div>
  );
}
