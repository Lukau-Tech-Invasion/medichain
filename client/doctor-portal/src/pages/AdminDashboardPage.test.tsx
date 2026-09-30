import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AdminDashboardPage from './AdminDashboardPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store.
//
// The specifier must match the one the component imports. This mocked
// '../store' while AdminDashboardPage imports '../store/authStore'; Vitest keys
// mocks by specifier, so the mock never applied, `user` stayed undefined, and
// the page correctly rendered its "restricted to administrators" notice. The
// suite then read that notice's own heading as though the dashboard had
// rendered — which is why the missing assertion was `System Status` and not
// `System Administration`.
//
// Spread the real module so its other exports (isAdmin, isHealthcareProvider,
// canEditMedicalRecords) survive; replacing the module wholesale leaves them
// undefined and any component using one fails with "Element type is invalid".
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AdminDashboardPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Admin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        // The page reads `system_stats`, not `stats`, and counts users by
        // role rather than by an 'active providers' aggregate.
        json: () => Promise.resolve({
          system_stats: {
            total_users: 100,
            total_patients: 80,
            doctors: 12,
            nurses: 25,
            lab_technicians: 4,
            pharmacists: 3,
            patient_users: 80,
          },
        }),
      });
    });
  });

  it('renders admin dashboard page with stats', async () => {
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/System Administration/i)).toBeInTheDocument();
      expect(screen.getByText(/System Status/i)).toBeInTheDocument();
      expect(screen.getAllByText('100').length).toBeGreaterThan(0); // total users
      expect(screen.getByText(/Total Users/i)).toBeInTheDocument();
    });
  });

  it('shows administration quick actions', async () => {
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Add User/i)).toBeInTheDocument();
      expect(screen.getByText(/Audit Report/i)).toBeInTheDocument();
      expect(screen.getByText(/Manage Roles/i)).toBeInTheDocument();
    });
  });

  it('shows the audit sealing state the health read reports, in plain words', async () => {
    const base = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/health/detailed')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({
            overall_status: 'healthy',
            version: '1.0.0',
            uptime_seconds: 10,
            timestamp: '2026-09-29T10:00:00Z',
            services: [],
            audit_seal: {
              unsealed_events: 7,
              last_sealed_at: '2026-09-29T09:00:00Z',
              last_exported_at: null,
              sink: 'none',
              signing: 'unsigned',
            },
          }),
        });
      }
      return base(url, init);
    });
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    );

    const panel = await screen.findByTestId('audit-seal-status');
    expect(panel).toHaveTextContent('7 entries waiting to be sealed');
    expect(panel).toHaveTextContent('Nothing exported yet');
    expect(panel).toHaveTextContent('without a signature (weaker)');
    expect(panel).not.toHaveTextContent(/blockchain|on-chain|anchor/i);
  });

  /**
   * The audit table is the one screen whose entire job is showing who touched
   * which record and when. Its row type declared `access_id`, `access_type`,
   * `timestamp` and `reason`; the API sends `id`, `action`, `accessed_at` and
   * `access_reason`, so every row rendered an empty Action, an empty Type and
   * the literal "Invalid Date".
   */
  it('renders access-log rows with a real action and time', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        system_stats: {
          total_users: 1, total_patients: 1, doctors: 1,
          nurses: 0, lab_technicians: 0, pharmacists: 0, patient_users: 1,
        },
        // The real `AccessLogEntity` field names.
        recent_access_logs: [
          {
            id: 'ACC-1',
            accessor_id: '5EsNMhJja8vV2hiuKE1sowi6nB64fnFSRPmLEig7rw1hkwDC',
            accessor_role: 'Doctor',
            patient_id: 'PAT-27b84e54',
            action: 'download_record',
            resource_type: 'medical_record',
            accessed_at: new Date().toISOString(),
            is_emergency_access: false,
            access_reason: null,
          },
          {
            id: 'ACC-2',
            accessor_id: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y',
            accessor_role: 'Nurse',
            patient_id: 'PAT-cc913e70',
            action: 'break_glass',
            resource_type: 'emergency_capsule',
            accessed_at: new Date().toISOString(),
            // The authoritative flag. Matching on the action string used to be
            // the only signal, so a break-glass access whose action did not
            // contain the word "emergency" was badged as routine.
            is_emergency_access: true,
            access_reason: 'Unresponsive patient',
          },
        ],
      }),
    });

    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('download_record')).toBeInTheDocument();
    expect(screen.getByText('break_glass')).toBeInTheDocument();
    // An audit trail must never show a timestamp it could not parse.
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });
});
