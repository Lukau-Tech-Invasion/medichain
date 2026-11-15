import { useEffect, useRef, useState } from 'react';
import { getApiErrorMessage, requestPatientDocumentAccess,
  notifySuccess,
} from '@medichain/shared';
import { PatientName } from './PatientName';

/** Request access for one patient; only the patient can approve this request. */
export function DocumentAccessRequest({ patientId, onCheckAccess, scope = 'documents' }: {
  patientId: string; onCheckAccess: () => void; scope?: 'chart' | 'documents';
}) {
  const requestLabel = scope === 'chart' ? 'Request chart access' : 'Request document access';
  const reasonLabel = scope === 'chart' ? 'Reason for chart access' : 'Reason for document access';
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  /** Submit once and retain the reason on failure so the clinician can retry. */
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || sent) return;
    if (!reason.trim()) { setError('Give a reason for the request.'); return; }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await requestPatientDocumentAccess(patientId, reason.trim());
      if (active.current) setSent(true);
      notifySuccess('Access request sent to the patient.');
    } catch (err) {
      console.error('Document access request failed', err);
      if (active.current) setError(getApiErrorMessage(err, 'The access request could not be sent. Please try again.'));
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }

  return <form aria-label={requestLabel} onSubmit={event => void submit(event)} className="mt-3 space-y-3">
    <p><strong><PatientName id={patientId} inherit /></strong></p>
    <p>{scope === 'chart' ? 'The patient must approve access and choose its expiry before this request can authorize chart access.'
      : 'The patient must approve access and choose its expiry before you can open these documents.'}</p>
    {sent ? <p role="status">Request sent. Ask the patient to review Access Control. Access has not been granted yet.</p> : <>
      <label className="block" htmlFor="document-access-reason">{reasonLabel}</label>
      <textarea id="document-access-reason" required maxLength={500} value={reason} disabled={pending}
        onChange={event => setReason(event.target.value)} className="w-full rounded border border-border bg-surface text-content p-3" />
      <button type="submit" aria-disabled={pending || undefined} className="rounded border border-border px-4 py-2">
        {pending ? 'Sending request...' : requestLabel}
      </button>
    </>}
    {error && <p role="alert" className="text-critical">{error}</p>}
    <button type="button" disabled={pending} onClick={onCheckAccess} className="block underline">{scope === 'chart' ? 'Check chart access' : 'Check document access'}</button>
  </form>;
}
