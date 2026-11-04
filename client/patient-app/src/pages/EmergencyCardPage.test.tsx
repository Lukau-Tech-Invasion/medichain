import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider, ToastProvider } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EmergencyCardPage } from './EmergencyCardPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// The access list calls the shared client, not fetch. Without this mock the
// panel renders its "could not be read" branch and the assertions below would
// be about an error state rather than the feature.
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEmergencyCapsuleAccessLog: vi.fn(),
  getMedicalIdQr: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderPage() {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <I18nProvider>
        <ToastProvider>
          <EmergencyCardPage />
        </ToastProvider>
      </I18nProvider>
    </BrowserRouter>,
  );
}

const mockPatientId = 'HEALTH123';

const storeState = {
  patient: {
    healthId: mockPatientId,
    userId: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
  },
};

describe('EmergencyCardPage (Patient)', () => {

  beforeEach(() => {
    vi.mocked(shared.getMedicalIdQr).mockResolvedValue({ qr_image_base64: 'QRMOCK' });
    vi.mocked(shared.getEmergencyCapsuleAccessLog).mockResolvedValue({
      success: true,
      patient_id: mockPatientId,
      count: 0,
      accesses: [],
    } as never);
    vi.clearAllMocks();

    // One object, created once. Rebuilding it per call hands the component a
    // new `patient` reference on every render, which the real store never does
    // — and a callback depending on it is then rebuilt every render, re-running
    // its effect forever. The page never leaves its loading skeleton.
    (usePatientAuthStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: unknown) => unknown) => selector(storeState),
    );

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({
          patient_id: 'HEALTH123',
          full_name: 'Test Patient',
          date_of_birth: '1990-01-01',
          emergency_info: {
            blood_type: 'O+',
            allergies: [{ name: 'Peanuts' }],
            chronic_conditions: ['Asthma'],
            current_medications: ['Inhaler'],
            emergency_contacts: [{
              name: 'Jane Doe',
              phone: '+123456789',
              relationship: 'Wife',
            }],
            organ_donor: true,
            dnr_status: false,
          },
          last_updated: '2025-01-01',
        }),
      });
    });
  });

  it('renders emergency card with patient information', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Test Patient/i)).toBeInTheDocument();
      expect(screen.getByText(/O\+/i)).toBeInTheDocument();
      expect(screen.getByText(/Asthma/i)).toBeInTheDocument();
      expect(screen.getByText(/Jane Doe/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Check record integrity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
  });

  it('warns that an unknown blood type must be cross-matched', async () => {
    const response = await mockFetch();
    const patient = await response.json();
    mockFetch.mockResolvedValue({
      ...response,
      json: async () => ({
        ...patient,
        emergency_info: { ...patient.emergency_info, blood_type: 'Unknown' },
      }),
    });
    renderPage();
    expect(await screen.findByText('Unknown — type and cross-match before transfusion'))
      .toBeInTheDocument();
  });

  it('shows the Medical ID code the paramedic scanner reads, for this patient', async () => {
    // This page used to draw its own code, which the scanner refused as "not a
    // MediChain code". The one shown now is the server's Medical ID code.
    renderPage();

    await waitFor(() => {
      const img = screen.getByRole('img', { name: /emergency medical qr code/i });
      expect(img).toHaveAttribute('src', 'data:image/png;base64,QRMOCK');
    });
    expect(shared.getMedicalIdQr).toHaveBeenCalledWith(mockPatientId);
  });

  it('downloads that same code', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: /Download QR Code/i });
    await waitFor(() => expect(button).toBeEnabled());
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    button.click();
    expect(download).toHaveBeenCalledOnce();
    download.mockRestore();
  });

  it('shows critical medical info including allergies', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Peanuts/i)).toBeInTheDocument();
    });
  });

  it('does not infer organ-donation or resuscitation status from absent data', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({
        patient_id: 'HEALTH123', full_name: 'Test Patient', date_of_birth: '1990-01-01',
        emergency_info: { blood_type: 'O+' },
      }),
    }));
    renderPage();

    await waitFor(() => expect(screen.getByText(/Test Patient/i)).toBeInTheDocument());
    expect(screen.queryByText(/Not an organ donor/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Full resuscitation/i)).not.toBeInTheDocument();
  });

  // --- Who has opened this card ----------------------------------------------
  //
  // POPIA requires every emergency read to be logged, and the endpoint already
  // served that log to the patient themself. It had no caller anywhere, so the
  // data subject could not read the log that exists to answer their question.

  const access = (over: Record<string, unknown> = {}) => ({
    id: 'ACC-1',
    patient_id: mockPatientId,
    capsule_version: 1,
    accessed_by: '5Paramedic0000000000000000000000000000000000000',
    grant_id: 'GRANT-1',
    reason_code: 'emergency_nfc_access',
    reason_text: null,
    fields_revealed: ['blood_type', 'allergies'],
    commitment_verified: true,
    accessed_at: '2026-09-15T02:00:00Z',
    ...over,
  });

  it('lists who has opened the emergency card and what was shown', async () => {
    vi.mocked(shared.getEmergencyCapsuleAccessLog).mockResolvedValue({
      success: true,
      patient_id: mockPatientId,
      count: 1,
      accesses: [access()],
    } as never);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('emergency-access-list')).toBeInTheDocument());
    // The fields actually revealed, not the ones requested — that difference is
    // the point of logging a break-glass read.
    expect(screen.getByText(/blood_type, allergies/)).toBeInTheDocument();
  });

  it('says nobody has opened the card when the log is genuinely empty', async () => {
    vi.mocked(shared.getEmergencyCapsuleAccessLog).mockResolvedValue({
      success: true,
      patient_id: mockPatientId,
      count: 0,
      accesses: [],
    } as never);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Nobody has opened your emergency card/i)).toBeInTheDocument()
    );
  });

  it('does not report "nobody" when the log could not be read', async () => {
    vi.mocked(shared.getEmergencyCapsuleAccessLog).mockRejectedValue(new Error('boom'));
    renderPage();

    // Telling a patient nobody opened their card when the read failed is the
    // worse of the two possible mistakes.
    await waitFor(() =>
      expect(screen.getByText(/not a record of nobody opening your card/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/Nobody has opened your emergency card/i)).not.toBeInTheDocument();
  });

});
