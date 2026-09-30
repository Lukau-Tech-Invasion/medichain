import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@medichain/shared';
import * as shared from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CapsuleVerify } from './CapsuleVerify';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  verifyPatientRecord: vi.fn(),
}));

function sealedRow(signature: shared.SealSignature): shared.RowVerification {
  return {
    access_log_id: `log-${signature}`,
    accessed_at: '2026-09-01T10:00:00Z',
    integrity: 'intact',
    batch_id: 1,
    leaf_index: 0,
    merkle_root: 'aa',
    proof: [],
    seal_status: 'sealed',
    batch_hash: 'bb',
    signature,
    sealed_at: '2026-09-01T11:00:00Z',
    exported_at: null,
  };
}

function answer(status: shared.CapsuleVerification, rows: shared.RowVerification[] = []) {
  vi.mocked(shared.verifyPatientRecord).mockResolvedValue({
    patient_id: 'PAT-1',
    emergency_capsule: status,
    access_logs: rows,
    rows_checked_limit: 200,
    seal_key: null,
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

  it('confirms a match with the sealed commitment', async () => {
    answer('match');
    verify();
    expect(await screen.findByText(/matches its sealed record/i)).toBeInTheDocument();
  });

  it('warns clearly on a mismatch', async () => {
    answer('mismatch');
    verify();
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not match/i);
  });

  it('says an unsealed card cannot be verified, rather than calling it verified', async () => {
    answer('unsealed');
    verify();
    expect(await screen.findByText(/has not been sealed yet, so it cannot be verified/i)).toBeInTheDocument();
  });

  it('reports a valid signature on the sealed batches', async () => {
    answer('match', [sealedRow('valid')]);
    verify();
    expect(await screen.findByTestId('signature-result')).toHaveTextContent(/signature checked out/i);
  });

  it('reads an unsigned seal as a weaker state, never as a valid signature', async () => {
    answer('match', [sealedRow('valid'), sealedRow('unsigned')]);
    verify();
    const result = await screen.findByTestId('signature-result');
    expect(result).toHaveTextContent(/without a signature/i);
    expect(result).toHaveTextContent(/weaker/i);
    expect(result).not.toHaveTextContent(/checked out/i);
  });

  it('warns when a seal signature is invalid', async () => {
    answer('match', [sealedRow('valid'), sealedRow('invalid')]);
    verify();
    expect(await screen.findByRole('alert')).toHaveTextContent(/signature did not check out/i);
  });

  it('says nothing about signatures when no row is sealed yet', async () => {
    answer('none', [{ ...sealedRow('valid'), seal_status: null, signature: null, batch_id: null }]);
    verify();
    await screen.findByText(/no emergency card to verify/i);
    expect(screen.queryByTestId('signature-result')).not.toBeInTheDocument();
  });

  it('keeps a failed check distinct from a finding about the card', async () => {
    vi.mocked(shared.verifyPatientRecord).mockRejectedValue(new Error('offline'));
    verify();
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a finding about your record/i);
  });
});
