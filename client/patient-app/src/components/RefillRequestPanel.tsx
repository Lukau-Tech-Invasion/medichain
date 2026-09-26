import { useId, useState } from 'react';
import { CheckCircle, Clock, Loader2, RefreshCw, XCircle } from 'lucide-react';
import {
  cancelRefillRequest,
  formatTimestamp,
  requestPrescriptionRefill,
  REFILL_NOTE_MAX_CHARS,
  useTranslation,
} from '@medichain/shared';
import type { RefillRequest } from '@medichain/shared';

/** Whether this prescription's refill requests have loaded. */
export type RefillLoadState = 'loading' | 'ready' | 'error';

interface RefillRequestPanelProps {
  prescriptionId: string;
  /** Refills the prescription still has. */
  refillsRemaining: number;
  /** The prescription is one the patient is currently on. */
  isActive: boolean;
  /** The newest request for this prescription, if any. */
  latest?: RefillRequest;
  loadState: RefillLoadState;
  /** Called with the server's copy after a request is made or withdrawn. */
  onChanged: (request: RefillRequest) => void;
}

/** The date part of a server timestamp, for "requested on …" lines. */
function dayOf(timestamp: string | null): string {
  return timestamp ? formatTimestamp(timestamp, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}

/**
 * Refill requests for one prescription on the patient's Medications page.
 *
 * Shows the newest request's outcome (waiting, approved, or not approved with
 * the doctor's reason) and, when the prescription can be refilled and nothing
 * is open, a form to ask. Every server answer is shown as the server gave it:
 * nothing is marked "requested" until the request exists.
 */
export function RefillRequestPanel(props: RefillRequestPanelProps) {
  const { t } = useTranslation();
  const { latest, loadState } = props;

  if (loadState === 'loading') {
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-content-muted" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        {t('medications.refillStatusLoading')}
      </p>
    );
  }
  if (loadState === 'error') {
    return (
      <p className="mt-3 text-sm text-critical-subtle-fg" role="alert">
        {t('medications.refillStatusFailed')}
      </p>
    );
  }
  const open = latest?.status === 'requested';
  return (
    <div className="mt-3 space-y-2">
      {latest && <RefillOutcome request={latest} onChanged={props.onChanged} />}
      {!open && props.isActive && props.refillsRemaining > 0 && (
        <RefillRequestForm prescriptionId={props.prescriptionId} onChanged={props.onChanged} />
      )}
      {!open && props.isActive && props.refillsRemaining === 0 && (
        <p className="text-sm text-caution-subtle-fg">{t('medications.refillNoneLeft')}</p>
      )}
    </div>
  );
}

/** The newest request's state, with a withdraw control while it is open. */
function RefillOutcome({ request, onChanged }: { request: RefillRequest; onChanged: (r: RefillRequest) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const withdraw = async () => {
    setBusy(true);
    setError('');
    try {
      const body = await cancelRefillRequest(request.id);
      onChanged(body.request);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('medications.refillWithdrawFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (request.status === 'requested') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-caution-subtle p-3 text-sm text-caution-subtle-fg">
        <Clock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span className="flex-1">{t('medications.refillRequestedOn', { date: dayOf(request.created_at) })}</span>
        <button
          type="button"
          onClick={withdraw}
          disabled={busy}
          className="rounded-md border border-caution px-3 py-1 font-medium hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
        >
          {busy ? t('medications.refillWithdrawing') : t('medications.refillWithdraw')}
        </button>
        {error && <p className="w-full" role="alert">{error}</p>}
      </div>
    );
  }
  if (request.status === 'approved') {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-ok-subtle p-3 text-sm text-ok-subtle-fg">
        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
        {t('medications.refillApprovedOn', { date: dayOf(request.decided_at) })}
      </p>
    );
  }
  if (request.status === 'denied') {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-critical-subtle p-3 text-sm text-critical-subtle-fg">
        <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div>
          <p>{t('medications.refillDeniedOn', { date: dayOf(request.decided_at) })}</p>
          {request.denial_reason && <p>{t('medications.refillDeniedReason', { reason: request.denial_reason })}</p>}
        </div>
      </div>
    );
  }
  // A withdrawn request needs no banner: the patient did it themselves.
  return null;
}

/** "Request refill", expanding to an optional note and a send button. */
function RefillRequestForm({ prescriptionId, onChanged }: { prescriptionId: string; onChanged: (r: RefillRequest) => void }) {
  const { t } = useTranslation();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = await requestPrescriptionRefill(prescriptionId, note);
      onChanged(body.request);
      setOpen(false);
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('medications.refillFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-brand px-3 py-2 text-sm font-medium text-brand hover:bg-brand-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <RefreshCw className="w-4 h-4" aria-hidden="true" />
        {t('medications.requestRefill')}
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-border p-3">
      <label htmlFor={noteId} className="block text-sm font-medium text-content">
        {t('medications.refillNoteLabel')}
      </label>
      <textarea
        id={noteId}
        value={note}
        maxLength={REFILL_NOTE_MAX_CHARS}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-border bg-surface p-2 text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      <p className="text-xs text-content-muted">
        {t('medications.refillNoteCount', { count: String(note.length), max: String(REFILL_NOTE_MAX_CHARS) })}
      </p>
      {error && <p className="text-sm text-critical-subtle-fg" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {busy ? t('medications.refillSending') : t('medications.refillSubmit')}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(''); }}
          className="rounded-md px-3 py-2 text-sm text-content-secondary hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('medications.refillCancelForm')}
        </button>
      </div>
    </form>
  );
}
