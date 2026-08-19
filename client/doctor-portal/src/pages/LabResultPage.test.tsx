import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

  // The page maps lab *submissions*: a panel per record, each holding `tests`
  // with testCode/testName/result/unit/referenceRange/flag. `result_items`
  // with parameter/value keys is a shape nothing on this page reads, and the
  // status must be one of pending/in-progress/completed/cancelled.
  const mockResult = [
    {
      id: 'LAB-001',
      patient_id: 'PAT-001',
      patient_name: 'John Doe',
      mrn: 'MRN-001',
      order_date: new Date().toISOString(),
      collection_date: new Date().toISOString(),
      result_date: new Date().toISOString(),
      panel_name: 'Complete Blood Count',
      status: 'completed',
      ordered_by: 'Dr Smith',
      specimen: 'Whole blood',
      tests: [
        {
          testCode: 'WBC',
          testName: 'White Cell Count',
          result: '7.5',
          unit: 'x10^9/L',
          referenceRange: '4.0-11.0',
          flag: 'normal',
        },
        {
          testCode: 'HGB',
          testName: 'Hemoglobin',
          result: '14.2',
          unit: 'g/dL',
          referenceRange: '13.5-17.5',
          flag: 'normal',
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
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
      expect(screen.getByText(/Lab Results/i)).toBeInTheDocument();
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

    // Individual analytes are in the panel's detail view, which opens when the
    // panel is selected from the worklist.
    await waitFor(() =>
      expect(screen.getAllByText(/Complete Blood Count/i).length).toBeGreaterThan(0)
    );
    fireEvent.click(screen.getAllByText(/Complete Blood Count/i)[0]);

    await waitFor(() =>
      expect(screen.getByText(/White Cell Count/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Hemoglobin/i)).toBeInTheDocument();
    expect(screen.getAllByText(/7\.5 x10\^9\/L/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/14\.2 g\/dL/).length).toBeGreaterThan(0);
  });
});
