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
  signInWithPassword: vi.fn(),
  activateWithCode: vi.fn(),
  enterWorkContext: vi.fn(),
  getCurrentUser: vi.fn(),
}));

// Mock fetch
global.fetch = vi.fn();

const DOCTOR = {
  user_id: '3f9b1c1e-6f0e-4c53-9b7e-0d7f6f5a1a11',
  name: 'Dr. Test',
  role: 'Doctor' as const,
};

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.enterWorkContext).mockResolvedValue({ access_token: 'work-token' } as never);
    vi.mocked(shared.getCurrentUser).mockRejectedValue(new Error('not needed here'));
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      isConnected: true,
      mfaRequired: false,
    });
  });

  it('should initialize with default values', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('signs in with an Employee ID and password and remembers who, never a secret', async () => {
    vi.mocked(shared.signInWithPassword).mockResolvedValue({ status: 'signed_in', user: DOCTOR });

    const success = await useAuthStore.getState().loginWithCredentials('EMP-001', 'a long password');

    expect(success).toBe(true);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toMatchObject({ userId: DOCTOR.user_id, username: 'Dr. Test', role: 'Doctor' });
    expect(shared.signInWithPassword).toHaveBeenCalledWith('EMP-001', 'a long password', undefined);
    expect(shared.setProviderAuth).toHaveBeenCalledWith({
      userId: DOCTOR.user_id,
      role: 'Doctor',
      name: 'Dr. Test',
    });
  });

  it('asks for the authenticator code instead of failing, then signs in with it', async () => {
    vi.mocked(shared.signInWithPassword)
      .mockResolvedValueOnce({ status: 'mfa_required' })
      .mockResolvedValueOnce({ status: 'signed_in', user: DOCTOR });

    expect(await useAuthStore.getState().loginWithCredentials('EMP-001', 'pw')).toBe('mfa_required');
    expect(useAuthStore.getState().mfaRequired).toBe(true);
    expect(useAuthStore.getState().error).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    expect(await useAuthStore.getState().loginWithCredentials('EMP-001', 'pw', '123456')).toBe(true);
    expect(shared.signInWithPassword).toHaveBeenLastCalledWith('EMP-001', 'pw', '123456');
    expect(useAuthStore.getState().mfaRequired).toBe(false);
  });

  it('never enters an authenticated state when sign-in fails', async () => {
    vi.mocked(shared.signInWithPassword).mockRejectedValue(
      Object.assign(new Error('bad'), { code: 'INVALID_CREDENTIALS' })
    );

    const success = await useAuthStore.getState().loginWithCredentials('EMP-001', 'wrong');

    expect(success).toBe(false);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.error).toMatch(/not correct/i);
    expect(shared.setProviderAuth).not.toHaveBeenCalled();
  });

  it('sends a patient account to the patient app and keeps no session', async () => {
    vi.mocked(shared.signInWithPassword).mockResolvedValue({
      status: 'signed_in',
      user: { ...DOCTOR, role: 'Patient' },
    });

    const success = await useAuthStore.getState().loginWithCredentials('someone', 'pw');

    expect(success).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().error).toMatch(/Patient App/);
    expect(shared.setProviderAuth).not.toHaveBeenCalled();
  });

  it('activates with a credential code and signs the person in', async () => {
    vi.mocked(shared.activateWithCode).mockResolvedValue({ status: 'signed_in', user: DOCTOR });

    const success = await useAuthStore.getState().activateWithCredentialCode({
      identifier: 'EMP-001',
      code: 'ABCD-EFGH-JKMN',
      password: 'a long password',
    });

    expect(success).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('should logout and clear state', () => {
    useAuthStore.setState({
      user: {
        userId: 'user-1',
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
    let resolveValidation!: (value: Response) => void;
    vi.mocked(shared.getProviderAuth).mockReturnValue({
      userId: 'race-user', role: 'Doctor', name: 'Dr. Race',
    });
    vi.mocked(global.fetch).mockReturnValue(new Promise(resolve => {
      resolveValidation = resolve;
    }));

    const restoring = useAuthStore.getState().restoreSession();
    vi.mocked(shared.getProviderAuth).mockReturnValue(null);
    useAuthStore.getState().logout();
    resolveValidation({ ok: true } as unknown as Response);

    expect(await restoring).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });
});
