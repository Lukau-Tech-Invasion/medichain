import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NotificationsPage } from './NotificationsPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

vi.mock('@medichain/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return { ...actual, getNotifications: vi.fn(), getPatientCdsAlerts: vi.fn() };
});

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

describe('NotificationsPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });

    vi.mocked(shared.getNotifications).mockResolvedValue({
      success: true,
      count: 1,
      unread_count: 1,
      // Never read, so the entry below (stamped now) is unread.
      read_at: 0,
      notifications: [{
        id: 'notif1',
        type: 'lab_result',
        priority: 'low',
        title: 'Your lab results are ready',
        timestamp: Math.floor(Date.now() / 1000),
      }],
    });
    vi.mocked(shared.getPatientCdsAlerts).mockResolvedValue({
      success: true,
      patient_id: 'HEALTH123',
      count: 1,
      alerts: [{
        alert_id: 'alert1',
        title: 'High Blood Pressure',
        description: 'Your last reading was high',
        severity: 'Medium',
        alert_type: 'VitalSignAbnormal',
        created_at: Math.floor(Date.now() / 1000),
        status: 'Active',
      }],
    });
  });

  it('renders notifications page with notifications', async () => {
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Notifications/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Your lab results are ready/i)).toBeInTheDocument();
    });
  });

  it('allows switching to alerts tab', async () => {
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Clinical Alerts/i)).toBeInTheDocument();
    });

    const alertsTab = screen.getByText(/Clinical Alerts/i);
    fireEvent.click(alertsTab);
    
    await waitFor(() => {
      expect(screen.getByText(/High Blood Pressure/i)).toBeInTheDocument();
      expect(screen.getByText(/Your last reading was high/i)).toBeInTheDocument();
    });
  });
});
