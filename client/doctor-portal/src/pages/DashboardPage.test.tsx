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
      headers: new Headers({ 'content-type': 'application/json' }),
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
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        alerts: { critical_values_count: 1, code_blues_count: 1 },
        // The real `CriticalValueEntity` shape. This fixture used to invent
        // `critical_reason` and `reported_at`, which the API has never sent —
        // so the page rendered a stray "-" and the literal "Invalid Date" while
        // the test stayed green. A fixture that does not match the endpoint
        // cannot catch a contract break; it causes one.
        critical_values: [{
          id: '1',
          patient_id: 'PAT-001',
          test_name: 'Glucose',
          value: '2.1',
          unit: 'mmol/L',
          severity: 'critical',
          critical_low: '2.5',
          critical_high: null,
          reference_low: '4.0',
          reference_high: '7.8',
          created_at: new Date().toISOString(),
          notified_at: null,
          acknowledged_at: null,
        }],
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
    });

    // The number alone is not actionable: the unit and the breached limit are
    // what make 2.1 readable as a critical hypoglycaemia rather than a value
    // needing a lookup elsewhere.
    expect(screen.getByText(/2\.1 mmol\/L/)).toBeInTheDocument();
    expect(screen.getByText(/critical < 2\.5/)).toBeInTheDocument();
    // The timestamp must never render as the string "Invalid Date".
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it('renders an order with its clinical text, priority and time', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        alerts: { critical_values_count: 0, code_blues_count: 0 },
        critical_values: [],
        // `id` / `order_details` / `order_datetime` are the real field names.
        // The old shape (`order_id` / `description` / `ordered_at`) rendered
        // every order as a bare "lab:" with an "Invalid Date" beside it.
        active_orders: [{
          id: 'ORD-1',
          patient_id: 'PAT-001',
          order_type: 'lab',
          order_details: { text: 'Full blood count and U&E' },
          indication: 'Febrile since this morning',
          priority: 'stat',
          order_datetime: new Date().toISOString(),
          status: 'pending',
        }],
        patients: { total: 1, list: [] },
      }),
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/lab: Full blood count and U&E/i)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    // Lowercase "stat" from the API must still colour as urgent; the previous
    // comparison was against 'STAT' and never matched, so a STAT order was
    // shown in the same neutral grey as a routine one.
    expect(screen.getByText('stat')).toHaveClass('bg-red-100');
  });
});
