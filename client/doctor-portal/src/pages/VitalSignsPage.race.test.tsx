import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import VitalSignsPage from './VitalSignsPage';
import { useAuthStore } from '../store';
import { clearAllDrafts } from '@medichain/shared';

vi.mock('../store', () => ({ useAuthStore: vi.fn() }));

// The picker is not under test: this is a button that moves to the next patient.
vi.mock('../components/PatientSelect', () => ({
  default: ({ onChange }: { onChange: (patientId: string) => void }) => (
    <button type="button" onClick={() => onChange('PAT-002')}>next patient</button>
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const json = (body: unknown) => ({
  ok: true,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: () => Promise.resolve(body),
});

const reading = (patientId: string, notes: string) => ({
  reading_id: patientId,
  patient_id: patientId,
  recorded_at: new Date().toISOString(),
  recorded_by: 'DOC-001',
  heart_rate: 72,
  respiratory_rate: 16,
  blood_pressure_systolic: 120,
  blood_pressure_diastolic: 80,
  temperature_celsius: 37.0,
  oxygen_saturation: 98,
  notes,
});

describe('VitalSignsPage: replies that arrive out of order', () => {
  let releaseFirst: () => void;

  beforeEach(() => {
    clearAllDrafts();
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'nurse-1', role: 'Nurse' }, isAuthenticated: true });
    mockFetch.mockImplementation((url: string) => {
      // PAT-001 answers slowly; the clinician has moved on to PAT-002 by then.
      if (url.includes('/api/clinical/vitals/flowsheet/PAT-001')) {
        return new Promise((resolve) => {
          releaseFirst = () => resolve(json({
            patient_id: 'PAT-001', patient_name: 'John Doe',
            readings: [reading('PAT-001', 'Reading of the first patient')],
          }));
        });
      }
      if (url.includes('/api/clinical/vitals/flowsheet/PAT-002')) {
        return Promise.resolve(json({
          patient_id: 'PAT-002', patient_name: 'Jane Roe',
          readings: [reading('PAT-002', 'Reading of the second patient')],
        }));
      }
      return Promise.resolve(json({}));
    });
  });

  it('does not put the previous patient’s readings under the next patient', async () => {
    render(
      <MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}>
        <VitalSignsPage />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes('flowsheet/PAT-001'))).toBe(true));

    fireEvent.click(screen.getByText('next patient'));
    expect(await screen.findByText('Reading of the second patient')).toBeInTheDocument();

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('Reading of the second patient')).toBeInTheDocument();
    expect(screen.queryByText('Reading of the first patient')).not.toBeInTheDocument();
  });
});
