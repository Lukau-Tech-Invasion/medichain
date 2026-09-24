/**
 * How the typed client hands a response back.
 *
 * Two behaviours pages depend on and had no test: a list envelope is unwrapped
 * to its array unless the caller asks for the body whole, and a file comes
 * back as bytes with the type the server declared. The patient records page
 * relies on both -- its imaging read carries `orders` AND `reports`, and the
 * default unwrapping would silently drop every report.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError } from '@medichain/shared';

function respond(body: BodyInit, status: number, contentType: string) {
  return vi.fn().mockResolvedValue(
    new Response(body, { status, headers: { 'content-type': contentType } }),
  );
}

const api = () => new ApiClient({ baseUrl: 'http://localhost', maxRetries: 0 });

describe('ApiClient responses', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('unwraps a list envelope by default', async () => {
    global.fetch = respond(JSON.stringify({ orders: [{ id: 1 }], reports: [{ id: 2 }] }), 200, 'application/json');
    await expect(api().get('/x')).resolves.toEqual([{ id: 1 }]);
  });

  it('returns the body whole when asked to keep the envelope', async () => {
    const body = { orders: [{ id: 1 }], reports: [{ id: 2 }] };
    global.fetch = respond(JSON.stringify(body), 200, 'application/json');
    await expect(api().get('/x', { keepEnvelope: true })).resolves.toEqual(body);
  });

  it('returns a download as bytes with its declared type', async () => {
    global.fetch = respond('%PDF-1.7', 200, 'application/pdf');
    const { blob, contentType } = await api().getBlob('/file');
    expect(contentType).toBe('application/pdf');
    expect(blob.size).toBe('%PDF-1.7'.length);
  });

  it("throws the server's reason when a download is refused", async () => {
    global.fetch = respond(JSON.stringify({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }), 404, 'application/json');
    const refused = await api().getBlob('/file').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiClientError);
    expect((refused as ApiClientError).status).toBe(404);
    expect((refused as ApiClientError).message).toBe('Record not found');
  });
});
