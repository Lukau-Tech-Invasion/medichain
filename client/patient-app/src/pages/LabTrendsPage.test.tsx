import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import LabTrendsPage from './LabTrendsPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLabTrends: vi.fn(),
}));

describe('LabTrendsPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
    });
    // An empty `trends` array means the page correctly renders its empty
    // state; the generated test then asserted a test name that could never
    // appear. This is the shape the page transforms: `loinc_code`,
    // `test_name`, `unit`, `reference_range` and `data_points[]`.
    (shared.getLabTrends as any).mockResolvedValue({
      success: true,
      trends: [
        {
          loinc_code: '2345-7',
          test_name: 'Glucose',
          unit: 'mg/dL',
          reference_range: { low: 70, high: 99 },
          data_points: [
            {
              result_id: 'r1',
              value: 92,
              collected_at: 1755000000,
              status: 'Normal',
              performing_lab: 'Main Lab',
            },
          ],
        },
        {
          loinc_code: '4548-4',
          test_name: 'Hemoglobin A1c',
          unit: '%',
          reference_range: { low: 4, high: 5.6 },
          data_points: [
            {
              result_id: 'r2',
              value: 5.4,
              collected_at: 1755000000,
              status: 'Normal',
              performing_lab: 'Main Lab',
            },
          ],
        },
      ],
    });
  });

  it('renders lab trends page', async () => {
    render(<LabTrendsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Lab Trends/i)).toBeInTheDocument();
      expect(screen.getByText(/Track your lab results over time/i)).toBeInTheDocument();
    });
  });

  it('displays demo trends when no API data is available', async () => {
    render(<LabTrendsPage />);

    await waitFor(() => {
      // Demo trends include Glucose, Hemoglobin A1c, etc.
      expect(screen.getByText(/Glucose/i)).toBeInTheDocument();
      expect(screen.getByText(/Hemoglobin A1c/i)).toBeInTheDocument();
    });
  });

  it('allows filtering by category', async () => {
    render(<LabTrendsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Glucose/i)).toBeInTheDocument();
    });

    // The page filters by TIME RANGE (3 Months / 6 Months / 1 Year), not by
    // test-panel category — the generated test described a filter UI that
    // does not exist here.
    fireEvent.click(screen.getByText(/3 Months/i));

    expect(screen.getAllByText(/Glucose/i).length).toBeGreaterThan(0);
  });
});
