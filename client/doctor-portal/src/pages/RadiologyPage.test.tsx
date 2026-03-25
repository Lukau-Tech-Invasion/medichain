import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import RadiologyPage from './RadiologyPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('RadiologyPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Radiologist',
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
          studies: [
            {
              id: 'r1',
              patientName: 'Jane Doe',
              studyType: 'Chest X-Ray',
              status: 'Completed',
              requestedAt: new Date().toISOString(),
              requestedBy: 'Dr. Smith',
            }
          ],
        }),
      });
    });
  });

  it('renders radiology page', async () => {
    render(
      <MemoryRouter>
        <RadiologyPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Radiology & Imaging/i)).toBeInTheDocument();
      expect(screen.getByText(/Jane Doe/i)).toBeInTheDocument();
      expect(screen.getByText(/Chest X-Ray/i)).toBeInTheDocument();
    });
  });

  it('shows study status', async () => {
    render(
      <MemoryRouter>
        <RadiologyPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Completed/i)).toBeInTheDocument();
    });
  });
});
