import { useId, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import {
  ApiClientError,
  BreakGlassPanel,
  CARE_RELATIONSHIP_REQUIRED,
  getApiClient,
  openAccessContext,
  useTranslation,
} from '@medichain/shared';

/** Reason codes the server maps to fixed wording for the patient. */
const REASON_CODES = ['treatment', 'referral', 'emergency', 'administrative'] as const;

/** Longest free-text reason accepted; the server caps at the same length. */
const MAX_OTHER_REASON_CHARS = 140;

/** A declared reason and the server-issued context it opened (WP10). */
export interface DeclaredAccess {
  reason: string;
  contextId: string;
}

/**
 * Reasons already declared in this browser tab, by patient id, so moving
 * between a chart's sections -- or between pages that pick the same patient --
 * does not ask again. Held in memory only: a reason is a statement about *this*
 * visit, and must not survive a reload or leak to a later session.
 */
const declared = new Map<string, DeclaredAccess>();

/** The access already declared for `patientId` in this tab, if any. */
export function declaredAccessFor(patientId: string | undefined): DeclaredAccess | undefined {
  return patientId ? declared.get(patientId) : undefined;
}

/** Send `access` with every read of `patientId` until cleared. */
export function applyAccess(patientId: string, access: DeclaredAccess): void {
  getApiClient().setPatientAccessContext({ patientId, reason: access.reason, contextId: access.contextId });
}

/** Forget declared reasons (tests only: a real tab keeps them until reload). */
export function resetDeclaredAccessForTests(): void {
  declared.clear();
}

type Step =
  | { kind: 'ask' }
  | { kind: 'opening' }
  | { kind: 'break_glass'; reason: string }
  | { kind: 'failed'; reason: string; message: string };

interface ChartAccessPromptProps {
  patientId: string;
  title: string;
  /** Called once the server has issued a context for this patient. */
  onReady: (access: DeclaredAccess) => void;
  /** Offered as a way out when the prompt is shown in a dialog. */
  onCancel?: () => void;
}

/**
 * Ask why a chart is being opened, then open a server-issued access context.
 *
 * The server checks the clinician's authority first (WP9). Without a care
 * relationship the prompt turns into the break-glass form; once the glass is
 * broken the same reason opens the context. A failure is said plainly and the
 * chart stays closed: no read goes out without a context.
 */
export function ChartAccessPrompt({ patientId, title, onReady, onCancel }: ChartAccessPromptProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ kind: 'ask' });

  const open = async (reason: string) => {
    setStep({ kind: 'opening' });
    try {
      const context = await openAccessContext(patientId, reason);
      const access = { reason, contextId: context.access_context_id };
      declared.set(patientId, access);
      onReady(access);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === CARE_RELATIONSHIP_REQUIRED) {
        setStep({ kind: 'break_glass', reason });
        return;
      }
      const message = err instanceof Error && err.message ? err.message : t('accessReason.openFailed');
      setStep({ kind: 'failed', reason, message });
    }
  };

  if (step.kind === 'opening') {
    return (
      <p role="status" className="mt-10 flex items-center justify-center gap-2 text-sm text-content-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('accessReason.opening')}
      </p>
    );
  }
  if (step.kind === 'break_glass') {
    return <BreakGlassPanel patientId={patientId} onOpened={() => void open(step.reason)} />;
  }
  if (step.kind === 'failed') {
    return (
      <div role="alert" className="mx-auto mt-10 max-w-lg rounded-xl border border-border bg-surface p-6 text-sm text-content">
        <p>{step.message}</p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => void open(step.reason)} className={buttonClass}>
            {t('accessReason.tryAgain')}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className={buttonClass}>
              {t('accessReason.cancel')}
            </button>
          )}
        </div>
      </div>
    );
  }
  return <ReasonPrompt title={title} onDeclare={(reason) => void open(reason)} onCancel={onCancel} />;
}

const buttonClass =
  'px-3 py-2 rounded-lg border border-border text-sm text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

interface ReasonPromptProps {
  onDeclare: (reason: string) => void;
  title: string;
  onCancel?: () => void;
}

/**
 * The prompt itself: four one-click reasons plus a short free-text option.
 *
 * @param props.onDeclare - Called with the chosen reason.
 * @param props.title - Heading text.
 * @param props.onCancel - Optional way out (in a dialog).
 */
export function ReasonPrompt({ onDeclare, title, onCancel }: ReasonPromptProps) {
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
          <button key={code} type="button" onClick={() => onDeclare(code)} className={buttonClass}>
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
          className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
        <button type="submit" disabled={!trimmedOther} className={`${buttonClass} disabled:opacity-50`}>
          {t('accessReason.continue')}
        </button>
      </form>
      {onCancel && (
        <button type="button" onClick={onCancel} className={`${buttonClass} mt-3`}>
          {t('accessReason.cancel')}
        </button>
      )}
    </section>
  );
}
