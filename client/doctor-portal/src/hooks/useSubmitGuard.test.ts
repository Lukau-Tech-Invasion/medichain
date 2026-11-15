import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSubmitGuard } from './useSubmitGuard';

describe('useSubmitGuard', () => {
  it('runs one save at a time and reports it as pending', async () => {
    let finish: () => void = () => undefined;
    const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useSubmitGuard());
    const handler = result.current.guard(save);

    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = handler();
      void handler(); // the double press, before any re-render
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(true);

    await act(async () => { finish(); await first; });
    expect(result.current.pending).toBe(false);

    await act(async () => { void handler(); });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('still prevents the default of a blocked form submission', async () => {
    const save = vi.fn(() => new Promise<void>(() => undefined));
    const { result } = renderHook(() => useSubmitGuard());
    const handler = result.current.guard((event: { preventDefault: () => void }) => {
      event.preventDefault();
      return save();
    });
    const firstEvent = { preventDefault: vi.fn() };
    const secondEvent = { preventDefault: vi.fn() };
    await act(async () => {
      void handler(firstEvent);
      void handler(secondEvent);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(secondEvent.preventDefault).toHaveBeenCalled();
  });
});
