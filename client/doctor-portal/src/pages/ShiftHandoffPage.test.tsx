import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { patientProfile } from '../test/fixtures';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ShiftHandoffPage from './ShiftHandoffPage';
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
  getProviders: vi.fn(),
  createShiftHandoff: vi.fn(),
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
      fireEvent.click(screen.getByRole('button', { name: 'Handoff History' }));
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
      fireEvent.click(screen.getByRole('button', { name: 'Handoff History' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge receipt' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Receipt could not be confirmed');
      fireEvent.click(screen.getByRole('button', { name: 'Acknowledge receipt' }));
      await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    } finally { read.mockRestore(); write.mockRestore(); }
  });

  it('renders shift handoff page', async () => {
    render(<ShiftHandoffPage />);

    expect(screen.getByText(/Shift Handoff \(SBAR\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Document comprehensive patient handoff information/i)).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole('button', { name: 'Handoff History' }));
      await waitFor(() => expect(screen.getByText(/Test Patient/)).toBeInTheDocument());
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

  it('displays ISBAR sections', async () => {
    render(<ShiftHandoffPage />);

    // Add a patient: the SBAR block is rendered per handoff entry.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add Patient/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Add Patient/i }));
    // The picker is a list of clickable patients, not a <select>.
    fireEvent.click(screen.getByText(/Test Patient/i));
    fireEvent.click(screen.getByRole('button', { name: /Add to Handoff/i }));
    expect(screen.getByRole('combobox', { name: 'Code Status' })).toHaveValue('Not recorded');


    // Each SBAR heading also appears in the section legend, so a
    // single-element matcher is ambiguous by construction.
    await waitFor(() =>
      expect(screen.getAllByText(/Situation/i).length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText(/Background/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Assessment/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Recommendation/i).length).toBeGreaterThan(0);
  });

  it('allows entering situation', async () => {
    render(<ShiftHandoffPage />);

    // Add a patient: the SBAR block is rendered per handoff entry.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add Patient/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Add Patient/i }));
    // The picker is a list of clickable patients, not a <select>.
    fireEvent.click(screen.getByText(/Test Patient/i));
    fireEvent.click(screen.getByRole('button', { name: /Add to Handoff/i }));


    const input = screen.getByLabelText(/Situation/i);
    fireEvent.change(input, { target: { value: 'Patient admitted with chest pain.' } });
    expect(input).toHaveValue('Patient admitted with chest pain.');
  });

  it('sends the selected nurse account and no uncollected admission date', async () => {
    render(<ShiftHandoffPage />);
    expect(screen.getByLabelText('Outgoing Nurse')).toHaveValue('Nurse QA Sender');
    fireEvent.change(screen.getByRole('textbox', { name: /Incoming Nurse/ }), { target: { value: 'QA Recipient' } });
    fireEvent.click(await screen.findByRole('button', { name: /Nurse QA Recipient/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add First Patient' }));
    fireEvent.click(await screen.findByText('Test Patient'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Handoff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Handoff' }));
    await waitFor(() => expect(shared.createShiftHandoff).toHaveBeenCalledOnce());
    const payload = vi.mocked(shared.createShiftHandoff).mock.calls[0][0] as {
      outgoing_nurse: string; incoming_nurse: string; patients: Record<string, unknown>[];
    };
    expect(payload.outgoing_nurse).toBe(mockUser.userId);
    expect(payload.incoming_nurse).toBe('qa-recipient-id');
    expect(payload.patients[0]).not.toHaveProperty('admitDate');
  });

  it('reports unavailable history without an empty claim and retries the read', async () => {
    const request = vi.spyOn(shared.getApiClient(), 'get')
      .mockRejectedValueOnce(new Error('QA history outage')).mockResolvedValueOnce([]);
    try {
      render(<ShiftHandoffPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Handoff History' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Handoff history could not be loaded');
      expect(screen.queryByText('No handoff history available.')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry handoff history' }));
      expect(await screen.findByText('No handoff history available.')).toBeVisible();
      expect(request).toHaveBeenCalledTimes(2);
    } finally { request.mockRestore(); }
  });

  it('requires a fresh recipient selection after the selected nurse is cleared', async () => {
    render(<ShiftHandoffPage />);
    fireEvent.change(screen.getByRole('textbox', { name: /Incoming Nurse/ }), { target: { value: 'QA Recipient' } });
    fireEvent.click(await screen.findByRole('button', { name: /Nurse QA Recipient/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selected staff' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Incoming Nurse/ }), { target: { value: 'Unresolved QA recipient' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add First Patient' }));
    fireEvent.click(await screen.findByText('Test Patient'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Handoff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Handoff' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(shared.createShiftHandoff).not.toHaveBeenCalled();
  });
});
