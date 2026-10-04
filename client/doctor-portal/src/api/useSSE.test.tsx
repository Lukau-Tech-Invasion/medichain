import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSSE } from '../../../shared/src/hooks/useSSE';
vi.mock('../../../shared/src/api/client', () => ({ getApiClient: () => ({ getUserId: () => 'demo-user', getBaseUrl: () => '', getSessionHeaders: () => ({ Authorization: 'Bearer demo' }) }) }));
vi.mock('../../../shared/src/config', () => ({ debugLog: vi.fn() }));
describe('live streams and background tabs', () => {
 let focused = true;
 const requests: AbortSignal[] = [];
 beforeEach(() => {
  vi.useFakeTimers(); focused = true; requests.length = 0;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('fetch', vi.fn((_url, options) => {
   requests.push(options.signal);
   return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  }));
 });
 afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
 it('releases the connection on blur and reconnects on focus', async () => {
  renderHook(() => useSSE()); expect(requests).toHaveLength(1);
  await act(async () => { focused = false; window.dispatchEvent(new Event('blur')); });
  expect(requests[0].aborted).toBe(true);
  await act(async () => { vi.advanceTimersByTime(6000); });
  expect(requests).toHaveLength(1);
  await act(async () => { focused = true; window.dispatchEvent(new Event('focus')); });
  expect(requests).toHaveLength(2);
  expect(requests[1].aborted).toBe(false);
 });
 it('does not open a stream when mounted in a background tab', async () => {
  focused = false; renderHook(() => useSSE());
  await act(async () => { vi.advanceTimersByTime(6000); });
  expect(requests).toHaveLength(0);
 });
 it('honours rate-limit backoff instead of retrying every watcher tick', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', {
   status: 429, headers: { 'Retry-After': '30' },
  }))));
  const fetchMock = vi.mocked(fetch);
  renderHook(() => useSSE());
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
 });
 it('does not retry a rejected session every second', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 401 }))));
  const fetchMock = vi.mocked(fetch);
  renderHook(() => useSSE());
  await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(10000); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
 });
});
