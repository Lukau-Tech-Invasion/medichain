import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { patientProfile } from '../test/fixtures';
import { selectPatient } from '../test/selectPatient';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TraumaPage from './TraumaPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock only the data call; the rest of the package (i18n, apiUrl) stays real so
// the component renders its actual copy.
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  createTrauma: vi.fn(),
  getPatientTraumas: vi.fn().mockResolvedValue([]),
  openAccessContext: vi.fn().mockResolvedValue({ access_context_id: 'CTX-TEST', expires_at: '2099-01-01T00:00:00Z' }),
  apiUrl: (path: string) => path,
}));

/**
 * Assertions rewritten 2026-07-31 against what the page renders today. The old
 * ones expected a subtitle ("Primary and Secondary Trauma Survey") and bare
 * ABCD labels that no longer exist: the survey is labelled "Primary Survey
 * (ABCDE)" with "A - Airway"-style rows, and the Glasgow score is
 * "GCS Score (3-15)". Every string below is verified against `docTrauma` in
 * shared/src/i18n/locales/en-US.ts, the source of truth for this copy.
 */
describe('TraumaPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
  });

  it('files no finding nobody recorded: no GCS, no ISS, no primary survey', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile()]);
    vi.mocked(shared.createTrauma).mockResolvedValue({ success: true } as never);
    render(<TraumaPage />);
    await selectPatient('', 'Test Patient', 'trauma-patient');
    // The mechanism is the one thing this form requires.
    fireEvent.change(screen.getByLabelText(/Mechanism of Injury/i), { target: { value: 'Fall from standing height' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(shared.createTrauma).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(shared.createTrauma).mock.calls[0][0];
    // It used to open on blunt, GCS 15, ISS 0 and a normal survey, and file them.
    expect(sent.trauma_type).toBeUndefined();
    expect(sent.gcs_score).toBeUndefined();
    expect(sent.injury_severity_score).toBeUndefined();
    expect(sent.notes).toBeUndefined();
  });

  it('renders the trauma assessment header', () => {
    render(<TraumaPage />);

    expect(screen.getByText(/Trauma Assessment/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Document trauma mechanism, primary survey, and injury severity\./i)
    ).toBeInTheDocument();
  });

  it('displays the ABCDE primary survey sections', () => {
    render(<TraumaPage />);

    expect(screen.getByText(/Primary Survey \(ABCDE\)/i)).toBeInTheDocument();
    expect(screen.getByText(/A - Airway/i)).toBeInTheDocument();
    expect(screen.getByText(/B - Breathing/i)).toBeInTheDocument();
    expect(screen.getByText(/C - Circulation/i)).toBeInTheDocument();
    expect(screen.getByText(/D - Disability/i)).toBeInTheDocument();
  });

  it('offers GCS scoring', () => {
    render(<TraumaPage />);

    expect(screen.getByText(/GCS Score \(3-15\)/i)).toBeInTheDocument();
  });
});
