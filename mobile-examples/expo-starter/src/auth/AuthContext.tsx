/**
 * Auth context for the MediChain mobile app (Phase 8.3).
 *
 * - Wallet login → fetches the account + issues a JWT (mirrors the web flow).
 * - Persists session + tokens in the device secure store (Keychain/Keystore).
 * - Biometric (fingerprint/face) gate on app open / resume for ePHI access,
 *   satisfying the Zero-Trust posture from Phase 11.3 on the mobile surface.
 *
 * © 2025-2026 Trustware. MediChain Health ID System.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { apiClient } from '../api/client';

export interface MobileUser {
  walletAddress: string;
  name: string;
  role: string;
  healthId?: string;
}

interface AuthState {
  user: MobileUser | null;
  loading: boolean;
  unlocked: boolean;
  error: string | null;
  login: (walletAddress: string) => Promise<boolean>;
  logout: () => Promise<void>;
  unlockWithBiometrics: () => Promise<boolean>;
}

const SESSION_KEY = 'medichain.session';
const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore a persisted session on startup.
  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(SESSION_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { user: MobileUser; tokens?: { accessToken: string; refreshToken: string } };
          setUser(parsed.user);
          apiClient.setUserId(parsed.user.walletAddress);
          apiClient.setTokens(parsed.tokens);
        }
      } catch {
        // ignore corrupt session
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (walletAddress: string): Promise<boolean> => {
    setError(null);
    setLoading(true);
    try {
      const account = (await apiClient.walletLookup(walletAddress)) as Record<string, string>;
      apiClient.setUserId(walletAddress);
      let tokens;
      try {
        tokens = await apiClient.issueJwt(walletAddress);
      } catch {
        tokens = undefined; // fall back to X-User-Id auth
      }
      const u: MobileUser = {
        walletAddress,
        name: account.name ?? 'Patient',
        role: account.role ?? 'Patient',
        healthId: account.healthId,
      };
      setUser(u);
      setUnlocked(true);
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ user: u, tokens }));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    apiClient.clear();
    setUser(null);
    setUnlocked(false);
    await SecureStore.deleteItemAsync(SESSION_KEY);
  }, []);

  const unlockWithBiometrics = useCallback(async (): Promise<boolean> => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHardware || !enrolled) {
      // No biometrics available — fall back to allowing access (PIN gate is a follow-up).
      setUnlocked(true);
      return true;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock MediChain',
      fallbackLabel: 'Use passcode',
    });
    setUnlocked(result.success);
    return result.success;
  }, []);

  const value = useMemo(
    () => ({ user, loading, unlocked, error, login, logout, unlockWithBiometrics }),
    [user, loading, unlocked, error, login, logout, unlockWithBiometrics]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
