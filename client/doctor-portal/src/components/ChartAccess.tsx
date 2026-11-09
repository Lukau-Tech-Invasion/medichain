import { useId, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import {
  ApiClientError,
  BreakGlassPanel,
  CARE_RELATIONSHIP_REQUIRED,
  formatDateOnly,
  getApiClient,
  openAccessContext,
  useTranslation,
} from '@medichain/shared';
import { DocumentAccessRequest } from './DocumentAccessRequest';
import { identifiedPatient } from '../workspace/identifiedPatients';
import { ageInYears, initials } from '../workspace/identity';
import { usePatientStore } from '../store/patientStore';

// ux-allow(no-form): rendered inside other pages' forms, where a nested <form> is invalid; Enter is handled on the control itself.

/** Reason codes the server maps to fixed wording for the patient. */
const REASON_CODES = ['treatment', 'referral', 'emergency', 'administrative'] as const;
export type ReasonCode = typeof REASON_CODES[number];

/** Whether a declared reason is one of the one-click codes rather than free text. */
export function isReasonCode(reason: string): reason is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(reason);
}

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
const declared = new Map<string, {
  access: DeclaredAccess;
  ownerId: string | undefined;
  sessionRevision: number;
  expiresAt: number;
}>();

/** The access already declared for `patientId` in this tab, if any. */
export function declaredAccessFor(patientId: string | undefined): DeclaredAccess | undefined {
  if (!patientId) return undefined;
  const saved = declared.get(patientId);
  const client = getApiClient();
  if (!saved) return undefined;
  if (saved.ownerId !== client.getUserId() || saved.sessionRevision !== client.getSessionRevision() || saved.expiresAt <= Date.now()) {
    declared.delete(patientId);
    return undefined;
  }
  return saved.access;
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
    const client = getApiClient();
    const ownerId = client.getUserId();
    const sessionRevision = client.getSessionRevision();
    setStep({ kind: 'opening' });
    try {
      const context = await openAccessContext(patientId, reason);
      if (ownerId !== client.getUserId() || sessionRevision !== client.getSessionRevision()) {
        setStep({ kind: 'failed', reason, message: t('accessReason.openFailed') });
        return;
      }
      const expiresAt = Date.parse(context.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        setStep({ kind: 'failed', reason, message: t('accessReason.openFailed') });
        return;
      }
      const access = { reason, contextId: context.access_context_id };
      declared.set(patientId, { access, ownerId, sessionRevision, expiresAt });
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
    // Emergency first, one tap (mockup c1); asking the patient is the
    // non-emergency path, folded below it rather than stacked above it.
    return <div className="mx-auto max-w-xl space-y-4 px-4 py-4">
      <BreakGlassIdentity patientId={patientId} />
      <BreakGlassPanel patientId={patientId} onOpened={() => void open(step.reason)} />
      <details aria-label="Patient-approved chart access" className="rounded-2xl border border-border bg-surface px-4 py-3">
        <summary className="cursor-pointer font-semibold text-content">{t('breakGlass.notEmergency')}</summary>
        <div className="mt-3">
          <DocumentAccessRequest key={patientId} patientId={patientId} scope="chart" onCheckAccess={() => void open(step.reason)} />
        </div>
      </details>
      {onCancel && <button type="button" onClick={onCancel} className={buttonClass}>{t('accessReason.cancel')}</button>}
    </div>;
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

/**
 * Who this is, before the glass is broken (c1) -- but only if this tab already
 * knew: their card was read, or they were chosen from the directory. Nothing is
 * fetched here; an id alone shows as an id. See identifiedPatients.ts.
 */
export function BreakGlassIdentity({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const scanned = usePatientStore((s) => s.currentEmergency);
  const fromCard = scanned && scanned.patientId === patientId && scanned.fullName
    ? { name: scanned.fullName, dateOfBirth: scanned.dateOfBirth, gender: scanned.gender } : null;
  const known = fromCard ?? identifiedPatient(patientId);
  if (!known) {
    return <p className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-content-secondary">
      {t('breakGlass.unidentified', { id: patientId })}
    </p>;
  }
  const years = ageInYears(known.dateOfBirth);
  const line = [known.gender, years !== null ? t('workspace.years', { n: String(years) }) : null,
    known.dateOfBirth ? t('workspace.born', { date: formatDateOnly(known.dateOfBirth) }) : null].filter(Boolean).join(' · ');
  return <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-subtle font-bold text-brand-subtle-fg">{initials(known.name)}</span>
    <div className="min-w-0">
      <p className="truncate font-semibold text-content">{known.name}</p>
      {line && <p className="text-sm text-content-secondary">{line}</p>}
    </div>
  </div>;
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
      <div
        className="mt-4 flex gap-2"
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          event.stopPropagation();
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
        <button type="button" onClick={() => { if (trimmedOther) onDeclare(trimmedOther); }} disabled={!trimmedOther} className={`${buttonClass} disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100`}>
          {t('accessReason.continue')}
        </button>
      </div>
      {onCancel && (
        <button type="button" onClick={onCancel} className={`${buttonClass} mt-3`}>
          {t('accessReason.cancel')}
        </button>
      )}
    </section>
  );
}
