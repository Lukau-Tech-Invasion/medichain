import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as shared from '@medichain/shared';
import { DialogHost } from '@medichain/shared';
import SecurityIncidentsPage from './SecurityIncidentsPage';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listSecurityAlerts: vi.fn(),
  declareBreach: vi.fn(),
}));

const detected: shared.SecurityAlert = {
  id: 'AL-1',
  kind: 'failed_auth_burst',
  severity: 'high',
  actor: '5Attacker',
  message: '6 failed sign-ins in 5 minutes',
  notify_deadline: null,
  created_at: '2026-09-24T08:00:00Z',
};

function renderPage() {
  return render(
    <>
      <SecurityIncidentsPage />
      <DialogHost />
    </>
  );
}

describe('SecurityIncidentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.listSecurityAlerts).mockResolvedValue({ success: true, alerts: [detected], count: 1 });
  });

  it('lists what the detectors raised', async () => {
    renderPage();
    const list = await screen.findByTestId('security-alerts');
    expect(within(list).getByText(/Repeated failed sign-ins/i)).toBeInTheDocument();
    expect(within(list).getByText(/5Attacker/)).toBeInTheDocument();
  });

  it('says the log could not be read rather than that nothing happened', async () => {
    vi.mocked(shared.listSecurityAlerts).mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByText(/it is not known whether anything was detected/i)).toBeInTheDocument();
    expect(screen.queryByText(/No security alerts have been raised/i)).toBeNull();
  });

  it('declares a breach only after confirmation, and reports who was notified', async () => {
    vi.mocked(shared.declareBreach).mockResolvedValue({
      success: true,
      alert: { ...detected, id: 'AL-2', kind: 'breach_declared', severity: 'critical', notify_deadline: '2026-09-27T08:00:00Z' },
      officers_notified: 1,
      regulator_emails_notified: 0,
      message: 'Breach recorded.',
    });
    renderPage();
    await screen.findByTestId('security-alerts');

    fireEvent.change(screen.getByLabelText(/What happened/i), { target: { value: 'Laptop with exports stolen' } });
    fireEvent.click(screen.getByRole('button', { name: /Declare breach/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(shared.declareBreach).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: /Declare breach/i }));

    await waitFor(() =>
      expect(shared.declareBreach).toHaveBeenCalledWith({ description: 'Laptop with exports stolen' })
    );
    expect(await screen.findByText(/Security officers notified: 1; regulator contacts emailed: 0/i)).toBeInTheDocument();
  });

  it('refuses an empty declaration without sending it', async () => {
    renderPage();
    await screen.findByTestId('security-alerts');
    fireEvent.click(screen.getByRole('button', { name: /Declare breach/i }));
    expect(await screen.findByText(/Describe what happened/i)).toBeInTheDocument();
    expect(shared.declareBreach).not.toHaveBeenCalled();
  });
});
