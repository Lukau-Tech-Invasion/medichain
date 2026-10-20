import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as shared from '@medichain/shared';
import NFCTapSimulator from './NFCTapSimulator';
import { useAuthStore, usePatientStore } from '../store';

/**
 * The QR path of emergency access: a scanned code reaches the same server
 * grant an NFC tap does, and the code's own summary is shown only when the
 * server cannot be reached or the code predates access by QR.
 */

let scanned = '';
vi.mock('@medichain/shared', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // The camera cannot run in jsdom; this stand-in "reads" whatever the test set.
  QrScanner: ({ onResult }: { onResult: (text: string) => void }) => (
    <button type="button" onClick={() => onResult(scanned)}>
      read code
    </button>
  ),
  listUsableDevices: vi.fn(),
  enterWorkContext: vi.fn(),
  grantBoundEmergencyAccess: vi.fn(),
}));
vi.mock('../store', () => ({ usePatientStore: vi.fn(), useAuthStore: vi.fn() }));

const medicalIdQr = (proof: string | undefined) =>
  JSON.stringify({
    type: 'medichain_medical_id',
    patient_id: 'PAT-1',
    name: 'Ayanda Ngcobo',
    blood_type: 'AB+',
    critical_allergies: ['latex'],
    emergency_contact: { name: 'Nomvula Ngcobo', phone: '+27000300402', relationship: 'mother' },
    emergency_proof: proof,
  });

async function scan(code: string) {
  scanned = code;
  render(
    <MemoryRouter>
      <NFCTapSimulator />
    </MemoryRouter>
  );
  await screen.findByRole('option', { name: /Ward tablet/ });
  fireEvent.click(screen.getByRole('button', { name: /QR Code/ }));
  fireEvent.click(screen.getByRole('button', { name: /Scan QR code with camera/ }));
  fireEvent.click(screen.getByRole('button', { name: 'read code' }));
}

describe('NFCTapSimulator, QR scan', () => {
  const setEmergencyAccess = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePatientStore).mockReturnValue({ setEmergencyAccess });
    vi.mocked(useAuthStore).mockReturnValue(true);
    vi.mocked(shared.listUsableDevices).mockResolvedValue({
      devices: [{ id: 'device-1', device_name: 'Ward tablet', device_type: 'tablet' }],
    } as never);
    vi.mocked(shared.enterWorkContext).mockResolvedValue({ context: { id: 'context-1' } } as never);
  });

  it('opens server-side access with the patient id and the proof on the code', async () => {
    vi.mocked(shared.grantBoundEmergencyAccess).mockResolvedValue({
      grant_id: 'grant-1',
      expires_at: '2026-10-20T12:00:00Z',
      emergency_info: {
        patient_id: 'PAT-1', blood_type: 'AB+', allergies: [], current_medications: [],
        chronic_conditions: [], emergency_contacts: [], organ_donor: false, dnr_status: false,
        last_updated: '2026-10-20T11:00:00Z',
      },
    } as never);
    await scan(medicalIdQr('f'.repeat(64)));
    await waitFor(() => expect(setEmergencyAccess).toHaveBeenCalled());
    expect(shared.grantBoundEmergencyAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: 'PAT-1',
        qr_proof: 'f'.repeat(64),
        device_id: 'device-1',
        work_context_id: 'context-1',
        reason_code: 'emergency_qr_access',
      })
    );
    expect(screen.queryByText(/Summary printed on the patient's QR code/)).not.toBeInTheDocument();
  });

  it('shows the code\'s own summary, labelled unverified, when there is no connection', async () => {
    vi.mocked(shared.grantBoundEmergencyAccess).mockRejectedValue(
      new shared.ApiClientError('Network error', 'NETWORK_ERROR', 0)
    );
    await scan(medicalIdQr('f'.repeat(64)));
    expect(await screen.findByText(/Summary printed on the patient's QR code/)).toBeInTheDocument();
    expect(screen.getByText(/not recorded in their access history/)).toBeInTheDocument();
    expect(screen.getByText('AB+')).toBeInTheDocument();
  });

  it('does not show the summary when the server refuses', async () => {
    vi.mocked(shared.grantBoundEmergencyAccess).mockRejectedValue(
      new shared.ApiClientError('Device is not approved', 'DEVICE_NOT_APPROVED', 403)
    );
    await scan(medicalIdQr('f'.repeat(64)));
    expect(await screen.findByText(/Device is not approved/)).toBeInTheDocument();
    expect(screen.queryByText(/Summary printed on the patient's QR code/)).not.toBeInTheDocument();
  });

  it('asks for a current code when the scanned one carries no proof', async () => {
    await scan(medicalIdQr(undefined));
    expect(await screen.findByText(/Ask the patient to download a current one/)).toBeInTheDocument();
    expect(screen.getByText(/Summary printed on the patient's QR code/)).toBeInTheDocument();
    expect(shared.grantBoundEmergencyAccess).not.toHaveBeenCalled();
  });

  it('sends a scanned card tag as a card', async () => {
    vi.mocked(shared.grantBoundEmergencyAccess).mockRejectedValue(
      new shared.ApiClientError('NFC tag not found', 'NFC_NOT_FOUND', 404)
    );
    await scan('NFC-DEMO-001');
    await waitFor(() =>
      expect(shared.grantBoundEmergencyAccess).toHaveBeenCalledWith(
        expect.objectContaining({ nfc_tag_id: 'NFC-DEMO-001', reason_code: 'emergency_nfc_access' })
      )
    );
  });
});

describe('NFCTapSimulator, NFC card', () => {
  const setEmergencyAccess = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePatientStore).mockReturnValue({ setEmergencyAccess });
    vi.mocked(useAuthStore).mockReturnValue(true);
    vi.mocked(shared.listUsableDevices).mockResolvedValue({
      devices: [{ id: 'device-1', device_name: 'Ward tablet', device_type: 'tablet' }],
    } as never);
    vi.mocked(shared.enterWorkContext).mockResolvedValue({ context: { id: 'context-1' } } as never);
    vi.mocked(shared.grantBoundEmergencyAccess).mockRejectedValue(
      new shared.ApiClientError('NFC tag not found', 'NFC_NOT_FOUND', 404)
    );
  });

  const renderPanel = async () => {
    render(
      <MemoryRouter>
        <NFCTapSimulator />
      </MemoryRouter>
    );
    await screen.findByRole('option', { name: /Ward tablet/ });
  };

  it('offers no demo shortcut', async () => {
    await renderPanel();
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/simulate/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open emergency summary/i })).toBeInTheDocument();
  });

  it('hides tap-to-read where the browser has no Web NFC', async () => {
    await renderPanel();
    expect(screen.queryByRole('button', { name: /tap card to read/i })).not.toBeInTheDocument();
    expect(screen.getByText(/works in Chrome on Android/)).toBeInTheDocument();
  });

  it('reads a card with Web NFC and opens access with its number', async () => {
    class FakeReader extends EventTarget {
      async scan() {
        const record = { recordType: 'text', encoding: 'utf-8', data: new DataView(new TextEncoder().encode('NFC-CARD-7').buffer) };
        setTimeout(() => {
          const event = new Event('reading') as Event & { message: unknown };
          event.message = { records: [record] };
          this.dispatchEvent(event);
        }, 0);
      }
    }
    (window as unknown as { NDEFReader?: unknown }).NDEFReader = FakeReader;
    try {
      await renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /tap card to read/i }));
      await waitFor(() =>
        expect(shared.grantBoundEmergencyAccess).toHaveBeenCalledWith(
          expect.objectContaining({ nfc_tag_id: 'NFC-CARD-7', reason_code: 'emergency_nfc_access' })
        )
      );
    } finally {
      delete (window as unknown as { NDEFReader?: unknown }).NDEFReader;
    }
  });
});
