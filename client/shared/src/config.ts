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
 * API Configuration
 */
export const API_CONFIG = {
  /** Base URL for API calls */
  BASE_URL: import.meta.env?.VITE_API_URL ?? 'http://localhost:8080',
  
  /** Timeout for API requests in milliseconds */
  TIMEOUT: 30000,
  
  /** WebSocket URL for Substrate node */
  SUBSTRATE_WS_URL: import.meta.env?.VITE_SUBSTRATE_WS ?? 'ws://localhost:9944',
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
