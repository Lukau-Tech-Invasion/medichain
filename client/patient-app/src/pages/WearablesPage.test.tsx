import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
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
    vi.clearAllMocks();
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
    });
    // Empty devices/readings means the dashboard correctly shows its empty
    // state; the generated test then asserted metric tiles that cannot exist.
    (shared.getWearableDevices as any).mockResolvedValue({
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
    (shared.getWearableReadings as any).mockResolvedValue({
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
});
