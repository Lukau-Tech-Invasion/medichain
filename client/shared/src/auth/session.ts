/**
 * Establishing a session: the one place a password becomes a signed-in client.
 *
 * Both portals sign in the same way -- derive the password proof locally, send
 * it to `POST /api/auth/login`, and install the access token the server issues
 * (the refresh token arrives as an HttpOnly cookie the browser keeps). Doing it
 * once here means the two stores cannot drift apart on the parts that matter:
 * that the password never leaves the browser, that an MFA-enrolled account is
 * asked for its code rather than failed, and that a response without a token is
 * a failed sign-in, never a quiet downgrade.
 */

import { getApiClient, ApiClientError } from '../api/client';
import { login, redeemCredential } from '../api/endpoints';
import type { LoginResponse, SignedInUser } from '../api/endpoints';
import { deriveAuthProof } from './proof';
import { rememberLoginId, forgetLoginId } from './loginId';

/**
 * The shortest password the clients accept when a person chooses one.
 *
 * The server only ever sees a proof derived from the password, so it cannot
 * check length: this is the one place the rule can be enforced.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Format an activation code as the person typed or pasted it: upper case,
 * Crockford look-alikes folded (O to 0, I and L to 1), and grouped as
 * XXXX-XXXX-XXXX. Codes never contain I, L, O or U, so folding cannot change a
 * valid code.
 */
export function normalizeActivationCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .slice(0, 12);
  return cleaned.match(/.{1,4}/g)?.join('-') ?? '';
}

/** Error codes that mean "this account needs its authenticator code". */
const MFA_CODE_REQUIRED_CODES = new Set(['MFA_REQUIRED', 'TOTP_REQUIRED', 'MFA_CODE_REQUIRED']);

export type SignInOutcome =
  | { status: 'signed_in'; user: SignedInUser }
  | { status: 'mfa_required' };

function needsCode(error: unknown): boolean {
  return error instanceof ApiClientError && MFA_CODE_REQUIRED_CODES.has(error.code);
}

/** Install the tokens and remember who signed in, or refuse a response with no session. */
function adopt(response: LoginResponse, loginId: string): SignInOutcome {
  if (response.mfa_required && !response.access_token) {
    return { status: 'mfa_required' };
  }
  if (!response.access_token || !response.user) {
    throw new Error('The server did not start a session. Please try again.');
  }
  const client = getApiClient();
  client.setTokens(response.access_token);
  client.setUserId(response.user.user_id);
  rememberLoginId(loginId);
  return { status: 'signed_in', user: response.user };
}

/**
 * Sign in with a login id and password.
 *
 * Resolves `mfa_required` when the account has an authenticator and no
 * `totpCode` was given; call again with the code. Any other failure throws the
 * server's error (`INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, ...).
 */
export async function signInWithPassword(
  loginId: string,
  password: string,
  totpCode?: string
): Promise<SignInOutcome> {
  const identifier = loginId.trim();
  const authProof = await deriveAuthProof(password, identifier);
  try {
    const response = await login({
      identifier,
      auth_proof: authProof,
      ...(totpCode ? { totp_code: totpCode } : {}),
    });
    return adopt(response, identifier);
  } catch (error) {
    if (!totpCode && needsCode(error)) return { status: 'mfa_required' };
    throw error;
  }
}

/**
 * Redeem a one-time activation or reset code, choosing the password (and, for a
 * patient, the username). The account signs in with `username` when there is
 * one, else with `identifier`, and the proof is derived for that login id.
 */
export async function activateWithCode(input: {
  identifier: string;
  code: string;
  password: string;
  username?: string;
}): Promise<SignInOutcome> {
  const identifier = input.identifier.trim();
  const username = input.username?.trim() || undefined;
  const loginId = username ?? identifier;
  const authProof = await deriveAuthProof(input.password, loginId);
  const response = await redeemCredential({
    identifier,
    code: normalizeActivationCode(input.code),
    auth_proof: authProof,
    ...(username ? { username } : {}),
  });
  return adopt(response, loginId);
}

/** Forget in-memory sign-in state. The stores call this on sign-out. */
export function clearSessionMemory(): void {
  forgetLoginId();
  getApiClient().setUserId(undefined);
}
