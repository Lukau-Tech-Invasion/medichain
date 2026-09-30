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
 * Sign-in is an Employee ID and a password, with an authenticator code when the
 * account has one. There is no other way in, and no key, address or extension
 * is involved (docs/WORKFLOW_AUDIT.md, WF-002).
 */
describe('LoginPage', () => {
  const mockLoginWithCredentials = vi.fn();
  const mockClearError = vi.fn();

  function mockStore(overrides: Record<string, unknown> = {}) {
    vi.mocked(useAuthStore).mockReturnValue({
      loginWithCredentials: mockLoginWithCredentials,
      mfaRequired: false,
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
   * The point of the whole change: a clinician is never asked for a key or an
   * address to sign in, and there is no extension route. If this ever fails, the
   * defect has come back.
   */
  it('offers no address, key or extension sign-in', () => {
    renderPage();

    expect(screen.queryByLabelText(/address/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Extension|Connect/i })).not.toBeInTheDocument();
  });

  it('links to account activation for a first sign-in', () => {
    renderPage();

    expect(screen.getByRole('link', { name: /activate/i })).toHaveAttribute('href', '/activate');
  });

  it('asks for the authenticator code once the account requires it, and sends it', async () => {
    mockStore({ mfaRequired: true });
    mockLoginWithCredentials.mockResolvedValue(true);
    renderPage();

    fireEvent.change(screen.getByLabelText(/Employee ID or work email/i), { target: { value: 'dr.mbeki' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'a-real-password' } });
    fireEvent.change(screen.getByLabelText(/Authentication code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));

    await waitFor(() => {
      expect(mockLoginWithCredentials).toHaveBeenCalledWith('dr.mbeki', 'a-real-password', '123456');
    });
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
      expect(mockLoginWithCredentials).toHaveBeenCalledWith('dr.mbeki', 'a-real-password', undefined);
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
