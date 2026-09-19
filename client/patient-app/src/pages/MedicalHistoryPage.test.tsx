import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { MedicalHistoryPage } from './MedicalHistoryPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMyImmunizations: vi.fn(),
  getMyFamilyHistory: vi.fn(),
  getPatientRecords: vi.fn(),
}));

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
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });

    vi.mocked(shared.getMyImmunizations).mockResolvedValue([]);
    vi.mocked(shared.getMyFamilyHistory).mockResolvedValue({
      patient_id: 'HEALTH123',
      family_members: [
        {
          relationship: 'Father',
          living: true,
          current_age: 70,
          age_at_death: null,
          cause_of_death: null,
          conditions: [{ condition: 'Diabetes', age_at_diagnosis: 45, notes: null }],
        },
        {
          relationship: 'Mother',
          living: true,
          current_age: 68,
          age_at_death: null,
          cause_of_death: null,
          conditions: [{ condition: 'Hypertension', age_at_diagnosis: null, notes: null }],
        },
      ],
      genetic_conditions: [],
      three_gen_complete: false,
      last_updated: 0,
      updated_by: 'clinician',
    });
    vi.mocked(shared.getPatientRecords).mockResolvedValue([]);
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
