import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CriticalValuePage from './CriticalValuePage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';
import { answerPrompt } from '../../../shared/src/testing/dialogs';

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
  acknowledgeCriticalValue: vi.fn(),
  cancelCriticalValue: vi.fn(),
}));

// Mock toast actions
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }));
vi.mock('../components/Toast', () => ({
  useToastActions: () => toast,
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
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.listCriticalValues).mockResolvedValue({
      success: true,
      total: mockNotifications.length,
      items: mockNotifications,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
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

  describe('acknowledging through the server', () => {
    // The shape `/api/platform/list/critical-values` returns: the entity's
    // columns plus the notification fields at the top level.
    const SERVER_ROW = {
      id: 'CRV-1', notification_id: 'CRV-1', patient_id: 'PAT-001', patient_name: 'John Doe',
      analyte: 'Potassium', test_name: 'Potassium', value: 6.5, unit: 'mmol/L',
      critical_level: 'critical-high', threshold_exceeded: 'Critical High (>6)',
      ordering_provider: 'Dr. Smith', notification_status: 'pending',
      reported_by: 'lab', reported_at: new Date().toISOString(),
    };

    beforeEach(() => {
      vi.mocked(shared.listCriticalValues).mockResolvedValue({ success: true, total: 1, items: [SERVER_ROW] });
    });

    async function openAcknowledgment() {
      render(<CriticalValuePage />);
      fireEvent.click(await screen.findByRole('button', { name: /Acknowledge & Document/i }));
      fireEvent.change(document.getElementById('critval-read-back')!, { target: { value: 'K 6.5' } });
      fireEvent.click(screen.getByRole('button', { name: /Complete Acknowledgment/i }));
    }

    it('records the read-back on the server and reloads the list', async () => {
      vi.mocked(shared.acknowledgeCriticalValue).mockResolvedValue({});
      await openAcknowledgment();

      await waitFor(() => expect(shared.acknowledgeCriticalValue).toHaveBeenCalledWith('CRV-1', expect.objectContaining({
        notifiedProvider: 'Dr. Smith', notificationMethod: 'phone', readBackValue: 'K 6.5',
      })));
      await waitFor(() => expect(shared.listCriticalValues).toHaveBeenCalledTimes(2));
      expect(toast.showSuccess).toHaveBeenCalled();
    });

    it('says so when the server refuses, and claims nothing', async () => {
      vi.mocked(shared.acknowledgeCriticalValue).mockRejectedValue(new Error('down'));
      await openAcknowledgment();

      await waitFor(() => expect(toast.showError).toHaveBeenCalled());
      expect(toast.showSuccess).not.toHaveBeenCalled();
      expect(shared.listCriticalValues).toHaveBeenCalledTimes(1);
    });

    it('withdraws a notification through the server with its reason', async () => {
      vi.mocked(shared.cancelCriticalValue).mockResolvedValue({});
      render(<CriticalValuePage />);
      await screen.findByRole('button', { name: /Acknowledge & Document/i });

      fireEvent.click(screen.getAllByRole('button', { name: /^Cancel$/i })[0]);
      await answerPrompt('Haemolysed sample');

      await waitFor(() => expect(shared.cancelCriticalValue).toHaveBeenCalledWith('CRV-1', 'Haemolysed sample'));
      await waitFor(() => expect(shared.listCriticalValues).toHaveBeenCalledTimes(2));
    });
  });
});

