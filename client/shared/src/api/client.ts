/**
 * MediChain API Client
 * 
 * Typed HTTP client for interacting with the MediChain REST API.
 * Features:
 * - Wallet-based authentication via X-User-Id header
 * - Automatic retry with exponential backoff
 * - Request timeout handling
 * - Connection health monitoring
 * - Proper error recovery
 * 
 * © 2025 Trustware. All rights reserved.
 */

import type { ApiError } from '../types';
import { 
  API_CONFIG, 
  debugLog, 
  sleep, 
  calculateBackoff,
  isValidWalletAddress,
  getConnectedWalletAddress 
} from '../config';
import { OfflineQueue } from '../utils/offlineQueue';

export interface ApiClientConfig {
  baseUrl: string;
  userId?: string;
  timeout?: number;
  maxRetries?: number;
  onError?: (error: ApiError) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export interface RequestOptions {
  /** Skip retry logic for this request */
  noRetry?: boolean;
  /** Custom timeout for this request */
  timeout?: number;
  /** Additional headers */
  headers?: Record<string, string>;
}

export class ApiClient {
  private baseUrl: string;
  private userId?: string;
  private timeout: number;
  private maxRetries: number;
  private onError?: (error: ApiError) => void;
  private onConnectionChange?: (connected: boolean) => void;
  private connectionListeners: ((connected: boolean) => void)[] = [];
  private isConnected: boolean = true;
  private lastHealthCheck: number = 0;
  private signatureProvider: ((message: string) => Promise<string>) | null = null;
  private offlineQueue: OfflineQueue;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.userId = config.userId;
    this.timeout = config.timeout ?? API_CONFIG.TIMEOUT;
    this.maxRetries = config.maxRetries ?? API_CONFIG.MAX_RETRIES;
    this.onError = config.onError;
    this.onConnectionChange = config.onConnectionChange;
    this.offlineQueue = new OfflineQueue();
  }

  /**
   * Set the user ID (wallet address) for authenticated requests
   */
  setUserId(userId: string | undefined): void {
    if (userId && !isValidWalletAddress(userId)) {
      debugLog('ApiClient', `Warning: Invalid wallet address format: ${userId?.substring(0, 10)}...`);
    }
    this.userId = userId;
    debugLog('ApiClient', `User ID ${userId ? 'set' : 'cleared'}`);
  }

  /**
   * Set a provider function that can sign messages
   */
  setSignatureProvider(provider: ((message: string) => Promise<string>) | null): void {
    this.signatureProvider = provider;
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | undefined {
    return this.userId;
  }

  /**
   * Check if API is currently connected
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Update connection status and notify listeners
   */
  private setConnectionStatus(connected: boolean): void {
    if (this.isConnected !== connected) {
      this.isConnected = connected;
      this.onConnectionChange?.(connected);
      this.connectionListeners.forEach(listener => listener(connected));
      debugLog('ApiClient', `Connection status: ${connected ? 'connected' : 'disconnected'}`);
      
      // If we just reconnected, process the offline queue
      if (connected) {
        this.offlineQueue.processQueue(this as any).catch(err => {
          debugLog('ApiClient', 'Error processing offline queue after reconnection:', err);
        });
      }
    }
  }

  /**
   * Add a connection status listener
   */
  addConnectionListener(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.push(listener);
    return () => {
      this.connectionListeners = this.connectionListeners.filter(l => l !== listener);
    };
  }

  /**
   * Perform a health check (debounced to prevent spam)
   */
  async checkHealth(): Promise<boolean> {
    const now = Date.now();
    // Debounce: only check every 5 seconds
    if (now - this.lastHealthCheck < 5000) {
      return this.isConnected;
    }
    this.lastHealthCheck = now;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${this.baseUrl}${API_CONFIG.HEALTH_ENDPOINT}`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const healthy = response.ok;
      this.setConnectionStatus(healthy);
      return healthy;
    } catch {
      this.setConnectionStatus(false);
      return false;
    }
  }

  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Main request method with retry logic and timeout handling
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const maxAttempts = options?.noRetry ? 1 : this.maxRetries + 1;
    const timeout = options?.timeout ?? this.timeout;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await this.executeRequest<T>(method, path, body, timeout, options?.headers);
        
        // Success - mark as connected
        this.setConnectionStatus(true);
        return result;
        
      } catch (error) {
        lastError = error as Error;
        
        // Determine if we should retry
        const shouldRetry = this.isRetryableError(error) && attempt < maxAttempts - 1;
        
        if (shouldRetry) {
          const delay = calculateBackoff(attempt);
          debugLog('ApiClient', `Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})`);
          await sleep(delay);
        } else {
          // Not retrying - update connection status if network error
          if (this.isNetworkError(error)) {
            this.setConnectionStatus(false);
            
            // Queue for offline processing if it's a mutation and not already a retry from the queue
            if ((method === 'POST' || method === 'PUT' || method === 'DELETE') && !options?.headers?.['X-Offline-Retry']) {
              debugLog('ApiClient', `Network error, enqueuing ${method} ${path} for offline sync`);
              this.offlineQueue.enqueue({
                method: method as any,
                path,
                body
              }).catch(err => debugLog('ApiClient', 'Failed to enqueue offline operation:', err));
              
              // Return a placeholder or throw specific error?
              // For now, let's throw so the UI knows it's pending/failed
            }
          }
          break;
        }
      }
    }

    // All attempts failed
    throw lastError ?? new Error('Request failed');
  }

  /**
   * Execute a single request with timeout
   */
  private async executeRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    timeout?: number,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout ?? this.timeout);

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...extraHeaders,
      };

      // Add authentication header if user ID is set
      if (this.userId) {
        headers['X-User-Id'] = this.userId;

        // If a signature provider is available, sign a challenge
        if (this.signatureProvider) {
          const timestamp = Math.floor(Date.now() / 1000).toString();
          const message = `${timestamp}:${this.userId}`;
          try {
            const signature = await this.signatureProvider(message);
            headers['X-Signature'] = signature;
            headers['X-Timestamp'] = timestamp;
          } catch (e) {
            debugLog('ApiClient', 'Failed to sign request:', e);
          }
        }
      }

      const url = `${this.baseUrl}${path}`;
      debugLog('ApiClient', `${method} ${path}`);

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle non-JSON responses
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        if (!response.ok) {
          throw new ApiClientError(
            `Server error: ${response.status} ${response.statusText}`,
            'SERVER_ERROR',
            response.status
          );
        }
        // Return empty object for successful non-JSON responses
        return {} as T;
      }

      const data = await response.json();

      if (!response.ok) {
        const error = data as ApiError;
        this.onError?.(error);
        throw new ApiClientError(
          error.error || `HTTP ${response.status}`,
          error.code || 'API_ERROR',
          response.status
        );
      }

      // Response Normalization: Handle wrapped responses {items: [], total: X} or {records: [], total: X}
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const wrappedData = data as Record<string, any>;
        if (Array.isArray(wrappedData.items)) return wrappedData.items as T;
        if (Array.isArray(wrappedData.records)) return wrappedData.records as T;
        if (Array.isArray(wrappedData.submissions)) return wrappedData.submissions as T;
        if (Array.isArray(wrappedData.patients)) return wrappedData.patients as T;
        if (Array.isArray(wrappedData.results)) return wrappedData.results as T;
        if (Array.isArray(wrappedData.orders)) return wrappedData.orders as T;
      }

      return data as T;
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Handle abort (timeout)
      if ((error as Error).name === 'AbortError') {
        throw new ApiClientError(
          'Request timed out. Please check your connection.',
          'TIMEOUT',
          408
        );
      }
      
      // Handle network errors
      if (error instanceof TypeError && (error as Error).message === 'Failed to fetch') {
        throw new ApiClientError(
          'Unable to connect to server. Please check your internet connection.',
          'NETWORK_ERROR',
          0
        );
      }
      
      throw error;
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof ApiClientError) {
      // Retry on network errors, timeouts, and 5xx server errors
      return (
        error.code === 'NETWORK_ERROR' ||
        error.code === 'TIMEOUT' ||
        error.status >= 500
      );
    }
    return this.isNetworkError(error);
  }

  /**
   * Check if error is a network-level error
   */
  private isNetworkError(error: unknown): boolean {
    if (error instanceof TypeError) {
      return true; // Usually "Failed to fetch"
    }
    if (error instanceof ApiClientError) {
      return error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT';
    }
    return false;
  }

  // HTTP method convenience wrappers
  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  async delete<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, body, options);
  }

  /**
   * Get the current offline queue
   */
  getOfflineQueue(): OfflineQueue {
    return this.offlineQueue;
  }
}

/**
 * Enhanced API error with code and status
 */
export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }

  /**
   * Check if this is an authentication error
   */
  isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /**
   * Check if this is a network/connectivity error
   */
  isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    switch (this.code) {
      case 'NETWORK_ERROR':
        return 'Unable to connect to the server. Please check your internet connection.';
      case 'TIMEOUT':
        return 'The request took too long. Please try again.';
      case 'AUTH_MISSING':
        return 'Please log in to continue.';
      case 'INSUFFICIENT_ROLE':
        return 'You do not have permission to perform this action.';
      case 'RATE_LIMITED':
        return 'Too many requests. Please wait a moment and try again.';
      default:
        return this.message;
    }
  }
}

// ============================================================================
// SINGLETON API CLIENT
// ============================================================================

let defaultClient: ApiClient | null = null;

/**
 * Initialize the default API client
 * Should be called once at app startup
 */
export function initApiClient(config: ApiClientConfig): ApiClient {
  defaultClient = new ApiClient(config);
  debugLog('ApiClient', `Initialized with baseUrl: ${config.baseUrl || '(relative)'}`);
  return defaultClient;
}

/**
 * Get the default API client instance
 * Auto-initializes with stored userId if available
 */
export function getApiClient(): ApiClient {
  if (!defaultClient) {
    // Auto-initialize with default config and stored wallet address
    const storedWallet = getConnectedWalletAddress();
    defaultClient = new ApiClient({
      baseUrl: API_CONFIG.BASE_URL,
      userId: storedWallet || undefined,
    });
    debugLog('ApiClient', `Auto-initialized with default config${storedWallet ? ` and userId: ${storedWallet.substring(0, 12)}...` : ''}`);
  }
  return defaultClient;
}

/**
 * Sync the API client userId with the stored wallet address
 * Call this after login/logout to ensure the client has the correct userId
 */
export function syncApiClientUserId(): void {
  const client = getApiClient();
  const storedWallet = getConnectedWalletAddress();
  client.setUserId(storedWallet || undefined);
  debugLog('ApiClient', `Synced userId: ${storedWallet ? storedWallet.substring(0, 12) + '...' : '(none)'}`);
}

/**
 * Check if API client is initialized
 */
export function isApiClientInitialized(): boolean {
  return defaultClient !== null;
}
