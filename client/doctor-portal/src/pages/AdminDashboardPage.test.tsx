import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AdminDashboardPage from './AdminDashboardPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AdminDashboardPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Admin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          stats: {
            total_users: 100,
            active_providers: 25,
            new_registrations: 5,
            system_uptime: '99.9%',
          },
        }),
      });
    });
  });

  it('renders admin dashboard page with stats', async () => {
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Admin Dashboard/i)).toBeInTheDocument();
      expect(screen.getByText(/System Status/i)).toBeInTheDocument();
      expect(screen.getByText(/100/i)).toBeInTheDocument(); // total users
      expect(screen.getByText(/25/i)).toBeInTheDocument(); // active providers
    });
  });

  it('shows administration quick actions', async () => {
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/User Management/i)).toBeInTheDocument();
      expect(screen.getByText(/Audit Logs/i)).toBeInTheDocument();
      expect(screen.getByText(/System Settings/i)).toBeInTheDocument();
    });
  });
});
