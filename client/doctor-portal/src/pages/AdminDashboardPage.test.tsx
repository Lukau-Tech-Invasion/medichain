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
        headers: new Headers({ 'content-type': 'application/json' }),
        // The page reads `system_stats`, not `stats`, and counts users by
        // role rather than by an 'active providers' aggregate.
        json: () => Promise.resolve({
          system_stats: {
            total_users: 100,
            total_patients: 80,
            doctors: 12,
            nurses: 25,
            lab_technicians: 4,
            pharmacists: 3,
            patient_users: 80,
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
      expect(screen.getByText(/System Administration/i)).toBeInTheDocument();
      expect(screen.getByText(/System Status/i)).toBeInTheDocument();
      expect(screen.getAllByText('100').length).toBeGreaterThan(0); // total users
      expect(screen.getByText(/Total Users/i)).toBeInTheDocument();
    });
  });

  it('shows administration quick actions', async () => {
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Add User/i)).toBeInTheDocument();
      expect(screen.getByText(/Audit Report/i)).toBeInTheDocument();
      expect(screen.getByText(/Manage Roles/i)).toBeInTheDocument();
    });
  });
});
