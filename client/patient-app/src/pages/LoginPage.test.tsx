import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { LoginPage } from './LoginPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('LoginPage (Patient)', () => {
  const mockLogin = vi.fn();
  const mockClearError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      login: mockLogin,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      clearError: mockClearError,
    });
  });

  function renderPage() {
    return render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LoginPage />
      </BrowserRouter>
    );
  }

  it('renders the username and password form', () => {
    renderPage();

    expect(screen.getByText(/Welcome to MediChain/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sign in$/i })).toBeInTheDocument();
  });

  it('asks for no address or key anywhere on the page', () => {
    renderPage();

    expect(screen.queryByLabelText(/address/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/twelve words|phrase/i)).not.toBeInTheDocument();
  });

  it('links to activation for a patient who has just been registered', () => {
    renderPage();

    expect(screen.getByRole('link', { name: /activation code/i })).toHaveAttribute('href', '/activate');
  });

  it('shows an error and sends nothing when the form is empty', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));

    expect(await screen.findByText(/Enter your username and password/i)).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('signs in with the username and password, then goes to the dashboard', async () => {
    mockLogin.mockResolvedValue(true);
    renderPage();

    fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: 'thandi.n' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'a long enough password' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('thandi.n', 'a long enough password', undefined);
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('asks for the authenticator code when the account requires it', async () => {
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      login: mockLogin,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      mfaRequired: true,
      clearError: mockClearError,
    });
    mockLogin.mockResolvedValue(true);
    renderPage();

    fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: 'thandi.n' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'a long enough password' } });
    fireEvent.change(screen.getByLabelText(/Authentication code/i), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('thandi.n', 'a long enough password', '654321');
    });
  });

  /**
   * Inverted on 2026-08-26. This asserted that clicking a hardcoded "Thabo"
   * button logged a patient in and navigated to the dashboard — and it passed
   * only because `login` was mocked to resolve true. The real control could
   * never work: it called `login(userId)` with no signer against an
   * invented identity, so it died at sign-in every time.
   *
   * A test that mocks away the thing that is broken will report a broken
   * feature as working for as long as it exists. The identities are gone; this
   * now guards their absence.
   */
  it('offers no hardcoded patient identity on the sign-in page', () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LoginPage />
      </BrowserRouter>
    );

    for (const name of ['Thabo', 'Nomvula', 'Sipho', 'Lerato', 'Bongani']) {
      expect(screen.queryByText(new RegExp(name, 'i'))).toBeNull();
    }
    // And no invitation to use one.
    expect(screen.queryByText(/instantly login/i)).toBeNull();
  });

  it('carries the company copyright and no hackathon branding', () => {
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    expect(screen.getByText('© 2026 Lukau Invasion (Pty) Ltd')).toBeInTheDocument();
    expect(screen.queryByText(/Hackathon|All rights reserved/i)).not.toBeInTheDocument();
  });
});
