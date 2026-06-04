import { useCallback, useEffect, useRef, useState } from 'react';
import { cacheData, getCachedData } from '../utils/indexedDB';
import { getApiClient } from '../api/client';
import { debugLog } from '../config';

export interface UseOfflineCacheResult<T> {
  /** The data (fresh from the network, or the last cached copy when offline). */
  data: T | null;
  loading: boolean;
  /** True when `data` came from the offline cache rather than a live fetch. */
  fromCache: boolean;
  error: string | null;
  /** Re-run the fetch (and refresh the cache) on demand. */
  refresh: () => Promise<void>;
}

/**
 * useOfflineCache — a fetch-through cache for critical patient data.
 *
 * Online: runs `fetcher()`, returns the result, and writes it to IndexedDB so it
 * is available offline. Offline (or when a fetch fails): serves the last cached
 * copy if present and not expired, flagging `fromCache` so the UI can show an
 * "offline / cached" badge. This is what makes records viewable with no network —
 * the OfflineQueue already covers the write path.
 *
 * `fetcher` is read through a ref, so callers may pass an inline closure without
 * causing a refetch loop; the effect only re-runs when `cacheId` changes.
 */
export function useOfflineCache<T>(
  cacheId: string,
  category: string,
  fetcher: () => Promise<T>,
  ttlMs: number = 7 * 24 * 60 * 60 * 1000, // critical data: keep 7 days
): UseOfflineCacheResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const serveCached = async (reason: string): Promise<boolean> => {
      const cached = await getCachedData<T>(cacheId);
      if (cached != null) {
        setData(cached);
        setFromCache(true);
        debugLog('useOfflineCache', `Serving "${cacheId}" from cache (${reason})`);
        return true;
      }
      return false;
    };

    const online = getApiClient().getConnectionStatus();
    if (!online) {
      if (!(await serveCached('offline'))) {
        setError('You are offline and no cached copy is available yet.');
      }
      setLoading(false);
      return;
    }

    try {
      const fresh = await fetcherRef.current();
      setData(fresh);
      setFromCache(false);
      // Best-effort cache write — never let a cache failure break the read.
      try {
        await cacheData(cacheId, category, cacheId, fresh, ttlMs, 'high');
      } catch (e) {
        debugLog('useOfflineCache', `Failed to cache "${cacheId}":`, e);
      }
    } catch (e) {
      // Network failed despite reporting online — fall back to the cache.
      if (!(await serveCached('fetch failed'))) {
        setError(e instanceof Error ? e.message : 'Failed to load data.');
      }
    }
    setLoading(false);
  }, [cacheId, category, ttlMs]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, fromCache, error, refresh: load };
}
