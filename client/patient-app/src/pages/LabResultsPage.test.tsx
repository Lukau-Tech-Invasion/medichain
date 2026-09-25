import { render, screen, waitFor } from '@testing-library/react';
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
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
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
