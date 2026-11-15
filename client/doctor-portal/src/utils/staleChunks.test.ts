import { describe, expect, it, vi } from 'vitest';
import { reloadOnStaleChunks } from '@medichain/shared';

function fakeWindow() {
  const target = new EventTarget() as EventTarget & { sessionStorage: Storage; location: { reload: () => void } };
  const store = new Map<string, string>();
  target.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as unknown as Storage;
  target.location = { reload: vi.fn() };
  return target;
}

describe('reloadOnStaleChunks', () => {
  it('reloads once when a chunk from an older build cannot load, and not again in a loop', () => {
    const target = fakeWindow();
    reloadOnStaleChunks(target as unknown as Window);
    const first = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(first);
    expect(target.location.reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    // The new build failing too must surface, not flicker.
    const second = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(second);
    expect(target.location.reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });
});
