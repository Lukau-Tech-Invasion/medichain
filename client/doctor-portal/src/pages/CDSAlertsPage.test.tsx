import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CDSAlertsPage from './CDSAlertsPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('CDSAlertsPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
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
          alerts: [
            {
              id: 'a1',
              title: 'Drug Interaction Warning',
              description: 'Warfarin and Aspirin interaction',
              severity: 'High',
              patientName: 'John Doe',
              timestamp: new Date().toISOString(),
            }
          ],
        }),
      });
    });
  });

  it('renders CDS alerts page', async () => {
    render(
      <MemoryRouter>
        <CDSAlertsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Clinical Decision Support Alerts/i)).toBeInTheDocument();
      expect(screen.getByText(/Drug Interaction Warning/i)).toBeInTheDocument();
      expect(screen.getByText(/John Doe/i)).toBeInTheDocument();
    });
  });

  it('shows severity badge', async () => {
    render(
      <MemoryRouter>
        <CDSAlertsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/High/i)).toBeInTheDocument();
    });
  });
});
