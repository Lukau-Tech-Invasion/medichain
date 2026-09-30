/**
 * The authentication-state invariant.
 *
 * A browser run once found the clinician portal in a state that should not
 * exist: `isAuthenticated: true` with no bearer token, every request falling
 * back to a caller-controlled identity header. The invariant these tests hold
 * down:
 *
 *     authenticated === true  =>  a verified session exists
 *
 * They deliberately exercise the client's real behaviour rather than asserting
 * on the source, because the defect was invisible to type checking and to every
 * component test that mocked the API.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiClient } from '@medichain/shared';

const USER_ID = '3f9b1c1e-6f0e-4c53-9b7e-0d7f6f5a1a11';

describe('authentication state invariant', () => {
  let api: ApiClient;

  beforeEach(() => {
    api = new ApiClient({ baseUrl: '' });
    vi.restoreAllMocks();
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

  it('refuses malformed refresh responses without falling back to any other identity', async () => {
    api.setUserId(USER_ID);
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
    expect(api.getSessionHeaders()).toEqual({});
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

  it('emits no identity when a session ends, even with a user id still set', () => {
    // This is the shape of the defect: a "signed in" client with no token. If
    // headers still carried an identity here, an unauthenticated client would
    // look authenticated to the API.
    api.setUserId(USER_ID);
    api.setTokens('access', 'refresh');
    api.clearTokens();

    expect(api.getAccessToken()).toBeUndefined();
    expect(api.getSessionHeaders()).toEqual({});
  });

  it('sends only the bearer token while a session is live', () => {
    api.setUserId(USER_ID);
    api.setTokens('access', 'refresh');

    expect(api.getSessionHeaders()).toEqual({ Authorization: 'Bearer access' });
  });

  it('has no access token to present after a session ends', () => {
    api.setTokens('access', 'refresh');
    expect(api.getAccessToken()).toBe('access');
    api.clearTokens();
    expect(api.getAccessToken()).toBeUndefined();
  });
});
