/**
 * MediChain Shared API Module
 * 
 * Centralized API layer with caching, batching, and typed endpoints
 * 
 * @module api
 */

// Core API Client
export { 
  ApiClient, 
  ApiClientError, 
  initApiClient, 
  getApiClient 
} from './client';

// Typed API Endpoints (140+ functions)
export * from './endpoints';

// Caching Layer
export { 
  getCache, 
  resetCache, 
  buildCacheKey, 
  withCache,
  CACHE_TTL,
  type ApiCache
} from './cache';

// React Hooks for Data Fetching
export {
  useApiData,
  usePaginatedApi,
  useCursorPaginatedApi,
  useApiMutation,
  type UseApiDataOptions,
  type UseApiDataResult,
  type UsePaginatedApiOptions,
  type UsePaginatedApiResult,
  type UseCursorPaginatedApiOptions,
  type UseCursorPaginatedApiResult,
  type UseApiMutationOptions,
  type UseApiMutationResult,
} from './hooks';

// Batch Operations — REMOVED 2026-07-31.
// `batch.ts` had zero consumers in either app and targeted server endpoints
// that do not exist (/api/batch, /api/{analytics,audit-logs,...}/batch). Worse,
// its `auditLogBatcher`/`analyticsBatcher` singletons were constructed at module
// scope and each started a 5s `setInterval`, so merely importing from this
// package made both PWAs POST to 404 endpoints forever. If batching is wanted
// later, build the server endpoints first, then reintroduce it.
