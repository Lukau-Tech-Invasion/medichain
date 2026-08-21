import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IVSitePage from './IVSitePage';
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

/** Choose the seeded patient — everything past the picker depends on it. */
const selectPatient = async () => {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Test Patient/i })).toBeInTheDocument()
  );
  fireEvent.click(screen.getByRole('button', { name: /Test Patient/i }));
};

describe('IVSitePage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    // IV sites hang off a patient: with no patient chosen the page shows only
    // the picker, so the assessment tabs never render.
    (shared.getPatients as any).mockResolvedValue([
      { patient_id: 'PAT-001', full_name: 'Test Patient', health_id: 'MCHI-1' },
    ]);
  });

  it('renders IV site page', () => {
    render(<IVSitePage />);

    expect(screen.getByText(/IV Site Management/i)).toBeInTheDocument();
    expect(screen.getByText(/Document and monitor intravenous access sites/i)).toBeInTheDocument();
  });

  it('displays assessment criteria', async () => {
    render(<IVSitePage />);
    await selectPatient();

    // Both complications are staged, on their own scales: infiltration on the
    // INS grade and phlebitis on the VIP score.
    await waitFor(() =>
      expect(screen.getAllByText(/Infiltration/i).length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText(/Phlebitis/i).length).toBeGreaterThan(0);
  });

  it('allows selecting IV location', async () => {
    render(<IVSitePage />);
    await selectPatient();

    // The entry form is its own tab; the page opens on the active-sites list.
    fireEvent.click(screen.getByRole('button', { name: /Add New Site/i }));
    const select = screen.getByLabelText(/Insertion Site/i);
    fireEvent.change(select, { target: { value: 'right-forearm' } });
    expect(select).toHaveValue('right-forearm');
  });
});
