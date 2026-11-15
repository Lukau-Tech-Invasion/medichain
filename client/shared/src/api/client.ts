/**
 * MediChain API Client
 * 
 * Typed HTTP client for interacting with the MediChain REST API.
 * Features:
 * - Bearer-token authentication (JWT access token, HttpOnly refresh cookie)
 * - Automatic retry with exponential backoff
 * - Request timeout handling
 * - Connection health monitoring
 * - Proper error recovery
 * 
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */

import { offlineIntentFor, type OfflineRoute } from '../utils/offlinePolicy';
import type { ApiError } from '../types';
import { API_CONFIG, debugLog, sleep, calculateBackoff } from '../config';

export interface ApiClientConfig {
  baseUrl: string;
  userId?: string;
  timeout?: number;
  maxRetries?: number;
  onError?: (error: ApiError) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export interface RequestOptions {
  /** Owner of a hash-addressed document; used only to select an existing audit purpose. */
  patientId?: string;
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
  /** Internal: a replay of a queued item, which must never queue again. */
  noOfflineQueue?: boolean;
  queueWhenOffline?: {
    category: 'medical-records' | 'appointments' | 'medications' | 'lab-results' | 'documents' | 'images';
    description: string;
    patientId?: string;
    /** Not sent after this long (ms); absent = no limit. */
    expiresInMs?: number;
  };
}

/** Asked for a verified Class C authorization id; `undefined` when cancelled. */
export type TransactionAuthorizer = (intent: {
  action: string;
  method: string;
  path: string;
  body_digest?: string;
  resource_id?: string;
  expected_state?: string;
  idempotency_key?: string;
}) => Promise<string | undefined>;

/** SHA-256 of a UTF-8 string, as lowercase hex -- what the server's `body_digest` is. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Directory reads: each carries the clinician's stated purpose and is audited server-side. */
const DIRECTORY_READ_PATHS = new Set(['/api/patients', '/api/patients/paediatric-caseload']);

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
  /**
   * Server-issued access context (WP10). When present it is sent with every
   * read of this patient, and the server records the reason it holds for the
   * context rather than the declared header.
   */
  contextId?: string;
}

/**
 * A write the server accepted. `body` and `response` are the objects as sent
 * and as parsed, handed over in memory only; listeners must not store them
 * anywhere that outlives the tab (they can carry clinical content).
 */
export interface SucceededMutation {
  method: string;
  path: string;
  body?: unknown;
  response?: unknown;
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
  // JWT auth (Phase 9.4): when set, requests send `Authorization: Bearer <access>`
  // and transparently refresh on a 401 using the refresh token.
  private accessToken?: string;
  /**
   * True once a JWT session existed and then ended (logout, or a refresh that
   * failed). Latched so that a revoked session is never silently refreshed back
   * to life by a request that was already in flight.
   */
  private sessionEnded = false;
  private refreshPromise: Promise<boolean> | null = null;
  /** Set when the last refresh could not reach the server at all. */
  private refreshUnreachable = false;
  // A response from an older login must not undo logout or replace a new login.
  private sessionGeneration = 0;
  /**
   * The chart a clinician currently has open and why they opened it. Sent as
   * `X-Access-Reason` on reads of that patient so the patient's access history
   * can say *why*, not just *who* and *when*.
   */
  private patientAccessContext?: PatientAccessContext;
  /** Stated once for this portal session before any directory rows load. */
  private directoryPurpose?: string;
  /**
   * Writes this portal keeps on the device when there is no signal
   * (`utils/offlinePolicy.ts`). Empty unless the portal opts in.
   */
  private offlineRoutes: readonly OfflineRoute[] = [];

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.userId = config.userId;
    this.timeout = config.timeout ?? API_CONFIG.TIMEOUT;
    this.maxRetries = config.maxRetries ?? API_CONFIG.MAX_RETRIES;
    this.onError = config.onError;
    this.onConnectionChange = config.onConnectionChange;
  }

  /**
   * Record which user (`user_id`, a UUID) this client is signed in as.
   *
   * This is display and routing state only -- for example so the event stream
   * can tell whose events to show. It is never sent as a credential: the API
   * derives identity from the verified bearer token alone.
   */
  /** Opt this portal's listed writes in to the offline queue. */
  setOfflineRoutes(routes: readonly OfflineRoute[]): void {
    this.offlineRoutes = routes;
  }

  setUserId(userId: string | undefined): void {
    this.userId = userId;
    debugLog('ApiClient', `User ID ${userId ? 'set' : 'cleared'}`);
  }

  /**
   * Set JWT access + refresh tokens (Phase 9.4).
   *
   * Once set, requests carry `Authorization: Bearer <access>` and a 401 triggers
   * a one-time refresh + retry. The API derives identity from the verified JWT
   * subject; nothing else on the request names a user.
   */
  setTokens(accessToken: string | undefined, _refreshToken?: string): void {
    this.sessionGeneration += 1;
    // The refresh token is an HttpOnly cookie the browser holds and script
    // cannot read (WP12); the second parameter is accepted and ignored so
    // older callers keep compiling.
    this.accessToken = accessToken;
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
    const hadAccessToken = Boolean(this.accessToken);
    const headers = this.getMutationHeaders();
    this.clearTokens();
    let revoked = false;
    if (hadAccessToken) {
      try {
        // Logout is deliberately absent from the middleware's allowlist —
        // it is a keyed-subject mutation like any other — so it needs a key.
        // Without one the server refused it and the session stayed alive
        // while the client cleared its tokens and believed otherwise.
        const resp = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers,
          // So the server can clear the HttpOnly refresh cookie.
          credentials: 'include',
        });
        revoked = resp.ok;
      } catch {
        // Reported through the return value; the local clear below still runs.
        revoked = false;
      }
    }
    return revoked;
  }

  /**
   * Clear stored JWT tokens, on logout or on a refresh that failed.
   *
   * This also latches `sessionEnded`, which stops a request already in flight
   * from refreshing a session the person has just ended.
   */
  clearTokens(): void {
    this.sessionGeneration += 1;
    this.sessionEnded = true;
    this.accessToken = undefined;
  }

  /**
   * Re-establish a session after a page reload from the HttpOnly refresh
   * cookie (WP12). Returns true when the server issued a fresh access token.
   */
  async restoreSession(): Promise<boolean> {
    return this.refreshAccessToken();
  }

  /**
   * `restoreSession`, saying *why* it failed. `unreachable` means the server
   * could not be asked — no signal — and the session may well still be valid;
   * only `ended` means the server refused it. A clinician who reopens the app
   * on a ward with no signal must not be treated as signed out.
   */
  async restoreSessionOutcome(): Promise<'restored' | 'ended' | 'unreachable'> {
    this.refreshUnreachable = false;
    if (await this.refreshAccessToken()) return 'restored';
    return this.refreshUnreachable ? 'unreachable' : 'ended';
  }

  /**
   * Get the current access token, if any.
   */
  getAccessToken(): string | undefined {
    return this.accessToken;
  }

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
  getMutationHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...this.getSessionHeaders(),
      'Idempotency-Key': createOperationKey(),
    };
  }

  /** The `Authorization` header for the current session, or none when signed out. */
  getSessionHeaders(): Record<string, string> {
    return this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {};
  }

  /**
   * Refresh the access token using the stored refresh token. Concurrent callers
   * share a single in-flight refresh. Returns true on success.
   */
  private async refreshAccessToken(): Promise<boolean> {
    if (this.sessionEnded) return false;
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    const generation = this.sessionGeneration;
    const expectedUserId = this.userId;
    this.refreshPromise = (async () => {
      // Whether the server answered the refresh at all. Only a refresh that
      // never reached it is "unreachable"; once a token has been issued, a
      // failure to verify whose it is still clears the session (below).
      let answered = false;
      try {
        // The refresh token travels as the HttpOnly cookie (WP12).
        const resp = await fetch(`${this.baseUrl}/api/auth/jwt/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        answered = true;
        if (generation !== this.sessionGeneration) return false;
        if (!resp.ok) {
          this.clearTokens();
          return false;
        }
        const data = await resp.json();
        if (generation !== this.sessionGeneration) return false;
        if (typeof data?.access_token === 'string' && data.access_token.length > 0) {
          const identityMatches = await this.matchesRestoredIdentity(data.access_token, expectedUserId);
          if (generation !== this.sessionGeneration || expectedUserId !== this.userId) return false;
          if (!identityMatches) {
            this.clearTokens();
            return false;
          }
          this.accessToken = data.access_token as string;
          this.sessionEnded = false;
          return true;
        }
        this.clearTokens();
        return false;
      } catch {
        // The server could not be reached, so it has not said the session is
        // over. Clearing the tokens here latched `sessionEnded`, and the
        // clinician who lost signal mid-shift was signed out the moment it
        // came back. Leave the session as it is and try again later.
        if (generation === this.sessionGeneration) {
          if (answered) this.clearTokens();
          else this.refreshUnreachable = true;
        }
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  /** Verify a rotated cookie still belongs to this tab's displayed account. */
  private async matchesRestoredIdentity(token: string, expectedUserId?: string): Promise<boolean> {
    if (!expectedUserId) return true;
    // Cookies are shared by same-origin portals. Another tab may have signed
    // in as someone else; validate with the server before installing its token.
    const response = await fetch(`${this.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin',
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!response.ok) return false;
    const identity = await response.json();
    return identity?.user_id === expectedUserId;
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | undefined {
    return this.userId;
  }

  /** Opaque local login revision for invalidating caches without exposing credentials. */
  getSessionRevision(): number {
    return this.sessionGeneration;
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
  private accessReasonHeaders(method: string, path: string, patientId?: string): Record<string, string> {
    if (method.toUpperCase() !== 'GET') return {};
    if (DIRECTORY_READ_PATHS.has(path.split('?')[0]) && this.directoryPurpose) {
      return { 'X-Access-Reason': this.directoryPurpose };
    }
    const context = this.patientAccessContext;
    if (!context) return {};
    // Match whole path segments only, so PAT-1 never matches PAT-10.
    const segments = path.split('?')[0].split('/').map(safeDecodeSegment);
    if (patientId ? patientId !== context.patientId : !segments.includes(context.patientId)) return {};
    return context.contextId
      ? { 'X-Access-Reason': context.reason, 'X-Access-Context': context.contextId }
      : { 'X-Access-Reason': context.reason };
  }

  private mutationListeners = new Set<(mutation: SucceededMutation) => void>();

  /**
   * Be told about every mutation the server accepted (2xx).
   *
   * The patient workspace uses this to list what was saved during a visit
   * without each of the 58 forms reporting it: whichever form is open when a
   * write succeeds is the form that wrote it. Returns an unsubscribe function.
   */
  onMutationSucceeded(listener: (mutation: SucceededMutation) => void): () => void {
    this.mutationListeners.add(listener);
    return () => {
      this.mutationListeners.delete(listener);
    };
  }

  private announceMutation(method: string, path: string, body?: unknown, response?: unknown): void {
    const mutation: SucceededMutation = { method: method.toUpperCase(), path: path.split('?')[0], body, response };
    this.mutationListeners.forEach((listener) => {
      try {
        listener(mutation);
      } catch {
        // A listener's failure must never turn a successful save into an error.
      }
    });
  }

  /**
   * The submission whose mutations are in flight, if one is (see
   * `withOperationScope`).
   */
  private operationScope?: { base: string; counts: Map<string, number> };

  /**
   * Run `send` so that every mutation it issues carries an idempotency key
   * derived from `base`: `<base>:<METHOD> <path>#<n>`, n counting per path.
   *
   * # Why
   *
   * Keys used to be fresh per request, so a double tap -- or Save pressed again
   * after a timeout that had in fact succeeded -- reached the server as two
   * different operations and wrote the record twice. A form now derives `base`
   * from the content it submits: the same content re-sent reuses the same keys
   * and the server answers `409 IDEMPOTENCY_DUPLICATE` instead of writing again
   * (end-to-end operation identifiers make a retry idempotent; Kleppmann,
   * *DDIA* p.566). Counting per path keeps the keys stable even if an unrelated
   * mutation elsewhere in the page interleaves with this submission.
   *
   * Scopes do not nest; a second concurrent scope replaces the first, which a
   * single form never does because it refuses to submit while saving.
   */
  async withOperationScope<T>(base: string, send: () => Promise<T>): Promise<T> {
    this.operationScope = { base, counts: new Map() };
    try {
      return await send();
    } finally {
      this.operationScope = undefined;
    }
  }

  private scopedOperationKey(method: string, path: string): string | undefined {
    const scope = this.operationScope;
    if (!scope) return undefined;
    const slot = `${method.toUpperCase()} ${path.split('?')[0]}`;
    const n = scope.counts.get(slot) ?? 0;
    scope.counts.set(slot, n + 1);
    // The server column is varchar(256); a long path must not push a key past it.
    return `${scope.base}:${n}:${slot}`.slice(0, 240);
  }

  private transactionAuthorizer: TransactionAuthorizer | null = null;

  /**
   * Where a Class C confirmation is asked for. `TransactionAuthorizationHost`
   * registers itself; with nothing registered a gated mutation fails with the
   * server's 428, as before.
   */
  setTransactionAuthorizer(authorizer: TransactionAuthorizer | null): void {
    this.transactionAuthorizer = authorizer;
  }

  /**
   * Turn a 428 TRANSACTION_AUTHORIZATION_REQUIRED into a verified authorization
   * for this exact request: the server's intent, the SHA-256 of the bytes this
   * client sends, and this request's idempotency key. `undefined` when the
   * person cancels or nothing can confirm.
   */
  private async obtainTransactionAuthorization(
    error: unknown,
    body: unknown,
    idempotencyKey: string | undefined,
  ): Promise<string | undefined> {
    if (!(error instanceof ApiClientError) || error.status !== 428) return undefined;
    if (error.code !== 'TRANSACTION_AUTHORIZATION_REQUIRED' || !this.transactionAuthorizer) return undefined;
    if (body instanceof ArrayBuffer) return undefined;
    const details = error.details ?? {};
    const text = (key: string) => (typeof details[key] === 'string' ? (details[key] as string) : undefined);
    const action = text('action');
    const method = text('method');
    const path = text('path');
    if (!action || !method || !path) return undefined;
    // Exactly the bytes `executeRequest` transmits.
    const payload = body ? JSON.stringify(body) : '';
    return this.transactionAuthorizer({
      action,
      method,
      path,
      body_digest: await sha256Hex(payload),
      resource_id: text('resource_id'),
      expected_state: text('expected_state'),
      idempotency_key: idempotencyKey,
    });
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
    const requestOwnerUserId = this.userId;
    const maxAttempts = options?.noRetry ? 1 : this.maxRetries + 1;
    const timeout = options?.timeout ?? this.timeout;
    // Generate once per logical mutation, outside the retry loop. Recreating a
    // key per attempt would turn a response-loss retry into a second write.
    // A caller-supplied key wins. `replayQueuedMutation` passes the queue
    // item's id, and overwriting it with a fresh one here would defeat the
    // server-side deduplication that makes replay safe at all.
    const callerKey = options?.headers?.['Idempotency-Key'];
    const idempotencyKey = isMutationMethod(method)
      ? (callerKey ?? this.scopedOperationKey(method, path) ?? createOperationKey())
      : undefined;
    const reasonHeaders = this.accessReasonHeaders(method, path, options?.patientId);
    let requestHeaders: Record<string, string> = idempotencyKey
      ? { ...reasonHeaders, ...options?.headers, 'Idempotency-Key': idempotencyKey }
      : { ...reasonHeaders, ...options?.headers };
    let lastError: Error | null = null;
    let confirmed = false;

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

        // A Class C demand: confirm once, then resend under the same key. The
        // confirmation is the person's answer, not a retry, so it costs no attempt.
        if (!confirmed && isMutationMethod(method)) {
          const authorization = await this.obtainTransactionAuthorization(error, body, idempotencyKey);
          if (authorization) {
            confirmed = true;
            requestHeaders = { ...requestHeaders, 'X-Transaction-Authorization': authorization };
            attempt -= 1;
            continue;
          }
        }

        // Determine if we should retry
        const shouldRetry = this.isRetryableError(error, method) && attempt < maxAttempts - 1;
        
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
            const offlineIntent = options?.noOfflineQueue
              ? undefined
              : (options?.queueWhenOffline ?? offlineIntentFor(this.offlineRoutes, method, path, body));
            if (isMutationMethod(method) && offlineIntent) {
              const queued = await queueOfflineMutation(
                method as 'POST' | 'PUT' | 'DELETE',
                path,
                body,
                offlineIntent,
                requestOwnerUserId,
                idempotencyKey,
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
      // A binary upload is sent as its bytes, not JSON-encoded.
      const binary = body instanceof ArrayBuffer ? body : null;
      const payload: BodyInit | undefined = binary ?? (body ? JSON.stringify(body) : undefined);
      // Build headers fresh each attempt so a refreshed Bearer token is picked up.
      const buildHeaders = async (): Promise<Record<string, string>> => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...extraHeaders,
        };

        // `getSessionHeaders()` is the single owner of the identity header.
        Object.assign(headers, this.getSessionHeaders());
        return headers;
      };

      const url = `${this.baseUrl}${path}`;
      debugLog('ApiClient', `${method} ${path}`);

      // Auth routes set and read the HttpOnly refresh cookie (WP12).
      const credentials: RequestCredentials = path.startsWith('/api/auth/') ? 'include' : 'same-origin';
      let response = await fetch(url, {
        method,
        headers: await buildHeaders(),
        body: payload,
        signal: controller.signal,
        credentials,
      });

      // JWT auto-refresh on 401 (Phase 9.4): refresh once and retry the request.
      if (
        response.status === 401 &&
        this.accessToken &&
        path !== '/api/auth/jwt/refresh' &&
        path !== '/api/auth/login'
      ) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          response = await fetch(url, {
            method,
            headers: await buildHeaders(),
            body: payload,
            signal: controller.signal,
            credentials,
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
        if (isMutationMethod(method)) this.announceMutation(method, path, body);
        return {} as T;
      }

      const data = await response.json();

      if (!response.ok) {
        const { message, code } = extractApiError(data, response.status);
        this.onError?.({ success: false, error: message, code });
        const details = (data as { error?: { details?: unknown } } | null)?.error?.details;
        throw new ApiClientError(
          message,
          code,
          response.status,
          details && typeof details === 'object' ? (details as Record<string, unknown>) : undefined,
        );
      }

      if (isMutationMethod(method)) this.announceMutation(method, path, body, data);

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
   * Check if an error is retryable.
   *
   * A mutation is retried only when its response was lost (a network error or
   * timeout). When the server answered with a 5xx it received the request,
   * and `middleware/idempotency.rs` keeps the key's claim for any 5xx because
   * the write may have partly committed -- so a retry under the same key can
   * only be refused as IDEMPOTENCY_DUPLICATE, and that refusal ("already
   * submitted") replaced the server's real answer even when nothing was saved.
   * Reads have no such guard and keep retrying a 5xx.
   */
  private isRetryableError(error: unknown, method: string): boolean {
    if (error instanceof ApiClientError) {
      const responseLost = error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT';
      return responseLost || (!isMutationMethod(method) && error.status >= 500);
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
    idempotencyKey: string,
    /** When the item was written; the server keeps it as the record's time. */
    recordedAt?: number,
  ): Promise<T> {
    const headers: Record<string, string> = { 'Idempotency-Key': idempotencyKey };
    if (recordedAt !== undefined) headers['X-Offline-Recorded-At'] = new Date(recordedAt).toISOString();
    return this.request<T>(method, path, body, {
      noRetry: true,
      noOfflineQueue: true,
      headers,
    });
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
  public readonly endpoint: string;

  constructor(queueItemId: string, endpoint: string) {
    // Plain words: this reaches a clinician, and a route path means nothing to them.
    super('No signal — saved on this device and sent when it reconnects.');
    this.endpoint = endpoint;
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
  intent: NonNullable<RequestOptions['queueWhenOffline']>,
  ownerUserId?: string,
  operationKey?: string,
): Promise<OfflineQueuedError | null> {
  try {
    const { enqueueSyncItem } = await import('../utils/indexedDB');
    const id = await enqueueSyncItem({
      ownerUserId,
      action: method === 'DELETE' ? 'delete' : 'update',
      endpoint: path,
      method,
      body,
      category: intent.category,
      description: intent.description,
      priority: 'medium',
      patientId: intent.patientId,
      ...(intent.expiresInMs ? { expiresAt: Date.now() + intent.expiresInMs } : {}),
    }, operationKey);
    debugLog('ApiClient', `Queued ${method} ${path} for replay as ${id}`);
    // Lets a portal's unsent counter update at once rather than on its next poll.
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('medichain:offline-queued'));
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
  /** The server's `error.details`, when it sent any. */
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
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
 */
export function getApiClient(): ApiClient {
  if (!defaultClient) {
    defaultClient = new ApiClient({ baseUrl: API_CONFIG.BASE_URL });
    debugLog('ApiClient', 'Auto-initialized with default config');
  }
  return defaultClient;
}
