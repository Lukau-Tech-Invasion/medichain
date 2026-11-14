import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as shared from '@medichain/shared';
import ObstetricsPage from './ObstetricsPage';
import { patientProfile } from '../test/fixtures';
import { selectPatient } from '../test/selectPatient';
import { useAuthStore } from '../store/authStore';

vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  createOb: vi.fn(),
  openAccessContext: vi.fn().mockResolvedValue({ access_context_id: 'CTX-TEST', expires_at: '2099-01-01T00:00:00Z' }),
}));
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}));

const sent = () => vi.mocked(shared.createOb).mock.calls[0][0] as Record<string, unknown>;

describe('ObstetricsPage payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'DOC-1', role: 'Doctor' } });
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile({ full_name: 'Jane Doe' })]);
    vi.mocked(shared.createOb).mockResolvedValue({ success: true, assessment_id: 'OBE-1', fhr_category: null } as never);
  });

  it('files nothing nobody recorded', async () => {
    render(<ObstetricsPage />);
    await selectPatient('', 'Jane Doe', 'ob-patient');
    fireEvent.click(screen.getByRole('button', { name: /save|submit|record/i }));
    await waitFor(() => expect(shared.createOb).toHaveBeenCalledTimes(1));
    for (const field of ['gravida', 'para', 'gestational_age_weeks', 'prenatal_care', 'contractions',
      'rupture_of_membranes', 'dilation_cm', 'station', 'presentation', 'labor_stage',
      'fetal_heart_rate', 'fetal_heart_variability', 'fetal_accelerations', 'fetal_decelerations']) {
      expect(sent()[field], field).toBeUndefined();
    }
    expect(sent()).not.toHaveProperty('id');
    expect(sent()).not.toHaveProperty('assessedBy');
  });

  it('sends what was entered, under the names the server reads', async () => {
    render(<ObstetricsPage />);
    await selectPatient('', 'Jane Doe', 'ob-patient');
    fireEvent.change(screen.getByLabelText(/Gravida/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Para/i), { target: { value: '1' } });
    fireEvent.change(document.getElementById('ob-gestational-age')!, { target: { value: '38.5' } });
    fireEvent.click(screen.getByRole('button', { name: /save|submit|record/i }));
    await waitFor(() => expect(shared.createOb).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ gravida: 2, para: 1, gestational_age_weeks: 38, gestational_age_days: 4 });
  });
});
