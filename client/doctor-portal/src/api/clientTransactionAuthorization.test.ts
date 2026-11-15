/**
 * A Class C demand is answered once, for exactly the request that met it.
 *
 * The server's 428 names what to confirm; the client asks the registered
 * authorizer for a verified authorization bound to the SHA-256 of the bytes it
 * sends and to the same idempotency key, then resends under that key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError } from '@medichain/shared';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const demand = () => json({
  error: {
    code: 'TRANSACTION_AUTHORIZATION_REQUIRED',
    message: 'Confirm this action to continue.',
    details: {
      action: 'access_request.approve',
      method: 'POST',
      path: '/api/access/requests/REQ-1/approve',
      resource_id: 'REQ-1',
      expected_state: 'pending',
    },
  },
}, 428);

function header(call: unknown[], name: string): string | undefined {
  return ((call[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined)?.[name];
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('ApiClient Class C confirmation', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('confirms the exact request and resends it under the same key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(demand())
      .mockResolvedValueOnce(json({ request: { status: 'approved' } }, 200));
    global.fetch = fetchMock;
    const authorizer = vi.fn().mockResolvedValue('AUTH-1');
    const client = new ApiClient({ baseUrl: 'http://localhost', maxRetries: 0 });
    client.setTransactionAuthorizer(authorizer);

    const body = { expires_at: '2026-11-01T00:00:00Z' };
    await expect(client.post('/api/access/requests/REQ-1/approve', body)).resolves.toEqual({ request: { status: 'approved' } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const key = header(fetchMock.mock.calls[0], 'Idempotency-Key');
    expect(key).toBeTruthy();
    expect(authorizer).toHaveBeenCalledWith({
      action: 'access_request.approve',
      method: 'POST',
      path: '/api/access/requests/REQ-1/approve',
      body_digest: await sha256(JSON.stringify(body)),
      resource_id: 'REQ-1',
      expected_state: 'pending',
      idempotency_key: key,
    });
    expect(header(fetchMock.mock.calls[1], 'X-Transaction-Authorization')).toBe('AUTH-1');
    expect(header(fetchMock.mock.calls[1], 'Idempotency-Key')).toBe(key);
    expect((fetchMock.mock.calls[1][1] as RequestInit).body).toBe(JSON.stringify(body));
  });

  it('surfaces the refusal when the person cancels', async () => {
    const fetchMock = vi.fn().mockResolvedValue(demand());
    global.fetch = fetchMock;
    const client = new ApiClient({ baseUrl: 'http://localhost', maxRetries: 0 });
    client.setTransactionAuthorizer(vi.fn().mockResolvedValue(undefined));

    const error = await client.post('/api/access/grants/G-1/revoke', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).status).toBe(428);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks only once: a second demand after confirming is not answered again', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(demand()).mockResolvedValueOnce(demand());
    global.fetch = fetchMock;
    const authorizer = vi.fn().mockResolvedValue('AUTH-1');
    const client = new ApiClient({ baseUrl: 'http://localhost', maxRetries: 0 });
    client.setTransactionAuthorizer(authorizer);

    const error = await client.post('/api/access/requests/REQ-1/approve', {}).catch((e: unknown) => e);
    expect((error as ApiClientError).status).toBe(428);
    expect(authorizer).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
