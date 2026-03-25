import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CarePlanPage from './CarePlanPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('CarePlanPage', () => {
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
          care_plan: {
            patient_id: 'PAT-001',
            status: 'Active',
            goals: ['Reduce BP', 'Weight loss'],
            activities: [
              { id: 'a1', description: 'Daily exercise', frequency: '30 min' },
              { id: 'a2', description: 'Low salt diet', frequency: 'Daily' }
            ],
          },
        }),
      });
    });
  });

  it('renders care plan page', async () => {
    render(
      <MemoryRouter>
        <CarePlanPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Patient Care Plan/i)).toBeInTheDocument();
      expect(screen.getByText(/Reduce BP/i)).toBeInTheDocument();
      expect(screen.getByText(/Daily exercise/i)).toBeInTheDocument();
    });
  });

  it('shows care plan status', async () => {
    render(
      <MemoryRouter>
        <CarePlanPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Active/i)).toBeInTheDocument();
    });
  });
});
