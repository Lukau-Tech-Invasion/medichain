import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import LabReviewPage from './LabReviewPage';
import { getPendingLabResults, reviewLabResult } from '@medichain/shared';
import { useAuthStore } from '../store';

vi.mock('@medichain/shared', async () => {
  const actual: any = await vi.importActual('@medichain/shared');
  return {
    ...actual,
    getPendingLabResults: vi.fn(),
    reviewLabResult: vi.fn(),
    // Render the key so assertions do not depend on copy, but keep
    // interpolation visible where a test needs the substituted value.
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, unknown>) =>
        vars ? `${key}:${Object.values(vars).join(',')}` : key,
    }),
  };
});

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

/**
 * The page under test is the interface for a maker-checker control, so these
 * cover two things that are not the same: that it renders the queue, and that
 * it refuses to offer an action the server will reject.
 *
 * The self-review case matters most. The API answers SELF_REVIEW_FORBIDDEN, and
 * a screen that discovers that only after the click has taught the reviewer
 * nothing and cost them a round trip.
 */
describe('LabReviewPage', () => {
  const submission = (over: Record<string, unknown> = {}) => ({
    id: 'LAB-1',
    patient_id: 'PAT-1',
    patient_name: 'Thandiwe Test',
    test_name: 'Full Blood Count',
    test_category: 'Hematology',
    results: [
      {
        parameter: 'Haemoglobin',
        value: '13.2',
        unit: 'g/dL',
        reference_range: '12.0-17.5',
        flag: null,
      },
    ],
    notes: 'synthetic',
    submitted_by: 'lab_tech_wallet',
    submitted_at: new Date('2026-08-26T08:00:00Z').toISOString(),
    status: 'Pending',
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockImplementation((sel: any) =>
      sel({ user: { walletAddress: 'doctor_wallet', role: 'Doctor' } })
    );
  });

  it('lists what is waiting for signature', async () => {
    (getPendingLabResults as any).mockResolvedValue([submission()]);
    render(<LabReviewPage />);

    expect(await screen.findByText('Full Blood Count')).toBeTruthy();
    expect(screen.getByText(/Thandiwe Test/)).toBeTruthy();
    // The values are the point of the screen, not decoration.
    expect(screen.getByText('Haemoglobin')).toBeTruthy();
    expect(screen.getByText(/13\.2/)).toBeTruthy();
  });

  /**
   * `ApiClient.get` unwraps `{ submissions: [...] }` to a bare array, so the
   * page sees a list — but the route really does return the envelope, and only
   * one of those facts is visible in the types. It has to survive both.
   */
  it('accepts the envelope shape as well as the bare array', async () => {
    (getPendingLabResults as any).mockResolvedValue({
      submissions: [submission()],
      total: 1,
    });
    render(<LabReviewPage />);
    expect(await screen.findByText('Full Blood Count')).toBeTruthy();
  });

  it('approves through the API and refreshes the queue', async () => {
    (getPendingLabResults as any)
      .mockResolvedValueOnce([submission()])
      .mockResolvedValueOnce([]);
    (reviewLabResult as any).mockResolvedValue({ success: true });

    render(<LabReviewPage />);
    fireEvent.click(await screen.findByRole('button', { name: /lab\.review\.approve/ }));

    await waitFor(() =>
      expect(reviewLabResult).toHaveBeenCalledWith({
        submission_id: 'LAB-1',
        action: 'approve',
      })
    );
    // Re-read, not a local removal: another clinician may have decided
    // something else meanwhile.
    await waitFor(() => expect(getPendingLabResults).toHaveBeenCalledTimes(2));
  });

  it('will not let the submitter sign off their own result', async () => {
    (getPendingLabResults as any).mockResolvedValue([
      submission({ submitted_by: 'doctor_wallet' }),
    ]);
    render(<LabReviewPage />);

    const approve = await screen.findByRole('button', { name: /lab\.review\.approve/ });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    // Disabled *and* explained. A greyed-out button with no reason is its own
    // kind of dead end.
    expect(screen.getByText('lab.review.selfReview')).toBeTruthy();
    expect(reviewLabResult).not.toHaveBeenCalled();
  });

  it('refuses to send a rejection with no reason', async () => {
    (getPendingLabResults as any).mockResolvedValue([submission()]);
    render(<LabReviewPage />);

    fireEvent.click(await screen.findByRole('button', { name: /lab\.review\.reject/ }));

    // The API answers REJECTION_REASON_REQUIRED; catching it here means the
    // reviewer is told before the round trip rather than after it.
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(reviewLabResult).not.toHaveBeenCalled();
  });

  it('sends the reason when one is given', async () => {
    (getPendingLabResults as any)
      .mockResolvedValueOnce([submission()])
      .mockResolvedValueOnce([]);
    (reviewLabResult as any).mockResolvedValue({ success: true });

    render(<LabReviewPage />);
    await screen.findByText('Full Blood Count');

    fireEvent.change(screen.getByLabelText(/lab\.review\.reasonLabel/), {
      target: { value: 'haemolysed sample' },
    });
    fireEvent.click(screen.getByRole('button', { name: /lab\.review\.reject/ }));

    await waitFor(() =>
      expect(reviewLabResult).toHaveBeenCalledWith({
        submission_id: 'LAB-1',
        action: 'reject',
        rejection_reason: 'haemolysed sample',
      })
    );
  });

  it('surfaces a server refusal instead of appearing to succeed', async () => {
    (getPendingLabResults as any).mockResolvedValue([submission()]);
    (reviewLabResult as any).mockRejectedValue(new Error('AUDIT_UNAVAILABLE'));

    render(<LabReviewPage />);
    fireEvent.click(await screen.findByRole('button', { name: /lab\.review\.approve/ }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/AUDIT_UNAVAILABLE/)).toBeTruthy();
  });

  /**
   * Accessibility properties this page is responsible for. A clinician signing
   * off results with a keyboard and a screen reader needs the results table to
   * be a table, and the rejection box to have a name that says which result it
   * belongs to — there is one per row.
   */
  it('exposes the results as a real table with an accessible name', async () => {
    (getPendingLabResults as any).mockResolvedValue([submission()]);
    render(<LabReviewPage />);

    const table = await screen.findByRole('table', {
      name: /lab\.review\.tableCaption/,
    });
    expect(within(table).getByRole('columnheader', { name: /lab\.review\.parameter/ })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: /lab\.review\.value/ })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: /lab\.review\.range/ })).toBeTruthy();
  });

  it('names each rejection box after the result it rejects', async () => {
    (getPendingLabResults as any).mockResolvedValue([
      submission(),
      submission({ id: 'LAB-2', test_name: 'Urea and Electrolytes' }),
    ]);
    render(<LabReviewPage />);
    await screen.findByText('Full Blood Count');

    // Two rows, two boxes, each identifiable by name rather than by position.
    expect(screen.getByLabelText(/lab\.review\.reasonLabel:Full Blood Count/)).toBeTruthy();
    expect(screen.getByLabelText(/lab\.review\.reasonLabel:Urea and Electrolytes/)).toBeTruthy();
  });

  it('reports a failure to load rather than showing an empty queue', async () => {
    (getPendingLabResults as any).mockRejectedValue(new Error('network down'));
    render(<LabReviewPage />);

    // An empty queue and an unreachable server look identical otherwise, and
    // they mean opposite things to a clinician.
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/network down/)).toBeTruthy();
    expect(screen.queryByText('lab.review.empty')).toBeNull();
  });
});
