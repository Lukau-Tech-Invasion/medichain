import { useEffect, useMemo, useRef, useState } from 'react';
import { Video, Loader2, AlertTriangle, Users, ShieldCheck, Disc, StopCircle, Radio } from 'lucide-react';
import { telehealthEvent, telehealthRecording } from '../api/endpoints';
import { useSSE } from '../hooks';

/**
 * Shared Jitsi IFrame-API video call component (Telehealth Phase 2).
 *
 * Runs the consultation **fully in-browser** — no native-app download — for both
 * the doctor portal and the patient app. Replaces the raw `<iframe>` with
 * `JitsiMeetExternalAPI`, which gives us a JWT option (Phase 1 self-hosted auth),
 * lifecycle events (connected / participants / errors), programmatic control,
 * live cross-client status via SSE (Phase 7), and proper teardown via
 * `dispose()`.
 *
 * Moderator-only controls (recording) appear only when `isModerator` is true, so
 * the same component serves providers (moderators) and patients (participants).
 *
 * © 2025-2026 Trustware. MediChain Health ID System.
 */

// Minimal typing for the externally-loaded Jitsi IFrame API (no @types package).
interface JitsiApi {
  addEventListener(event: string, listener: (payload?: unknown) => void): void;
  removeEventListener(event: string, listener: (payload?: unknown) => void): void;
  executeCommand(command: string, ...args: unknown[]): void;
  dispose(): void;
}
type JitsiApiCtor = new (domain: string, options: Record<string, unknown>) => JitsiApi;

declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiApiCtor;
  }
}

interface Props {
  sessionId: string;
  domain: string;
  room: string;
  /** Self-hosted/JaaS JWT; omitted on open (unauthenticated) rooms. */
  jwt?: string;
  displayName: string;
  /** Moderators (providers) get recording controls; defaults to participant. */
  isModerator?: boolean;
  /** Room subject/title (Phase 3 pre-config). */
  subject?: string;
  onClose: () => void;
}

/** Load `external_api.js` from the Jitsi domain once, resolving when ready. */
function loadJitsiScript(domain: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.JitsiMeetExternalAPI) {
      resolve();
      return;
    }
    const existing = document.getElementById('jitsi-external-api');
    if (existing) {
      const started = Date.now();
      const poll = setInterval(() => {
        if (window.JitsiMeetExternalAPI) {
          clearInterval(poll);
          resolve();
        } else if (Date.now() - started > 10000) {
          clearInterval(poll);
          reject(new Error('Timed out loading the Jitsi API'));
        }
      }, 100);
      return;
    }
    const script = document.createElement('script');
    script.id = 'jitsi-external-api';
    script.src = `https://${domain}/external_api.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load the Jitsi video API'));
    document.body.appendChild(script);
  });
}

export function JitsiMeetComponent({
  sessionId,
  domain,
  room,
  jwt,
  displayName,
  isModerator = false,
  subject,
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiApi | null>(null);
  // Keep onClose current without re-running the init effect.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Read inside listeners without making them an effect dependency.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const subjectRef = useRef(subject);
  subjectRef.current = subject;

  const [status, setStatus] = useState<'loading' | 'connected' | 'error'>('loading');
  const [participants, setParticipants] = useState(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);

  // Phase 7: consume the backend SSE stream so this client reflects what the
  // *other* participant is doing (e.g. the patient joining) without polling.
  const { events } = useSSE();
  const remoteActivity = useMemo(() => {
    const ev = events.find(
      (e) =>
        e.event_type === 'telehealth' &&
        (e.payload as { session_id?: string } | undefined)?.session_id === sessionId
    );
    const raw = (ev?.payload as { event?: string } | undefined)?.event;
    if (!raw) return null;
    // "participant-joined" → "Participant joined"
    const text = raw.replace(/-/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }, [events, sessionId]);

  useEffect(() => {
    let disposed = false;

    // Relay a lifecycle event to the backend (SSE fan-out + audit, Phase 7).
    // Fire-and-forget: a failed relay must never break the live call.
    const emit = (eventType: string, detail?: string) => {
      void telehealthEvent(sessionIdRef.current, eventType, detail).catch(() => {});
    };

    loadJitsiScript(domain)
      .then(() => {
        if (disposed || !containerRef.current || !window.JitsiMeetExternalAPI) return;
        const api = new window.JitsiMeetExternalAPI(domain, {
          roomName: room,
          parentNode: containerRef.current,
          jwt,
          userInfo: { displayName },
          configOverwrite: {
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            prejoinPageEnabled: false,
            disableDeepLinking: true,
          },
          interfaceConfigOverwrite: { MOBILE_APP_PROMO: false },
        });
        apiRef.current = api;

        api.addEventListener('videoConferenceJoined', () => {
          if (disposed) return;
          setStatus('connected');
          // Server-side pre-config keeps PHI out of room titles, so the subject
          // is applied client-side once we've joined (Phase 3).
          if (subjectRef.current) api.executeCommand('subject', subjectRef.current);
          emit('conference-joined');
        });
        api.addEventListener('participantJoined', () => {
          setParticipants((p) => p + 1);
          emit('participant-joined');
        });
        api.addEventListener('participantLeft', () => {
          setParticipants((p) => Math.max(1, p - 1));
          emit('participant-left');
        });
        api.addEventListener('videoConferenceLeft', () => {
          emit('conference-left');
          onCloseRef.current();
        });
        api.addEventListener('readyToClose', () => onCloseRef.current());
        api.addEventListener('errorOccurred', (payload?: unknown) => {
          if (disposed) return;
          setStatus('error');
          const detail =
            payload && typeof payload === 'object' && 'message' in payload
              ? String((payload as { message?: unknown }).message ?? '')
              : '';
          setErrorMsg('A video connection error occurred. Try rejoining.');
          emit('error', detail || undefined);
        });
      })
      .catch((err: unknown) => {
        if (!disposed) {
          setStatus('error');
          setErrorMsg(err instanceof Error ? err.message : 'Could not start the video call');
          emit('error', err instanceof Error ? err.message : undefined);
        }
      });

    // Cleanup: dispose the API (also removes its listeners) on unmount.
    return () => {
      disposed = true;
      apiRef.current?.dispose();
      apiRef.current = null;
    };
  }, [domain, room, jwt, displayName]);

  const leave = () => {
    apiRef.current?.executeCommand('hangup');
    onClose();
  };

  /**
   * Moderator-only recording toggle (Phase 6). Starting requires explicit
   * consent — the backend rejects a start without it and writes an audit row.
   * We track state server-side and best-effort drive Jitsi's own recorder.
   */
  const toggleRecording = async () => {
    if (recordBusy) return;
    const starting = !recording;
    if (starting) {
      const consented = window.confirm(
        'This consultation will be recorded. All participants will be notified. ' +
          'Continue only with the patient’s consent.'
      );
      if (!consented) return;
    }
    setRecordBusy(true);
    try {
      const res = await telehealthRecording(sessionId, starting ? 'start' : 'stop', starting || undefined);
      const enabled = res.recording_enabled ?? starting;
      setRecording(enabled);
      // Best-effort: drive Jitsi's recorder where the deployment supports it.
      apiRef.current?.executeCommand(starting ? 'startRecording' : 'stopRecording', { mode: 'file' });
    } catch {
      setErrorMsg('Could not update recording. Check your permissions and try again.');
    } finally {
      setRecordBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between p-3 bg-gray-900 text-white">
        <span className="flex items-center gap-2 font-medium">
          <Video size={20} /> Telehealth Video Call
          {isModerator && (
            <span className="flex items-center gap-1 text-xs bg-emerald-700 px-2 py-0.5 rounded-full">
              <ShieldCheck size={12} /> Moderator
            </span>
          )}
        </span>
        <div className="flex items-center gap-3 text-sm">
          {status === 'loading' && (
            <span className="flex items-center gap-1 text-gray-300">
              <Loader2 size={16} className="animate-spin" /> Connecting…
            </span>
          )}
          {status === 'connected' && (
            <span className="flex items-center gap-1 text-emerald-300">
              <Users size={16} /> {participants} connected
            </span>
          )}
          {remoteActivity && (
            <span className="flex items-center gap-1 text-sky-300" title="Live session activity">
              <Radio size={14} className="animate-pulse" /> {remoteActivity}
            </span>
          )}
          {recording && (
            <span className="flex items-center gap-1 text-red-400">
              <Disc size={14} className="animate-pulse" /> Recording
            </span>
          )}
          {isModerator && status === 'connected' && (
            <button
              onClick={toggleRecording}
              disabled={recordBusy}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg disabled:opacity-50 ${
                recording ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {recording ? <StopCircle size={16} /> : <Disc size={16} />}
              {recording ? 'Stop recording' : 'Record'}
            </button>
          )}
          <button
            onClick={leave}
            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700"
          >
            Leave call
          </button>
        </div>
      </div>

      {status === 'error' ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-white gap-3 p-6">
          <AlertTriangle size={40} className="text-amber-400" />
          <p className="max-w-md">{errorMsg ?? 'The video call failed.'}</p>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600">
            Close
          </button>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 w-full" />
      )}
    </div>
  );
}
