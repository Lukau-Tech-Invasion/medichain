import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { patientProfile } from '../test/fixtures';
import * as shared from '@medichain/shared';
import { selectPatient } from '../test/selectPatient';
import { useAuthStore } from '../store/authStore';

vi.mock('../store/authStore', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()), useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  createPeds: vi.fn(),
  listPedsForPatient: vi.fn(),
  openAccessContext: vi.fn(),
}));

const isoMonthsAgo = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
};

beforeEach(() => {
  // jsdom does not implement native dialog opening; keyboard containment is verified in Chrome.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  vi.clearAllMocks();
  vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'QA-Doctor', role: 'Doctor' } });
  vi.mocked(shared.openAccessContext).mockResolvedValue({ access_context_id: 'QA-PEDS',
    expires_at: new Date(Date.now() + 3600000).toISOString() } as never);
  vi.mocked(shared.createPeds).mockResolvedValue({ success: true } as never);
  vi.mocked(shared.listPedsForPatient).mockResolvedValue([]);
  // The page filters the patient register to under-18s by date of birth. It
  // used to ship two invented children instead of reading the register at all.
  vi.mocked(shared.getPatients).mockResolvedValue([
    patientProfile({ patient_id: 'PED-001', full_name: 'Yusuf Al-Rashid', date_of_birth: isoMonthsAgo(8), gender: 'male' }),
    patientProfile({ patient_id: 'PED-002', full_name: 'Sara Hassan', date_of_birth: isoMonthsAgo(54), gender: 'female' }),
    patientProfile({ patient_id: 'ADT-001', full_name: 'Adult Patient', date_of_birth: isoMonthsAgo(420), gender: 'male' }),
  ]);
});
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PediatricsPage from './PediatricsPage';

describe('PediatricsPage', () => {
  it('loads older measurements into the same history instead of replacing newer records', async () => {
    vi.mocked(shared.listPedsForPatient).mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({
      age_months: 12, assessment_datetime: '2025-07-15T10:00:00Z', data: { weight_kg: 10 + i / 100 },
    }))).mockResolvedValueOnce([{ age_months: 6, assessment_datetime: '2025-01-15T10:00:00Z', data: { weight_kg: 7 } }]);
    render(<PediatricsPage />);
    fireEvent.click(await screen.findByText('Sara Hassan'));
    fireEvent.click(await screen.findByRole('button', { name: 'Load older measurements' }));
    expect(await screen.findByText(/^6 months: 7 kg;/)).toBeInTheDocument();
    expect(screen.getByText(/^12 months: 10 kg;/)).toBeInTheDocument();
    expect(shared.listPedsForPatient).toHaveBeenLastCalledWith('PED-002', 2);
    expect(screen.getAllByRole('row')).toHaveLength(102);
    expect(screen.queryByRole('button', { name: 'Load older measurements' })).not.toBeInTheDocument();
    expect(shared.createPeds).not.toHaveBeenCalled();
  });

  it('names the growth dialog and returns focus when the native cancel event closes it', async () => {
    render(<PediatricsPage />);
    const name = await screen.findByText('Sara Hassan');
    const card = name.closest('[role="button"]') as HTMLElement;
    card.focus();
    fireEvent.click(card);
    const dialog = await screen.findByRole('dialog', { name: 'Sara Hassan' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog', { name: 'Sara Hassan' })).not.toBeInTheDocument();
    expect(card).toHaveFocus();
  });

  it('charts the accumulated six- and twelve-month records without changing either assessment', async () => {
    const history = [{ age_months: 12, assessment_datetime: '2025-07-15T10:00:00Z', data: { weight_kg: 10, length_cm: 75 } },
      { age_months: 6, assessment_datetime: '2025-01-15T10:00:00Z', data: { weight_kg: 7, length_cm: 65 } }];
    vi.mocked(shared.listPedsForPatient).mockResolvedValue(history);
    render(<PediatricsPage />);
    await screen.findByText('Sara Hassan');
    fireEvent.click(screen.getByRole('button', { name: 'Growth Charts' }));
    fireEvent.click(screen.getByRole('button', { name: 'View growth history for Sara Hassan' }));
    expect(await screen.findByRole('img', { name: 'Weight by recorded age in months' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Height by recorded age in months' })).toBeInTheDocument();
    expect(screen.getByText(/^6 months: 7 kg;/)).toBeInTheDocument();
    expect(screen.getByText(/^12 months: 10 kg;/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /12 10 kg 75 cm/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /6 7 kg 65 cm/ })).toBeInTheDocument();
    expect(shared.createPeds).not.toHaveBeenCalled();
    expect(history[1].data.weight_kg).toBe(7);
  });

  it.each([false, true])('refreshes the saved summary without retaining old measurements, read failure %s', async failRead => {
    vi.mocked(shared.listPedsForPatient).mockResolvedValueOnce([{ data: { weight_kg: 17 } }]);
    render(<PediatricsPage />);
    fireEvent.click(await screen.findByText('Sara Hassan'));
    expect((await screen.findAllByText('17 kg')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Close growth details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    await selectPatient(/Patient/i, 'Sara Hassan', 'peds-patient');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight (kg) *' }), { target: { value: '18' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Heart Rate *' }), { target: { value: '90' } });
    if (failRead) vi.mocked(shared.listPedsForPatient).mockRejectedValueOnce(new Error('Synthetic read failure'));
    else vi.mocked(shared.listPedsForPatient).mockResolvedValueOnce([{ data: { weight_kg: 18 } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Sign & Submit Assessment' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign & Submit Assessment' })).not.toBeInTheDocument());
    expect(screen.queryByText('17 kg')).not.toBeInTheDocument();
    if (failRead) {
      expect(screen.getByRole('alert')).toHaveTextContent('Assessment saved. Growth summary could not be refreshed');
      fireEvent.click(screen.getByText('Yusuf Al-Rashid'));
      await screen.findByText('No growth measurements recorded');
      expect(screen.getByRole('alert')).toHaveTextContent('Assessment saved. Growth summary could not be refreshed');
      fireEvent.click(screen.getByRole('button', { name: 'Close growth details' }));
      vi.mocked(shared.listPedsForPatient).mockResolvedValueOnce([{ data: { weight_kg: 18 } }]);
      fireEvent.click(screen.getByText('Sara Hassan'));
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
      expect(screen.getAllByText('18 kg').length).toBeGreaterThan(0);
    } else expect(screen.getByText('18 kg')).toBeInTheDocument();
    expect(shared.createPeds).toHaveBeenCalledTimes(1);
  });

  it.each(['QA-Doctor', 'another-doctor'])('confirms a duplicate operation only for the matching actor %s', async actor => {
    let operationKey = '';
    vi.mocked(shared.createPeds).mockImplementation(async (_payload, key) => {
      operationKey = key ?? '';
      throw new shared.ApiClientError('Already submitted', 'IDEMPOTENCY_DUPLICATE', 409);
    });
    vi.mocked(shared.listPedsForPatient).mockImplementation(async () => [{
      assessed_by: actor, data: { client_operation_id: operationKey },
    }]);
    render(<PediatricsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    await selectPatient(/Patient/i, 'Sara Hassan', 'peds-patient');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight (kg) *' }), { target: { value: '18' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Heart Rate *' }), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign & Submit Assessment' }));
    if (actor === 'QA-Doctor') {
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign & Submit Assessment' })).not.toBeInTheDocument());
    } else {
      expect(await screen.findByRole('alert')).toHaveTextContent('Save could not be confirmed');
      expect(screen.getByRole('spinbutton', { name: 'Weight (kg) *' })).toHaveValue(18);
    }
    expect(shared.createPeds).toHaveBeenCalledTimes(1);
  });

  it('submits once and locks the draft while saving', async () => {
    let finish!: (result: unknown) => void;
    vi.mocked(shared.createPeds).mockImplementation(() => new Promise(resolve => { finish = resolve; }) as never);
    render(<PediatricsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    await selectPatient(/Patient/i, 'Sara Hassan', 'peds-patient');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight (kg) *' }), { target: { value: '18' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Heart Rate *' }), { target: { value: '90' } });
    const submit = screen.getByRole('button', { name: 'Sign & Submit Assessment' });
    try {
      act(() => { fireEvent.click(submit); fireEvent.click(submit); });
      expect(shared.createPeds).toHaveBeenCalledTimes(1);
      expect(submit).toBeDisabled();
      expect(screen.getByRole('textbox', { name: 'Notes' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'All Patients' })).toBeDisabled();
    } finally { await act(async () => finish({ success: true })); }
  });

  it('retains an uncertain draft and reuses its payload and operation key', async () => {
    vi.mocked(shared.createPeds).mockRejectedValueOnce(new Error('Synthetic lost response'))
      .mockResolvedValueOnce({ success: true } as never);
    render(<PediatricsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    await selectPatient(/Patient/i, 'Sara Hassan', 'peds-patient');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight (kg) *' }), { target: { value: '18' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Heart Rate *' }), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign & Submit Assessment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save could not be confirmed');
    expect(screen.getByRole('spinbutton', { name: 'Weight (kg) *' })).toHaveValue(18);
    fireEvent.click(screen.getByRole('button', { name: 'Sign & Submit Assessment' }));
    await waitFor(() => expect(shared.createPeds).toHaveBeenCalledTimes(2));
    expect(vi.mocked(shared.createPeds).mock.calls[0]).toEqual(vi.mocked(shared.createPeds).mock.calls[1]);
    expect(vi.mocked(shared.createPeds).mock.calls[0][1]).toEqual(expect.any(String));
  });

  it('explains a care-relationship refusal without offering an ineffective retry', async () => {
    vi.mocked(shared.listPedsForPatient).mockRejectedValueOnce(
      new shared.ApiClientError('Refused', 'CARE_RELATIONSHIP_REQUIRED', 403));
    render(<PediatricsPage />);
    fireEvent.click(await screen.findByText('Yusuf Al-Rashid'));
    expect(await screen.findByRole('alert')).toHaveTextContent('A care relationship is required to view this history');
    expect(screen.queryByRole('button', { name: 'Retry loading growth history' })).not.toBeInTheDocument();
    expect(shared.createPeds).not.toHaveBeenCalled();
  });

  it('does not show a late response for a different selected child', async () => {
    let resolveFirst!: (rows: unknown[]) => void;
    vi.mocked(shared.listPedsForPatient)
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([{ data: { weight_kg: 18, length_cm: 110 } }]);
    render(<PediatricsPage />);
    fireEvent.click(await screen.findByText('Yusuf Al-Rashid'));
    expect(await screen.findByRole('status')).toHaveTextContent('Loading recorded growth history');
    fireEvent.click(screen.getByRole('button', { name: 'Close growth details' }));
    fireEvent.click(screen.getByText('Sara Hassan'));
    expect((await screen.findAllByText('110 cm')).length).toBeGreaterThan(0);
    await act(async () => resolveFirst([{ data: { weight_kg: 50, length_cm: 999 } }]));
    expect(screen.queryByText('999 cm')).not.toBeInTheDocument();
    expect(shared.createPeds).not.toHaveBeenCalled();
  });

  it('distinguishes failed history from empty history and retries without creating a record', async () => {
    vi.mocked(shared.listPedsForPatient).mockRejectedValueOnce(new Error('Synthetic unavailable history'));
    render(<PediatricsPage />);
    fireEvent.click(await screen.findByText('Yusuf Al-Rashid'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Growth history could not be loaded');
    expect(screen.queryByText('No growth measurements recorded')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading growth history' }));
    expect(await screen.findByText('No growth measurements recorded')).toBeInTheDocument();
    expect(shared.createPeds).not.toHaveBeenCalled();
  });

  it('reads the recorded length and date without inventing percentiles', async () => {
    vi.mocked(shared.listPedsForPatient).mockResolvedValue([{
      assessment_datetime: '2020-01-02T12:00:00Z',
      immunizations_up_to_date: true,
      data: { weight_kg: 25, length_cm: 128, developmental_status: 'monitor' },
    }]);
    render(<PediatricsPage />);
    fireEvent.click(await screen.findByText('Yusuf Al-Rashid'));
    expect((await screen.findAllByText('128 cm')).length).toBeGreaterThan(0);
    expect(screen.queryByText('0 cm')).not.toBeInTheDocument();
    expect(screen.queryByText('0th percentile')).not.toBeInTheDocument();
    expect(screen.getByText(new Date('2020-01-02T12:00:00Z').toLocaleDateString())).toBeInTheDocument();
    expect(screen.getAllByText('monitor').length).toBeGreaterThan(0);
    expect(screen.getByText('Vaccines: Up to date')).toBeInTheDocument();
  });

  it('does not infer gender, overdue vaccines or on-track development from missing data', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({
      patient_id: 'PED-UNKNOWN', full_name: 'Fictional unknown child', date_of_birth: isoMonthsAgo(54), gender: '',
    })]);
    render(<PediatricsPage />);
    fireEvent.click(await screen.findByText('Fictional unknown child'));
    expect(screen.queryByText('on track')).not.toBeInTheDocument();
    expect(screen.queryByText('Vaccines: Overdue')).not.toBeInTheDocument();
    expect(screen.getByText(/Gender not recorded/)).toBeInTheDocument();
  });

  it('submits the chosen patient and keeps unassessed observations unknown', async () => {
    render(<PediatricsPage />);
    fireEvent.click(await screen.findByText('Yusuf Al-Rashid'));
    fireEvent.click(screen.getByRole('button', { name: 'Close growth details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    await selectPatient(/Patient/i, 'Sara Hassan', 'peds-patient');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight (kg) *' }), { target: { value: '18' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Heart Rate *' }), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign & Submit Assessment' }));
    await waitFor(() => expect(shared.createPeds).toHaveBeenCalledWith(expect.objectContaining({
      patient_id: 'PED-002', age_months: 54, appearance_score: null, work_of_breathing: null, circulation_to_skin: null,
      developmental_status: null, developmental_concerns: null,
      pediatric_triangle: expect.objectContaining({ appearance: null, work_of_breathing: null, circulation: null }),
    }), expect.any(String)));
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    expect(screen.getByRole('combobox', { name: 'Appearance' })).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Not assessed' })).toBeChecked();
  });

  it('names every missing required field instead of refusing silently', async () => {
    render(<PediatricsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign & Submit Assessment' }));
    expect(await screen.findByText('Enter a patient')).toBeInTheDocument();
    expect(screen.getByText('Enter the heart rate')).toBeInTheDocument();
    expect(shared.createPeds).not.toHaveBeenCalled();
  });

  it('does not preselect unobserved pediatric findings', () => {
    render(<PediatricsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    for (const label of ['Appearance', 'Work of Breathing', 'Circulation']) {
      expect(screen.getByRole('combobox', { name: label })).toHaveValue('');
    }
    expect(screen.getByRole('radio', { name: 'Not assessed' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'on track' })).not.toBeChecked();
  });

  it('renders pediatrics page', () => {
    render(<PediatricsPage />);

    expect(screen.getByText(/Pediatric Assessment/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search by name or MRN/i)).toBeInTheDocument();
  });

  it('lists only paediatric patients from the register', async () => {
    render(<PediatricsPage />);

    await waitFor(() =>
      expect(screen.getByText(/Yusuf Al-Rashid/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Sara Hassan/i)).toBeInTheDocument();
    // Over 18: paediatrics does not chart them.
    expect(screen.queryByText(/Adult Patient/i)).not.toBeInTheDocument();
  });

  it('allows selecting a patient', async () => {
    render(<PediatricsPage />);

    const patient = await screen.findByText(/Yusuf Al-Rashid/i);
    fireEvent.click(patient);

    // Selecting a child opens their growth panel. An 8-month-old with no
    // recorded assessment shows dashes, not a fabricated curve.
    await waitFor(() =>
      expect(screen.getAllByText(/Growth/i).length).toBeGreaterThan(0)
    );
  });
});
