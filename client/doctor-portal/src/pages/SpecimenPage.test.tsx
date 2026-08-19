import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SpecimenPage from './SpecimenPage';
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
 * ones expected a "Specimen Details" section and a labelled "Specimen Type"
 * field; the page is tabbed (All Specimens / Collect Specimen / Tracking) with
 * summary counters. Strings verified against `docSpecimen` in
 * shared/src/i18n/locales/en-US.ts.
 */
describe('SpecimenPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Laboratory Tech',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
    // The component does `data.map(...)` directly, so this endpoint must return
    // an ARRAY. Handing it an object made `.map` throw inside the effect and the
    // page never left its loading state.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      status: 200,
      json: async () => [],
      text: async () => '[]',
    }) as unknown as typeof fetch;
  });

  it('renders the specimen collection header', async () => {
    render(<SpecimenPage />);

    await waitFor(() =>
      expect(screen.getByText(/Specimen Collection/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Track and manage laboratory specimens/i)).toBeInTheDocument();
  });

  it('offers the specimen tabs', async () => {
    render(<SpecimenPage />);

    await waitFor(() => expect(screen.getByText(/All Specimens/i)).toBeInTheDocument());
    expect(screen.getByText(/Collect Specimen/i)).toBeInTheDocument();
    expect(screen.getByText(/Tracking/i)).toBeInTheDocument();
  });

  it('shows the STAT orders counter', async () => {
    render(<SpecimenPage />);

    // STAT specimens are time-critical; the counter must stay on the summary row.
    await waitFor(() => expect(screen.getByText(/STAT Orders/i)).toBeInTheDocument());
  });
});
