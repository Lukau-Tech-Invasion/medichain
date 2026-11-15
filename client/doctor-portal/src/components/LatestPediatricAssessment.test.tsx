import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import { LatestPediatricAssessment } from './LatestPediatricAssessment';

vi.mock('@medichain/shared', async original => ({
  ...(await original<Record<string, unknown>>()), listPedsForPatient: vi.fn(),
}));
beforeEach(() => { vi.resetAllMocks(); });

describe('LatestPediatricAssessment', () => {
  it('reads the recorded encounter and leaves its missing observations unknown', async () => {
    vi.mocked(shared.listPedsForPatient).mockResolvedValue([{ age_months: 12,
      assessment_datetime: '2025-07-15T10:00:00Z', data: { weight_kg: 10, pediatric_triangle: { heart_rate: 90 } } }]);
    render(<LatestPediatricAssessment patientId="PAT-A" />);
    expect(await screen.findByText('90 bpm')).toBeInTheDocument();
    expect(screen.getByText('10 kg')).toBeInTheDocument();
    expect(screen.getByText('12 months')).toBeInTheDocument();
    expect(screen.getAllByText('Not recorded')).toHaveLength(3);
    expect(screen.queryByText('No pediatric assessments recorded.')).not.toBeInTheDocument();
    expect(shared.listPedsForPatient).toHaveBeenCalledWith('PAT-A');
  });

  it('distinguishes a failed read from an empty history and retries the read', async () => {
    vi.mocked(shared.listPedsForPatient).mockRejectedValueOnce(new Error('Synthetic failure')).mockResolvedValueOnce([]);
    render(<LatestPediatricAssessment patientId="PAT-A" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Pediatric assessment could not be loaded.');
    expect(screen.queryByText('No pediatric assessments recorded.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry pediatric assessment' }));
    expect(await screen.findByText('No pediatric assessments recorded.')).toBeInTheDocument();
    expect(shared.listPedsForPatient).toHaveBeenCalledTimes(2);
  });

  it('ignores a late response for a different patient', async () => {
    let finish!: (rows: unknown[]) => void;
    vi.mocked(shared.listPedsForPatient).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce([{ age_months: 0, data: { weight_kg: 3.2 } }]);
    const view = render(<LatestPediatricAssessment patientId="PAT-A" />);
    view.rerender(<LatestPediatricAssessment patientId="PAT-B" />);
    expect(await screen.findByText('3.2 kg')).toBeInTheDocument();
    finish([{ data: { weight_kg: 99 } }]);
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Latest pediatric assessment' })).queryByText('99 kg')).not.toBeInTheDocument());
    expect(screen.getByText('0 months')).toBeInTheDocument();
  });

  it('does not offer an outage retry or claim an empty history after an access refusal', async () => {
    vi.mocked(shared.listPedsForPatient).mockRejectedValue(new shared.ApiClientError('Refused', 'CARE_RELATIONSHIP_REQUIRED', 403));
    render(<LatestPediatricAssessment patientId="PAT-A" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Pediatric assessment access was refused.');
    expect(screen.queryByRole('button', { name: 'Retry pediatric assessment' })).not.toBeInTheDocument();
    expect(screen.queryByText('No pediatric assessments recorded.')).not.toBeInTheDocument();
  });
});
