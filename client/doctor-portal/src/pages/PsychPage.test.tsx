import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { patientProfile } from '../test/fixtures';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PsychPage from './PsychPage';
import { selectPatient } from '../test/selectPatient';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';
import { fillField, fieldValue } from '../test/fields';

const notices = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock('../components/Toast', () => ({ useToastActions: () => notices }));

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
  getPsychForPatient: vi.fn(),
  createPsych: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('PsychPage', () => {
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
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    vi.mocked(shared.getPsychForPatient).mockResolvedValue({ assessments: [] });
  });

  it('does not prefill unobserved mental status findings', () => {
    render(<PsychPage />);
    for (const label of ['Appearance', 'Behavior', 'Speech', 'Affect (observed)',
      'Thought Process', 'Cognition', 'Insight', 'Judgment']) {
      expect(screen.getByRole('textbox', { name: label })).toHaveValue('');
    }
  });

  it('asks for a patient before making any assessment-history claim', () => {
    render(<PsychPage />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('Select a patient to view their assessments')).toBeInTheDocument();
    expect(screen.queryByText('No assessments yet')).not.toBeInTheDocument();
  });

  it('removes an unsaved substance row without discarding another row', () => {
    render(<PsychPage />);
    const add = screen.getByRole('button', { name: 'Add' });
    fireEvent.click(add); fireEvent.click(add);
    fireEvent.change(screen.getByRole('textbox', { name: 'Substance 2' }), { target: { value: 'Fictional retained row' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove substance row 1' }));
    expect(screen.getByRole('textbox', { name: 'Substance 1' })).toHaveValue('Fictional retained row');
    expect(screen.queryByRole('textbox', { name: 'Substance 2' })).not.toBeInTheDocument();
    expect(shared.createPsych).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, 9007199254740992])('does not submit an invalid prior-attempt count %s', async count => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({ full_name: 'Stored Patient' })]);
    vi.mocked(shared.createPsych).mockResolvedValue({ success: true } as never);
    render(<PsychPage />);
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');
    fillField('Disposition', 'outpatient');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Prior attempts:' }), { target: { value: String(count) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    expect(shared.createPsych).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('whole number');
    expect(screen.getByRole('spinbutton', { name: 'Prior attempts:' })).toHaveValue(count);
  });

  it('requires a substance name for an added row before saving', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({ full_name: 'Stored Patient' })]);
    vi.mocked(shared.createPsych).mockResolvedValue({ success: true } as never);
    render(<PsychPage />);
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');
    fillField('Disposition', 'outpatient');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Frequency 1' }), { target: { value: 'Synthetic unspecified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    expect(shared.createPsych).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('substance name');
    expect(screen.getByRole('textbox', { name: 'Frequency 1' })).toHaveValue('Synthetic unspecified');
  });

  it('preserves unknown observations and an explicit negative with zero prior attempts', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({ full_name: 'Stored Patient' })]);
    vi.mocked(shared.createPsych).mockResolvedValue({ success: true } as never);
    render(<PsychPage />);
    expect(fieldValue('Suicidal ideation')).toBe('');
    expect(fieldValue('Legal Status')).toBe('');
    expect(screen.getByRole('spinbutton', { name: 'Prior attempts:' })).toHaveValue(null);
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');
    fillField('Suicidal ideation', 'false');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Prior attempts:' }), { target: { value: '0' } });
    fillField('Disposition', 'outpatient');
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    await waitFor(() => expect(shared.createPsych).toHaveBeenCalled());
    expect(shared.createPsych).toHaveBeenCalledWith(expect.objectContaining({
      legal_status: { admission_type: null },
      suicide_risk: expect.objectContaining({ ideation: false, plan: null, intent: null,
        access_to_means: null, attempt_count: 0, prior_attempts: false, recent_attempt: null, risk_level: null }),
      homicidal_risk: expect.objectContaining({ ideation: null, plan: null, risk_level: null }),
    }), expect.any(String));
  });

  it('locks the draft and submits once while saving', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({ full_name: 'Stored Patient' })]);
    let finish!: (value: unknown) => void;
    vi.mocked(shared.createPsych).mockImplementation(() => new Promise(resolve => { finish = resolve; }) as never);
    render(<PsychPage />);
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');
    fillField('Disposition', 'outpatient');
    const save = screen.getByRole('button', { name: 'Save Assessment' });
    try {
      act(() => { fireEvent.click(save); fireEvent.click(save); });
      expect(shared.createPsych).toHaveBeenCalledTimes(1);
      expect(save).toBeDisabled();
      expect(screen.getByRole('textbox', { name: 'Appearance' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'History' })).toBeDisabled();
    } finally {
      await act(async () => { finish({ success: true }); });
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'New assessment' })).toBeEnabled());
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(shared.createPsych).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'New assessment' }));
    expect(save).toBeEnabled();
    expect(fieldValue('Disposition')).toBe('');
    expect(fieldValue('Suicidal ideation')).toBe('');
  });

  it('reuses the complete payload and operation key when retrying an unchanged failed draft', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({ full_name: 'Stored Patient' })]);
    vi.mocked(shared.createPsych).mockRejectedValueOnce(new Error('Synthetic lost response'))
      .mockResolvedValueOnce({ success: true } as never);
    render(<PsychPage />);
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');
    fillField('Disposition', 'outpatient');
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is retained');
    const original = vi.mocked(shared.createPsych).mock.calls[0];
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    await waitFor(() => expect(shared.createPsych).toHaveBeenCalledTimes(2));
    expect(vi.mocked(shared.createPsych).mock.calls[1]).toEqual(original);
    expect(original[1]).toEqual(expect.any(String));
    await screen.findByRole('button', { name: 'New assessment' });
  });

  it('confirms an already-submitted save only through its stored actor and operation key', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({ full_name: 'Stored Patient' })]);
    let stored: unknown;
    vi.mocked(shared.getPsychForPatient).mockImplementation(async () => ({ assessments: stored ? [stored] : [] }));
    vi.mocked(shared.createPsych).mockImplementation(async (payload, key) => {
      if (!stored) {
        stored = { ...(payload as object), client_operation_id: key, assessed_by: mockUser.userId };
        throw new SyntaxError('Synthetic lost response after commit');
      }
      throw new shared.ApiClientError('Already submitted', 'IDEMPOTENCY_DUPLICATE', 409);
    });
    render(<PsychPage />);
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');
    fillField('Disposition', 'outpatient');
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save could not be confirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    await screen.findByRole('button', { name: 'New assessment' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Assessment' })).toBeDisabled();
    expect(shared.createPsych).toHaveBeenCalledTimes(2);
    expect(notices.showSuccess).toHaveBeenCalled();
  });

  it('does not confirm another actor record as the outcome of a duplicate-operation response', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({ full_name: 'Stored Patient' })]);
    vi.mocked(shared.createPsych).mockImplementation(async (_payload, key) => {
      vi.mocked(shared.getPsychForPatient).mockResolvedValue({ assessments: [
        { client_operation_id: key, assessed_by: 'another-doctor' },
      ] });
      throw new shared.ApiClientError('Already submitted', 'IDEMPOTENCY_DUPLICATE', 409);
    });
    render(<PsychPage />);
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');
    fillField('Disposition', 'outpatient');
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save could not be confirmed');
    expect(screen.queryByRole('button', { name: 'New assessment' })).not.toBeInTheDocument();
    expect(notices.showSuccess).not.toHaveBeenCalled();
  });

  it('reports a committed save separately from failed history readback', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({ full_name: 'Stored Patient' })]);
    vi.mocked(shared.createPsych).mockImplementation(async () => {
      vi.mocked(shared.getPsychForPatient).mockRejectedValue(new Error('Synthetic read failure'));
      return { success: true } as never;
    });
    render(<PsychPage />);
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');
    fillField('Disposition', 'outpatient');
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    await waitFor(() => expect(notices.showError).toHaveBeenCalledWith(expect.stringContaining('was saved, but history')));
    expect(screen.getByRole('alert')).toHaveTextContent('was saved, but history');
    expect(notices.showSuccess).not.toHaveBeenCalled();
    expect(shared.createPsych).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save Assessment' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    vi.mocked(shared.getPsychForPatient).mockResolvedValue({ assessments: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading history' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry loading history' })).not.toBeInTheDocument());
    expect(shared.createPsych).toHaveBeenCalledTimes(1);
  });

  it('keeps a refused draft with a persistent error and unlocks the form', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({ full_name: 'Stored Patient' })]);
    vi.mocked(shared.createPsych).mockRejectedValue(new Error('Synthetic save refusal'));
    render(<PsychPage />);
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');
    fillField('Disposition', 'outpatient');
    fireEvent.change(screen.getByRole('textbox', { name: 'Chief Complaint' }), { target: { value: 'Fictional retained draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is retained');
    expect(screen.getByRole('textbox', { name: 'Chief Complaint' })).toHaveValue('Fictional retained draft');
    expect(screen.getByRole('button', { name: 'Save Assessment' })).toBeEnabled();
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
    vi.mocked(shared.getPatients).mockResolvedValue([
      patientProfile({ full_name: 'Stored Patient' }),
    ]);
    vi.mocked(shared.getPsychForPatient).mockResolvedValue({
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

    render(<PsychPage />);

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
    // The chooser is a searchable combobox; a test picks the way a person does.
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');

    // The tab, not the "Psychiatric History" section heading on the form.
    fireEvent.click(screen.getByRole('button', { name: 'History' }));

    await waitFor(() => {
      expect(screen.getByText(/Stored Patient/i)).toBeInTheDocument();
    }, slow);
    // The risk badge is the element that used to throw.
    expect(screen.getAllByText(/moderate/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Assessment details'));
    expect(screen.getByText('Depressed')).toBeInTheDocument();
    expect(screen.getByText('Hopelessness, guilt')).toBeInTheDocument();
    expect(screen.getByText('sertraline 50mg')).toBeInTheDocument();
    expect(screen.getByText('Voluntary')).toBeInTheDocument();
    expect(screen.getByText('No substance entries recorded')).toBeInTheDocument();
  }, 20000);

  it('preserves collected narrative, diagnoses and safety plan after reopening', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({ full_name: 'Stored Patient' })]);
    let stored: unknown;
    vi.mocked(shared.getPsychForPatient).mockImplementation(async () => ({ assessments: stored ? [stored] : [] }));
    vi.mocked(shared.createPsych).mockImplementation(async payload => {
      stored = { ...(payload as object), assessment_id: 'PSY-SERVER', assessed_at: 1791416085 };
      return { success: true, assessment_id: 'PSY-SERVER' } as never;
    });
    const first = render(<PsychPage />);
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');
    fireEvent.change(screen.getByRole('textbox', { name: 'History of Present Illness' }), { target: { value: 'Stored synthetic history' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Additional Notes' }), { target: { value: 'Stored synthetic notes' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Prior attempts:' }), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Substance 1' }), { target: { value: 'Fictional caffeine' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Generalized Anxiety Disorder' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Follow-up appointment scheduled' }));
    fillField('Disposition', 'outpatient');
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    await waitFor(() => expect(shared.createPsych).toHaveBeenCalled());
    expect(stored).toEqual(expect.objectContaining({
      history_of_present_illness: 'Stored synthetic history', notes: 'Stored synthetic notes',
      diagnoses: ['Generalized Anxiety Disorder'], safety_plan: 'Follow-up appointment scheduled',
      safety_precautions: ['Follow-up appointment scheduled'],
      legal_status: { admission_type: null },
    }));
    first.unmount();
    render(<PsychPage />);
    await selectPatient(/Patient/i, 'Stored Patient', 'psych-patient');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByText('Stored synthetic notes')).toBeInTheDocument();
    expect(screen.getByText('Stored synthetic history')).toBeInTheDocument();
    expect(screen.getByText('Follow-up appointment scheduled')).toBeInTheDocument();
    expect(screen.getByText('Outpatient follow-up')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Assessment details'));
    expect(screen.getByText('Fictional caffeine')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
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
