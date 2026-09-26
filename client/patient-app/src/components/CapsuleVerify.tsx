import { useState } from 'react';
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useTranslation, verifyPatientRecord } from '@medichain/shared';
import type { CapsuleVerification } from '@medichain/shared';

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; status: CapsuleVerification };

/**
 * "Verify" for the emergency card (WP8): compares the stored card with the
 * commitment in the blockchain's latest finalized state, and says plainly
 * when it matches, when it does not, and when it is not anchored yet.
 *
 * @param props.patientId - The patient record id.
 */
export function CapsuleVerify({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'idle' });

  const run = async () => {
    setState({ kind: 'loading' });
    try {
      const body = await verifyPatientRecord(patientId);
      setState({ kind: 'ready', status: body.emergency_capsule });
    } catch (error) {
      console.error('Emergency card verification failed', error);
      setState({ kind: 'failed' });
    }
  };

  if (state.kind === 'idle') {
    return (
      <button
        type="button"
        onClick={() => void run()}
        className="px-3 py-2 rounded-lg border border-border text-sm font-medium text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {t('verification.verify')}
      </button>
    );
  }
  if (state.kind === 'loading') {
    return (
      <p role="status" className="flex items-center gap-1 text-sm text-content-muted">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        {t('verification.verifying')}
      </p>
    );
  }
  if (state.kind === 'failed') {
    return <p role="alert" className="text-sm text-critical-subtle-fg">{t('verification.failed')}</p>;
  }
  return <CapsuleResult status={state.status} />;
}

/** The capsule verification answer, with a warning for a mismatch. */
function CapsuleResult({ status }: { status: CapsuleVerification }) {
  const { t } = useTranslation();
  if (status === 'mismatch') {
    return (
      <p role="alert" className="flex items-center gap-1 text-sm font-semibold text-critical-subtle-fg">
        <ShieldAlert className="w-4 h-4" aria-hidden="true" />
        {t('verification.capsuleMismatch')}
      </p>
    );
  }
  if (status === 'match') {
    return (
      <p className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
        <ShieldCheck className="w-4 h-4" aria-hidden="true" />
        {t('verification.capsuleMatch')}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-sm text-content-muted">
      <ShieldQuestion className="w-4 h-4" aria-hidden="true" />
      {status === 'unanchored' ? t('verification.capsuleUnanchored') : t('verification.capsuleNone')}
    </p>
  );
}
