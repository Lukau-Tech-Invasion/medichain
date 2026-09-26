import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@medichain/shared';
import type { RefillRequest } from '@medichain/shared';
import * as shared from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PRESCRIBER_ATTESTATION, RefillRequestQueue } from './RefillRequestQueue';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRefillRequestQueue: vi.fn(),
  approveRefillRequest: vi.fn(),
  denyRefillRequest: vi.fn(),
  signEPrescription: vi.fn(),
  transmitEPrescription: vi.fn(),
}));

const WAITING: RefillRequest = {
  id: 'RFR-1',
  prescription_id: 'RX-1',
  patient_id: 'PAT-001',
  medication_name: 'Amlodipine',
  status: 'requested',
  patient_note: 'Running out Friday',
  denial_reason: null,
  decided_at: null,
  new_prescription_id: null,
  created_at: '2026-09-25T09:00:00Z',
};

function renderQueue() {
  return render(
    <I18nProvider>
      <RefillRequestQueue />
    </I18nProvider>,
  );
}

describe('RefillRequestQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getRefillRequestQueue).mockResolvedValue({ success: true, requests: [WAITING] });
  });

  it('says so when nothing is waiting', async () => {
    vi.mocked(shared.getRefillRequestQueue).mockResolvedValue({ success: true, requests: [] });
    renderQueue();
    expect(await screen.findByText(/No refill requests are waiting/i)).toBeInTheDocument();
  });

  it('reports a failed load as an error, not as an empty queue', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(shared.getRefillRequestQueue).mockRejectedValue(new Error('down'));
    renderQueue();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByText(/No refill requests are waiting/i)).not.toBeInTheDocument();
  });

  it('shows the medicine, the patient and their note', async () => {
    renderQueue();
    expect(await screen.findByText('Amlodipine')).toBeInTheDocument();
    expect(screen.getByText(/PAT-001/)).toBeInTheDocument();
    expect(screen.getByText(/Running out Friday/)).toBeInTheDocument();
  });

  it('approves, then signs and sends the new prescription', async () => {
    vi.mocked(shared.approveRefillRequest).mockResolvedValue({
      success: true,
      request: { ...WAITING, status: 'approved', new_prescription_id: 'RX-NEW' },
      new_prescription_id: 'RX-NEW',
    });
    vi.mocked(shared.signEPrescription).mockResolvedValue({
      success: true, prescription_id: 'RX-NEW', status: 'Signed', signed_at: 1, message: '',
    });
    vi.mocked(shared.transmitEPrescription).mockResolvedValue({
      success: true, prescription_id: 'RX-NEW', status: 'Transmitted', transmitted_at: 1, pharmacy: '', message: '',
    });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /^Approve$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sign and send/i }));

    expect(await screen.findByText(/Signed and sent to the pharmacy/i)).toBeInTheDocument();
    expect(shared.signEPrescription).toHaveBeenCalledWith('RX-NEW', {
      signature_method: 'wallet',
      attestation: PRESCRIBER_ATTESTATION,
    });
    expect(shared.transmitEPrescription).toHaveBeenCalledWith('RX-NEW');
  });

  it('will not send a denial without a reason the patient can use', async () => {
    vi.mocked(shared.denyRefillRequest).mockResolvedValue({
      success: true,
      request: { ...WAITING, status: 'denied', denial_reason: 'Blood pressure review first.' },
    });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /^Deny$/ }));
    const reason = screen.getByLabelText(/Reason for the patient/i);
    fireEvent.change(reason, { target: { value: 'no' } });
    expect(screen.getByRole('button', { name: /Deny refill/i })).toBeDisabled();

    fireEvent.change(reason, { target: { value: 'Blood pressure review first.' } });
    fireEvent.click(screen.getByRole('button', { name: /Deny refill/i }));

    await waitFor(() =>
      expect(shared.denyRefillRequest).toHaveBeenCalledWith('RFR-1', 'Blood pressure review first.'),
    );
    expect(await screen.findByText(/The patient has been told why/i)).toBeInTheDocument();
  });

  it("shows the server's reason when an approval is refused", async () => {
    vi.mocked(shared.approveRefillRequest).mockRejectedValue(
      new Error('This request or prescription changed while you were deciding. Please reload.'),
    );
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /^Approve$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed while you were deciding/i);
    expect(screen.getByRole('button', { name: /^Approve$/ })).toBeEnabled();
  });
});
