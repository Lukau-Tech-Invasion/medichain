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
 * Demo identities cannot mint JWTs because they do not control a wallet key.
 * A real wallet signs the login challenge before any bearer token is requested.
 */
async function acquireJwtTokens(
  walletAddress: string,
  sign?: (message: string) => Promise<string>
): Promise<void> {
  if (!sign) {
    debugLog('authStore', 'JWT not requested: this identity has no wallet signer');
    return;
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
    if (resp?.access_token) {
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
  } catch (e) {
    debugLog('authStore', 'Signed JWT acquisition failed:', e);
  }
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
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
            identityHydrated: false,
          });

          await acquireJwtTokens(user.walletAddress, (m) => signer.sign(m));
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
              identityHydrated: false,
            });

            // Acquire JWT tokens (demo path / unsigned; loginWithExtension upgrades with a signature).
            await acquireJwtTokens(user.walletAddress);
            void hydrateIdentity(set, get);
            initPush();

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
      restoreSession: async (): Promise<boolean> => {
        const storedAuth = getProviderAuth();
        
        if (!storedAuth) {
          return false; // No stored auth
        }

        // Each portal can be open in its own tab. The shared WALLET key tracks
        // only the most recently active portal, so bind this tab's singleton
        // explicitly to its provider session before any early return.
        getApiClient().setUserId(storedAuth.address);

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
            // Logout may have happened while the validation request was in
            // flight. Never let that stale response resurrect the session.
            if (getProviderAuth()?.address !== storedAuth.address) return false;
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
              identityHydrated: false,
            });
            // Re-acquire JWTs (tokens are not persisted to storage).
            await acquireJwtTokens(storedAuth.address);
            void hydrateIdentity(set, get);
            initPush();
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
            if (getProviderAuth()?.address !== storedAuth.address) return false;
            set({
              user: {
                walletAddress: demoUser.wallet_address || storedAuth.address,
                userId: demoUser.wallet_address || storedAuth.address,
                username: demoUser.name || storedAuth.name,
                role: (demoUser.role || storedAuth.role) as Role,
                createdAt: new Date().toISOString(),
              },
              isAuthenticated: true,
              identityHydrated: false,
            });
            // Re-acquire JWTs (tokens are not persisted to storage).
            await acquireJwtTokens(demoUser.wallet_address || storedAuth.address);
            void hydrateIdentity(set, get);
            initPush();
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
