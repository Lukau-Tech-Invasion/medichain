import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import RetentionPage from './RetentionPage';
import { patientFixture, selectPatient } from '../test/selectPatient';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRetentionReport: vi.fn(),
  getPatients: vi.fn(),
  listRetentionRuns: vi.fn(),
  listLegalHolds: vi.fn(),
  listRetentionApprovals: vi.fn(),
  listProcessingRestrictions: vi.fn(),
  getDeletionRegister: vi.fn(),
  createLegalHold: vi.fn(),
  releaseLegalHold: vi.fn(),
  requestRetentionApproval: vi.fn(),
  decideRetentionApproval: vi.fn(),
  executeRetentionApproval: vi.fn(),
  liftProcessingRestriction: vi.fn(),
}));

const ADMIN = '5GrwvaEF...admin';
const OTHER_ADMIN = '5FLSigC9...other';

const assessment = (over: Partial<shared.RetentionAssessment> = {}): shared.RetentionAssessment => ({
  assessed_on: '2026-09-15',
  policies: [],
  total_due: 0,
  total_held: 0,
  records_deleted: 0,
  incomplete_reason: null,
  ...over,
});

const approval = (over: Partial<shared.RetentionApproval> = {}): shared.RetentionApproval => ({
  token: 'RA-1',
  assessment_digest: 'digest',
  assessed_on: '2026-09-15',
  due_count: 3,
  requested_by: OTHER_ADMIN,
  requested_at: '2026-09-15T00:00:00Z',
  approved_by: null,
  approved_at: null,
  executed_by: null,
  executed_at: null,
  status: 'pending',
  expires_at: '2026-09-16T00:00:00Z',
  rejection_reason: null,
  ...over,
});

describe('RetentionPage', () => {
  beforeEach(() => {
    // The picker can only offer a patient the server knows.
    vi.mocked(shared.getPatients).mockResolvedValue([
      patientFixture({ patient_id: 'PAT-001', full_name: 'Test Patient' }),
    ] as never);
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({ user: { walletAddress: ADMIN, role: 'Admin' } });
    vi.mocked(shared.getRetentionReport).mockResolvedValue({
      success: true,
      assessment: assessment(),
    });
    vi.mocked(shared.listRetentionRuns).mockResolvedValue({ success: true, count: 0, runs: [] });
    vi.mocked(shared.listLegalHolds).mockResolvedValue({ success: true, count: 0, holds: [] });
    vi.mocked(shared.listRetentionApprovals).mockResolvedValue({
      success: true,
      count: 0,
      approvals: [],
    });
    vi.mocked(shared.listProcessingRestrictions).mockResolvedValue({
      success: true,
      count: 0,
      restrictions: [],
    });
    vi.mocked(shared.getDeletionRegister).mockResolvedValue({
      success: true,
      count: 0,
      entries: [],
    });
  });

  it('says an assessment did not complete rather than reporting its counts as findings', async () => {
    vi.mocked(shared.getRetentionReport).mockResolvedValue({
      success: true,
      assessment: assessment({ incomplete_reason: 'could not load retention policies' }),
    });
    render(<RetentionPage />);

    // `total_due: 0` from an assessment that never ran looks exactly like a
    // clean result. Approving against it would be approving nothing.
    await waitFor(() =>
      expect(screen.getByText(/did not complete/i)).toBeInTheDocument()
    );
  });

  it('distinguishes no active policy from nothing being due', async () => {
    render(<RetentionPage />);
    await waitFor(() =>
      expect(screen.getByText(/No retention policy is active/i)).toBeInTheDocument()
    );
  });

  it('refuses a hold that names neither a patient nor a record type', async () => {
    render(<RetentionPage />);
    await waitFor(() => expect(shared.listLegalHolds).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText(/^Reason$/i), 'Litigation');
    await userEvent.click(screen.getByRole('button', { name: /place hold/i }));

    // Scoped to neither, it would cover nothing while looking like protection.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(shared.createLegalHold).not.toHaveBeenCalled();
  });

  it('sends the hold the form collected, with the unset fields absent', async () => {
    vi.mocked(shared.createLegalHold).mockResolvedValue({
      success: true,
      hold: {
        id: 'LH-1',
        patient_id: 'PAT-001',
        entity_type: null,
        reason: 'Litigation',
        reference: null,
        applied_by: ADMIN,
        applied_at: '2026-09-15T00:00:00Z',
      },
    });
    render(<RetentionPage />);
    await waitFor(() => expect(shared.listLegalHolds).toHaveBeenCalled());

    await selectPatient(/Patient/i, 'Test Patient');
    await userEvent.type(screen.getByLabelText(/^Reason$/i), 'Litigation');
    await userEvent.click(screen.getByRole('button', { name: /place hold/i }));

    await waitFor(() => expect(shared.createLegalHold).toHaveBeenCalled());
    expect(vi.mocked(shared.createLegalHold).mock.calls[0][0]).toMatchObject({
      patient_id: 'PAT-001',
      reason: 'Litigation',
      entity_type: null,
      reference: null,
    });
  });

  it('does not offer Approve to the administrator who requested the token', async () => {
    vi.mocked(shared.listRetentionApprovals).mockResolvedValue({
      success: true,
      count: 1,
      approvals: [approval({ requested_by: ADMIN })],
    });
    render(<RetentionPage />);

    // The repository refuses a self-decision. Offering the button would send an
    // administrator into a refusal for a rule the screen already knows.
    await waitFor(() =>
      expect(screen.getByText(/Awaiting a second administrator/i)).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: /^Approve$/i })).not.toBeInTheDocument();
  });

  it('offers Approve on someone else‘s token', async () => {
    vi.mocked(shared.listRetentionApprovals).mockResolvedValue({
      success: true,
      count: 1,
      approvals: [approval()],
    });
    render(<RetentionPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Approve$/i })).toBeInTheDocument()
    );
  });

  it('reports what executing actually did, not that it ran', async () => {
    vi.mocked(shared.listRetentionApprovals).mockResolvedValue({
      success: true,
      count: 1,
      approvals: [approval({ status: 'approved', approved_by: ADMIN })],
    });
    vi.mocked(shared.executeRetentionApproval).mockResolvedValue({
      success: true,
      outcome: {
        token: 'RA-1',
        restricted: 4,
        registered: 4,
        skipped_for_hold: 2,
        deleted: 0,
        failed: [],
      },
    });
    render(<RetentionPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Restrict these records/i }));

    await waitFor(() => expect(shared.executeRetentionApproval).toHaveBeenCalledWith('RA-1'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/4 records restricted/i));
    expect(screen.getByRole('status')).toHaveTextContent(/2 skipped for a legal hold/i);
    // The button must not read as deletion, because nothing is deleted.
    expect(screen.getByRole('status')).toHaveTextContent(/No record was deleted/i);
  });

  it('says the retention position is unknown when the report cannot be read', async () => {
    vi.mocked(shared.getRetentionReport).mockRejectedValue(new Error('boom'));
    render(<RetentionPage />);

    await waitFor(() =>
      expect(screen.getByText(/retention position is unknown, not empty/i)).toBeInTheDocument()
    );
  });
});
