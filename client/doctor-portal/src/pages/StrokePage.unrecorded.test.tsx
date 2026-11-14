import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as shared from '@medichain/shared';
import StrokePage from './StrokePage';
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
  createStroke: vi.fn(),
  getPatientStrokes: vi.fn().mockResolvedValue([]),
  openAccessContext: vi.fn().mockResolvedValue({ access_context_id: 'CTX-TEST', expires_at: '2099-01-01T00:00:00Z' }),
}));

describe('StrokePage payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'DOC-1', role: 'Doctor' } });
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile()]);
    vi.mocked(shared.createStroke).mockResolvedValue({ success: true } as never);
  });

  it('files no score or finding nobody recorded', async () => {
    render(<StrokePage />);
    await selectPatient('', 'Test Patient', 'stroke-patient');
    fireEvent.change(document.getElementById('stroke-last-known-well')!, { target: { value: '2026-11-14T08:00' } });
    fireEvent.change(document.getElementById('stroke-symptom-onset')!, { target: { value: '2026-11-14T08:10' } });
    fireEvent.click(screen.getByRole('button', { name: /save|activate|submit/i }));
    await waitFor(() => expect(shared.createStroke).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(shared.createStroke).mock.calls[0][0];
    // It opened on NIHSS 0, every FAST sign absent, CT "pending" and tPA
    // "evaluating", and filed them.
    expect(sent.nihss_score).toBeUndefined();
    expect(sent.fast_exam).toMatchObject({ face: undefined, arms: undefined, speech: undefined });
    expect(sent.ct_head_interpretation).toBeUndefined();
    expect(sent.tpa_eligibility).toBeUndefined();
    expect(sent.blood_glucose).toBeUndefined();
  });

  it('records a FAST sign as present or absent only when chosen', async () => {
    render(<StrokePage />);
    await selectPatient('', 'Test Patient', 'stroke-patient');
    fireEvent.change(document.getElementById('stroke-last-known-well')!, { target: { value: '2026-11-14T08:00' } });
    fireEvent.change(document.getElementById('stroke-symptom-onset')!, { target: { value: '2026-11-14T08:10' } });
    const face = screen.getByRole('group', { name: /face/i });
    fireEvent.click(face.querySelector('input[value="present"]')!);
    fireEvent.click(screen.getByRole('button', { name: /save|activate|submit/i }));
    await waitFor(() => expect(shared.createStroke).toHaveBeenCalledTimes(1));
    expect(vi.mocked(shared.createStroke).mock.calls[0][0].fast_exam).toMatchObject({ face: true, arms: undefined });
  });
});
