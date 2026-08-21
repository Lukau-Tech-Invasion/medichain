import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PatientDetailPage from './PatientDetailPage';
import { useAuthStore } from '../store';

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

describe('PatientDetailPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  const mockPatientData = {
    patient_id: 'PAT-001',
    full_name: 'John Doe',
    date_of_birth: '1980-05-15',
    national_id: 'ID12345',
    emergency_info: {
      blood_type: 'A+',
      allergies: [{ name: 'Peanuts' }],
      current_medications: ['Lisinopril'],
      chronic_conditions: ['Hypertension'],
      emergency_contacts: [
        { name: 'Jane Doe', phone: '555-1212', relationship: 'Spouse' }
      ],
      organ_donor: true,
      dnr_status: false,
    },
    last_updated: '2025-01-01',
    primary_doctor: { provider_id: 'DOC-123' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockPatientData,
    });
  });

  it('renders loading state initially', () => {
    render(
      <MemoryRouter initialEntries={['/patients/PAT-001']}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Loading patient information/i)).toBeInTheDocument();
  });

  it('renders patient details after loading', async () => {
    render(
      <MemoryRouter initialEntries={['/patients/PAT-001']}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText(/ID12345/i)).toBeInTheDocument();
      expect(screen.getByText(/A\+/i)).toBeInTheDocument();
      expect(screen.getByText(/Peanuts/i)).toBeInTheDocument();
      expect(screen.getByText(/Lisinopril/i)).toBeInTheDocument();
      expect(screen.getByText(/Hypertension/i)).toBeInTheDocument();
    });
  });

  it('shows error message when patient is not found', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    render(
      <MemoryRouter initialEntries={['/patients/INVALID']}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Patient not found/i)).toBeInTheDocument();
    });
  });

  it('allows switching between tabs', async () => {
    render(
      <MemoryRouter initialEntries={['/patients/PAT-001']}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Records$/i }));

    expect(screen.getByRole('heading', { name: /Medical Records/i })).toBeInTheDocument();
    expect(screen.getByText(/stored encrypted on IPFS/i)).toBeInTheDocument();
  });
});
