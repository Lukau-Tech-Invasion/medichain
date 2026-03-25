import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import LabResultPage from './LabResultPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LabResultPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  const mockResult = {
    test_id: 'LAB-001',
    patient_name: 'John Doe',
    test_name: 'Complete Blood Count',
    category: 'Hematology',
    status: 'Final',
    collected_at: new Date().toISOString(),
    result_items: [
      { parameter: 'WBC', value: '7.5', unit: 'x10^9/L', reference_range: '4.0-11.0', flag: 'Normal' },
      { parameter: 'Hemoglobin', value: '14.2', unit: 'g/dL', reference_range: '13.5-17.5', flag: 'Normal' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });
    });
  });

  it('renders lab result page', async () => {
    render(
      <MemoryRouter initialEntries={['/lab-results/LAB-001']}>
        <Routes>
          <Route path="/lab-results/:testId" element={<LabResultPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Laboratory Test Result/i)).toBeInTheDocument();
      expect(screen.getByText(/John Doe/i)).toBeInTheDocument();
      expect(screen.getByText(/Complete Blood Count/i)).toBeInTheDocument();
    });
  });

  it('displays result parameters in a table', async () => {
    render(
      <MemoryRouter initialEntries={['/lab-results/LAB-001']}>
        <Routes>
          <Route path="/lab-results/:testId" element={<LabResultPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('WBC')).toBeInTheDocument();
      expect(screen.getByText('7.5')).toBeInTheDocument();
      expect(screen.getByText('Hemoglobin')).toBeInTheDocument();
      expect(screen.getByText('14.2')).toBeInTheDocument();
    });
  });
});
