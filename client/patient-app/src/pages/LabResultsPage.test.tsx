import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { LabResultsPage } from './LabResultsPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LabResultsPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    userId: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
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
                id: 'lab1', patient_id: 'HEALTH123', patient_name: 'Test Patient',
                test_name: 'Glucose', test_category: 'Chemistry', notes: '',
                submitted_by: 'lab-tech', submitted_at: '2025-01-15T10:00:00Z',
                status: 'approved', results: [
                  { parameter: 'Glucose', value: '95', unit: 'mg/dL', reference_range: '70-99', flag: 'normal' },
                ],
              },
              {
                id: 'lab2', patient_id: 'HEALTH123', patient_name: 'Test Patient',
                test_name: 'Hemoglobin A1c', test_category: 'Chemistry', notes: '',
                submitted_by: 'lab-tech', submitted_at: '2025-01-15T10:00:00Z',
                status: 'approved', results: [
                  { parameter: 'Hemoglobin A1c', value: '7.5', unit: '%', reference_range: '4.0-5.6', flag: 'high' },
                ],
              }
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });
    });
  });

  it('opens the trend of a result on that result, and offers none for a single reading', async () => {
    const fallback = mockFetch.getMockImplementation();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('lab-trends')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({
            success: true,
            trends: [
              {
                loinc_code: 'Glucose', test_name: 'Glucose', unit: 'mg/dL',
                reference_range: { low: 70, high: 99 },
                trend_analysis: { direction: 'Increasing', percent_change: 18.8 },
                data_points: [
                  { result_id: 'g1', value: 80, collected_at: 1730000000, status: 'Normal' },
                  { result_id: 'g2', value: 95, collected_at: 1736935200, status: 'Normal' },
                ],
              },
              {
                loinc_code: 'Hemoglobin A1c', test_name: 'Hemoglobin A1c', unit: '%',
                trend_analysis: { direction: 'InsufficientData', percent_change: null },
                data_points: [{ result_id: 'h1', value: 7.5, collected_at: 1736935200, status: 'High' }],
              },
            ],
          }),
        });
      }
      return fallback?.(url, init);
    });
    render(<MemoryRouter><LabResultsPage /></MemoryRouter>);

    const show = await screen.findByRole('button', { name: /show trend \(2 results\)/i });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    // A1c has one reading: no trend to open.
    expect(screen.getAllByRole('button', { name: /show trend/i })).toHaveLength(1);
    fireEvent.click(show);
    expect(screen.getByRole('button', { name: /hide trend/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/\+18\.8%/)).toBeInTheDocument();
    expect(screen.getByText('80 mg/dL')).toBeInTheDocument();
  });

  it('renders lab results page with list of results', async () => {
    render(
      <MemoryRouter>
        <LabResultsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Lab Results/i)).toBeInTheDocument();
      expect(screen.getByText(/Glucose/i)).toBeInTheDocument();
      expect(screen.getByText(/Hemoglobin A1c/i)).toBeInTheDocument();
    });
  });

  it('highlights abnormal results', async () => {
    render(
      <MemoryRouter>
        <LabResultsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Abnormal/i)).toBeInTheDocument();
    });
  });

  it('shows no results message when list is empty', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ submissions: [] }),
    }));

    render(
      <MemoryRouter>
        <LabResultsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/No lab results found/i)).toBeInTheDocument();
    });
  });
});
