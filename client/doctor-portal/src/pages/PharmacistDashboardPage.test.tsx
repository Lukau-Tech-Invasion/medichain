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
      expect(screen.getByText(/Pharmacist Dashboard/i)).toBeInTheDocument();
      expect(screen.getByText(/Pending Prescriptions/i)).toBeInTheDocument();
      expect(screen.getByText('15')).toBeInTheDocument();
      expect(screen.getByText(/Stock Alerts/i)).toBeInTheDocument();
    });
  });

  it('shows quick action links', async () => {
    render(
      <MemoryRouter>
        <PharmacistDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Verify Orders/i)).toBeInTheDocument();
      expect(screen.getByText(/Dispense/i)).toBeInTheDocument();
      expect(screen.getByText(/Drug Interactions/i)).toBeInTheDocument();
    });
  });
});
