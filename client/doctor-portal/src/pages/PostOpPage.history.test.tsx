import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import PostOpPage from './PostOpPage';
const { historyUser } = vi.hoisted(() => ({ historyUser: { userId: 'doctor', role: 'Doctor' } }));

// Keep the module's hooks; replace only the picker component.
vi.mock('../components/PatientSelect', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), default: ({ value, onChange }: { value: string; onChange: (id: string) => void }) =>
  <select aria-label="Patient" value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Choose patient</option><option value="PAT-A">Thandiwe</option><option value="PAT-B">Naledi</option>
  </select> }));
vi.mock('../store/authStore', async original => ({ ...(await original<Record<string, unknown>>()),
  useAuthStore: () => ({ user: historyUser }) }));
vi.mock('@medichain/shared', async original => ({ ...(await original<Record<string, unknown>>()),
  getPatients: vi.fn(), getApiClient: vi.fn(), useScoringCatalog: () => ({ catalog: null }) }));

describe('Post-operative history patient boundaries', () => {
  const firstNote = { id: 'NOTE-A', patientId: 'PAT-A', patientName: 'Thandiwe',
    procedure: 'Fictional A procedure', procedureDate: '2026-10-11', specimens: [], ebl: 0 };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getPatients).mockResolvedValue([]);
  });
  /** Configure the read transport; the tests exercise the actual history effect. */
  function reads(get: ReturnType<typeof vi.fn>) {
    vi.mocked(shared.getApiClient).mockReturnValue({ get } as unknown as ReturnType<typeof shared.getApiClient>);
  }
  /** Select through the form and open the history tab. */
  function open(id: string) {
    fireEvent.change(screen.getByRole('combobox', { name: 'Patient' }), { target: { value: id } });
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
  }
  it('replaces the prior patient history when the next patient has no records', async () => {
    reads(vi.fn().mockResolvedValueOnce([firstNote]).mockResolvedValueOnce([]));
    render(<PostOpPage />); open('PAT-A');
    await screen.findAllByText('Fictional A procedure');
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' })); open('PAT-B');
    await screen.findByText('No post-op notes yet');
    expect(screen.queryByText('Fictional A procedure')).not.toBeInTheDocument();
  });
  it('ignores a late response for a patient whose form has been left', async () => {
    let resolveFirst!: (records: unknown[]) => void;
    reads(vi.fn().mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce([]));
    render(<PostOpPage />); open('PAT-A');
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' })); open('PAT-B');
    await screen.findByText('No post-op notes yet');
    await act(async () => { resolveFirst([firstNote]); });
    expect(screen.queryByText('Fictional A procedure')).not.toBeInTheDocument();
  });
  it('shows a read error rather than an empty medical history', async () => {
    reads(vi.fn().mockRejectedValue(new Error('unavailable')));
    render(<PostOpPage />); open('PAT-A');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Post-operative history could not be loaded'));
    expect(screen.queryByText('No post-op notes yet')).not.toBeInTheDocument();
  });
});
