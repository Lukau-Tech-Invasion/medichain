import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LabResultsPage from './LabResultsPage';
import { useAuthStore } from '../store';

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
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
      status: 'pending'
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: { userId: 'DOC-001' }
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
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
    
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(screen.getByText('Approved')).toBeInTheDocument();
    });
  });
});
