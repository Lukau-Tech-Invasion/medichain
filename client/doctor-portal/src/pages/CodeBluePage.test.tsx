import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { patientProfile } from '../test/fixtures';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as shared from '@medichain/shared';
import CodeBluePage from './CodeBluePage';
import { useAuthStore } from '../store/authStore';
import { selectPatient } from '../test/selectPatient';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  apiUrl: (path: string) => path,
}));

/**
 * Pick a patient, then start the code.
 *
 * `Start Code` is disabled until a patient is selected — a resuscitation record
 * with no patient attached is not a record.
 */
const startCode = async () => {
  // The chooser is a searchable combobox now, not a native <select> whose
  // options a test could read off the DOM.
  await selectPatient(/Select Patient/i, 'Test Patient');
  fireEvent.click(screen.getByText(/Start Code/i));
  await waitFor(() => expect(screen.getByText(/Stop Code/i)).toBeInTheDocument());
};

beforeEach(() => {
  // `PatientSelect` only queries while somebody is signed in, so a test that
  // chooses a patient has to be signed in too.
  useAuthStore.setState({
    user: {
      walletAddress: '5Test',
      username: 'Dr Test',
      role: 'Doctor',
      userId: 'doc-1',
    },
    isAuthenticated: true,
  } as never);
  vi.mocked(shared.getPatients).mockResolvedValue([
    patientProfile(),
  ]);
});

describe('CodeBluePage', () => {
  it('renders code blue page', () => {
    render(<CodeBluePage />);

    expect(screen.getByText(/Code Blue Management/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Code/i)).toBeInTheDocument();
  });

  it('shows the timer and controls when code is started', async () => {
    render(<CodeBluePage />);
    await startCode();

    expect(screen.getByText(/Quick Actions/i)).toBeInTheDocument();
    expect(screen.getByText(/Stop Code/i)).toBeInTheDocument();
    expect(screen.getByText(/CPR Cycle/i)).toBeInTheDocument();
  });

  it('allows recording medications during code', async () => {
    render(<CodeBluePage />);
    await startCode();

    expect(screen.getByText(/Epi 1mg/i)).toBeInTheDocument();
    expect(screen.getByText(/Amiodarone/i)).toBeInTheDocument();
  });
});
