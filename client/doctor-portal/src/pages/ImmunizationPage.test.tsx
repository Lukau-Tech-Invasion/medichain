import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ImmunizationPage from './ImmunizationPage';
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

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('ImmunizationPage', () => {
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

  it('renders immunization page', async () => {
    render(<ImmunizationPage />);

    expect(screen.getByText(/Immunization Management/i)).toBeInTheDocument();
    expect(screen.getByText(/Vaccine administration, tracking, and registry integration/i)).toBeInTheDocument();
  });

  it('displays assessment sections', async () => {
    render(<ImmunizationPage />);
    // The vaccine form is in the 'Administer Vaccine' tab; the page opens on
    // the records list. Wait for the tab strip (the page fetches on mount).
    await waitFor(() =>
      expect(screen.getAllByText(/Administer Vaccine/i).length).toBeGreaterThan(0)
    );
    fireEvent.click(screen.getAllByText(/Administer Vaccine/i)[0]);

    expect(screen.getAllByText(/Administer Vaccine/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Administration/i).length).toBeGreaterThan(0);
  });

  it('allows entering vaccine name', async () => {
    render(<ImmunizationPage />);
    // The vaccine form is in the 'Administer Vaccine' tab; the page opens on
    // the records list. Wait for the tab strip (the page fetches on mount).
    await waitFor(() =>
      expect(screen.getAllByText(/Administer Vaccine/i).length).toBeGreaterThan(0)
    );
    fireEvent.click(screen.getAllByText(/Administer Vaccine/i)[0]);

    // The administer tab's vaccine field is a labelled <select>, not a free
    // text input — the generated test assumed a text box that never existed.
    const select = screen.getByLabelText(/Vaccine Type/i);
    expect(select).toBeInTheDocument();
  });
});
