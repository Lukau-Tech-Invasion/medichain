import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage';
import { useAuthStore, usePatientStore } from '../store';

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
  usePatientStore: vi.fn(),
}));

describe('DashboardPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    username: 'Dr. Smith',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      logout: vi.fn(),
      restoreSession: vi.fn(),
    });
    (usePatientStore as any).mockReturnValue({
      recentPatients: [],
      setRecentPatients: vi.fn(),
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        role: 'Doctor',
        patients: { total: 10, list: [] },
        alerts: { pending_labs_count: 5, critical_values_count: 2, code_blues_count: 0 },
        active_orders: [],
        pending_lab_approvals: [],
        critical_values: [],
        recent_code_blues: [],
      }),
    });
  });

  it('renders dashboard with user welcome message', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Welcome back, Dr. Smith/i)).toBeInTheDocument();
  });

  it('displays stat cards with data from API', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Total Patients')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('Pending Lab Reviews')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('shows critical alerts when present', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        alerts: { critical_values_count: 1, code_blues_count: 1 },
        critical_values: [{ id: '1', patient_id: 'PAT-001', test_name: 'Glucose', value: '30', critical_reason: 'Hypoglycemia', reported_at: new Date().toISOString() }],
        patients: { total: 1, list: [] },
      }),
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Critical Alerts Require Attention/i)).toBeInTheDocument();
      expect(screen.getByText(/Glucose/i)).toBeInTheDocument();
      expect(screen.getByText(/Hypoglycemia/i)).toBeInTheDocument();
    });
  });
});
