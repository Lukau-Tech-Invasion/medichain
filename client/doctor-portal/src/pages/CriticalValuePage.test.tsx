import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CriticalValuePage from './CriticalValuePage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  listCriticalValues: vi.fn(),
  createCriticalValue: vi.fn(),
}));

// Mock toast actions
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

describe('CriticalValuePage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Laboratory Tech',
  };

  const mockNotifications = [
    {
      notificationId: '1',
      patientId: 'PAT-001',
      patientName: 'John Doe',
      analyte: 'Potassium',
      value: 6.5,
      unit: 'mmol/L',
      criticalLevel: 'critical-high',
      thresholdExceeded: 'Critical High (>6.0)',
      reportedBy: 'Lab Tech A',
      reportedAt: new Date().toISOString(),
      orderingProvider: 'Dr. Smith',
      notificationStatus: 'pending',
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.listCriticalValues as any).mockResolvedValue(mockNotifications);
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders critical value page with pending notifications', async () => {
    render(<CriticalValuePage />);

    await waitFor(() => {
      expect(screen.getByText(/Critical Value Reporting/i)).toBeInTheDocument();
      // The value and its unit, matched together on the element that carries
      // them. This was `/6.5/i`, where the unescaped `.` is a regex wildcard —
      // so it also matched "6:5" inside the rendered timestamp and the query
      // failed with "found multiple elements" only during the minutes of the
      // day whose clock digits happen to line up (16:53:53 is one). A test that
      // depends on the wall clock is not a test; it is a coin flip with a
      // slow period.
      expect(screen.getByText(/Potassium/)).toBeInTheDocument();
      expect(screen.getByText(/6\.5\s*mmol\/L/)).toBeInTheDocument();
    });
  });

  it('allows switching to history tab', async () => {
    render(<CriticalValuePage />);

    const historyTab = screen.getByText(/History/i);
    fireEvent.click(historyTab);
    
    expect(screen.getByPlaceholderText(/Search by notification ID/i)).toBeInTheDocument();
  });

  it('allows switching to report new tab', async () => {
    render(<CriticalValuePage />);

    const reportTab = screen.getByText(/Report Critical Value/i);
    fireEvent.click(reportTab);
    
    expect(screen.getByText(/Report New Critical Value/i)).toBeInTheDocument();
  });
});
