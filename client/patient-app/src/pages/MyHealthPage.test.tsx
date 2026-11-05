import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@medichain/shared';
import type { PatientVitalReading } from '@medichain/shared';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MyHealthPage, describeReading } from './MyHealthPage';

const getPatientVitals = vi.fn();
vi.mock('@medichain/shared', async (original) => ({
  ...(await original<typeof import('@medichain/shared')>()),
  getPatientVitals: (id: string) => getPatientVitals(id),
}));
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: (select: (s: unknown) => unknown) => select({ patient: { healthId: 'PAT-1' } }),
}));

function reading(over: Partial<PatientVitalReading>): PatientVitalReading {
  return {
    reading_id: 'r', timestamp: 0, recorded_at: '2026-10-14T08:00:00Z', recorded_by: 'n',
    heart_rate: null, respiratory_rate: null, systolic_bp: null, diastolic_bp: null,
    temperature_celsius: null, oxygen_saturation: null, pain_scale: null, gcs_total: null,
    blood_glucose: null, weight_kg: null, ...over,
  };
}

function renderPage() {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <I18nProvider><MyHealthPage /></I18nProvider>
    </MemoryRouter>,
  );
}

describe('MyHealthPage', () => {
  beforeEach(() => getPatientVitals.mockReset());

  it('reaches every health screen from one page', async () => {
    getPatientVitals.mockResolvedValue({ readings: [] });
    renderPage();
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/records', '/lab-results', '/medications', '/vitals',
      '/medications', '/lab-results', '/symptoms', '/symptoms?view=check', '/vitals?view=devices', '/medical-history',
    ]);
    // No reading is "no readings yet", not a zero.
    expect(await screen.findByText('No readings yet')).toBeInTheDocument();
  });

  it('shows the newest reading on the vitals tile', async () => {
    getPatientVitals.mockResolvedValue({ readings: [
      reading({ timestamp: 1, heart_rate: 70 }),
      reading({ timestamp: 2, systolic_bp: 128, diastolic_bp: 82 }),
    ] });
    renderPage();
    expect(await screen.findByText(/^BP 128\/82 · /)).toBeInTheDocument();
  });

  it('names a reading by what it measured', () => {
    expect(describeReading(reading({ heart_rate: 88 }))).toBe('Pulse 88');
    expect(describeReading(reading({}))).toBeNull();
  });
});
