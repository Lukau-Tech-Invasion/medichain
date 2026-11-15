/**
 * When the typed client retries, and under which idempotency key.
 *
 * The server keeps a mutation's idempotency claim after any 5xx (the write may
 * have partly committed) and refuses a second attempt under the same key as
 * IDEMPOTENCY_DUPLICATE. The client used to retry every 5xx, so a definite
 * refusal -- "telehealth is not enabled" -- reached the clinician as "This
 * operation was already submitted", although nothing had been saved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError } from '@medichain/shared';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const api = () => new ApiClient({ baseUrl: 'http://localhost', maxRetries: 2 });

function keyOf(call: unknown[]): string | undefined {
  const headers = (call[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined;
  return headers?.['Idempotency-Key'];
}

/** Run a request to completion, letting the client's backoff timers elapse. */
async function settle<T>(promise: Promise<T>): Promise<T | unknown> {
  const outcome = promise.catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  return outcome;
}

describe('ApiClient retries', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    global.fetch = realFetch;
  });

  it("does not retry a mutation the server answered with a 5xx, and reports the server's reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({ error: { code: 'TELEHEALTH_UNAVAILABLE', message: 'The telehealth session could not be created' } }, 503),
    );
    global.fetch = fetchMock;

    const error = await settle(api().post('/api/telehealth/sessions', { patient_id: 'PAT-1' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).status).toBe(503);
    expect((error as ApiClientError).message).toBe('The telehealth session could not be created');
  });

  it('still retries a read that failed with a 5xx', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: 'Temporarily unavailable' }, 503))
      .mockResolvedValueOnce(json({ ok: true }, 200));
    global.fetch = fetchMock;

    await expect(settle(api().get('/api/x'))).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a mutation whose response was lost, under the same idempotency key', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({ id: 'R-1' }, 201));
    global.fetch = fetchMock;

    await expect(settle(api().post('/api/records', { a: 1 }))).resolves.toEqual({ id: 'R-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(keyOf(fetchMock.mock.calls[0])).toBeTruthy();
    expect(keyOf(fetchMock.mock.calls[1])).toBe(keyOf(fetchMock.mock.calls[0]));
  });

  it('reports a duplicate after a lost response, because then the first attempt did arrive', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({
        error: { code: 'IDEMPOTENCY_DUPLICATE', message: 'This operation was already submitted; read the resource before retrying' },
      }, 409));
    global.fetch = fetchMock;

    const error = await settle(api().post('/api/records', { a: 1 }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((error as ApiClientError).code).toBe('IDEMPOTENCY_DUPLICATE');
  });
});
