/**
 * useAuth Hook
 * 
 * Manages authentication state for MediChain apps.
 * Reads an already verified bearer session. Wallet proof belongs to the portal
 * login flow and this generic hook never performs anonymous wallet lookup.
 */

import { useState, useCallback, useEffect, createContext, useContext, type ReactNode } from 'react';
import { getApiClient, initApiClient } from '../api/client';
import { getCurrentUser } from '../api/endpoints';
import type { User, Role, WalletUserInfo } from '../types';

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface AuthContextValue extends AuthState {
  login: (walletAddress: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isHealthcareProvider: boolean;
  canEditRecords: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const HEALTHCARE_PROVIDER_ROLES: Role[] = ['Admin', 'Doctor', 'Nurse', 'LabTechnician', 'Pharmacist'];
const RECORD_EDITOR_ROLES: Role[] = ['Admin', 'Doctor', 'Nurse'];

/**
 * Convert WalletUserInfo to User format
 */
function walletUserToUser(walletUser: WalletUserInfo): User {
  return {
    wallet_address: walletUser.wallet_address,
    username: walletUser.username,
    name: walletUser.name,
    role: walletUser.role,
    created_at: walletUser.created_at ?? new Date().toISOString(),
    linked_patient_id: walletUser.linked_patient_id,
  };
}

export function AuthProvider({ 
  children, 
  apiBaseUrl 
}: { 
  children: ReactNode; 
  apiBaseUrl: string;
}) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });

  // Initialize API client
  useEffect(() => {
    initApiClient({
      baseUrl: apiBaseUrl,
      onError: (error) => {
        if (error.code === 'UNAUTHORIZED' || error.code === 'USER_NOT_FOUND') {
          setState(prev => ({ ...prev, user: null, isAuthenticated: false }));
        }
      },
    });

    // Check for saved session
    const savedWalletAddress = localStorage.getItem('medichain_wallet_address');
    if (savedWalletAddress) {
      // Re-authenticate with saved wallet
      loginInternal(savedWalletAddress);
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [apiBaseUrl]);

  const loginInternal = async (walletAddress: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    const client = getApiClient();

    try {
      client.setUserId(undefined);
      const user = walletUserToUser(await getCurrentUser());

      localStorage.setItem('medichain_wallet_address', walletAddress);
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      localStorage.removeItem('medichain_wallet_address');
      client.setUserId(undefined);
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: message,
      });
    }
  };

  const login = useCallback(async (walletAddress: string) => {
    await loginInternal(walletAddress);
  }, [apiBaseUrl]);

  const logout = useCallback(() => {
    localStorage.removeItem('medichain_wallet_address');
    getApiClient().setUserId(undefined);
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  }, []);

  const isAdmin = state.user?.role === 'Admin';
  const isHealthcareProvider = state.user ? HEALTHCARE_PROVIDER_ROLES.includes(state.user.role) : false;
  const canEditRecords = state.user ? RECORD_EDITOR_ROLES.includes(state.user.role) : false;

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    isAdmin,
    isHealthcareProvider,
    canEditRecords,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
