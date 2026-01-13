import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  apiUrl, 
  setProviderAuth, 
  clearAuth as clearStoredAuth,
  getProviderAuth,
  debugLog,
  IS_DEVELOPMENT
} from '@medichain/shared';
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
  
  // Actions
  login: (walletAddress: string) => Promise<boolean>;
  loginWithDemoWallet: (role: Role, name?: string) => Promise<boolean>;
  logout: () => void;
  setUser: (user: User) => void;
  clearError: () => void;
  restoreSession: () => void;
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

      /**
       * Login with a wallet address
       * Validates the wallet against the blockchain/API
       */
      login: async (walletAddress: string) => {
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
          const message = error instanceof Error ? error.message : 'Login failed';
          
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: message,
          });
          
          return false;
        }
      },

      /**
       * Login with a demo wallet for development/testing
       * Creates a temporary wallet address with the specified role
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
          
          const user: User = {
            walletAddress,
            userId: walletAddress,
            username: displayName,
            role,
            createdAt: new Date().toISOString(),
          };
          
          // Store auth data
          setProviderAuth({
            address: user.walletAddress,
            role: user.role,
            name: user.username,
          });
          
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
          
          debugLog('authStore', 'Created demo wallet:', { walletAddress, role });
          return true;
        } catch (error) {
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
       */
      restoreSession: () => {
        const storedAuth = getProviderAuth();
        if (storedAuth && !get().isAuthenticated) {
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
          debugLog('authStore', 'Restored session from storage');
        }
      },
    }),
    {
      name: 'medichain-provider-auth',
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
