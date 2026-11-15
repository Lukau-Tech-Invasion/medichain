import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as shared from '@medichain/shared';
import NotificationsPage from './NotificationsPage';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
  removeNotification: vi.fn(),
}));

const showError = vi.fn();
const showSuccess = vi.fn();
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({ showError, showSuccess }),
}));

/**
 * The screen the header bell points at.
 *
 * Until 2026-09-22 `/notifications` matched no route in this portal, so every
 * click on the bell fell through to the router's catch-all and landed on the
 * dashboard — with a badge still showing a count nobody could open.
 */
describe('NotificationsPage', () => {
  const now = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getNotifications).mockResolvedValue({
      success: true,
      count: 2,
      unread_count: 1,
      // Read five minutes ago: the older entry is read, the newer is not.
      read_at: now - 300,
      notifications: [
        {
          id: 'CV-1',
          type: 'critical_value',
          priority: 'high',
          title: 'Critical Value: Potassium',
          timestamp: now - 60,
          patient_id: 'PAT-1',
          key: 'critical_value:CV-1',
          read: false,
        },
        {
          id: 'CB-1',
          type: 'code_blue',
          priority: 'critical',
          title: 'Code Blue Event',
          timestamp: now - 600,
          patient_id: 'PAT-2',
          key: 'code_blue:CB-1',
          read: true,
        },
      ],
    });
    vi.mocked(shared.markNotificationsRead).mockResolvedValue({
      success: true,
      read_at: now,
    });
    vi.mocked(shared.markNotificationRead).mockResolvedValue({ success: true, key: 'critical_value:CV-1' });
    vi.mocked(shared.removeNotification).mockResolvedValue({ success: true, key: 'critical_value:CV-1' });
  });

  const renderPage = () =>
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );

  it('shows unread entries under New and read ones under History', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Critical Value: Potassium')).toBeInTheDocument();
    });
    // One of two, not two of two: read state is the server's, per entry.
    expect(screen.getByText(/1 unread of 2/i)).toBeInTheDocument();
    expect(screen.queryByText('Code Blue Event')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /history \(1\)/i }));
    expect(screen.getByText('Code Blue Event')).toBeInTheDocument();
    expect(screen.queryByText('Critical Value: Potassium')).not.toBeInTheDocument();
  });

  it('marking one read moves it to History', async () => {
    renderPage();
    await screen.findByText('Critical Value: Potassium');
    await userEvent.click(screen.getByRole('button', { name: /^mark as read$/i }));
    expect(shared.markNotificationRead).toHaveBeenCalledWith('critical_value:CV-1');
    await waitFor(() => expect(screen.queryByText('Critical Value: Potassium')).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /new \(0\)/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /history \(2\)/i }));
    expect(screen.getByText('Critical Value: Potassium')).toBeInTheDocument();
  });

  it('opening one marks it read before going to it', async () => {
    renderPage();
    await screen.findByText('Critical Value: Potassium');
    await userEvent.click(screen.getByRole('button', { name: /^open$/i }));
    await waitFor(() => expect(shared.markNotificationRead).toHaveBeenCalledWith('critical_value:CV-1'));
  });

  it('removing one takes it off the screen through the server', async () => {
    renderPage();
    await screen.findByText('Critical Value: Potassium');
    await userEvent.click(screen.getByRole('button', { name: /remove "critical value: potassium"/i }));
    expect(shared.removeNotification).toHaveBeenCalledWith('critical_value:CV-1');
    await waitFor(() => expect(screen.queryByText('Critical Value: Potassium')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: /history/i }));
    expect(screen.queryByText('Critical Value: Potassium')).not.toBeInTheDocument();
  });

  it('keeps the entry when the server refuses to remove it', async () => {
    vi.mocked(shared.removeNotification).mockRejectedValueOnce(new Error('down'));
    renderPage();
    await screen.findByText('Critical Value: Potassium');
    await userEvent.click(screen.getByRole('button', { name: /remove "critical value: potassium"/i }));
    await waitFor(() => expect(showError).toHaveBeenCalled());
    expect(screen.getByText('Critical Value: Potassium')).toBeInTheDocument();
  });

  it('marks everything read through the server and re-reads the list', async () => {
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('Critical Value: Potassium')).toBeInTheDocument();
    });

    vi.mocked(shared.getNotifications).mockResolvedValue({
      success: true,
      count: 2,
      unread_count: 0,
      read_at: now,
      notifications: [
        {
          id: 'CV-1',
          type: 'critical_value',
          priority: 'high',
          title: 'Critical Value: Potassium',
          timestamp: now - 60,
          patient_id: 'PAT-1',
          key: 'critical_value:CV-1',
          read: true,
        },
        {
          id: 'CB-1',
          type: 'code_blue',
          priority: 'critical',
          title: 'Code Blue Event',
          timestamp: now - 600,
          patient_id: 'PAT-2',
          key: 'code_blue:CB-1',
          read: true,
        },
      ],
    });

    await userEvent.click(screen.getByRole('button', { name: /mark all as read/i }));

    await waitFor(() => {
      expect(shared.markNotificationsRead).toHaveBeenCalled();
    });
    // Read, not deleted: the entries stay on screen.
    await waitFor(() => {
      expect(screen.getByText(/0 unread of 2/i)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('tab', { name: /history \(2\)/i }));
    expect(screen.getByText('Code Blue Event')).toBeInTheDocument();
  });

  it('says the list could not be read rather than showing an empty inbox', async () => {
    vi.mocked(shared.getNotifications).mockRejectedValue(new Error('network down'));

    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/nothing needs your attention/i)).not.toBeInTheDocument();
  });
});
