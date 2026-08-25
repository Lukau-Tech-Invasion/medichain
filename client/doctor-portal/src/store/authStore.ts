import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  apiUrl, 
  setProviderAuth, 
  clearProviderAuth as clearStoredAuth,
  getProviderAuth,
  debugLog,
  IS_DEVELOPMENT,
  checkApiHealth,
  isValidWalletAddress,
  syncApiClientUserId,
  getApiClient,
  getApiErrorMessage,
  issueJwt,
  requestWalletChallenge,
  enterWorkContext,
  initPushNotifications,
  getCurrentUser,
  staffLogin,
  deriveCredential,
  openKeystore,
  signerFromSecret,
  wipe
} from '@medichain/shared';
import type { UserPermissions } from '@medichain/shared';
import { connectRealWallet, signMessage } from '@medichain/shared';
import type { Role as WalletRole } from '@medichain/shared';

/**
 * User roles matching the blockchain pallet
 */
export type Role = 'Admin' | 'Doctor' | 'Nurse' | 'LabTechnician' | 'Pharmacist' | 'Patient';

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
   * helpers below, which keep a second copy of the role hierarchy that can
   * drift from the server's.
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
   * Whether the professional attributes on `user` have been loaded from
   * `/api/auth/me`. False means "not known yet", which is distinct from a
   * clinician genuinely having no department — screens must not conflate them.
   */
  identityHydrated: boolean;

  // Actions
  login: (walletAddress: string) => Promise<boolean>;
  loginWithCredentials: (identifier: string, password: string) => Promise<boolean>;
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
 * Acquire JWT access + refresh tokens after a successful wallet login (Phase 9.4).
 *
 * Returns whether a verified session was established. **The caller must not
 * enter an authenticated state unless this returns true.**
 *
 * It used to return `void` and swallow every failure, including the case where
 * no signer was supplied at all. Callers then set `isAuthenticated: true`
 * regardless, producing a session with no bearer token that fell back to the
 * caller-controlled `X-User-Id` header -- a fail-open path that looked like a
 * successful login. Identity must come from a verified server result, so the
 * absence of a token is now an authentication failure rather than a quiet
 * downgrade.
 *
 * `POST /api/auth/jwt` verifies a real sr25519 signature over a single-use
 * server challenge in every mode, demo included, so an identity that controls
 * no key cannot obtain a session by any route.
 */
async function acquireJwtTokens(
  walletAddress: string,
  sign?: (message: string) => Promise<string>
): Promise<boolean> {
  if (!sign) {
    debugLog('authStore', 'JWT unavailable: this identity has no wallet signer');
    return false;
  }
  try {
    const challenge = await requestWalletChallenge(walletAddress);
    const signature = await sign(challenge.challenge.message);
    const resp = await issueJwt({
      wallet_address: walletAddress,
      challenge_id: challenge.challenge.challenge_id,
      nonce: challenge.challenge.nonce,
      signature,
    });
    if (!resp?.access_token) {
      debugLog('authStore', 'JWT endpoint returned no access token');
      return false;
    }
    {
      getApiClient().setTokens(resp.access_token, resp.refresh_token);
      // Phase 1: professional screens run with a work-context token. If the
      // backend is still completing legacy identity migration, retain the
      // verified legacy JWT rather than breaking an existing login.
      try {
        const context = await enterWorkContext();
        getApiClient().setTokens(context.access_token);
      } catch (contextError) {
        debugLog('authStore', 'Work context unavailable; using legacy JWT:', contextError);
      }
      debugLog('authStore', `JWT acquired (mfa_required=${resp.mfa_required})`);
    }
    return true;
  } catch (e) {
    debugLog('authStore', 'Signed JWT acquisition failed:', e);
    return false;
  }
}

/**
 * Abandon a half-built sign-in.
 *
 * Anything that established credentials on the shared client before the session
 * turned out to be invalid has to be undone, or the next request would carry
 * them. Kept next to `acquireJwtTokens` so the two are read together.
 */
function abandonSignIn(): void {
  getApiClient().setSignatureProvider(null);
  getApiClient().clearTokens();
  clearStoredAuth();
  syncApiClientUserId();
}

/**
 * Load the signed-in user's full identity from `GET /api/auth/me` and merge it
 * into the store.
 *
 * Why this exists: before it, the store held only wallet/name/role, so any
 * screen needing the clinician's department, specialty, licence — or their own
 * provider id — either went without or made the clinician type it. The
 * appointment scheduler asking a logged-in doctor for their own 48-character
 * "Provider ID" was the visible symptom (see `docs/WORKFLOW_AUDIT.md`, RC-1).
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
    if (!current || current.walletAddress !== me.wallet_address) {
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
       * Sign in with an employee identifier and password — the normal way in.
       *
       * The clinician never sees or types a wallet address. What happens:
       *
       *   1. the password is stretched locally and split into an auth proof
       *      and a keystore secret (`deriveCredential`); the password itself
       *      never leaves the browser
       *   2. the proof is exchanged for the account's *encrypted* keystore
       *   3. the keystore is opened locally, yielding a real sr25519 key
       *   4. that key signs the ordinary auth challenge for a JWT, and stays
       *      attached as the request signer
       *
       * So this is not a weaker path than the extension — it ends in the same
       * place, holding the same kind of key, signing the same challenge. Only
       * step 1-3 are new.
       */
      loginWithCredentials: async (identifier: string, password: string) => {
        set({ isLoading: true, error: null });

        let derived: Awaited<ReturnType<typeof deriveCredential>> | null = null;
        let opened: Awaited<ReturnType<typeof openKeystore>> | null = null;
        try {
          derived = await deriveCredential(password, identifier);
          const resp = await staffLogin({
            identifier: identifier.trim(),
            auth_proof: derived.authProof,
          });

          opened = await openKeystore(resp.encrypted_keystore, derived.keystoreKey);

          // The address travels with the secret: a v2 keystore may hold a
          // 64-byte secret key (an account from a derivation path), and
          // recovering its public half needs the address the keystore recorded.
          const signer = await signerFromSecret(opened.miniSecret, opened.address);
          if (signer.address !== resp.wallet_address) {
            // The keystore opened but unlocks a different account than the one
            // the server named. Never continue past that: it means the stored
            // blob and the account row disagree.
            throw new Error(
              'Your stored key does not match this account. Ask an administrator to re-enrol you.'
            );
          }
          if (resp.role === 'Patient') {
            throw new Error('Please use the Patient App for patient accounts');
          }

          // Attach the signer before anything else: from here on every request
          // this client makes is signature-bound, exactly as with the extension.
          getApiClient().setSignatureProvider((message) => signer.sign(message));

          const user: User = {
            walletAddress: resp.wallet_address,
            userId: resp.wallet_address,
            username: resp.name,
            role: resp.role as Role,
            createdAt: new Date().toISOString(),
          };
          setProviderAuth({ address: user.walletAddress, role: user.role, name: user.username });
          syncApiClientUserId();

          // The session must exist before the UI believes in it. Setting
          // authenticated first and fetching a token afterwards left a window --
          // and, when the token never arrived, a permanent state -- in which the
          // app was "signed in" with no bearer token and every request fell back
          // to the legacy identity header.
          const established = await acquireJwtTokens(user.walletAddress, (m) => signer.sign(m));
          if (!established) {
            abandonSignIn();
            set({
              user: null,
              isAuthenticated: false,
              isLoading: false,
              error: 'Could not establish a secure session. Please try again.',
            });
            return false;
          }

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
            identityHydrated: false,
          });
          void hydrateIdentity(set, get);
          initPush();
          debugLog('authStore', 'Signed in with credentials');
          return true;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Sign-in failed';
          set({ user: null, isAuthenticated: false, isLoading: false, error: message });
          return false;
        } finally {
          // Key material lives no longer than it must. The signer keeps its own
          // copy of the pair; these buffers are the raw secret and are done with.
          wipe(derived?.keystoreKey, opened?.miniSecret);
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

          const ok = await get().login(walletAddress);
          if (ok) {
            // Upgrade to a signature-backed JWT (valid even with REQUIRE_SIGNATURES=true).
            await acquireJwtTokens(walletAddress, (message) => signMessage(walletAddress, message));
            // Re-hydrate now that requests can be signed: the attempt inside
            // `login` runs before the signer is attached, so with
            // REQUIRE_SIGNATURES=true it is rejected. This one succeeds.
            void hydrateIdentity(set, get);
            initPush();
          }
          return ok;
        } catch (error) {
          set({ 
            isLoading: false, 
            error: error instanceof Error ? error.message : 'Extension login failed' 
          });
          return false;
        }
      },
      /**
       * Sign in with a wallet the caller can already sign for.
       *
       * The signer must be attached to the shared client before this is called
       * (the extension flow does that); `login` proves control of the key rather
       * than looking the wallet up first.
       *
       * It previously began with `GET /api/auth/wallet/{address}` to fetch the
       * account's name and role before authenticating. That route was removed on
       * purpose -- it returned name, role, username and linked_patient_id for any
       * address with no authentication, which is identity enumeration and a
       * wallet-to-patient link. Two callers were never migrated, so every wallet
       * sign-in 404ed and reported "Wallet not registered" for accounts that were
       * registered. Identity now comes from the verified session instead, which
       * is both correct and one fewer round trip: authentication proves who you
       * are, it does not ask first.
       */
      login: async (walletAddress: string) => {
        if (!walletAddress) {
          set({ error: 'A wallet address is required', isLoading: false });
          return false;
        }

        set({ isLoading: true, error: null });

        const signer = getApiClient().getSignatureProvider();
        if (!signer) {
          // No key, no session. `POST /api/auth/jwt` verifies a real signature
          // over a single-use challenge in every mode, so there is no path here
          // that ends in a usable session.
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: 'This account cannot sign in here. Use your employee ID and password.',
          });
          return false;
        }

        try {
          const established = await acquireJwtTokens(walletAddress, signer);
          if (!established) {
            abandonSignIn();
            set({
              user: null,
              isAuthenticated: false,
              isLoading: false,
              error: 'Wallet authentication failed. Check the account is registered and active.',
            });
            return false;
          }

          // Identity from the authenticated principal, not from a pre-login
          // lookup of an address the caller supplied.
          const me = await getCurrentUser();
          if (me.role === 'Patient') {
            abandonSignIn();
            set({
              user: null,
              isAuthenticated: false,
              isLoading: false,
              error: 'Please use the Patient App for patient accounts',
            });
            return false;
          }

          const user: User = {
            walletAddress: me.wallet_address,
            userId: me.wallet_address,
            username: me.name || `Provider-${walletAddress.substring(0, 8)}`,
            role: me.role as Role,
            createdAt: new Date().toISOString(),
            department: me.department,
            specialty: me.specialty,
            licenseNumber: me.license_number,
            email: me.email,
            permissions: me.permissions,
          };

          setProviderAuth({
            address: user.walletAddress,
            role: user.role,
            name: user.username,
          });
          syncApiClientUserId();
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
            identityHydrated: true,
          });
          initPush();
          debugLog('authStore', 'Signed in with wallet:', walletAddress);
          return true;
        } catch (error) {
          abandonSignIn();
          let message = 'Login failed';
          if (error instanceof Error) {
            message =
              error.message === 'Failed to fetch'
                ? 'Cannot reach the server. Check your connection and try again.'
                : error.message;
          }
          set({ user: null, isAuthenticated: false, isLoading: false, error: message });
          return false;
        }
      },

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
            throw new Error(getApiErrorMessage(errorData, 'Failed to create demo user'));
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
            identityHydrated: false,
          });

          // Demo wallets cannot sign; rely on demo-mode (unsigned) JWT issuance.
          await acquireJwtTokens(user.walletAddress);
          void hydrateIdentity(set, get);
          initPush();

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
        // Revoke the session server-side as well. Local state is cleared
        // immediately either way, so the UI never waits on the network to sign
        // someone out, but the session must not survive on the server.
        void getApiClient().endSession();
        // Clear every credential held by the singleton client. Keeping the
        // signature provider after logout allowed a later request to continue
        // signing as the clinician whose UI session had ended.
        getApiClient().setSignatureProvider(null);
        syncApiClientUserId();
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
          identityHydrated: false,
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
      /**
       * Re-establish a session after a page reload.
       *
       * **Fails closed.** Nothing that can authenticate survives a reload: the
       * access and refresh tokens are deliberately not persisted, and the key
       * that could sign a fresh challenge lives only in memory. So there is no
       * material here to rebuild a verified session from, and the honest outcome
       * is to send the user back to sign-in.
       *
       * What it used to do was worse than failing. It called the removed
       * `GET /api/auth/wallet/{address}` route, and on the strength of that
       * response set `isAuthenticated: true` -- then called `acquireJwtTokens`
       * with no signer, which could never succeed. The result was a session the
       * UI treated as valid, holding no bearer token, whose every request fell
       * back to the caller-controlled `X-User-Id` header. A reload silently
       * downgraded a signed-in clinician to the weakest identity the API accepts.
       *
       * Restoring without re-authenticating needs durable session material the
       * browser can present -- a persisted refresh token, or a cookie-borne
       * session. Both are security design decisions with their own trade-offs
       * (storage exposure versus CSRF surface) and neither is implemented, so
       * this returns false rather than inventing one. Recorded for the owner in
       * the remediation ledger.
       */
      restoreSession: async (): Promise<boolean> => {
        const storedAuth = getProviderAuth();

        if (!storedAuth) {
          return false;
        }

        // Each portal can be open in its own tab. The shared WALLET key tracks
        // only the most recently active portal, so bind this tab's singleton
        // explicitly to its provider session before any early return.
        getApiClient().setUserId(storedAuth.address);

        if (get().isAuthenticated && getApiClient().getAccessToken()) {
          // A live session in this tab, with a token behind it.
          return true;
        }

        debugLog(
          'authStore',
          'No session material survives a reload; returning to sign-in'
        );
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
