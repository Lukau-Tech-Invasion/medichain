/**
 * Enhanced Fetch Utilities for MediChain API
 * 
 * Features:
 * - Automatic retry with exponential backoff
 * - Request timeout with AbortController
 * - Configurable retry strategies
 * - Error handling and logging
 */

import { getApiErrorMessage } from '../api/client';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  timeout: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  timeout: 30000
};

export class FetchError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/**
 * Fetch with automatic retry and timeout
 */
export async function fetchWithRetry<T = unknown>(
  url: string,
  options: RequestInit = {},
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error = new Error('Unknown error');
  
  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), retryConfig.timeout);
      
      // Make request
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Handle HTTP errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new FetchError(
          getApiErrorMessage(errorData, `HTTP ${response.status}: ${response.statusText}`),
          response.status,
          errorData?.error?.code ?? errorData?.code,
          errorData
        );
      }
      
      // Parse and return response
      const data = await response.json();
      return data as T;
      
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on certain errors
      if (error instanceof FetchError) {
        // Don't retry client errors (4xx)
        if (error.status && error.status >= 400 && error.status < 500) {
          throw error;
        }
      }
      
      // Check if we should retry
      if (attempt < retryConfig.maxRetries) {
        const shouldRetry = retryConfig.shouldRetry
          ? retryConfig.shouldRetry(lastError, attempt)
          : true;
        
        if (shouldRetry) {
          // Exponential backoff with jitter
          const delay = Math.min(
            retryConfig.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
            retryConfig.maxDelay
          );
          
          console.log(`[Fetch] Retry ${attempt + 1}/${retryConfig.maxRetries} after ${delay}ms`);
          await sleep(delay);
          continue;
        }
      }
      
      throw lastError;
    }
  }
  
  throw lastError;
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoff(attempt: number, baseDelay = 1000, maxDelay = 30000): number {
  return Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return error.message === 'Network request failed' || error.message === 'Failed to fetch';
  }
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  return false;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  // Network errors are retryable
  if (isNetworkError(error)) {
    return true;
  }
  
  // 5xx server errors are retryable
  if (error instanceof FetchError && error.status) {
    return error.status >= 500 && error.status < 600;
  }
  
  // 429 Too Many Requests is retryable
  if (error instanceof FetchError && error.status === 429) {
    return true;
  }
  
  return false;
}
