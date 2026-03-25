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

  it('allows login with demo accounts', async () => {
    mockLogin.mockResolvedValue(true);
    
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LoginPage />
      </BrowserRouter>
    );

    // Find a demo account button (Thabo)
    const demoButton = screen.getByText(/Thabo/i).closest('button');
    expect(demoButton).toBeInTheDocument();
    
    if (demoButton) {
      fireEvent.click(demoButton);
    }

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });
});
