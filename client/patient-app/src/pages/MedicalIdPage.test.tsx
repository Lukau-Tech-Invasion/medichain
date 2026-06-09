import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider, ToastProvider } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MedicalIdPage } from './MedicalIdPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>
          <MedicalIdPage />
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe('MedicalIdPage (Patient)', () => {
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
          patient_id: 'HEALTH123',
          name: 'Test Patient',
          date_of_birth: '1990-01-01',
          blood_type: 'O+',
          allergies: [{ name: 'Peanuts', severity: 'high' }],
          medications: ['Aspirin'],
          conditions: ['Asthma'],
          emergency_contacts: [
            { name: 'Jane Doe', phone: '555-1212', relationship: 'Wife', can_make_medical_decisions: true }
          ],
          organ_donor: true,
          dnr_status: false,
          languages: ['English'],
          preferences: {
            show_when_locked: true,
            enable_location_sharing: false,
            auto_notify_family: true,
          }
        }),
      });
    });
  });

  it('renders medical ID page with patient info', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Medical ID' })).toBeInTheDocument();
      expect(screen.getByText('Test Patient')).toBeInTheDocument();
      expect(screen.getByText(/O\+/i)).toBeInTheDocument();
      expect(screen.getByText(/Asthma/i)).toBeInTheDocument();
    });
  });

  it('displays emergency contacts with decision authority', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Jane Doe/i)).toBeInTheDocument();
      expect(screen.getByText(/Legal authority to make medical decisions/i)).toBeInTheDocument();
    });
  });

  it('does not show an authoritative DNR block for a boolean dnr_status', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          patient_id: 'HEALTH123',
          name: 'Test Patient',
          date_of_birth: '1990-01-01',
          blood_type: 'O+',
          allergies: [],
          medications: [],
          conditions: [],
          emergency_contacts: [],
          organ_donor: false,
          dnr_status: true, // boolean => on file but UNVERIFIED
          languages: ['English'],
          preferences: {
            show_when_locked: true,
            enable_location_sharing: false,
            auto_notify_family: true,
          },
        }),
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/DNR on file — unverified/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Do Not Resuscitate/i)).not.toBeInTheDocument();
  });
});
