import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TelehealthPage } from './TelehealthPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock window.open
window.open = vi.fn();

describe('TelehealthPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  const futureTime = (Date.now() / 1000) + 3600;
  const pastTime = (Date.now() / 1000) - 3600;

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/telehealth/patient/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sessions: [
              {
                session_id: 'sess1',
                provider_id: 'PROV1',
                provider_name: 'Dr. Video',
                patient_join_url: 'https://join.zoom.us/s/123',
                scheduled_start: futureTime,
                status: 'scheduled',
              },
              {
                session_id: 'sess2',
                provider_id: 'PROV2',
                provider_name: 'Dr. Past',
                scheduled_start: pastTime,
                status: 'completed',
                duration_minutes: 20,
              }
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  it('renders telehealth page with upcoming sessions', async () => {
    render(
      <MemoryRouter>
        <TelehealthPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Telehealth Visits/i)).toBeInTheDocument();
      expect(screen.getByText(/Dr. Video/i)).toBeInTheDocument();
      expect(screen.getByText(/Join Session/i)).toBeInTheDocument();
    });
  });

  it('allows joining a session', async () => {
    render(
      <MemoryRouter>
        <TelehealthPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const joinButton = screen.getByText(/Join Session/i);
      fireEvent.click(joinButton);
    });

    expect(window.open).toHaveBeenCalledWith('https://join.zoom.us/s/123', '_blank', 'noopener,noreferrer');
  });

  it('allows switching to past sessions tab', async () => {
    render(
      <MemoryRouter>
        <TelehealthPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Upcoming/i)).toBeInTheDocument();
    });

    const pastTab = screen.getByText(/Past/i);
    fireEvent.click(pastTab);
    
    await waitFor(() => {
      expect(screen.getByText(/Dr. Past/i)).toBeInTheDocument();
      expect(screen.getByText(/20 min/i)).toBeInTheDocument();
    });
  });
});
