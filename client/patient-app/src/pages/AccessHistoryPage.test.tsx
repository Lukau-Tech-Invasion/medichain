import { render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from '@medichain/shared';
import type { AccessLogEntry } from '@medichain/shared';
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
  getEmergencyCapsuleAccessLog: vi.fn(),
  verifyPatientRecord: vi.fn(),
}));

const PATIENT_ID = 'PAT-001';

/** One access-log row at `minute` past 14:00 on a fixed day. */
function row(id: string, minute: number, overrides: Partial<AccessLogEntry> = {}): AccessLogEntry {
  return {
    access_id: id,
    patient_id: PATIENT_ID,
    accessor_id: 'user-dlamini',
    accessor_name: 'Dr N. Dlamini',
    accessor_role: 'Doctor',
    access_type: 'view',
    access_reason: 'Treatment',
    resource_type: 'Vital signs',
    location: 'Chris Hani Baragwanath',
    timestamp: new Date(Date.UTC(2026, 8, 26, 12, minute)).toISOString(),
    emergency: false,
    seal_status: null,
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
    vi.mocked(shared.getEmergencyCapsuleAccessLog).mockResolvedValue({
      success: true,
      patient_id: PATIENT_ID,
      count: 0,
      accesses: [],
    });
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
    expect(shared.getAccessLogs).toHaveBeenCalledWith(PATIENT_ID, { page: 1, limit: 100 });
  });

  it('shows no seal badge when the server reported no seal state', async () => {
    vi.mocked(shared.getAccessLogs).mockResolvedValue({
      patient_id: PATIENT_ID,
      total_accesses: 1,
      access_logs: [row('a', 2)],
    });
    renderPage();
    await screen.findByTestId('access-session');
    expect(screen.queryByTestId('seal-badge')).not.toBeInTheDocument();
    expect(screen.queryByText(/sealing records a fingerprint/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
  });

  it.each([
    ['pending', 'Sealing pending'],
    ['sealed', 'Sealed'],
    ['exported', 'Sealed and exported'],
  ] as const)('shows %s access as "%s"', async (status, label) => {
    vi.mocked(shared.getAccessLogs).mockResolvedValue({
      patient_id: PATIENT_ID,
      total_accesses: 1,
      access_logs: [row('a', 2, { seal_status: status })],
    });
    renderPage();
    const card = await screen.findByTestId('access-session');
    const badge = within(card).getByTestId('seal-badge');
    expect(badge).toHaveTextContent(new RegExp(`^${label}$`));
    expect(badge).toHaveAttribute('data-seal-status', status);
    expect(screen.getByText(/sealing records a fingerprint/i)).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/blockchain|on-chain|anchor|transaction/i);
  });

  it('calls a session with some rows still unsealed "Partly sealed"', async () => {
    vi.mocked(shared.getAccessLogs).mockResolvedValue({
      patient_id: PATIENT_ID,
      total_accesses: 2,
      access_logs: [row('b', 5, { seal_status: 'pending' }), row('a', 2, { seal_status: 'sealed' })],
    });
    renderPage();
    expect(await screen.findByTestId('seal-badge')).toHaveTextContent('Partly sealed');
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


});

describe('AccessHistoryPage authority (WP9)', () => {
  beforeEach(() => {
    vi.mocked(shared.getEmergencyCapsuleAccessLog).mockResolvedValue({
      success: true,
      patient_id: PATIENT_ID,
      count: 0,
      accesses: [],
    });
    vi.mocked(usePatientAuthStore).mockImplementation(((selector: (state: unknown) => unknown) =>
      selector({ patient: { healthId: PATIENT_ID } })) as never);
  });

  it('highlights break-glass access and says how other access was authorised', async () => {
    vi.mocked(shared.getAccessLogs).mockResolvedValue({
      patient_id: PATIENT_ID,
      total_accesses: 2,
      access_logs: [
        row('bg', 90, { accessor_name: 'Dr Stranger', emergency: true, authority_type: 'break_glass', access_reason: 'Collapsed in casualty' }),
        row('ref', 2, { authority_type: 'care_relationship', authority_source: 'referral' }),
      ],
    });
    renderPage();
    expect(await screen.findByTestId('break-glass-entry')).toHaveTextContent(/no care relationship with you/i);
    expect(screen.getByText('Access through a referral')).toBeInTheDocument();
  });
});
