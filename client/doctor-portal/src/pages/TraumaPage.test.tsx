import { render, screen } from '@testing-library/react';
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
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
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
