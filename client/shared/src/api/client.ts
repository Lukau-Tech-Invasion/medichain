/**
 * MediChain API Client
 * 
 * Typed HTTP client for interacting with the MediChain REST API.
 * Handles authentication via X-User-Id header.
 */

import type { ApiError } from '../types';

export interface ApiClientConfig {
  baseUrl: string;
  userId?: string;
  onError?: (error: ApiError) => void;
}

export class ApiClient {
  private baseUrl: string;
  private userId?: string;
  private onError?: (error: ApiError) => void;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.userId = config.userId;
    this.onError = config.onError;
  }

  setUserId(userId: string | undefined) {
    this.userId = userId;
  }

  getUserId(): string | undefined {
    return this.userId;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.userId) {
      headers['X-User-Id'] = this.userId;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      const error = data as ApiError;
      this.onError?.(error);
      throw new ApiClientError(error.error, error.code, response.status);
    }

    return data as T;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  async delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, body);
  }
}

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

// Default API client instance (configured in app)
let defaultClient: ApiClient | null = null;

export function initApiClient(config: ApiClientConfig): ApiClient {
  defaultClient = new ApiClient(config);
  return defaultClient;
}

export function getApiClient(): ApiClient {
  if (!defaultClient) {
    throw new Error('API client not initialized. Call initApiClient first.');
  }
  return defaultClient;
}
