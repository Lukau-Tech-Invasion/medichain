import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import FamilyHistoryPage from './FamilyHistoryPage';
import { fillField, fieldValue } from '../test/fields';

const notices = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('../components/Toast', () => ({ useToastActions: () => notices }));
vi.mock('../store/authStore', async original => ({ ...(await original<Record<string, unknown>>()),
  useAuthStore: () => ({ user: { userId: 'DOC-QA', role: 'Doctor' } }),
}));
vi.mock('@medichain/shared', async original => ({ ...(await original<Record<string, unknown>>()),
  getPatients: vi.fn(), getFamilyHistory: vi.fn(), appendFamilyHistoryMember: vi.fn(), assessFamilyHistory: vi.fn(),
}));
// Keep the module's hooks; replace only the picker component.
vi.mock('../components/PatientSelect', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), default: (props: {
  onChange: (id: string, patient: { patient_id: string; full_name: string }) => void;
}) => <button onClick={() => props.onChange('PAT-QA', { patient_id: 'PAT-QA', full_name: 'Synthetic Patient' })}>Choose synthetic patient</button> }));

const history = (): shared.FamilyMedicalHistory => ({ patient_id: 'PAT-QA', family_members: [],
  genetic_conditions: [], three_gen_complete: false, last_updated: 0, updated_by: 'DOC-QA' });

/** The form submit follows the navigation tab with the same visible label. */
function submitButton() {
  const buttons = screen.getAllByRole('button', { name: /^Add Family Member$/ });
  return buttons[buttons.length - 1];
}

/** Enter an explicitly fictional relative through the visible form controls. */
async function enterRelative() {
  fireEvent.click(screen.getByRole('button', { name: /^Add Family Member$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose synthetic patient' }));
  fillField(/Relationship/, 'half-sister');
  fillField('Family Member Name', 'Fictional Lerato');
  fillField('General Notes', 'Synthetic relative documentation only');
}

describe('Family history append lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getFamilyHistory).mockResolvedValue(history());
    vi.mocked(shared.assessFamilyHistory).mockResolvedValue({} as never);
  });

  it('starts with unanswered relationship, unknown status and severity, and explains a blank refusal', () => {
    render(<FamilyHistoryPage />);
    fireEvent.click(screen.getByRole('button', { name: /^Add Family Member$/ }));
    expect(screen.getByLabelText(/Relationship/)).toHaveValue('');
    expect(fieldValue(/Vital Status/)).toBe('unknown');
    expect(fieldValue('Severity')).toBe('');
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Select a patient and specify the relationship');
    expect(shared.appendFamilyHistoryMember).not.toHaveBeenCalled();
  });

  it('uses the selected directory entry, preserves entered metadata, and does not submit a replacement history', async () => {
    vi.mocked(shared.appendFamilyHistoryMember).mockImplementation(async request => {
      const saved = { ...history(), family_members: [request.member] };
      vi.mocked(shared.getFamilyHistory).mockResolvedValue(saved);
      return { success: true, history: saved };
    });
    render(<FamilyHistoryPage />); await enterRelative();
    fillField('Condition Name', 'Fictional QA condition');
    fillField('Category', 'diabetes');
    fillField('Condition Notes', 'Synthetic condition note');
    fireEvent.click(screen.getByRole('button', { name: 'Add Condition' }));
    fireEvent.click(submitButton());
    await waitFor(() => expect(notices.showSuccess).toHaveBeenCalledTimes(1));
    const request = vi.mocked(shared.appendFamilyHistoryMember).mock.calls[0][0];
    expect(request).toMatchObject({ patient_id: 'PAT-QA', member: { relationship: 'HalfSister',
      name: 'Fictional Lerato', living: null, notes: 'Synthetic relative documentation only', consanguineous: null,
      conditions: [{ condition: 'Fictional QA condition', category: 'diabetes', severity: null, notes: 'Synthetic condition note' }],
    } });
    expect(request).not.toHaveProperty('family_members');
    expect(vi.mocked(shared.getPatients).mock.calls.every(([options]) => options?.query === 'PAT-QA')).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Fictional Lerato' })).toBeInTheDocument();
  });

  it('does not silently discard condition fields that have not been added', async () => {
    render(<FamilyHistoryPage />); await enterRelative();
    fillField('Condition Name', 'Unfinished fictional condition');
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Add the condition to this relative before saving');
    expect(shared.appendFamilyHistoryMember).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Condition Name')).toHaveValue('Unfinished fictional condition');
  });

  it('locks the pending draft and prevents repeated clicks from appending twice', async () => {
    let finish!: (value: Awaited<ReturnType<typeof shared.appendFamilyHistoryMember>>) => void;
    vi.mocked(shared.appendFamilyHistoryMember).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<FamilyHistoryPage />); await enterRelative();
    const save = submitButton();
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    try {
      expect(shared.appendFamilyHistoryMember).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Family Member Name')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Family Members' })).toBeDisabled();
    } finally { await act(async () => { finish({ success: true, history: history() }); }); }
  });

  it('retains the refused draft and its request ID for retry', async () => {
    vi.mocked(shared.appendFamilyHistoryMember).mockRejectedValueOnce(new Error('Synthetic refusal'));
    render(<FamilyHistoryPage />); await enterRelative();
    fireEvent.click(submitButton());
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Family Member Name')).toHaveValue('Fictional Lerato');
    expect(notices.showSuccess).not.toHaveBeenCalled();
    vi.mocked(shared.appendFamilyHistoryMember).mockResolvedValueOnce({ success: true, history: history() });
    fireEvent.click(submitButton());
    await waitFor(() => expect(shared.appendFamilyHistoryMember).toHaveBeenCalledTimes(2));
    const [first, retry] = vi.mocked(shared.appendFamilyHistoryMember).mock.calls;
    expect(retry[0].member.member_id).toBe(first[0].member.member_id);
  });
});
