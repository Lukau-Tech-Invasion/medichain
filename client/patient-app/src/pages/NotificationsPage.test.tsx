import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NotificationsPage } from './NotificationsPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

vi.mock('@medichain/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return { ...actual, getNotifications: vi.fn(), getPatientCdsAlerts: vi.fn(), markNotificationsRead: vi.fn(), markNotificationRead: vi.fn(), removeNotification: vi.fn() };
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
    userId: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
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
        key: 'lab_result:notif1',
        read: false,
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

  it('preserves the inbox when alerts fail and retries only the failed resource', async () => {
    vi.mocked(shared.getPatientCdsAlerts).mockRejectedValueOnce(new Error('Synthetic alert outage'));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    expect(await screen.findByText('Your lab results are ready')).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('Clinical alerts could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: /Clinical Alerts/ }));
    expect(screen.queryByText('No clinical alerts')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry clinical alerts' }));
    expect(await screen.findByText('High Blood Pressure')).toBeVisible();
    expect(shared.getNotifications).toHaveBeenCalledOnce();
    expect(shared.getPatientCdsAlerts).toHaveBeenCalledTimes(2);
  });

  it('keeps available clinical alerts visible when the inbox fails without claiming caught up', async () => {
    vi.mocked(shared.getNotifications).mockRejectedValueOnce(new Error('Synthetic inbox outage'));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Notifications could not be loaded');
    expect(screen.queryByText('All caught up')).not.toBeInTheDocument();
    expect(screen.queryByText('No notifications')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Clinical Alerts/ }));
    expect(await screen.findByText('High Blood Pressure')).toBeVisible();
  });

  it('lists a read entry under History, not New', async () => {
    vi.mocked(shared.getNotifications).mockResolvedValueOnce({
      success: true, count: 1, unread_count: 0, read_at: 200,
      notifications: [{ id: 'read-entry', type: 'information', priority: 'low', title: 'Previously read notice', timestamp: 100, key: 'information:read-entry', read: true }],
    });
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    expect(await screen.findByText('No new notifications')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'History (1)' }));
    expect(await screen.findByText('Previously read notice')).toBeVisible();
    expect(screen.getByText('Read')).toBeVisible();
    expect(screen.getByText('All caught up')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument();
  });

  it('reports a failed mark-read write and retains the unread state', async () => {
    vi.mocked(shared.markNotificationsRead).mockRejectedValueOnce(new Error('Synthetic write outage'));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be marked read');
    expect(screen.getByText('1 unread')).toBeVisible();
    expect(shared.getNotifications).toHaveBeenCalledOnce();
  });
  it('keeps the inbox usable while clinical alerts are still pending', async () => {
    let resolveAlerts!: (value: Awaited<ReturnType<typeof shared.getPatientCdsAlerts>>) => void;
    vi.mocked(shared.getPatientCdsAlerts).mockImplementationOnce(() => new Promise(resolve => { resolveAlerts = resolve; }));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    expect(await screen.findByText('Your lab results are ready')).toBeVisible();
    expect(screen.queryByText('No clinical alerts')).not.toBeInTheDocument();
    resolveAlerts({ success: true, patient_id: 'HEALTH123', alerts: [], count: 0 });
    fireEvent.click(await screen.findByRole('button', { name: 'Clinical Alerts (0)' }));
    expect(await screen.findByText('No clinical alerts')).toBeVisible();
  });

  it('discards a late inbox response after the patient changes', async () => {
    let resolveInbox!: (value: Awaited<ReturnType<typeof shared.getNotifications>>) => void;
    vi.mocked(shared.getNotifications).mockImplementationOnce(() => new Promise(resolve => { resolveInbox = resolve; }));
    const view = render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    await screen.findByRole('button', { name: 'Clinical Alerts (1)' });
    vi.mocked(shared.getNotifications).mockResolvedValueOnce({ success: true, notifications: [], count: 0, unread_count: 0, read_at: 0 });
    (usePatientAuthStore as unknown as Mock).mockReturnValue({ patient: { ...mockPatient, userId: 'second-user', healthId: 'HEALTH456' }, isAuthenticated: true });
    view.rerender(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    await screen.findByText('No notifications');
    resolveInbox({ success: true, notifications: [{ id: 'old', title: 'Previous patient notice', type: 'test', priority: 'low', timestamp: 100, key: 'test:old', read: false }], count: 1, unread_count: 1, read_at: 0 });
    await waitFor(() => expect(screen.getByText('No notifications')).toBeVisible());
    expect(screen.queryByText('Previous patient notice')).not.toBeInTheDocument();
  });

  it('tapping a new notification marks it read and moves it to History', async () => {
    vi.mocked(shared.markNotificationRead).mockResolvedValue({ success: true, key: 'lab_result:notif1' });
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    const entry = await screen.findByText('Your lab results are ready');
    vi.mocked(shared.getNotifications).mockResolvedValueOnce({
      success: true, count: 1, unread_count: 0, read_at: 0,
      notifications: [{ id: 'notif1', type: 'lab_result', priority: 'low', title: 'Your lab results are ready', timestamp: 100, key: 'lab_result:notif1', read: true }],
    });
    fireEvent.click(entry);
    await waitFor(() => expect(shared.markNotificationRead).toHaveBeenCalledWith('lab_result:notif1'));
    expect(await screen.findByRole('tab', { name: 'History (1)' })).toBeVisible();
  });

  it('removes a notification from the screen through the server', async () => {
    vi.mocked(shared.removeNotification).mockResolvedValue({ success: true, key: 'lab_result:notif1' });
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    await screen.findByText('Your lab results are ready');
    vi.mocked(shared.getNotifications).mockResolvedValueOnce({ success: true, count: 0, unread_count: 0, read_at: 0, notifications: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Your lab results are ready" from your notifications' }));
    await waitFor(() => expect(shared.removeNotification).toHaveBeenCalledWith('lab_result:notif1'));
    expect(await screen.findByText('No notifications')).toBeVisible();
  });
});
