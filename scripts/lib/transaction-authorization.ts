/**
 * ADR-0008 Class C confirmation, for the harnesses that call the API directly.
 *
 * A gated mutation -- deciding access, changing consent or someone's role or
 * account status, revoking another person's emergency grant, deciding or
 * executing retention -- answers `428 TRANSACTION_AUTHORIZATION_REQUIRED` and
 * names what to confirm. The portals answer through a dialog; a harness answers
 * as the same signed-in person would: request a challenge bound to the SHA-256
 * of the exact bytes and the request's idempotency key, verify it with the
 * account's password proof (or a current authenticator code), then resend the
 * request under the same key with the authorization.
 *
 * One implementation for the journeys, the cross-role harness and the fixture
 * seeder, so they cannot confirm differently from each other.
 */
import { deriveAuthProof } from './auth';

export type Json = Record<string, any>;

/** How the account confirms: its password, or a current authenticator code. */
export interface Confirmer {
  loginId: string;
  password?: string;
  totp?: () => Promise<string>;
}

/** Sends one JSON request; the harness supplies its own transport. */
export type Post = (path: string, token: string, body: Json) => Promise<{ status: number; json: Json }>;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Whether this answer is a Class C demand. */
export function isTransactionDemand(status: number, json: Json): boolean {
  return status === 428 && json?.error?.code === 'TRANSACTION_AUTHORIZATION_REQUIRED';
}

/**
 * A verified authorization id for exactly this request, or `undefined` when the
 * account cannot be confirmed (no password or code available, or the server
 * refused the challenge); the caller then reports the server's 428.
 *
 * `paths` are relative to the harness's API base: the journeys and seeder use
 * `/auth/...` under an `/api` base.
 */
export async function confirmTransaction(
  post: Post,
  token: string,
  confirmer: Confirmer,
  demand: Json,
  bodyText: string,
  idempotencyKey: string
): Promise<string | undefined> {
  const details = (demand?.error?.details ?? {}) as Json;
  const challenge = await post('/auth/transaction/challenge', token, {
    action: details.action,
    method: details.method,
    path: details.path,
    body_digest: await sha256Hex(bodyText),
    resource_id: details.resource_id,
    expected_state: details.expected_state,
    idempotency_key: idempotencyKey,
  });
  const issued = (challenge.json?.challenge ?? challenge.json) as Json;
  if (challenge.status !== 200 || !issued?.challenge_id) return undefined;
  let answer: Json | undefined;
  if (issued.required_factor === 'totp') {
    answer = confirmer.totp ? { code: await confirmer.totp() } : undefined;
  } else if (confirmer.password) {
    answer = { auth_proof: await deriveAuthProof(confirmer.password, confirmer.loginId) };
  }
  if (!answer) return undefined;
  const verified = await post('/auth/transaction/verify', token, { challenge_id: issued.challenge_id, ...answer });
  return verified.status === 200 ? (verified.json?.authorization_id as string | undefined) : undefined;
}
