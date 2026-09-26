import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from '@medichain/shared';
import type { AccessLogEntry, RowVerification } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as shared from '@medichain/shared';
import { AccessHistoryPage } from './AccessHistoryPage';
import { usePatientAuthStore } from '../store/authStore';

vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAccessLogs: vi.fn(),
  verifyPatientRecord: vi.fn(),
}));

const PATIENT_ID = 'PAT-001';

/** One access-log row at `minute` past 14:00 on a fixed day. */
function row(id: string, minute: number, overrides: Partial<AccessLogEntry> = {}): AccessLogEntry {
  return {
    access_id: id,
    patient_id: PATIENT_ID,
    accessor_id: 'wallet-dlamini',
    accessor_name: 'Dr N. Dlamini',
    accessor_role: 'Doctor',
    access_type: 'view',
    access_reason: 'Treatment',
    resource_type: 'Vital signs',
    location: 'Chris Hani Baragwanath',
    timestamp: new Date(Date.UTC(2026, 8, 26, 12, minute)).toISOString(),
    emergency: false,
    blockchain_tx_hash: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <I18nProvider>
        <AccessHistoryPage />
      </I18nProvider>
    </BrowserRouter>,
  );
}

describe('AccessHistoryPage', () => {
  beforeEach(() => {
    vi.mocked(usePatientAuthStore).mockImplementation(((selector: (state: unknown) => unknown) =>
      selector({ patient: { healthId: PATIENT_ID } })) as never);
  });

  it('shows who, where, why and what for one grouped chart session', async () => {
    vi.mocked(shared.getAccessLogs).mockResolvedValue({
      patient_id: PATIENT_ID,
      total_accesses: 2,
      access_logs: [row('b', 5, { resource_type: 'Lab results' }), row('a', 2)],
    });
    renderPage();
    const sessions = await screen.findAllByTestId('access-session');
    expect(sessions).toHaveLength(1);
    const card = sessions[0];
    expect(card).toHaveTextContent('Dr N. Dlamini');
    expect(card).toHaveTextContent('Doctor · Chris Hani Baragwanath');
    expect(card).toHaveTextContent('Treatment');
    expect(card).toHaveTextContent('Vital signs, Lab results');
    expect(card).toHaveTextContent('Blockchain anchor pending');
    expect(shared.getAccessLogs).toHaveBeenCalledWith(PATIENT_ID, { page: 1, limit: 100 });
  });

  it('says anchored only for entries with a transaction', async () => {
    vi.mocked(shared.getAccessLogs).mockResolvedValue({
      patient_id: PATIENT_ID,
      total_accesses: 1,
      access_logs: [row('a', 2, { blockchain_tx_hash: '0xabc' })],
    });
    renderPage();
    expect(await screen.findByText('Anchored on the blockchain')).toBeInTheDocument();
  });

  it('highlights an emergency access', async () => {
    vi.mocked(shared.getAccessLogs).mockResolvedValue({
      patient_id: PATIENT_ID,
      total_accesses: 1,
      access_logs: [row('a', 2, { emergency: true, access_type: 'nfc_tap', accessor_role: 'Nurse' })],
    });
    renderPage();
    expect(await screen.findByText('Emergency access')).toBeInTheDocument();
  });

  it('says plainly when the record went, de-identified, into a research export', async () => {
    vi.mocked(shared.getAccessLogs).mockResolvedValue({
      patient_id: PATIENT_ID,
      total_accesses: 1,
      access_logs: [row('r1', 5, {
        access_type: 'research_export_included', accessor_role: 'Admin',
        access_reason: 'Research (de-identified)', resource_type: 'Research export (de-identified)',
      })],
    });
    renderPage();
    expect(await screen.findByText(/Included in research export \(de-identified\) on/i)).toBeInTheDocument();
    expect(screen.getByText(/name, ID number, contact details and exact dates were not included/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Viewed/i)).not.toBeInTheDocument();
  });

  it('distinguishes "nobody viewed" from "could not load"', async () => {
    vi.mocked(shared.getAccessLogs).mockRejectedValueOnce(new Error('offline'));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('could not be loaded');
    expect(screen.queryByText(/Nobody other than you/)).not.toBeInTheDocument();
  });

  it('says so plainly when nobody else has viewed the record', async () => {
    vi.mocked(shared.getAccessLogs).mockResolvedValue({
      patient_id: PATIENT_ID,
      total_accesses: 0,
      access_logs: [],
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Nobody other than you has viewed your health information.')).toBeInTheDocument(),
    );
  });

  it('verifies a session against its block, and warns plainly on a mismatch', async () => {
    vi.mocked(shared.getAccessLogs).mockResolvedValue({
      patient_id: PATIENT_ID,
      total_accesses: 2,
      access_logs: [row('late', 90, { accessor_name: 'Dr Other' }), row('early', 2)],
    });
    const verified = (id: string, integrity: RowVerification['integrity']): RowVerification => ({
      access_log_id: id,
      accessed_at: '2026-09-26T12:00:00Z',
      integrity,
      batch_id: 7,
      leaf_index: 0,
      merkle_root: 'ab'.repeat(32),
      proof: [],
      anchor_status: 'finalized',
      block_number: 4242,
      tx_hash: '0xfeed',
    });
    vi.mocked(shared.verifyPatientRecord).mockResolvedValue({
      patient_id: PATIENT_ID,
      emergency_capsule: 'unanchored',
      access_logs: [verified('early', 'intact'), verified('late', 'mismatch')],
      rows_checked_limit: 200,
    });
    renderPage();
    const buttons = await screen.findAllByRole('button', { name: 'Verify' });
    fireEvent.click(buttons[0]);
    expect(await screen.findByText('Verified against block #4242')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/no longer matches what was recorded/i);
    // One request serves every session on the page.
    expect(shared.verifyPatientRecord).toHaveBeenCalledTimes(1);
  });

  it('never calls a pending batch verified', async () => {
    vi.mocked(shared.getAccessLogs).mockResolvedValue({
      patient_id: PATIENT_ID,
      total_accesses: 1,
      access_logs: [row('a', 2)],
    });
    vi.mocked(shared.verifyPatientRecord).mockResolvedValue({
      patient_id: PATIENT_ID,
      emergency_capsule: 'none',
      access_logs: [
        {
          access_log_id: 'a',
          accessed_at: '2026-09-26T12:00:00Z',
          integrity: 'intact',
          batch_id: 1,
          leaf_index: 0,
          merkle_root: 'ab'.repeat(32),
          proof: [],
          anchor_status: 'pending',
          block_number: null,
          tx_hash: null,
        },
      ],
      rows_checked_limit: 200,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(/not anchored on the blockchain yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Verified against/i)).not.toBeInTheDocument();
  });
});
