import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ConsultPage from './ConsultPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ConsultPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Specialist',
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
          consultations: [
            {
              id: 'c1',
              patientName: 'John Doe',
              requestingProvider: 'Dr. Smith',
              reason: 'Cardiac evaluation',
              status: 'Pending',
              timestamp: new Date().toISOString(),
            }
          ],
        }),
      });
    });
  });

  it('renders consult page', async () => {
    render(
      <MemoryRouter>
        <ConsultPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Provider Consultations/i)).toBeInTheDocument();
      expect(screen.getByText(/John Doe/i)).toBeInTheDocument();
      expect(screen.getByText(/Cardiac evaluation/i)).toBeInTheDocument();
    });
  });

  it('allows filtering by status', async () => {
    render(
      <MemoryRouter>
        <ConsultPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Pending/i)).toBeInTheDocument();
    });
  });
});
