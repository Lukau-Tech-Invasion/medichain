/**
 * MediChain mobile API client (Phase 8.3).
 *
 * A small fetch-based client mirroring the web `ApiClient` auth model:
 * sends `Authorization: Bearer <jwt>` (preferred) with an `X-User-Id` fallback,
 * and obtains a JWT via the wallet challenge endpoint. Kept dependency-free so
 * it runs anywhere React Native does.
 *
 * © 2025-2026 Trustware. MediChain Health ID System.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Resolve the API base URL from env / emulator defaults. */
export function getApiBaseUrl(): string {
  const envUrl =
    (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
    process.env.EXPO_PUBLIC_API_URL;
  if (envUrl && !envUrl.includes('${')) return envUrl.replace(/\/$/, '');
  if (Platform.OS === 'android') return 'http://10.0.2.2:8080';
  return 'http://localhost:8080';
}

export interface JwtTokens {
  accessToken: string;
  refreshToken: string;
}

export class MobileApiClient {
  private baseUrl: string;
  private userId?: string;
  private accessToken?: string;
  private refreshToken?: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? getApiBaseUrl()).replace(/\/$/, '');
  }

  setUserId(userId?: string): void {
    this.userId = userId;
  }

  setTokens(tokens?: JwtTokens): void {
    this.accessToken = tokens?.accessToken;
    this.refreshToken = tokens?.refreshToken;
  }

  getTokens(): JwtTokens | undefined {
    if (this.accessToken && this.refreshToken) {
      return { accessToken: this.accessToken, refreshToken: this.refreshToken };
    }
    return undefined;
  }

  clear(): void {
    this.userId = undefined;
    this.accessToken = undefined;
    this.refreshToken = undefined;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extra,
    };
    if (this.accessToken) h['Authorization'] = `Bearer ${this.accessToken}`;
    if (this.userId) h['X-User-Id'] = this.userId;
    return h;
  }

  /** Obtain JWTs for a wallet (demo issuance; pass a signer for production). */
  async issueJwt(walletAddress: string): Promise<JwtTokens> {
    const resp = await fetch(`${this.baseUrl}/api/auth/jwt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: walletAddress }),
    });
    if (!resp.ok) throw new Error(`JWT issuance failed: ${resp.status}`);
    const data = await resp.json();
    const tokens = { accessToken: data.access_token, refreshToken: data.refresh_token };
    this.setTokens(tokens);
    return tokens;
  }

  /** Look up a wallet account (used at login to fetch role/health id). */
  async walletLookup(walletAddress: string): Promise<Record<string, unknown>> {
    const resp = await fetch(`${this.baseUrl}/api/auth/wallet/${walletAddress}`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error('Wallet not registered');
    return resp.json();
  }

  async get<T>(path: string): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (resp.status === 401 && this.refreshToken) {
      if (await this.refresh()) {
        return this.get<T>(path);
      }
    }
    if (!resp.ok) throw new Error(`GET ${path} failed: ${resp.status}`);
    return resp.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`POST ${path} failed: ${resp.status}`);
    return resp.json() as Promise<T>;
  }

  private async refresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      const resp = await fetch(`${this.baseUrl}/api/auth/jwt/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      if (data?.access_token) {
        this.accessToken = data.access_token;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

export const apiClient = new MobileApiClient();
