/**
 * MediChain Application Configuration
 * 
 * National health ID system configuration.
 * Sign-in is by employee ID or username and password; identity is `user_id` (UUID).
 * 
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

/**
 * Environment mode detection
 */
/**
 * Development mode.
 *
 * Defaults to **false**, not true. This gates `NFC_SIMULATION` and other
 * development-only controls, so the question it answers is "may this build
 * turn on a shortcut". A gate on that question has to fail closed.
 *
 * It previously read `?? true`, so any context where `import.meta.env` is
 * absent — a non-Vite bundler, SSR, a test harness, an embedded webview —
 * silently became a development build with the shortcuts switched on. Vite
 * defines `DEV` explicitly in a real dev server, so nothing about ordinary
 * development changes.
 */
export const IS_DEVELOPMENT = import.meta.env?.DEV ?? false;
export const IS_PRODUCTION = import.meta.env?.PROD ?? true;

/**
 * Presentation (demo) build.
 *
 * Only the literal string `'true'` switches it on; unset, empty, `'1'` or a
 * typo all read as off, so a production build that never mentions the variable
 * is never a demo build. It decides whether the sign-in page offers the seeded
 * demo accounts at all — the server still refuses to hand them out unless it
 * is itself a dev-mode demo deployment, so this can only ever hide the
 * shortcut, never create one.
 */
export const DEMO_MODE = (import.meta.env?.VITE_DEMO_MODE ?? 'false') === 'true';

/**
 * Detect the best API URL based on environment
 * Priority:
 * 1. Environment variable VITE_API_URL
 * 2. Same origin (for production/proxied setups)
 * 3. Development fallback with proper host detection
 */
function detectApiBaseUrl(): string {
  // 1. Check environment variable first
  if (import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  // 2. In production, use same origin (assumes proxy or same-origin API)
  if (IS_PRODUCTION && typeof window !== 'undefined') {
    return window.location.origin;
  }
  
  // 3. In development with Vite proxy, use relative paths
  // The Vite dev server proxies /api/* to the backend
  if (IS_DEVELOPMENT && typeof window !== 'undefined') {
    // When running in browser with Vite, use empty string to leverage proxy
    // This makes requests go to /api/* which Vite proxies to backend
    return '';
  }
  
  // 4. Fallback for non-browser environments (tests, SSR).
  // 8090, not 8080: the API's default port is 8090 because docker-compose
  // publishes the IPFS (kubo) gateway on 8080 (see api/src/main.rs). This
  // fallback pointed at the gateway, so any non-browser caller that reached
  // it talked to IPFS instead of the API.
  return 'http://127.0.0.1:8090';
}

/**
 * API Configuration
 */
export const API_CONFIG = {
  /** Base URL for API calls - auto-detected or from env */
  BASE_URL: detectApiBaseUrl(),
  
  /** Timeout for API requests in milliseconds */
  TIMEOUT: 30000,
  
  /** Number of retry attempts for failed requests */
  MAX_RETRIES: 3,
  
  /** Base delay for exponential backoff (ms) */
  RETRY_BASE_DELAY: 1000,
  
  /** Maximum delay between retries (ms) */
  RETRY_MAX_DELAY: 10000,
  
  /**
   * Health check endpoint.
   *
   * `/api/health`, not `/health`: a browser only ever reaches the API through
   * the one path prefix each deployment proxies — nginx has `location /api/`,
   * the Vite dev server proxies `/api`. `/health` exists on the API for
   * orchestration probes, but from a page it resolved to nginx's 404 and to the
   * dev server's own `index.html` (a 200, so "healthy" whatever the API was
   * doing). The API answers this path too; see `api_health_check`.
   */
  HEALTH_ENDPOINT: '/api/health',
};

/**
 * Feature flags for development and production
 */
export const FEATURES = {
  /**
   * Offer the labelled "Demo accounts" shortcut on the clinician sign-in page.
   * Off unless the build sets `VITE_DEMO_MODE=true`, including in `vite dev`:
   * a developer build is not automatically a presentation build.
   */
  QUICK_LOGIN: DEMO_MODE,

  /** Log debug information */
  DEBUG_LOGGING: IS_DEVELOPMENT,
  
  /** Enable NFC card simulation */
  NFC_SIMULATION: IS_DEVELOPMENT,
};

// ============================================================================
// STORAGE KEYS
// ============================================================================

export const STORAGE_KEYS = {
  /** Patient-specific display session (identity only; never a credential) */
  PATIENT_AUTH: 'medichain_patient_auth',
  /** Provider-specific display session (identity only; never a credential) */
  PROVIDER_AUTH: 'medichain_provider_auth',
} as const;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get full API URL from a path
 * Use this for all fetch calls to ensure correct base URL
 * @example apiUrl('/api/patients/list') => 'http://localhost:8080/api/patients/list'
 */
export const apiUrl = (path: string): string => {
  const base = API_CONFIG.BASE_URL;
  // Handle paths that already have the base URL
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
};

/**
 * Log debug information (only in development)
 */
export const debugLog = (context: string, ...args: unknown[]): void => {
  if (FEATURES.DEBUG_LOGGING) {
    console.log(`[MediChain:${context}]`, ...args);
  }
};

/** What the browser remembers about a signed-in patient (display only). */
export interface StoredPatientAuth {
  userId: string;
  healthId: string;
  name: string;
}

/** What the browser remembers about a signed-in staff member (display only). */
export interface StoredProviderAuth {
  userId: string;
  role: string;
  name: string;
}

function readStored<T>(key: string, isValid: (value: Record<string, unknown>) => boolean): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    return parsed && typeof parsed === 'object' && isValid(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/**
 * Get patient auth data from localStorage
 * Used by patient-app
 */
export const getPatientAuth = (): StoredPatientAuth | null =>
  readStored<StoredPatientAuth>(
    STORAGE_KEYS.PATIENT_AUTH,
    (v) => typeof v.userId === 'string' && v.userId.length > 0
  );

/**
 * Get provider auth data from localStorage
 * Used by doctor-portal
 */
export const getProviderAuth = (): StoredProviderAuth | null =>
  readStored<StoredProviderAuth>(
    STORAGE_KEYS.PROVIDER_AUTH,
    (v) => typeof v.userId === 'string' && v.userId.length > 0
  );

/**
 * Store patient auth data
 */
export const setPatientAuth = (data: StoredPatientAuth): void => {
  localStorage.setItem(STORAGE_KEYS.PATIENT_AUTH, JSON.stringify(data));
};

/**
 * Store provider auth data
 */
export const setProviderAuth = (data: StoredProviderAuth): void => {
  localStorage.setItem(STORAGE_KEYS.PROVIDER_AUTH, JSON.stringify(data));
};

/** Clear only the clinician session and preserve a patient portal session. */
export const clearProviderAuth = (): void => {
  localStorage.removeItem(STORAGE_KEYS.PROVIDER_AUTH);
};

/** Clear only the patient session and preserve a clinician portal session. */
export const clearPatientAuth = (): void => {
  localStorage.removeItem(STORAGE_KEYS.PATIENT_AUTH);
};

// ============================================================================
// CONNECTION HEALTH UTILITIES
// ============================================================================

/**
 * Check if the API server is reachable
 * @returns true if healthy, false otherwise
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(apiUrl(API_CONFIG.HEALTH_ENDPOINT), {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Sleep utility for retry delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * True when running under Vitest. Vitest sets `MODE=test`; the `process` check
 * covers the Node-side runner where `import.meta.env` is absent.
 */
const IS_TEST_RUNTIME: boolean =
  (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test') ||
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITEST === 'true';

/**
 * Calculate exponential backoff delay with jitter
 */
export function calculateBackoff(attempt: number): number {
  // Under test, back off in single-digit milliseconds.
  //
  // The production schedule is 1s, 2s, 4s -- about seven seconds of real
  // sleeping for a request that exhausts its retries. Vitest's default timeout
  // is five, so any test that reached the retry path was a coin flip decided by
  // machine load: it passed alone and failed intermittently in a parallel run
  // of 83 files, which reads as an unrelated flaky test rather than as the
  // retry policy doing exactly what it says.
  //
  // The retry *logic* still runs -- attempt counting, ordering, the give-up
  // condition -- only the waiting is removed, which is the part no test asserts.
  if (IS_TEST_RUNTIME) {
    return attempt + 1;
  }
  const delay = Math.min(
    API_CONFIG.RETRY_BASE_DELAY * Math.pow(2, attempt),
    API_CONFIG.RETRY_MAX_DELAY
  );
  // Add random jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}
