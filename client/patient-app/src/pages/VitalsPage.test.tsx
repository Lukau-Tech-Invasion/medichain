import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { VitalsPage } from './VitalsPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('VitalsPage (Patient)', () => {
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
      if (url.includes('/vitals/latest')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            heart_rate: 72,
            systolic_bp: 120,
            diastolic_bp: 80,
            temperature_celsius: 36.6,
            recorded_at: new Date().toISOString(),
          }),
        });
      }
      if (url.includes('/vitals')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            readings: [
              {
                heart_rate: 72,
                systolic_bp: 120,
                diastolic_bp: 80,
                temperature_celsius: 36.6,
                recorded_at: new Date().toISOString(),
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

  it('renders vitals page with latest readings', async () => {
    render(
      <MemoryRouter>
        <VitalsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Vital Signs/i)).toBeInTheDocument();
      expect(screen.getByText('72')).toBeInTheDocument(); // Heart rate
      expect(screen.getByText('120/80')).toBeInTheDocument(); // BP
      expect(screen.getByText('36.6°C')).toBeInTheDocument(); // Temp
    });
  });

  it('shows history list', async () => {
    render(
      <MemoryRouter>
        <VitalsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Recent History/i)).toBeInTheDocument();
    });
  });
});
