import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiClient } from '../api/client';
import {
  getSessionAssurance,
  mfaChallenge,
  requestTransactionChallenge,
  verifyTransactionChallenge,
} from '../api/endpoints';
import type { RequiredFactor, TransactionIntentRequest } from '../api/endpoints';
import { deriveAuthProof } from '../auth/proof';
import { getRememberedLoginId } from '../auth/loginId';

/**
 * Recover from a step-up refusal instead of dead-ending on it.
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
 *
 * # The two assurance classes
 *
 *   * Class B (`run` / `submitCode`): a fresh TOTP code, exchanged at
 *     `/api/auth/mfa/challenge` for a NEW access token carrying the elevated
 *     claim. Installing that token is not optional bookkeeping: without it the
 *     retry is sent on the old token and is refused identically, which looks
 *     like the code having been wrong.
 *   * Class C (`authorize`): a server challenge bound to one exact request,
 *     completed with a TOTP code or, when no authenticator is enrolled, the
 *     account password (the server names which in `required_factor`).
 */

/** What the server answers when a step-up (or an enrollment) is needed. */
export type StepUpDemand = 'step_up' | 'enrollment' | 'transaction' | null;

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
    case 'STEP_UP_REQUIRED':
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
  /** For a `transaction` demand: which factor completes it. */
  requiredFactor: RequiredFactor | null;
  /** True when the dialog must ask for the login id (not remembered after a reload). */
  needsLoginId: boolean;
  /**
   * Run an action, and if the server demands a step-up, hold it until a code
   * is supplied — then run it again. Resolves with the action's value, or
   * `undefined` when a step-up is pending or was dismissed.
   */
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  /** Supply a TOTP code for the held action (Class B) or the open transaction (Class C). */
  submitCode: (code: string) => Promise<void>;
  /** Supply the account password for a Class C challenge that requires it. */
  submitPassword: (password: string, loginId?: string) => Promise<void>;
  /**
   * Begin a Class C authorization for one exact request. Resolves with the
   * challenge id once the person has completed it, or `undefined` if they
   * dismissed the dialog.
   */
  authorize: (intent: TransactionIntentRequest) => Promise<string | undefined>;
  /** Abandon the held action. */
  cancel: () => void;
  /**
   * Whether this session is already elevated.
   *
   * Lets a screen prompt before starting a privileged workflow rather than
   * discovering the requirement from a rejected mutation halfway through --
   * which is what `GET /api/auth/assurance` exists for. Resolves `null` when
   * the session cannot be asked, and `null` is not `false`: "not elevated" and
   * "cannot tell" call for different behaviour.
   */
  checkAssurance: () => Promise<boolean | null>;
}

interface OpenTransaction {
  challengeId: string;
  factor: RequiredFactor;
  settle: (challengeId: string | undefined) => void;
}

export function useStepUp(): StepUpState {
  const attempt = useRef(0);
  // Leaving the screen abandons its held mutation.
  useEffect(() => () => { attempt.current += 1; }, []);
  const [demand, setDemand] = useState<StepUpDemand>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  // The action is held so it can be retried with the elevated token. Kept in
  // state rather than a ref because the dialog's presence depends on it.
  const [pending, setPending] = useState<{ action: () => Promise<unknown> } | null>(null);
  const [transaction, setTransaction] = useState<OpenTransaction | null>(null);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action();
    } catch (err) {
      const needed = stepUpDemandOf(err);
      if (!needed) throw err;
      setDemand(needed);
      attempt.current += 1;
      setError('');
      setPending({ action: action as () => Promise<unknown> });
      return undefined;
    }
  }, []);

  const finishTransaction = useCallback((tx: OpenTransaction) => {
    tx.settle(tx.challengeId);
    setTransaction(null);
    setDemand(null);
  }, []);

  const submitTransactionCode = useCallback(
    async (tx: OpenTransaction, code: string) => {
      if (tx.factor !== 'totp') return;
      setVerifying(true);
      setError('');
      try {
        await verifyTransactionChallenge({ challenge_id: tx.challengeId, code });
        finishTransaction(tx);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That code was not accepted.');
      } finally {
        setVerifying(false);
      }
    },
    [finishTransaction]
  );

  const submitCode = useCallback(
    async (code: string) => {
      if (transaction) {
        await submitTransactionCode(transaction, code);
        return;
      }
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
    [pending, transaction, submitTransactionCode]
  );

  const submitPassword = useCallback(
    async (password: string, loginId?: string) => {
      if (!transaction || transaction.factor !== 'password') return;
      const id = (loginId ?? getRememberedLoginId() ?? '').trim();
      if (!id || !password) return;
      setVerifying(true);
      setError('');
      try {
        const authProof = await deriveAuthProof(password, id);
        await verifyTransactionChallenge({
          challenge_id: transaction.challengeId,
          auth_proof: authProof,
        });
        finishTransaction(transaction);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That password was not accepted.');
      } finally {
        setVerifying(false);
      }
    },
    [transaction, finishTransaction]
  );

  const authorize = useCallback(
    async (intent: TransactionIntentRequest): Promise<string | undefined> => {
      setError('');
      const challenge = await requestTransactionChallenge(intent);
      attempt.current += 1;
      return new Promise<string | undefined>((resolve) => {
        setTransaction({
          challengeId: challenge.challenge_id,
          factor: challenge.required_factor,
          settle: resolve,
        });
        setDemand('transaction');
      });
    },
    []
  );

  const cancel = useCallback(() => {
    attempt.current += 1;
    transaction?.settle(undefined);
    setTransaction(null);
    setPending(null);
    setDemand(null);
    setError('');
    setVerifying(false);
  }, [transaction]);

  const checkAssurance = useCallback(async (): Promise<boolean | null> => {
    try {
      const body = await getSessionAssurance();
      return Boolean(body.class_b);
    } catch {
      return null;
    }
  }, []);

  return {
    demand,
    verifying,
    error,
    requiredFactor: transaction?.factor ?? null,
    needsLoginId: transaction?.factor === 'password' && !getRememberedLoginId(),
    run,
    submitCode,
    submitPassword,
    authorize,
    cancel,
    checkAssurance,
  };
}
