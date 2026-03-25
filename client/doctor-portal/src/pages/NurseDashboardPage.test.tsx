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
      expect(screen.getByText(/Nurse Dashboard/i)).toBeInTheDocument();
      expect(screen.getByText(/Assigned Patients/i)).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText(/Pending Meds/i)).toBeInTheDocument();
    });
  });

  it('shows quick action links', async () => {
    render(
      <MemoryRouter>
        <NurseDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Triage/i)).toBeInTheDocument();
      expect(screen.getByText(/Medication Admin/i)).toBeInTheDocument();
      expect(screen.getByText(/Vital Signs/i)).toBeInTheDocument();
    });
  });
});
