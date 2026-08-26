/**
 * Review lab results submitted for clinical sign-off.
 *
 * # Why this page exists
 *
 * `/api/lab/pending` and `/api/lab/review` have existed for as long as the lab
 * workflow has, and `getPendingLabResults` / `reviewLabResult` have been
 * exported from the shared API client the whole time — called by nothing. A
 * lab technician could file a result and no clinician could ever see or sign
 * off on it in the product. The doctor dashboard has been showing a "Pending
 * Lab Reviews" tile the entire time, which made the workflow look complete
 * while leading nowhere.
 *
 * The API side of that workflow is a maker-checker control: whoever submitted
 * a result may not approve it, and approving it is what puts the result on the
 * patient's chart. A control with no interface is not a control anyone can
 * exercise.
 *
 * # The two rules this screen has to respect
 *
 * A rejection must carry a reason — the API refuses one without
 * (`REJECTION_REASON_REQUIRED`), and a reviewer who discovers that from a
 * server error has already lost their work.
 *
 * `SELF_REVIEW_FORBIDDEN` is shown as an explanation, not as a failure. A
 * doctor who submitted a result themselves will see the approve control
 * disabled with the reason attached, rather than a 403 after the click.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getPendingLabResults,
  reviewLabResult,
  useTranslation,
  type LabResultSubmission,
} from '@medichain/shared';
import { useAuthStore } from '../store';
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';

/** A result outside its reference range is what a reviewer is looking for. */
function isFlagged(flag?: string | null): boolean {
  return Boolean(flag && flag.trim() && flag.toLowerCase() !== 'normal');
}

function LabReviewPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [submissions, setSubmissions] = useState<LabResultSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Which submission is mid-request, so its buttons can be disabled. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      // `ApiClient.get` unwraps `{ submissions: [...] }` to the bare array, so
      // what arrives here is a list — but the server's envelope is what the
      // route actually returns, and only one of those two facts is visible in
      // the types. Accept both rather than depend on which layer wins.
      const data = (await getPendingLabResults()) as unknown;
      const list = Array.isArray(data)
        ? data
        : ((data as { submissions?: LabResultSubmission[] })?.submissions ?? []);
      setSubmissions(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setSubmissions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const myWallet = user?.walletAddress ?? '';

  const decide = useCallback(
    async (submission: LabResultSubmission, action: 'approve' | 'reject') => {
      const reason = rejecting[submission.id]?.trim() ?? '';
      if (action === 'reject' && !reason) {
        // Checked here as well as server-side: the API refuses a reasonless
        // rejection, and finding that out from a 400 after writing nothing is
        // a worse experience than being told before the request.
        setRowError((p) => ({ ...p, [submission.id]: t('lab.review.reasonRequired') }));
        return;
      }

      setBusyId(submission.id);
      setRowError((p) => ({ ...p, [submission.id]: '' }));
      try {
        await reviewLabResult({
          submission_id: submission.id,
          action,
          ...(action === 'reject' ? { rejection_reason: reason } : {}),
        });
        setNotice(
          action === 'approve'
            ? t('lab.review.approved', { test: submission.test_name })
            : t('lab.review.rejected', { test: submission.test_name })
        );
        // Re-read rather than removing the row locally. Another clinician may
        // have decided something else in the meantime, and the server's list is
        // the only honest answer about what is still pending.
        await load();
      } catch (e) {
        setRowError((p) => ({
          ...p,
          [submission.id]: e instanceof Error ? e.message : String(e),
        }));
      } finally {
        setBusyId(null);
      }
    },
    [rejecting, load, t]
  );

  const flaggedCount = useMemo(
    () => submissions.filter((s) => s.results?.some((r) => isFlagged(r.flag))).length,
    [submissions]
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FlaskConical className="w-6 h-6 text-amber-400" aria-hidden="true" />
            {t('lab.review.title')}
          </h1>
          <p className="text-slate-400 text-sm mt-1">{t('lab.review.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          {t('common.refresh')}
        </button>
      </header>

      {notice && (
        <div
          role="status"
          className="mb-4 p-3 rounded-lg bg-emerald-900/40 border border-emerald-700 text-emerald-200 text-sm"
        >
          {notice}
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="mb-4 p-3 rounded-lg bg-red-900/40 border border-red-700 text-red-200 text-sm"
        >
          {t('lab.review.loadFailed')} — {loadError}
        </div>
      )}

      {!isLoading && submissions.length > 0 && flaggedCount > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-amber-900/30 border border-amber-700 text-amber-200 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          {t('lab.review.flaggedCount', { count: flaggedCount })}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-400 py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          {t('lab.review.loading')}
        </div>
      ) : submissions.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-500" aria-hidden="true" />
          <p>{t('lab.review.empty')}</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {submissions.map((s) => {
            // The API refuses this and says why; disabling the control up front
            // turns a 403 into an explanation.
            const isOwnSubmission = Boolean(myWallet) && s.submitted_by === myWallet;
            const busy = busyId === s.id;

            return (
              <li
                key={s.id}
                className="rounded-xl border border-slate-700 bg-slate-800/60 p-4"
                data-testid={`lab-submission-${s.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-white font-semibold">{s.test_name}</h2>
                    <p className="text-slate-400 text-sm">
                      {s.patient_name} · {s.patient_id} · {s.test_category}
                    </p>
                  </div>
                  <p className="text-slate-500 text-xs">
                    {t('lab.review.submittedAt', {
                      when: new Date(s.submitted_at).toLocaleString(),
                    })}
                  </p>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      {t('lab.review.tableCaption', { test: s.test_name })}
                    </caption>
                    <thead>
                      <tr className="text-slate-400 text-left">
                        <th scope="col" className="py-1 pr-4 font-medium">
                          {t('lab.review.parameter')}
                        </th>
                        <th scope="col" className="py-1 pr-4 font-medium">
                          {t('lab.review.value')}
                        </th>
                        <th scope="col" className="py-1 pr-4 font-medium">
                          {t('lab.review.range')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(s.results ?? []).map((r) => (
                        <tr key={r.parameter} className="border-t border-slate-700/60">
                          <td className="py-1 pr-4 text-slate-200">{r.parameter}</td>
                          <td
                            className={`py-1 pr-4 font-mono ${
                              isFlagged(r.flag) ? 'text-amber-300 font-semibold' : 'text-slate-200'
                            }`}
                          >
                            {r.value} {r.unit}
                            {isFlagged(r.flag) && (
                              <span className="ml-2 text-xs uppercase">{r.flag}</span>
                            )}
                          </td>
                          <td className="py-1 pr-4 text-slate-400">{r.reference_range}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {s.notes && <p className="mt-2 text-slate-400 text-sm">{s.notes}</p>}

                {isOwnSubmission && (
                  <p className="mt-3 text-amber-300 text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    {t('lab.review.selfReview')}
                  </p>
                )}

                {rowError[s.id] && (
                  <p role="alert" className="mt-3 text-red-300 text-sm">
                    {rowError[s.id]}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void decide(s, 'approve')}
                    disabled={busy || isOwnSubmission}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    )}
                    {t('lab.review.approve')}
                  </button>

                  <label className="sr-only" htmlFor={`reason-${s.id}`}>
                    {t('lab.review.reasonLabel', { test: s.test_name })}
                  </label>
                  <input
                    id={`reason-${s.id}`}
                    type="text"
                    value={rejecting[s.id] ?? ''}
                    onChange={(e) => setRejecting((p) => ({ ...p, [s.id]: e.target.value }))}
                    placeholder={t('lab.review.reasonPlaceholder')}
                    className="flex-1 min-w-[12rem] px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => void decide(s, 'reject')}
                    disabled={busy || isOwnSubmission}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <XCircle className="w-4 h-4" aria-hidden="true" />
                    {t('lab.review.reject')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default LabReviewPage;
