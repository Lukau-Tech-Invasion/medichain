import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BloodInventoryPanel } from './BloodInventoryPanel';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function answer(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  });
}

const UNIT = {
  id: 'BU-1', unit_number: 'ZA1000001', product_type: 'PackedRBC', abo: 'O', rh: 'negative',
  collected_on: '2026-09-01', expires_on: '2026-09-28', status: 'available', location: 'Fridge 2',
  reserved_for_patient_id: null, crossmatch_reference: null, issued_to_patient_id: null,
  transfusion_id: null, discard_reason: null,
};
const SUMMARY = {
  stock: [{ product_type: 'PackedRBC', abo: 'O', rh: 'negative', available: 1 }],
  expiring_unit_ids: ['BU-1'], low_stock_groups: ['O negative', 'A positive'],
  expiry_warning_days: 3, low_stock_units: 2, thresholds_are_defaults: true,
};

function renderPanel(canManage: boolean) {
  render(<I18nProvider><BloodInventoryPanel canManage={canManage} /></I18nProvider>);
}

describe('BloodInventoryPanel', () => {
  beforeEach(() => mockFetch.mockReset());

  it('shows stock, alerts, and that the thresholds are not clinically approved', async () => {
    mockFetch.mockImplementation(() => answer(200, { success: true, units: [UNIT], summary: SUMMARY }));
    renderPanel(false);
    expect(await screen.findByText(/1 unit\(s\) expire within 3 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Low red-cell stock .*O negative, A positive/i)).toBeInTheDocument();
    expect(screen.getByText(/have not been clinically approved/i)).toBeInTheDocument();
    expect(screen.getByText('Expires soon')).toBeInTheDocument();
  });

  it('offers no stock changes to staff outside the blood bank', async () => {
    mockFetch.mockImplementation(() => answer(200, { success: true, units: [UNIT], summary: SUMMARY }));
    renderPanel(false);
    await screen.findByText('ZA1000001');
    expect(screen.queryByRole('button', { name: /Reserve for patient/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Receive a unit/i)).not.toBeInTheDocument();
  });

  it("reserves a unit and shows the server's refusal when the group is incompatible", async () => {
    mockFetch.mockImplementation((raw: unknown) =>
      String(raw).includes('/reserve')
        ? answer(409, { error: { code: 'ABO_INCOMPATIBLE', message: "This unit is not compatible with the patient's recorded blood group." } })
        : answer(200, { success: true, units: [UNIT], summary: SUMMARY }),
    );
    renderPanel(true);
    fireEvent.click(await screen.findByRole('button', { name: /Reserve for patient/i }));
    fireEvent.change(screen.getByLabelText(/Patient ID/i), { target: { value: 'PAT-1' } });
    fireEvent.change(screen.getByLabelText(/Crossmatch reference/i), { target: { value: 'XM-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not compatible/i);
    const reserve = mockFetch.mock.calls.find(([url]) => String(url).includes('/reserve'));
    expect(JSON.parse(String((reserve?.[1] as RequestInit).body))).toEqual({ patient_id: 'PAT-1', crossmatch_reference: 'XM-1' });
  });

  it('reports a failed load as an error, not as empty stock', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetch.mockImplementation(() => answer(403, { error: { code: 'FORBIDDEN', message: 'Access denied' } }));
    renderPanel(true);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i));
    expect(screen.queryByText(/No units are available/i)).not.toBeInTheDocument();
  });
});
