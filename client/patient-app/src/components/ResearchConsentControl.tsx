import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  formatTimestamp,
  getResearchConsent,
  giveResearchConsent,
  revokeConsent,
  useTranslation,
} from '@medichain/shared';
import type { ResearchConsent } from '@medichain/shared';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * The patient's research consent, as a recorded consent rather than a
 * preference: giving it signs a versioned consent, withdrawing it revokes
 * that consent. Only patients with an active consent on the current terms
 * are ever included, de-identified, in a research export.
 */
export function ResearchConsentControl({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>('loading');
  const [consent, setConsent] = useState<ResearchConsent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      setConsent(await getResearchConsent(patientId));
      setState('ready');
    } catch (err) {
      console.error('Research consent could not be loaded:', err);
      setState('error');
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = async () => {
    setBusy(true);
    setError('');
    try {
      if (consent) await revokeConsent(consent.consentId, 'Withdrawn by the patient in Settings');
      else await giveResearchConsent(patientId);
      await load();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('settings.researchChangeFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-content-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('settings.researchLoading')}
      </p>
    );
  }
  if (state === 'error') {
    return <p role="alert" className="text-sm text-critical-subtle-fg">{t('settings.researchLoadFailed')}</p>;
  }
  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <p className="text-xs text-content-muted">
        {consent
          ? t('settings.researchGivenOn', { date: formatTimestamp(consent.signedAt * 1000), version: consent.version ?? '' })
          : t('settings.researchNotGiven')}
      </p>
      <button
        type="button"
        onClick={() => void change()}
        disabled={busy}
        className="rounded-md border border-border px-3 py-1 text-sm font-medium text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
      >
        {busy ? t('settings.researchSaving') : consent ? t('settings.researchWithdraw') : t('settings.researchGive')}
      </button>
      {error && <p role="alert" className="text-xs text-critical-subtle-fg">{error}</p>}
    </div>
  );
}
