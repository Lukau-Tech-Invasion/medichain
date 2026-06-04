/**
 * MediChain Application Configuration
 * 
 * Blockchain-based health ID system configuration.
 * All authentication is wallet-based using Substrate addresses.
 * 
 * © 2025 Trustware. All rights reserved.
 */

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

/**
 * Environment mode detection
 */
export const IS_DEVELOPMENT = import.meta.env?.DEV ?? true;
export const IS_PRODUCTION = import.meta.env?.PROD ?? false;

/**
 * Demo mode. When enabled, pages may fall back to bundled sample/demo data for
 * features that don't have real backend wiring yet. Driven by the
 * `VITE_DEMO_MODE` env var and defaults to **false**, so production builds never
 * surface fabricated data to clinicians or patients.
 */
export const IS_DEMO = (import.meta.env?.VITE_DEMO_MODE ?? 'false') === 'true';

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
  
  // 4. Fallback for non-browser environments (tests, SSR)
  return 'http://127.0.0.1:8080';
}

/**
 * Detect WebSocket URL for Substrate node
 */
function detectSubstrateWsUrl(): string {
  if (import.meta.env?.VITE_SUBSTRATE_WS) {
    return import.meta.env.VITE_SUBSTRATE_WS;
  }
  return 'ws://127.0.0.1:9944';
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
  
  /** WebSocket URL for Substrate node */
  SUBSTRATE_WS_URL: detectSubstrateWsUrl(),
  
  /** Health check endpoint */
  HEALTH_ENDPOINT: '/api/health',
};

/**
 * Feature flags for development and production
 */
export const FEATURES = {
  /** Enable wallet connection UI */
  WALLET_CONNECT: true,
  
  /** Allow demo wallet generation (for testing) */
  DEMO_WALLET_GENERATION: IS_DEVELOPMENT,
  
  /** Log debug information */
  DEBUG_LOGGING: IS_DEVELOPMENT,
  
  /** Use localStorage for wallet persistence */
  PERSIST_WALLET: true,
  
  /** Enable NFC card simulation */
  NFC_SIMULATION: IS_DEVELOPMENT,
};

// ============================================================================
// STORAGE KEYS
// ============================================================================

export const STORAGE_KEYS = {
  /** Current connected wallet */
  WALLET: 'medichain_wallet',
  /** All registered accounts */
  ACCOUNTS: 'medichain_accounts',
  /** Patient-specific auth data */
  PATIENT_AUTH: 'medichain_patient_auth',
  /** Provider-specific auth data */
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

/**
 * Get connected wallet address from localStorage
 * Returns null if no wallet is connected
 */
export const getConnectedWalletAddress = (): string | null => {
  try {
    const walletData = localStorage.getItem(STORAGE_KEYS.WALLET);
    if (!walletData) return null;
    const wallet = JSON.parse(walletData);
    return wallet.address || null;
  } catch {
    return null;
  }
};

/**
 * Get patient auth data from localStorage
 * Used by patient-app
 */
export const getPatientAuth = (): { address: string; healthId: string; name: string } | null => {
  try {
    const authData = localStorage.getItem(STORAGE_KEYS.PATIENT_AUTH);
    if (!authData) return null;
    return JSON.parse(authData);
  } catch {
    return null;
  }
};

/**
 * Get provider auth data from localStorage  
 * Used by doctor-portal
 */
export const getProviderAuth = (): { address: string; role: string; name: string } | null => {
  try {
    const authData = localStorage.getItem(STORAGE_KEYS.PROVIDER_AUTH);
    if (!authData) return null;
    return JSON.parse(authData);
  } catch {
    return null;
  }
};

/**
 * Store patient auth data
 */
export const setPatientAuth = (data: { address: string; healthId: string; name: string }): void => {
  localStorage.setItem(STORAGE_KEYS.PATIENT_AUTH, JSON.stringify(data));
  localStorage.setItem(STORAGE_KEYS.WALLET, JSON.stringify({ address: data.address, role: 'Patient' }));
};

/**
 * Store provider auth data
 */
export const setProviderAuth = (data: { address: string; role: string; name: string }): void => {
  localStorage.setItem(STORAGE_KEYS.PROVIDER_AUTH, JSON.stringify(data));
  localStorage.setItem(STORAGE_KEYS.WALLET, JSON.stringify({ address: data.address, role: data.role }));
};

/**
 * Clear all auth data (logout)
 */
export const clearAuth = (): void => {
  localStorage.removeItem(STORAGE_KEYS.WALLET);
  localStorage.removeItem(STORAGE_KEYS.PATIENT_AUTH);
  localStorage.removeItem(STORAGE_KEYS.PROVIDER_AUTH);
};

/**
 * Check if user is authenticated
 */
export const isAuthenticated = (): boolean => {
  return getConnectedWalletAddress() !== null;
};

// ============================================================================
// CONNECTION HEALTH UTILITIES
// ============================================================================

/**
 * Connection status types
 */
export type ConnectionStatus = 'connected' | 'disconnected' | 'checking' | 'error';

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
 * Validate SS58 wallet address format
 * MediChain uses Substrate addresses: 48 characters, starts with "5"
 */
export function isValidWalletAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }
  if (address.length !== 48) {
    debugLog('wallet', `Invalid address length: ${address.length}, expected 48`);
    return false;
  }
  if (!address.startsWith('5')) {
    debugLog('wallet', `Invalid address prefix: should start with "5"`);
    return false;
  }
  if (!/^[A-Za-z0-9]+$/.test(address)) {
    debugLog('wallet', 'Invalid address characters: must be alphanumeric');
    return false;
  }
  return true;
}

/**
 * Sleep utility for retry delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
export function calculateBackoff(attempt: number): number {
  const delay = Math.min(
    API_CONFIG.RETRY_BASE_DELAY * Math.pow(2, attempt),
    API_CONFIG.RETRY_MAX_DELAY
  );
  // Add random jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}
