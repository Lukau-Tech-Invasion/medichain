import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PathologyPage from './PathologyPage';
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
  listPathology: vi.fn(),
  apiUrl: (path: string) => path,
}));

const SPECIMEN = {
  specimenId: 'SP-2026-001',
  patientId: 'PAT-001',
  patientName: 'Test Patient',
  collectionDate: '2026-08-11',
  collectionTime: '09:15',
  clinician: 'Dr Smith',
  specimenType: 'biopsy' as const,
  site: 'Left forearm',
  laterality: 'left' as const,
  clinicalHistory: 'Pigmented lesion',
  clinicalDiagnosis: 'R/O melanoma',
  priority: 'routine' as const,
  status: 'grossing' as const,
  container: 'Formalin jar',
  fixative: '10% formalin',
};

describe('PathologyPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Pathologist',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
    (shared.listPathology as any).mockResolvedValue({ success: true, items: [SPECIMEN] });
  });

  it('renders pathology page', () => {
    render(<PathologyPage />);

    expect(screen.getByText(/Pathology Laboratory/i)).toBeInTheDocument();
    expect(screen.getByText(/Surgical Pathology & Cytology/i)).toBeInTheDocument();
  });

  // The report view belongs to a selected specimen; the page opens on the
  // worklist, so these tests open the seeded specimen's report first.
  const openReport = async () => {
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /View\/Report/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /View\/Report/i }));
  };

  it('displays assessment sections', async () => {
    render(<PathologyPage />);
    await openReport();

    expect(screen.getAllByText(/Specimen Information/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Gross Examination/i)).toBeInTheDocument();
    expect(screen.getByText(/Microscopic Examination/i)).toBeInTheDocument();
  });

  it('allows entering gross description', async () => {
    render(<PathologyPage />);
    await openReport();

    const input = screen.getByLabelText(/Gross Examination/i);
    fireEvent.change(input, { target: { value: 'Specimen consists of a 2cm skin punch biopsy.' } });
    expect(input).toHaveValue('Specimen consists of a 2cm skin punch biopsy.');
  });
});
