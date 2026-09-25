import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NurseDashboardPage from './NurseDashboardPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NurseDashboardPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
    fullName: 'Nurse Jackie',
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
        json: () => Promise.resolve({
          assigned_patients: 5,
          pending_medications: 12,
          critical_alerts: 2,
          upcoming_tasks: 8,
        }),
      });
    });
  });

  it('renders nurse dashboard', async () => {
    render(
      <MemoryRouter>
        <NurseDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Nursing Dashboard/i)).toBeInTheDocument();
      expect(screen.getAllByText(/My Patients/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Vitals Due/i)).toBeInTheDocument();
    });
  });

  it('shows quick action links', async () => {
    render(
      <MemoryRouter>
        <NurseDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Open MAR/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/I\/O Documentation/i)).toBeInTheDocument();
      expect(screen.getByText(/Record Vitals/i)).toBeInTheDocument();
    });
  });

  it('lists the nursing orders outstanding on the order book', async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(String(url).includes('/api/nurse/tasks')
        ? { success: true, tasks: [{
            id: 'ORD-1', type: 'wound_care', patient_id: 'PAT-7', frequency: 'BD',
            last_done: 0, priority: 'medium', instructions: 'Change sacral dressing',
          }] }
        : {}),
    }));
    render(<MemoryRouter><NurseDashboardPage /></MemoryRouter>);

    expect(await screen.findByText(/Wound care ordered/i)).toBeInTheDocument();
    expect(screen.getByText('PAT-7')).toBeInTheDocument();
    expect(screen.getByText(/BD — Change sacral dressing/)).toBeInTheDocument();
  });

  it('says the orders could not be read rather than that nothing is outstanding', async () => {
    mockFetch.mockImplementation((url: string) => String(url).includes('/api/nurse/tasks')
      ? Promise.resolve({ ok: false, status: 503, headers: new Headers({ 'content-type': 'application/json' }), json: () => Promise.resolve({}) })
      : Promise.resolve({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: () => Promise.resolve({}) }));
    render(<MemoryRouter><NurseDashboardPage /></MemoryRouter>);

    expect(await screen.findByText(/Nursing orders could not be loaded/i)).toBeInTheDocument();
  });
});
