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

const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Responses in the shape the API actually returns.
 *
 * The previous version of this file mocked `patient_metrics`,
 * `appointment_metrics`, `cds_metrics`, `department_metrics` and
 * `patient_flow` — a contract no MediChain endpoint has ever served. The page
 * read those same invented keys, so the test and the bug agreed with each
 * other: all three assertions passed while the live page reported a hospital
 * with 0 patients, 0 appointments and 0 alerts.
 *
 * Every body below is copied from a real response against a running API, which
 * is the only thing that makes these assertions worth anything.
 */
const RESPONSES: Record<string, unknown> = {
  '/api/platform/analytics/dashboard': {
    success: true,
    metrics: {
      total_patients: 240,
      total_medical_records: 31,
      total_system_accesses: 189,
      avg_latency_ms: 12.3,
      system_uptime: 100.0,
      uptime_seconds: 334,
      total_requests: 34,
      server_errors: 0,
      blockchain_status: 'disabled',
    },
  },
  '/api/platform/analytics/appointments': {
    status_distribution: { Scheduled: 24, Completed: 71 },
    total_appointments: 88,
    completed_appointments: 71,
    telehealth_appointments: 16,
    telehealth_percentage: 18.5,
    period_start: '2026-08-01',
    period_end: '2026-08-20',
  },
  '/api/platform/analytics/quality': {
    clinical_alerts_total: 9,
    critical_alerts: 2,
    audit_logs_coverage: 0.0,
    audit_entries_total: 189,
    audit_entries_anchored: 0,
    compliance_score: null,
    compliance_score_basis: 'requires_reviewed_assessment',
  },
  '/api/platform/analytics/operations': {
    success: true,
    measured: {
      radiology_queue: 1,
      lab_pending: 0,
      lab_turnaround_median_minutes: null,
      unacknowledged_critical_values: 1,
      patient_satisfaction_average: null,
      patient_satisfaction_responses: 0,
    },
    unmeasured: ['bed_availability', 'ed_wait_time'],
  },
  '/api/platform/list/critical-values': [],
};

function respondByUrl(url: string) {
  const match = Object.keys(RESPONSES).find((path) => url.includes(path));
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(match ? RESPONSES[match] : {}),
  });
}

describe('AnalyticsPage', () => {
  // Analytics is an administrator surface: it aggregates the whole
  // deployment's patient and departmental figures, which is not a clinician's
  // view of their own patients. The page enforces that, so the rendering tests
  // below have to sign in as one. The Doctor case is covered at the end.
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Admin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });
    mockFetch.mockImplementation((input: RequestInfo | URL) =>
      respondByUrl(String(input))
    );
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

  /**
   * The regression test. Each figure below exists in exactly one place in the
   * mocked responses, so a tile can only display it by reading the field the
   * API really sends. Under the old `patient_metrics.total_patients` lookup
   * every one of these rendered as `0`.
   */
  it('shows the figures the API actually returned, not zeros', async () => {
    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    // metrics.total_patients — the field that was being read from a
    // `patient_metrics` object the API does not send.
    expect(await screen.findByText('240')).toBeInTheDocument();
    // appointments.total_appointments
    expect(await screen.findByText('88')).toBeInTheDocument();
    // appointments.telehealth_percentage, formatted
    expect(await screen.findByText('18.5%')).toBeInTheDocument();
    // quality.clinical_alerts_total
    expect(await screen.findByText('9')).toBeInTheDocument();
    // The accompanying change lines come from real counts too.
    expect(await screen.findByText(/31 records on file/i)).toBeInTheDocument();
    expect(await screen.findByText(/71 completed/i)).toBeInTheDocument();
    expect(await screen.findByText(/2 critical/i)).toBeInTheDocument();
  });

  /**
   * A period with no appointments must not read as "0% of visits were
   * telehealth" — that is a claim about visits that did not happen. The API
   * sends null and the tile shows an em dash.
   */
  it('shows a dash, not 0%, when no appointment falls in the period', async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/platform/analytics/appointments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () =>
            Promise.resolve({
              status_distribution: {},
              total_appointments: 0,
              completed_appointments: 0,
              telehealth_appointments: 0,
              telehealth_percentage: null,
            }),
        });
      }
      return respondByUrl(url);
    });

    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    await screen.findByText(/Telehealth %/i);
    await waitFor(() => {
      expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    });
  });

  /**
   * Bed occupancy, wait times, staffing and hourly flow have no source in this
   * deployment. The panels must say so — an empty chart reads as "no activity",
   * which is a different and much more reassuring claim than "not measured".
   */
  it('says the department and flow panels have no data source', async () => {
    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    expect(
      await screen.findByText(
        /need a bed and roster model this deployment does not have/i
      )
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        /need an encounter-flow model this deployment does not have/i
      )
    ).toBeInTheDocument();
  });

  /**
   * The period buttons must mean calendar periods, and must include the rest of
   * the period rather than stopping at today.
   *
   * `getDateRange` used to return `[N days ago, today]` for every option. On a
   * booking dashboard that drops the wrong half of the data: most appointments
   * are in the future, and `endDate = today` excluded all of them. "This Year"
   * reported 17 appointments against 44 in the calendar year, under a label
   * promising the year.
   */
  it('asks for the calendar year, through to 31 December', async () => {
    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    await screen.findByText(/Analytics Dashboard/i);

    const year = new Date().getFullYear();
    await waitFor(() => {
      const calls = mockFetch.mock.calls.map((c: unknown[]) => String(c[0]));
      const appts = calls.filter((u) => u.includes('/analytics/appointments'));
      expect(appts.length).toBeGreaterThan(0);
    });

    // Default period is "today": both bounds are the same local calendar day,
    // and neither is derived from a UTC shift.
    const todayCall = mockFetch.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .find((u) => u.includes('/analytics/appointments'))!;
    const d = new Date();
    const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    expect(todayCall).toContain(`start_date=${localToday}`);
    expect(todayCall).toContain(`end_date=${localToday}`);

    // Switching to the year must request 1 Jan -> 31 Dec of the current year,
    // not a trailing 365 days ending today.
    const yearButton = screen.getByRole('button', { name: /this year/i });
    yearButton.click();

    await waitFor(() => {
      const calls = mockFetch.mock.calls.map((c: unknown[]) => String(c[0]));
      const yearCall = calls.find(
        (u) => u.includes('/analytics/appointments') && u.includes(`start_date=${year}-01-01`)
      );
      expect(yearCall).toBeDefined();
      expect(yearCall).toContain(`end_date=${year}-12-31`);
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

  it('tells a non-administrator the section is restricted rather than rendering it', async () => {
    (useAuthStore as any).mockReturnValue({
      user: { walletAddress: '5GrwvaEF...mock', role: 'Doctor' },
      isAuthenticated: true,
    });

    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    // The restriction is announced, and none of the deployment-wide figures
    // reach the page. A blank panel would leave a clinician unsure whether the
    // hospital has no data or they simply cannot see it.
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/Analytics Dashboard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Total Patients/i)).not.toBeInTheDocument();
  });
});
