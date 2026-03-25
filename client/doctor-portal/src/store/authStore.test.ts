import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from './authStore';
import * as shared from '@medichain/shared';

// Mock shared library
vi.mock('@medichain/shared', () => ({
  apiUrl: (path: string) => `http://localhost:3000${path}`,
  setProviderAuth: vi.fn(),
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

  it('should login successfully with valid wallet', async () => {
    const mockUser = {
      address: '5GvT8...mock',
      name: 'Dr. Test',
      role: 'Doctor',
      createdAt: new Date().toISOString(),
    };

    (shared.isValidWalletAddress as any).mockReturnValue(true);
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockUser,
    });

    const success = await useAuthStore.getState().login('5GvT8...mock');

    expect(success).toBe(true);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.walletAddress).toBe(mockUser.address);
    expect(state.user?.role).toBe('Doctor');
    expect(shared.setProviderAuth).toHaveBeenCalled();
  });

  it('should fail login with invalid wallet format', async () => {
    (shared.isValidWalletAddress as any).mockReturnValue(false);

    const success = await useAuthStore.getState().login('invalid');

    expect(success).toBe(false);
    expect(useAuthStore.getState().error).toContain('Invalid wallet address format');
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
    expect(shared.clearAuth).toHaveBeenCalled();
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
