import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ShiftHandoffPage from './ShiftHandoffPage';
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

describe('ShiftHandoffPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    // SBAR fields render per patient added to the handoff, so the picker
    // needs at least one patient to choose.
    (shared.getPatients as any).mockResolvedValue([
      { patient_id: 'PAT-001', full_name: 'Test Patient', health_id: 'MCHI-1' },
    ]);
  });

  it('renders shift handoff page', async () => {
    render(<ShiftHandoffPage />);

    expect(screen.getByText(/Shift Handoff \(SBAR\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Document comprehensive patient handoff information/i)).toBeInTheDocument();
  });

  it('displays ISBAR sections', async () => {
    render(<ShiftHandoffPage />);

    // Add a patient: the SBAR block is rendered per handoff entry.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add Patient/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Add Patient/i }));
    // The picker is a list of clickable patients, not a <select>.
    fireEvent.click(screen.getByText(/Test Patient/i));
    fireEvent.click(screen.getByRole('button', { name: /Add to Handoff/i }));


    // Each SBAR heading also appears in the section legend, so a
    // single-element matcher is ambiguous by construction.
    await waitFor(() =>
      expect(screen.getAllByText(/Situation/i).length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText(/Background/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Assessment/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Recommendation/i).length).toBeGreaterThan(0);
  });

  it('allows entering situation', async () => {
    render(<ShiftHandoffPage />);

    // Add a patient: the SBAR block is rendered per handoff entry.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add Patient/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Add Patient/i }));
    // The picker is a list of clickable patients, not a <select>.
    fireEvent.click(screen.getByText(/Test Patient/i));
    fireEvent.click(screen.getByRole('button', { name: /Add to Handoff/i }));


    const input = screen.getByLabelText(/Situation/i);
    fireEvent.change(input, { target: { value: 'Patient admitted with chest pain.' } });
    expect(input).toHaveValue('Patient admitted with chest pain.');
  });
});
