import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import LabTechDashboardPage from './LabTechDashboardPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LabTechDashboardPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Laboratory Tech',
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
        json: () => Promise.resolve({
          pending_tests: 10,
          urgent_tests: 3,
          completed_today: 45,
          qc_status: 'Passed',
        }),
      });
    });
  });

  it('renders lab tech dashboard', async () => {
    render(
      <MemoryRouter>
        <LabTechDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Laboratory Dashboard/i)).toBeInTheDocument();
      expect(screen.getByText(/STAT Queue/i)).toBeInTheDocument();
            expect(screen.getAllByText(/QC/i).length).toBeGreaterThan(0);
    });
  });

  it('shows quick action buttons', async () => {
    render(
      <MemoryRouter>
        <LabTechDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Enter Results/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Run QC/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Log Specimen/i)).toBeInTheDocument();
    });
  });
});

describe('LabTechDashboardPage recollection control (SCR-009b)', () => {
  const mockUser = { walletAddress: '5GrwvaEF...mock', role: 'Laboratory Tech' };

  /** One rejected specimen, so the rejection panel has a row to render. */
  const dashboardWithRejection = {
    pending_tests: 1,
    urgent_tests: 0,
    completed_today: 0,
    qc_status: 'Passed',
    rejections: [
      {
        id: 'REJ-1',
        accession_number: 'ACC-1',
        rejection_reason: 'Haemolysed',
        patient_name: 'Synthetic Patient',
        notified_ordering_provider: false,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({ user: mockUser, isAuthenticated: true });
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(dashboardWithRejection),
      })
    );
  });

  /**
   * The control must be present and must be its own action.
   *
   * A "Request Recollect" button sat next to Notify as a comment for a long
   * time precisely because collapsing the two would have been wrong: telling
   * the ordering provider a specimen failed does not obtain another sample.
   */
  it('offers Recollect as an action distinct from Notify', async () => {
    render(
      <MemoryRouter>
        <LabTechDashboardPage />
      </MemoryRouter>
    );

    const recollect = await screen.findByRole('button', { name: /request recollection/i });
    const notify = await screen.findByRole('button', { name: /notify/i });
    expect(recollect).toBeTruthy();
    expect(notify).toBeTruthy();
    expect(recollect).not.toBe(notify);
  });

  /**
   * A cancelled prompt must not call the API.
   *
   * The endpoint requires a reason and would refuse an empty one, and a refusal
   * the technician never asked for reads exactly like a dead button.
   */
  it('does not call the API when the reason prompt is dismissed', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(
      <MemoryRouter>
        <LabTechDashboardPage />
      </MemoryRouter>
    );

    const recollect = await screen.findByRole('button', { name: /request recollection/i });
    const callsBefore = mockFetch.mock.calls.length;
    fireEvent.click(recollect);

    await waitFor(() => expect(promptSpy).toHaveBeenCalled());
    expect(mockFetch.mock.calls.length).toBe(callsBefore);
    promptSpy.mockRestore();
  });
});
