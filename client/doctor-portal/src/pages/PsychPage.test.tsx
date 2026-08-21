import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PsychPage from './PsychPage';
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
  getPsychForPatient: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('PsychPage', () => {
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
    (shared.getPsychForPatient as any).mockResolvedValue({ assessments: [] });
  });

  /**
   * The History tab renders stored assessments, and the endpoint returns each
   * record exactly as it was submitted — nested and snake_case. The mapper used
   * to spread the raw item and rename four scalars, leaving `suicideRisk`
   * undefined; the first row then threw on `a.suicideRisk.riskLevel`, React
   * unmounted on the render throw, and the tab showed nothing — which reads as
   * "no assessments on file" for a patient who has one.
   */
  it('renders a stored assessment in the History tab without crashing', async () => {
    (shared.getPatients as any).mockResolvedValue([
      { patient_id: 'PAT-001', full_name: 'Stored Patient' },
    ]);
    (shared.getPsychForPatient as any).mockResolvedValue({
      assessments: [
        {
          assessment_id: 'PSYCH-1',
          patient_id: 'PAT-001',
          chief_complaint: 'Low mood for three weeks',
          assessed_by: 'dr.test',
          assessed_at: Math.floor(Date.now() / 1000),
          disposition: 'Admit',
          mental_status: { mood: 'Depressed', thought_content: 'Hopelessness, guilt' },
          suicide_risk: {
            ideation: true,
            plan: false,
            intent: false,
            access_to_means: false,
            attempt_count: 1,
            // Stored capitalised, so it cannot be used as a colour-map key
            // directly.
            risk_level: 'Moderate',
          },
          homicidal_risk: { ideation: false, risk_level: 'none' },
          psych_history: { diagnoses: ['Major depressive disorder'] },
          substance_use: { substances: [] },
          psych_medications: ['sertraline 50mg'],
          legal_status: { admission_type: 'Voluntary' },
          diagnoses: ['Major depressive disorder'],
          safety_plan: [],
        },
      ],
    });

    const { container } = render(<PsychPage />);

    // Two chained fetches (roster, then history) with the suite running files
    // in parallel, so the 1s waitFor default is not reliably enough on a loaded
    // machine. The budgets stay well under the per-test timeout on this test:
    // two 5s waits summed to exactly the 10s `testTimeout` in
    // vitest.config.ts, so under load the test died before either wait could
    // report what it was still waiting for.
    const slow = { timeout: 3000 };

    // Scoped to this render's container rather than `document`, and to the
    // select's own id because "Patient" appears in several labels here. The
    // option must exist before the change fires: the roster arrives from an
    // async fetch, and selecting a value the <select> does not yet offer is a
    // silent no-op.
    const select = await waitFor(() => {
      const el = container.querySelector<HTMLSelectElement>('#psych-patient');
      if (!el?.querySelector('option[value="PAT-001"]')) {
        throw new Error('patient roster not loaded yet');
      }
      return el;
    }, slow);
    fireEvent.change(select, { target: { value: 'PAT-001' } });

    // The tab, not the "Psychiatric History" section heading on the form.
    fireEvent.click(screen.getByRole('button', { name: 'History' }));

    await waitFor(() => {
      expect(screen.getByText(/Stored Patient/i)).toBeInTheDocument();
    }, slow);
    // The risk badge is the element that used to throw.
    expect(screen.getAllByText(/moderate/i).length).toBeGreaterThan(0);
  }, 20000);

  it('renders psychiatry page', () => {
    render(<PsychPage />);

    expect(screen.getByText(/Psychiatric Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Mental Status Examination/i)).toBeInTheDocument();
  });

  it('displays MSE sections', () => {
    render(<PsychPage />);

    expect(screen.getByText(/Appearance/i)).toBeInTheDocument();
    expect(screen.getByText(/Mood \(patient states\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Affect \(observed\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Thought Content/i)).toBeInTheDocument();
  });

  it('allows entering mood description', () => {
    render(<PsychPage />);

    const input = screen.getByLabelText(/Mood/i);
    fireEvent.change(input, { target: { value: 'Euthymic' } });
    expect(input).toHaveValue('Euthymic');
  });
});
