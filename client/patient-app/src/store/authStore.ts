/**
 * Patient App Authentication Store
 * 
 * Wallet-based authentication for patient accounts.
 * Uses Substrate SS58 addresses and health IDs.
 * 
 * © 2025 Trustware. All rights reserved.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  apiUrl, 
  setPatientAuth, 
  clearAuth as clearStoredAuth,
  getPatientAuth,
  debugLog,
  IS_DEVELOPMENT,
  generateHealthId,
} from '@medichain/shared';

/**
 * Patient information (wallet-based)
 */
export interface Patient {
  /** Substrate wallet address (SS58 format, 48 chars starting with "5") */
  walletAddress: string;
  /** MediChain Health ID (MCHI-YYYY-XXXX-XXXX format) */
  healthId: string;
  /** Patient full name */
  fullName: string;
  /** First name for display */
  firstName: string;
  /** Blood type if known */
  bloodType?: string;
  /** Emergency contact */
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  /** Account creation timestamp */
  createdAt: string;
}

/**
 * Auth store state
 */
interface AuthState {
  patient: Patient | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  login: (walletAddress: string) => Promise<boolean>;
  loginWithDemoWallet: (name?: string) => Promise<boolean>;
  logout: () => void;
  setPatient: (patient: Patient) => void;
  clearError: () => void;
  restoreSession: () => void;
  updateProfile: (updates: Partial<Patient>) => void;
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
 * Patient auth store with persistence
 */
export const usePatientAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      patient: null,
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
          // Query the API/blockchain for patient account info
          const response = await fetch(apiUrl(`/api/auth/wallet/${walletAddress}`), {
            headers: { 'Accept': 'application/json' },
          });
          
          if (response.ok) {
            const accountData = await response.json();
            
            // Ensure it's a patient account
            if (accountData.role !== 'Patient') {
              throw new Error('Please use the Doctor Portal for provider accounts');
            }
            
            const patient: Patient = {
              walletAddress: accountData.address,
              healthId: accountData.healthId,
              fullName: accountData.name || `Patient`,
              firstName: accountData.firstName || accountData.name?.split(' ')[0] || 'Patient',
              bloodType: accountData.bloodType,
              emergencyContact: accountData.emergencyContact,
              createdAt: accountData.createdAt || new Date().toISOString(),
            };
            
            // Store auth data for API calls
            setPatientAuth({
              address: patient.walletAddress,
              healthId: patient.healthId,
              name: patient.fullName,
            });
            
            set({
              patient,
              isAuthenticated: true,
              isLoading: false,
              error: null,
            });
            
            debugLog('patientAuthStore', 'Logged in with wallet:', walletAddress);
            return true;
          }
          
          throw new Error('Wallet not registered or authentication failed');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Login failed';
          
          set({
            patient: null,
            isAuthenticated: false,
            isLoading: false,
            error: message,
          });
          
          return false;
        }
      },

      /**
       * Login with a demo wallet for development/testing
       * Creates a temporary wallet address with patient role
       */
      loginWithDemoWallet: async (name?: string) => {
        if (!IS_DEVELOPMENT) {
          set({ error: 'Demo wallets are only available in development mode' });
          return false;
        }
        
        set({ isLoading: true, error: null });

        try {
          const walletAddress = generateDemoAddress();
          const displayName = name || 'Demo Patient';
          const firstName = displayName.split(' ')[0];
          
          // Generate a health ID from the wallet address
          const healthId = await generateHealthId(walletAddress, 'demo-national-id');
          
          const patient: Patient = {
            walletAddress,
            healthId,
            fullName: displayName,
            firstName,
            bloodType: 'O+',
            emergencyContact: {
              name: 'Emergency Contact',
              phone: '+27 123 456 7890',
              relationship: 'Family',
            },
            createdAt: new Date().toISOString(),
          };
          
          // Store auth data
          setPatientAuth({
            address: patient.walletAddress,
            healthId: patient.healthId,
            name: patient.fullName,
          });
          
          set({
            patient,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
          
          debugLog('patientAuthStore', 'Created demo wallet:', { walletAddress, healthId });
          return true;
        } catch (error) {
          set({
            patient: null,
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
          patient: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
        debugLog('patientAuthStore', 'Logged out');
      },

      setPatient: (patient: Patient) => {
        setPatientAuth({
          address: patient.walletAddress,
          healthId: patient.healthId,
          name: patient.fullName,
        });
        set({
          patient,
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
        const storedAuth = getPatientAuth();
        if (storedAuth && !get().isAuthenticated) {
          // We only have limited data from storage, 
          // but enough to authenticate for API calls
          set({
            patient: {
              walletAddress: storedAuth.address,
              healthId: storedAuth.healthId,
              fullName: storedAuth.name,
              firstName: storedAuth.name.split(' ')[0],
              createdAt: new Date().toISOString(),
            },
            isAuthenticated: true,
          });
          debugLog('patientAuthStore', 'Restored session from storage');
        }
      },
      
      /**
       * Update patient profile
       */
      updateProfile: (updates: Partial<Patient>) => {
        const current = get().patient;
        if (current) {
          const updated = { ...current, ...updates };
          set({ patient: updated });
          
          // Update stored auth if name changed
          if (updates.fullName) {
            setPatientAuth({
              address: updated.walletAddress,
              healthId: updated.healthId,
              name: updated.fullName,
            });
          }
        }
      },
    }),
    {
      name: 'medichain-patient-auth',
      partialize: (state) => ({
        patient: state.patient,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

/**
 * Helper to get current patient ID (health ID) for API calls
 */
export function getPatientHealthId(): string | null {
  const store = usePatientAuthStore.getState();
  return store.patient?.healthId || null;
}

/**
 * Helper to check if patient is authenticated
 */
export function isPatientAuthenticated(): boolean {
  return usePatientAuthStore.getState().isAuthenticated;
}
