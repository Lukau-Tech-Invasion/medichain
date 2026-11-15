/**
 * The form engine's promise: one submission is one write, however many times it
 * is sent.
 *
 * The server deduplicates by idempotency key (api/src/middleware/idempotency.rs)
 * and answers a repeat with 409 IDEMPOTENCY_DUPLICATE. These tests pin the
 * client half: the same content re-sent travels under the same keys, edited
 * content does not, and a duplicate answer is reported as "already saved" rather
 * than as a failure.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiClient,
  contentFingerprint,
  getApiClient,
  submissionKey,
  submitForReply,
  useSubmission,
} from '@medichain/shared';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function keyOf(call: unknown[]): string | undefined {
  const headers = (call[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined;
  return headers?.['Idempotency-Key'];
}

describe('submission keys', () => {
  it('fingerprints equal content equally and different content differently', () => {
    expect(contentFingerprint({ bp: '120/80' })).toBe(contentFingerprint({ bp: '120/80' }));
    expect(contentFingerprint({ bp: '120/80' })).not.toBe(contentFingerprint({ bp: '121/80' }));
  });

  it('builds a key from form, generation and content, without characters a header cannot carry', () => {
    const key = submissionKey('vitals form/1', 'abc12345', { a: 1 });
    expect(key).toMatch(/^vitalsform1-abc12345-[0-9a-f]{8}$/);
  });
});

describe('ApiClient.withOperationScope', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('gives each mutation in a scope a key derived from the base, stable per path', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ ok: true }, 200)));
    global.fetch = fetchMock;
    const api = new ApiClient({ baseUrl: 'http://localhost', maxRetries: 0 });

    await api.withOperationScope('base1', async () => {
      await api.post('/api/vitals', { a: 1 });
      await api.post('/api/notes', { b: 2 });
      await api.post('/api/vitals', { a: 3 });
    });
    const keys = fetchMock.mock.calls.map(keyOf);
    expect(keys).toEqual([
      'base1:0:POST /api/vitals',
      'base1:0:POST /api/notes',
      'base1:1:POST /api/vitals',
    ]);

    // Outside a scope, keys are fresh again.
    await api.post('/api/vitals', { a: 1 });
    expect(keyOf(fetchMock.mock.calls[3])).not.toMatch(/^base1:/);
  });

  it('never produces a key longer than the server column allows', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ ok: true }, 200)));
    global.fetch = fetchMock;
    const api = new ApiClient({ baseUrl: 'http://localhost', maxRetries: 0 });
    await api.withOperationScope('b', () => api.post(`/api/${'x'.repeat(400)}`, {}));
    expect(keyOf(fetchMock.mock.calls[0])!.length).toBeLessThanOrEqual(240);
  });
});

describe('useSubmission', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('re-sends the same content under the same key, and a successful save starts a new generation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: 'NETWORK', message: 'gateway timeout' } }, 400))
      .mockResolvedValue(json({ id: 'V-1' }, 201));
    global.fetch = fetchMock;
    const { result } = renderHook(() => useSubmission('vitals'));
    const send = () => getApiClient().post('/api/vitals', { bp: '120/80' });

    await act(async () => {
      await result.current.run({ bp: '120/80' }, send);
    });
    expect(result.current.status).toBe('failed');
    await act(async () => {
      await result.current.run({ bp: '120/80' }, send);
    });
    expect(result.current.status).toBe('saved');
    // The retry of the same content reused the failed attempt's key.
    expect(keyOf(fetchMock.mock.calls[1])).toBe(keyOf(fetchMock.mock.calls[0]));

    // The same values entered again after a successful save are a new record.
    await act(async () => {
      await result.current.run({ bp: '120/80' }, send);
    });
    expect(keyOf(fetchMock.mock.calls[2])).not.toBe(keyOf(fetchMock.mock.calls[1]));
  });

  it('reports a duplicate answer as already saved, not as a failure', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      json({ error: { code: 'IDEMPOTENCY_DUPLICATE', message: 'This operation was already submitted' } }, 409),
    );
    const { result } = renderHook(() => useSubmission('vitals'));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.run({ x: 1 }, () => getApiClient().post('/api/vitals', { x: 1 }));
    });
    expect(outcome).toEqual({ kind: 'duplicate' });
    expect(result.current.status).toBe('duplicate');
  });

  it('gives a page the reply only for a fresh save, and throws a real failure', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(json({ order_id: 'O-1' }, 201))
      .mockResolvedValueOnce(json({ error: { code: 'IDEMPOTENCY_DUPLICATE', message: 'already' } }, 409))
      .mockResolvedValueOnce(json({ error: { code: 'VALIDATION', message: 'bad' } }, 400));
    const { result } = renderHook(() => useSubmission('order'));
    const send = () => getApiClient().post<{ order_id: string }>('/api/orders', { x: 1 });

    let first: unknown;
    let second: unknown;
    await act(async () => { first = await submitForReply(result.current, { x: 1 }, send); });
    expect(first).toEqual({ kind: 'saved', value: { order_id: 'O-1' } });
    await act(async () => { second = await submitForReply(result.current, { x: 1 }, send); });
    // No value: the earlier attempt wrote it and its id never came back.
    expect(second).toEqual({ kind: 'duplicate' });
    await act(async () => {
      await expect(submitForReply(result.current, { x: 2 }, send)).rejects.toBeTruthy();
    });
  });

  it('refuses a second submission while the first is in flight', async () => {
    let release: (value: Response) => void = () => {};
    global.fetch = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useSubmission('vitals'));
    const send = () => getApiClient().post('/api/vitals', { x: 1 });

    let first: Promise<unknown> = Promise.resolve();
    let second: unknown;
    await act(async () => {
      first = result.current.run({ x: 1 }, send);
      second = await result.current.run({ x: 1 }, send);
    });
    expect(second).toEqual({ kind: 'busy' });
    await act(async () => {
      release(json({ id: 'V-1' }, 201));
      await first;
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
