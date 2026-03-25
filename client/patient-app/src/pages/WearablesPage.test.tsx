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
vi.mock('@medichain/shared', () => ({
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
    (shared.getWearableDevices as any).mockResolvedValue([]);
    (shared.getWearableReadings as any).mockResolvedValue([]);
  });

  it('renders wearables page with dashboard tab active', async () => {
    render(<WearablesPage />);

    await waitFor(() => {
      expect(screen.getByText(/Wearables & Devices/i)).toBeInTheDocument();
      expect(screen.getByText(/Daily Activity/i)).toBeInTheDocument();
    });
  });

  it('allows switching to devices tab', async () => {
    render(<WearablesPage />);

    await waitFor(() => {
      expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
    });

    const devicesTab = screen.getByText(/My Devices/i);
    fireEvent.click(devicesTab);
    
    await waitFor(() => {
      expect(screen.getByText(/Connected Devices/i)).toBeInTheDocument();
      expect(screen.getByText(/Add New Device/i)).toBeInTheDocument();
    });
  });

  it('displays demo metrics when no API data is available', async () => {
    render(<WearablesPage />);

    await waitFor(() => {
      // Demo metrics include Heart Rate, Steps, etc.
      expect(screen.getByText(/Heart Rate/i)).toBeInTheDocument();
      expect(screen.getByText(/Steps/i)).toBeInTheDocument();
    });
  });
});
