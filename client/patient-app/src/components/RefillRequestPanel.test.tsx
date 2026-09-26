import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@medichain/shared';
import type { RefillRequest } from '@medichain/shared';
import * as shared from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RefillRequestPanel, type RefillLoadState } from './RefillRequestPanel';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestPrescriptionRefill: vi.fn(),
  cancelRefillRequest: vi.fn(),
}));

/** A refill request in `status`, with any overrides. */
function refill(status: RefillRequest['status'], overrides: Partial<RefillRequest> = {}): RefillRequest {
  return {
    id: 'RFR-1',
    prescription_id: 'RX-1',
    patient_id: 'PAT-1',
    medication_name: 'Amlodipine',
    status,
    patient_note: null,
    denial_reason: null,
    decided_at: status === 'requested' ? null : '2026-09-26T10:00:00Z',
    new_prescription_id: null,
    created_at: '2026-09-25T09:00:00Z',
    ...overrides,
  };
}

interface RenderOptions {
  latest?: RefillRequest;
  refillsRemaining?: number;
  isActive?: boolean;
  loadState?: RefillLoadState;
}

function renderPanel(options: RenderOptions = {}) {
  const onChanged = vi.fn();
  render(
    <I18nProvider>
      <RefillRequestPanel
        prescriptionId="RX-1"
        refillsRemaining={options.refillsRemaining ?? 2}
        isActive={options.isActive ?? true}
        latest={options.latest}
        loadState={options.loadState ?? 'ready'}
        onChanged={onChanged}
      />
    </I18nProvider>,
  );
  return { onChanged };
}

describe('RefillRequestPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('distinguishes loading and failure from "no request"', () => {
    const { unmount } = render(
      <I18nProvider>
        <RefillRequestPanel prescriptionId="RX-1" refillsRemaining={2} isActive loadState="loading" onChanged={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/Checking refill requests/i);
    expect(screen.queryByRole('button', { name: /Request Refill/i })).not.toBeInTheDocument();
    unmount();
    renderPanel({ loadState: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByRole('button', { name: /Request Refill/i })).not.toBeInTheDocument();
  });

  it('sends a request with the note and reports the server copy', async () => {
    const created = refill('requested', { patient_note: 'Running out Friday' });
    vi.mocked(shared.requestPrescriptionRefill).mockResolvedValue({ success: true, request: created });
    const { onChanged } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Request Refill/i }));
    fireEvent.change(screen.getByLabelText(/Note for your doctor/i), { target: { value: 'Running out Friday' } });
    fireEvent.click(screen.getByRole('button', { name: /Send refill request/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(created));
    expect(shared.requestPrescriptionRefill).toHaveBeenCalledWith('RX-1', 'Running out Friday');
  });

  it("shows the server's refusal instead of pretending the request exists", async () => {
    vi.mocked(shared.requestPrescriptionRefill).mockRejectedValue(
      new Error('A refill for this prescription has already been requested.'),
    );
    const { onChanged } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Request Refill/i }));
    fireEvent.click(screen.getByRole('button', { name: /Send refill request/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already been requested/i);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('offers to withdraw an open request, and no second request', async () => {
    const cancelled = refill('cancelled', { decided_at: '2026-09-26T10:00:00Z' });
    vi.mocked(shared.cancelRefillRequest).mockResolvedValue({ success: true, request: cancelled });
    const { onChanged } = renderPanel({ latest: refill('requested') });

    expect(screen.getByText(/Waiting for your doctor/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request Refill/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Withdraw request/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(cancelled));
    expect(shared.cancelRefillRequest).toHaveBeenCalledWith('RFR-1');
  });

  it("shows the doctor's reason when a refill was not approved", () => {
    renderPanel({ latest: refill('denied', { denial_reason: 'Blood pressure review needed first.' }) });
    expect(screen.getByText(/Refill not approved/i)).toBeInTheDocument();
    expect(screen.getByText(/Blood pressure review needed first/i)).toBeInTheDocument();
    // Still refillable, so the patient may ask again.
    expect(screen.getByRole('button', { name: /Request Refill/i })).toBeInTheDocument();
  });

  it('says plainly when no refills are left and offers no request', () => {
    renderPanel({ refillsRemaining: 0 });
    expect(screen.getByText(/No refills left/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request Refill/i })).not.toBeInTheDocument();
  });

  it('offers nothing for a prescription the patient is not on', () => {
    renderPanel({ isActive: false });
    expect(screen.queryByRole('button', { name: /Request Refill/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/No refills left/i)).not.toBeInTheDocument();
  });
});
