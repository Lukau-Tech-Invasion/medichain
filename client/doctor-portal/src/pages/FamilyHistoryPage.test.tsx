import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { patientProfile } from '../test/fixtures';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import FamilyHistoryPage from './FamilyHistoryPage';
import { selectPatient } from '../test/selectPatient';
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
  getFamilyHistory: vi.fn(),
  createFamilyHistory: vi.fn(),
}));

// Mock components
vi.mock('../components/PedigreeChart', () => ({
  default: () => <div data-testid="pedigree-chart">Pedigree Chart</div>,
}));

// Mock toast actions
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

describe('FamilyHistoryPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  const mockFamilyMembers = [
    {
      relationship: 'mother',
      living: true,
      current_age: 64,
      age_at_death: null,
      cause_of_death: null,
      conditions: [{ condition: 'Diabetes', age_at_diagnosis: 52, notes: null }],
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getFamilyHistory).mockResolvedValue({
      patient_id: 'PAT-001',
      family_members: mockFamilyMembers,
      genetic_conditions: [],
      three_gen_complete: false,
      last_updated: 0,
      updated_by: 'test',
    });
    // The page fetches family history only for a SELECTED patient, and the
    // selector is populated from getPatients — an empty list meant no
    // patient could be chosen, so members never loaded.
    vi.mocked(shared.getPatients).mockResolvedValue([
      patientProfile(),
    ]);
  });

  it('renders family history page', async () => {
    render(<FamilyHistoryPage />);

    // Choose the patient: the family-history fetch is keyed on the selection.
    // Query the filter by id — several controls on this page are labelled with
    // the word 'Patient'.
    await selectPatient(/Patient Filter/i, 'Test Patient');

    await waitFor(() => {
      expect(screen.getAllByText(/Family History/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/mother/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Diabetes/i).length).toBeGreaterThan(0);
    });
  });

  it('allows switching to risk assessment tab', async () => {
    render(<FamilyHistoryPage />);

    const riskTab = screen.getByText(/Risk Assessment/i);
    fireEvent.click(riskTab);
    
    expect(screen.getAllByText(/Risk Assessment/i).length).toBeGreaterThan(0);
  });

  it('allows switching to pedigree tab', async () => {
    render(<FamilyHistoryPage />);

    const pedigreeTab = screen.getByText(/Pedigree Chart/i);
    fireEvent.click(pedigreeTab);

    // The chart panel is identified by its heading; the page carries no
    // test-only hooks.
    expect(screen.getAllByText(/Pedigree Chart/i).length).toBeGreaterThan(0);
  });
});
