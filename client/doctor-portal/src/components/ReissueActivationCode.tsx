import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import {
  ApiClientError,
  confirmDialog,
  reissuePatientActivationCode,
  useTranslation,
} from '@medichain/shared';
import { OneTimeCodePanel } from './OneTimeCodePanel';

/**
 * Issue a patient a new activation code, from their chart.
 *
 * The code from registration is shown once and cannot be looked up again. A
 * patient who lost it, or let it expire, had no way back in: the endpoint
 * existed and no screen called it. An administrator may reissue for anyone;
 * a doctor or nurse for a patient they registered (the server decides).
 */
export function ReissueActivationCode({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [refusal, setRefusal] = useState('');

  const issue = async () => {
    const go = await confirmDialog({
      title: t('docReissueActivation.confirmTitle'),
      message: t('docReissueActivation.confirmBody'),
      confirmLabel: t('docReissueActivation.confirmLabel'),
    });
    if (!go) return;
    setBusy(true);
    setRefusal('');
    try {
      const result = await reissuePatientActivationCode(patientId);
      setIssued({ code: result.activation_code, expiresAt: result.activation_expires_at });
    } catch (err) {
      const status = err instanceof ApiClientError ? err.status : 0;
      setRefusal(
        status === 409 ? t('docReissueActivation.alreadyActive')
          : status === 404 ? t('docReissueActivation.noAccount')
            : status === 403 ? t('docReissueActivation.notYours')
              : t('docReissueActivation.failed'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface rounded-lg border border-border p-4" aria-labelledby="reissue-activation-heading">
      <div className="flex items-center gap-2 mb-2">
        <KeyRound className="text-content-muted" size={20} aria-hidden="true" />
        <h3 id="reissue-activation-heading" className="font-semibold text-content">
          {t('docReissueActivation.heading')}
        </h3>
      </div>
      {issued ? (
        <OneTimeCodePanel
          code={issued.code}
          expiresAt={issued.expiresAt}
          identifier={patientId}
          identifierLabel={t('docRegisterPatient.patientId')}
          title={t('docRegisterPatient.activationTitle')}
          body={t('docReissueActivation.issuedBody')}
          printTitle={t('docRegisterPatient.activationPrintTitle')}
          printBody={t('docRegisterPatient.activationPrintBody')}
        />
      ) : (
        <>
          <p className="text-sm text-content-muted mb-3">{t('docReissueActivation.explain')}</p>
          <button
            type="button"
            onClick={() => void issue()}
            aria-disabled={busy || undefined}
            className="px-4 py-2 rounded-lg border border-border-interactive text-content hover:bg-surface-sunken aria-disabled:cursor-wait"
          >
            {busy ? t('docReissueActivation.issuing') : t('docReissueActivation.issue')}
          </button>
          {refusal && <p role="alert" className="mt-2 text-sm text-critical-subtle-fg">{refusal}</p>}
        </>
      )}
    </section>
  );
}
