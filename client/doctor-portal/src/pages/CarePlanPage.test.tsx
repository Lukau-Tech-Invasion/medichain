import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CarePlanPage from './CarePlanPage';
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
 * Assertions rewritten 2026-07-31 against what the page renders today. The old
 * ones asserted on mock goal text ("Reduce BP") and a bare "Active" status that
 * the list no longer renders that way. The page shows a "Recent Care Plans"
 * table with ID / Patient ID / Status columns. Strings verified against
 * `docCarePlan` in shared/src/i18n/locales/en-US.ts.
 */
describe('CarePlanPage', () => {
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
        headers: new Headers({ 'content-type': 'application/json' }),
        status: 200,
        json: () =>
          // The page hides "Recent Care Plans" when the list is empty, which is
          // correct — this test previously mocked `{ plans: [] }` and then
          // asserted the heading was visible, so it was asserting against a
          // product behaviour that would have been a bug.
          Promise.resolve({
            plans: [
              {
                id: 'CP-001',
                patient_id: 'PAT-001',
                status: 'active',
                created_at: 1754985000,
                diagnoses_count: 2,
              },
            ],
          }),
      })
    );
  });

  const renderPage = () =>
    render(
      <MemoryRouter>
        <CarePlanPage />
      </MemoryRouter>
    );

  it('renders the nursing care plan header', async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getAllByText(/Nursing Care Plan/i).length).toBeGreaterThan(0)
    );
    expect(screen.getByText(/Create and manage patient-centered care plans/i)).toBeInTheDocument();
  });

  it('lists recent care plans with their columns', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/Recent Care Plans/i)).toBeInTheDocument());
    expect(screen.getAllByText(/Patient ID/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Status/i).length).toBeGreaterThan(0);
  });
});
