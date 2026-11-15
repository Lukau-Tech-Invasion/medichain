/**
 * Patient App Authentication Store
 *
 * Username-and-password authentication for patient accounts. A patient's
 * account is created at registration and activated by them: they redeem the
 * one-time activation code the clinic gave them, choose a username and set
 * their own password (see `ActivatePage`). Nobody at the clinic ever sees it.
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
  getApiClient,
  initPushNotifications,
  getCurrentUser,
  signInWithPassword,
  activateWithCode,
  clearSessionMemory,
} from '@medichain/shared';
import type { SignedInUser, SignInOutcome } from '@medichain/shared';

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
 * Patient information
 */
export interface Patient {
  /** The account's id (UUID) */
  userId: string;
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
  /** The account has an authenticator; sign-in is waiting for its code (not an error). */
  mfaRequired: boolean;

  // Actions
  /**
   * Sign in with username and password. Resolves `true` when signed in,
   * `'mfa_required'` when the account has an authenticator and the same call
   * must be repeated with its code (`mfaRequired` is then set too), and `false`
   * on failure.
   */
  login: (username: string, password: string, totpCode?: string) => Promise<boolean | 'mfa_required'>;
  /**
   * Redeem the activation code from registration: choose a username and a
   * password, and sign in.
   */
  activate: (input: {
    identifier: string;
    code: string;
    username: string;
    password: string;
  }) => Promise<boolean>;
  logout: () => Promise<void>;
  setPatient: (patient: Patient) => void;
  clearError: () => void;
  restoreSession: () => Promise<boolean>;
  updateProfile: (updates: Partial<Patient>) => void;
}

/** A message a person can act on, from whatever a failed sign-in threw. */
function signInErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 'Username or password is not correct.';
    case 'ACCOUNT_LOCKED':
      return 'This account is temporarily locked after too many attempts. Try again later or ask your clinic.';
    case 'INVALID_GRANT':
      return 'That activation code is not valid, has expired, or was already used. Ask your clinic for a new one.';
    case 'GRANT_LOCKED':
      return 'That activation code was entered wrongly too many times. Ask your clinic for a new one.';
    case 'USERNAME_TAKEN':
    case 'LOGIN_ID_TAKEN':
      return 'That username is already taken. Choose another.';
    case 'INVALID_USERNAME':
      return 'That username is not allowed. Use letters, numbers and dots, at least three characters.';
    default:
      break;
  }
  if (error instanceof Error) {
    return error.message === 'Failed to fetch'
      ? 'Cannot reach the server. Check your connection and try again.'
      : error.message;
  }
  return 'Login failed';
}

/**
 * Patient auth store with persistence
 */
export const usePatientAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      /**
       * Everything a patient sign-in does after the server has issued a
       * session: the role check, the health-record link check and the session
       * write cannot drift apart between password sign-in and activation.
       */
      const finishSignIn = async (signedIn: SignedInUser): Promise<boolean> => {
        if (signedIn.role !== 'Patient') {
          throw new Error('Please use the Doctor Portal for provider accounts');
        }
        const account = await getCurrentUser();
        const patient: Patient = {
          userId: signedIn.user_id,
          healthId: account.linked_patient_id ?? signedIn.linked_patient_id ?? '',
          fullName: account.name || signedIn.name || 'Patient',
          firstName: (account.name || signedIn.name)?.split(' ')[0] || 'Patient',
          createdAt: account.created_at || new Date().toISOString(),
        };
        if (!patient.healthId) {
          throw new Error('This patient account is not linked to a health record');
        }
        setPatientAuth({ userId: patient.userId, healthId: patient.healthId, name: patient.fullName });
        set({ patient, isAuthenticated: true, isLoading: false, mfaRequired: false, error: null });
        initPush();
        debugLog('patientAuthStore', 'Sign-in completed');
        return true;
      };

      const settle = async (outcome: SignInOutcome): Promise<boolean | 'mfa_required'> => {
        if (outcome.status === 'mfa_required') {
          set({ patient: null, isAuthenticated: false, isLoading: false, mfaRequired: true, error: null });
          return 'mfa_required';
        }
        return finishSignIn(outcome.user);
      };

      const fail = (error: unknown): false => {
        // Undo anything the half-finished sign-in put on the shared client.
        getApiClient().clearTokens();
        clearSessionMemory();
        clearStoredAuth();
        set({
          patient: null,
          isAuthenticated: false,
          isLoading: false,
          mfaRequired: false,
          error: signInErrorMessage(error),
        });
        return false;
      };

      return {
        patient: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        mfaRequired: false,

        login: async (username, password, totpCode) => {
          set({ isLoading: true, error: null });
          try {
            return await settle(await signInWithPassword(username, password, totpCode));
          } catch (error) {
            return fail(error);
          }
        },

        activate: async ({ identifier, code, username, password }) => {
          set({ isLoading: true, error: null });
          try {
            // Redemption always yields a session or an error; never a code prompt.
            return (await settle(await activateWithCode({ identifier, code, username, password }))) === true;
          } catch (error) {
            return fail(error);
          }
        },

        logout: async () => {
          clearStoredAuth();
          // Finish server revocation before navigation can cancel the request.
          // `endSession` clears local tokens even if the network is unavailable.
          await getApiClient().endSession();
          clearSessionMemory();
          set({
            patient: null,
            isAuthenticated: false,
            isLoading: false,
            mfaRequired: false,
            error: null,
          });
          debugLog('patientAuthStore', 'Logged out');
        },

        setPatient: (patient: Patient) => {
          setPatientAuth({ userId: patient.userId, healthId: patient.healthId, name: patient.fullName });
          getApiClient().setUserId(patient.userId);
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
         * token behind it.
         *
         * @returns whether a verified session was restored.
         */
        restoreSession: async (): Promise<boolean> => {
          const storedAuth = getPatientAuth();
          if (!storedAuth) return false;
          // The API singleton needs the patient's id after a reload.
          getApiClient().setUserId(storedAuth.userId);
          if (get().isAuthenticated && getApiClient().getAccessToken()) return true;
          set({ isLoading: true });
          if (await getApiClient().restoreSession()) {
            // Logout or another sign-in may have won while refresh was pending.
            if (getPatientAuth()?.userId !== storedAuth.userId ||
                !getApiClient().getAccessToken()) return false;
            set({
              patient: get().patient ?? {
                userId: storedAuth.userId,
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
                userId: updated.userId,
                healthId: updated.healthId,
                name: updated.fullName,
              });
            }
          }
        },
      };
    },
    {
      name: 'medichain-patient-auth',
      version: 2, // 2: identity is `userId`; older persisted sessions used a retired identifier
      migrate: (persistedState, version) => {
        if (version < 2) return { patient: null, isAuthenticated: false };
        return persistedState as { patient: Patient | null; isAuthenticated: boolean };
      },
      partialize: (state) => ({
        patient: state.patient,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
