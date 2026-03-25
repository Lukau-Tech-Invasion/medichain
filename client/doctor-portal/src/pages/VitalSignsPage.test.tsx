import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import VitalSignsPage from './VitalSignsPage';
import { useAuthStore, usePatientStore } from '../store';

// Mock the stores
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
  usePatientStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('VitalSignsPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  const mockFlowsheet = {
    patient_id: 'PAT-001',
    patient_name: 'John Doe',
    readings: [
      {
        reading_id: '1',
        patient_id: 'PAT-001',
        recorded_at: new Date().toISOString(),
        recorded_by: 'DOC-001',
        heart_rate: 72,
        respiratory_rate: 16,
        blood_pressure_systolic: 120,
        blood_pressure_diastolic: 80,
        temperature_celsius: 37.0,
        oxygen_saturation: 98,
      }
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });
    (usePatientStore as any).mockReturnValue({
      recentPatients: [{ id: 'PAT-001', name: 'John Doe' }],
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/vitals/PAT-001')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockFlowsheet),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  it('renders vital signs page', async () => {
    render(
      <MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}>
        <VitalSignsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Vital Signs Flowsheet/i)).toBeInTheDocument();
      expect(screen.getByText(/John Doe/i)).toBeInTheDocument();
    });
  });

  it('displays vital readings in flowsheet', async () => {
    render(
      <MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}>
        <VitalSignsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('72')).toBeInTheDocument(); // heart rate
      expect(screen.getByText('120/80')).toBeInTheDocument(); // BP
    });
  });

  it('allows opening the add new vitals form', async () => {
    render(
      <MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}>
        <VitalSignsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const addButton = screen.getByText(/Record New Vitals/i);
      fireEvent.click(addButton);
    });

    expect(screen.getByText(/New Vital Signs Entry/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Heart Rate/i)).toBeInTheDocument();
  });
});
