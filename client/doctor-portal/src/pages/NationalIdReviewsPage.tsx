import { useCallback, useEffect, useState } from 'react';
import {
  decideNationalIdManualReview,
  getApiErrorMessage,
  listNationalIdManualReviews,
} from '@medichain/shared';
import type { NationalIdManualReview } from '@medichain/shared';
import { Check, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';

function formatTimestamp(value: string | null): string {
  if (!value) return 'Not decided';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown time' : date.toLocaleString();
}

function ReviewDecisionForm({
  review,
  busy,
  onDecide,
}: {
  review: NationalIdManualReview;
  busy: boolean;
  onDecide: (approved: boolean, evidenceReference: string) => Promise<void>;
}) {
  const [evidenceReference, setEvidenceReference] = useState('');
  const [validationError, setValidationError] = useState('');

  const submit = async (approved: boolean) => {
    if (!evidenceReference.trim()) {
      setValidationError('An evidence reference is required before making a decision.');
      return;
    }
    setValidationError('');
    await onDecide(approved, evidenceReference.trim());
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <label className="block text-sm font-medium text-content" htmlFor={`evidence-${review.id}`}>
        Evidence reference
      </label>
      <p className="mt-1 text-xs text-content-muted">
        Reference the facility-held evidence. Do not enter the national ID number here.
      </p>
      <input
        id={`evidence-${review.id}`}
        value={evidenceReference}
        onChange={(event) => setEvidenceReference(event.target.value)}
        disabled={busy}
        className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-content"
        placeholder="e.g. Facility identity register 2026-09-20 / page 14"
      />
      {validationError && <p role="alert" className="mt-2 text-sm text-critical-subtle-fg">{validationError}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-ok px-3 py-2 text-sm font-medium text-ok-fg disabled:opacity-60"
        >
          <Check size={16} /> Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit(false)}
          className="inline-flex items-center gap-2 rounded-lg bg-critical px-3 py-2 text-sm font-medium text-critical-fg disabled:opacity-60"
        >
          <X size={16} /> Reject
        </button>
      </div>
    </div>
  );
}

function NationalIdReviewsPage() {
  const [reviews, setReviews] = useState<NationalIdManualReview[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const body = await listNationalIdManualReviews();
      setReviews(body.reviews ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Identity review cases could not be loaded.'));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (review: NationalIdManualReview, approved: boolean, evidenceReference: string) => {
    setBusyId(review.id);
    setError('');
    setNotice('');
    try {
      const result = await decideNationalIdManualReview(review.id, {
        approved,
        evidence_reference: evidenceReference,
      });
      setNotice(`Case ${review.id} was ${result.status}.`);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, 'The identity review decision was not saved.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <ShieldCheck className="mt-1 text-primary" size={28} />
          <div>
            <h1 className="text-2xl font-bold text-content">National ID reviews</h1>
            <p className="mt-1 max-w-3xl text-content-muted">
              Review cases where an issuing authority was unavailable. This queue never displays a submitted national ID.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-content">
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      {error && <p role="alert" className="rounded-lg border border-critical bg-critical-subtle p-3 text-critical-subtle-fg">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-ok bg-ok-subtle p-3 text-ok-subtle-fg">{notice}</p>}

      {!loaded ? (
        <div className="flex items-center gap-2 text-content-muted"><Loader2 className="animate-spin" size={20} /> Loading reviews…</div>
      ) : reviews.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-5 text-content-muted">No manual national-ID review cases are recorded.</p>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <article key={review.id} className="rounded-xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-content">{review.country} verification</h2>
                  <p className="mt-1 text-sm text-content-muted">Requested {formatTimestamp(review.requested_at)}</p>
                </div>
                <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm capitalize text-content">{review.status}</span>
              </div>
              {review.status === 'pending' ? (
                <ReviewDecisionForm review={review} busy={busyId === review.id} onDecide={(approved, evidence) => decide(review, approved, evidence)} />
              ) : (
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-content-muted">Decided</dt><dd className="text-content">{formatTimestamp(review.decided_at)}</dd></div>
                  <div><dt className="text-content-muted">Evidence reference</dt><dd className="text-content">{review.evidence_reference ?? 'Not available'}</dd></div>
                </dl>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default NationalIdReviewsPage;
