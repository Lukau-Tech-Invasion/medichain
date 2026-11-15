import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AnesthesiaPage from './AnesthesiaPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Keep the module's hooks; replace only the picker component.
vi.mock('../components/PatientSelect', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), default: ({ value, onChange }: { value: string; onChange: (id: string) => void }) =>
  <select aria-label="Patient" value={value} onChange={e => onChange(e.target.value)}><option value="">Select</option><option value="PAT-QA">Fictional patient</option></select> }));

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock only the data calls; the rest of the package (i18n, apiUrl) stays real so
// the component renders its actual copy.
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  createAnesthesia: vi.fn(),
  getApiClient: vi.fn(),
  apiUrl: (path: string) => path,
}));

/**
 * Assertions rewritten 2026-07-31 against what the page renders today. The old
 * ones looked for a "New Record" heading and a labelled "Select Patient" field;
 * the page is tabbed (Record / History) with a "Patient & Case Info" section.
 * Strings verified against `docAnesthesia` in shared/src/i18n/locales/en-US.ts.
 */
describe('AnesthesiaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: { userId: '5GrwvaEF...mock', role: 'Doctor' },
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    vi.mocked(shared.getApiClient).mockReturnValue({ setPatientAccessContext: vi.fn(), get: vi.fn().mockResolvedValue([]) } as unknown as ReturnType<typeof shared.getApiClient>);
  });

  it('renders the anesthesia record header', async () => {
    render(<AnesthesiaPage />);

    await waitFor(() =>
      expect(screen.getAllByText(/Anesthesia Record/i).length).toBeGreaterThan(0)
    );
    expect(
      screen.getByText(/Intraoperative monitoring and medication tracking/i)
    ).toBeInTheDocument();
  });

  it('offers the record and history tabs', async () => {
    render(<AnesthesiaPage />);

    await waitFor(() => expect(screen.getAllByText(/Record/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/History/i).length).toBeGreaterThan(0);
  });

  it('renders the patient & case section with ASA classification', async () => {
    render(<AnesthesiaPage />);

    await waitFor(() => expect(screen.getByText(/Patient & Case Info/i)).toBeInTheDocument());
    // ASA physical status drives anaesthetic risk — it must stay on the form.
    expect(screen.getByText(/ASA Class/i)).toBeInTheDocument();
  });

  it('reads canonical anesthesia fields and exposes the complete stored record', async () => {
    const row = { id: 'ANES-QA', asa_classification: '3', anesthesia_type: 'regional',
      airway_management: 'Mask', data: { procedure: 'Fictional QA procedure', notes: 'Stored QA narrative', ebl: 0 } };
    vi.mocked(shared.getApiClient).mockReturnValue({ setPatientAccessContext: vi.fn(), get: vi.fn().mockResolvedValue({ records: [row] }) } as unknown as ReturnType<typeof shared.getApiClient>);
    render(<AnesthesiaPage />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByText('ASA 3')).toBeInTheDocument();
    expect(screen.getAllByText(/regional/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mask/).length).toBeGreaterThan(0);
    expect(screen.getByText('Read saved anesthesia details')).toBeInTheDocument();
    expect(screen.getByText('Stored QA narrative')).toBeInTheDocument();
    expect(screen.getByText(/EBL: 0 mL/)).toBeInTheDocument();
    expect(screen.getByText(/UO: Not recorded/)).toBeInTheDocument();
    expect(screen.queryByText('ASA {{class}}')).not.toBeInTheDocument();
  });

  it('blocks duplicate submission, reads history, and clears the completed draft', async () => {
    let complete!: () => void;
    vi.mocked(shared.createAnesthesia).mockReturnValue(new Promise(resolve => { complete = () => resolve({ success: true, id: 'ANES-QA' }); }));
    render(<AnesthesiaPage />);
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'PAT-QA' } });
    fireEvent.change(screen.getByLabelText(/Procedure/), { target: { value: 'Fictional procedure' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Fictional notes' } });
    const save = screen.getByRole('button', { name: 'Save Anesthesia Record' });
    fireEvent.click(save); fireEvent.click(save);
    expect(shared.createAnesthesia).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'History' })).toBeDisabled();
    await act(async () => complete());
    await screen.findByText('No anesthesia records yet');
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByLabelText(/Procedure/)).toHaveValue('');
    expect(screen.getByLabelText('Notes')).toHaveValue('');
    expect(screen.getByLabelText('Patient')).toHaveValue('PAT-QA');
  });

  it('keeps the draft after a failed write and allows retry', async () => {
    vi.mocked(shared.createAnesthesia).mockRejectedValue(new Error('Private backend detail'));
    render(<AnesthesiaPage />);
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'PAT-QA' } });
    fireEvent.change(screen.getByLabelText(/Procedure/), { target: { value: 'Preserved procedure' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Anesthesia Record' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Anesthesia Record' })).toBeEnabled());
    expect(screen.getByLabelText(/Procedure/)).toHaveValue('Preserved procedure');
    expect(screen.queryByText('Private backend detail')).not.toBeInTheDocument();
  });

  it('shows a failed history read and retries without creating a record', async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error('Private database error')).mockResolvedValue([]);
    vi.mocked(shared.getApiClient).mockReturnValue({ get } as unknown as ReturnType<typeof shared.getApiClient>);
    render(<AnesthesiaPage />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByText('Saved anesthesia history could not be loaded. Please retry the history read.');
    expect(screen.queryByText('No anesthesia records yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry anesthesia history' }));
    await screen.findByText('No anesthesia records yet');
    expect(shared.createAnesthesia).not.toHaveBeenCalled();
  });

  it('allows an unsaved vital reading to be removed', () => {
    render(<AnesthesiaPage />);
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('HR'), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove vital reading at 10:00' }));
    expect(screen.queryByRole('cell', { name: '10:00' })).not.toBeInTheDocument();
    expect(shared.createAnesthesia).not.toHaveBeenCalled();
  });

  it('keeps unentered measurements unknown and preserves an explicitly entered zero', async () => {
    vi.mocked(shared.createAnesthesia).mockResolvedValue({ success: true, id: 'ANES-UNKNOWN' });
    render(<AnesthesiaPage />);
    expect(screen.getByLabelText('ASA Class')).toHaveValue('');
    expect(screen.getByLabelText('Anesthesia Type')).toHaveValue('');
    expect(screen.getByLabelText('Airway Type')).toHaveValue('');
    expect(screen.getByLabelText('BP')).toHaveValue('');
    expect(screen.getByLabelText('HR')).toHaveValue(null);
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'PAT-QA' } });
    fireEvent.change(screen.getByLabelText(/Procedure/), { target: { value: 'Unknown observations QA' } });
    fireEvent.change(screen.getByLabelText('EBL (mL)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Anesthesia Record' }));
    await waitFor(() => expect(shared.createAnesthesia).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(JSON.stringify(vi.mocked(shared.createAnesthesia).mock.calls[0][0]));
    expect(payload.ebl).toBe(0);
    for (const field of ['urineOutput', 'asaClass', 'anesthesiaType', 'airwayType']) expect(payload).not.toHaveProperty(field);
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByLabelText('EBL (mL)')).toHaveValue(null);
  });

  it('rejects time-only and invalid vital drafts without fabricating observations', () => {
    render(<AnesthesiaPage />);
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    expect(screen.queryByRole('cell', { name: '10:00' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('SpO2'), { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    expect(screen.queryByRole('cell', { name: '10:00' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('SpO2'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('HR'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    expect(screen.getByRole('cell', { name: '0' })).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: 'Not recorded' })).toHaveLength(5);
  });
});
