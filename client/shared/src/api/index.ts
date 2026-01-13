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
  useApiMutation,
  type UseApiDataOptions,
  type UseApiDataResult,
  type UsePaginatedApiOptions,
  type UsePaginatedApiResult,
  type UseApiMutationOptions,
  type UseApiMutationResult,
} from './hooks';

// Batch Operations
export {
  batchExecute,
  batchGetPatients,
  batchGetLabResults,
  createRequestBatcher,
  batchers,
  auditLogBatcher,
  analyticsBatcher,
  WriteBatcher,
  type BatchRequest,
  type BatchResult,
} from './batch';
