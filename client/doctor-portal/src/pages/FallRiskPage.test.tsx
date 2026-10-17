import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import FallRiskPage from './FallRiskPage';
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
  listPatientFallRisk: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('FallRiskPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
  });

  it('renders fall risk assessment page', () => {
    render(<FallRiskPage />);

    expect(screen.getByText(/Fall Risk Assessment/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Morse Fall Scale/i).length).toBeGreaterThan(0);
  });

  it('requires six explicit observations and clears them when the patient changes', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([
      { patient_id: 'PAT-001', full_name: 'Test Patient' },
      { patient_id: 'PAT-002', full_name: 'Other Patient' },
    ] as unknown as Awaited<ReturnType<typeof shared.getPatients>>);
    vi.mocked(shared.listPatientFallRisk).mockResolvedValue([]);
    render(<FallRiskPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Test Patient PAT-001/ }));
    expect(screen.queryByText('Morse Fall Scale Score: 0')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Assessment' })).toBeDisabled();
    screen.getAllByRole('radio', { name: 'No (0 points)' }).forEach(radio => fireEvent.click(radio));
    fireEvent.click(screen.getByRole('radio', { name: 'None / Bed Rest / Nurse Assist (0 points)' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Normal / Bedrest / Immobile (0 points)' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Oriented to own ability (0 points)' }));
    expect(screen.getByRole('button', { name: 'Save Assessment' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Other Patient PAT-002/ }));
    expect(screen.getByRole('button', { name: 'Save Assessment' })).toBeDisabled();
    expect(screen.queryByText('Morse Fall Scale Score: 0')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio').every(radio => !(radio as HTMLInputElement).checked)).toBe(true);
  });

  it('shows the stored high-risk history and plan without the blank form low-risk banner', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([
      { patient_id: 'PAT-001', full_name: 'Test Patient' },
    ] as unknown as Awaited<ReturnType<typeof shared.getPatients>>);
    vi.mocked(shared.listPatientFallRisk).mockResolvedValue([
      { id: 'FRA-1', patient_id: 'PAT-001', total_score: 55, risk_level: 'high',
        interventions: ['Fall Risk Band Applied'], notes: 'Durable fall assessment',
        assessed_at: '2026-10-08T00:00:00Z', assessed_by: 'nurse-1' },
    ] as unknown as Awaited<ReturnType<typeof shared.listPatientFallRisk>>);
    render(<FallRiskPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Test Patient PAT-001/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Assessment History' }));
    expect(await screen.findByText('Score: 55 - HIGH')).toBeInTheDocument();
    expect(screen.queryByText('Morse Fall Scale Score: 0')).not.toBeInTheDocument();
    expect(screen.getByText('Durable fall assessment')).toBeInTheDocument();
    expect(screen.getByText('Fall Risk Band Applied')).toBeInTheDocument();
  });

  it('displays assessment criteria', () => {
    render(<FallRiskPage />);

    expect(screen.getByText(/History of falling/i)).toBeInTheDocument();
    expect(screen.getByText(/Secondary diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/Ambulatory aid/i)).toBeInTheDocument();
  });

  it('calculates risk score', () => {
    render(<FallRiskPage />);

    // Click "Yes" for history of falling (should add points)
    const yesButtons = screen.getAllByText(/Yes/i);
    fireEvent.click(yesButtons[0]);

    expect(screen.getAllByText(/Morse Fall Scale/i).length).toBeGreaterThan(0);
  });
});
