import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NurseDashboardPage from './NurseDashboardPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NurseDashboardPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
    fullName: 'Nurse Jackie',
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
        json: () => Promise.resolve({
          assigned_patients: 5,
          pending_medications: 12,
          critical_alerts: 2,
          upcoming_tasks: 8,
        }),
      });
    });
  });

  it('renders nurse dashboard', async () => {
    render(
      <MemoryRouter>
        <NurseDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Nursing Dashboard/i)).toBeInTheDocument();
      expect(screen.getAllByText(/My Patients/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Vitals Due/i)).toBeInTheDocument();
    });
  });

  it('shows quick action links', async () => {
    render(
      <MemoryRouter>
        <NurseDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Open MAR/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/I\/O Documentation/i)).toBeInTheDocument();
      expect(screen.getByText(/Record Vitals/i)).toBeInTheDocument();
    });
  });
});
