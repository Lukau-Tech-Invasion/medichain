import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import OperativeNotePage from './OperativeNotePage';

const mocks = vi.hoisted(() => ({ user: { userId: 'doctor', role: 'Doctor' }, get: vi.fn() }));
vi.mock('../components/PatientSelect', () => ({ default: ({ value, onChange }: {
  value: string; onChange: (id: string) => void;
}) => <select aria-label="Patient" value={value} onChange={event => onChange(event.target.value)}>
  <option value="">Choose patient</option><option value="PAT-QA">Synthetic Patient</option>
</select> }));
vi.mock('../store/authStore', async original => ({ ...(await original<Record<string, unknown>>()),
  useAuthStore: () => ({ user: mocks.user }) }));
vi.mock('@medichain/shared', async original => ({ ...(await original<Record<string, unknown>>()),
  getPatients: vi.fn(), createOperativeNote: vi.fn(), getApiClient: () => ({ get: mocks.get }),
  useScoringCatalog: () => ({ catalog: null }) }));

describe('Operative note submission lifetime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    mocks.get.mockResolvedValue([]);
  });
  /** Fill a fictional valid draft using the rendered controls. */
  function enterDraft() {
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'PAT-QA' } });
    fireEvent.change(screen.getByLabelText('Procedure Name'), { target: { value: 'Fictional operation' } });
    fireEvent.change(screen.getByLabelText(/Pre-operative Diagnosis/), { target: { value: 'Fictional before' } });
    fireEvent.change(screen.getByLabelText(/Post-operative Diagnosis/), { target: { value: 'Fictional after' } });
    fireEvent.change(screen.getByLabelText('Procedure Description'), { target: { value: 'No actual operation occurred' } });
    fireEvent.change(screen.getByLabelText('EBL (mL)'), { target: { value: '0' } });
  }
  it('prevents a second pending write, locks the form, and resets after durable read-back', async () => {
    let finish!: (result: Awaited<ReturnType<typeof shared.createOperativeNote>>) => void;
    vi.mocked(shared.createOperativeNote).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<OperativeNotePage />); enterDraft();
    const save = screen.getByRole('button', { name: 'Save Operative Note' });
    fireEvent.click(save); fireEvent.click(save);
    expect(shared.createOperativeNote).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    expect(screen.getByLabelText('Patient')).toBeDisabled();
    expect(screen.getByLabelText('Procedure Description')).toBeDisabled();
    await act(async () => { finish({ success: true, id: 'NOTE-QA' }); });
    await screen.findByText('No operative notes yet');
    expect(screen.queryByText('Fictional operation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New Note' }));
    expect(screen.getByLabelText('Procedure Name')).toHaveValue('');
    expect(screen.getByLabelText('Procedure Description')).toHaveValue('');
    expect(screen.getByLabelText('EBL (mL)')).toHaveValue(null);
    expect(screen.getByLabelText('Patient')).toHaveValue('PAT-QA');
  });
  it('retains a failed draft and re-enables correction', async () => {
    vi.mocked(shared.createOperativeNote).mockRejectedValueOnce(new Error('Synthetic refusal'));
    render(<OperativeNotePage />); enterDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Save Operative Note' }));
    await waitFor(() => expect(shared.createOperativeNote).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Operative Note' })).toBeEnabled());
    expect(screen.getByLabelText('Procedure Description')).toHaveValue('No actual operation occurred');
    expect(screen.getByLabelText('Patient')).toHaveValue('PAT-QA');
  });
  it('exposes the saved narrative, diagnoses and unknown measurements in history', async () => {
    mocks.get.mockResolvedValue([{ id: 'NOTE-QA', patientId: 'PAT-QA', procedureName: 'Saved operation',
      preOpDiagnosis: 'Stored before', postOpDiagnosis: 'Stored after', procedure: 'Stored full narrative',
      findings: 'Stored findings', ebl: 0, specimens: [], createdAt: '2026-10-11T10:00:00Z' }]);
    render(<OperativeNotePage />); enterDraft();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByText('Read saved operative details');
    fireEvent.click(screen.getByText('Read saved operative details'));
    expect(screen.getByText('Stored full narrative')).toBeVisible();
    expect(screen.getByText('Stored before')).toBeVisible();
    expect(screen.getByText('Stored after')).toBeVisible();
    expect(screen.getByText('Stored findings')).toBeVisible();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
  });
});
