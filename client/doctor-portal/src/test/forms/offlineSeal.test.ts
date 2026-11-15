/**
 * What a lost ambulance tablet gives away: queued entries are ciphertext, each
 * account's key opens only its own, and discarding destroys the key.
 *
 * The key store is a minimal in-memory IndexedDB stand-in (only what
 * offlineSeal.ts touches); the encryption is the real Web Crypto AES-GCM.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetSealKey, openBody, sealBody } from '@medichain/shared';

function fakeIndexedDb() {
  const data = new Map<string, unknown>();
  const request = <T,>(produce: () => T) => {
    const r: { result?: T; onsuccess?: () => void } = {};
    r.result = produce();
    return r;
  };
  return {
    open() {
      const req: Record<string, unknown> = {};
      const db = {
        close() {},
        transaction() {
          const tx: Record<string, unknown> = {};
          const store = {
            get: (k: string) => request(() => data.get(k)),
            put: (v: unknown, k: string) => request(() => { data.set(k, v); return k; }),
            delete: (k: string) => request(() => { data.delete(k); return undefined; }),
          };
          tx.objectStore = () => store;
          queueMicrotask(() => (tx.oncomplete as (() => void) | undefined)?.());
          return tx;
        },
        createObjectStore() {},
      };
      req.result = db;
      queueMicrotask(() => (req.onsuccess as (() => void) | undefined)?.());
      return req;
    },
  };
}

describe('offline sealing', () => {
  beforeEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = fakeIndexedDb();
  });

  it('stores ciphertext, and opens it again for the same account', async () => {
    const body = { kind: 'vitals', payload: { systolic_bp: 92, heart_rate: 118 } };
    const sealed = await sealBody(body, 'medic-1');
    expect(JSON.stringify(sealed)).not.toContain('systolic_bp');
    expect(JSON.stringify(sealed)).not.toContain('118');
    expect(await openBody(sealed, 'medic-1')).toEqual(body);
  });

  it("does not open with another account's key", async () => {
    const sealed = await sealBody({ secret: 'x' }, 'medic-1');
    await expect(openBody(sealed, 'medic-2')).rejects.toBeTruthy();
  });

  it('makes everything sealed under an account unreadable once its key is forgotten', async () => {
    const sealed = await sealBody({ secret: 'x' }, 'medic-1');
    await forgetSealKey('medic-1');
    await expect(openBody(sealed, 'medic-1')).rejects.toBeTruthy();
  });

  it('passes through a body queued before sealing existed', async () => {
    expect(await openBody({ plain: true }, 'medic-1')).toEqual({ plain: true });
  });
});
