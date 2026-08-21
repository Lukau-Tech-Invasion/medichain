import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PharmacistDashboardPage from './PharmacistDashboardPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('PharmacistDashboardPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Pharmacist',
    fullName: 'Pharmacist Phil',
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
          pending_prescriptions: 15,
          clinical_interventions: 4,
          verified_today: 32,
          stock_alerts: 2,
        }),
      });
    });
  });

  it('renders pharmacist dashboard', async () => {
    render(
      <MemoryRouter>
        <PharmacistDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Pharmacy Dashboard/i)).toBeInTheDocument();
      expect(screen.getByText(/Pending Rx/i)).toBeInTheDocument();
            expect(screen.getByText(/STAT Orders/i)).toBeInTheDocument();
    });
  });

  it('shows quick action links', async () => {
    render(
      <MemoryRouter>
        <PharmacistDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Verify Prescription/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Dispense/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Check Interactions/i)).toBeInTheDocument();
    });
  });
});
