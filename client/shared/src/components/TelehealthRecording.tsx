import { useCallback, useEffect, useState } from 'react';
import { Circle, Download, Film, Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { formatTimestamp } from '../i18n';
import {
  downloadTelehealthRecording,
  getRecordingStatus,
  listTelehealthRecordings,
  setRecordingConsent,
  telehealthRecording,
} from '../api/endpoints';
import type { RecordingStatus, TelehealthRecording } from '../api/endpoints';
import { formatAttachmentSize, saveBlob } from './MessageAttachments';

/** How often the call screen re-reads the recording state, in milliseconds. */
const RECORDING_STATUS_POLL_MS = 5000;

type StatusState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; status: RecordingStatus };

/** Load and poll a consultation's recording state. */
function useRecordingStatus(sessionId: string) {
  const [state, setState] = useState<StatusState>({ kind: 'loading' });
  const refresh = useCallback(async () => {
    try {
      setState({ kind: 'ready', status: await getRecordingStatus(sessionId) });
    } catch (err) {
      console.error('Recording status could not be loaded:', err);
      setState({ kind: 'error' });
    }
  }, [sessionId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), RECORDING_STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  return { state, setState, refresh };
}

const buttonClass =
  'rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';

interface ControlsProps {
  sessionId: string;
  /** Called whenever the recording state is (re)read, so the video platform's recorder can follow it. */
  onRecordingChange?: (recording: boolean) => void;
}

/**
 * Recording consent and state for one consultation (WP7.6), shown to both
 * the clinician and the patient during the call.
 *
 * Each person consents, or withdraws, for themselves; both see whether the
 * other has, and both see a clear indicator while recording. Only the
 * clinician can start and stop, and only once both have consented. When the
 * clinic has no recorder this says so instead of offering a dead button.
 */
export function RecordingControls({ sessionId, onRecordingChange }: ControlsProps) {
  const { t } = useTranslation();
  const { state, setState, refresh } = useRecordingStatus(sessionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recording = state.kind === 'ready' && state.status.recording;

  useEffect(() => {
    if (state.kind === 'ready') onRecordingChange?.(state.status.recording);
  }, [state, onRecordingChange]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('telehealthRecording.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (state.kind === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-content-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('telehealthRecording.checking')}
      </p>
    );
  }
  if (state.kind === 'error') {
    return <p role="alert" className="text-sm text-critical-subtle-fg">{t('telehealthRecording.statusFailed')}</p>;
  }
  if (!state.status.configured) {
    return <p className="text-sm text-content-muted">{t('telehealthRecording.notSetUp')}</p>;
  }
  const status = state.status;
  const mine = status.your_party === 'provider' ? status.provider_consented : status.patient_consented;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" aria-live="polite">
      <RecordingIndicator recording={recording} />
      <ConsentSummary status={status} />
      <button
        type="button"
        disabled={busy}
        onClick={() => void act(() => setRecordingConsent(sessionId, !mine).then((next) => setState({ kind: 'ready', status: next })))}
        className={buttonClass}
      >
        {mine ? t('telehealthRecording.withdraw') : t('telehealthRecording.consent')}
      </button>
      {status.your_party === 'provider' && (
        <StartStopButton status={status} busy={busy} onClick={() => void act(() => telehealthRecording(sessionId, recording ? 'stop' : 'start', true))} />
      )}
      {status.your_party === 'patient' && <p className="w-full text-xs text-content-muted">{t('telehealthRecording.patientWithdrawNote')}</p>}
      {error && <p role="alert" className="w-full text-sm text-critical-subtle-fg">{error}</p>}
    </div>
  );
}

/** A visible, text-labelled recording indicator. */
function RecordingIndicator({ recording }: { recording: boolean }) {
  const { t } = useTranslation();
  if (!recording) {
    return <span className="text-content-muted">{t('telehealthRecording.notRecording')}</span>;
  }
  return (
    <span role="status" className="flex items-center gap-1 rounded-full bg-critical-subtle px-2 py-0.5 font-semibold text-critical-subtle-fg">
      <Circle className="h-3 w-3 fill-current" aria-hidden="true" />
      {t('telehealthRecording.recordingNow')}
    </span>
  );
}

/** Where each party's consent stands, from the viewer's side. */
function ConsentSummary({ status }: { status: RecordingStatus }) {
  const { t } = useTranslation();
  const provider = status.your_party === 'provider';
  const mine = provider ? status.provider_consented : status.patient_consented;
  const theirs = provider ? status.patient_consented : status.provider_consented;
  const theirsText = provider
    ? t(theirs ? 'telehealthRecording.patientConsented' : 'telehealthRecording.patientWaiting')
    : t(theirs ? 'telehealthRecording.providerConsented' : 'telehealthRecording.providerWaiting');
  return (
    <span className="text-content-secondary">
      {t(mine ? 'telehealthRecording.youConsented' : 'telehealthRecording.youHaveNot')} {theirsText}
    </span>
  );
}

/** The clinician's start/stop control; start waits for both consents. */
function StartStopButton({ status, busy, onClick }: { status: RecordingStatus; busy: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const bothConsented = status.provider_consented && status.patient_consented;
  if (!status.recording && !bothConsented) {
    return <span className="text-xs text-content-muted">{t('telehealthRecording.needsBoth')}</span>;
  }
  return (
    <button type="button" disabled={busy} onClick={onClick} className={buttonClass}>
      {status.recording ? t('telehealthRecording.stop') : t('telehealthRecording.start')}
    </button>
  );
}

type ListState =
  | { kind: 'closed' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; recordings: TelehealthRecording[] };

/**
 * A consultation's recordings, loaded when opened. Each download is audited
 * as a disclosure on the patient's record, and the list says so.
 */
export function TelehealthRecordingList({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ListState>({ kind: 'closed' });

  const open = async () => {
    setState({ kind: 'loading' });
    try {
      const body = await listTelehealthRecordings(sessionId);
      setState({ kind: 'ready', recordings: body.recordings ?? [] });
    } catch (err) {
      console.error('Recordings could not be loaded:', err);
      setState({ kind: 'error' });
    }
  };

  if (state.kind === 'closed') {
    return (
      <button type="button" onClick={() => void open()} className={`${buttonClass} flex items-center gap-1`}>
        <Film className="h-4 w-4" aria-hidden="true" />
        {t('telehealthRecording.recordingsButton')}
      </button>
    );
  }
  if (state.kind === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-content-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('telehealthRecording.loadingRecordings')}
      </p>
    );
  }
  if (state.kind === 'error') {
    return <p role="alert" className="text-sm text-critical-subtle-fg">{t('telehealthRecording.recordingsFailed')}</p>;
  }
  if (state.recordings.length === 0) {
    return <p className="text-sm text-content-muted">{t('telehealthRecording.noRecordings')}</p>;
  }
  return (
    <div className="space-y-1">
      <ul className="space-y-1" aria-label={t('telehealthRecording.recordingsLabel')}>
        {state.recordings.map((recording) => (
          <RecordingItem key={recording.id} recording={recording} />
        ))}
      </ul>
      <p className="text-xs text-content-muted">{t('telehealthRecording.viewingAudited')}</p>
    </div>
  );
}

/** One recording as a download button. */
function RecordingItem({ recording }: { recording: TelehealthRecording }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const { blob } = await downloadTelehealthRecording(recording.id);
      const extension = recording.content_type.replace('video/', '');
      saveBlob(blob, `${recording.session_id}.${extension}`);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('telehealthRecording.downloadFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li>
      <button type="button" disabled={busy} onClick={() => void download()} className={`${buttonClass} flex items-center gap-2 text-left`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
        {t('telehealthRecording.recordingItem', {
          date: formatTimestamp(recording.recording_started_at),
          size: formatAttachmentSize(recording.size_bytes),
        })}
      </button>
      {error && <p role="alert" className="text-xs text-critical-subtle-fg">{error}</p>}
    </li>
  );
}
