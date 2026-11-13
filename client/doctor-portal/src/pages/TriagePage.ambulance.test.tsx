/**
 * Triage inside the chart of a patient who came by ambulance (c9): the crew's
 * values arrive labelled -- by themselves after "Received", by one tap
 * otherwise -- and which reading is critical is the server's catalogue's call.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmsRunEvent, EmsRunWithEvents, ScoringCatalog } from '@medichain/shared';
import TriagePage from './TriagePage';
import { useAuthStore } from '../store';
import { PatientWorkspaceContext } from '../workspace/PatientWorkspaceContext';

vi.mock('../store', () => ({ useAuthStore: vi.fn() }));

const catalog = {
  vital_signs: [
    { key: 'heart_rate', normal_low: 60, normal_high: 100, critical_low: 40, critical_high: 150 },
    { key: 'oxygen_saturation', normal_low: 95, normal_high: 100, critical_low: 92, critical_high: null },
  ],
} as unknown as ScoringCatalog;

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useScoringCatalog: () => ({ catalog, isLoading: false, error: null }),
  getPatients: vi.fn().mockResolvedValue([]),
  getPatientEmsRuns: vi.fn().mockResolvedValue({ runs: [] }),
}));

const ev = (kind: EmsRunEvent['kind'], at: string, payload: Record<string, unknown> | null = null): EmsRunEvent => ({
  id: `${kind}-${at}`, run_id: 'RUN-1', kind, occurred_at: `2026-11-09T${at}:00Z`, recorded_by: 'medic', payload,
});

const run: EmsRunWithEvents = {
  id: 'RUN-1', status: 'received', created_by: 'medic', crew: [], patient_id: 'PAT-1',
  chief_complaint: 'Car crash, driver', created_at: '2026-11-09T14:02:00Z', updated_at: '2026-11-09T14:32:00Z',
  events: [
    ev('on_scene', '14:09', { text: 'left forearm deformity' }),
    ev('vitals', '14:12', { heart_rate: 118, spo2: 91 }),
    ev('vitals', '14:24', { heart_rate: 106 }),
  ],
};

function renderInChart(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/patients/PAT-1/triage', state }]}>
      <PatientWorkspaceContext.Provider value={{ patientId: 'PAT-1', patient: null, ambulanceRun: run }}>
        <TriagePage />
      </PatientWorkspaceContext.Provider>
    </MemoryRouter>,
  );
}

describe('TriagePage in the chart of an ambulance patient', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'nurse-1', role: 'Nurse' }, isAuthenticated: true });
  });

  it('fills the empty fields from "Received", each labelled with the time the crew took it', () => {
    renderInChart({ fromRun: 'RUN-1' });
    const pulse = screen.getByLabelText(/Heart Rate/i) as HTMLInputElement;
    // Each vital's own latest reading: the pulse from 14:24, the SpO2 from 14:12.
    expect(pulse.value).toBe('106');
    expect((screen.getByLabelText(/O2 Sat/i) as HTMLInputElement).value).toBe('91');
    expect((screen.getByLabelText(/Chief Complaint/i) as HTMLTextAreaElement).value).toBe('Car crash, driver — left forearm deformity');
    expect(screen.getByText(/check and change before saving/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^Ambulance /).length).toBe(2);
    expect(screen.getByText('From ambulance')).toBeInTheDocument();

    // A changed value is the nurse's, not the crew's.
    fireEvent.change(pulse, { target: { value: '110' } });
    expect(screen.getAllByText(/^Ambulance /).length).toBe(1);
  });

  it('leaves the fields empty until asked, then fills them on one tap', () => {
    renderInChart();
    expect((screen.getByLabelText(/Heart Rate/i) as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Use ambulance values' }));
    expect((screen.getByLabelText(/Heart Rate/i) as HTMLInputElement).value).toBe('106');
    expect(screen.queryByRole('button', { name: 'Use ambulance values' })).toBeNull();
  });

  it('never overwrites what the nurse already typed', () => {
    renderInChart();
    fireEvent.change(screen.getByLabelText(/Heart Rate/i), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use ambulance values' }));
    expect((screen.getByLabelText(/Heart Rate/i) as HTMLInputElement).value).toBe('99');
  });

  it('flags a reading critical by the catalogue, not by a limit of its own', () => {
    renderInChart();
    const spo2 = screen.getByLabelText(/O2 Sat/i);
    // 91% is below the catalogue's 92; the old literal (< 90) let it pass.
    fireEvent.change(spo2, { target: { value: '91' } });
    expect(spo2.className).toContain('border-critical');
    fireEvent.change(spo2, { target: { value: '93' } });
    expect(spo2.className).not.toContain('border-critical');
    expect(spo2.getAttribute('placeholder')).toBe('95–100');
  });

  it('shows no patient picker, title or queue tabs inside the chart', () => {
    renderInChart();
    expect(screen.queryByRole('button', { name: /Triage Queue/i })).toBeNull();
    expect(screen.queryByLabelText(/Search patient/i)).toBeNull();
  });
});
