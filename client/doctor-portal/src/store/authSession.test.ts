import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  signInWithPassword,
  activateWithCode,
  normalizeActivationCode,
  purgeLegacyIdentityStorage,
  getApiClient,
  getRememberedLoginId,
} from '@medichain/shared';

/**
 * The shared sign-in path: one place where a password becomes a session.
 *
 * `fetch` is the boundary. Everything the server would see is asserted from the
 * request that went out, which is what makes "the password never travels"
 * checkable rather than a claim.
 */
const USER = { user_id: 'u-1', name: 'Dr. Mbeki', role: 'Doctor', linked_patient_id: null };

function respond(status: number, body: unknown) {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as unknown as Response);
}

function lastRequest(): { url: string; body: Record<string, unknown> } {
  const calls = vi.mocked(global.fetch).mock.calls;
  const [url, init] = calls[calls.length - 1];
  return { url: String(url), body: JSON.parse(String((init as RequestInit).body)) };
}

describe('sign-in session', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    getApiClient().clearTokens();
  });

  it('sends the proof, never the password, and installs the access token', async () => {
    respond(200, { success: true, access_token: 'tok', mfa: false, mfa_required: false, user: USER });

    const outcome = await signInWithPassword('  EMP-001 ', 'my secret passphrase');

    expect(outcome).toEqual({ status: 'signed_in', user: USER });
    const { url, body } = lastRequest();
    expect(url).toMatch(/\/api\/auth\/login$/);
    expect(body.identifier).toBe('EMP-001');
    expect(body.auth_proof).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(body)).not.toContain('my secret passphrase');
    expect(getApiClient().getAccessToken()).toBe('tok');
    expect(getRememberedLoginId()).toBe('EMP-001');
  }, 30_000);

  it('reports mfa_required, without a session, when the server wants the code', async () => {
    respond(200, { success: false, mfa: true, mfa_required: true });

    expect(await signInWithPassword('EMP-001', 'pw pw pw pw pw')).toEqual({ status: 'mfa_required' });
    expect(getApiClient().getAccessToken()).toBeUndefined();
  }, 30_000);

  it('treats an MFA_REQUIRED refusal as a request for the code, not a failure', async () => {
    respond(401, { error: { code: 'MFA_REQUIRED', message: 'Code needed' } });

    expect(await signInWithPassword('EMP-001', 'pw pw pw pw pw')).toEqual({ status: 'mfa_required' });
  }, 30_000);

  it('sends the code on the second attempt', async () => {
    respond(200, { success: true, access_token: 'tok2', mfa: true, mfa_required: false, user: USER });

    await signInWithPassword('EMP-001', 'pw pw pw pw pw', '123456');

    expect(lastRequest().body.totp_code).toBe('123456');
  }, 30_000);

  it('throws the server error for a wrong password and installs nothing', async () => {
    respond(401, { error: { code: 'INVALID_CREDENTIALS', message: 'no' } });

    await expect(signInWithPassword('EMP-001', 'wrong wrong wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(getApiClient().getAccessToken()).toBeUndefined();
  }, 30_000);

  it('refuses a success response that carries no token', async () => {
    respond(200, { success: true, mfa: false, mfa_required: false, user: USER });

    await expect(signInWithPassword('EMP-001', 'pw pw pw pw pw')).rejects.toThrow(/did not start a session/i);
    expect(getApiClient().getAccessToken()).toBeUndefined();
  }, 30_000);

  it('derives the activation proof for the chosen username, not the patient id', async () => {
    respond(200, { success: true, access_token: 'tok3', mfa: false, mfa_required: false, user: USER });
    const { deriveAuthProof } = await import('@medichain/shared');

    await activateWithCode({
      identifier: 'PAT-42',
      code: 'abcd-efgh-jkmn',
      password: 'a long enough password',
      username: 'Thandi.N',
    });

    const { url, body } = lastRequest();
    expect(url).toMatch(/\/api\/auth\/credentials\/redeem$/);
    expect(body.identifier).toBe('PAT-42');
    expect(body.username).toBe('Thandi.N');
    expect(body.code).toBe('ABCD-EFGH-JKMN');
    expect(body.auth_proof).toBe(await deriveAuthProof('a long enough password', 'Thandi.N'));
    expect(getRememberedLoginId()).toBe('Thandi.N');
  }, 30_000);
});

describe('normalizeActivationCode', () => {
  it('groups, upper-cases and folds Crockford look-alikes', () => {
    expect(normalizeActivationCode('abcd efgh jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(normalizeActivationCode('o1il-abcd-efgh')).toBe('0111-ABCD-EFGH');
  });

  it('never grows past twelve characters', () => {
    expect(normalizeActivationCode('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN');
  });
});

/** The shared test setup stubs `localStorage` with inert spies; this one stores. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

describe('purgeLegacyIdentityStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('removes retired keys, chain_ keys, and a session that names an address', () => {
    localStorage.setItem('medichain_wallet', '{"address":"x"}'); // retired-term-negative-assertion
    localStorage.setItem('chain_anything', '1');
    localStorage.setItem('medichain_provider_auth', JSON.stringify({ address: 'x', role: 'Doctor', name: 'n' }));
    localStorage.setItem('medichain_patient_auth', JSON.stringify({ userId: 'u', healthId: 'h', name: 'n' }));
    localStorage.setItem('unrelated', 'keep');

    purgeLegacyIdentityStorage();

    expect(localStorage.getItem('medichain_wallet')).toBeNull(); // retired-term-negative-assertion
    expect(localStorage.getItem('chain_anything')).toBeNull();
    expect(localStorage.getItem('medichain_provider_auth')).toBeNull();
    // A current-shape session and unrelated keys are left alone.
    expect(localStorage.getItem('medichain_patient_auth')).not.toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });
});
