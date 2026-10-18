import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import PostOpPage from './PostOpPage';

const mocks = vi.hoisted(() => ({ user: { userId: 'doctor', role: 'Doctor' }, get: vi.fn() }));
// Keep the module's hooks; replace only the picker component.
vi.mock('../components/PatientSelect', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), default: ({ value, onChange }: {
  value: string; onChange: (id: string) => void;
}) => <select aria-label="Patient" value={value} onChange={event => onChange(event.target.value)}>
  <option value="">Choose patient</option><option value="PAT-QA">Synthetic Patient</option>
</select> }));
vi.mock('../store/authStore', async original => ({ ...(await original<Record<string, unknown>>()),
  useAuthStore: () => ({ user: mocks.user }) }));
vi.mock('@medichain/shared', async original => ({ ...(await original<Record<string, unknown>>()),
  getPatients: vi.fn(), createPostOp: vi.fn(), getApiClient: () => ({ get: mocks.get }),
  useScoringCatalog: () => ({ catalog: null }) }));

describe('Post-operative submission lifetime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    mocks.get.mockResolvedValue([]);
  });
  /** Enter a fictional draft through the same labelled controls as the browser. */
  function enterDraft() {
    fireEvent.change(screen.getByRole('combobox', { name: 'Patient' }), { target: { value: 'PAT-QA' } });
    fireEvent.change(screen.getByLabelText('Procedure'), { target: { value: 'Fictional procedure' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'No clinical care occurred' } });
    fireEvent.change(screen.getByLabelText('Pain Score (0-10)'), { target: { value: '0' } });
  }
  it('sends one pending write, locks the form, and clears only the completed draft', async () => {
    let finish!: (value: Awaited<ReturnType<typeof shared.createPostOp>>) => void;
    vi.mocked(shared.createPostOp).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<PostOpPage />); enterDraft();
    const save = screen.getByRole('button', { name: 'Save Post-Op Note' });
    fireEvent.click(save); fireEvent.click(save);
    expect(save).toBeDisabled();
    expect(screen.getByLabelText('Procedure')).toBeDisabled();
    expect(screen.getByLabelText('Patient')).toBeDisabled();
    expect(shared.createPostOp).toHaveBeenCalledTimes(1);
    expect(shared.createPostOp).toHaveBeenCalledWith(expect.objectContaining({ painScore: 0, vitals: {},
      aldrete: { activity: null, respiration: null, circulation: null, consciousness: null, oxygenSaturation: null } }));
    await act(async () => { finish({ success: true, id: 'NOTE-QA' }); });
    await screen.findByText('No post-op notes yet');
    expect(screen.queryByText('Fictional procedure')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    expect(screen.getByLabelText('Procedure')).toHaveValue('');
    expect(screen.getByLabelText('Notes')).toHaveValue('');
    expect(screen.getByLabelText('Pain Score (0-10)')).toHaveValue('');
    expect(screen.getByText('Aldrete score: not yet assessed')).toBeInTheDocument();
  });
  it('retains a refused draft and permits a later correction', async () => {
    vi.mocked(shared.createPostOp).mockRejectedValueOnce(new Error('Synthetic refusal'));
    render(<PostOpPage />); enterDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Save Post-Op Note' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Post-Op Note' })).toBeEnabled());
    expect(screen.getByLabelText('Procedure')).toHaveValue('Fictional procedure');
    expect(screen.getByLabelText('Notes')).toHaveValue('No clinical care occurred');
    expect(screen.getByLabelText('Patient')).toHaveValue('PAT-QA');
  });
  it('reads the full stored clinical note and keeps unmeasured observations unknown', async () => {
    mocks.get.mockResolvedValue([{ id: 'NOTE-QA', patientId: 'PAT-QA', patientName: 'Synthetic Patient',
      notes: 'Stored full narrative', medications: 'Fictional medication documentation', painScore: 0,
      aldrete: { activity: null }, vitals: {}, dischargeCriteria: [], documentedAt: '2026-10-11T10:00:00Z' }]);
    render(<PostOpPage />); enterDraft();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByText('Read saved post-operative details');
    fireEvent.click(screen.getByText('Read saved post-operative details'));
    expect(screen.getByText('Stored full narrative')).toBeVisible();
    expect(screen.getByText('Fictional medication documentation')).toBeVisible();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
  });
});
