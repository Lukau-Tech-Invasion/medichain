import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual: any = await vi.importActual('react-router-dom');
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
    (useAuthStore as any).mockReturnValue({
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
});
