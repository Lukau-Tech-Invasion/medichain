import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import WearablesPage from './WearablesPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getWearableDevices: vi.fn(),
  listWearableAlertRules: vi.fn(),
  getWearableAlerts: vi.fn(),
  createWearableAlertRule: vi.fn(),
  getUserSettings: vi.fn(),
  saveUserSettings: vi.fn(),
  disconnectWearableDevice: vi.fn(),
  getWearableReadings: vi.fn(),
  registerWearableDevice: vi.fn(),
}));

describe('WearablesPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  beforeEach(() => {
    vi.mocked(shared.getUserSettings).mockResolvedValue({ wearables: {} } as never);
    vi.mocked(shared.saveUserSettings).mockResolvedValue({ success: true } as never);
    vi.mocked(shared.listWearableAlertRules).mockResolvedValue({
      success: true,
      count: 0,
      rules: [],
    } as never);
    vi.mocked(shared.getWearableAlerts).mockResolvedValue({
      success: true,
      count: 0,
      alerts: [],
    } as never);
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
    });
    // Empty devices/readings means the dashboard correctly shows its empty
    // state; the generated test then asserted metric tiles that cannot exist.
    vi.mocked(shared.getWearableDevices).mockResolvedValue({
      success: true,
      count: 1,
      devices: [{
        device_id: 'd1', patient_id: 'HEALTH123', device_type: 'Smartwatch',
        manufacturer: 'Test', model: 'Band', serial_number: null,
        firmware_version: null, connection_status: 'Connected', last_sync: null,
        paired_at: 0, active: true, data_types: ['HeartRate', 'Steps'],
        sync_frequency_hours: 1, battery_level: 80,
      }],
    });
    // Metric tiles render per reading; an empty array means the dashboard
    // correctly shows nothing, so the metric assertions could never pass.
    vi.mocked(shared.getWearableReadings).mockResolvedValue({
      success: true,
      count: 2,
      readings: [
        { reading_id: 'r1', device_id: 'd1', patient_id: 'HEALTH123', data_type: 'HeartRate', value: 72, unit: 'bpm', secondary_value: null, recorded_at: 1, synced_at: 1, context: null, quality: 'High', flagged: false, flag_reason: null },
        { reading_id: 'r2', device_id: 'd1', patient_id: 'HEALTH123', data_type: 'Steps', value: 8000, unit: 'steps', secondary_value: null, recorded_at: 2, synced_at: 2, context: null, quality: 'High', flagged: false, flag_reason: null },
      ],
    });
  });

  it('renders wearables page with dashboard tab active', async () => {
    render(<WearablesPage />);

    await waitFor(() => {
      expect(screen.getByText(/My Wearables/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Steps/i).length).toBeGreaterThan(0);
    });
  });

  it('uses the returned device identifier to load readings', async () => {
    render(<WearablesPage />);

    await waitFor(() => {
      expect(shared.getWearableReadings).toHaveBeenCalledWith('d1');
    });
  });

  it('allows switching to devices tab', async () => {
    render(<WearablesPage />);

    await waitFor(() => {
      expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
    });

    const devicesTab = screen.getByText(/Devices/i);
    fireEvent.click(devicesTab);
    
    await waitFor(() => {
      expect(screen.getByText(/Connected Devices/i)).toBeInTheDocument();
      expect(screen.getByText(/Add Device/i)).toBeInTheDocument();
    });
  });

  it('displays demo metrics when no API data is available', async () => {
    render(<WearablesPage />);

    await waitFor(() => {
      // Demo metrics include Heart Rate, Steps, etc.
      expect(screen.getAllByText(/Heart Rate/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Steps/i).length).toBeGreaterThan(0);
    });
  });

  // --- Alerting ---------------------------------------------------------------
  //
  // Nothing in either client created an alert rule, read the saved rules back,
  // or showed the alerts they raised. Because no screen ever displayed a stored
  // rule, nobody noticed the server wrote every one of them as "above 0.0" --
  // true of every reading a wearable sends.

  async function openSettings() {
    render(<WearablesPage />);
    const tab = await screen.findByRole('button', { name: /settings/i });
    fireEvent.click(tab);
  }

  it('says which direction a saved rule watches', async () => {
    vi.mocked(shared.listWearableAlertRules).mockResolvedValue({
      success: true,
      count: 1,
      rules: [
        {
          rule_id: 'RULE-1',
          patient_id: 'PAT-1',
          data_type: 'HeartRate',
          threshold_type: 'Below',
          threshold_value: 50,
          secondary_threshold: null,
          severity: 'Urgent',
          notify_patient: true,
          notify_provider: true,
          provider_id: null,
          active: true,
          created_at: 1789000000,
        },
      ],
    } as never);
    await openSettings();

    // The direction is the whole rule: "below 50" and "above 50" are opposite
    // instructions, and the old code stored both as the latter.
    await waitFor(() =>
      expect(screen.getByText(/drops below 50/i)).toBeInTheDocument()
    );
  });

  it('shows a band rule as a band', async () => {
    vi.mocked(shared.listWearableAlertRules).mockResolvedValue({
      success: true,
      count: 1,
      rules: [
        {
          rule_id: 'RULE-2',
          patient_id: 'PAT-1',
          data_type: 'SpO2',
          threshold_type: 'OutsideRange',
          threshold_value: 100,
          secondary_threshold: 92,
          severity: 'Critical',
          notify_patient: true,
          notify_provider: true,
          provider_id: null,
          active: true,
          created_at: 1789000000,
        },
      ],
    } as never);
    await openSettings();

    await waitFor(() => expect(screen.getByText(/leaves 92 to 100/i)).toBeInTheDocument());
  });

  it('refuses a rule with neither bound before sending it', async () => {
    await openSettings();

    fireEvent.click(await screen.findByRole('button', { name: /save alert/i }));

    // A rule with no bound has nothing to watch for. The server refuses it too;
    // saying so here names the missing field instead of a generic failure.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(shared.createWearableAlertRule).not.toHaveBeenCalled();
  });

  it('sends an unfilled bound as absent, not as zero', async () => {
    vi.mocked(shared.createWearableAlertRule).mockResolvedValue({ success: true } as never);
    await openSettings();

    fireEvent.change(await screen.findByLabelText(/tell me below/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /save alert/i }));

    await waitFor(() => expect(shared.createWearableAlertRule).toHaveBeenCalled());
    // `threshold_high: 0` would mean "alert me above zero" — a different rule,
    // and one that is true of every reading.
    expect(vi.mocked(shared.createWearableAlertRule).mock.calls[0][0]).toMatchObject({
      threshold_low: 50,
      threshold_high: null,
    });
  });

  it('does not claim no alerts are set when the read failed', async () => {
    vi.mocked(shared.listWearableAlertRules).mockRejectedValue(new Error('boom'));
    await openSettings();

    await waitFor(() =>
      expect(screen.getByText(/not a confirmation that none are set/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/You have not set any alerts/i)).not.toBeInTheDocument();
  });


  // --- Settings that are actually settings ------------------------------------
  //
  // The sync and sharing toggles rendered from literals with no `onChange`, and
  // "Disconnect all" had no handler. They looked settable, nothing was stored,
  // and nothing read them back.

  it('reflects a stored preference rather than a literal', async () => {
    vi.mocked(shared.getUserSettings).mockResolvedValue({
      wearables: { syncCellular: true, shareProvider: false },
    } as never);
    await openSettings();

    // `syncCellular` ships off and `shareProvider` ships on; both are inverted
    // here, so a hardcoded render would fail this.
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /cellular/i })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    );
    expect(screen.getByRole('switch', { name: /provider/i })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('persists a toggle instead of only moving it', async () => {
    vi.mocked(shared.getUserSettings).mockResolvedValue({ wearables: {} } as never);
    vi.mocked(shared.saveUserSettings).mockResolvedValue({ success: true } as never);
    await openSettings();

    const toggle = await screen.findByRole('switch', { name: /cellular/i });
    fireEvent.click(toggle);

    await waitFor(() => expect(shared.saveUserSettings).toHaveBeenCalled());
    const sent = vi.mocked(shared.saveUserSettings).mock.calls[0][0] as {
      wearables: Record<string, boolean>;
    };
    expect(sent.wearables.syncCellular).toBe(true);
  });

  it('puts a toggle back when the save fails', async () => {
    vi.mocked(shared.getUserSettings).mockResolvedValue({ wearables: {} } as never);
    vi.mocked(shared.saveUserSettings).mockRejectedValue(new Error('boom'));
    await openSettings();

    const toggle = await screen.findByRole('switch', { name: /cellular/i });
    fireEvent.click(toggle);

    // A switch that stays where the finger left it while the server never heard
    // is the exact failure this section existed as.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /cellular/i })).toHaveAttribute(
        'aria-checked',
        'false'
      )
    );
  });

  it('names the devices that did NOT disconnect', async () => {
    vi.mocked(shared.getUserSettings).mockResolvedValue({ wearables: {} } as never);
    vi.mocked(shared.getWearableDevices).mockResolvedValue({
      success: true,
      count: 2,
      devices: [
        { id: 'DEV-1', device_name: 'Watch A', device_type: 'apple-watch' },
        { id: 'DEV-2', device_name: 'Watch B', device_type: 'fitbit' },
      ],
    } as never);
    vi.mocked(shared.disconnectWearableDevice)
      .mockResolvedValueOnce({ success: true, device_id: 'DEV-1', is_active: false } as never)
      .mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openSettings();

    fireEvent.click(await screen.findByRole('button', { name: /disconnect all/i }));

    // "Some devices were disconnected" would leave a patient believing a device
    // stopped streaming when it did not.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/may still be sending/i));
  });

});
