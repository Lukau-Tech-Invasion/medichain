import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MedicalHistoryPage } from './MedicalHistoryPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('MedicalHistoryPage (Patient)', () => {
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

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          patient_id: '1',
          medical_conditions: ['Diabetes', 'Hypertension'],
          past_surgeries: ['Appendectomy (2015)'],
          family_history: ['Father: Diabetes'],
          allergies: ['Peanuts'],
        }),
      });
    });
  });

  it('renders medical history page', async () => {
    render(
      <MemoryRouter>
        <MedicalHistoryPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Medical History/i)).toBeInTheDocument();
      expect(screen.getByText(/Diabetes/i)).toBeInTheDocument();
      expect(screen.getByText(/Hypertension/i)).toBeInTheDocument();
    });
  });

  it('displays family history section', async () => {
    render(
      <MemoryRouter>
        <MedicalHistoryPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Family History/i)).toBeInTheDocument();
      expect(screen.getByText(/Father: Diabetes/i)).toBeInTheDocument();
    });
  });
});
