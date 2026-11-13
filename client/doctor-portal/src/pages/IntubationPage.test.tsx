import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IntubationPage from './IntubationPage';
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
  createIntubation: vi.fn(),
  apiUrl: (path: string) => path,
}));

// PatientSelect's audited purpose flow has separate coverage. These tests isolate
// submission lifetime and recovery using the component's owned value/onChange contract.
// Keep the module's hooks; replace only the picker component.
vi.mock('../components/PatientSelect', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), default: ({ value, onChange }: {
  value: string; onChange: (value: string) => void;
}) => <div><output aria-label="Selected patient">{value}</output>
  <button onClick={() => onChange('PAT-QA')}>Select synthetic patient</button></div> }));

describe('IntubationPage', () => {
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
    vi.mocked(shared.createIntubation).mockResolvedValue({ success: true, record_id: 'INT-QA' });
  });

  it('renders intubation page', () => {
    render(<IntubationPage />);

    expect(screen.getByText(/Intubation & Airway Management/i)).toBeInTheDocument();
    expect(screen.getByText(/RSI documentation and airway assessment/i)).toBeInTheDocument();
  });

  it('displays procedure details section', () => {
    render(<IntubationPage />);

    expect(screen.getByText(/Procedure Details/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Indication/i)).toBeInTheDocument();
  });

  it('allows selecting tube size', () => {
    render(<IntubationPage />);

    const select = screen.getByLabelText(/ETT Size/i);
    fireEvent.change(select, { target: { value: '7.5' } });
    expect(select).toHaveValue('7.5');
  });

  it('removes only the selected unsaved medication entry', () => {
    render(<IntubationPage />);
    fireEvent.click(screen.getByRole('button', { name: '20mg' }));
    fireEvent.click(screen.getByRole('button', { name: '0.3mg/kg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Etomidate 20mg' }));
    expect(screen.queryByRole('button', { name: 'Remove Etomidate 20mg' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Etomidate 0.3mg/kg' })).toBeInTheDocument();
  });

  it('keeps selected medications removable when RSI is unchecked', () => {
    render(<IntubationPage />);
    fireEvent.click(screen.getByRole('button', { name: '20mg' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'RSI used' }));
    expect(screen.queryByRole('button', { name: '20mg' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Etomidate 20mg' }));
    expect(screen.queryByText('Medications Given:')).not.toBeInTheDocument();
  });

  it('allows only one pending submission and clears the completed patient draft', async () => {
    let finishWrite!: (value: Awaited<ReturnType<typeof shared.createIntubation>>) => void;
    vi.mocked(shared.createIntubation).mockReturnValueOnce(new Promise(resolve => { finishWrite = resolve; }));
    render(<IntubationPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Select synthetic patient' }));
    fireEvent.change(screen.getByLabelText('Indication'), { target: { value: 'Airway protection' } });
    fireEvent.change(screen.getByPlaceholderText('Additional notes...'), { target: { value: 'Synthetic completed draft' } });
    fireEvent.click(screen.getByRole('button', { name: '20mg' }));
    const submit = screen.getByRole('button', { name: 'Document Intubation' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText('Indication')).toBeDisabled();
    expect(screen.getByPlaceholderText('Additional notes...')).toBeDisabled();
    expect(shared.createIntubation).toHaveBeenCalledTimes(1);
    await act(async () => { finishWrite({ success: true, record_id: 'INT-QA' }); });
    await waitFor(() => expect(screen.queryByLabelText('Indication')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'New Intubation' }));
    expect(screen.getByLabelText('Selected patient').textContent).toBe('');
    expect(screen.getByLabelText('Indication')).toHaveValue('');
    expect(screen.getByPlaceholderText('Additional notes...')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Remove Etomidate 20mg' })).not.toBeInTheDocument();
  });

  it('preserves the patient and entered fields after a failed write', async () => {
    vi.mocked(shared.createIntubation).mockRejectedValueOnce(new Error('Synthetic write failure'));
    render(<IntubationPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Select synthetic patient' }));
    fireEvent.change(screen.getByLabelText('Indication'), { target: { value: 'Airway protection' } });
    fireEvent.change(screen.getByLabelText('ETT Size (mm)'), { target: { value: '8' } });
    fireEvent.change(screen.getByPlaceholderText('Additional notes...'), { target: { value: 'Synthetic unsaved draft' } });
    const submit = screen.getByRole('button', { name: 'Document Intubation' });
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeEnabled());
    expect(shared.createIntubation).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Selected patient')).toHaveTextContent('PAT-QA');
    expect(screen.getByLabelText('ETT Size (mm)')).toHaveValue('8');
    expect(screen.getByPlaceholderText('Additional notes...')).toHaveValue('Synthetic unsaved draft');
  });
});
