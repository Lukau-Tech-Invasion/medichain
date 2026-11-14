import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as shared from '@medichain/shared';
import { answerConfirm } from '../../../shared/src/testing/dialogs';
import { ReissueActivationCode } from './ReissueActivationCode';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reissuePatientActivationCode: vi.fn(),
}));

describe('ReissueActivationCode', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('issues a new code after confirmation and shows it once', async () => {
    vi.mocked(shared.reissuePatientActivationCode).mockResolvedValue({
      success: true, activation_code: 'QA-CODE-1234', activation_expires_at: '2026-11-21T10:00:00Z',
    });
    render(<ReissueActivationCode patientId="PAT-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Issue a new activation code' }));
    await answerConfirm(true);
    expect(await screen.findByText('QA-CODE-1234')).toBeInTheDocument();
    expect(shared.reissuePatientActivationCode).toHaveBeenCalledWith('PAT-1');
  });

  it('issues nothing when the confirmation is cancelled', async () => {
    render(<ReissueActivationCode patientId="PAT-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Issue a new activation code' }));
    await answerConfirm(false);
    expect(shared.reissuePatientActivationCode).not.toHaveBeenCalled();
  });

  it('says plainly when the account is already active', async () => {
    vi.mocked(shared.reissuePatientActivationCode).mockRejectedValue(
      new shared.ApiClientError('active', 'ALREADY_ACTIVATED', 409));
    render(<ReissueActivationCode patientId="PAT-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Issue a new activation code' }));
    await answerConfirm(true);
    expect(await screen.findByRole('alert')).toHaveTextContent(/already activated/i);
  });
});
