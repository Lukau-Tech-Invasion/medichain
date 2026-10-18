import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { patientProfile } from '../test/fixtures';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as shared from '@medichain/shared';
import CodeBluePage from './CodeBluePage';
import { useAuthStore } from '../store/authStore';
import { selectPatient } from '../test/selectPatient';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openAccessContext: vi.fn(),
  getPatients: vi.fn(),
  createCodeBlue: vi.fn(),
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
  vi.mocked(shared.openAccessContext).mockResolvedValue({
    access_context_id: 'CTX-PAGE-QA',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  } as Awaited<ReturnType<typeof shared.openAccessContext>>);
  // `PatientSelect` only queries while somebody is signed in, so a test that
  // chooses a patient has to be signed in too.
  useAuthStore.setState({
    user: {
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

  it('finalises only with an outcome the clinician chose, and invents no team member', async () => {
    vi.mocked(shared.createCodeBlue).mockResolvedValue({ id: 'CB-1' } as never);
    render(<CodeBluePage />);
    await startCode();
    fireEvent.click(screen.getByText(/Stop Code/i));

    const finalize = screen.getByRole('button', { name: /Finalize Record/i });
    expect(finalize).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Outcome/i), { target: { value: 'rosc' } });
    expect(finalize).toBeEnabled();
    fireEvent.click(finalize);

    await waitFor(() => expect(shared.createCodeBlue).toHaveBeenCalled());
    const sent = vi.mocked(shared.createCodeBlue).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.outcome).toBe('rosc');
    expect(sent.team_members).toEqual([]);
  });

  it('allows recording medications during code', async () => {
    render(<CodeBluePage />);
    await startCode();

    expect(screen.getByText(/Epi 1mg/i)).toBeInTheDocument();
    expect(screen.getByText(/Amiodarone/i)).toBeInTheDocument();
  });
});
