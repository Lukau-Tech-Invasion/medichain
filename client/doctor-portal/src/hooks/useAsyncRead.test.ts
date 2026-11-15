import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsyncRead } from '@medichain/shared';

/** A loader whose replies are released by hand, per key. */
function deferredLoader() {
  const pending = new Map<string, { resolve: (v: string) => void; reject: (e: unknown) => void }[]>();
  const load = vi.fn((key: string) => new Promise<string>((resolve, reject) => {
    pending.set(key, [...(pending.get(key) ?? []), { resolve, reject }]);
  }));
  const settle = (key: string) => {
    const next = pending.get(key)?.shift();
    if (!next) throw new Error(`no pending read for ${key}`);
    return next;
  };
  return { load, settle };
}

describe('useAsyncRead', () => {
  it('is loading, then ready with the value', async () => {
    const { load, settle } = deferredLoader();
    const { result } = renderHook(() => useAsyncRead('p1', load));
    expect(result.current).toMatchObject({ status: 'loading', data: null });

    await act(async () => { settle('p1').resolve('chart of p1'); });
    expect(result.current).toMatchObject({ status: 'ready', data: 'chart of p1', error: null });
  });

  it('does not read while there is no key', () => {
    const load = vi.fn(async () => 'x');
    const { result } = renderHook(({ k }) => useAsyncRead(k, load), { initialProps: { k: '' as string | null } });
    expect(result.current.status).toBe('idle');
    expect(load).not.toHaveBeenCalled();
  });

  it('drops the reply for the previous key when it arrives late', async () => {
    const { load, settle } = deferredLoader();
    const { result, rerender } = renderHook(({ k }) => useAsyncRead(k, load), { initialProps: { k: 'p1' } });
    rerender({ k: 'p2' });
    expect(result.current).toMatchObject({ status: 'loading', data: null });

    await act(async () => { settle('p2').resolve('chart of p2'); });
    await act(async () => { settle('p1').resolve('chart of p1'); }); // the slow one, last
    expect(result.current).toMatchObject({ status: 'ready', data: 'chart of p2' });
  });

  it('never shows the previous key\'s value under a new key', async () => {
    const { load, settle } = deferredLoader();
    const { result, rerender } = renderHook(({ k }) => useAsyncRead(k, load), { initialProps: { k: 'p1' } });
    await act(async () => { settle('p1').resolve('chart of p1'); });
    expect(result.current.data).toBe('chart of p1');

    rerender({ k: 'p2' });
    expect(result.current).toMatchObject({ status: 'loading', data: null });
  });

  it('reports a failure as failed, not as an empty value', async () => {
    const { load, settle } = deferredLoader();
    const { result } = renderHook(() => useAsyncRead('p1', load));
    const boom = new Error('503');
    await act(async () => { settle('p1').reject(boom); });
    expect(result.current).toMatchObject({ status: 'failed', data: null, error: boom });
  });

  it('reload reads again and clears the failure', async () => {
    const { load, settle } = deferredLoader();
    const { result } = renderHook(() => useAsyncRead('p1', load));
    await act(async () => { settle('p1').reject(new Error('503')); });

    let again: Promise<void> = Promise.resolve();
    act(() => { again = result.current.reload(); });
    expect(result.current).toMatchObject({ status: 'loading', data: null, error: null });
    await act(async () => { settle('p1').resolve('chart of p1'); await again; });
    expect(result.current).toMatchObject({ status: 'ready', data: 'chart of p1' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a reload supersedes the read it interrupts', async () => {
    const { load, settle } = deferredLoader();
    const { result } = renderHook(() => useAsyncRead('p1', load));
    act(() => { void result.current.reload(); });
    await act(async () => { settle('p1').resolve('first, stale'); });
    expect(result.current.status).toBe('loading');
    await act(async () => { settle('p1').resolve('second'); });
    expect(result.current.data).toBe('second');
  });

  it('does not re-read when only the loader function changes', async () => {
    const calls = vi.fn();
    const { result, rerender } = renderHook(({ n }) => useAsyncRead('p1', async () => { calls(n); return n; }), {
      initialProps: { n: 1 },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ n: 2 });
    rerender({ n: 3 });
    expect(calls).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.reload(); });
    expect(result.current.data).toBe(3); // reload uses the latest loader
  });

  it('ignores a reply that lands after unmount', async () => {
    const { load, settle } = deferredLoader();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = renderHook(() => useAsyncRead('p1', load));
    unmount();
    await act(async () => { settle('p1').resolve('late'); });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
