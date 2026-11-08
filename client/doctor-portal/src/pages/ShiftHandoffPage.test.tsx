import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { patientProfile } from '../test/fixtures';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ShiftHandoffPage from './ShiftHandoffPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';
import { selectPatient } from '../test/selectPatient';

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
  openAccessContext: vi.fn().mockResolvedValue({ access_context_id: 'CTX-TEST', expires_at: '2099-01-01T00:00:00Z' }),
  getPatients: vi.fn(),
  getProviders: vi.fn(),
  createShiftHandoff: vi.fn(),
  getShiftHandoffDraft: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('ShiftHandoffPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    username: 'Nurse QA Sender',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    // SBAR fields render per patient added to the handoff, so the picker
    // needs at least one patient to choose.
    vi.mocked(shared.getPatients).mockResolvedValue([
      patientProfile(),
    ]);
    vi.mocked(shared.getProviders).mockResolvedValue({ success: true, count: 1, providers: [
      { user_id: 'qa-recipient-id', name: 'Nurse QA Recipient', role: 'Nurse' },
    ] });
    vi.mocked(shared.createShiftHandoff).mockResolvedValue({ success: true } as never);
    vi.mocked(shared.getShiftHandoffDraft).mockResolvedValue({ since: '2026-11-08T05:00:00Z', patients: [] });
    shared.clearAllDrafts();
  });

  it('acknowledges only incoming records and rereads the authoritative receipt', async () => {
    const saved = { id: 'QA-receipt', patient_id: 'PAT-001', incoming_provider_id: mockUser.userId,
      outgoing_provider_id: 'QA-other', handoff_datetime: '2026-10-16T17:00:00Z',
      acknowledged_by_incoming: false, situation: 'Synthetic receipt situation' };
    const read = vi.spyOn(shared.getApiClient(), 'get').mockResolvedValueOnce([saved])
      .mockResolvedValue([{ ...saved, acknowledged_by_incoming: true, acknowledged_at: '2026-10-16T18:00:00Z' }]);
    const write = vi.spyOn(shared.getApiClient(), 'put').mockResolvedValue({});
    try {
      render(<ShiftHandoffPage />);
      fireEvent.click(screen.getByRole('tab', { name: 'Handoff History' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge receipt' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Acknowledge receipt' })).not.toBeInTheDocument());
      expect(write).toHaveBeenCalledWith('/api/emergency/handoff/QA-receipt/receipt', {});
      expect(await screen.findByText(/Receipt acknowledged:/)).toBeVisible();
      expect(read).toHaveBeenCalledTimes(2);
    } finally { read.mockRestore(); write.mockRestore(); }
  });

  it('retains pending history and permits retry when receipt fails', async () => {
    const saved = { id: 'QA-retry', patient_id: 'PAT-001', incoming_provider_id: mockUser.userId,
      outgoing_provider_id: 'QA-other', handoff_datetime: '2026-10-16T17:00:00Z', acknowledged_by_incoming: false };
    const read = vi.spyOn(shared.getApiClient(), 'get').mockResolvedValue([saved]);
    const write = vi.spyOn(shared.getApiClient(), 'put').mockRejectedValueOnce(new Error('QA outage')).mockResolvedValue({});
    try {
      render(<ShiftHandoffPage />);
      fireEvent.click(screen.getByRole('tab', { name: 'Handoff History' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge receipt' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Receipt could not be confirmed');
      fireEvent.click(screen.getByRole('button', { name: 'Acknowledge receipt' }));
      await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    } finally { read.mockRestore(); write.mockRestore(); }
  });

  it('renders shift handoff page', async () => {
    render(<ShiftHandoffPage />);

    expect(screen.getByRole('heading', { name: /Shift Handoff \(SBAR\)/i })).toBeInTheDocument();
    // Who is handing over is the signed-in nurse, named in the header.
    expect(screen.getByText(/Nurse QA Sender/)).toBeInTheDocument();
    expect(await screen.findByText('No other patients this shift.')).toBeInTheDocument();
  });

  it('reads the stored handoff DTO and displays its saved SBAR without crashing', async () => {
    const request = vi.spyOn(shared.getApiClient(), 'get').mockResolvedValue([{
      id: 'HO-QA-PAT-001', patient_id: 'PAT-001',
      outgoing_provider_id: 'nurse-kabelo', incoming_provider_id: 'nurse-nomsa',
      handoff_datetime: '2026-10-08T22:06:00Z', location_from: 'Medical-Surgical',
      code_status: 'Not recorded', acknowledged_by_incoming: false,
      situation: 'Synthetic saved situation', background: 'Synthetic saved background',
      assessment: 'Synthetic saved assessment', recommendation: 'Synthetic saved recommendation',
      data: { shift_direction: 'day-to-evening', patient: { patient_name: 'Synthetic Patient',
        room: 'QA-01', ivAccess: 'Synthetic IV observation', diet: 'Unassessed diet',
        activity: 'Synthetic activity note', pendingLabs: 'Synthetic pending lab',
        pendingTests: 'Synthetic pending test', pendingOrders: 'Synthetic pending order',
        familyUpdates: 'No real communication performed', additionalNotes: 'Saved QA detail',
        medications: { scheduled: 'Synthetic scheduled note', prn: 'Synthetic PRN note', drips: 'Synthetic infusion note' },
      } },
    }]);
    try {
      render(<ShiftHandoffPage />);
      fireEvent.click(screen.getByRole('tab', { name: 'Handoff History' }));
      // The name saved with the handoff, not whatever the directory says today.
      await waitFor(() => expect(screen.getByText(/Synthetic Patient/)).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Acknowledge receipt' })).not.toBeInTheDocument();
      expect(screen.getAllByText('Day → Evening')).toHaveLength(1);
      expect(screen.getByText('Synthetic saved situation')).toBeInTheDocument();
      expect(screen.getByText('nurse-kabelo')).toBeInTheDocument();
      expect(screen.getByText('nurse-nomsa')).toBeInTheDocument();
      expect(screen.queryByText(/2026-10-08T22:06:00Z/)).not.toBeInTheDocument();
      expect(screen.getByText('Saved QA detail')).toBeInTheDocument();
      expect(screen.getByText('Synthetic pending order')).toBeInTheDocument();
      expect(screen.getByText('Synthetic infusion note')).toBeInTheDocument();
      expect(screen.getByText('Synthetic IV observation')).toBeInTheDocument();
    } finally {
      request.mockRestore();
    }
  });

  /** Add a patient by hand, the way a nurse covering another bay would. */
  async function addByHand() {
    fireEvent.click(await screen.findByRole('button', { name: 'Add another patient' }));
    await selectPatient('', 'Test Patient', 'handoff-add-patient');
    fireEvent.click(screen.getByRole('button', { name: /Add to Handoff/i }));
  }

  async function chooseRecipient() {
    fireEvent.change(screen.getByRole('textbox', { name: /Incoming Nurse/ }), { target: { value: 'QA Recipient' } });
    fireEvent.click(await screen.findByRole('button', { name: /Nurse QA Recipient/ }));
  }

  it('displays ISBAR sections, with the rest of the record folded beneath', async () => {
    render(<ShiftHandoffPage />);
    await addByHand();
    for (const section of ['Situation', 'Background', 'Assessment', 'Recommendation']) {
      expect(screen.getByRole('group', { name: new RegExp(section, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: 'Code Status' })).toHaveValue('Not recorded');
  });

  it('allows entering situation', async () => {
    render(<ShiftHandoffPage />);
    await addByHand();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Situation' }));
    const input = screen.getByRole('textbox', { name: /Situation, line 1/i });
    fireEvent.change(input, { target: { value: 'Patient admitted with chest pain.' } });
    expect(input).toHaveValue('Patient admitted with chest pain.');
  });

  it('sends the selected nurse account and no uncollected admission date', async () => {
    render(<ShiftHandoffPage />);
    await chooseRecipient();
    await addByHand();
    fireEvent.click(screen.getByRole('button', { name: 'Hand over 1 patient' }));
    await waitFor(() => expect(shared.createShiftHandoff).toHaveBeenCalledOnce());
    const payload = vi.mocked(shared.createShiftHandoff).mock.calls[0][0] as {
      outgoing_nurse: string; incoming_nurse: string; patients: Record<string, unknown>[];
    };
    expect(payload.outgoing_nurse).toBe(mockUser.userId);
    expect(payload.incoming_nurse).toBe('qa-recipient-id');
    expect(payload.patients[0]).not.toHaveProperty('admitDate');
    // Nobody made the stability call or wrote a to-do: neither is sent.
    expect(payload.patients[0]).not.toHaveProperty('stability');
    expect(payload.patients[0]).not.toHaveProperty('todos');
  });

  it('drafts each patient from the shift, with where every line came from', async () => {
    vi.mocked(shared.getShiftHandoffDraft).mockResolvedValue({ since: '2026-11-08T05:00:00Z', patients: [
      { patient_id: 'PAT-A', full_name: 'Thandiwe Nkosi', date_of_birth: null, bed_label: '12',
        recorded: [{ resource_type: 'vital_signs', count: 14, last_at: null }], content: 'included',
        sbar: {
          situation: [{ text: 'BP 148/92 · HR 104', source: 'vitals', at: '2026-11-08T14:00:00Z' }],
          background: [{ text: 'Allergies: Penicillin', source: 'chart', at: null }],
          assessment: [], recommendation: [{ text: 'HbA1c — lab order pending', source: 'order', at: null }],
        } },
      { patient_id: 'PAT-B', full_name: 'Sipho Mabaso', date_of_birth: null, bed_label: '14',
        recorded: [{ resource_type: 'mar', count: 9, last_at: null }], content: 'included',
        sbar: { situation: [], background: [], assessment: [], recommendation: [] } },
      { patient_id: 'PAT-C', full_name: 'Lerato Molefe', date_of_birth: null, bed_label: '19',
        recorded: [], content: 'not_permitted', sbar: null },
    ] });
    render(<ShiftHandoffPage />);
    expect(await screen.findByRole('textbox', { name: /Situation, line 1/i })).toHaveValue('BP 148/92 · HR 104');
    expect(screen.getByText(/^Vitals/)).toBeInTheDocument();
    expect(screen.getByText('Chart')).toBeInTheDocument();
    // Charted this shift: handed over unless unticked. Nothing charted: listed, not ticked.
    expect(screen.getByRole('checkbox', { name: 'Hand over Thandiwe Nkosi' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Hand over Lerato Molefe' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Select all (2 of 3)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Watch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Recommendation, line 2/i }), { target: { value: 'Repeat BP at 20:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next patient' }));
    // On to the next patient still to review.
    expect(await screen.findByRole('heading', { name: /Sipho Mabaso/ })).toBeInTheDocument();
    expect(screen.getByText('Draft kept on this tab')).toBeInTheDocument();

    await chooseRecipient();
    fireEvent.click(screen.getByRole('button', { name: 'Hand over 2 patients' }));
    await waitFor(() => expect(shared.createShiftHandoff).toHaveBeenCalledOnce());
    const payload = vi.mocked(shared.createShiftHandoff).mock.calls[0][0] as { patients: Array<Record<string, unknown>> };
    expect(payload.patients.map((p) => p.patientId)).toEqual(['PAT-A', 'PAT-B']);
    expect(payload.patients[0]).toMatchObject({
      stability: 'watch',
      todos: ['HbA1c — lab order pending', 'Repeat BP at 20:00'],
      sbar: { situation: 'BP 148/92 · HR 104', background: 'Allergies: Penicillin' },
    });
  });

  it('reports unavailable history without an empty claim and retries the read', async () => {
    const request = vi.spyOn(shared.getApiClient(), 'get')
      .mockRejectedValueOnce(new Error('QA history outage')).mockResolvedValueOnce([]);
    try {
      render(<ShiftHandoffPage />);
      fireEvent.click(screen.getByRole('tab', { name: 'Handoff History' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Handoff history could not be loaded');
      expect(screen.queryByText('No handoff history available.')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry handoff history' }));
      expect(await screen.findByText('No handoff history available.')).toBeVisible();
      expect(request).toHaveBeenCalledTimes(2);
    } finally { request.mockRestore(); }
  });

  it('requires a fresh recipient selection after the selected nurse is cleared', async () => {
    render(<ShiftHandoffPage />);
    await chooseRecipient();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selected staff' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Incoming Nurse/ }), { target: { value: 'Unresolved QA recipient' } });
    await addByHand();
    fireEvent.click(screen.getByRole('button', { name: 'Hand over 1 patient' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(shared.createShiftHandoff).not.toHaveBeenCalled();
  });
});
