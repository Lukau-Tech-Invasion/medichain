import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from './authStore';
import * as shared from '@medichain/shared';

// Mock shared library
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiUrl: (path: string) => `http://localhost:3000${path}`,
  setProviderAuth: vi.fn(),
  clearProviderAuth: vi.fn(),
  clearAuth: vi.fn(),
  getProviderAuth: vi.fn(),
  debugLog: vi.fn(),
  IS_DEVELOPMENT: true,
  checkApiHealth: vi.fn(),
  isValidWalletAddress: vi.fn(),
  syncApiClientUserId: vi.fn(),
}));

// Mock fetch
global.fetch = vi.fn();

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      isConnected: true,
    });
  });

  it('should initialize with default values', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  // These two used to assert the pre-fix contract: `login` fetched
  // `GET /api/auth/wallet/{address}` and, on any 200, entered an authenticated
  // state. Both parts were wrong. That route was removed on purpose because it
  // disclosed name, role, username and linked_patient_id for any address with no
  // authentication, and entering an authenticated state on the strength of a
  // lookup produced a session with no bearer token behind it. The tests passed
  // throughout, because they mocked the very fetch that was the defect -- which
  // is why the contract they now assert is the absence of a session, not the
  // presence of one.

  it('refuses to sign in a wallet it cannot prove control of', async () => {
    // No signature provider attached: there is no key, so no challenge can be
    // signed and no session can exist. A lookup would have "succeeded" here.
    (shared.isValidWalletAddress as any).mockReturnValue(true);

    const success = await useAuthStore.getState().login('5GvT8...mock');

    expect(success).toBe(false);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.error).toBeTruthy();
  });

  it('never enters an authenticated state without a session', async () => {
    (shared.isValidWalletAddress as any).mockReturnValue(true);
    // Even if something answered on the network, no signer means no token, and
    // no token must mean no authenticated state.
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ address: '5GvT8...mock', name: 'Dr. Test', role: 'Doctor' }),
    });

    await useAuthStore.getState().login('5GvT8...mock');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(shared.setProviderAuth).not.toHaveBeenCalled();
  });

  it('should logout and clear state', () => {
    useAuthStore.setState({
      user: {
        walletAddress: '5GvT8...mock',
        userId: '5GvT8...mock',
        username: 'Dr. Test',
        role: 'Doctor',
        createdAt: new Date().toISOString(),
      },
      isAuthenticated: true,
    });

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(shared.clearProviderAuth).toHaveBeenCalled();
  });

  it('does not restore a session after logout wins an in-flight validation race', async () => {
    let resolveValidation!: (value: unknown) => void;
    (shared.getProviderAuth as any).mockReturnValue({
      address: '5RaceWallet', role: 'Doctor', name: 'Dr. Race',
    });
    (global.fetch as any).mockReturnValue(new Promise(resolve => {
      resolveValidation = resolve;
    }));

    const restoring = useAuthStore.getState().restoreSession();
    (shared.getProviderAuth as any).mockReturnValue(null);
    useAuthStore.getState().logout();
    resolveValidation({ ok: true });

    expect(await restoring).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('should login with demo wallet in development', async () => {
    const mockDemoUser = {
      wallet_address: '5Demo...mock',
      name: 'Demo Doctor',
      role: 'Doctor',
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockDemoUser,
    });

    const success = await useAuthStore.getState().loginWithDemoWallet('Doctor');

    expect(success).toBe(true);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.role).toBe('Doctor');
    expect(state.user?.username).toBe('Demo Doctor');
  });
});
