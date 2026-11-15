import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOfflineRecordCache } from '../../../shared/src/auth/session';

describe('clearOfflineRecordCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deletes the cached records and keeps the offline shell', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: async () => ['medichain-patient-data-v3', 'medichain-data-v5', 'medichain-patient-static-v4', 'other-app'],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    await clearOfflineRecordCache();
    expect(deleted.sort()).toEqual(['medichain-data-v5', 'medichain-patient-data-v3']);
  });

  it('does nothing where the browser has no Cache Storage', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(clearOfflineRecordCache()).resolves.toBeUndefined();
  });
});
