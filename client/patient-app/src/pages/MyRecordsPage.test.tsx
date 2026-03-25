import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MyRecordsPage } from './MyRecordsPage';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock toast actions
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
  }),
}));

describe('MyRecordsPage (Patient)', () => {
  const mockPatientId = 'HEALTH123';

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock localStorage
    const authData = JSON.stringify({ patientId: mockPatientId });
    localStorage.getItem = vi.fn().mockImplementation((key) => {
      if (key === 'patient-auth') return authData;
      return null;
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/lab/patient/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            submissions: [
              {
                id: 'lab1',
                test_name: 'Blood Count',
                test_category: 'Hematology',
                submitted_by: 'Dr. Smith',
                submitted_at: '2025-01-01T10:00:00Z',
                results: [{ parameter: 'WBC', value: '5.0', unit: '10^9/L', reference_range: '4.0-11.0' }],
              }
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ records: [] }),
      });
    });
  });

  it('renders my records page with lab results', async () => {
    render(
      <MemoryRouter>
        <MyRecordsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/My Medical Records/i)).toBeInTheDocument();
      expect(screen.getByText(/Blood Count/i)).toBeInTheDocument();
    });
  });

  it('filters records by search query', async () => {
    render(
      <MemoryRouter>
        <MyRecordsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Blood Count/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search your medical records/i);
    fireEvent.change(searchInput, { target: { value: 'X-Ray' } });

    expect(screen.queryByText(/Blood Count/i)).not.toBeInTheDocument();
  });

  it('filters records by type', async () => {
    render(
      <MemoryRouter>
        <MyRecordsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Blood Count/i)).toBeInTheDocument();
    });

    const filterSelect = screen.getByRole('combobox');
    fireEvent.change(filterSelect, { target: { value: 'imaging' } });

    expect(screen.queryByText(/Blood Count/i)).not.toBeInTheDocument();
  });

  it('opens record details when clicking on a record', async () => {
    render(
      <MemoryRouter>
        <MyRecordsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const record = screen.getByText(/Blood Count/i);
      fireEvent.click(record);
    });

    expect(screen.getByText(/Record Details/i)).toBeInTheDocument();
    expect(screen.getByText(/Hematology/i)).toBeInTheDocument();
  });
});
