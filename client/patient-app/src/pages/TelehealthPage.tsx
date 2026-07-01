import { useEffect, useState } from 'react';
import { apiUrl, joinTelehealthSession, getApiErrorMessage, JitsiMeetComponent, useTranslation } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import {
  Video,
  Clock,
  Calendar,
  User,
  CheckCircle,
  Loader2,
  Wifi,
  WifiOff,
  ExternalLink,
} from 'lucide-react';

interface TelehealthSession {
  session_id: string;
  provider_id: string;
  provider_name?: string;
  patient_join_url?: string;
  scheduled_start: number;
  scheduled_end?: number;
  status?: string;
  duration_minutes?: number;
}

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
  subject?: string | null;
}

/**
 * TelehealthPage - Manage and join virtual care sessions
 *
 * Features:
 * - View upcoming telehealth sessions with join button
 * - View past sessions with duration/status
 * - Opens patient_join_url in new tab
 *
 * © 2025 Trustware. All rights reserved.
 */
export function TelehealthPage() {
  const { t } = useTranslation();
  const { patient } = usePatientAuthStore();
  const { showError } = useToastActions();
  const [sessions, setSessions] = useState<TelehealthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');
  const [activeCallUrl, setActiveCallUrl] = useState<string | null>(null);
  // In-browser Jitsi call (preferred over the raw-iframe / new-tab fallback).
  const [activeCall, setActiveCall] = useState<JitsiCredentials | null>(null);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [activeSubject, setActiveSubject] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!patient?.healthId) {
      setLoading(false);
      return;
    }
    loadSessions();
  }, [patient]);

  /**
   * Deep-link auto-join (Phase 4): opening `/telehealth?session=...&join=1`
   * (from the in-app QR / redirect) joins straight into the call, in-browser.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('session');
    if (sid && params.get('join') === '1') {
      void joinById(sid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSessions = async () => {
    if (!patient) return;
    setLoading(true);
    try {
      const response = await fetch(
        apiUrl(`/api/telehealth/patient/${patient.healthId}/sessions`),
        {
          headers: {
            'X-User-Id': patient.walletAddress,
            'X-Health-Id': patient.healthId,
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
        setApiConnected(true);
      } else {
        setApiConnected(false);
        setSessions([]);
      }
    } catch (err) {
      console.error('Failed to load telehealth sessions:', err);
      setApiConnected(false);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Join a session: ask the backend for Jitsi credentials (domain/room/JWT) and
   * open the in-browser call. Falls back to the raw patient_join_url iframe if
   * the provider returns no credentials.
   */
  const joinById = async (sessionId: string, fallbackUrl?: string) => {
    try {
      const resp = (await joinTelehealthSession(sessionId)) as JoinResponse;
      if (resp.jitsi && resp.jitsi.domain && resp.jitsi.room) {
        setActiveSessionId(sessionId);
        setActiveSubject(resp.subject ?? undefined);
        setActiveCall(resp.jitsi);
      } else if (resp.video_room_url || fallbackUrl) {
        setActiveCallUrl(resp.video_room_url || fallbackUrl!);
      } else {
        showError(t('telehealth.errorNoRoom'));
      }
    } catch (e) {
      if (fallbackUrl) {
        setActiveCallUrl(fallbackUrl);
      } else {
        showError(getApiErrorMessage(e, t('telehealth.errorJoinFailed')));
      }
    }
  };

  const handleJoin = (session: TelehealthSession) => {
    void joinById(session.session_id, session.patient_join_url);
  };

  const now = Date.now() / 1000;
  const upcomingSessions = sessions.filter(
    s => s.scheduled_start > now || s.status === 'scheduled' || s.status === 'in_progress'
  );
  const pastSessions = sessions.filter(
    s => s.scheduled_start <= now && s.status !== 'scheduled' && s.status !== 'in_progress'
  );

  const formatDateTime = (unixTs: number) =>
    new Date(unixTs * 1000).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const formatDuration = (session: TelehealthSession) => {
    if (session.duration_minutes) return t('telehealth.minutes', { mins: session.duration_minutes });
    if (session.scheduled_end) {
      const mins = Math.round((session.scheduled_end - session.scheduled_start) / 60);
      return t('telehealth.minutes', { mins });
    }
    return '';
  };

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'scheduled': return t('telehealth.statusScheduled');
      case 'in_progress': return t('telehealth.statusInProgress');
      case 'completed': return t('telehealth.statusCompleted');
      case 'cancelled': return t('telehealth.statusCancelled');
      default: {
        const s = status.replace('_', ' ');
        return s.charAt(0).toUpperCase() + s.slice(1);
      }
    }
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
          <h1 className="text-2xl font-bold text-neutral-900">{t('telehealth.title')}</h1>
          <p className="text-neutral-500">{t('telehealth.subtitle')}</p>
        </div>
        <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
          apiConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
        }`}>
          {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {apiConnected ? t('common.live') : t('common.demo')}
        </span>
      </div>

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
          {t('telehealth.tabUpcoming', { count: upcomingSessions.length })}
        </button>
        <button
          onClick={() => setActiveTab('past')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'past'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          {t('telehealth.tabPast', { count: pastSessions.length })}
        </button>
      </div>

      {/* Session List */}
      <div className="space-y-4">
        {(activeTab === 'upcoming' ? upcomingSessions : pastSessions).map(session => (
          <div key={session.session_id} className="patient-card">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-info-light rounded-xl flex items-center justify-center">
                  <Video className="w-6 h-6 text-info" />
                </div>
                <div>
                  <h3 className="font-semibold text-neutral-900">
                    {session.provider_name
                      ? t('telehealth.providerPrefix', { name: session.provider_name })
                      : t('telehealth.providerFallback', { id: session.provider_id })}
                  </h3>
                  <p className="text-sm text-neutral-500 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDateTime(session.scheduled_start)}
                  </p>
                </div>
              </div>
              {session.status && (
                <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                  session.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                  session.status === 'in_progress' ? 'bg-green-100 text-green-700' :
                  session.status === 'completed' ? 'bg-neutral-100 text-neutral-600' :
                  'bg-red-100 text-red-700'
                }`}>
                  {session.status === 'completed' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {statusLabel(session.status)}
                </span>
              )}
            </div>

            {formatDuration(session) && (
              <div className="flex items-center gap-2 text-sm text-neutral-600 mb-3">
                <Clock className="w-4 h-4 text-neutral-400" />
                {t('telehealth.duration', { value: formatDuration(session) })}
              </div>
            )}

            {activeTab === 'upcoming' && (
              <button
                onClick={() => handleJoin(session)}
                className="w-full py-2.5 bg-info text-white rounded-lg font-medium hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
              >
                <Video className="w-4 h-4" />
                {t('telehealth.joinCall')}
              </button>
            )}

            {activeTab === 'past' && session.status === 'completed' && (
              <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded-lg p-2">
                <CheckCircle className="w-4 h-4" />
                {t('telehealth.sessionCompleted')}
              </div>
            )}
          </div>
        ))}

        {((activeTab === 'upcoming' && upcomingSessions.length === 0) ||
          (activeTab === 'past' && pastSessions.length === 0)) && (
          <div className="text-center py-12">
            <User className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
            <p className="text-neutral-500">{activeTab === 'upcoming' ? t('telehealth.noUpcoming') : t('telehealth.noPast')}</p>
          </div>
        )}
      </div>

      {/* In-browser Jitsi call (Phase 2) — JWT auth + lifecycle events, no native app. */}
      {activeCall && (
        <JitsiMeetComponent
          sessionId={activeSessionId}
          domain={activeCall.domain}
          room={activeCall.room}
          jwt={activeCall.jwt ?? undefined}
          displayName={patient ? t('telehealth.patientName', { id: patient.healthId }) : t('telehealth.patient')}
          subject={activeSubject}
          onClose={() => setActiveCall(null)}
        />
      )}

      {/* Fallback: raw iframe for providers that don't return Jitsi credentials. */}
      {!activeCall && activeCallUrl && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between p-3 bg-neutral-900 text-white">
            <span className="flex items-center gap-2 font-medium">
              <Video className="w-5 h-5" /> {t('telehealth.videoCallTitle')}
            </span>
            <div className="flex items-center gap-2">
              <a
                href={activeCallUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-sm rounded-lg bg-neutral-700 hover:bg-neutral-600 flex items-center gap-1"
              >
                <ExternalLink className="w-4 h-4" /> {t('telehealth.openNewTab')}
              </a>
              <button
                onClick={() => setActiveCallUrl(null)}
                className="px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-700"
              >
                {t('telehealth.leaveCall')}
              </button>
            </div>
          </div>
          <iframe
            title={t('telehealth.videoCallTitle')}
            src={activeCallUrl}
            className="flex-1 w-full border-0"
            allow="camera; microphone; fullscreen; display-capture; autoplay"
          />
        </div>
      )}
    </div>
  );
}
