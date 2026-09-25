import { useCallback, useState } from 'react';
import { getApiClient } from '../api/client';
import { getSessionAssurance, mfaChallenge } from '../api/endpoints';

/**
 * Recover from a `403 MFA_REQUIRED` instead of dead-ending on it.
 *
 * # Why this exists
 *
 * Five privileged operations — assign a role, revoke a role, verify a guardian,
 * amend a guardian's permissions, revoke a guardian — run through
 * `require_privileged_assurance`. Outside demo mode that refuses any caller
 * whose session is not freshly MFA-stepped-up, answering:
 *
 *     MFA step-up required for this operation. Call /api/auth/mfa/challenge.
 *
 * Every one of those pages rendered that sentence as an error and stopped. An
 * administrator cannot "call /api/auth/mfa/challenge"; the endpoint existed,
 * the client function existed, and nothing connected the refusal to the remedy.
 * So in production — the only mode where the gate is live — role management and
 * guardianship were unusable, and the demo mode that exempts the check is
 * exactly why nobody hit it.
 *
 * The step-up returns a NEW access token carrying the elevated claim. Installing
 * it is not optional bookkeeping: without it the retry is sent on the old token
 * and is refused identically, which looks like the code having been wrong.
 */

/** What the server answers when a step-up (or an enrollment) is needed. */
export type StepUpDemand = 'step_up' | 'enrollment' | null;

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const body = error as { code?: unknown; data?: { error?: { code?: unknown } } };
  if (typeof body.code === 'string') return body.code;
  const nested = body.data?.error?.code;
  return typeof nested === 'string' ? nested : null;
}

/**
 * Whether this failure is a missing step-up rather than a real refusal.
 *
 * Matched on the server's `code`, never on the message text: the message is
 * user-facing prose and will be reworded, and a step-up that stops being
 * offered because somebody improved a sentence is a silent regression.
 */
export function stepUpDemandOf(error: unknown): StepUpDemand {
  switch (errorCode(error)) {
    case 'MFA_REQUIRED':
      return 'step_up';
    case 'MFA_ENROLLMENT_REQUIRED':
      return 'enrollment';
    default:
      return null;
  }
}

export interface StepUpState {
  /** Set while the server is waiting for a code. `null` means nothing pending. */
  demand: StepUpDemand;
  /** True while a submitted code is being verified. */
  verifying: boolean;
  /** A failed step-up attempt, for the dialog to show. */
  error: string;
  /**
   * Run an action, and if the server demands a step-up, hold it until a code
   * is supplied — then run it again. Resolves with the action's value, or
   * `undefined` when a step-up is pending or was dismissed.
   */
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  /** Supply a TOTP code for the held action. */
  submitCode: (code: string) => Promise<void>;
  /** Abandon the held action. */
  cancel: () => void;
  /**
   * Whether this session is already elevated.
   *
   * Lets a screen prompt before starting a privileged workflow rather than
   * discovering the requirement from a rejected mutation halfway through --
   * which is what `GET /api/auth/assurance` exists for. Resolves `null` when
   * the session cannot be asked (a header-only caller proves nothing, and the
   * endpoint correctly answers 401), and `null` is not `false`: "not elevated"
   * and "cannot tell" call for different behaviour.
   */
  checkAssurance: () => Promise<boolean | null>;
}

export function useStepUp(): StepUpState {
  const [demand, setDemand] = useState<StepUpDemand>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  // The action is held so it can be retried with the elevated token. Kept in
  // state rather than a ref because the dialog's presence depends on it.
  const [pending, setPending] = useState<{ action: () => Promise<unknown> } | null>(null);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action();
    } catch (err) {
      const needed = stepUpDemandOf(err);
      if (!needed) throw err;
      setDemand(needed);
      setError('');
      setPending({ action: action as () => Promise<unknown> });
      return undefined;
    }
  }, []);

  const submitCode = useCallback(
    async (code: string) => {
      if (!pending) return;
      setVerifying(true);
      setError('');
      try {
        const elevated = await mfaChallenge(code);
        // Install the elevated token before retrying. The old one still fails
        // the same check, and the retry would look like a wrong code.
        if (elevated?.access_token) {
          getApiClient().setTokens(elevated.access_token);
        }
        await pending.action();
        setPending(null);
        setDemand(null);
      } catch (err) {
        // A second refusal is a wrong or expired code, not a new demand: the
        // action stays held so the person can try again.
        setError(err instanceof Error ? err.message : 'That code was not accepted.');
      } finally {
        setVerifying(false);
      }
    },
    [pending]
  );

  const cancel = useCallback(() => {
    setPending(null);
    setDemand(null);
    setError('');
  }, []);

  const checkAssurance = useCallback(async (): Promise<boolean | null> => {
    try {
      const body = await getSessionAssurance();
      return Boolean(body.class_b);
    } catch {
      return null;
    }
  }, []);

  return { demand, verifying, error, run, submitCode, cancel, checkAssurance };
}
