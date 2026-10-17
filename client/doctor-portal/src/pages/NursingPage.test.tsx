import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NursingPage, { mapMarRecord, mapCarePlan } from './NursingPage';
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
  listWardMar: vi.fn(),
  listWardIntakeOutput: vi.fn(),
  listWardCarePlans: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('NursingPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    vi.mocked(shared.listWardMar).mockResolvedValue([]);
    vi.mocked(shared.listWardIntakeOutput).mockResolvedValue([]);
    vi.mocked(shared.listWardCarePlans).mockResolvedValue([]);
  });

  it('renders nursing page', () => {
    render(<NursingPage />);

    expect(screen.getByText(/Nursing Documentation/i)).toBeInTheDocument();
    expect(screen.getByText(/MAR, Intake\/Output, and Care Plans/i)).toBeInTheDocument();
  });

  it('displays assessment tabs', () => {
    render(<NursingPage />);

    expect(screen.getAllByText(/MAR/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Intake/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Care Plan/i).length).toBeGreaterThan(0);
  });

  it('allows switching to the care plan tab', async () => {
    render(<NursingPage />);

    // Tab bodies render behind the page's initial load spinner, so wait for
    // the MAR tab (the default) to have content before switching away.
    const carePlansTab = await screen.findByRole('button', { name: /Care Plans/i });
    fireEvent.click(carePlansTab);
    expect(carePlansTab.className).toContain('bg-brand');
  });

  it('maps repository-shaped MAR data without inventing a dose schedule', () => {
    const record = mapMarRecord({
      id: 'MAR-1', patient_id: 'PAT-1', record_date: '2026-09-20', primary_nurse: 'NURSE-1',
      scheduled_medications: [{ medication_id: 'MED-1', name: 'Amoxicillin', dose: '500 mg', route: 'PO', frequency: 'TID' }],
      data: { administrations: [] },
    });

    expect(record?.medications[0]).toMatchObject({ medication_name: 'Amoxicillin', dose: '500 mg' });
    expect(record?.medications[0].doses).toEqual([]);
  });

  it('does not turn unevaluated goals into failed outcomes or assume an intervention is active', () => {
    const plan = mapCarePlan({ id: 'PLAN-QA', goals: [
      { description: 'Not evaluated yet' },
      { description: 'Recorded achieved goal', status: 'met' },
      { description: 'Recorded unmet goal', status: 'not_met' },
    ], interventions: [{ description: 'Planned action' }, { description: 'Completed action', status: 'completed' }] });
    expect(plan?.outcomes.map(outcome => outcome.status)).toEqual([null, 'met', 'not_met']);
    expect(plan?.interventions.map(intervention => intervention.status)).toEqual([null, 'completed']);
  });

  it('clears the fluid category when entry type changes instead of sending the old intake category', async () => {
    render(<NursingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Intake/Output' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Fluid Type' }), { target: { value: 'Oral' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Entry Type' }), { target: { value: 'output' } });
    expect(screen.getByRole('combobox', { name: 'Fluid Type' })).toHaveValue('');
    fireEvent.change(screen.getByRole('combobox', { name: 'Fluid Type' }), { target: { value: 'Urine' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Entry Type' }), { target: { value: 'intake' } });
    expect(screen.getByRole('combobox', { name: 'Fluid Type' })).toHaveValue('');
  });
});
