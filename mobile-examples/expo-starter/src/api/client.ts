/**
 * MediChain mobile API client (Phase 8.3).
 *
 * A small fetch-based client mirroring the web `ApiClient` auth model:
 * every request carries `Authorization: Bearer <jwt>` and nothing else names the
 * caller. Sign-in is `POST /api/auth/login` with a username and a proof derived
 * from the password (see `../auth/proof.ts`); the password never leaves the
 * device.
 *
 * © 2025-2026 Lukau Invasion (Pty) Ltd. MediChain Health ID System.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { getOfflineQueue, OfflineQueue } from '../../services/offlineQueue';
import { deriveAuthProof } from '../auth/proof';

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

/** The account a sign-in answered for. */
export interface SignedInAccount {
  user_id: string;
  name: string;
  role: string;
  linked_patient_id?: string | null;
}

/** Thrown by `login` when the account has an authenticator and no code was supplied. */
export class MfaRequiredError extends Error {
  constructor() {
    super('Enter the code from your authenticator app');
    this.name = 'MfaRequiredError';
  }
}

/** Thrown by write methods when the request was queued for later sync instead of sent. */
export class OfflineQueuedError extends Error {
  constructor(endpoint: string) {
    super(`No connection — queued "${endpoint}" to sync when back online`);
    this.name = 'OfflineQueuedError';
  }
}

export class MobileApiClient {
  private baseUrl: string;
  private userId?: string;
  private accessToken?: string;
  private refreshToken?: string;
  private offlineQueue?: OfflineQueue;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? getApiBaseUrl()).replace(/\/$/, '');
  }

  /** Start offline-queue monitoring (safe to call once auth is established). */
  initOfflineQueue(): OfflineQueue {
    if (!this.offlineQueue) {
      this.offlineQueue = getOfflineQueue({
        apiBaseUrl: this.baseUrl,
        getAuthHeaders: async () => this.headers(),
      });
      this.offlineQueue.initialize();
    }
    return this.offlineQueue;
  }

  getOfflineQueueStats() {
    return this.offlineQueue?.getStats() ?? { pending: 0, isProcessing: false, isOnline: true };
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
    return h;
  }

  /**
   * Sign in with a username and password.
   *
   * `X-Refresh-Transport: body` asks for the refresh token in the response body
   * (a native app has no cookie jar to hold it). Throws `MfaRequiredError` when
   * the account needs its authenticator code; call again with `totpCode`.
   */
  async login(
    identifier: string,
    password: string,
    totpCode?: string
  ): Promise<{ tokens: JwtTokens; account: SignedInAccount }> {
    const id = identifier.trim();
    const resp = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Refresh-Transport': 'body' },
      body: JSON.stringify({
        identifier: id,
        auth_proof: deriveAuthProof(password, id),
        ...(totpCode ? { totp_code: totpCode } : {}),
      }),
    });
    const data = await resp.json().catch(() => ({}));
    const code = data?.error?.code ?? data?.code;
    if (!resp.ok) {
      if (code === 'MFA_REQUIRED' || code === 'TOTP_REQUIRED') throw new MfaRequiredError();
      if (code === 'INVALID_CREDENTIALS') throw new Error('Username or password is not correct');
      if (code === 'ACCOUNT_LOCKED') throw new Error('Too many attempts. Try again later');
      throw new Error(`Sign-in failed: ${resp.status}`);
    }
    if (data.mfa_required && !data.access_token) throw new MfaRequiredError();
    if (!data.access_token || !data.refresh_token || !data.user) {
      throw new Error('The server did not start a session');
    }
    const tokens = { accessToken: data.access_token, refreshToken: data.refresh_token };
    this.setTokens(tokens);
    this.setUserId(data.user.user_id);
    return { tokens, account: data.user as SignedInAccount };
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

  async post<T>(path: string, body: unknown, opts?: { description?: string }): Promise<T> {
    const netState = await NetInfo.fetch();
    if (netState.isConnected === false) {
      await this.enqueueOffline(path, body, opts?.description);
    }

    try {
      const resp = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`POST ${path} failed: ${resp.status}`);
      return resp.json() as Promise<T>;
    } catch (err) {
      // Network-level failure (not an HTTP error status) — queue for retry on reconnect.
      if (err instanceof TypeError) {
        await this.enqueueOffline(path, body, opts?.description);
      }
      throw err;
    }
  }

  private async enqueueOffline(path: string, body: unknown, description?: string): Promise<never> {
    if (this.offlineQueue) {
      await this.offlineQueue.enqueue({ method: 'POST', endpoint: path, body, priority: 5, description: description ?? path });
    }
    throw new OfflineQueuedError(path);
  }

  private async refresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      const resp = await fetch(`${this.baseUrl}/api/auth/jwt/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Refresh-Transport': 'body' },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      if (data?.access_token && data?.refresh_token) {
        this.accessToken = data.access_token;
        this.refreshToken = data.refresh_token;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

export const apiClient = new MobileApiClient();
