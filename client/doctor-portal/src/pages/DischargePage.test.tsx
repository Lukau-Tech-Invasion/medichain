import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DischargePage from './DischargePage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('DischargePage', () => {
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
          discharge_summary: {
            patient_id: 'PAT-001',
            discharge_date: new Date().toISOString(),
            diagnoses: ['Pneumonia', 'Asthma'],
            procedures: ['Chest X-Ray'],
            medications: ['Amoxicillin'],
            follow_up: 'See GP in 1 week',
          },
        }),
      });
    });
  });

  it('renders discharge page', async () => {
    render(
      <MemoryRouter>
        <DischargePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Discharge Summary/i)).toBeInTheDocument();
      expect(screen.getByText(/Pneumonia/i)).toBeInTheDocument();
      expect(screen.getByText(/Amoxicillin/i)).toBeInTheDocument();
    });
  });

  it('shows follow-up instructions', async () => {
    render(
      <MemoryRouter>
        <DischargePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/See GP in 1 week/i)).toBeInTheDocument();
    });
  });
});
