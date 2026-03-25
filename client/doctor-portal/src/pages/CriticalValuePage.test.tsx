import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CriticalValuePage from './CriticalValuePage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
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
      expect(screen.getByText(/Potassium/i)).toBeInTheDocument();
      expect(screen.getByText(/6.5/i)).toBeInTheDocument();
    });
  });

  it('allows switching to history tab', async () => {
    render(<CriticalValuePage />);

    const historyTab = screen.getByText(/History/i);
    fireEvent.click(historyTab);
    
    expect(screen.getByPlaceholderText(/Search notifications/i)).toBeInTheDocument();
  });

  it('allows switching to report new tab', async () => {
    render(<CriticalValuePage />);

    const reportTab = screen.getByText(/Report New/i);
    fireEvent.click(reportTab);
    
    expect(screen.getByText(/Report New Critical Value/i)).toBeInTheDocument();
  });
});
