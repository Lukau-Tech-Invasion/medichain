/**
 * The request identity contract.
 *
 * MediChain has two ways to say who is calling: a verified JWT session, and the
 * legacy `X-User-Id` wallet header that only demo mode accepts unsigned. The
 * rule is that exactly one module decides between them -- `ApiClient` --
 * because the defects this suite exists to prevent all came from a second
 * copy of that decision drifting away from the first (`exportDocumentToPdf`
 * sent both a Bearer token and the wallet header; `useSSE` sent only the
 * header even when a session existed).
 *
 * These tests pin the decision itself, not any one caller.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ApiClient } from '@medichain/shared';

const WALLET_A = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const WALLET_B = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

function client(): ApiClient {
  return new ApiClient({ baseUrl: 'http://localhost' });
}

describe('request identity contract', () => {
  let api: ApiClient;

  beforeEach(() => {
    api = client();
  });

  it('sends no identity at all before sign-in', () => {
    expect(api.getSessionHeaders()).toEqual({});
  });

  it('sends the legacy header only on the tokenless demo path', () => {
    api.setUserId(WALLET_A);

    expect(api.getSessionHeaders()).toEqual({ 'X-User-Id': WALLET_A });
  });

  it('sends Bearer and never accompanies it with the wallet header', () => {
    api.setUserId(WALLET_A);
    api.setTokens('access-token', 'refresh-token');

    const headers = api.getSessionHeaders();

    expect(headers['Authorization']).toBe('Bearer access-token');
    expect(headers).not.toHaveProperty('X-User-Id');
  });

  it('does not let a caller-supplied wallet override an active session', () => {
    api.setUserId(WALLET_A);
    api.setTokens('access-token', 'refresh-token');

    // A page passing its own idea of the identity must not be able to swap it.
    const headers = api.getSessionHeaders(WALLET_B);

    expect(headers['Authorization']).toBe('Bearer access-token');
    expect(headers).not.toHaveProperty('X-User-Id');
  });

  // --- the downgrade this suite exists for --------------------------------
  //
  // Before the session-end latch, `clearTokens()` left `userId` set, so the
  // very next call fell back to `X-User-Id`. In production the server accepts
  // a signed wallet header with no session at all, which meant a *revoked*
  // session kept working for any client still holding a signer. Session
  // revocation has to be enforceable, so an ended session yields no identity.

  it('does not downgrade to the legacy header when a session is revoked', () => {
    api.setUserId(WALLET_A);
    api.setTokens('access-token', 'refresh-token');

    api.clearTokens();

    expect(api.getSessionHeaders()).toEqual({});
  });

  it('does not downgrade even when a caller offers a wallet explicitly', () => {
    api.setUserId(WALLET_A);
    api.setTokens('access-token', 'refresh-token');

    api.clearTokens();

    expect(api.getSessionHeaders(WALLET_A)).toEqual({});
  });

  it('keeps refusing the legacy header after logout', () => {
    api.setUserId(WALLET_A);
    api.setTokens('access-token', 'refresh-token');
    api.clearTokens();

    // Re-asserting the wallet address is not a way back in.
    api.setUserId(WALLET_A);

    expect(api.getSessionHeaders()).toEqual({});
  });

  it('restores a normal session on a genuine re-login', () => {
    api.setUserId(WALLET_A);
    api.setTokens('access-token', 'refresh-token');
    api.clearTokens();

    api.setTokens('fresh-access-token', 'fresh-refresh-token');

    expect(api.getSessionHeaders()).toEqual({
      Authorization: 'Bearer fresh-access-token',
    });
  });

  it('leaves a client that never had a session on the demo path', () => {
    // `clearTokens()` on a client that never signed in must not latch: demo
    // mode legitimately has no token and still needs the legacy header.
    api.setUserId(WALLET_A);
    api.clearTokens();

    expect(api.getSessionHeaders()).toEqual({ 'X-User-Id': WALLET_A });
  });
});
