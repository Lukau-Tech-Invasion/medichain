/**
 * MediChain React Hooks for API Data Fetching
 * 
 * SWR-style hooks with built-in caching, error handling, and retry logic
 * Designed for healthcare applications with appropriate refresh strategies
 * 
 * @module hooks
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getCache, CACHE_TTL, buildCacheKey } from './cache';

export interface UseApiDataOptions<T> {
  /** Time-to-live for cache in milliseconds */
  ttl?: number;
  /** Enable automatic background refresh */
  refreshOnFocus?: boolean;
  /** Polling interval in milliseconds (0 = disabled) */
  pollingInterval?: number;
  /** Smart polling with exponential backoff */
  smartPolling?: boolean;
  /** Initial data before fetch completes */
  initialData?: T;
  /** Skip fetching (for conditional queries) */
  enabled?: boolean;
  /** Number of retry attempts on failure */
  retryCount?: number;
  /** Callback on successful fetch */
  onSuccess?: (data: T) => void;
  /** Callback on fetch error */
  onError?: (error: Error) => void;
}

export interface UseApiDataResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isValidating: boolean;
  error: Error | null;
  mutate: (newData?: T | ((prev: T | undefined) => T)) => void;
  refresh: () => Promise<void>;
}

/**
 * Hook for fetching and caching API data with SWR-style revalidation
 * 
 * @example
 * // Basic usage
 * const { data, isLoading, error } = useApiData(
 *   'patients',
 *   () => api.getPatients()
 * );
 * 
 * @example
 * // With options
 * const { data, refresh } = useApiData(
 *   `patient:${patientId}`,
 *   () => api.getPatient(patientId),
 *   { 
 *     ttl: CACHE_TTL.PATIENT_INFO,
 *     refreshOnFocus: true 
 *   }
 * );
 */
export function useApiData<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: UseApiDataOptions<T> = {}
): UseApiDataResult<T> {
  const {
    ttl = CACHE_TTL.DEFAULT,
    refreshOnFocus = false,
    pollingInterval = 0,
    smartPolling = false,
    initialData,
    enabled = true,
    retryCount = 3,
    onSuccess,
    onError,
  } = options;

  const cache = getCache();
  const [data, setData] = useState<T | undefined>(() => {
    // Try to get from cache on initial render
    const cached = cache.get<T>(key);
    return cached ?? initialData;
  });
  const [isLoading, setIsLoading] = useState(!data);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Smart polling state
  const currentIntervalRef = useRef(pollingInterval);
  const previousDataRef = useRef<string>('');

  // Fetch function with retry logic
  const fetchData = useCallback(async (isBackground = false) => {
    if (!enabled) return;

    if (!isBackground) {
      setIsLoading(true);
    }
    setIsValidating(true);
    setError(null);

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const result = await cache.getOrFetch(
          key,
          async () => {
            const fetchedData = await fetcher();
            return fetchedData;
          },
          ttl
        );

        setData(result);
        setIsLoading(false);
        setIsValidating(false);
        onSuccess?.(result);

        // Smart polling: check if data changed
        if (smartPolling) {
          const resultString = JSON.stringify(result);
          if (resultString !== previousDataRef.current) {
            previousDataRef.current = resultString;
            currentIntervalRef.current = pollingInterval; // Reset to fast polling
          } else {
            // Slow down polling (max 60s)
            currentIntervalRef.current = Math.min(
              currentIntervalRef.current * 1.5,
              60000
            );
          }
        }

        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        
        // Don't retry on 4xx errors (client errors)
        if ('status' in (err as Record<string, unknown>)) {
          const status = (err as { status: number }).status;
          if (status >= 400 && status < 500) {
            break;
          }
        }

        // Wait before retry with exponential backoff
        if (attempt < retryCount) {
          await new Promise(resolve => 
            setTimeout(resolve, Math.pow(2, attempt) * 1000)
          );
        }
      }
    }

    // All retries failed
    setError(lastError);
    setIsLoading(false);
    setIsValidating(false);
    onError?.(lastError!);
  }, [key, fetcher, enabled, retryCount, ttl, smartPolling, pollingInterval, cache, onSuccess, onError]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Polling
  useEffect(() => {
    if (!pollingInterval || !enabled) return;

    const intervalId = setInterval(
      () => fetchData(true),
      smartPolling ? currentIntervalRef.current : pollingInterval
    );

    return () => clearInterval(intervalId);
  }, [pollingInterval, enabled, fetchData, smartPolling]);

  // Refresh on window focus
  useEffect(() => {
    if (!refreshOnFocus || !enabled) return;

    const handleFocus = () => {
      fetchData(true);
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshOnFocus, enabled, fetchData]);

  // Optimistic update / manual mutation
  const mutate = useCallback((newData?: T | ((prev: T | undefined) => T)) => {
    if (newData === undefined) {
      // Revalidate from server
      cache.invalidate(key);
      fetchData();
    } else if (typeof newData === 'function') {
      const updater = newData as (prev: T | undefined) => T;
      const updated = updater(data);
      setData(updated);
      cache.set(key, updated, ttl);
    } else {
      setData(newData);
      cache.set(key, newData, ttl);
    }
  }, [key, data, ttl, cache, fetchData]);

  // Manual refresh
  const refresh = useCallback(async () => {
    cache.invalidate(key);
    await fetchData();
  }, [key, cache, fetchData]);

  return {
    data,
    isLoading,
    isValidating,
    error,
    mutate,
    refresh,
  };
}

/**
 * Hook for paginated API data with infinite scroll support
 * 
 * @example
 * const { items, loadMore, hasMore, isLoading } = usePaginatedApi(
 *   'patients',
 *   (page, limit) => api.getPatients({ page, limit }),
 *   { pageSize: 20 }
 * );
 */
export interface UsePaginatedApiOptions {
  pageSize?: number;
  enabled?: boolean;
}

export interface UsePaginatedApiResult<T> {
  items: T[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  totalCount?: number;
}

export function usePaginatedApi<T>(
  key: string,
  fetcher: (page: number, limit: number) => Promise<{ items: T[]; total?: number; hasMore?: boolean }>,
  options: UsePaginatedApiOptions = {}
): UsePaginatedApiResult<T> {
  const { pageSize = 20, enabled = true } = options;

  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | undefined>();

  const cache = getCache();

  // Initial load
  useEffect(() => {
    if (!enabled) return;

    const loadInitial = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const cacheKey = buildCacheKey(`${key}:page:1`, { limit: pageSize });
        const result = await cache.getOrFetch(
          cacheKey,
          () => fetcher(1, pageSize),
          CACHE_TTL.DEFAULT
        );

        setItems(result.items);
        setHasMore(result.hasMore ?? result.items.length >= pageSize);
        setTotalCount(result.total);
        setPage(1);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsLoading(false);
      }
    };

    loadInitial();
  }, [key, pageSize, enabled, fetcher, cache]);

  // Load more (infinite scroll)
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    const nextPage = page + 1;

    try {
      const cacheKey = buildCacheKey(`${key}:page:${nextPage}`, { limit: pageSize });
      const result = await cache.getOrFetch(
        cacheKey,
        () => fetcher(nextPage, pageSize),
        CACHE_TTL.DEFAULT
      );

      setItems(prev => [...prev, ...result.items]);
      setHasMore(result.hasMore ?? result.items.length >= pageSize);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoadingMore(false);
    }
  }, [key, page, pageSize, isLoadingMore, hasMore, fetcher, cache]);

  // Refresh from beginning
  const refresh = useCallback(async () => {
    // Invalidate all pages
    cache.invalidatePattern(key);
    setPage(1);
    setItems([]);
    setHasMore(true);

    setIsLoading(true);
    try {
      const result = await fetcher(1, pageSize);
      setItems(result.items);
      setHasMore(result.hasMore ?? result.items.length >= pageSize);
      setTotalCount(result.total);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [key, pageSize, fetcher, cache]);

  return {
    items,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
    totalCount,
  };
}

/**
 * Hook for API mutations (POST, PUT, DELETE) with optimistic updates
 * 
 * @example
 * const { mutate, isLoading, error } = useApiMutation(
 *   (data) => api.updatePatient(patientId, data),
 *   {
 *     onSuccess: () => {
 *       toast.success('Patient updated');
 *       cache.invalidatePattern(`patient:${patientId}`);
 *     }
 *   }
 * );
 */
export interface UseApiMutationOptions<TData, TResult> {
  onSuccess?: (result: TResult, variables: TData) => void;
  onError?: (error: Error, variables: TData) => void;
  onSettled?: (result: TResult | undefined, error: Error | null, variables: TData) => void;
}

export interface UseApiMutationResult<TData, TResult> {
  mutate: (data: TData) => Promise<TResult>;
  mutateAsync: (data: TData) => Promise<TResult>;
  isLoading: boolean;
  error: Error | null;
  reset: () => void;
}

export function useApiMutation<TData, TResult>(
  mutationFn: (data: TData) => Promise<TResult>,
  options: UseApiMutationOptions<TData, TResult> = {}
): UseApiMutationResult<TData, TResult> {
  const { onSuccess, onError, onSettled } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(async (data: TData): Promise<TResult> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await mutationFn(data);
      onSuccess?.(result, data);
      onSettled?.(result, null, data);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error, data);
      onSettled?.(undefined, error, data);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [mutationFn, onSuccess, onError, onSettled]);

  const mutate = useCallback((data: TData): Promise<TResult> => {
    return mutateAsync(data).catch(() => {
      // Error already handled in mutateAsync
      return undefined as unknown as TResult;
    });
  }, [mutateAsync]);

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  return {
    mutate,
    mutateAsync,
    isLoading,
    error,
    reset,
  };
}

export { CACHE_TTL } from './cache';
