import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PharmacistDashboardPage from './PharmacistDashboardPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('PharmacistDashboardPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Pharmacist',
    fullName: 'Pharmacist Phil',
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
          pending_prescriptions: 15,
          clinical_interventions: 4,
          verified_today: 32,
          stock_alerts: 2,
        }),
      });
    });
  });

  it('renders pharmacist dashboard', async () => {
    render(
      <MemoryRouter>
        <PharmacistDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Pharmacy Dashboard/i)).toBeInTheDocument();
      expect(screen.getByText(/Pending Rx/i)).toBeInTheDocument();
            expect(screen.getByText(/STAT Orders/i)).toBeInTheDocument();
    });
  });

  it('shows quick action links', async () => {
    render(
      <MemoryRouter>
        <PharmacistDashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Verify Prescription/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Dispense/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Check Interactions/i)).toBeInTheDocument();
    });
  });
});

describe('PharmacistDashboardPage dispensing actions (SCR-013)', () => {
  const mockUser = { walletAddress: '5Ew3MyB1...mock', role: 'Pharmacist' };

  /** One prescription per lifecycle state the queue can contain. */
  const queue = {
    prescriptions: {
      pending_fill: 4,
      completed_today: 0,
      list: [
        { prescription_id: 'RX-T', patient_id: 'PAT-1', patient_name: 'A', medication_name: 'Amoxicillin', dosage: '500mg', status: 'Transmitted', priority: 'routine' },
        { prescription_id: 'RX-R', patient_id: 'PAT-2', patient_name: 'B', medication_name: 'Ibuprofen', dosage: '200mg', status: 'Received', priority: 'routine' },
        { prescription_id: 'RX-P', patient_id: 'PAT-3', patient_name: 'C', medication_name: 'Metformin', dosage: '500mg', status: 'PartialFill', priority: 'routine' },
        { prescription_id: 'RX-D', patient_id: 'PAT-4', patient_name: 'D', medication_name: 'Aspirin', dosage: '75mg', status: 'Dispensed', priority: 'routine' },
      ],
    },
    drug_interactions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({ user: mockUser, isAuthenticated: true });
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(queue),
      })
    );
  });

  /**
   * The queue used to be read-only: four declared states and no way to enter
   * any of them. Each row must now offer the action its state permits.
   */
  it('offers exactly the action each prescription state permits', async () => {
    render(
      <MemoryRouter>
        <PharmacistDashboardPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('button', { name: /^receive$/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /start fill/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^dispense$/i })).toBeTruthy();
  });

  /**
   * A completed prescription offers nothing to press.
   *
   * Showing a disabled Dispense on a finished prescription would invite a
   * pharmacist to try, and the API would refuse -- training them to expect
   * refusals from buttons that look available.
   */
  it('offers no action on a fully dispensed prescription', async () => {
    render(
      <MemoryRouter>
        <PharmacistDashboardPage />
      </MemoryRouter>
    );

    await screen.findByRole('button', { name: /^receive$/i });
    // Exactly three actionable rows out of four.
    const actions = screen.getAllByRole('button', {
      name: /^(receive|start fill|dispense)$/i,
    });
    expect(actions.length).toBe(3);
  });

  /**
   * A dismissed quantity prompt must not call the API.
   *
   * The endpoint requires a positive quantity and would refuse; a refusal the
   * pharmacist never asked for is indistinguishable from a broken button.
   */
  it('does not dispense when the quantity prompt is dismissed', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(
      <MemoryRouter>
        <PharmacistDashboardPage />
      </MemoryRouter>
    );

    const dispense = await screen.findByRole('button', { name: /^dispense$/i });
    const before = mockFetch.mock.calls.length;
    fireEvent.click(dispense);

    await waitFor(() => expect(promptSpy).toHaveBeenCalled());
    expect(mockFetch.mock.calls.length).toBe(before);
    promptSpy.mockRestore();
  });

  /** A non-numeric or zero quantity is refused locally, for the same reason. */
  it('refuses a zero quantity without calling the API', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('0');
    render(
      <MemoryRouter>
        <PharmacistDashboardPage />
      </MemoryRouter>
    );

    const dispense = await screen.findByRole('button', { name: /^dispense$/i });
    const before = mockFetch.mock.calls.length;
    fireEvent.click(dispense);

    await screen.findByText(/whole number of units/i);
    expect(mockFetch.mock.calls.length).toBe(before);
    promptSpy.mockRestore();
  });
});
