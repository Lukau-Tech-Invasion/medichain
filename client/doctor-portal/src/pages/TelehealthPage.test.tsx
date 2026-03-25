import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TelehealthPage from './TelehealthPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TelehealthPage', () => {
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
          sessions: [
            {
              id: 's1',
              patientName: 'John Doe',
              scheduledAt: new Date().toISOString(),
              status: 'Waiting',
              joinUrl: 'https://telehealth.medichain.com/room/123',
            }
          ],
        }),
      });
    });
  });

  it('renders telehealth page', async () => {
    render(
      <MemoryRouter>
        <TelehealthPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Telehealth Consultations/i)).toBeInTheDocument();
      expect(screen.getByText(/John Doe/i)).toBeInTheDocument();
    });
  });

  it('allows joining a session', async () => {
    window.open = vi.fn();
    
    render(
      <MemoryRouter>
        <TelehealthPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const joinButton = screen.getByText(/Join Session/i);
      fireEvent.click(joinButton);
    });

    expect(window.open).toHaveBeenCalledWith('https://telehealth.medichain.com/room/123', '_blank');
  });
});
