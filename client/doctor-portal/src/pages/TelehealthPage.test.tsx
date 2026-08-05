import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TelehealthPage from './TelehealthPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Fixture rewritten 2026-07-31. It previously returned sessions shaped
 * `{ id, patientName, scheduledAt, joinUrl }`, but `TelehealthSession` (and the
 * API) use snake_case — `session_id`, `session_type`, `scheduled_start`,
 * `join_url` — so nothing the component keyed on was present and no session row
 * ever rendered. Copy assertions verified against `docTelehealth` in
 * shared/src/i18n/locales/en-US.ts.
 */
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

    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            sessions: [
              {
                session_id: 'TS-001',
                patient_id: 'PAT-001',
                provider_id: '5GrwvaEF...mock',
                scheduled_start: Math.floor(Date.now() / 1000),
                duration_minutes: 30,
                session_type: 'consultation',
                status: 'scheduled',
                join_url: 'https://telehealth.example.invalid/room/123',
              },
            ],
          }),
      })
    );
  });

  it('renders the telehealth header', async () => {
    render(<TelehealthPage />);

    // The phrase appears in both the page heading and the sessions panel.
    await waitFor(() =>
      expect(screen.getAllByText(/Telehealth Sessions/i).length).toBeGreaterThan(0)
    );
    expect(screen.getByText(/Manage virtual care appointments/i)).toBeInTheDocument();
  });

  it('offers creating a new session', async () => {
    render(<TelehealthPage />);

    await waitFor(() => expect(screen.getByText(/New Session/i)).toBeInTheDocument());
  });

  it('asks for a patient before listing sessions', async () => {
    render(<TelehealthPage />);

    // Sessions are fetched per patient (`/api/telehealth/patient/{id}/sessions`),
    // so the landing state is the lookup form, not a populated list.
    await waitFor(() =>
      expect(screen.getByText(/View Sessions for Patient ID/i)).toBeInTheDocument()
    );
    expect(screen.getByPlaceholderText(/Enter patient ID/i)).toBeInTheDocument();
  });
});
