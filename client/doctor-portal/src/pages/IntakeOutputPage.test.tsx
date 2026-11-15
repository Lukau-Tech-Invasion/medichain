import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import IntakeOutputPage, { intakeOutputTrendCsv, toPatientIO } from './IntakeOutputPage';
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
  createIntakeOutput: vi.fn(),
}));

// Keep the module's hooks; replace only the picker component.
vi.mock('../components/PatientSelect', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()),
  default: ({ label, onChange }: { label: string; onChange: (id: string) => void }) => (
    <select aria-label={label} onChange={event => onChange(event.target.value)}>
      <option value="">Select a patient</option><option value="PAT-001">Test Patient</option>
    </select>
  ),
}));

describe('IntakeOutputPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    // The ward list is a join: `getPatients()` supplies the roster and
    // `listIntakeOutput()` the stored fluid records, which `toPatientIO` folds
    // together per patient. This fixture used to hand `listIntakeOutput` the
    // already-folded camelCase view model, so the join produced nobody.
    vi.mocked(shared.getPatients).mockResolvedValue([
      { patient_id: 'PAT-001', full_name: 'Test Patient' },
    ] as unknown as Awaited<ReturnType<typeof shared.getPatients>>);
    // Raw rows in the API's own shape — snake_case, with the per-shift totals
    // the page sums into the 24h figures.
    vi.mocked(shared.listIntakeOutput).mockResolvedValue([
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

  afterEach(() => { vi.restoreAllMocks(); });

  it('uses observation times for half-open windows and excludes old, future and other-patient volumes', () => {
    const row = {
      id: 'IO-WINDOW', patient_id: 'PAT-001', record_date: '2026-08-20', shift: 'day',
      total_intake: 99999, total_output: 99999, net_balance: 0,
      intake_items: [
        { amount_ml: 100, recorded_at: '2026-08-19T12:00:00Z' },
        { amount_ml: 50, recorded_at: '2026-08-19T11:59:59Z' },
        { amount_ml: 20, recorded_at: '2026-08-20T12:00:00Z' },
        { amount_ml: 10, recorded_at: 'not-a-date' },
      ],
      output_items: [{ amount_ml: 40, recorded_at: '2026-08-20T08:00:00Z' }],
    };
    const view = toPatientIO({ patient_id: 'PAT-001', full_name: 'Test Patient' }, [row, { ...row, patient_id: 'PAT-002' }], {
      start: Date.parse('2026-08-19T12:00:00Z'), end: Date.parse('2026-08-20T12:00:00Z'),
    });
    expect(view.totalIntake24h).toBe(100);
    expect(view.totalOutput24h).toBe(40);
    expect(view.netBalance).toBe(60);
    expect(view.entries).toHaveLength(2);
    const day = toPatientIO({ patient_id: 'PAT-001', full_name: 'Test Patient' }, [row], {
      start: Date.parse('2026-08-20T00:00:00Z'), end: Date.parse('2026-08-21T00:00:00Z'),
    });
    expect(day.totalIntake24h).toBe(20);
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

  it('saves without an obstructing detail panel and reads server totals and notes after reload', async () => {
    const record = {
      id: 'IO-001', patient_id: 'PAT-001', record_date: '2026-08-20', shift: 'day',
      total_intake: 0, total_output: 0, net_balance: 0,
      intake_items: [] as Array<Record<string, unknown>>, output_items: [],
    };
    vi.mocked(shared.listIntakeOutput).mockImplementation(async () => [record]);
    vi.mocked(shared.createIntakeOutput).mockImplementation(async () => {
      record.total_intake = 250;
      record.net_balance = 250;
      record.intake_items = [{ category: 'oral', amount_ml: 250, notes: 'Observed oral intake', recorded_at: new Date(Date.now() - 1000).toISOString() }];
      return { id: record.id, success: true };
    });
    const rendered = render(<IntakeOutputPage />);
    await screen.findByText('Test Patient');
    fireEvent.click(screen.getByRole('button', { name: 'Quick Entry' }));
    fireEvent.change(screen.getByRole('combobox', { name: /Patient/ }), { target: { value: 'PAT-001' } });
    expect(screen.queryByText('Total Intake (24h)')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Amount/ }), { target: { value: '250' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'Observed oral intake' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Entry' }));
    await waitFor(() => expect(shared.createIntakeOutput).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'PAT-001', amount: 250 })));
    await waitFor(() => expect(shared.listIntakeOutput).toHaveBeenCalledTimes(2));
    rendered.unmount();
    render(<IntakeOutputPage />);
    fireEvent.click(await screen.findByText('Test Patient'));
    expect(screen.getAllByText('250').length).toBeGreaterThan(0);
    expect(screen.getByText('Observed oral intake')).toBeInTheDocument();
  });

  it('exports the displayed trend rows as escaped CSV', () => {
    const csv = intakeOutputTrendCsv('2026-08-20', [{
      patientId: 'PAT-001', patientName: 'Doe, Jane', mrn: 'PAT-001', room: 'Ward "A"', entries: [],
      totalIntake24h: 1800, totalOutput24h: 1500, netBalance: 300, alerts: [],
    }]);

    expect(csv).toContain('"Doe, Jane"');
    expect(csv).toContain('"Ward ""A"""');
  });

  it('keeps an empty observation window missing in the chart and CSV', () => {
    const empty = toPatientIO({ patient_id: 'QA-EMPTY', full_name: 'QA No observations' }, []);
    expect(empty.totalIntake24h).toBeNull();
    expect(empty.totalOutput24h).toBeNull();
    expect(empty.netBalance).toBeNull();
    const csv = intakeOutputTrendCsv('2026-10-16', [empty]);
    expect(csv.split('\r\n')[1]).toBe('"2026-10-16","QA No observations","QA-EMPTY","","","",""');
  });

  it('offers a user-facing retry after a failed read and restores the roster', async () => {
    vi.mocked(shared.listIntakeOutput).mockRejectedValueOnce(new Error('QA read outage'));
    render(<IntakeOutputPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load intake/output records');
    expect(screen.queryByText(/port 8090/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry I/O records' }));
    expect(await screen.findByText('Test Patient')).toBeVisible();
    expect(shared.listIntakeOutput).toHaveBeenCalledTimes(2);
  });
});
