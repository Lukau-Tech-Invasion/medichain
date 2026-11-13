import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import RadiologyPage from './RadiologyPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

const notices = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('../components/Toast', () => ({ useToastActions: () => notices }));
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), useAuthStore: vi.fn(),
}));
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listRadiology: vi.fn(), createRadiologyReport: vi.fn(),
}));

/** Open a fictional study and enter a clearly nonclinical report draft. */
async function enterReport() {
  fireEvent.click(await screen.findByRole('button', { name: 'Read Study' }));
  fireEvent.change(screen.getByLabelText('Findings'), { target: { value: 'Fictional QA findings' } });
  fireEvent.change(screen.getByLabelText('Impression'), { target: { value: 'Synthetic QA only' } });
}

describe('Radiology report save lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'DOC-QA', role: 'Doctor' } });
    vi.mocked(shared.listRadiology).mockResolvedValue({
      success: true,
      orders: { total: 1, items: [{ id: 'RAD-QA', patient_id: 'PAT-QA', modality: 'xray',
        created_at: '2026-10-12T08:00:00Z', status: 'Ordered' }] },
      reports: { total: 0, items: [] },
    });
  });

  it('sends one write for batched repeat clicks and locks the pending draft', async () => {
    let finish!: (result: Awaited<ReturnType<typeof shared.createRadiologyReport>>) => void;
    vi.mocked(shared.createRadiologyReport).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<RadiologyPage />); await enterReport();
    const save = screen.getByRole('button', { name: 'Save Preliminary' });
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    try {
      expect(shared.createRadiologyReport).toHaveBeenCalledTimes(1);
      expect(vi.mocked(shared.createRadiologyReport).mock.calls[0][0]).toMatchObject({ study_datetime: null });
      expect(screen.getByLabelText('Findings')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Worklist' })).toBeDisabled();
    } finally {
      await act(async () => { finish({ success: true, id: 'RAD-SAVED' }); });
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'Worklist' })).toBeEnabled());
    expect(screen.queryByLabelText('Findings')).not.toBeInTheDocument();
  });

  it('keeps prior report search separate from the worklist filter', async () => {
    render(<RadiologyPage />);
    await screen.findByRole('button', { name: 'Read Study' });
    fireEvent.change(screen.getByPlaceholderText('Search patient or accession...'), { target: { value: 'PAT-QA' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search prior reports' }), { target: { value: 'QA-REPORT-ONLY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Worklist' }));
    expect(screen.getByPlaceholderText('Search patient or accession...')).toHaveValue('PAT-QA');
    expect(screen.getByRole('button', { name: 'Read Study' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    expect(screen.getByRole('searchbox', { name: 'Search prior reports' })).toHaveValue('QA-REPORT-ONLY');
  });

  it('uses only the explicitly recorded acquisition time', async () => {
    vi.mocked(shared.createRadiologyReport).mockResolvedValueOnce({ success: true, id: 'RAD-TIME' });
    render(<RadiologyPage />); await enterReport();
    const recorded = '2026-10-12T09:00';
    fireEvent.change(screen.getByLabelText('Acquisition date/time (if recorded)'), { target: { value: recorded } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preliminary' }));
    await waitFor(() => expect(shared.createRadiologyReport).toHaveBeenCalledTimes(1));
    expect(vi.mocked(shared.createRadiologyReport).mock.calls[0][0]).toMatchObject({
      study_datetime: Math.floor(new Date(recorded).getTime() / 1000),
    });
  });

  it('refuses an unsupported modality without changing it to an X-ray', async () => {
    vi.mocked(shared.listRadiology).mockResolvedValueOnce({ success: true,
      orders: { total: 1, items: [{ id: 'RAD-QA', patient_id: 'PAT-QA', modality: 'unknown-modality', status: 'Ordered' }] },
      reports: { total: 0, items: [] },
    });
    render(<RadiologyPage />); await enterReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save Preliminary' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/modality/i);
    expect(shared.createRadiologyReport).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Findings')).toHaveValue('Fictional QA findings');
  });

  it('retains the failed draft and permits a successful retry without filing success early', async () => {
    vi.mocked(shared.createRadiologyReport).mockRejectedValueOnce(new Error('Synthetic refused write'));
    render(<RadiologyPage />); await enterReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save Preliminary' }));
    await waitFor(() => expect(notices.showError).toHaveBeenCalled());
    expect(notices.showError).toHaveBeenCalledWith('Save could not be confirmed. Your draft has been kept. Check saved reports before retrying.');
    expect(screen.getByRole('alert')).toHaveTextContent('Save could not be confirmed');
    expect(notices.showSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Findings')).toHaveValue('Fictional QA findings');
    expect(screen.getByRole('button', { name: 'Save Preliminary' })).toBeEnabled();
    vi.mocked(shared.createRadiologyReport).mockResolvedValueOnce({ success: true, id: 'RAD-RETRY' });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preliminary' }));
    await waitFor(() => expect(notices.showSuccess).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(shared.createRadiologyReport).toHaveBeenCalledTimes(2);
    const [first, retry] = vi.mocked(shared.createRadiologyReport).mock.calls;
    expect(retry[0]).toMatchObject({ report_id: (first[0] as { report_id: string }).report_id });
  });
});
