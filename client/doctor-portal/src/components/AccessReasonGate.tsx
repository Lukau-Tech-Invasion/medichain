import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { getApiClient, useTranslation } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';

/** Reason codes the server maps to fixed wording for the patient. */
const REASON_CODES = ['treatment', 'referral', 'emergency', 'administrative'] as const;

/** Longest free-text reason accepted; the server caps at the same length. */
const MAX_OTHER_REASON_CHARS = 140;

/**
 * Reasons already declared in this browser tab, by patient id, so moving
 * between a chart's sections does not ask again. Held in memory only: a reason
 * is a statement about *this* visit, and must not survive a reload or leak to
 * a later session.
 */
const declaredReasons = new Map<string, string>();

interface AccessReasonGateProps {
  /** The patient whose chart is being opened. */
  patientId: string | undefined;
  /** The chart; rendered only after a reason is declared. */
  children: ReactNode;
}

/**
 * Asks a clinician why they are opening a patient's chart before any of the
 * patient's data is requested.
 *
 * Every read of the chart is then sent with that reason (`X-Access-Reason`),
 * and the patient's "Who viewed my records" page shows it. The chart's children
 * are not mounted until a reason is chosen, so no read can go out unexplained.
 * The context is cleared when the chart closes, so another patient's reads can
 * never inherit this reason.
 */
export function AccessReasonGate({ patientId, children }: AccessReasonGateProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<string | undefined>(() =>
    patientId ? declaredReasons.get(patientId) : undefined,
  );

  useEffect(() => {
    setReason(patientId ? declaredReasons.get(patientId) : undefined);
  }, [patientId]);

  useEffect(() => {
    if (!patientId || !reason) return undefined;
    getApiClient().setPatientAccessContext({ patientId, reason });
    return () => getApiClient().setPatientAccessContext(undefined);
  }, [patientId, reason]);

  if (!patientId || reason) {
    return <>{children}</>;
  }

  /**
   * Record the declared reason and open the chart.
   *
   * @param chosen - A reason code or cleaned free text.
   */
  const declare = (chosen: string) => {
    declaredReasons.set(patientId, chosen);
    setReason(chosen);
  };

  return <ReasonPrompt onDeclare={declare} title={t('accessReason.title')} />;
}

/** Ask once per portal session before any patient directory search is issued. */
export function DirectoryReasonGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const role = useAuthStore((state) => state.user?.role);
  const [reason, setReason] = useState<string>();

  useEffect(() => () => getApiClient().setDirectoryPurpose(undefined), []);

  if (role === 'Paramedic') return <>{children}</>;

  if (!reason) {
    return <ReasonPrompt
      title={t('accessReason.directoryTitle')}
      onDeclare={(chosen) => {
        getApiClient().setDirectoryPurpose(chosen);
        setReason(chosen);
      }}
    />;
  }
  return <>{children}</>;
}

/**
 * The prompt itself: four one-click reasons plus a short free-text option.
 *
 * @param props.onDeclare - Called with the chosen reason.
 * @param props.title - Heading text.
 */
function ReasonPrompt({ onDeclare, title }: { onDeclare: (reason: string) => void; title: string }) {
  const { t } = useTranslation();
  const [other, setOther] = useState('');
  const headingId = useId();
  const otherId = useId();
  const trimmedOther = other.trim();

  return (
    <section
      aria-labelledby={headingId}
      className="max-w-lg mx-auto mt-10 bg-surface border border-border rounded-xl p-6"
      data-testid="access-reason-gate"
    >
      <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold text-content">
        <ShieldAlert className="w-5 h-5" aria-hidden="true" />
        {title}
      </h2>
      <p className="text-sm text-content-muted mt-1 mb-4">{t('accessReason.explainer')}</p>
      <div className="grid grid-cols-2 gap-2">
        {REASON_CODES.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => onDeclare(code)}
            className="px-3 py-2 rounded-lg border border-border text-sm text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {t(`accessReason.${code}`)}
          </button>
        ))}
      </div>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmedOther) onDeclare(trimmedOther);
        }}
      >
        <label htmlFor={otherId} className="sr-only">
          {t('accessReason.otherLabel')}
        </label>
        <input
          id={otherId}
          value={other}
          maxLength={MAX_OTHER_REASON_CHARS}
          onChange={(event) => setOther(event.target.value)}
          placeholder={t('accessReason.otherPlaceholder')}
          className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        />
        <button
          type="submit"
          disabled={!trimmedOther}
          className="px-3 py-2 rounded-lg border border-border text-sm text-content disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          {t('accessReason.continue')}
        </button>
      </form>
    </section>
  );
}
