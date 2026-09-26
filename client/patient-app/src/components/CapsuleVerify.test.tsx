import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@medichain/shared';
import * as shared from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CapsuleVerify } from './CapsuleVerify';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  verifyPatientRecord: vi.fn(),
}));

function answer(status: shared.CapsuleVerification) {
  vi.mocked(shared.verifyPatientRecord).mockResolvedValue({
    patient_id: 'PAT-1',
    emergency_capsule: status,
    access_logs: [],
    rows_checked_limit: 200,
  });
}

function verify() {
  render(
    <I18nProvider>
      <CapsuleVerify patientId="PAT-1" />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('emergency card verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms a match with the finalized chain record', async () => {
    answer('match');
    verify();
    expect(await screen.findByText(/matches the record on the blockchain/i)).toBeInTheDocument();
  });

  it('warns clearly on a mismatch', async () => {
    answer('mismatch');
    verify();
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not match/i);
  });

  it('says an unanchored card cannot be verified, rather than calling it verified', async () => {
    answer('unanchored');
    verify();
    expect(await screen.findByText(/not anchored on the blockchain yet/i)).toBeInTheDocument();
  });

  it('keeps a failed check distinct from a finding about the card', async () => {
    vi.mocked(shared.verifyPatientRecord).mockRejectedValue(new Error('offline'));
    verify();
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a finding about your record/i);
  });
});
