import { describe, it, expect, vi } from 'vitest';
import { followSessionAcrossTabs, signedInIdentity } from '@medichain/shared';

/**
 * A tab follows the account another tab signed in to, and ignores writes that
 * keep the same person signed in.
 */
const persisted = (userId: string | null, isAuthenticated = userId !== null) =>
  JSON.stringify({ state: { user: userId ? { userId, role: 'Doctor' } : null, isAuthenticated }, version: 4 });

function fakeWindow() {
  const listeners: Array<(event: StorageEvent) => void> = [];
  const reload = vi.fn();
  const target = {
    addEventListener: (_type: string, listener: (event: StorageEvent) => void) => listeners.push(listener),
    location: { reload },
  } as unknown as Window;
  const fire = (key: string | null, oldValue: string | null, newValue: string | null) =>
    listeners.forEach((listener) => listener({ key, oldValue, newValue } as StorageEvent));
  return { target, reload, fire };
}

describe('followSessionAcrossTabs', () => {
  it('reads who a persisted session belongs to', () => {
    expect(signedInIdentity(persisted('u-admin'))).toBe('u-admin');
    expect(signedInIdentity(persisted(null))).toBeNull();
    expect(signedInIdentity(persisted('u-x', false))).toBeNull();
    expect(signedInIdentity('not json')).toBeNull();
    expect(
      signedInIdentity(JSON.stringify({ state: { patient: { userId: 'u-p' }, isAuthenticated: true } }))
    ).toBe('u-p');
  });

  it('reloads when another tab signs in as someone else, or signs out', () => {
    const { target, reload, fire } = fakeWindow();
    followSessionAcrossTabs('medichain-provider-auth', target);
    fire('medichain-provider-auth', persisted('u-admin'), persisted('u-doctor'));
    expect(reload).toHaveBeenCalledTimes(1);
    fire('medichain-provider-auth', persisted('u-doctor'), persisted(null));
    expect(reload).toHaveBeenCalledTimes(2);
    fire(null, null, null);
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it('ignores the same person staying signed in, and other keys', () => {
    const { target, reload, fire } = fakeWindow();
    followSessionAcrossTabs('medichain-provider-auth', target);
    fire('medichain-provider-auth', persisted('u-doctor'), persisted('u-doctor'));
    fire('medichain-theme-preference', 'light', 'dark');
    expect(reload).not.toHaveBeenCalled();
  });
});
