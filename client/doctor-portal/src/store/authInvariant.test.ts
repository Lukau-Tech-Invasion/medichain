/**
 * The authentication-state invariant.
 *
 * A browser run found the clinician portal in a state that should not exist:
 * `isAuthenticated: true` with no bearer token, every request falling back to
 * the caller-controlled `X-User-Id` header. Three separate paths could produce
 * it -- wallet sign-in, session restore, and demo re-registration -- because each
 * set the authenticated flag first and asked for a token afterwards, and
 * `acquireJwtTokens` swallowed every failure including "no signer was supplied".
 *
 * The invariant these tests hold down:
 *
 *     authenticated === true  =>  a verified session exists
 *
 * They deliberately exercise the store's real behaviour rather than asserting on
 * the source, because the defect was invisible to type checking and to every
 * component test that mocked the API.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiClient } from '@medichain/shared';

const WALLET = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

describe('authentication state invariant', () => {
  let api: ApiClient;

  beforeEach(() => {
    api = new ApiClient({ baseUrl: '' });
    vi.restoreAllMocks();
  });

  it('reports no signer when none is attached', () => {
    // `login` refuses to proceed on this basis. Before the fix it went ahead,
    // called an endpoint that no longer exists, and reported the resulting 404
    // as "Wallet not registered" for accounts that were registered.
    expect(api.getSignatureProvider()).toBeNull();
  });

  it('reports the signer once one is attached', () => {
    const sign = async (message: string) => `signed:${message}`;
    api.setSignatureProvider(sign);
    expect(api.getSignatureProvider()).toBe(sign);
  });

  it('drops the signer when it is cleared', () => {
    api.setSignatureProvider(async () => 'x');
    api.setSignatureProvider(null);
    expect(api.getSignatureProvider()).toBeNull();
  });

  // --- the states that must remain impossible -----------------------------

  it('restores through one shared cookie request for concurrent callers', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = api.restoreSession();
    const second = api.restoreSession();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/auth/jwt/refresh', expect.objectContaining({
      credentials: 'include', method: 'POST',
    }));
    finish(new Response(JSON.stringify({ access_token: 'restored' }), { status: 200 }));
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(api.getAccessToken()).toBe('restored');
  });

  it('refuses malformed refresh responses without falling back to wallet identity', async () => {
    api.setUserId(WALLET);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: {} }), { status: 200 }));
    expect(await api.restoreSession()).toBe(false);
    expect(api.getAccessToken()).toBeUndefined();
    expect(api.getSessionHeaders()).toEqual({});
  });

  it('does not restore a token after logout during cookie refresh', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const restoring = api.restoreSession();
    await api.endSession();
    finish(new Response(JSON.stringify({ access_token: 'late-token' }), { status: 200 }));
    expect(await restoring).toBe(false);
    expect(api.getAccessToken()).toBeUndefined();
    expect(api.getSessionHeaders(WALLET)).toEqual({});
  });

  it('clears local credentials before the logout request completes', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    api.setTokens('access');
    const ending = api.endSession();
    expect(api.getAccessToken()).toBeUndefined();
    api.setTokens('new-login');
    finish(new Response(null, { status: 200 }));
    expect(await ending).toBe(true);
    expect(api.getAccessToken()).toBe('new-login');
  });

  it('does not overwrite a newer login with an older refresh response', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const restoring = api.restoreSession();
    api.setTokens('new-login');
    finish(new Response(JSON.stringify({ access_token: 'old-login' }), { status: 200 }));
    expect(await restoring).toBe(false);
    expect(api.getAccessToken()).toBe('new-login');
  });

  it('emits no identity when a session ends, even with a wallet still set', () => {
    // This is the shape of the defect: a "signed in" client with no token. If
    // headers still carried an identity here, the legacy fallback would make an
    // unauthenticated client look authenticated to the API.
    api.setUserId(WALLET);
    api.setTokens('access', 'refresh');
    api.clearTokens();

    expect(api.getAccessToken()).toBeUndefined();
    expect(api.getSessionHeaders()).toEqual({});
  });

  it('never sends the legacy header alongside a bearer token', () => {
    api.setUserId(WALLET);
    api.setTokens('access', 'refresh');

    const headers = api.getSessionHeaders();
    expect(headers['Authorization']).toBe('Bearer access');
    expect(headers).not.toHaveProperty('X-User-Id');
  });

  it('keeps the legacy header only on the tokenless demo path', () => {
    api.setUserId(WALLET);
    expect(api.getSessionHeaders()).toEqual({ 'X-User-Id': WALLET });
  });

  it('does not let a caller substitute an identity while a session is live', () => {
    api.setUserId(WALLET);
    api.setTokens('access', 'refresh');

    // A page passing its own idea of who is calling must not be able to swap it.
    expect(api.getSessionHeaders('5SomeoneElseEntirely')).toEqual({
      Authorization: 'Bearer access',
    });
  });

  it('has no access token to present after a session ends', () => {
    api.setTokens('access', 'refresh');
    expect(api.getAccessToken()).toBe('access');
    api.clearTokens();
    expect(api.getAccessToken()).toBeUndefined();
  });
});
