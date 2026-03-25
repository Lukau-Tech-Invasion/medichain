import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DashboardPage } from './DashboardPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('DashboardPage (Patient)', () => {
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
      logout: vi.fn(),
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/patients/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            patient_id: '1',
            full_name: 'Test Patient',
            health_id: 'HEALTH123',
            blood_type: 'O_POSITIVE',
            allergies: ['Peanuts'],
            current_medications: ['Aspirin'],
            medical_conditions: ['Hypertension'],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    });
  });

  it('renders dashboard with patient information', async () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Hello, Test Patient/i)).toBeInTheDocument();
      expect(screen.getByText(/HEALTH123/i)).toBeInTheDocument();
      expect(screen.getByText(/O\+/i)).toBeInTheDocument();
    });
  });

  it('shows health summary cards', async () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Allergies/i)).toBeInTheDocument();
      expect(screen.getByText(/Current Medications/i)).toBeInTheDocument();
      expect(screen.getByText(/Peanuts/i)).toBeInTheDocument();
      expect(screen.getByText(/Aspirin/i)).toBeInTheDocument();
    });
  });

  it('provides navigation links to other pages', async () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/My Medical Records/i).closest('a')).toHaveAttribute('href', '/records');
      expect(screen.getByText(/Manage Consent/i).closest('a')).toHaveAttribute('href', '/consent');
      expect(screen.getByText(/Emergency Card/i).closest('a')).toHaveAttribute('href', '/emergency-card');
    });
  });
});
