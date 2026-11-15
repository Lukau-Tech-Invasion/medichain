import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../shared/src/api/client';

describe('Hash-addressed document purpose', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it.each([['PAT-1', 'Treatment'], ['PAT-2', undefined]])(
    'only sends the open-chart reason for its own patient (%s)', async (patientId, expected) => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }), blob: async () => new Blob(['report']) });
      vi.stubGlobal('fetch', fetchMock);
      const client = new ApiClient({ baseUrl: 'http://localhost', maxRetries: 0 });
      client.setPatientAccessContext({ patientId: 'PAT-1', reason: 'Treatment' });
      await client.getBlob('/api/records/lab-test/download', { patientId });
      const headers = new Headers(fetchMock.mock.calls[0][1].headers);
      expect(headers.get('X-Access-Reason')).toBe(expected ?? null);
    },
  );
});
