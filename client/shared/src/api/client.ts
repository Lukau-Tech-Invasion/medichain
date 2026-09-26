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
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
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

/**
 * SHA-256 hex digest of `text`, empty-string input hashing to the digest of
 * an empty body. Used to bind a request's signature to its exact body
 * (Horizon HZ-007) — same `crypto.subtle.digest` pattern already used in
 * `wallet/service.ts`'s `blake2Hash`.
 */
async function sha256Hex(text: string | ArrayBuffer): Promise<string> {
  const data = typeof text === 'string' ? new TextEncoder().encode(text) : new Uint8Array(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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
  /**
   * Return the response body as the server sent it.
   *
   * By default a body carrying an `items`/`records`/`orders`/... array is
   * unwrapped to that array. That is wrong for a response that carries two
   * lists side by side -- the patient imaging read returns `orders` AND
   * `reports`, and unwrapping would silently discard every report.
   */
  keepEnvelope?: boolean;
  /** Custom timeout for this request */
  timeout?: number;
  /** Additional headers */
  headers?: Record<string, string>;
  /**
   * Queue this mutation for replay if the device cannot reach the server.
   *
   * **Opt-in, deliberately.** Queueing every failed mutation would sweep up
   * sign-in, sign-out and token refresh, and replaying those hours later is
   * wrong at best. It would also surprise someone who watched a write fail and
   * then saw it apply itself later. A caller asks for this when the operation
   * is the user's own record and capturing it offline is the point — a dose
   * taken with no signal, a symptom logged in a queue at a rural clinic.
   *
   * The caller still receives an error (`OfflineQueuedError`), so nothing shows
   * a false success. Replay is safe because the queue item's id becomes the
   * `Idempotency-Key`; see `utils/syncQueue.ts`.
   */
  queueWhenOffline?: {
    category: 'medical-records' | 'appointments' | 'medications' | 'lab-results' | 'documents' | 'images';
    description: string;
    patientId?: string;
  };
}

/**
 * Pull the `{ message, code }` out of any error response body the backend can
 * emit, returning `undefined` for fields it can't recognize. Tolerates:
 *  - Canonical envelope (Phase 9.5): `{ error: { code, message, details? } }`
 *  - Legacy flat shape: `{ error: "msg", code: "CODE" }`
 *  - FHIR OperationOutcome: `{ resourceType: "OperationOutcome", issue: [{ diagnostics, code }] }`
 */
function parseErrorBody(data: unknown): { message?: string; code?: string } {
  if (!data || typeof data !== 'object') return {};
  const body = data as Record<string, unknown>;
  const err = body.error;

  // Canonical envelope: `error` is a nested object
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return {
      message: typeof e.message === 'string' ? e.message : undefined,
      code: typeof e.code === 'string' ? e.code : undefined,
    };
  }

  // Legacy flat shape: `error` is a string
  if (typeof err === 'string') {
    return {
      message: err || undefined,
      code: typeof body.code === 'string' ? body.code : undefined,
    };
  }

  // FHIR OperationOutcome
  if (
    body.resourceType === 'OperationOutcome' &&
    Array.isArray(body.issue) &&
    body.issue.length > 0
  ) {
    const issue = body.issue[0] as Record<string, unknown>;
    return {
      message: typeof issue.diagnostics === 'string' ? issue.diagnostics : undefined,
      code: typeof issue.code === 'string' ? issue.code.toUpperCase() : undefined,
    };
  }

  return {};
}

/** Normalize an error body into a guaranteed `{ message, code }` (used by the client). */
function extractApiError(
  data: unknown,
  status: number
): { message: string; code: string } {
  const parsed = parseErrorBody(data);
  return {
    message: parsed.message ?? `HTTP ${status}`,
    code: parsed.code ?? 'API_ERROR',
  };
}

/**
 * Extract a human-readable error message from any backend error body.
 *
 * For use by pages/components that issue raw `fetch` calls (bypassing the typed
 * client) and read the error body directly. Handles the canonical Phase 9.5
 * envelope as well as legacy and FHIR shapes; returns `fallback` when no message
 * can be found.
 */
export function getApiErrorMessage(data: unknown, fallback = 'Request failed'): string {
  // What the typed client throws already carries the server's message. Parsing
  // it as a response body found no `error` field and returned the fallback, so
  // every page that caught a typed-client error showed "Request failed" in
  // place of the reason the server gave.
  if (data instanceof ApiClientError) return data.message || fallback;
  return parseErrorBody(data).message ?? fallback;
}

/**
 * Extract the machine-readable error code from a thrown API error.
 *
 * Callers branch on codes like `DISPENSE_RACE_DETECTED` to explain what
 * happened in clinical terms, and they were reaching into the thrown value with
 * `catch (error: any)` and an optional-chain guess at two possible shapes. The
 * two shapes are real -- the typed client throws a flat `{ code }`, while a
 * raw `fetch` path surfaces the body under `response.data.error` -- so the
 * knowledge belongs here, once, rather than in each catch block.
 */
export function getApiErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const flat = (error as { code?: unknown }).code;
  if (typeof flat === 'string') return flat;
  const nested = (error as { response?: { data?: { error?: { code?: unknown } } } })
    .response?.data?.error?.code;
  return typeof nested === 'string' ? nested : undefined;
}

/**
 * Decode one URL path segment without throwing on malformed escapes.
 *
 * @param segment - A raw path segment.
 * @returns The decoded segment, or the raw text when it is not valid encoding.
 */
function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The patient chart a clinician has open, and their declared reason for opening it. */
export interface PatientAccessContext {
  /** Patient record id as it appears in API paths (e.g. `PAT-001`). */
  patientId: string;
  /** Reason code: Treatment, Referral, Emergency, Administrative, or free text. */
  reason: string;
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
  // JWT auth (Phase 9.4): when set, requests send `Authorization: Bearer <access>`
  // and transparently refresh on a 401 using the refresh token.
  private accessToken?: string;
  private refreshToken?: string;
  /**
   * True once a JWT session existed and then ended (logout, or a refresh that
   * failed). Latched rather than derived, because "no token right now" cannot
   * distinguish a demo client that never signed in from a session that was
   * revoked a moment ago -- and those two must not get the same identity.
   */
  private sessionEnded = false;
  private refreshPromise: Promise<boolean> | null = null;
  /**
   * The chart a clinician currently has open and why they opened it. Sent as
   * `X-Access-Reason` on reads of that patient so the patient's access history
   * can say *why*, not just *who* and *when*.
   */
  private patientAccessContext?: PatientAccessContext;
  /** Stated once for this portal session before any directory rows load. */
  private directoryPurpose?: string;

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
   * The signer currently attached, if any.
   *
   * Sign-in needs to know whether this client can prove control of a key before
   * it claims a session: an identity with no signer cannot obtain a JWT, because
   * the server verifies a real signature over a single-use challenge in every
   * mode. Reading it back from here keeps one copy of that state rather than a
   * second one in the store that could disagree.
   */
  getSignatureProvider(): ((message: string) => Promise<string>) | null {
    return this.signatureProvider;
  }

  /**
   * Set JWT access + refresh tokens (Phase 9.4).
   *
   * Once set, requests carry `Authorization: Bearer <access>` and a 401 triggers
   * a one-time refresh + retry. The shared client does not also send the raw
   * wallet header: the API derives identity from the verified JWT subject.
   * Header-only identity remains a demo-only compatibility path when no token
   * has been established.
   */
  setTokens(accessToken: string | undefined, refreshToken?: string): void {
    this.accessToken = accessToken;
    if (refreshToken !== undefined) {
      this.refreshToken = refreshToken;
    }
    if (accessToken) {
      this.sessionEnded = false;
    }
    debugLog('ApiClient', `JWT tokens ${accessToken ? 'set' : 'cleared'}`);
  }

  /**
   * End this login session on the server, then clear local credentials.
   *
   * Discarding tokens client-side is not signing out: an access token stays
   * cryptographically valid until it expires, and the refresh generation stays
   * usable, so the session has to be revoked where it lives. The local clear
   * happens regardless of the outcome -- a user who asked to sign out must not
   * be left holding credentials because the network was down.
   */
  async endSession(options?: { allDevices?: boolean }): Promise<boolean> {
    const path = options?.allDevices ? '/api/auth/logout-all' : '/api/auth/logout';
    let revoked = false;
    if (this.accessToken) {
      try {
        // Logout is deliberately absent from the middleware's allowlist —
        // it is a keyed-subject mutation like any other — so it needs a key.
        // Without one the server refused it and the session stayed alive
        // while the client cleared its tokens and believed otherwise.
        const resp = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: this.getMutationHeaders(),
        });
        revoked = resp.ok;
      } catch {
        // Reported through the return value; the local clear below still runs.
        revoked = false;
      }
    }
    this.clearTokens();
    return revoked;
  }

  /**
   * Clear stored JWT tokens, on logout or on a refresh that failed.
   *
   * This also latches `sessionEnded`, which is what stops the client silently
   * reverting to the legacy identity header afterwards. Without that latch, an
   * expired or *revoked* session degraded into wallet-header identity on the
   * next request and kept working -- which would make session revocation
   * unenforceable for any client still holding a signer.
   */
  clearTokens(): void {
    if (this.accessToken || this.refreshToken) {
      this.sessionEnded = true;
    }
    this.accessToken = undefined;
    this.refreshToken = undefined;
  }

  /**
   * Get the current access token, if any.
   */
  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  /**
   * Return the normal identity headers for a direct browser request.
   *
   * A verified JWT is always preferred. The optional legacy wallet address is
   * used only when no session token exists, which keeps local demo flows
   * working while direct pages are migrated away from `X-User-Id`.
   */
  /**
   * Headers for a mutation made with a raw `fetch` rather than through this
   * client's own `post`/`put`/`patch`/`delete`.
   *
   * `api/src/middleware/idempotency.rs` refuses any keyed-subject mutation
   * that arrives without an `Idempotency-Key` (409
   * IDEMPOTENCY_KEY_REQUIRED). `request()` adds one automatically; a direct
   * `fetch` does not, and 30 production call sites were written that way
   * before the middleware existed. Every one of them was being refused:
   * recording vital signs, registering a patient, writing a SOAP note,
   * placing an order, triage, wound care, discharge, messages, consent
   * changes — and signing out.
   *
   * A fresh key per call is right for a user-initiated action: the button
   * press *is* the intent, and two presses are two intents. Retrying one
   * request with a stable key is a different problem, handled inside
   * `request()`.
   */
  getMutationHeaders(legacyUserId?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...this.getSessionHeaders(legacyUserId),
      'Idempotency-Key': createOperationKey(),
    };
  }

  getSessionHeaders(legacyUserId?: string): Record<string, string> {
    if (this.accessToken) {
      return { Authorization: `Bearer ${this.accessToken}` };
    }

    // A session that existed and ended must not silently become a weaker
    // identity. Only a client that never held one -- the demo path -- may
    // fall back to the legacy header.
    if (this.sessionEnded) {
      return {};
    }

    const userId = legacyUserId ?? this.userId;
    return userId ? { 'X-User-Id': userId } : {};
  }

  /**
   * Refresh the access token using the stored refresh token. Concurrent callers
   * share a single in-flight refresh. Returns true on success.
   */
  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) {
      return false;
    }
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = (async () => {
      try {
        const resp = await fetch(`${this.baseUrl}/api/auth/jwt/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: this.refreshToken }),
        });
        if (!resp.ok) {
          this.clearTokens();
          return false;
        }
        const data = await resp.json();
        if (data?.access_token && data?.refresh_token) {
          this.accessToken = data.access_token as string;
          this.refreshToken = data.refresh_token as string;
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
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
        this.offlineQueue.processQueue({
          request: (method, path, body) => this.request(method, path, body),
        }).catch(err => {
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
   * Declare (or clear) the patient chart the clinician has open and the reason.
   *
   * @param context - The open chart and declared reason, or undefined when the
   *   chart is closed. Always clear it on leaving a chart, so a later read of a
   *   different patient cannot inherit this patient's reason.
   */
  setPatientAccessContext(context: PatientAccessContext | undefined): void {
    this.patientAccessContext = context;
  }

  /** Set the clinician's declared purpose for browsing the patient directory. */
  setDirectoryPurpose(purpose: string | undefined): void {
    this.directoryPurpose = purpose;
  }

  /** Reuse the clinician's declared purpose when a workflow opens a chart. */
  getDirectoryPurpose(): string | undefined {
    return this.directoryPurpose;
  }

  /**
   * Headers declaring why a patient's data is being read, when applicable.
   *
   * @param method - HTTP method of the request.
   * @param path - Request path (may include a query string).
   * @returns `{ 'X-Access-Reason': reason }` for a GET whose path names the
   *   patient in the open chart; otherwise an empty object.
   */
  private accessReasonHeaders(method: string, path: string): Record<string, string> {
    if (method.toUpperCase() !== 'GET') return {};
    if (path.split('?')[0] === '/api/patients' && this.directoryPurpose) {
      return { 'X-Access-Reason': this.directoryPurpose };
    }
    const context = this.patientAccessContext;
    if (!context) return {};
    // Match whole path segments only, so PAT-1 never matches PAT-10.
    const segments = path.split('?')[0].split('/').map(safeDecodeSegment);
    return segments.includes(context.patientId) ? { 'X-Access-Reason': context.reason } : {};
  }

  /**
   * Main request method with retry logic and timeout handling
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
    /** Internal: return the bytes rather than parsing JSON (see `getBlob`). */
    asBlob = false
  ): Promise<T> {
    const maxAttempts = options?.noRetry ? 1 : this.maxRetries + 1;
    const timeout = options?.timeout ?? this.timeout;
    // Generate once per logical mutation, outside the retry loop. Recreating a
    // key per attempt would turn a response-loss retry into a second write.
    // A caller-supplied key wins. `replayQueuedMutation` passes the queue
    // item's id, and overwriting it with a fresh one here would defeat the
    // server-side deduplication that makes replay safe at all.
    const callerKey = options?.headers?.['Idempotency-Key'];
    const idempotencyKey = isMutationMethod(method)
      ? (callerKey ?? createOperationKey())
      : undefined;
    const reasonHeaders = this.accessReasonHeaders(method, path);
    const requestHeaders = idempotencyKey
      ? { ...reasonHeaders, ...options?.headers, 'Idempotency-Key': idempotencyKey }
      : { ...reasonHeaders, ...options?.headers };
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await this.executeRequest<T>(method, path, body, timeout, requestHeaders, {
          keepEnvelope: options?.keepEnvelope,
          blob: asBlob,
        });
        
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
            
            // Replay used to be disabled outright, and that was right at the
            // time: "durable server-side idempotency ... is not complete, so
            // automatic replay could duplicate a clinical or governance action
            // after a response loss."
            //
            // It is complete now — `middleware/idempotency.rs` claims each
            // keyed mutation in PostgreSQL under
            // `UNIQUE (subject, method, route, idempotency_key)`, surviving
            // restart — so a queued item replayed twice executes once. What
            // remains deliberate is that a caller has to *ask*: see
            // `queueWhenOffline`.
            if (isMutationMethod(method) && options?.queueWhenOffline) {
              const queued = await queueOfflineMutation(
                method as 'POST' | 'PUT' | 'DELETE',
                path,
                body,
                options.queueWhenOffline
              );
              if (queued) {
                throw queued;
              }
            } else if (isMutationMethod(method)) {
              debugLog('ApiClient', `${method} ${path} failed offline and was not queued (no queueWhenOffline)`);
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
    extraHeaders?: Record<string, string>,
    mode: { keepEnvelope?: boolean; blob?: boolean } = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout ?? this.timeout);

    try {
      // A binary upload is sent as its bytes, not JSON-encoded, and its
      // signature hashes those same bytes (the server hashes the raw body).
      const binary = body instanceof ArrayBuffer ? body : null;
      const payload: BodyInit | undefined = binary ?? (body ? JSON.stringify(body) : undefined);
      // Build headers fresh each attempt so a refreshed Bearer token is picked up.
      const buildHeaders = async (): Promise<Record<string, string>> => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...extraHeaders,
        };

        // `getSessionHeaders()` is the single owner of the Bearer-vs-legacy
        // decision. This used to re-derive the same rule inline and re-assign
        // the header, which is how two copies of one authentication policy
        // start to drift apart.
        const identity = this.getSessionHeaders();
        Object.assign(headers, identity);

        // Sign only when the legacy identity header is what actually went out.
        // The signature binds a wallet address, so signing a request that does
        // not carry that address proves nothing -- and keying off the emitted
        // header rather than off `this.userId` means the value signed and the
        // value sent cannot diverge.
        const legacyIdentity = identity['X-User-Id'];
        if (legacyIdentity) {
          if (this.signatureProvider) {
            const timestamp = Math.floor(Date.now() / 1000).toString();
            // Bind the signature to this exact method, path, and body
            // (Horizon HZ-007) — must match exactly what the server's
            // `SignatureAuthMiddleware` observes and what is actually sent
            // below (`body ? JSON.stringify(body) : undefined`).
            const bodyHash = await sha256Hex(binary ?? (body ? JSON.stringify(body) : ''));
            const message = `${timestamp}:${legacyIdentity}:${method}:${path}:${bodyHash}`;
            try {
              const signature = await this.signatureProvider(message);
              headers['X-Signature'] = signature;
              headers['X-Timestamp'] = timestamp;
            } catch (e) {
              debugLog('ApiClient', 'Failed to sign request:', e);
            }
          }
        }
        return headers;
      };

      const url = `${this.baseUrl}${path}`;
      debugLog('ApiClient', `${method} ${path}`);

      let response = await fetch(url, {
        method,
        headers: await buildHeaders(),
        body: payload,
        signal: controller.signal,
      });

      // JWT auto-refresh on 401 (Phase 9.4): refresh once and retry the request.
      if (
        response.status === 401 &&
        this.accessToken &&
        this.refreshToken &&
        path !== '/api/auth/jwt/refresh'
      ) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          response = await fetch(url, {
            method,
            headers: await buildHeaders(),
            body: payload,
            signal: controller.signal,
          });
        }
      }

      clearTimeout(timeoutId);

      // Handle non-JSON responses
      const contentType = response.headers.get('content-type');

      if (mode.blob) {
        if (!response.ok) {
          const errorBody = contentType?.includes('application/json')
            ? await response.json().catch(() => ({}))
            : {};
          const { message, code } = extractApiError(errorBody, response.status);
          throw new ApiClientError(message, code, response.status);
        }
        return { blob: await response.blob(), contentType: contentType ?? '' } as T;
      }
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
        const { message, code } = extractApiError(data, response.status);
        this.onError?.({ success: false, error: message, code });
        throw new ApiClientError(message, code, response.status);
      }

      // Response Normalization: Handle wrapped responses {items: [], total: X} or {records: [], total: X}
      if (!mode.keepEnvelope && data && typeof data === 'object' && !Array.isArray(data)) {
        const wrappedData = data as Record<string, unknown>;
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

  /**
   * A binary download: the bytes, and the type the server declared for them.
   *
   * Same session, refresh and retry handling as every other read. A document
   * download written as a raw `fetch` had none of it, so a patient whose access
   * token had expired got "download failed" rather than a refreshed session.
   */
  async getBlob(path: string, options?: RequestOptions): Promise<{ blob: Blob; contentType: string }> {
    const blobOptions: RequestOptions = { ...options, headers: { Accept: '*/*', ...options?.headers } };
    return this.request('GET', path, undefined, blobOptions, true);
  }

  /** A mutation whose answer is a file -- a rendered PDF. See {@link getBlob}. */
  async postBlob(
    path: string,
    body: unknown,
    options?: RequestOptions
  ): Promise<{ blob: Blob; contentType: string }> {
    const blobOptions: RequestOptions = { ...options, headers: { Accept: '*/*', ...options?.headers } };
    return this.request('POST', path, body, blobOptions, true);
  }

  /**
   * Upload a file's bytes as the request body, declared as `contentType`.
   * Same session, refresh and idempotency handling as every other mutation;
   * never retried, since a partially received upload is not safe to resend
   * blindly and the caller can offer the choice to the user.
   */
  async postBinary<T>(path: string, bytes: ArrayBuffer, contentType: string): Promise<T> {
    return this.request<T>('POST', path, bytes, { noRetry: true, headers: { 'Content-Type': contentType } });
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  async delete<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, body, options);
  }

  /**
   * Send a mutation that was queued while the device was offline, under a key
   * the *caller* owns.
   *
   * This is the one place a caller supplies the `Idempotency-Key`, and the
   * reason is the whole safety argument for replay. `request()` mints a fresh
   * key per logical mutation, which is right for a button press — two presses
   * are two intents. A queued item is the opposite case: every attempt to send
   * it is the *same* intent, so the key must be the item's own id and must not
   * change between attempts. The server claims it under
   * `UNIQUE (subject, method, route, idempotency_key)` and refuses a second
   * execution, which is what makes replaying after a lost response safe rather
   * than a second clinical write.
   *
   * `noRetry` is deliberate: the replay loop owns retrying, because it also
   * owns the ordering.
   */
  async replayQueuedMutation<T>(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    idempotencyKey: string
  ): Promise<T> {
    return this.request<T>(method, path, body, {
      noRetry: true,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  /**
   * Get the current offline queue
   */
  getOfflineQueue(): OfflineQueue {
    return this.offlineQueue;
  }
}

function isMutationMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
}

function createOperationKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A mutation the device could not send, which has been queued for replay.
 *
 * Thrown rather than swallowed. The caller has to know the write did not land,
 * or a page reports success over a record the server has never seen — which is
 * the defect this whole queue exists to avoid.
 */
export class OfflineQueuedError extends Error {
  public readonly queueItemId: string;

  constructor(queueItemId: string, endpoint: string) {
    super(`This device is offline. "${endpoint}" is queued and will be sent when it reconnects.`);
    this.name = 'OfflineQueuedError';
    this.queueItemId = queueItemId;
  }
}

/**
 * Put a mutation in the durable queue. Returns the error to throw, or `null`
 * if the queue itself is unavailable — in which case the original network
 * error stands, because a failure to queue must not read as a successful one.
 */
async function queueOfflineMutation(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  intent: NonNullable<RequestOptions['queueWhenOffline']>
): Promise<OfflineQueuedError | null> {
  try {
    const { enqueueSyncItem } = await import('../utils/indexedDB');
    const id = await enqueueSyncItem({
      action: method === 'DELETE' ? 'delete' : 'update',
      endpoint: path,
      method,
      body,
      category: intent.category,
      description: intent.description,
      priority: 'medium',
      patientId: intent.patientId,
    });
    debugLog('ApiClient', `Queued ${method} ${path} for replay as ${id}`);
    return new OfflineQueuedError(id, path);
  } catch (error) {
    debugLog('ApiClient', `Could not queue ${method} ${path}: ${String(error)}`);
    return null;
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

