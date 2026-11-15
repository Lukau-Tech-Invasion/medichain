import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useOfflineCache, ApiClientError } from '@medichain/shared';

const cacheMocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), owner: 'qa-owner', online: true }));
vi.mock('@medichain/shared/src/utils/indexedDB', () => ({
  getCachedData: cacheMocks.read,
  cacheData: cacheMocks.write,
}));
vi.mock('@medichain/shared/src/api/client', async () => ({
  ...await vi.importActual<typeof import('@medichain/shared/src/api/client')>('@medichain/shared/src/api/client'),
  getApiClient: () => ({ getUserId: () => cacheMocks.owner, getConnectionStatus: () => cacheMocks.online }),
}));

beforeEach(() => {
  cacheMocks.owner = 'qa-owner';
  cacheMocks.online = true;
  cacheMocks.read.mockReset();
  cacheMocks.write.mockReset();
  vi.stubGlobal('indexedDB', {});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('offline cache account and authorization boundaries', () => {
  it('reads only the signed-in account namespace while offline', async () => {
    cacheMocks.online = false;
    cacheMocks.read.mockResolvedValue({ synthetic: true });
    const { result } = renderHook(() => useOfflineCache('card-PAT-QA', 'medical-records', vi.fn()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(cacheMocks.read).toHaveBeenCalledWith('qa-owner:card-PAT-QA');
    expect(result.current.fromCache).toBe(true);
  });

  it('records account ownership when caching a successful read', async () => {
    const data = { synthetic: true };
    const { result } = renderHook(() => useOfflineCache('card-PAT-QA', 'medical-records', async () => data));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(cacheMocks.write).toHaveBeenCalledWith('qa-owner:card-PAT-QA', 'medical-records', 'card-PAT-QA', data, expect.any(Number), 'high', 'qa-owner');
  });

  it('does not serve cached data after a server denies access', async () => {
    cacheMocks.read.mockResolvedValue({ private: true });
    const fetcher = async () => { throw new ApiClientError('Denied', 'FORBIDDEN', 403); };
    const { result } = renderHook(() => useOfflineCache('card-PAT-QA', 'medical-records', fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(cacheMocks.read).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.fromCache).toBe(false);
    expect(result.current.error).toBeTruthy();
  });
});
