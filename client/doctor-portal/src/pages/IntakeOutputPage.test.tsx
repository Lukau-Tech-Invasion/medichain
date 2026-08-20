import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IntakeOutputPage from './IntakeOutputPage';
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
  listIntakeOutput: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('IntakeOutputPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    // The ward list is a join: the roster comes from a direct
    // `fetch('/api/patients?limit=100')` (read as `.data`), and
    // `listIntakeOutput()` supplies the stored fluid records, which
    // `toPatientIO` folds together per patient. This fixture used to mock an
    // empty roster and hand `listIntakeOutput` the already-folded camelCase view
    // model, so the join produced nobody and the patient never appeared.
    (shared.getPatients as any).mockResolvedValue([]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: [{ patient_id: 'PAT-001', full_name: 'Test Patient' }] }),
    }) as any;
    // Raw rows in the API's own shape — snake_case, with the per-shift totals
    // the page sums into the 24h figures.
    (shared.listIntakeOutput as any).mockResolvedValue([
      {
        id: 'IO-001',
        patient_id: 'PAT-001',
        record_date: '2026-08-20',
        shift: 'day',
        total_intake: 1800,
        total_output: 1500,
        net_balance: 300,
        intake_items: [],
        output_items: [],
      },
    ]);
  });

  it('renders I/O page', async () => {
    render(<IntakeOutputPage />);

    // The intake form lives in the 'Quick Entry' tab, not the patient list.


    await waitFor(() =>
      expect(screen.getByText(/Intake & Output/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Track patient fluid balance/i)).toBeInTheDocument();
  });

  it('displays balance summary', async () => {
    render(<IntakeOutputPage />);

    // The intake form lives in the 'Quick Entry' tab, not the patient list.


    // Open the patient: the 24h summary is in their detail panel.
    await waitFor(() =>
      expect(screen.getAllByText(/Test Patient/i).length).toBeGreaterThan(0)
    );
    fireEvent.click(screen.getAllByText(/Test Patient/i)[0]);

    expect(screen.getByText(/Total Intake \(24h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Output \(24h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Net Balance/i)).toBeInTheDocument();
  });

  it('allows adding intake entry', async () => {
    render(<IntakeOutputPage />);

    // 'Quick Entry' is a tab of the page; the entry form it shows records a
    // volume against the selected patient.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Quick Entry/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Quick Entry/i }));

    expect(screen.getByText(/Quick I\/O Entry/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record Entry/i })).toBeInTheDocument();
  });
});
