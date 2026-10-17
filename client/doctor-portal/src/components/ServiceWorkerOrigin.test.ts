import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('service worker provider boundary', () => {
  it.each([
    ['doctor', resolve(process.cwd(), 'public/sw.js'), 'doctor'],
    ['patient', resolve(process.cwd(), '../patient-app/public/sw.js'), 'patient'],
  ])('%s bypasses external video and still serves local API requests', async (_name, source, prefix) => {
    type FetchEvent = {
      request: { url: string; method: string; mode: string };
      respondWith: (result: Promise<unknown>) => void;
    };
    const handlers = new Map<string, (event: FetchEvent) => void>();
    const response = { ok: true, status: 200, clone: () => response };
    const network = vi.fn().mockResolvedValue(response);
    runInNewContext(readFileSync(source, 'utf8'), {
      URL, Response, console,
      self: {
        registration: { scope: `http://127.0.0.1/${prefix}/` },
        addEventListener: (name: string, handler: (event: FetchEvent) => void) => handlers.set(name, handler),
      },
      fetch: network,
      caches: { open: vi.fn().mockResolvedValue({ put: vi.fn() }) },
    });
    const respondWith = vi.fn();
    handlers.get('fetch')!({
      request: { url: 'https://localhost:8443/external_api.js', method: 'GET', mode: 'no-cors' },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    const local = { url: 'http://127.0.0.1/api/health', method: 'GET', mode: 'cors' };
    handlers.get('fetch')!({ request: local, respondWith });
    expect(network).toHaveBeenCalledWith(local);
    await expect(respondWith.mock.calls[0][0]).resolves.toMatchObject({ status: 200 });
  });
});
