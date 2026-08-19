import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({
          // The page reads `family_history` (or `entries`) and renders
          // `entry.condition` with `entry.relationship` beneath it. The
          // generated fixture used `medical_conditions`, a key the component
          // never looks at, so the list stayed empty.
          family_history: [
            {
              id: 'fh1',
              condition: 'Diabetes',
              relationship: 'Father',
              deceased: false,
              age_of_onset: 45,
            },
            {
              id: 'fh2',
              condition: 'Hypertension',
              relationship: 'Mother',
              deceased: false,
            },
          ],
          immunizations: [],
          records: [],
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

    // Family history is behind its own tab; the page opens on Immunizations.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Family History/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Family History/i }));

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

    // Open the tab before asserting on its contents.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Family History/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Family History/i }));

    await waitFor(() => {
      expect(screen.getByText(/Father/i)).toBeInTheDocument();
    });
  });
});
