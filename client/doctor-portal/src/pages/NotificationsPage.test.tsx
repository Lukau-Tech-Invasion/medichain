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
        },
        {
          id: 'CB-1',
          type: 'code_blue',
          priority: 'critical',
          title: 'Code Blue Event',
          timestamp: now - 600,
          patient_id: 'PAT-2',
        },
      ],
    });
    vi.mocked(shared.markNotificationsRead).mockResolvedValue({
      success: true,
      read_at: now,
    });
  });

  it('lists what the server sent and counts only the entries newer than the read marker', async () => {
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Critical Value: Potassium')).toBeInTheDocument();
    });
    expect(screen.getByText('Code Blue Event')).toBeInTheDocument();
    // One of two, not two of two: read state is a comparison against the
    // server's marker, not the length of the list.
    expect(screen.getByText(/1 unread of 2/i)).toBeInTheDocument();
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
        },
        {
          id: 'CB-1',
          type: 'code_blue',
          priority: 'critical',
          title: 'Code Blue Event',
          timestamp: now - 600,
          patient_id: 'PAT-2',
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
