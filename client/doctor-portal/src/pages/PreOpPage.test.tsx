import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PreOpPage from './PreOpPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';
import { selectPatient } from '../test/selectPatient';
import { fillField, fieldValue } from '../test/fields';

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
  openAccessContext: vi.fn().mockResolvedValue({ access_context_id: 'CTX-TEST', expires_at: '2099-01-01T00:00:00Z' }),
  getPatients: vi.fn(),
  getApiClient: vi.fn(),
  createPreOp: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('PreOpPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    vi.mocked(shared.getApiClient).mockReturnValue({ setPatientAccessContext: vi.fn(), getUserId: vi.fn().mockReturnValue('5GrwvaEF...mock'), getSessionRevision: vi.fn().mockReturnValue(0), get: vi.fn().mockResolvedValue([]) } as unknown as ReturnType<typeof shared.getApiClient>);
  });

  it('renders pre-op page', () => {
    render(<PreOpPage />);

    expect(screen.getByText(/Pre-Operative Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/ASA Classification & Surgical Readiness/i)).toBeInTheDocument();
  });

  it('displays checklist items', async () => {
    render(<PreOpPage />);

    // The checklist is its own tab; the page opens on the assessment tab.
    fireEvent.click(screen.getByRole('button', { name: /Pre-Op Checklist/i }));

    await waitFor(() =>
      expect(screen.getByText(/All consents signed and witnessed/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/NPO status verified/i)).toBeInTheDocument();
    expect(screen.getByText(/Surgical site marked by surgeon/i)).toBeInTheDocument();
  });

  it('allows selecting ASA classification', () => {
    render(<PreOpPage />);

    // ASA status is a radio group of option buttons, not a <select>: each
    // class carries a description that a dropdown option cannot show.
    const group = screen.getByLabelText(/ASA Class/i);
    expect(group).toHaveAttribute('role', 'radiogroup');

    const asaIII = screen.getByRole('radio', { name: /ASA III/i });
    expect(asaIII).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(asaIII);
    expect(asaIII).toHaveAttribute('aria-checked', 'true');
  });

  it('starts fasting compliance as unrecorded and permits explicit yes, no and clearing', () => {
    render(<PreOpPage />);
    expect(fieldValue('NPO compliance')).toBe('');
    fillField('NPO compliance', 'true');
    expect(fieldValue('NPO compliance')).toBe('true');
    fillField('NPO compliance', 'false');
    expect(fieldValue('NPO compliance')).toBe('false');
    fillField('NPO compliance', '');
    expect(fieldValue('NPO compliance')).toBe('');
  });

  it('does not declare no known drug allergies from an empty draft', () => {
    render(<PreOpPage />);
    expect(screen.getByText('No allergies recorded in this draft')).toBeInTheDocument();
    expect(screen.queryByText('NKDA (No Known Drug Allergies)')).not.toBeInTheDocument();
  });

  it('reports a failed history read instead of claiming no assessments exist', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([{ patient_id: 'PAT-history', full_name: 'Synthetic History Patient' }] as never);
    vi.mocked(shared.getApiClient).mockReturnValue({ setPatientAccessContext: vi.fn(), getUserId: vi.fn().mockReturnValue('5GrwvaEF...mock'), getSessionRevision: vi.fn().mockReturnValue(0), get: vi.fn().mockRejectedValue(new Error('storage unavailable')) } as unknown as ReturnType<typeof shared.getApiClient>);
    render(<PreOpPage />);
    await selectPatient('', 'Synthetic History Patient', 'preop-search-patients');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Assessment history could not be loaded');
    expect(screen.queryByText('No assessment history available.')).not.toBeInTheDocument();
  });

  it('renders the persisted form document returned by the history endpoint', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([{ patient_id: 'PAT-history', full_name: 'Synthetic History Patient' }] as never);
    const get = vi.fn().mockResolvedValue([{ id: 'PREOP-server', scheduled_surgery: 'Synthetic procedure', asa_class: 'II', assessment_date: '2026-10-11' }]);
    vi.mocked(shared.getApiClient).mockReturnValue({ setPatientAccessContext: vi.fn(), getUserId: vi.fn().mockReturnValue('5GrwvaEF...mock'), getSessionRevision: vi.fn().mockReturnValue(0), get } as unknown as ReturnType<typeof shared.getApiClient>);
    render(<PreOpPage />);
    await selectPatient('', 'Synthetic History Patient', 'preop-search-patients');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect((await screen.findAllByText('PREOP-server')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Synthetic procedure').length).toBeGreaterThan(0);
    expect(get).toHaveBeenCalledWith('/api/surgical/pre-op/patient/PAT-history');
  });

  /** Select a synthetic patient and enter a draft through the form controls. */
  async function enterDraft() {
    await selectPatient('', 'Synthetic History Patient', 'preop-search-patients');
    fillField('Scheduled Procedure', 'Fictional QA procedure');
    fillField('Additional Notes', 'No assessment or clinical care occurred');
    fillField('NPO compliance', 'false');
  }

  it.each(['Assessment', 'Pre-Op Checklist'])('guards pending writes from the %s save button and clears the completed draft', async tab => {
    vi.mocked(shared.getPatients).mockResolvedValue([{ patient_id: 'PAT-history', full_name: 'Synthetic History Patient' }] as never);
    let finish!: (value: Awaited<ReturnType<typeof shared.createPreOp>>) => void;
    vi.mocked(shared.createPreOp).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<PreOpPage />); await enterDraft();
    fireEvent.click(screen.getByRole('button', { name: tab }));
    const save = screen.getByRole('button', { name: tab === 'Assessment' ? 'Save Assessment' : 'Save Pre-Op Assessment' });
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    expect(shared.createPreOp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'History' })).toBeDisabled();
    await act(async () => { finish({ success: true, id: 'PREOP-once', asa_classification: 'II', cleared_for_surgery: false }); });
    await screen.findByText('No assessment history available.');
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    expect(screen.getByLabelText('Scheduled Procedure')).toHaveValue('');
    expect(screen.getByLabelText('Additional Notes')).toHaveValue('');
    expect(fieldValue('NPO compliance')).toBe('');
    expect(screen.getAllByText('Synthetic History Patient').length).toBeGreaterThan(0);
  });

  it('keeps a refused draft and shows a friendly error', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([{ patient_id: 'PAT-history', full_name: 'Synthetic History Patient' }] as never);
    vi.mocked(shared.createPreOp).mockRejectedValueOnce(new Error('Private storage exception'));
    render(<PreOpPage />); await enterDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Save Assessment' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Private storage exception')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Additional Notes')).toHaveValue('No assessment or clinical care occurred');
    expect(fieldValue('NPO compliance')).toBe('false');
    expect(screen.getByRole('button', { name: 'Save Assessment' })).toBeEnabled();
  });

  it('exposes the full stored pre-op document without replacing unknown values', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([{ patient_id: 'PAT-history', full_name: 'Synthetic History Patient' }] as never);
    vi.mocked(shared.getApiClient).mockReturnValue({ setPatientAccessContext: vi.fn(), getUserId: vi.fn().mockReturnValue('5GrwvaEF...mock'), getSessionRevision: vi.fn().mockReturnValue(0), get: vi.fn().mockResolvedValue([{
      id: 'PREOP-details', patient_id: 'PAT-history', notes: 'Stored complete narrative',
      npo_status: { compliant: false, lastSolid: '' }, airway_assessment: { mallampati: null },
    }]) } as unknown as ReturnType<typeof shared.getApiClient>);
    render(<PreOpPage />); await selectPatient('', 'Synthetic History Patient', 'preop-search-patients');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByText('Read saved pre-operative details');
    fireEvent.click(screen.getByText('Read saved pre-operative details'));
    expect(screen.getByText('Stored complete narrative')).toBeVisible();
    expect(screen.getByText('No')).toBeVisible();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
    expect(screen.queryByText('Checklist Progress')).not.toBeInTheDocument();
  });
});
