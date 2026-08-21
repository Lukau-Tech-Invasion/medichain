import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AnesthesiaPage from './AnesthesiaPage';
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

// Mock only the data calls; the rest of the package (i18n, apiUrl) stays real so
// the component renders its actual copy.
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  createAnesthesia: vi.fn(),
  apiUrl: (path: string) => path,
}));

/**
 * Assertions rewritten 2026-07-31 against what the page renders today. The old
 * ones looked for a "New Record" heading and a labelled "Select Patient" field;
 * the page is tabbed (Record / History) with a "Patient & Case Info" section.
 * Strings verified against `docAnesthesia` in shared/src/i18n/locales/en-US.ts.
 */
describe('AnesthesiaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: { walletAddress: '5GrwvaEF...mock', role: 'Doctor' },
    });
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders the anesthesia record header', async () => {
    render(<AnesthesiaPage />);

    await waitFor(() =>
      expect(screen.getAllByText(/Anesthesia Record/i).length).toBeGreaterThan(0)
    );
    expect(
      screen.getByText(/Intraoperative monitoring and medication tracking/i)
    ).toBeInTheDocument();
  });

  it('offers the record and history tabs', async () => {
    render(<AnesthesiaPage />);

    await waitFor(() => expect(screen.getAllByText(/Record/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/History/i).length).toBeGreaterThan(0);
  });

  it('renders the patient & case section with ASA classification', async () => {
    render(<AnesthesiaPage />);

    await waitFor(() => expect(screen.getByText(/Patient & Case Info/i)).toBeInTheDocument());
    // ASA physical status drives anaesthetic risk — it must stay on the form.
    expect(screen.getByText(/ASA Class/i)).toBeInTheDocument();
  });
});
