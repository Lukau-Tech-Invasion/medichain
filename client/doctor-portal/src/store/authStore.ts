import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  apiUrl, 
  setProviderAuth, 
  clearAuth as clearStoredAuth,
  getProviderAuth,
  debugLog,
  IS_DEVELOPMENT,
  checkApiHealth,
  isValidWalletAddress,
  syncApiClientUserId,
  getApiClient
} from '@medichain/shared';
import { connectRealWallet, signMessage } from '@medichain/shared/src/wallet/service';
import type { Role as WalletRole } from '@medichain/shared';

/**
 * User roles matching the blockchain pallet
 */
export type Role = 'Admin' | 'Doctor' | 'Nurse' | 'LabTechnician' | 'Pharmacist' | 'Patient';

/**
 * User information (wallet-based)
 */
export interface User {
  /** Substrate wallet address (SS58 format, 48 chars starting with "5") */
  walletAddress: string;
  /** User ID for API calls (same as walletAddress for providers) */
  userId: string;
  /** Display name */
  username: string;
  /** User role from blockchain */
  role: Role;
  /** Account creation timestamp */
  createdAt: string;
}

/**
 * Auth store state
 */
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  
  // Actions
  login: (walletAddress: string) => Promise<boolean>;
  loginWithExtension: () => Promise<boolean>;
  loginWithDemoWallet: (role: Role, name?: string) => Promise<boolean>;
  logout: () => void;
  setUser: (user: User) => void;
  clearError: () => void;
  restoreSession: () => Promise<boolean>;
  checkConnection: () => Promise<boolean>;
}

/**
 * Generate a demo wallet address for testing
 * Format: 5 + 47 random alphanumeric chars
 */
function generateDemoAddress(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  let address = '5';
  for (let i = 0; i < 47; i++) {
    address += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return address;
}

/**
 * Auth store with persistence
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      isConnected: true,

      /**
       * Check API connection status
       */
      checkConnection: async () => {
        try {
          const healthy = await checkApiHealth();
          set({ isConnected: healthy });
          return healthy;
        } catch {
          set({ isConnected: false });
          return false;
        }
      },

      /**
       * Login using Polkadot extension
       */
      loginWithExtension: async () => {
        set({ isLoading: true, error: null });
        try {
          const accounts = await connectRealWallet();
          if (accounts.length === 0) {
            throw new Error('No accounts found in Polkadot extension');
          }

          const walletAddress = accounts[0].address;
          
          // Set signature provider in ApiClient
          const apiClient = getApiClient();
          apiClient.setSignatureProvider((message) => signMessage(walletAddress, message));
          
          return await get().login(walletAddress);
        } catch (error) {
          set({ 
            isLoading: false, 
            error: error instanceof Error ? error.message : 'Extension login failed' 
          });
          return false;
        }
      },
      login: async (walletAddress: string) => {
        // Validate wallet address format
        if (!isValidWalletAddress(walletAddress)) {
          set({ error: 'Invalid wallet address format. Must be 48 characters starting with "5".' });
          return false;
        }

        set({ isLoading: true, error: null });

        try {
          // Query the API/blockchain for wallet account info
          const response = await fetch(apiUrl(`/api/auth/wallet/${walletAddress}`), {
            headers: { 'Accept': 'application/json' },
          });
          
          if (response.ok) {
            const accountData = await response.json();
            
            // Ensure it's a provider account (not patient)
            if (accountData.role === 'Patient') {
              throw new Error('Please use the Patient App for patient accounts');
            }
            
            const user: User = {
              walletAddress: accountData.address,
              userId: accountData.address,
              username: accountData.name || `Provider-${walletAddress.substring(0, 8)}`,
              role: accountData.role as Role,
              createdAt: accountData.createdAt || new Date().toISOString(),
            };
            
            // Store auth data for API calls
            setProviderAuth({
              address: user.walletAddress,
              role: user.role,
              name: user.username,
            });
            
            // Sync API client with new userId
            syncApiClientUserId();
            
            set({
              user,
              isAuthenticated: true,
              isLoading: false,
              error: null,
            });
            
            debugLog('authStore', 'Logged in with wallet:', walletAddress);
            return true;
          }
          
          throw new Error('Wallet not registered or authentication failed');
        } catch (error) {
          let message = 'Login failed';
          let isConnectionError = false;

          if (error instanceof Error) {
            // Check for network/connection errors
            if (error.message === 'Failed to fetch' || 
                error.name === 'TypeError' ||
                error.message.includes('NetworkError') ||
                error.message.includes('network')) {
              message = 'Unable to connect to server. Please check if the API server is running.';
              isConnectionError = true;
            } else if (error.message.includes('timeout') || error.name === 'AbortError') {
              message = 'Connection timed out. Please check your network.';
              isConnectionError = true;
            } else {
              message = error.message;
            }
          }
          
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: message,
            isConnected: !isConnectionError,
          });
          
          return false;
        }
      },

      /**
       * Login with a demo wallet for development/testing
       * Creates a temporary wallet address with the specified role
       * and registers it with the backend API
       */
      loginWithDemoWallet: async (role: Role, name?: string) => {
        if (!IS_DEVELOPMENT) {
          set({ error: 'Demo wallets are only available in development mode' });
          return false;
        }
        
        set({ isLoading: true, error: null });

        try {
          const walletAddress = generateDemoAddress();
          const displayName = name || `Demo ${role}`;
          
          // Register demo user with backend API
          const response = await fetch(apiUrl('/api/auth/demo-login'), {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({
              wallet_address: walletAddress,
              role: role,
              name: displayName,
            }),
          });
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to create demo user');
          }
          
          const demoUser = await response.json();
          
          const user: User = {
            walletAddress: demoUser.wallet_address || walletAddress,
            userId: demoUser.wallet_address || walletAddress,
            username: demoUser.name || displayName,
            role: demoUser.role as Role || role,
            createdAt: new Date().toISOString(),
          };
          
          // Store auth data for subsequent API calls
          setProviderAuth({
            address: user.walletAddress,
            role: user.role,
            name: user.username,
          });
          
          // Sync API client with new userId
          syncApiClientUserId();
          
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
          
          debugLog('authStore', 'Created and registered demo wallet:', { walletAddress: user.walletAddress, role: user.role });
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to create demo wallet';
          debugLog('authStore', 'Demo login failed:', message);
          
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: 'Failed to create demo wallet',
          });
          return false;
        }
      },

      logout: () => {
        clearStoredAuth();
        // Clear API client userId
        syncApiClientUserId();
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
        debugLog('authStore', 'Logged out');
      },

      setUser: (user: User) => {
        setProviderAuth({
          address: user.walletAddress,
          role: user.role,
          name: user.username,
        });
        // Sync API client with new userId
        syncApiClientUserId();
        set({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      },

      clearError: () => {
        set({ error: null });
      },
      
      /**
       * Restore session from localStorage on app startup
       * Validates the session against the API and re-registers if needed
       * @returns true if session was restored successfully, false otherwise
       */
      restoreSession: async (): Promise<boolean> => {
        const storedAuth = getProviderAuth();
        
        if (!storedAuth) {
          return false; // No stored auth
        }
        
        if (get().isAuthenticated) {
          return true; // Already authenticated
        }
        
        debugLog('authStore', 'Restoring session from storage...');
        
        // Try to validate the session with the API by checking if user exists
        try {
          const response = await fetch(apiUrl(`/api/auth/wallet/${storedAuth.address}`), {
            headers: { 'Accept': 'application/json' },
          });
          
          if (response.ok) {
            // User exists in API, restore session
            set({
              user: {
                walletAddress: storedAuth.address,
                userId: storedAuth.address,
                username: storedAuth.name,
                role: storedAuth.role as Role,
                createdAt: new Date().toISOString(),
              },
              isAuthenticated: true,
            });
            debugLog('authStore', 'Session validated and restored');
            return true;
          }
        } catch {
          debugLog('authStore', 'API not reachable during session restore');
        }
        
        // User doesn't exist in API (server restarted) - try to re-register as demo user
        debugLog('authStore', 'Session invalid, attempting re-registration...');
        try {
          const response = await fetch(apiUrl('/api/auth/demo-login'), {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({
              wallet_address: storedAuth.address,
              role: storedAuth.role,
              name: storedAuth.name,
            }),
          });
          
          if (response.ok) {
            const demoUser = await response.json();
            set({
              user: {
                walletAddress: demoUser.wallet_address || storedAuth.address,
                userId: demoUser.wallet_address || storedAuth.address,
                username: demoUser.name || storedAuth.name,
                role: (demoUser.role || storedAuth.role) as Role,
                createdAt: new Date().toISOString(),
              },
              isAuthenticated: true,
            });
            debugLog('authStore', 'Session re-registered successfully');
            return true;
          }
        } catch {
          debugLog('authStore', 'Failed to re-register session');
        }
        
        // Could not restore or re-register, clear the session
        debugLog('authStore', 'Clearing invalid session');
        clearStoredAuth();
        set({
          user: null,
          isAuthenticated: false,
          error: null,
        });
        return false;
      },
    }),
    {
      name: 'medichain-provider-auth',
      version: 3, // Increment to clear old demo wallet data
      migrate: (persistedState, version) => {
        // Clear old auth state from v1/v2 that had "Demo Doctor" etc
        if (version < 3) {
          console.log('[authStore] Migrating from old version - clearing old demo auth');
          return {
            user: null,
            isAuthenticated: false,
          };
        }
        return persistedState as { user: User | null; isAuthenticated: boolean };
      },
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);


/**
 * Helper to check if user has healthcare provider role
 */
export function isHealthcareProvider(role: Role): boolean {
  return ['Admin', 'Doctor', 'Nurse', 'LabTechnician', 'Pharmacist'].includes(role);
}

/**
 * Helper to check if user can edit medical records
 */
export function canEditMedicalRecords(role: Role): boolean {
  return ['Admin', 'Doctor', 'Nurse'].includes(role);
}

/**
 * Helper to check if user is admin
 */
export function isAdmin(role: Role): boolean {
  return role === 'Admin';
}
