import { useCallback, useEffect, useId, useState } from 'react';
import { CheckCircle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import {
  approveRefillRequest,
  denyRefillRequest,
  formatTimestamp,
  getRefillRequestQueue,
  REFILL_DENIAL_REASON_MAX_CHARS,
  REFILL_DENIAL_REASON_MIN_CHARS,
  signEPrescription,
  transmitEPrescription,
  useTranslation,
} from '@medichain/shared';
import type { RefillRequest } from '@medichain/shared';

/**
 * The prescriber's attestation, signed with every prescription this portal
 * issues. One constant so a new prescription and an approved refill attest to
 * exactly the same words.
 */
export const PRESCRIBER_ATTESTATION =
  'I certify that this prescription is issued for a legitimate medical purpose in the usual course of my professional practice.';

type QueueState = 'loading' | 'ready' | 'error';

/** Where one row stands after the doctor acted on it in this session. */
type RowOutcome =
  | { kind: 'approved'; newPrescriptionId: string }
  | { kind: 'sent' }
  | { kind: 'denied' };

/** A caught error as text the doctor can read, or the fallback. */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Refill requests waiting on the signed-in doctor's own prescriptions.
 *
 * Approving creates a new, unsigned prescription; the row then offers "Sign
 * and send", which runs the same sign-and-transmit steps as a new
 * prescription. Denying needs a reason, which the patient reads.
 */
export function RefillRequestQueue() {
  const { t } = useTranslation();
  const [state, setState] = useState<QueueState>('loading');
  const [requests, setRequests] = useState<RefillRequest[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, RowOutcome>>({});

  const load = useCallback(async () => {
    setState('loading');
    try {
      const body = await getRefillRequestQueue();
      setRequests(body.requests ?? []);
      setOutcomes({});
      setState('ready');
    } catch (err) {
      console.error('Refill queue could not be loaded:', err);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const record = (id: string, outcome: RowOutcome) => setOutcomes((prev) => ({ ...prev, [id]: outcome }));

  return (
    <section aria-labelledby="refill-queue-heading" className="mb-8 bg-surface shadow rounded-lg p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id="refill-queue-heading" className="text-lg font-medium text-content">
          {t('docEPrescribe.refillQueueTitle')}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-content-secondary hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('docEPrescribe.refillQueueReload')}
        </button>
      </div>
      <QueueBody state={state} requests={requests} outcomes={outcomes} onOutcome={record} />
    </section>
  );
}

interface QueueBodyProps {
  state: QueueState;
  requests: RefillRequest[];
  outcomes: Record<string, RowOutcome>;
  onOutcome: (id: string, outcome: RowOutcome) => void;
}

/** Loading, error, empty and list states, each distinguishable. */
function QueueBody({ state, requests, outcomes, onOutcome }: QueueBodyProps) {
  const { t } = useTranslation();
  if (state === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-content-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('docEPrescribe.refillQueueLoading')}
      </p>
    );
  }
  if (state === 'error') {
    return <p role="alert" className="text-sm text-critical-subtle-fg">{t('docEPrescribe.refillQueueFailed')}</p>;
  }
  if (requests.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-content-muted">
        <Inbox className="h-4 w-4" aria-hidden="true" />
        {t('docEPrescribe.refillQueueEmpty')}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {requests.map((request) => (
        <RefillRow key={request.id} request={request} outcome={outcomes[request.id]} onOutcome={onOutcome} />
      ))}
    </ul>
  );
}

interface RefillRowProps {
  request: RefillRequest;
  outcome?: RowOutcome;
  onOutcome: (id: string, outcome: RowOutcome) => void;
}

/** One waiting request with approve / deny, or what happened to it. */
function RefillRow({ request, outcome, onOutcome }: RefillRowProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [denying, setDenying] = useState(false);

  const run = async (action: () => Promise<RowOutcome>, fallback: string) => {
    setBusy(true);
    setError('');
    try {
      onOutcome(request.id, await action());
      setDenying(false);
    } catch (err) {
      setError(messageOf(err, fallback));
    } finally {
      setBusy(false);
    }
  };
  const approve = () =>
    run(async () => {
      const body = await approveRefillRequest(request.id);
      return { kind: 'approved', newPrescriptionId: body.new_prescription_id };
    }, t('docEPrescribe.refillActionFailed'));
  const signAndSend = (newId: string) =>
    run(async () => {
      await signEPrescription(newId, { signature_method: 'wallet', attestation: PRESCRIBER_ATTESTATION });
      await transmitEPrescription(newId);
      return { kind: 'sent' };
    }, t('docEPrescribe.refillSignFailed'));
  const deny = (reason: string) =>
    run(async () => {
      await denyRefillRequest(request.id, reason);
      return { kind: 'denied' };
    }, t('docEPrescribe.refillActionFailed'));

  return (
    <li className="py-4">
      <p className="font-medium text-content">{request.medication_name}</p>
      <p className="text-sm text-content-muted">
        {t('docEPrescribe.refillRequestedBy', {
          patient: request.patient_id,
          date: formatTimestamp(request.created_at, { year: 'numeric', month: 'short', day: 'numeric' }),
        })}
      </p>
      {request.patient_note && (
        <p className="mt-1 text-sm text-content-secondary">{t('docEPrescribe.refillPatientNote', { note: request.patient_note })}</p>
      )}
      <RowActions
        outcome={outcome}
        busy={busy}
        denying={denying}
        onApprove={approve}
        onSignAndSend={signAndSend}
        onStartDeny={() => setDenying(true)}
        onCancelDeny={() => setDenying(false)}
        onDeny={deny}
      />
      {error && <p role="alert" className="mt-2 text-sm text-critical-subtle-fg">{error}</p>}
    </li>
  );
}

interface RowActionsProps {
  outcome?: RowOutcome;
  busy: boolean;
  denying: boolean;
  onApprove: () => void;
  onSignAndSend: (newPrescriptionId: string) => void;
  onStartDeny: () => void;
  onCancelDeny: () => void;
  onDeny: (reason: string) => void;
}

const BUTTON =
  'rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-60';

/** The controls a row offers for its current outcome. */
function RowActions(props: RowActionsProps) {
  const { t } = useTranslation();
  const { outcome, busy } = props;
  if (outcome?.kind === 'sent') {
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-ok-subtle-fg">
        <CheckCircle className="h-4 w-4" aria-hidden="true" />
        {t('docEPrescribe.refillSent')}
      </p>
    );
  }
  if (outcome?.kind === 'denied') {
    return <p className="mt-2 text-sm text-content-secondary">{t('docEPrescribe.refillDenied')}</p>;
  }
  if (outcome?.kind === 'approved') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-sm text-ok-subtle-fg">{t('docEPrescribe.refillApprovedNeedsSignature')}</p>
        <button type="button" disabled={busy} onClick={() => props.onSignAndSend(outcome.newPrescriptionId)} className={`${BUTTON} bg-brand text-brand-fg`}>
          {t('docEPrescribe.refillSignAndSend')}
        </button>
      </div>
    );
  }
  if (props.denying) {
    return <DenyForm busy={busy} onCancel={props.onCancelDeny} onDeny={props.onDeny} />;
  }
  return (
    <div className="mt-2 flex gap-2">
      <button type="button" disabled={busy} onClick={props.onApprove} className={`${BUTTON} bg-brand text-brand-fg`}>
        {t('docEPrescribe.refillApprove')}
      </button>
      <button type="button" disabled={busy} onClick={props.onStartDeny} className={`${BUTTON} border border-border text-content hover:bg-surface-sunken`}>
        {t('docEPrescribe.refillDeny')}
      </button>
    </div>
  );
}

/** The reason a patient will read, checked for length before it is sent. */
function DenyForm({ busy, onCancel, onDeny }: { busy: boolean; onCancel: () => void; onDeny: (reason: string) => void }) {
  const { t } = useTranslation();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < REFILL_DENIAL_REASON_MIN_CHARS;
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooShort) onDeny(reason);
      }}
    >
      <label htmlFor={reasonId} className="block text-sm font-medium text-content">
        {t('docEPrescribe.refillDenyReasonLabel')}
      </label>
      <textarea
        id={reasonId}
        value={reason}
        maxLength={REFILL_DENIAL_REASON_MAX_CHARS}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        aria-describedby={`${reasonId}-hint`}
        className="w-full rounded-md border border-border bg-surface p-2 text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      <p id={`${reasonId}-hint`} className="text-xs text-content-muted">
        {t('docEPrescribe.refillDenyReasonHint', { min: String(REFILL_DENIAL_REASON_MIN_CHARS) })}
      </p>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || tooShort} className={`${BUTTON} bg-critical text-critical-fg`}>
          {t('docEPrescribe.refillDenyConfirm')}
        </button>
        <button type="button" onClick={onCancel} className={`${BUTTON} text-content-secondary hover:bg-surface-sunken`}>
          {t('docEPrescribe.refillDenyCancel')}
        </button>
      </div>
    </form>
  );
}
