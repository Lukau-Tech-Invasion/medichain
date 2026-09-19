import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NursingCarePlanPage, { mapNursingCarePlan } from './NursingCarePlanPage';
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

describe('NursingCarePlanPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
  });

  it('renders nursing care plan page', async () => {
    render(<NursingCarePlanPage />);

    // The diagnosis form lives in the 'New Plan' tab, not the default list.
    // The page fetches on mount, so the tab strip is not present on the
    // first synchronous render — wait for it before navigating.
    await waitFor(() => expect(screen.getByText(/New Plan/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/New Plan/i));

    expect(screen.getAllByText(/Nursing Care Plan/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Create and manage patient care plans/i)).toBeInTheDocument();
  });

  it('displays assessment sections', async () => {
    render(<NursingCarePlanPage />);

    // The diagnosis form lives in the 'New Plan' tab, not the default list.
    // The page fetches on mount, so the tab strip is not present on the
    // first synchronous render — wait for it before navigating.
    await waitFor(() => expect(screen.getByText(/New Plan/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/New Plan/i));

    // A plan is a nursing diagnosis with its goals and interventions.
    expect(screen.getByText(/Nursing Diagnosis \*/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Risk for Falls/i)).toBeInTheDocument();
  });

  it('allows entering nursing diagnosis', async () => {
    render(<NursingCarePlanPage />);

    // The diagnosis form lives in the 'New Plan' tab, not the default list.
    // The page fetches on mount, so the tab strip is not present on the
    // first synchronous render — wait for it before navigating.
    await waitFor(() => expect(screen.getByText(/New Plan/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/New Plan/i));

    const input = screen.getByLabelText(/Nursing Diagnosis \*/i);
    fireEvent.change(input, { target: { value: 'Impaired Gas Exchange' } });
    expect(input).toHaveValue('Impaired Gas Exchange');
  });

  it('loads a reviewed template into the editable care-plan draft', async () => {
    render(<NursingCarePlanPage />);
    await waitFor(() => expect(screen.getByText(/Templates/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/^Templates$/i));
    fireEvent.click(screen.getAllByRole('button', { name: /Use Template/i })[0]);

    expect(screen.getByLabelText(/Nursing Diagnosis \*/i)).toHaveValue('Risk for Falls');
    expect(screen.getByLabelText(/^Goals$/i)).toHaveValue('Patient will remain free from falls during this plan.');
    expect(screen.getByLabelText(/^Interventions$/i)).toHaveValue(
      'Assess fall risk at the start of each shift and after a change in condition.\nKeep the call bell and needed items within reach.'
    );
  });

  it('maps persisted snake-case care plans without inventing patient demographics', () => {
    const plan = mapNursingCarePlan({
      id: 'NCP-1', patient_id: 'PAT-1', plan_name: 'Risk for Falls', care_level: 'high',
      goals: [{ id: 'goal-1', description: 'No falls', target_date: '2026-10-01' }],
      interventions: [{ id: 'intervention-1', description: 'Assess risk', frequency: 'each shift' }],
      created_by: 'nurse-1', created_at: '2026-09-18T09:00:00Z', updated_at: '2026-09-18T09:30:00Z', status: 'active',
    });

    expect(plan.patientName).toBe('PAT-1');
    expect(plan.goals[0].description).toBe('No falls');
    expect(plan.interventions[0].frequency).toBe('each shift');
  });
});
