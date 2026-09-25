import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PharmacistDashboardPage from './PharmacistDashboardPage';
import { useAuthStore } from '../store';
import { answerPrompt } from '../../../shared/src/testing/dialogs';

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
    vi.mocked(useAuthStore).mockReturnValue({
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
    vi.mocked(useAuthStore).mockReturnValue({ user: mockUser, isAuthenticated: true });
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
    render(
      <MemoryRouter>
        <PharmacistDashboardPage />
      </MemoryRouter>
    );

    const dispense = await screen.findByRole('button', { name: /^dispense$/i });
    const before = mockFetch.mock.calls.length;
    fireEvent.click(dispense);

    await answerPrompt(null);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockFetch.mock.calls.length).toBe(before);
  });

  /** A non-numeric or zero quantity is refused locally, for the same reason. */
  it('refuses a zero quantity without calling the API', async () => {
    render(
      <MemoryRouter>
        <PharmacistDashboardPage />
      </MemoryRouter>
    );

    const dispense = await screen.findByRole('button', { name: /^dispense$/i });
    const before = mockFetch.mock.calls.length;
    fireEvent.click(dispense);
    await answerPrompt('0');

    await screen.findByText(/whole number of units/i);
    expect(mockFetch.mock.calls.length).toBe(before);
  });
});

describe('PharmacistDashboardPage secondary verification actions', () => {
  const pharmacistId = 'pharmacist-second';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: { walletAddress: pharmacistId, role: 'Pharmacist' },
      isAuthenticated: true,
    });
  });

  const dashboard = (prescription: Record<string, unknown>, currentId = pharmacistId) => ({
    pharmacist_id: currentId,
    prescriptions: { pending_fill: 0, in_progress: 1, completed_today: 0, list: [prescription] },
    drug_interactions: [],
    allergy_alerts: [],
  });

  const response = (body: unknown) => Promise.resolve({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  });

  it('offers request only to the first pharmacist and blocks dispense', async () => {
    const prescription = {
      prescription_id: 'RX-VERIFY-REQUEST', patient_id: 'PAT-1', medication_name: 'Medicine',
      dosage: '1mg', status: 'InProgress', priority: 'Routine',
      secondary_verification: {
        required: true, status: 'Required', first_pharmacist_id: 'pharmacist-first',
      },
    };
    mockFetch.mockImplementation(() => response(dashboard(prescription, 'pharmacist-first')));
    render(<MemoryRouter><PharmacistDashboardPage /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: /request second pharmacist/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^dispense$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /approve verification/i })).toBeNull();
  });

  it('offers approve and reject only to a distinct pharmacist', async () => {
    const prescription = {
      prescription_id: 'RX-VERIFY-PENDING', patient_id: 'PAT-2', medication_name: 'Medicine',
      dosage: '1mg', status: 'InProgress', priority: 'Routine',
      secondary_verification: {
        required: true, status: 'Pending', first_pharmacist_id: 'pharmacist-first',
        requested_by: 'pharmacist-first',
      },
    };
    mockFetch.mockImplementation(() => response(dashboard(prescription)));
    render(<MemoryRouter><PharmacistDashboardPage /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: /approve verification/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /reject verification/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^dispense$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /request second pharmacist/i })).toBeNull();
  });

  it('enables dispense only after server state is Verified', async () => {
    const prescription = {
      prescription_id: 'RX-VERIFY-DONE', patient_id: 'PAT-3', medication_name: 'Medicine',
      dosage: '1mg', status: 'InProgress', priority: 'Routine',
      secondary_verification: {
        required: true, status: 'Verified', first_pharmacist_id: 'pharmacist-first',
      },
    };
    mockFetch.mockImplementation(() => response(dashboard(prescription)));
    render(<MemoryRouter><PharmacistDashboardPage /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: /^dispense$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve verification/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reject verification/i })).toBeNull();
    // Not a party to the check: nothing to withdraw.
    expect(screen.queryByRole('button', { name: /withdraw verification/i })).toBeNull();
  });

  it('lets the verifying pharmacist withdraw the check, with a reason', async () => {
    const prescription = {
      prescription_id: 'RX-VERIFY-WITHDRAW', patient_id: 'PAT-4', medication_name: 'Medicine',
      dosage: '1mg', status: 'InProgress', priority: 'Routine',
      secondary_verification: {
        required: true, status: 'Verified', first_pharmacist_id: 'pharmacist-first',
        requested_by: 'pharmacist-first', verified_by: pharmacistId,
      },
    };
    mockFetch.mockImplementation(() => response(dashboard(prescription)));
    render(<MemoryRouter><PharmacistDashboardPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /withdraw verification/i }));
    await answerPrompt('Dose query from prescriber');
    await waitFor(() => {
      const call = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('/api/e-prescriptions/RX-VERIFY-WITHDRAW/verification/revoke'));
      expect(call).toBeTruthy();
      expect(String(call?.[1]?.body)).toContain('Dose query from prescriber');
    });
  });
});

describe('PharmacistDashboardPage dispense correction history', () => {
  const prescription = {
    prescription_id: 'RX-HISTORY', patient_id: 'PAT-9', medication_name: 'Insulin',
    dosage: '10 units', status: 'PartialFill', priority: 'Routine',
    prescribed_quantity: 20, dispensed_quantity: 10,
  };
  const dashboard = {
    pharmacist_id: 'pharmacist-one',
    prescriptions: { pending_fill: 0, in_progress: 1, completed_today: 1, list: [prescription] },
    drug_interactions: [], allergy_alerts: [],
  };
  const jsonResponse = (body: unknown) => Promise.resolve({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: { walletAddress: 'pharmacist-one', role: 'Pharmacist' },
      isAuthenticated: true,
    });
    mockFetch.mockImplementation((request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.endsWith('/dispense-events')) {
        return jsonResponse({ dispense_events: [
          { dispense_event_id: 'DISP-1', prescription_id: 'RX-HISTORY', quantity: 10, reversed: false },
        ] });
      }
      if (url.endsWith('/dispense/reverse') && init?.method === 'POST') {
        return jsonResponse({ success: true, status: 'InProgress', dispensed_total: 0 });
      }
      return jsonResponse(dashboard);
    });
  });

  it('shows persisted quantity progress and loads immutable history', async () => {
    render(<MemoryRouter><PharmacistDashboardPage /></MemoryRouter>);

    expect(await screen.findByText(/10 of 20 units dispensed/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^history$/i }));

    expect(await screen.findByText(/dispensed 10 units/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^reverse$/i })).toBeTruthy();
  });

  it('posts a reason and reloads retained original plus correction history', async () => {
    let historyReads = 0;
    mockFetch.mockImplementation((request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.endsWith('/dispense-events')) {
        historyReads += 1;
        return jsonResponse({ dispense_events: historyReads === 1 ? [
          { dispense_event_id: 'DISP-1', prescription_id: 'RX-HISTORY', quantity: 10, reversed: false },
        ] : [
          { dispense_event_id: 'DISP-1', prescription_id: 'RX-HISTORY', quantity: 10, reversed: true },
          { dispense_event_id: 'DISP-REV-1', prescription_id: 'RX-HISTORY', quantity: 10, correction: true, reason: 'Wrong patient selected' },
        ] });
      }
      if (url.endsWith('/dispense/reverse') && init?.method === 'POST') {
        return jsonResponse({ success: true, status: 'InProgress', dispensed_total: 0 });
      }
      return jsonResponse(dashboard);
    });
    render(<MemoryRouter><PharmacistDashboardPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /^history$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^reverse$/i }));
    await answerPrompt('Wrong patient selected');

    await screen.findByText(/correction for 10 units: wrong patient selected/i);
    expect(screen.getByText(/dispensed 10 units.*reversed/i)).toBeTruthy();
    const reverseCall = mockFetch.mock.calls.find(([request, init]) =>
      String(request).endsWith('/dispense/reverse') && init?.method === 'POST'
    );
    expect(reverseCall).toBeTruthy();
    expect(JSON.parse(String(reverseCall?.[1]?.body))).toEqual({
      dispense_event_id: 'DISP-1', reason: 'Wrong patient selected',
    });
  });
});
