import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { selectPatient } from '../test/selectPatient';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TelehealthPage from './TelehealthPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
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
    // The lookup is a searchable picker now; nobody types a patient id.
    expect(screen.getByLabelText(/View Sessions for Patient/i)).toBeInTheDocument();
  });

  it('shows the QR a patient scans to join from their phone', async () => {
    const respond = (body: unknown, status = 200) => Promise.resolve({
      ok: status < 400,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
    });
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/patients')) {
        return respond({ data: [{ patient_id: 'PAT-001', full_name: 'Sibusiso Ndlovu', health_id: 'HID-1', date_of_birth: '1980-01-01' }] });
      }
      if (url.includes('/qr')) {
        return respond({ success: true, session_id: 'TS-001', join_url: 'https://patients.example.org/telehealth?session=TS-001&join=1', qr_png_base64: 'iVBORw0KGgo=' });
      }
      return respond({ sessions: [{
        session_id: 'TS-001', patient_id: 'PAT-001', provider_id: '5GrwvaEF...mock',
        scheduled_start: Math.floor(Date.now() / 1000), duration_minutes: 30,
        session_type: 'consultation', status: 'scheduled', join_url: 'https://meet.example.invalid/TS-001',
      }] });
    });
    render(<TelehealthPage />);

    await selectPatient(/View Sessions for Patient/i, 'Sibusiso Ndlovu');
    fireEvent.click(await screen.findByRole('button', { name: /Patient join QR/i }));

    const panel = await screen.findByTestId('join-qr');
    expect(panel.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(panel.textContent).toContain('patients.example.org/telehealth?session=TS-001');
  });
});
