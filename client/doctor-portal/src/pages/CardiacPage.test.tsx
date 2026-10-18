import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { patientProfile } from '../test/fixtures';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CardiacPage from './CardiacPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';
import { selectPatient } from '../test/selectPatient';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openAccessContext: vi.fn().mockResolvedValue({ access_context_id: 'CTX-TEST', expires_at: '2099-01-01T00:00:00Z' }),
  getPatients: vi.fn(),
  createCardiac: vi.fn(),
  getPatientCardiacEvents: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('CardiacPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  const mockPatients = [
    patientProfile({ full_name: 'John Doe' }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getPatientCardiacEvents).mockResolvedValue([]);
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue(mockPatients);
  });

  it('submits unknown measurements as null and preserves a measured zero', async () => {
    vi.mocked(shared.createCardiac).mockResolvedValue({
      id: 'CAR-SAVED', success: true, event_type: 'Arrhythmia', timi_score: 0, timi_band: 'low',
    });
    render(<MemoryRouter><CardiacPage /></MemoryRouter>);
    await selectPatient('', 'John Doe', 'cardiac-patient');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Troponin (ng/mL)' }), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Cardiac Event' }));
    await waitFor(() => expect(shared.createCardiac).toHaveBeenCalledWith(
      expect.objectContaining({
        vital_signs: { heart_rate: null, blood_pressure: '' },
        lab_values: { troponin: 0, bnp: null },
      }),
    ));
  });

  it('renders cardiac page', async () => {
    render(
      <MemoryRouter>
        <CardiacPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Cardiac Event Documentation/i)).toBeInTheDocument();
      expect(screen.getAllByText(/ECG Readings/i).length).toBeGreaterThan(0);
    });
  });

  it('allows selecting a patient', async () => {
    render(
      <MemoryRouter>
        <CardiacPage />
      </MemoryRouter>
    );

    await selectPatient('', 'John Doe', 'cardiac-patient');
    expect(screen.getByRole('button', { name: 'Clear selected patient John Doe' })).toBeInTheDocument();
    // Searched on the server rather than filtered from the first page of patients.
    expect(vi.mocked(shared.getPatients)).toHaveBeenCalledWith(expect.objectContaining({ query: 'John' }));
  });

  it('allows entering event details', async () => {
    render(
      <MemoryRouter>
        <CardiacPage />
      </MemoryRouter>
    );

    // Event type is a grid of buttons under an <h2>, not a <select>: the
    // generated test assumed a dropdown that does not exist.
    expect(screen.getByText(/Event Type/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByText(/^STEMI$/i)[0]);
  });
});
