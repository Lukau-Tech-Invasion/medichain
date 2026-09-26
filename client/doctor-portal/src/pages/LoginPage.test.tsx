import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { useAuthStore } from '../store';

/**
 * The demo-build flag and the demo-credential resolver, controllable per test.
 * `FEATURES` keeps every real flag; only `QUICK_LOGIN` reads from here, through
 * a getter so each test can flip it after the module is loaded.
 */
const demo = vi.hoisted(() => ({
  quickLogin: false,
  getDemoCredentials: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return {
    ...actual,
    getDemoCredentials: demo.getDemoCredentials,
    FEATURES: {
      ...actual.FEATURES,
      get QUICK_LOGIN() {
        return demo.quickLogin;
      },
    },
  };
});

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

/**
 * These tests were rewritten when the wallet-address box was replaced by
 * employee-identifier sign-in. They previously asserted that the page asked for
 * a "Wallet Address" and offered "Connect Wallet" — the exact behaviour the
 * audit found unusable (docs/WORKFLOW_AUDIT.md, WF-002), so the assertions had
 * to invert rather than be relaxed.
 */
describe('LoginPage', () => {
  const mockLogin = vi.fn();
  const mockLoginWithCredentials = vi.fn();
  const mockLoginWithExtension = vi.fn();
  const mockClearError = vi.fn();

  function mockStore(overrides: Record<string, unknown> = {}) {
    vi.mocked(useAuthStore).mockReturnValue({
      login: mockLogin,
      loginWithCredentials: mockLoginWithCredentials,
      loginWithExtension: mockLoginWithExtension,
      isLoading: false,
      error: null,
      clearError: mockClearError,
      ...overrides,
    });
  }

  function renderPage() {
    return render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    demo.quickLogin = false;
    demo.getDemoCredentials.mockResolvedValue({ success: true, credentials: [] });
    mockStore();
  });

  it('asks for an employee identifier and password', () => {
    renderPage();

    expect(screen.getByLabelText(/Employee ID or work email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sign in$/i })).toBeInTheDocument();
  });

  /**
   * The point of the whole change: a clinician must never be asked for an SS58
   * address to sign in. If this ever fails, the defect has come back.
   */
  it('does not ask for a wallet address anywhere on the sign-in form', () => {
    renderPage();

    expect(screen.queryByLabelText(/Wallet Address/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Wallet/i })).not.toBeInTheDocument();
  });

  it('signs in with the identifier and password, then goes to the dashboard', async () => {
    mockLoginWithCredentials.mockResolvedValue(true);
    renderPage();

    fireEvent.change(screen.getByLabelText(/Employee ID or work email/i), {
      target: { value: 'dr.mbeki' },
    });
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: 'a-real-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));

    await waitFor(() => {
      expect(mockLoginWithCredentials).toHaveBeenCalledWith('dr.mbeki', 'a-real-password');
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('clears the password field after a failed attempt and stays put', async () => {
    mockLoginWithCredentials.mockResolvedValue(false);
    renderPage();

    fireEvent.change(screen.getByLabelText(/Employee ID or work email/i), {
      target: { value: 'dr.mbeki' },
    });
    const password = screen.getByLabelText(/^Password$/i) as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));

    await waitFor(() => {
      expect(password.value).toBe('');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('surfaces a sign-in error as an alert', () => {
    mockStore({ error: 'That identifier and password combination was not recognised' });
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(/was not recognised/i);
  });

  it('disables the submit button while signing in', () => {
    mockStore({ isLoading: true });
    renderPage();

    expect(screen.getByRole('button', { name: /Signing in/i })).toBeDisabled();
  });

  /**
   * The extension route still exists for staff who already hold a wallet, but
   * it is deliberately demoted behind a disclosure rather than being a primary
   * button competing with the ordinary path.
   */
  it('keeps the extension login available but not primary', async () => {
    renderPage();

    expect(
      screen.queryByRole('button', { name: /Login with Polkadot Extension/i })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Other sign-in options/i }));

    const extensionButton = await screen.findByRole('button', {
      name: /Login with Polkadot Extension/i,
    });
    fireEvent.click(extensionButton);
    expect(mockLoginWithExtension).toHaveBeenCalled();
  });

  /**
   * WP6: quick login is a presentation affordance. A production build must not
   * render it, and must not even ask the server for demo accounts.
   */
  describe('demo accounts (quick login)', () => {
    const doctorAccount = {
      login_id: 'dr.demo',
      password: 'seeded-fixture-password',
      name: 'Dr. Demo Clinician',
      role: 'Doctor',
    };

    it('is absent, and never requested, when the build is not a demo build', async () => {
      renderPage();

      expect(screen.queryByText(/Demo accounts — disabled in production/i)).not.toBeInTheDocument();
      expect(demo.getDemoCredentials).not.toHaveBeenCalled();
    });

    it('shows the accounts under a visible production-disabled label in a demo build', async () => {
      demo.quickLogin = true;
      demo.getDemoCredentials.mockResolvedValue({ success: true, credentials: [doctorAccount] });
      renderPage();

      expect(await screen.findByText('Demo accounts — disabled in production')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Clinician/i })).toBeInTheDocument();
    });

    it('signs in through the normal credential path when a demo account is chosen', async () => {
      demo.quickLogin = true;
      demo.getDemoCredentials.mockResolvedValue({ success: true, credentials: [doctorAccount] });
      mockLoginWithCredentials.mockResolvedValue(true);
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: /Clinician/i }));

      await waitFor(() => {
        expect(mockLoginWithCredentials).toHaveBeenCalledWith('dr.demo', 'seeded-fixture-password');
      });
    });

    it('stays hidden, without breaking sign-in, when the server refuses demo accounts', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      demo.quickLogin = true;
      demo.getDemoCredentials.mockRejectedValue(new Error('403 DEV_MODE_REQUIRED'));
      renderPage();

      await waitFor(() => expect(warn).toHaveBeenCalled());
      expect(screen.queryByText(/Demo accounts — disabled in production/i)).not.toBeInTheDocument();
      expect(screen.getByLabelText(/Employee ID or work email/i)).toBeEnabled();
      warn.mockRestore();
    });
  });

  it('carries the company copyright and no hackathon branding', () => {
    renderPage();

    expect(screen.getByText('© 2026 Lukau Invasion (Pty) Ltd')).toBeInTheDocument();
    expect(screen.queryByText(/Hackathon/i)).not.toBeInTheDocument();
  });
});
