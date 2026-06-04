import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TelehealthPage } from './TelehealthPage';
import { usePatientAuthStore } from '../store/authStore';
import { ToastProvider } from '../components/Toast';

/** TelehealthPage uses toast notifications, so it must render under a provider. */
const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <TelehealthPage />
      </ToastProvider>
    </MemoryRouter>
  );

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Keep the real shared module (apiUrl, ToastProvider, …) but make the join
// endpoint deterministic: return no Jitsi creds so the page uses the in-app
// fallback (the API client isn't initialized in the test environment).
vi.mock('@medichain/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return { ...actual, joinTelehealthSession: vi.fn().mockResolvedValue({}) };
});

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

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
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Telehealth Visits/i)).toBeInTheDocument();
      expect(screen.getByText(/Dr. Video/i)).toBeInTheDocument();
      expect(screen.getByText(/Join Video Call/i)).toBeInTheDocument();
    });
  });

  it('opens the in-browser call when joining (falls back to the join URL)', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Join Video Call/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Join Video Call/i));

    // The join endpoint mock returns no Jitsi credentials, so the page falls
    // back to embedding the session's join URL in-app (no native app / new tab).
    await waitFor(() => {
      const frame = screen.getByTitle(/Telehealth video call/i) as HTMLIFrameElement;
      expect(frame).toBeInTheDocument();
      expect(frame.src).toContain('https://join.zoom.us/s/123');
    });
  });

  it('allows switching to past sessions tab', async () => {
    renderPage();

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
