import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BloodBankPage from './BloodBankPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
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
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ orders: [] }),
      })
    );
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
