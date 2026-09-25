import { useCallback, useEffect, useState } from 'react';
import {
  confirmDialog,
  declareBreach,
  formatTimestamp,
  getApiErrorMessage,
  listSecurityAlerts,
  StepUpDialog,
  useStepUp,
  useTranslation,
} from '@medichain/shared';
import type { SecurityAlert } from '@medichain/shared';
import { Loader2, RefreshCw, ShieldAlert } from 'lucide-react';

/**
 * Security incidents: what the detectors raised, and breach declaration.
 *
 * # Why this page exists
 *
 * `GET /api/admin/security/alerts` and `POST /api/admin/security/breach` had no
 * caller. The detectors (a burst of failed sign-ins, one account opening an
 * abnormal number of records) wrote alerts nobody could see, and there was no
 * way to declare a breach -- the act that starts POPIA's 72-hour notification
 * clock and notifies the security officer and the regulator contact. A breach
 * that can only be declared with curl is not a process an information officer
 * can follow.
 *
 * Declaring is privileged: the server requires a fresh MFA step-up, which
 * `useStepUp` drives, and the page asks for confirmation first because the
 * notifications it sends cannot be recalled.
 */
function SecurityIncidentsPage() {
  const { t } = useTranslation();
  const stepUp = useStepUp();

  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [loaded, setLoaded] = useState(false);
  // "Nothing has been detected" and "the alert log could not be read" are
  // different findings, and an empty list asserts the first.
  const [alertsUnknown, setAlertsUnknown] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [description, setDescription] = useState('');
  const [implicated, setImplicated] = useState('');
  const [declaring, setDeclaring] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await listSecurityAlerts();
      setAlerts(body.alerts ?? []);
      setAlertsUnknown(false);
    } catch (err) {
      setAlertsUnknown(true);
      setError(getApiErrorMessage(err, t('docSecurity.loadFailed')));
    } finally {
      setLoaded(true);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitDeclaration = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const text = description.trim();
    if (!text) {
      setError(t('docSecurity.descriptionRequired'));
      return;
    }
    const confirmed = await confirmDialog({
      message: t('docSecurity.confirmDeclare'),
      confirmLabel: t('docSecurity.declareBtn'),
      destructive: true,
    });
    if (!confirmed) return;
    setDeclaring(true);
    try {
      const actor = implicated.trim();
      // Everything after the declaration lives inside the action: when the
      // server demands a step-up, `useStepUp` holds this function and runs it
      // again once a code is supplied, and only what is in here runs then.
      await stepUp.run(async () => {
        const result = await declareBreach({ description: text, ...(actor ? { actor } : {}) });
        setNotice(
          t('docSecurity.declared', {
            deadline: formatTimestamp(result.alert.notify_deadline ?? ''),
            officers: result.officers_notified,
            regulator: result.regulator_emails_notified,
          })
        );
        setDescription('');
        setImplicated('');
        await load();
      });
    } catch (err) {
      setError(getApiErrorMessage(err, t('docSecurity.declareFailed')));
    } finally {
      setDeclaring(false);
    }
  };

  const severityClass = (severity: string) =>
    severity === 'critical'
      ? 'bg-critical-subtle text-critical-subtle-fg border-critical'
      : 'bg-caution-subtle text-caution-subtle-fg border-caution';

  return (
    <div className="p-6 space-y-6 bg-surface-sunken min-h-screen">
      <div className="flex items-center gap-3">
        <ShieldAlert className="w-7 h-7 text-critical" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-content">{t('docSecurity.title')}</h1>
          <p className="text-sm text-content-muted">{t('docSecurity.subtitle')}</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="bg-critical-subtle border border-critical rounded-lg p-3">
          <p className="text-sm text-critical-subtle-fg">{error}</p>
        </div>
      )}
      {notice && (
        <div role="status" className="bg-ok-subtle border border-ok rounded-lg p-3">
          <p className="text-sm text-ok-subtle-fg">{notice}</p>
        </div>
      )}

      <section className="bg-surface rounded-xl shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-content">{t('docSecurity.alertsHeading')}</h2>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-2 px-3 py-1 text-sm rounded-lg border border-border-interactive text-content min-h-[24px]"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {t('docSecurity.refresh')}
          </button>
        </div>
        {!loaded ? (
          <p className="text-sm text-content-muted flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            {t('docSecurity.loading')}
          </p>
        ) : alertsUnknown ? (
          <p className="text-sm text-content-muted">{t('docSecurity.alertsUnknown')}</p>
        ) : alerts.length === 0 ? (
          <p className="text-sm text-content-muted">{t('docSecurity.noAlerts')}</p>
        ) : (
          <ul className="space-y-2" data-testid="security-alerts">
            {alerts.map((alert) => (
              <li key={alert.id} className={`border rounded-lg p-3 ${severityClass(alert.severity)}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold uppercase">{t(`docSecurity.kind_${alert.kind}`)}</span>
                  <span className="text-xs">{formatTimestamp(alert.created_at)}</span>
                </div>
                <p className="text-sm mt-1">{alert.message}</p>
                {alert.actor && (
                  <p className="text-xs mt-1 break-all">{t('docSecurity.actorLine', { actor: alert.actor })}</p>
                )}
                {alert.notify_deadline && (
                  <p className="text-xs mt-1 font-medium">
                    {t('docSecurity.deadlineLine', { deadline: formatTimestamp(alert.notify_deadline) })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-surface rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-content mb-1">{t('docSecurity.declareHeading')}</h2>
        <p className="text-sm text-content-muted mb-4">{t('docSecurity.declareSubtitle')}</p>
        <form onSubmit={submitDeclaration} className="space-y-3">
          <div>
            <label htmlFor="breach-description" className="block text-sm font-medium text-content-secondary mb-1">
              {t('docSecurity.descriptionLabel')}
            </label>
            <textarea
              id="breach-description"
              value={description}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg bg-surface text-content"
            />
          </div>
          <div>
            <label htmlFor="breach-actor" className="block text-sm font-medium text-content-secondary mb-1">
              {t('docSecurity.actorLabel')}
            </label>
            <input
              id="breach-actor"
              value={implicated}
              onChange={(e) => setImplicated(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg bg-surface text-content"
            />
          </div>
          <button
            type="submit"
            disabled={declaring}
            className="px-4 py-2 rounded-lg font-medium bg-critical text-critical-fg disabled:opacity-60 min-h-[24px]"
          >
            {declaring ? t('docSecurity.declaring') : t('docSecurity.declareBtn')}
          </button>
        </form>
      </section>

      <StepUpDialog state={stepUp} />
    </div>
  );
}

export default SecurityIncidentsPage;
