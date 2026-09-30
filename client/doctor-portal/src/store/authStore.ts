import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  setProviderAuth,
  clearProviderAuth as clearStoredAuth,
  getProviderAuth,
  debugLog,
  checkApiHealth,
  getApiClient,
  enterWorkContext,
  initPushNotifications,
  getCurrentUser,
  signInWithPassword,
  activateWithCode,
  clearSessionMemory,
} from '@medichain/shared';
import type { UserPermissions, SignedInUser, SignInOutcome } from '@medichain/shared';

/**
 * User roles, as the server defines them
 */
export type Role = 'Admin' | 'Doctor' | 'Nurse' | 'LabTechnician' | 'Pharmacist' | 'Paramedic' | 'Patient';

/**
 * The signed-in clinician's identity.
 *
 * Everything a screen might otherwise ask them to type belongs here. The
 * professional attributes below are hydrated from `GET /api/auth/me` after
 * login — see `hydrateIdentity`. They are optional because that call can fail
 * (offline, server restarted) without invalidating an otherwise good session;
 * consumers should use `useCurrentProvider`, which reports hydration state
 * rather than letting a screen silently treat "not loaded yet" as "absent".
 */
export interface User {
  /** The account's id (UUID): the only identifier of a user, and what records name */
  userId: string;
  /** Display name */
  username: string;
  /** User role from the server */
  role: Role;
  /** Account creation timestamp */
  createdAt: string;
  /** Ward/unit the clinician works in, e.g. "Emergency" */
  department?: string;
  /** Clinical specialty, for doctors */
  specialty?: string;
  /** Professional registration number */
  licenseNumber?: string;
  /** Work email */
  email?: string;
  /**
   * What the server says this role may do.
   *
   * Rendering hints only — the API authorizes every request independently.
   * Prefer these over the local `isHealthcareProvider`/`canEditMedicalRecords`
   * helpers, which keep a second copy of the role hierarchy that can drift from
   * the server's.
   */
  permissions?: UserPermissions;
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
  /**
   * The account has an authenticator enrolled and the sign-in is waiting for its
   * code. The sign-in page shows the code field while this is set; it is not an
   * error and `error` stays empty.
   */
  mfaRequired: boolean;
  /**
   * Whether the professional attributes on `user` have been loaded from
   * `/api/auth/me`. False means "not known yet", which is distinct from a
   * clinician genuinely having no department — screens must not conflate them.
   */
  identityHydrated: boolean;

  // Actions
  /**
   * Sign in with an Employee ID and password. Resolves `true` when signed in,
   * `'mfa_required'` when the account has an authenticator and the same call
   * must be repeated with its code (`mfaRequired` is then set too), and `false`
   * on failure.
   */
  loginWithCredentials: (
    identifier: string,
    password: string,
    totpCode?: string
  ) => Promise<boolean | 'mfa_required'>;
  /** Redeem a one-time credential code from an administrator, choosing a password. */
  activateWithCredentialCode: (input: {
    identifier: string;
    code: string;
    password: string;
  }) => Promise<boolean>;
  logout: () => void;
  setUser: (user: User) => void;
  clearError: () => void;
  restoreSession: () => Promise<boolean>;
  checkConnection: () => Promise<boolean>;
}

/**
 * Abandon a half-built sign-in.
 *
 * Anything that established credentials on the shared client before the session
 * turned out to be unusable has to be undone, or the next request would carry
 * them.
 */
function abandonSignIn(): void {
  getApiClient().clearTokens();
  clearSessionMemory();
  clearStoredAuth();
}

/**
 * Load the signed-in user's full identity from `GET /api/auth/me` and merge it
 * into the store.
 *
 * Why this exists: before it, the store held only id/name/role, so any screen
 * needing the clinician's department, specialty, licence — or their own
 * provider id — either went without or made the clinician type it. The
 * appointment scheduler asking a logged-in doctor for their own "Provider ID"
 * was the visible symptom (see `docs/WORKFLOW_AUDIT.md`, RC-1).
 *
 * Deliberately non-fatal **and non-blocking**. A session that has already
 * authenticated stays valid if this call fails; the user simply keeps the
 * attributes they logged in with and `useCurrentProvider` reports
 * `isHydrated: false`. Failing the login here would turn a transient network
 * blip into a lockout, and awaiting it would put the API client's retry
 * backoff (four attempts, ~7s) directly in front of the user reaching the
 * dashboard. Every call site therefore fires it with `void`.
 */
async function hydrateIdentity(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState
): Promise<void> {
  try {
    const me = await getCurrentUser();
    const current = get().user;
    if (!current || current.userId !== me.user_id) {
      // The session changed underneath this request (logout, or a second
      // login raced it). Discard rather than resurrect a stale identity.
      return;
    }
    set({
      user: {
        ...current,
        username: me.name || current.username,
        role: (me.role as Role) || current.role,
        department: me.department,
        specialty: me.specialty,
        licenseNumber: me.license_number,
        email: me.email,
        permissions: me.permissions,
      },
      identityHydrated: true,
    });
    debugLog('authStore', 'Identity hydrated from /api/auth/me');
  } catch (e) {
    debugLog('authStore', 'Identity hydration failed; session retained:', e);
  }
}

/**
 * Request push-notification permission and register the device token
 * (Phase 5.2). Non-fatal and silently a no-op without a configured Firebase
 * project — see `push.ts` in `@medichain/shared` for the full explanation.
 */
function initPush(): void {
  void initPushNotifications().catch((e) => {
    debugLog('authStore', 'Push notification init failed:', e);
  });
}

/** A message a person can act on, from whatever a failed sign-in threw. */
function signInErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'INVALID_CREDENTIALS') return 'Employee ID or password is not correct.';
  if (code === 'ACCOUNT_LOCKED') {
    return 'This account is temporarily locked after too many attempts. Try again later or ask an administrator.';
  }
  if (error instanceof Error) {
    return error.message === 'Failed to fetch'
      ? 'Cannot reach the server. Check your connection and try again.'
      : error.message;
  }
  return 'Sign-in failed';
}

/**
 * Auth store with persistence
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      /**
       * Everything a sign-in does after the server has issued a session.
       *
       * Shared by password sign-in and code redemption so the role check, the
       * work-context exchange and the session write cannot drift apart.
       */
      const finishSignIn = async (signedIn: SignedInUser): Promise<boolean> => {
        if (signedIn.role === 'Patient') {
          abandonSignIn();
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            mfaRequired: false,
            error: 'Please use the Patient App for patient accounts',
          });
          return false;
        }

        // Professional screens run with a work-context token. If the backend
        // cannot issue one, keep the verified login token rather than breaking
        // an otherwise good sign-in.
        try {
          const context = await enterWorkContext();
          getApiClient().setTokens(context.access_token);
        } catch (contextError) {
          debugLog('authStore', 'Work context unavailable; using login token:', contextError);
        }

        const user: User = {
          userId: signedIn.user_id,
          username: signedIn.name,
          role: signedIn.role as Role,
          createdAt: new Date().toISOString(),
        };
        setProviderAuth({ userId: user.userId, role: user.role, name: user.username });
        set({
          user,
          isAuthenticated: true,
          isLoading: false,
          mfaRequired: false,
          error: null,
          identityHydrated: false,
        });
        void hydrateIdentity(set, get);
        initPush();
        debugLog('authStore', 'Signed in');
        return true;
      };

      /** Turn a sign-in outcome into store state; true only for a real session. */
      const settle = async (outcome: SignInOutcome): Promise<boolean | 'mfa_required'> => {
        if (outcome.status === 'mfa_required') {
          set({ user: null, isAuthenticated: false, isLoading: false, mfaRequired: true, error: null });
          return 'mfa_required';
        }
        return finishSignIn(outcome.user);
      };

      const fail = (error: unknown): false => {
        abandonSignIn();
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          mfaRequired: false,
          error: signInErrorMessage(error),
        });
        return false;
      };

      return {
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        isConnected: true,
        mfaRequired: false,
        identityHydrated: false,

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
         * Sign in with an Employee ID and password — the only way in.
         *
         * The password is stretched locally into a proof and only the proof is
         * sent (`deriveAuthProof`). The session must exist before the UI
         * believes in it: a response without a token is a failed sign-in, never
         * a quiet downgrade to an unauthenticated "signed in" state.
         */
        loginWithCredentials: async (identifier, password, totpCode) => {
          set({ isLoading: true, error: null });
          try {
            return await settle(await signInWithPassword(identifier, password, totpCode));
          } catch (error) {
            return fail(error);
          }
        },

        activateWithCredentialCode: async ({ identifier, code, password }) => {
          set({ isLoading: true, error: null });
          try {
            // Redemption always yields a session or an error; never a code prompt.
            return (await settle(await activateWithCode({ identifier, code, password }))) === true;
          } catch (error) {
            return fail(error);
          }
        },

        logout: () => {
          clearStoredAuth();
          // Revoke the session server-side as well. Local state is cleared
          // immediately either way, so the UI never waits on the network to sign
          // someone out, but the session must not survive on the server.
          void getApiClient().endSession();
          clearSessionMemory();
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            mfaRequired: false,
            error: null,
            identityHydrated: false,
          });
          debugLog('authStore', 'Logged out');
        },

        setUser: (user: User) => {
          setProviderAuth({ userId: user.userId, role: user.role, name: user.username });
          getApiClient().setUserId(user.userId);
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
         * Re-establish a session after a page reload (WP12).
         *
         * The access token lives only in memory and is gone after a reload. The
         * refresh token is an HttpOnly, Secure, SameSite=Strict cookie the
         * browser presents to the refresh endpoint; if the server accepts it (it
         * rotates it, and ends the whole login if an old one is replayed), the
         * session continues. Otherwise this fails closed: back to sign-in, never
         * a session without a verified token.
         */
        restoreSession: async (): Promise<boolean> => {
          const storedAuth = getProviderAuth();

          if (!storedAuth) {
            return false;
          }

          // Each portal can be open in its own tab; bind this tab's singleton
          // to its own provider session before any early return.
          getApiClient().setUserId(storedAuth.userId);

          if (get().isAuthenticated && getApiClient().getAccessToken()) {
            // A live session in this tab, with a token behind it.
            return true;
          }

          if (await getApiClient().restoreSession()) {
            const restoredToken = getApiClient().getAccessToken();
            // A reload leaves the login token; re-enter the work context the
            // professional screens run under, as sign-in does.
            try {
              const context = await enterWorkContext();
              if (getProviderAuth()?.userId !== storedAuth.userId ||
                  getApiClient().getAccessToken() !== restoredToken) return false;
              getApiClient().setTokens(context.access_token);
            } catch (contextError) {
              debugLog('authStore', 'Work context unavailable after restore:', contextError);
            }
            if (getProviderAuth()?.userId !== storedAuth.userId ||
                !getApiClient().getAccessToken()) return false;
            const user: User = get().user ?? {
              userId: storedAuth.userId,
              username: storedAuth.name,
              role: storedAuth.role as Role,
              createdAt: new Date().toISOString(),
            };
            set({ user, isAuthenticated: true, isLoading: false, error: null });
            void hydrateIdentity(set, get);
            return true;
          }

          debugLog('authStore', 'No session to restore; returning to sign-in');
          abandonSignIn();
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
            identityHydrated: false,
          });
          return false;
        },
      };
    },
    {
      name: 'medichain-provider-auth',
      version: 4, // 4: identity is `userId`; older persisted sessions used a retired identifier
      migrate: (persistedState, version) => {
        // Sessions written by earlier builds identified the person by an
        // identifier the server no longer recognises: start from sign-in.
        if (version < 4) {
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
