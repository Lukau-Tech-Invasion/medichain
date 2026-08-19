import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AnalyticsPage from './AnalyticsPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AnalyticsPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        // This dashboard reports hospital operations — patient, appointment,
        // financial and CDS metrics, plus per-department and 24h patient flow.
        // It has no diagnosis-distribution breakdown.
        json: () => Promise.resolve({
          patient_metrics: { total_patients: 240, new_patients: 12 },
          appointment_metrics: {
            total_appointments: 88,
            completed_appointments: 71,
            telehealth_percentage: 18.5,
          },
          financial_metrics: {},
          cds_metrics: { total_alerts: 9 },
          department_metrics: [
            {
              department: 'emergency',
              patients: 34,
              avg_wait_time: 42,
              bed_occupancy: 88,
              staff_on_duty: 12,
            },
          ],
          patient_flow: [
            { hour: '08:00', admissions: 5, discharges: 2, transfers: 1 },
          ],
        }),
      });
    });
  });

  it('renders analytics page', async () => {
    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Analytics Dashboard/i)).toBeInTheDocument();
      expect(screen.getByText(/Total Patients/i)).toBeInTheDocument();
      expect(screen.getByText(/Patient Flow \(24h\)/i)).toBeInTheDocument();
    });
  });

  it('shows chart placeholders or labels', async () => {
    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Appointments/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Telehealth %/i)).toBeInTheDocument();
    });
  });
});
