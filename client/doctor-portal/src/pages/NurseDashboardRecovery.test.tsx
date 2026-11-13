import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NurseDashboardPage from './NurseDashboardPage';
import * as shared from '@medichain/shared';
import { useAuthStore } from '../store';

vi.mock('../store', () => ({ useAuthStore: vi.fn() }));
vi.mock('@medichain/shared', async original => ({
  ...(await original<typeof import('@medichain/shared')>()),
  getNurseDashboard: vi.fn(), getNurseTasks: vi.fn(), getMyWard: vi.fn(),
}));
const dashboard: shared.NurseDashboardResponse = {
  nurse_id: 'QA-NURSE', patients: { total: 1, list: [{ patient_id: 'QA-PAT', health_id: 'QA-PAT', full_name: 'QA Patient', date_of_birth: '2000-01-01', gender: '', allergies: [], current_medications: [], medical_conditions: [], content_available: true }] },
  vitals_needing_attention: [], fall_risk_patients: [], io_records: [], medication_records: [], critical_alerts: [],
  tasks: { vitals_due: 0, ivs_to_check: 0, wounds_to_assess: 0 },
};
const ordered: shared.NursingOrderTask = { id: 'QA-ORDER', type: 'wound_care', patient_id: 'QA-PAT', frequency: 'BD', last_done: 0, priority: 'medium', instructions: 'QA dressing check' };
/** Mount the real nurse dashboard without the portal shell. */
function renderDashboard() { return render(<MemoryRouter><NurseDashboardPage /></MemoryRouter>); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'QA-NURSE', role: 'Nurse' } } as never);
  vi.mocked(shared.getNurseDashboard).mockResolvedValue(dashboard);
  vi.mocked(shared.getNurseTasks).mockResolvedValue({ success: true, tasks: [] });
  vi.mocked(shared.getMyWard).mockResolvedValue({ shifts: [], wards: [], patients: [] });
});

describe('nurse dashboard recovery', () => {
  it('reports a failed dashboard without false zero or empty-work claims and preserves orders', async () => {
    vi.mocked(shared.getNurseDashboard).mockRejectedValueOnce(new Error('QA outage'));
    vi.mocked(shared.getNurseTasks).mockResolvedValue({ success: true, tasks: [ordered] });
    renderDashboard();
    expect(await screen.findByRole('alert')).toHaveTextContent('Nursing dashboard could not be loaded');
    expect(screen.getByText('QA dressing check', { exact: false })).toBeVisible();
    expect(screen.queryByText('No patients found')).not.toBeInTheDocument();
    expect(screen.queryByText('No I/O records yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing outstanding for your patients right now.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry dashboard' }));
    expect(await screen.findByText('QA Patient')).toBeVisible();
    expect(shared.getNurseDashboard).toHaveBeenCalledTimes(2);
    expect(shared.getNurseTasks).toHaveBeenCalledOnce();
  });

  it('preserves the dashboard when orders fail and retries only orders', async () => {
    vi.mocked(shared.getNurseTasks).mockRejectedValueOnce(new Error('QA outage'));
    renderDashboard();
    expect(await screen.findByText('QA Patient')).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('Nursing orders could not be loaded');
    expect(screen.queryByText('Nothing outstanding for your patients right now.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry nursing orders' }));
    expect(await screen.findByText('Nothing outstanding for your patients right now.')).toBeVisible();
    expect(shared.getNurseDashboard).toHaveBeenCalledOnce();
    expect(shared.getNurseTasks).toHaveBeenCalledTimes(2);
  });

  it('shows known orders while the dashboard is pending, without false emptiness', async () => {
    let finish!: (value: shared.NurseDashboardResponse) => void;
    vi.mocked(shared.getNurseDashboard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(shared.getNurseTasks).mockResolvedValue({ success: true, tasks: [ordered] });
    renderDashboard();
    expect(await screen.findByText('QA dressing check', { exact: false })).toBeVisible();
    expect(screen.queryByText('No I/O records yet')).not.toBeInTheDocument();
    finish(dashboard);
    expect(await screen.findByText('QA Patient')).toBeVisible();
  });

  it('ignores an old dashboard response after the account changes', async () => {
    let finish!: (value: shared.NurseDashboardResponse) => void;
    vi.mocked(shared.getNurseDashboard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderDashboard();
    await screen.findByRole('heading', { name: 'Nursing Dashboard' });
    vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'QA-NURSE-2', role: 'Nurse' } } as never);
    view.rerender(<MemoryRouter><NurseDashboardPage /></MemoryRouter>);
    expect(await screen.findByText('QA Patient')).toBeVisible();
    finish({ ...dashboard, patients: { total: 1, list: [{ patient_id: 'OLD', health_id: 'OLD', full_name: 'Old patient data', date_of_birth: '2000-01-01', gender: '', allergies: [], current_medications: [], medical_conditions: [], content_available: true }] } });
    await waitFor(() => expect(screen.getByText('QA Patient')).toBeVisible());
    expect(screen.queryByText('Old patient data')).not.toBeInTheDocument();
  });
  it('distinguishes missing I/O measurements from measured zero and a positive balance', async () => {
    vi.mocked(shared.getNurseDashboard).mockResolvedValue({ ...dashboard, io_records: [
      { patient_name: 'QA missing intake', total_output: 10 },
      { patient_name: 'QA measured zero', total_intake: 0, total_output: 0 },
      { patient_name: 'QA positive balance', total_intake: 25, total_output: 10 },
    ] });
    renderDashboard();
    const missing = (await screen.findByText('QA missing intake')).closest('tr')!;
    expect(within(missing).getAllByText('Unknown')).toHaveLength(2);
    const measured = screen.getByText('QA measured zero').closest('tr')!;
    expect(within(measured).getAllByText('0 mL')).toHaveLength(3);
    expect(screen.getByText('+15 mL')).toBeVisible();
  });

});
