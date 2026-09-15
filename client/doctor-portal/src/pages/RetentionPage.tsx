import { useState, useEffect, useCallback } from 'react';
import {
  createLegalHold,
  decideRetentionApproval,
  executeRetentionApproval,
  getApiErrorMessage,
  getDeletionRegister,
  getRetentionReport,
  liftProcessingRestriction,
  listLegalHolds,
  listProcessingRestrictions,
  listRetentionApprovals,
  listRetentionRuns,
  releaseLegalHold,
  requestRetentionApproval,
  useTranslation,
} from '@medichain/shared';
import type {
  DeletionRegisterEntry,
  LegalHold,
  ProcessingRestriction,
  RetentionApproval,
  RetentionAssessment,
  RetentionJobRun,
} from '@medichain/shared';
import { Archive, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

/**
 * Data-retention administration (POPIA).
 *
 * # Why this page exists
 *
 * Eleven endpoints implemented a maker-checker retention workflow -- assess,
 * mint a token bound to that exact record set, have it decided, then execute --
 * and not one of them had a client function or a screen. A compliance control
 * that no person can operate is not a control: the obligation was implemented
 * in Rust and unreachable from the product.
 *
 * # What executing does, and does not do
 *
 * Nothing here deletes. Execution restricts processing to storage and writes a
 * register entry. That boundary is deliberate (ADR-0005, `api/src/retention`),
 * and this page says so on the button rather than leaving an administrator to
 * infer it from a word like "execute".
 */

/** An assessment that did not run is not an assessment that found nothing. */
function AssessmentPanel({
  assessment,
  loaded,
  failed,
}: {
  assessment: RetentionAssessment | null;
  loaded: boolean;
  failed: boolean;
}) {
  const { t } = useTranslation();
  if (!loaded) {
    return (
      <p className="text-sm text-content-muted flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" /> {t('docRetention.loading')}
      </p>
    );
  }
  if (failed || !assessment) {
    return <p className="text-sm text-content-muted">{t('docRetention.reportUnknown')}</p>;
  }
  return (
    <div>
      {/* The single most important thing on this page. `total_due: 0` from an
          assessment that could not run looks exactly like a clean result, and
          approving against it would be approving nothing while appearing to
          approve something. */}
      {assessment.incomplete_reason && (
        <div role="alert" className="mb-4 bg-caution-subtle border border-caution rounded-lg p-3">
          <p className="text-sm text-caution-subtle-fg">
            {t('docRetention.incomplete', { reason: assessment.incomplete_reason })}
          </p>
        </div>
      )}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div>
          <dt className="text-xs text-content-muted">{t('docRetention.assessedOn')}</dt>
          <dd className="text-content font-semibold">{assessment.assessed_on}</dd>
        </div>
        <div>
          <dt className="text-xs text-content-muted">{t('docRetention.totalDue')}</dt>
          <dd className="text-content font-semibold">{assessment.total_due}</dd>
        </div>
        <div>
          <dt className="text-xs text-content-muted">{t('docRetention.totalHeld')}</dt>
          <dd className="text-content font-semibold">{assessment.total_held}</dd>
        </div>
        <div>
          <dt className="text-xs text-content-muted">{t('docRetention.deleted')}</dt>
          <dd className="text-content font-semibold">{assessment.records_deleted}</dd>
        </div>
      </dl>

      {assessment.policies.length === 0 ? (
        // The seeded policy matrix ships inactive on purpose: the periods await
        // legal confirmation. That is a different statement from "nothing is
        // due", and an administrator needs to be able to tell them apart.
        <p className="text-sm text-content-muted">{t('docRetention.noPolicies')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="policy-table">
            <thead>
              <tr className="text-left text-content-muted">
                <th scope="col" className="py-2 pr-4">{t('docRetention.colPolicy')}</th>
                <th scope="col" className="py-2 pr-4">{t('docRetention.colEntity')}</th>
                <th scope="col" className="py-2 pr-4">{t('docRetention.colEvaluated')}</th>
                <th scope="col" className="py-2 pr-4">{t('docRetention.colDue')}</th>
                <th scope="col" className="py-2 pr-4">{t('docRetention.colHeld')}</th>
              </tr>
            </thead>
            <tbody>
              {assessment.policies.map((policy) => (
                <tr key={policy.policy_id} className="border-t border-border">
                  <td className="py-2 pr-4 text-content">
                    {policy.policy_name}
                    {/* A policy that could not be evaluated is not a policy that
                        found nothing due. */}
                    {policy.configuration_error && (
                      <span className="block text-xs text-critical-subtle-fg">
                        {policy.configuration_error}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-content-secondary">{policy.entity_type}</td>
                  <td className="py-2 pr-4 text-content-muted">{policy.evaluated}</td>
                  <td className="py-2 pr-4 text-content">{policy.due}</td>
                  <td className="py-2 pr-4 text-content-muted">{policy.held}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RetentionPage() {
  const { t } = useTranslation();
  // Maker-checker: the repository refuses a decision from the account that
  // requested the token. Offering the button anyway would send an administrator
  // into a refusal for a rule the screen already knows about.
  const { user } = useAuthStore();

  const [assessment, setAssessment] = useState<RetentionAssessment | null>(null);
  const [reportLoaded, setReportLoaded] = useState(false);
  const [reportFailed, setReportFailed] = useState(false);

  const [runs, setRuns] = useState<RetentionJobRun[]>([]);
  const [holds, setHolds] = useState<LegalHold[]>([]);
  const [approvals, setApprovals] = useState<RetentionApproval[]>([]);
  const [restrictions, setRestrictions] = useState<ProcessingRestriction[]>([]);
  const [register, setRegister] = useState<DeletionRegisterEntry[]>([]);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [holdPatientId, setHoldPatientId] = useState('');
  const [holdEntityType, setHoldEntityType] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [holdReference, setHoldReference] = useState('');

  const loadReport = useCallback(async () => {
    try {
      const body = await getRetentionReport();
      setAssessment(body.assessment);
      setReportFailed(false);
    } catch (err) {
      setReportFailed(true);
      setError(getApiErrorMessage(err, t('docRetention.reportFailed')));
    } finally {
      setReportLoaded(true);
    }
  }, [t]);

  const loadLists = useCallback(async () => {
    // Each read is separate on purpose: one failing list must not blank the
    // other four, and the one that failed should say so rather than render as
    // empty.
    const results = await Promise.allSettled([
      listRetentionRuns(),
      listLegalHolds(),
      listRetentionApprovals(),
      listProcessingRestrictions(),
      getDeletionRegister(),
    ]);
    if (results[0].status === 'fulfilled') setRuns(results[0].value.runs ?? []);
    if (results[1].status === 'fulfilled') setHolds(results[1].value.holds ?? []);
    if (results[2].status === 'fulfilled') setApprovals(results[2].value.approvals ?? []);
    if (results[3].status === 'fulfilled') setRestrictions(results[3].value.restrictions ?? []);
    if (results[4].status === 'fulfilled') setRegister(results[4].value.entries ?? []);
    const firstFailure = results.find((r) => r.status === 'rejected');
    if (firstFailure && firstFailure.status === 'rejected') {
      setError(getApiErrorMessage(firstFailure.reason, t('docRetention.listFailed')));
    }
  }, [t]);

  useEffect(() => {
    void loadReport();
    void loadLists();
  }, [loadReport, loadLists]);

  const run = async (key: string, action: () => Promise<string>) => {
    setError('');
    setNotice('');
    setBusy(key);
    try {
      setNotice(await action());
      await loadReport();
      await loadLists();
    } catch (err) {
      setError(getApiErrorMessage(err, t('docRetention.actionFailed')));
    } finally {
      setBusy(null);
    }
  };

  const submitHold = async (event: React.FormEvent) => {
    event.preventDefault();
    // A hold scoped to neither a patient nor an entity type covers nothing
    // while looking like protection. The server refuses it; saying so here
    // saves a round trip and names which field is missing.
    if (!holdPatientId.trim() && !holdEntityType.trim()) {
      setError(t('docRetention.holdScopeRequired'));
      return;
    }
    await run('hold', async () => {
      await createLegalHold({
        patient_id: holdPatientId.trim() || null,
        entity_type: holdEntityType.trim() || null,
        reason: holdReason,
        reference: holdReference.trim() || null,
      });
      setHoldPatientId('');
      setHoldEntityType('');
      setHoldReason('');
      setHoldReference('');
      return t('docRetention.holdPlaced');
    });
  };

  const activeHolds = holds.filter((hold) => !hold.released_at);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-content flex items-center gap-2">
          <Archive size={24} /> {t('docRetention.title')}
        </h1>
        <p className="text-sm text-content-muted mt-1">{t('docRetention.subtitle')}</p>
      </header>

      {error && (
        <div role="alert" className="mb-4 bg-critical-subtle border border-critical rounded-lg p-3">
          <p className="text-sm text-critical-subtle-fg">{error}</p>
        </div>
      )}
      {notice && (
        <div role="status" className="mb-4 bg-ok-subtle border border-ok rounded-lg p-3">
          <p className="text-sm text-ok-subtle-fg">{notice}</p>
        </div>
      )}

      <section className="bg-surface rounded-xl shadow p-6 mb-8">
        <h2 className="font-semibold text-content mb-1">{t('docRetention.reportHeading')}</h2>
        <p className="text-sm text-content-muted mb-4">{t('docRetention.reportSubtitle')}</p>
        <AssessmentPanel assessment={assessment} loaded={reportLoaded} failed={reportFailed} />
      </section>

      <section className="bg-surface rounded-xl shadow p-6 mb-8">
        <h2 className="font-semibold text-content mb-1">{t('docRetention.holdsHeading')}</h2>
        <p className="text-sm text-content-muted mb-4">{t('docRetention.holdsSubtitle')}</p>

        <form onSubmit={submitHold} className="grid gap-4 md:grid-cols-2 mb-6">
          <div>
            <label htmlFor="hold-patient" className="block text-sm font-medium text-content-secondary mb-1">
              {t('docRetention.holdPatient')}
            </label>
            <input
              id="hold-patient"
              value={holdPatientId}
              onChange={(e) => setHoldPatientId(e.target.value)}
              placeholder={t('docRetention.holdPatientPlaceholder')}
              className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px]"
            />
          </div>
          <div>
            <label htmlFor="hold-entity" className="block text-sm font-medium text-content-secondary mb-1">
              {t('docRetention.holdEntity')}
            </label>
            <input
              id="hold-entity"
              value={holdEntityType}
              onChange={(e) => setHoldEntityType(e.target.value)}
              placeholder={t('docRetention.holdEntityPlaceholder')}
              className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px]"
            />
          </div>
          <div>
            <label htmlFor="hold-reason" className="block text-sm font-medium text-content-secondary mb-1">
              {t('docRetention.holdReason')}
            </label>
            <input
              id="hold-reason"
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
              required
              placeholder={t('docRetention.holdReasonPlaceholder')}
              className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px]"
            />
          </div>
          <div>
            <label htmlFor="hold-reference" className="block text-sm font-medium text-content-secondary mb-1">
              {t('docRetention.holdReference')}
            </label>
            <input
              id="hold-reference"
              value={holdReference}
              onChange={(e) => setHoldReference(e.target.value)}
              placeholder={t('docRetention.holdReferencePlaceholder')}
              className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px]"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={busy === 'hold'}
              className="px-4 py-2 bg-brand text-brand-fg rounded-lg disabled:opacity-60 min-h-[44px]"
            >
              {busy === 'hold' ? t('docRetention.placing') : t('docRetention.placeHold')}
            </button>
          </div>
        </form>

        {activeHolds.length === 0 ? (
          <p className="text-sm text-content-muted">{t('docRetention.noHolds')}</p>
        ) : (
          <ul className="space-y-2" data-testid="hold-list">
            {activeHolds.map((hold) => (
              <li
                key={hold.id}
                className="border border-border rounded-lg p-3 flex items-start justify-between gap-4"
              >
                <div>
                  <p className="text-sm text-content">{hold.reason}</p>
                  <p className="text-xs text-content-muted">
                    {hold.patient_id || hold.entity_type}
                    {hold.reference ? ` · ${hold.reference}` : ''} ·{' '}
                    {new Date(hold.applied_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void run(`release-${hold.id}`, async () => {
                      await releaseLegalHold(hold.id, 'Released from retention administration');
                      return t('docRetention.holdReleased');
                    })
                  }
                  disabled={busy === `release-${hold.id}`}
                  className="px-3 py-1 text-xs rounded-lg border border-border-interactive text-content-secondary disabled:opacity-60 min-h-[28px] whitespace-nowrap"
                >
                  {t('docRetention.release')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-surface rounded-xl shadow p-6 mb-8">
        <h2 className="font-semibold text-content mb-1">{t('docRetention.approvalsHeading')}</h2>
        <p className="text-sm text-content-muted mb-4">{t('docRetention.approvalsSubtitle')}</p>

        <button
          type="button"
          onClick={() =>
            void run('request', async () => {
              const body = await requestRetentionApproval();
              return t('docRetention.approvalRequested', { count: body.approval.due_count });
            })
          }
          disabled={busy === 'request'}
          className="mb-4 px-4 py-2 bg-brand text-brand-fg rounded-lg disabled:opacity-60 min-h-[44px]"
        >
          {busy === 'request' ? t('docRetention.requesting') : t('docRetention.requestApproval')}
        </button>

        {approvals.length === 0 ? (
          <p className="text-sm text-content-muted">{t('docRetention.noApprovals')}</p>
        ) : (
          <ul className="space-y-2" data-testid="approval-list">
            {approvals.map((approval) => (
              <li key={approval.token} className="border border-border rounded-lg p-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-content">
                      {t('docRetention.approvalLine', {
                        count: approval.due_count,
                        date: approval.assessed_on,
                      })}
                    </p>
                    <p className="text-xs text-content-muted break-all">
                      {approval.status} · {t('docRetention.expires')}{' '}
                      {new Date(approval.expires_at).toLocaleString()} · {approval.token}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    {approval.status === 'pending' && approval.requested_by === user?.walletAddress && (
                      <span className="text-xs text-content-muted whitespace-nowrap">
                        {t('docRetention.needsSecondAdmin')}
                      </span>
                    )}
                    {approval.status === 'pending' && approval.requested_by !== user?.walletAddress && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void run(`approve-${approval.token}`, async () => {
                              await decideRetentionApproval(approval.token, true);
                              return t('docRetention.approved');
                            })
                          }
                          disabled={busy === `approve-${approval.token}`}
                          className="px-3 py-1 text-xs rounded-lg border border-border-interactive text-content-secondary disabled:opacity-60 min-h-[28px]"
                        >
                          {t('docRetention.approve')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void run(`reject-${approval.token}`, async () => {
                              await decideRetentionApproval(
                                approval.token,
                                false,
                                'Rejected from retention administration'
                              );
                              return t('docRetention.rejected');
                            })
                          }
                          disabled={busy === `reject-${approval.token}`}
                          className="px-3 py-1 text-xs rounded-lg border border-critical text-critical-subtle-fg disabled:opacity-60 min-h-[28px]"
                        >
                          {t('docRetention.reject')}
                        </button>
                      </>
                    )}
                    {approval.status === 'approved' && (
                      <button
                        type="button"
                        onClick={() =>
                          void run(`execute-${approval.token}`, async () => {
                            // Report what it did, not that it ran. An execution
                            // that restricted nothing because the record set was
                            // empty and one that restricted forty records are
                            // different outcomes.
                            const body = await executeRetentionApproval(approval.token);
                            return t('docRetention.executed', {
                              restricted: body.outcome.restricted,
                              held: body.outcome.skipped_for_hold,
                            });
                          })
                        }
                        disabled={busy === `execute-${approval.token}`}
                        className="px-3 py-1 text-xs rounded-lg border border-border-interactive text-content-secondary disabled:opacity-60 min-h-[28px]"
                      >
                        {/* Named for what it does. "Execute" alone reads as
                            deletion, and this deletes nothing. */}
                        {t('docRetention.execute')}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-surface rounded-xl shadow p-6 mb-8">
        <h2 className="font-semibold text-content mb-1">{t('docRetention.restrictionsHeading')}</h2>
        <p className="text-sm text-content-muted mb-4">{t('docRetention.restrictionsSubtitle')}</p>
        {restrictions.length === 0 ? (
          <p className="text-sm text-content-muted">{t('docRetention.noRestrictions')}</p>
        ) : (
          <ul className="space-y-2" data-testid="restriction-list">
            {restrictions.map((restriction) => (
              <li
                key={restriction.id}
                className="border border-border rounded-lg p-3 flex items-start justify-between gap-4"
              >
                <div>
                  <p className="text-sm text-content">
                    {restriction.patient_id} · {restriction.entity_type}
                  </p>
                  <p className="text-xs text-content-muted">
                    {restriction.reason} · {new Date(restriction.restricted_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void run(`lift-${restriction.id}`, async () => {
                      await liftProcessingRestriction(
                        restriction.id,
                        'Lifted from retention administration'
                      );
                      return t('docRetention.lifted');
                    })
                  }
                  disabled={busy === `lift-${restriction.id}`}
                  className="px-3 py-1 text-xs rounded-lg border border-border-interactive text-content-secondary disabled:opacity-60 min-h-[28px] whitespace-nowrap"
                >
                  {t('docRetention.lift')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-surface rounded-xl shadow p-6 mb-8">
        <h2 className="font-semibold text-content mb-1">{t('docRetention.registerHeading')}</h2>
        <p className="text-sm text-content-muted mb-4">{t('docRetention.registerSubtitle')}</p>
        {register.length === 0 ? (
          <p className="text-sm text-content-muted">{t('docRetention.noRegister')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="register-table">
              <thead>
                <tr className="text-left text-content-muted">
                  <th scope="col" className="py-2 pr-4">{t('docRetention.colPatient')}</th>
                  <th scope="col" className="py-2 pr-4">{t('docRetention.colEntity')}</th>
                  <th scope="col" className="py-2 pr-4">{t('docRetention.colAction')}</th>
                  <th scope="col" className="py-2 pr-4">{t('docRetention.colBasis')}</th>
                  <th scope="col" className="py-2 pr-4">{t('docRetention.colWhen')}</th>
                </tr>
              </thead>
              <tbody>
                {register.map((entry) => (
                  <tr key={entry.id} className="border-t border-border">
                    <td className="py-2 pr-4 text-content">{entry.patient_id}</td>
                    <td className="py-2 pr-4 text-content-secondary">{entry.entity_type}</td>
                    <td className="py-2 pr-4 text-content-secondary">{entry.action}</td>
                    <td className="py-2 pr-4 text-content-muted">{entry.basis}</td>
                    <td className="py-2 pr-4 text-content-muted">
                      {new Date(entry.executed_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-surface rounded-xl shadow p-6">
        <h2 className="font-semibold text-content mb-1">{t('docRetention.runsHeading')}</h2>
        <p className="text-sm text-content-muted mb-4">{t('docRetention.runsSubtitle')}</p>
        {runs.length === 0 ? (
          <p className="text-sm text-content-muted">{t('docRetention.noRuns')}</p>
        ) : (
          <ul className="space-y-2" data-testid="run-list">
            {runs.slice(0, 20).map((jobRun) => (
              <li key={jobRun.id} className="border border-border rounded-lg p-3">
                <p className="text-sm text-content">
                  {jobRun.entity_type} · {jobRun.status ?? t('docRetention.statusUnknown')}
                </p>
                <p className="text-xs text-content-muted">
                  {t('docRetention.runLine', {
                    threshold: jobRun.date_threshold,
                    evaluated: jobRun.records_evaluated ?? 0,
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default RetentionPage;
