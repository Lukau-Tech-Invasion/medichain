import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BloodBankPage from './BloodBankPage';
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
 * ones expected an "Inventory Overview" section and a bare "O+" unit listing;
 * the page is an order browser (Orders / New Order / Transfusion) with search
 * and status filters. Strings verified against `docBloodBank` in
 * shared/src/i18n/locales/en-US.ts.
 */
describe('BloodBankPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Laboratory Tech',
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
        status: 200,
        json: () => Promise.resolve({ orders: [] }),
      })
    );
  });

  it('loads the patient list once, not in a loop', async () => {
    // Each response is a new array, as it is from the real client. The page
    // used to re-run its load effect on every new array -- six requests a
    // second, until the rate limiter refused this user everywhere.
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
      const body = url.includes('/api/patients')
        ? { success: true, patients: [] }
        : { success: true, type_screens: { items: [] }, transfusions: { items: [] } };
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(body),
      });
    });
    render(<BloodBankPage />);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const urls = mockFetch.mock.calls.map(([input]) =>
      String(typeof input === 'object' && 'url' in input ? input.url : input));
    expect(urls.filter((u) => u.includes('/api/patients'))).toHaveLength(1);
    expect(urls.filter((u) => u.includes('blood-bank')).length).toBeLessThanOrEqual(2);
  });

  it('renders the blood bank header', async () => {
    render(<BloodBankPage />);

    await waitFor(() => expect(screen.getAllByText(/Blood Bank/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/Transfusion Medicine Services/i)).toBeInTheDocument();
  });

  it('offers the order tabs', async () => {
    render(<BloodBankPage />);

    await waitFor(() => expect(screen.getAllByText(/Orders/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/New Order/i)).toBeInTheDocument();
  });

  it('offers search and status filtering', async () => {
    render(<BloodBankPage />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Order ID, patient, product/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/All Statuses/i)).toBeInTheDocument();
  });
});
