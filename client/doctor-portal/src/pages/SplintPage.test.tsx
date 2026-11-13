import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SplintPage from './SplintPage';
import * as shared from '@medichain/shared';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(), createSplint: vi.fn(), getApiClient: () => ({ get: apiMock.get }),
}));
// Isolate save lifetime here; the real audited patient selector is verified in the browser.
// Keep the module's hooks; replace only the picker component.
vi.mock('../components/PatientSelect', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), default: ({ value, onChange }: {
  value: string; onChange: (value: string) => void;
}) => <div><output aria-label="Selected patient">{value}</output>
  <button onClick={() => onChange('PAT-QA')}>Select synthetic patient</button></div> }));

/**
 * Assertions rewritten 2026-07-31 against what the page renders today. The old
 * ones expected a "Procedure Details" section with labelled "Splint Type" and
 * "Material" selects; the page is tabbed (New Application / History) with a
 * "Patient & Device" section and a device Type chooser. Strings verified
 * against `docSplint` in shared/src/i18n/locales/en-US.ts.
 */
describe('SplintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.get.mockResolvedValue({ records: [] });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    vi.mocked(shared.createSplint).mockResolvedValue({ success: true, record_id: 'SPL-QA' });
  });

  it('locks one pending save and clears the completed draft', async () => {
    let finishWrite!: (value: Awaited<ReturnType<typeof shared.createSplint>>) => void;
    vi.mocked(shared.createSplint).mockReturnValueOnce(new Promise(resolve => { finishWrite = resolve; }));
    render(<SplintPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Select synthetic patient' }));
    fireEvent.change(screen.getByLabelText('Body Part / Splint Type'), { target: { value: 'Long arm' } });
    fireEvent.change(screen.getByPlaceholderText('Additional notes...'), { target: { value: 'Synthetic saved draft' } });
    const submit = screen.getByRole('button', { name: 'Save Splint/Cast Record' });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText('Body Part / Splint Type')).toBeDisabled();
    expect(screen.getByPlaceholderText('Additional notes...')).toBeDisabled();
    expect(shared.createSplint).toHaveBeenCalledTimes(1);
    await act(async () => { finishWrite({ success: true, record_id: 'SPL-QA' }); });
    await waitFor(() => expect(screen.queryByLabelText('Body Part / Splint Type')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'New Application' }));
    expect(screen.getByLabelText('Selected patient').textContent).toBe('');
    expect(screen.getByLabelText('Body Part / Splint Type')).toHaveValue('');
    expect(screen.getByPlaceholderText('Additional notes...')).toHaveValue('');
  });

  it('preserves a failed draft for correction or retry', async () => {
    vi.mocked(shared.createSplint).mockRejectedValueOnce(new Error('Synthetic write refusal'));
    render(<SplintPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Select synthetic patient' }));
    fireEvent.change(screen.getByLabelText('Body Part / Splint Type'), { target: { value: 'Long arm' } });
    fireEvent.change(screen.getByPlaceholderText('Additional notes...'), { target: { value: 'Synthetic unsaved note' } });
    const submit = screen.getByRole('button', { name: 'Save Splint/Cast Record' });
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.getByLabelText('Selected patient')).toHaveTextContent('PAT-QA');
    expect(screen.getByLabelText('Body Part / Splint Type')).toHaveValue('Long arm');
    expect(screen.getByPlaceholderText('Additional notes...')).toHaveValue('Synthetic unsaved note');
  });

  it('shows saved checks and notes without calling an unknown check compromised', async () => {
    apiMock.get.mockResolvedValue({ records: [{ id: 'SPL-QA', data: {
      patientName: 'Synthetic Patient', bodyPart: 'Long arm', side: 'left',
      preApplicationNV: { intact: false, notes: 'Stored pre-check note' },
      elevationInstructed: false, iceInstructed: true, notes: 'Stored full note',
      returnPrecautions: ['Stored return precaution'], followUp: 'Stored follow-up',
    } }] });
    render(<SplintPage />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByText('Synthetic Patient');
    fireEvent.click(screen.getByText('View saved details'));
    expect(screen.getByText('Stored pre-check note')).toBeInTheDocument();
    expect(screen.getByText('Stored full note')).toBeInTheDocument();
    expect(screen.getByText('Stored return precaution')).toBeInTheDocument();
    expect(screen.getByText('NV Not recorded')).toBeInTheDocument();
    expect(screen.queryByText('NV Compromised')).not.toBeInTheDocument();
  });
  it('keeps an unsaved neurovascular warning out of the history tab', () => {
    render(<SplintPage />);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'NV status intact' })[0]);
    expect(screen.getByText('Neurovascular compromise detected - reassess immediately!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.queryByText('Neurovascular compromise detected - reassess immediately!')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New Application' }));
    expect(screen.getByText('Neurovascular compromise detected - reassess immediately!')).toBeInTheDocument();
  });
  it('renders the splint & cast header', () => {
    render(<SplintPage />);

    expect(screen.getByText(/Splint & Cast Documentation/i)).toBeInTheDocument();
    expect(screen.getByText(/Immobilization and orthopedic care/i)).toBeInTheDocument();
  });

  it('offers the new-application and history tabs', () => {
    render(<SplintPage />);

    expect(screen.getByText(/New Application/i)).toBeInTheDocument();
    expect(screen.getAllByText(/History/i).length).toBeGreaterThan(0);
  });

  it('renders the patient & device section with device types', () => {
    render(<SplintPage />);

    expect(screen.getByText(/Patient & Device/i)).toBeInTheDocument();
    // Splint / Cast / Sling / Brace / Walking boot are the selectable devices.
    expect(screen.getAllByText(/Splint/i).length).toBeGreaterThan(0);
  });
});
