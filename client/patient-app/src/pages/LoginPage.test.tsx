import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
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
  const mockLoginWithDemoWallet = vi.fn();
  const mockClearError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as any).mockReturnValue({
      login: mockLogin,
      loginWithDemoWallet: mockLoginWithDemoWallet,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      clearError: mockClearError,
    });
  });

  it('renders login form correctly', () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LoginPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/Welcome to MediChain/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/5ABC...XYZ/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect Wallet/i })).toBeInTheDocument();
  });

  it('shows error message if wallet address is empty', async () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LoginPage />
      </BrowserRouter>
    );

    const loginButton = screen.getByRole('button', { name: /Connect Wallet/i });
    fireEvent.click(loginButton);

    expect(await screen.findByText(/Please enter your wallet address/i)).toBeInTheDocument();
  });

  it('shows error message if wallet address format is invalid', async () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LoginPage />
      </BrowserRouter>
    );

    const input = screen.getByPlaceholderText(/5ABC...XYZ/i);
    fireEvent.change(input, { target: { value: 'invalid-address' } });

    const loginButton = screen.getByRole('button', { name: /Connect Wallet/i });
    fireEvent.click(loginButton);

    expect(await screen.findByText(/Invalid wallet address format/i)).toBeInTheDocument();
  });

  it('calls login when valid wallet address is provided', async () => {
    mockLogin.mockResolvedValue(true);
    
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LoginPage />
      </BrowserRouter>
    );

    const validAddress = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z';
    const input = screen.getByPlaceholderText(/5ABC...XYZ/i);
    fireEvent.change(input, { target: { value: validAddress } });

    const loginButton = screen.getByRole('button', { name: /Connect Wallet/i });
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith(validAddress);
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  /**
   * Inverted on 2026-08-26. This asserted that clicking a hardcoded "Thabo"
   * button logged a patient in and navigated to the dashboard — and it passed
   * only because `login` was mocked to resolve true. The real control could
   * never work: it called `login(walletAddress)` with no signer against an
   * invented address, so it died at `signMessage` every time.
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
});
