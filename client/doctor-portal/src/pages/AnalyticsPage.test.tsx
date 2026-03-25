import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AnalyticsPage from './AnalyticsPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AnalyticsPage', () => {
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
          analytics: {
            patient_visits: [10, 15, 8, 20, 12, 18],
            diagnosis_distribution: {
              'Flu': 30,
              'Hypertension': 20,
              'Diabetes': 15,
            },
          },
        }),
      });
    });
  });

  it('renders analytics page', async () => {
    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Hospital Analytics/i)).toBeInTheDocument();
      expect(screen.getByText(/Patient Volume/i)).toBeInTheDocument();
      expect(screen.getByText(/Diagnosis Distribution/i)).toBeInTheDocument();
    });
  });

  it('shows chart placeholders or labels', async () => {
    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Flu/i)).toBeInTheDocument();
      expect(screen.getByText(/Hypertension/i)).toBeInTheDocument();
    });
  });
});
