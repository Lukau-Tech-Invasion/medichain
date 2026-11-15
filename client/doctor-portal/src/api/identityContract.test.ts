/**
 * The request identity contract.
 *
 * MediChain has exactly one way to say who is calling: a verified bearer token.
 * There is no identity header of any kind, so the property these tests hold
 * down is negative as much as positive: a client with no session sends no
 * identity, an ended session never falls back to a weaker one, and a caller
 * cannot smuggle an identity in beside the token.
 *
 * These tests pin the decision itself, not any one caller.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ApiClient } from '@medichain/shared';

const USER_A = '3f9b1c1e-6f0e-4c53-9b7e-0d7f6f5a1a11';

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

  it('never turns a remembered user id into a header', () => {
    // The id is display and routing state; only the token authenticates.
    api.setUserId(USER_A);

    expect(api.getSessionHeaders()).toEqual({});
  });

  it('sends Bearer and nothing else once a session exists', () => {
    api.setUserId(USER_A);
    api.setTokens('access-token', 'refresh-token');

    expect(api.getSessionHeaders()).toEqual({ Authorization: 'Bearer access-token' });
  });

  it('never carries an identity header in mutation headers either', () => {
    api.setUserId(USER_A);
    api.setTokens('access-token');

    const headers = api.getMutationHeaders();

    expect(headers['Authorization']).toBe('Bearer access-token');
    expect(Object.keys(headers).filter((key) => /user-?id/i.test(key))).toEqual([]);
    expect(headers['Idempotency-Key']).toBeTruthy();
  });

  // An ended session yields no identity at all: session revocation has to be
  // enforceable, so nothing may quietly stand in for the token that went away.

  it('yields no identity when a session is revoked', () => {
    api.setUserId(USER_A);
    api.setTokens('access-token', 'refresh-token');

    api.clearTokens();

    expect(api.getSessionHeaders()).toEqual({});
  });

  it('does not come back from the dead by re-asserting the user id', () => {
    api.setUserId(USER_A);
    api.setTokens('access-token', 'refresh-token');
    api.clearTokens();

    api.setUserId(USER_A);

    expect(api.getSessionHeaders()).toEqual({});
  });

  it('restores a normal session on a genuine re-login', () => {
    api.setTokens('access-token', 'refresh-token');
    api.clearTokens();

    api.setTokens('fresh-access-token', 'fresh-refresh-token');

    expect(api.getSessionHeaders()).toEqual({
      Authorization: 'Bearer fresh-access-token',
    });
  });
});
