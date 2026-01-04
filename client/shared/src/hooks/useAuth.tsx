/**
 * useAuth Hook
 * 
 * Manages authentication state for MediChain apps.
 * Uses X-User-Id header-based authentication (demo mode).
 */

import { useState, useCallback, useEffect, createContext, useContext, type ReactNode } from 'react';
import { getApiClient, initApiClient } from '../api/client';
import type { User, Role } from '../types';

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface AuthContextValue extends AuthState {
  login: (userId: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isHealthcareProvider: boolean;
  canEditRecords: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const HEALTHCARE_PROVIDER_ROLES: Role[] = ['Admin', 'Doctor', 'Nurse', 'LabTechnician', 'Pharmacist'];
const RECORD_EDITOR_ROLES: Role[] = ['Admin', 'Doctor', 'Nurse'];

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
    const savedUserId = localStorage.getItem('medichain_user_id');
    if (savedUserId) {
      // Re-authenticate with saved user
      loginInternal(savedUserId);
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [apiBaseUrl]);

  const loginInternal = async (userId: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const client = getApiClient();
      client.setUserId(userId);

      // Fetch users list and find our user
      const response = await fetch(`${apiBaseUrl}/api/users`, {
        headers: { 'X-User-Id': userId },
      });

      if (!response.ok) {
        // If not admin, try fetching demo info to at least verify connectivity
        const demoResponse = await fetch(`${apiBaseUrl}/api/demo`);
        if (!demoResponse.ok) {
          throw new Error('Failed to connect to API');
        }

        // Create a basic user object for non-admin users
        const user: User = {
          user_id: userId,
          username: userId.toLowerCase(),
          role: 'Patient',
          created_at: new Date().toISOString(),
        };

        localStorage.setItem('medichain_user_id', userId);
        setState({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
        return;
      }

      const users = await response.json() as User[];
      const user = users.find(u => u.user_id === userId);

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      localStorage.setItem('medichain_user_id', userId);
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: message,
      });
    }
  };

  const login = useCallback(async (userId: string) => {
    await loginInternal(userId);
  }, [apiBaseUrl]);

  const logout = useCallback(() => {
    localStorage.removeItem('medichain_user_id');
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
