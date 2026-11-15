import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import * as endpoints from '../../../shared/src/api/endpoints';
import { refreshNotificationBadges, useUnreadNotifications } from '@medichain/shared';

// The hook reads through the shared package's own endpoints module.
vi.mock('../../../shared/src/api/endpoints', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getNotifications: vi.fn(),
}));

function Bell() {
  const count = useUnreadNotifications(true);
  return <span data-testid="badge">{count === null ? 'unknown' : String(count)}</span>;
}

/** The bell changes the moment a notification is read or removed. */
describe('useUnreadNotifications', () => {
  it('re-reads the count when a notification page signals a change', async () => {
    const answer = (unread: number) => ({ success: true, notifications: [], count: unread, unread_count: unread, read_at: 0 });
    vi.mocked(endpoints.getNotifications).mockResolvedValueOnce(answer(1)).mockResolvedValueOnce(answer(0));
    render(<Bell />);
    expect(await screen.findByText('1')).toBeInTheDocument();
    await act(async () => {
      refreshNotificationBadges();
    });
    expect(await screen.findByText('0')).toBeInTheDocument();
  });
});
