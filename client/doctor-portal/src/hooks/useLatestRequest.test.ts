import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLatestRequest } from '@medichain/shared';

describe('useLatestRequest', () => {
  it('a read is current until a later one starts', () => {
    const { result } = renderHook(() => useLatestRequest());
    const first = result.current();
    expect(first()).toBe(true);
    const second = result.current();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('nothing is current after unmount', () => {
    const { result, unmount } = renderHook(() => useLatestRequest());
    const read = result.current();
    unmount();
    expect(read()).toBe(false);
  });

  it('hands back the same function on every render, so it is safe in a dependency array', () => {
    const { result, rerender } = renderHook(() => useLatestRequest());
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
  });

  it('two instances do not cancel each other', () => {
    const a = renderHook(() => useLatestRequest());
    const b = renderHook(() => useLatestRequest());
    const readA = a.result.current();
    b.result.current();
    expect(readA()).toBe(true);
  });
});
