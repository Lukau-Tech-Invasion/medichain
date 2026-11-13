/**
 * One submission of one form: its status, and the idempotency key it travels
 * under.
 *
 * # Why this exists
 *
 * 61 pages tracked saving with their own booleans, 34 did not lock Save while a
 * request was in flight, and every request got a fresh idempotency key -- so a
 * double tap, or Save pressed again after a timeout that had in fact succeeded,
 * wrote the record twice. The server already deduplicates a repeated key
 * durably (`api/src/middleware/idempotency.rs`); it needs the client to send the
 * same key for the same submission.
 *
 * The key is `<formId>-<generation>-<content hash>`:
 *  - the same content re-sent (double tap, retry after a timeout) reuses it, and
 *    the server answers `IDEMPOTENCY_DUPLICATE` instead of writing again;
 *  - edited content gets a new key (the server would refuse a reused key with a
 *    different body as `IDEMPOTENCY_KEY_REUSED`);
 *  - a successful save starts a new generation, so entering the same values
 *    again later -- two identical blood pressures an hour apart -- is a new
 *    record, not a duplicate.
 *
 * One `status` replaces the separate `saving`/`saved`/`error` flags pages kept:
 * those could contradict each other (library: `frontend-component-architecture.md`
 * §4, "avoid contradictions").
 */
import { useCallback, useRef, useState } from 'react';
import { ApiClientError, OfflineQueuedError, getApiClient } from '../api/client';

export type SubmissionStatus = 'idle' | 'saving' | 'saved' | 'duplicate' | 'queued' | 'failed';

export type SubmissionResult<R> =
  | { kind: 'saved'; value: R }
  /** The server already had this exact submission; nothing was written again. */
  | { kind: 'duplicate' }
  /** No signal: kept on this device, sealed, and sent when it reconnects. */
  | { kind: 'queued'; queueItemId: string }
  | { kind: 'failed'; error: unknown }
  /** A submission was already in flight; this one was not sent. */
  | { kind: 'busy' };

/** FNV-1a over the JSON of `value`: a stable short fingerprint, not a security hash. */
export function contentFingerprint(value: unknown): string {
  const text = JSON.stringify(value ?? null) ?? 'null';
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function newGeneration(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

/** The idempotency base for `content` submitted by `formId` in `generation`. */
export function submissionKey(formId: string, generation: string, content: unknown): string {
  const safeId = formId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'form';
  return `${safeId}-${generation}-${contentFingerprint(content)}`;
}

/** True for the server's "this operation was already submitted" answer. */
export function isDuplicateSubmission(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'IDEMPOTENCY_DUPLICATE';
}

export interface Submission {
  status: SubmissionStatus;
  /** The failure from the last attempt, when `status` is `failed`. */
  error: unknown;
  /**
   * Send `content` through `send`. Every mutation `send` issues carries a key
   * derived from `content`, so repeating the same submission cannot write twice.
   */
  run: <R>(content: unknown, send: () => Promise<R>) => Promise<SubmissionResult<R>>;
  /** Back to `idle` (e.g. when the user edits after a failure). */
  reset: () => void;
}

export function useSubmission(formId: string): Submission {
  const [status, setStatus] = useState<SubmissionStatus>('idle');
  const [error, setError] = useState<unknown>(undefined);
  const generation = useRef(newGeneration());
  const inFlight = useRef(false);

  const run = useCallback(async <R,>(content: unknown, send: () => Promise<R>): Promise<SubmissionResult<R>> => {
    if (inFlight.current) return { kind: 'busy' };
    inFlight.current = true;
    setStatus('saving');
    setError(undefined);
    const base = submissionKey(formId, generation.current, content);
    try {
      const value = await getApiClient().withOperationScope(base, send);
      generation.current = newGeneration();
      setStatus('saved');
      return { kind: 'saved', value };
    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        generation.current = newGeneration();
        setStatus('queued');
        return { kind: 'queued', queueItemId: err.queueItemId };
      }
      if (isDuplicateSubmission(err)) {
        generation.current = newGeneration();
        setStatus('duplicate');
        return { kind: 'duplicate' };
      }
      setError(err);
      setStatus('failed');
      return { kind: 'failed', error: err };
    } finally {
      inFlight.current = false;
    }
  }, [formId]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(undefined);
  }, []);

  return { status, error, run, reset };
}

/**
 * Send one submission through `submission` and return how it ended, throwing
 * the original error on failure so a page's existing `catch` still reports it.
 * This is the one-line migration for a page that already has its own
 * try/catch: `await addVitalSigns(p)` becomes
 * `await submitOnce(submission, p, () => addVitalSigns(p))`.
 */
export async function submitOnce<R>(
  submission: Submission,
  content: unknown,
  send: () => Promise<R>,
): Promise<'saved' | 'duplicate' | 'queued' | 'busy'> {
  const result = await submission.run(content, send);
  if (result.kind === 'failed') throw result.error;
  return result.kind;
}

/** How a submission whose reply the page uses ended, short of failing. */
export type SubmissionOutcome<R> = Exclude<SubmissionResult<R>, { kind: 'failed' }>;

/**
 * `submitOnce` for a page that needs the server's reply (an id, a score).
 * Only `saved` carries the reply: a `duplicate` was written by an earlier
 * attempt whose answer never arrived, and a `queued` one has not been sent, so
 * the page must say so rather than show a value it does not have.
 */
export async function submitForReply<R>(
  submission: Submission,
  content: unknown,
  send: () => Promise<R>,
): Promise<SubmissionOutcome<R>> {
  const result = await submission.run(content, send);
  if (result.kind === 'failed') throw result.error;
  return result;
}
