import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import LabTechDashboardPage from './LabTechDashboardPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LabTechDashboardPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Laboratory Tech',
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
          pending_tests: 10,
          urgent_tests: 3,
          completed_today: 45,
          qc_status: 'Passed',
        }),
      });
    });
  });

  it('renders lab tech dashboard', async () => {
    render(
      <MemoryRouter>
        <LabTechDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Laboratory Technician Dashboard/i)).toBeInTheDocument();
      expect(screen.getByText(/Pending Tests/i)).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText(/QC Status/i)).toBeInTheDocument();
    });
  });

  it('shows quick action buttons', async () => {
    render(
      <MemoryRouter>
        <LabTechDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Enter Test Results/i)).toBeInTheDocument();
      expect(screen.getByText(/Quality Control/i)).toBeInTheDocument();
      expect(screen.getByText(/Inventory/i)).toBeInTheDocument();
    });
  });
});
