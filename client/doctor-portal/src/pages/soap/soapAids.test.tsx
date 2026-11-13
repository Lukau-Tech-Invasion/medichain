/**
 * The SOAP note's aids (mockup c4): the latest vitals shown for reference,
 * and templates that add to a note without replacing what was written.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as shared from '@medichain/shared';
import { I18nProvider } from '@medichain/shared';
import { LatestVitalsStrip, vitalPairs, whenTaken } from './LatestVitalsStrip';
import { templateChoices } from './InsertTemplateMenu';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatientLatestVitals: vi.fn(),
}));

const label = (k: string) => k.split('.').pop()!;

describe('latest vitals', () => {
  beforeEach(() => { vi.mocked(shared.getPatientLatestVitals).mockReset(); });

  it('lists only what was measured', () => {
    expect(vitalPairs({ timestamp: 0, systolic_bp: 148, diastolic_bp: 92, heart_rate: 104, respiratory_rate: null, temperature_celsius: 36.94 }, label))
      .toEqual([['vitalBp', '148/92'], ['vitalPulse', '104'], ['vitalTemp', '36.9 °C']]);
    // Half a blood pressure is not a blood pressure.
    expect(vitalPairs({ timestamp: 0, systolic_bp: 148, diastolic_bp: null }, label)).toEqual([]);
  });

  it('dates a reading from an earlier day', () => {
    const now = new Date(2026, 10, 8, 12, 0);
    const today = new Date(2026, 10, 8, 9, 2).getTime() / 1000;
    const lastWeek = new Date(2026, 10, 1, 9, 2).getTime() / 1000;
    expect(whenTaken(today, now)).not.toMatch(/2026/);
    expect(whenTaken(lastWeek, now)).toMatch(/2026/);
  });

  it('says when there are none, and says so differently when they could not be read', async () => {
    vi.mocked(shared.getPatientLatestVitals).mockResolvedValueOnce({ reading: null });
    const { unmount } = render(<I18nProvider><LatestVitalsStrip patientId="P1" /></I18nProvider>);
    expect(await screen.findByText(/No vital signs recorded/)).toBeInTheDocument();
    unmount();
    vi.mocked(shared.getPatientLatestVitals).mockRejectedValueOnce(new Error('down'));
    render(<I18nProvider><LatestVitalsStrip patientId="P1" /></I18nProvider>);
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
  });

  it('shows the reading as reference only', async () => {
    vi.mocked(shared.getPatientLatestVitals).mockResolvedValueOnce({
      reading: { timestamp: Date.now() / 1000, systolic_bp: 148, diastolic_bp: 92, oxygen_saturation: 97 },
    });
    render(<I18nProvider><LatestVitalsStrip patientId="P1" /></I18nProvider>);
    const group = await screen.findByRole('group', { name: /latest vital signs/i });
    expect(group).toHaveTextContent('BP 148/92');
    expect(group).toHaveTextContent('SpO₂ 97%');
    expect(group).toHaveTextContent(/not copied into the note/);
  });
});

describe('template choices', () => {
  it('offers active templates, SOAP first', () => {
    expect(templateChoices([
      { template_id: 'a', name: 'Discharge', type: 'discharge-summary' },
      { template_id: 'b', name: 'Retired', type: 'soap', is_active: false },
      { template_id: 'c', name: 'Chest pain', category: 'SOAP' },
      { template_id: '', name: 'No id' },
    ]).map((c) => c.name)).toEqual(['Chest pain', 'Discharge']);
  });
});
