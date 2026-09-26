/**
 * Patient App Authentication Store
 * 
 * Wallet-based authentication for patient accounts.
 * Uses Substrate SS58 addresses and health IDs.
 * 
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  setPatientAuth,
  clearPatientAuth as clearStoredAuth,
  getPatientAuth,
  debugLog,
  syncApiClientUserId,
  getApiClient,
  initPushNotifications,
  getCurrentUser,
  requestWalletChallenge,
  issueJwt,
  signMessage,
  secretFromMnemonic,
  signerFromSecret,
} from '@medichain/shared';

/**
 * Request push-notification permission and register the device token
 * (Phase 5.2). Non-fatal and silently a no-op without a configured Firebase
 * project — see `push.ts` for the full explanation.
 */
function initPush(): void {
  void initPushNotifications().catch((e) => {
    debugLog('patientAuthStore', 'Push notification init failed:', e);
  });
}

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
  /**
   * Sign in with the twelve-word recovery phrase issued at registration.
   *
   * The extension path assumes a patient has installed Polkadot.js and
   * imported their key. A patient handed twelve words at a clinic reception
   * desk has done neither, and had no way in at all -- the only other control
   * on the sign-in screen mints a DIFFERENT, unregistered identity.
   */
  loginWithRecoveryPhrase: (mnemonic: string) => Promise<boolean>;
  logout: () => void;
  setPatient: (patient: Patient) => void;
  clearError: () => void;
  restoreSession: () => Promise<boolean>;
  updateProfile: (updates: Partial<Patient>) => void;
}

/**
 * Patient auth store with persistence
 */

/**
 * Everything a patient sign-in does after a signature exists.
 *
 * The two paths differ only in WHERE the signature comes from: a browser
 * extension, or a key derived in this tab from the recovery phrase. Sharing
 * the rest means the JWT exchange, the role check, the health-id check and
 * the session write cannot drift apart between them.
 */
async function completeLogin(
  set: (partial: Partial<AuthState>) => void,
  walletAddress: string,
  sign: (message: string) => Promise<string>
): Promise<boolean> {
  set({ isLoading: true, error: null });

  set({ isLoading: true, error: null });

  try {
    const challenge = await requestWalletChallenge(walletAddress);
    const signature = await sign(challenge.challenge.message);
    const tokens = await issueJwt({
      wallet_address: walletAddress,
      challenge_id: challenge.challenge.challenge_id,
      nonce: challenge.challenge.nonce,
      signature,
    });
    getApiClient().setTokens(tokens.access_token, tokens.refresh_token);
    const accountData = await getCurrentUser();

    if (accountData.role !== 'Patient') {
      throw new Error('Please use the Doctor Portal for provider accounts');
    }

    const patient: Patient = {
      walletAddress: accountData.wallet_address,
      healthId: accountData.linked_patient_id ?? '',
      fullName: accountData.name || 'Patient',
      firstName: accountData.name?.split(' ')[0] || 'Patient',
      createdAt: accountData.created_at || new Date().toISOString(),
    };
    if (!patient.healthId) {
      throw new Error('This patient account is not linked to a health record');
    }
      
    // Store auth data for API calls
    setPatientAuth({
      address: patient.walletAddress,
      healthId: patient.healthId,
      name: patient.fullName,
    });
      
    // The legacy header remains only for demo compatibility. Production
    // identity comes from the bearer token issued above.
    syncApiClientUserId();
      
    set({
      patient,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });

    initPush();

    debugLog('patientAuthStore', 'Wallet authentication completed');
    return true;
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
}

export const usePatientAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      patient: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      /**
       * Login with a wallet address
       * Proves wallet ownership, then obtains the caller's own identity from
       * the authenticated API. It deliberately never performs anonymous
       * wallet discovery.
       */
      login: async (walletAddress: string) => {
        // The extension signs. Everything after the signature is identical
        // for both sign-in paths, so it lives in `completeLogin`.
        return completeLogin(set, walletAddress, (message) =>
          signMessage(walletAddress, message)
        );
      },

      loginWithRecoveryPhrase: async (mnemonic: string) => {
        set({ isLoading: true, error: null });
        try {
          // Derived in this browser; the phrase is never sent anywhere. The
          // address comes out of the phrase, so a typo produces a wallet the
          // server does not know rather than someone else's account.
          const secret = await secretFromMnemonic(mnemonic);
          const signer = await signerFromSecret(secret);
          return await completeLogin(set, signer.address, (message) =>
            signer.sign(message)
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'That recovery phrase did not work';
          set({ patient: null, isAuthenticated: false, isLoading: false, error: message });
          return false;
        }
      },

      logout: () => {
        clearStoredAuth();
        // Revoke the session server-side too; `endSession` clears the local
        // tokens whether or not the request reaches the API.
        void getApiClient().endSession();
        syncApiClientUserId();
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
        // Sync API client with new userId
        syncApiClientUserId();
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
       * Re-establish a session after a page reload (WP12).
       *
       * The access token lives only in memory. The refresh token is an
       * HttpOnly, Secure, SameSite=Strict cookie the browser presents to the
       * refresh endpoint. Only a session the server accepts is restored; this
       * used to mark the patient signed in from localStorage alone, with no
       * token behind it, so requests fell back to the weakest identity the API
       * accepts.
       *
       * @returns whether a verified session was restored.
       */
      restoreSession: async (): Promise<boolean> => {
        const storedAuth = getPatientAuth();
        if (!storedAuth) return false;
        // The API singleton needs the patient's wallet after a reload.
        getApiClient().setUserId(storedAuth.address);
        if (get().isAuthenticated && getApiClient().getAccessToken()) return true;
        set({ isLoading: true });
        if (await getApiClient().restoreSession()) {
          set({
            patient: get().patient ?? {
              walletAddress: storedAuth.address,
              healthId: storedAuth.healthId,
              fullName: storedAuth.name,
              firstName: storedAuth.name.split(' ')[0],
              createdAt: new Date().toISOString(),
            },
            isAuthenticated: true,
            isLoading: false,
          });
          initPush();
          debugLog('patientAuthStore', 'Session restored from the refresh cookie');
          return true;
        }
        clearStoredAuth();
        getApiClient().clearTokens();
        set({ patient: null, isAuthenticated: false, isLoading: false });
        return false;
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

