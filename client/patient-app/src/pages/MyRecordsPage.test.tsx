import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MyRecordsPage } from './MyRecordsPage';
import { usePatientAuthStore } from '../store/authStore';

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
    usePatientAuthStore.setState({
      patient: {
        walletAddress: '5TestPatientWallet',
        healthId: mockPatientId,
        fullName: 'Test Patient',
        firstName: 'Test',
        createdAt: '2025-01-01T00:00:00Z',
      },
      isAuthenticated: true,
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/lab/patient/')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
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
        headers: new Headers({ 'content-type': 'application/json' }),
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

    const searchInput = screen.getByPlaceholderText(/Search records/i);
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

    // The type filter is a row of buttons, not a <select> — the generated test
    // assumed a dropdown that does not exist.
    fireEvent.click(screen.getByRole('button', { name: /Imaging/i }));

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
    expect(screen.getAllByText(/Hematology/i).length).toBeGreaterThan(0);
  });
});
