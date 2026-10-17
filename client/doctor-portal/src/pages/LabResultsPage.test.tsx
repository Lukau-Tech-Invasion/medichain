import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LabResultsPage from './LabResultsPage';
import { useAuthStore } from '../store';

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));
vi.mock('../components/PatientSelect', () => ({
  default: ({ onChange }: { onChange: (id: string) => void }) =>
    <button onClick={() => onChange('PAT-001')}>Choose synthetic patient</button>,
}));

describe('LabResultsPage', () => {
  const mockSubmissions = [
    {
      id: 'LAB-001',
      patient_id: 'PAT-001',
      patient_name: 'John Doe',
      test_name: 'CBC',
      test_category: 'Hematology',
      results: [
        { parameter: 'WBC', value: '7.5', unit: 'x10^9/L', reference_range: '4.0-11.0' }
      ],
      submitted_by: 'Lab Tech A',
      submitted_at: new Date().toISOString(),
      status: 'Pending'
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: { userId: 'DOC-001' }
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockSubmissions,
    });
  });

  it('renders lab results page and fetches submissions', async () => {
    render(
      <MemoryRouter>
        <LabResultsPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Lab Results Review/i)).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText('CBC')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
  });

  it('expands submission on click', async () => {
    render(
      <MemoryRouter>
        <LabResultsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('CBC')).toBeInTheDocument());

    fireEvent.click(screen.getByText('CBC'));

    expect(screen.getByText('Test Results')).toBeInTheDocument();
    expect(screen.getByText('WBC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument();
  });

  it('handles approval successfully', async () => {
    render(
      <MemoryRouter>
        <LabResultsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('CBC')).toBeInTheDocument());
    fireEvent.click(screen.getByText('CBC'));

    const approveButton = screen.getByRole('button', { name: /Approve/i });
    
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        submission_id: 'LAB-001',
        new_status: 'approve',
        message: 'Lab submission approved',
      }),
    }).mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [{ ...mockSubmissions[0], status: 'Approved', reviewed_at: new Date().toISOString() }],
    });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(screen.queryByText('CBC')).not.toBeInTheDocument();
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), { target: { value: 'approved' } });
    expect(screen.getByText('CBC')).toBeInTheDocument();
  });

  it('shows a refused approval without changing the pending result', async () => {
    render(<MemoryRouter><LabResultsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('CBC')).toBeInTheDocument());
    fireEvent.click(screen.getByText('CBC'));
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'This role cannot review lab results.' }),
    });
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('CBC')).toBeInTheDocument();
    expect(screen.getAllByText('Pending Review').length).toBeGreaterThan(0);
  });

  it('requires an explicit reported reference group and uses its range', async () => {
    global.fetch = vi.fn().mockImplementation(async (url, init) => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => String(url).includes('/clinical/lab-panels') ? {
        panels: [{ code: 'CBC', name: 'CBC', tests: [{ name: 'Hemoglobin', unit: 'g/dL',
          reference_range_male: '13.5-17.5', reference_range_female: '12.0-15.5' }] }],
      } : init?.method === 'POST' ? { submission_id: 'LAB-new' } : [],
    }));
    render(<MemoryRouter><LabResultsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Enter Result' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose synthetic patient' }));
    await waitFor(() => expect(screen.getByRole('option', { name: /^CBC$/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Panel *'), { target: { value: 'CBC' } });
    fireEvent.change(screen.getByLabelText('Hemoglobin'), { target: { value: '13.1' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit for review/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Select the reference group');
    const reference = screen.getByLabelText(/Reference range group from/i);
    expect(reference).toHaveValue('');
    fireEvent.change(reference, { target: { value: 'female' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit for review/i }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/api/lab/submit'));
      expect(call).toBeDefined();
      expect(JSON.parse(String(call![1]?.body)).results[0].reference_range).toBe('12.0-15.5');
    });
  });
});
