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
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
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
});
