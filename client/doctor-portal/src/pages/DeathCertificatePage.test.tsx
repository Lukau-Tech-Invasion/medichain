import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DeathCertificatePage from './DeathCertificatePage';
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
  listDeathCertificates: vi.fn(),
  createDeathCertificate: vi.fn(),
  updateDeathCertificateDraft: vi.fn(),
  fileDeathCertificate: vi.fn(),
  apiUrl: (path: string) => path,
}));

/**
 * Open the certificate form and advance to the cause-of-death step.
 *
 * The form is the 'New Certificate' tab and runs in four steps — decedent,
 * death info, cause, certifier — so cause of death is two Continues in.
 */
const goToCauseOfDeathStep = () => {
  fireEvent.click(screen.getByRole('button', { name: /New Certificate/i }));
  fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
  fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
};

describe('DeathCertificatePage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    vi.mocked(shared.listDeathCertificates).mockResolvedValue([]);
  });

  it('renders death certificate page', () => {
    render(<DeathCertificatePage />);

    expect(screen.getAllByText(/Death Certificate/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Create and manage official death certificates/i)).toBeInTheDocument();
  });

  it('displays cause of death sections', () => {
    render(<DeathCertificatePage />);

    goToCauseOfDeathStep();

    expect(screen.getByText(/Cause of Death/i)).toBeInTheDocument();
    expect(screen.getByText(/Part I:/i)).toBeInTheDocument();
  });

  it('allows entering immediate cause', () => {
    render(<DeathCertificatePage />);

    goToCauseOfDeathStep();

    const input = screen.getByLabelText(/Immediate Cause/i);
    fireEvent.change(input, { target: { value: 'Septic Shock' } });
    expect(input).toHaveValue('Septic Shock');
  });

  it('reopens a draft with what it holds, and files that draft rather than a new certificate', async () => {
    vi.mocked(shared.listDeathCertificates).mockResolvedValue([
      {
        certificate_id: 'DC-DRAFT-1',
        patient_id: 'PAT-1',
        status: 'draft',
        deceased_name: 'Thabo Sipho Mokoena',
        date_of_death: '2026-09-20',
        place_of_death: 'Ward 3',
        manner_of_death: 'natural',
        cause_of_death: 'Myocardial infarction',
        certifier_name: 'Dr Naidoo',
        certifier_license: 'MP123',
      },
    ]);
    vi.mocked(shared.updateDeathCertificateDraft).mockResolvedValue({ success: true, id: 'DC-DRAFT-1', status: 'draft' });
    vi.mocked(shared.fileDeathCertificate).mockResolvedValue({ success: true, id: 'DC-DRAFT-1', status: 'filed' });
    render(<DeathCertificatePage />);

    fireEvent.click(await screen.findByTitle('Edit'));
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    // It used to open an empty form, and saving that overwrote the draft.
    expect(screen.getByLabelText(/Immediate Cause/i)).toHaveValue('Myocardial infarction');
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    fireEvent.click(screen.getByText(/Click to add digital signature/i));
    fireEvent.click(screen.getByRole('button', { name: /Sign & Submit/i }));

    await waitFor(() => expect(shared.fileDeathCertificate).toHaveBeenCalledWith('DC-DRAFT-1'));
    expect(shared.updateDeathCertificateDraft).toHaveBeenCalledWith(
      'DC-DRAFT-1',
      expect.objectContaining({ patient_id: 'PAT-1', deceased_name: 'Thabo Sipho Mokoena' }),
    );
    expect(shared.createDeathCertificate).not.toHaveBeenCalled();
  });
});
