import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
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
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/lab/patient/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [
              {
                id: 'lab1',
                test_name: 'Glucose',
                result_date: '2025-01-15',
                result_value: '95',
                unit: 'mg/dL',
                normal_range: '70-99',
                status: 'normal',
              },
              {
                id: 'lab2',
                test_name: 'Hemoglobin A1c',
                result_date: '2025-01-15',
                result_value: '7.5',
                unit: '%',
                normal_range: '4.0-5.6',
                status: 'abnormal',
                is_abnormal: true,
              }
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
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
      expect(screen.getByText(/Lab Test Results/i)).toBeInTheDocument();
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
      json: () => Promise.resolve({ results: [] }),
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
