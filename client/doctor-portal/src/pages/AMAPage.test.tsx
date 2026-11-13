import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AMAPage from './AMAPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';
import { patientFixture, selectPatient } from '../test/selectPatient';

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
  openAccessContext: vi.fn(),
  getPatients: vi.fn(),
  listAMADischarges: vi.fn(),
  apiUrl: (path: string) => path,
}));

/**
 * Walk the AMA wizard as far as the risk-disclosure step.
 *
 * The AMA form is a four-step wizard behind a tab, not a single page: patient
 * info, medical details, risk disclosure + capacity, then signatures. Each step
 * gates the next on its own required fields, so a test that renders the page
 * and asserts on step-3 content sees only the records list.
 */
const goToRiskDisclosureStep = async () => {
  // Tabs render only once the records load resolves — before that the page is
  // a spinner, so every query below would miss.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /New AMA Form/i })).toBeInTheDocument()
  );
  fireEvent.click(screen.getByRole('button', { name: /New AMA Form/i }));

  // One picker instead of a typed id and a separately typed name.
  await selectPatient(/Select Patient/i, 'Test Patient');
  // No MRN to type: it was never sent, and the picked patient is the record.
  expect(screen.queryByLabelText(/MRN/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

  fireEvent.change(screen.getByLabelText(/Diagnosis/i), { target: { value: 'Chest pain' } });
  fireEvent.change(screen.getByLabelText(/Recommended Treatment/i), {
    target: { value: 'Admit for observation and serial troponins' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
};

describe('AMAPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.openAccessContext).mockResolvedValue({
      access_context_id: 'CTX-PAGE-QA',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    } as Awaited<ReturnType<typeof shared.openAccessContext>>);
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    // The picker can only offer patients the server knows, so a test that
    // files an AMA has to seed one.
    vi.mocked(shared.getPatients).mockResolvedValue([
      patientFixture({ patient_id: 'PAT-001', full_name: 'Test Patient' }),
    ] as never);
    vi.mocked(shared.listAMADischarges).mockResolvedValue([]);
  });

  it('renders AMA page', () => {
    render(<AMAPage />);

    expect(screen.getByText(/Against Medical Advice \(AMA\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Document patient refusal of care and AMA discharges/i)).toBeInTheDocument();
  });

  it('displays assessment sections', async () => {
    render(<AMAPage />);
    await goToRiskDisclosureStep();

    await waitFor(() =>
      expect(screen.getByText(/Decision-Making Capacity/i)).toBeInTheDocument()
    );
    // 'Risk Disclosure' is both the step-strip label and the section heading.
    expect(screen.getAllByText(/Risk Disclosure/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Each risk must be verbally explained/i)).toBeInTheDocument();
  });

  it('allows recording the capacity assessment', async () => {
    render(<AMAPage />);
    await goToRiskDisclosureStep();

    await waitFor(() =>
      expect(screen.getByLabelText(/Patient has capacity to refuse/i)).toBeInTheDocument()
    );
    const capacity = screen.getByLabelText(/Patient has capacity to refuse/i);
    expect(capacity).not.toBeChecked();

    fireEvent.click(capacity);
    expect(capacity).toBeChecked();
  });

  it('blocks signature collection until capacity is affirmed', async () => {
    render(<AMAPage />);
    await goToRiskDisclosureStep();

    // Acknowledging every risk is not sufficient on its own: an unassessed
    // patient cannot give an informed refusal, so the signature step stays
    // closed until capacity is affirmed too.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Continue to Signatures/i })).toBeDisabled()
    );

    fireEvent.click(screen.getByLabelText(/Patient has capacity to refuse/i));
    expect(screen.getByRole('button', { name: /Continue to Signatures/i })).toBeDisabled();
  });
});

describe('AMAPage register', () => {
  /** One register row, as `GET /api/platform/list/ama-discharges` serves it. */
  const row = (overrides: Partial<shared.AmaRegisterRow> = {}): shared.AmaRegisterRow => ({
    id: 'AMA-7', patient_id: 'PAT-001', created_at: '2026-11-10T08:00:00Z',
    discharge_datetime: '2026-11-10T08:00:00Z', attending_physician_id: 'doctor_a',
    diagnosis: 'Pneumonia', recommended_treatment: 'IV antibiotics',
    patient_statement: 'I need to get home', risk_level: 'high', status: 'pending-signatures',
    patient_signed: false, signature_refused_reason: null, signatures_collected_at: null,
    witness_name: 'Nurse B', witness_signed: false, provider_attested: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'doctor_a', role: 'Doctor' } });
    vi.mocked(shared.getPatients).mockResolvedValue([] as never);
  });

  const openRecord = async () => {
    render(<AMAPage />);
    fireEvent.click(await screen.findByText('Pneumonia'));
  };

  it('a discharge awaiting signatures offers the bedside signature step', async () => {
    vi.mocked(shared.listAMADischarges).mockResolvedValue([row()]);
    await openRecord();
    expect(screen.getByRole('button', { name: /Collect Signatures/i })).toBeInTheDocument();
    expect(screen.getByText(/I need to get home/)).toBeInTheDocument();
    expect(screen.getByText('IV antibiotics')).toBeInTheDocument();
  });

  it('a completed discharge does not offer it again', async () => {
    vi.mocked(shared.listAMADischarges).mockResolvedValue([row({ status: 'completed', patient_signed: true })]);
    await openRecord();
    expect(screen.queryByRole('button', { name: /Collect Signatures/i })).not.toBeInTheDocument();
  });
});
