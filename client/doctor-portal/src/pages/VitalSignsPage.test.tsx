import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import VitalSignsPage from './VitalSignsPage';
import { useAuthStore } from '../store';
import { clearAllDrafts } from '@medichain/shared';

// Mock the stores
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('VitalSignsPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  const mockFlowsheet = {
    patient_id: 'PAT-001',
    patient_name: 'John Doe',
    readings: [
      {
        reading_id: '1',
        patient_id: 'PAT-001',
        recorded_at: new Date().toISOString(),
        recorded_by: 'DOC-001',
        heart_rate: 72,
        respiratory_rate: 16,
        blood_pressure_systolic: 120,
        blood_pressure_diastolic: 80,
        temperature_celsius: 37.0,
        oxygen_saturation: 98,
        weight_kg: 62,
        notes: 'Synthetic vital observation retained',
      }
    ],
  };

  const mockCatalog = {
    vital_signs: [
      { key: 'heart_rate', normal_low: 60, normal_high: 100, critical_low: 40, critical_high: 150 },
      { key: 'bp_systolic', normal_low: 90, normal_high: 140, critical_low: 90, critical_high: 180 },
    ],
  };

  beforeEach(() => {
    // The form keeps a draft for the tab; each test starts from an empty one.
    clearAllDrafts();
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });
    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/patients')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: [{ patient_id: 'PAT-001', full_name: 'John Doe' }] }),
        });
      }
      // The bands the page flags against come from the server's catalog.
      if (url.includes('/api/clinical/scoring/catalog')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(mockCatalog),
        });
      }
      // The flowsheet endpoint is /api/clinical/vitals/flowsheet/{id};
      // '/api/vitals/{id}' never matched, so the page rendered its error state.
      if (url.includes('/api/clinical/vitals/flowsheet/PAT-001')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(mockFlowsheet),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });
    });
  });

  it('renders vital signs page', async () => {
    render(
      <MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}>
        <VitalSignsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Vital Signs Flowsheet/i)).toBeInTheDocument();
      expect(screen.getByText(/John Doe/i)).toBeInTheDocument();
    });
  });

  it('displays vital readings in flowsheet', async () => {
    render(
      <MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}>
        <VitalSignsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      // 72 appears in both the latest-reading card and the flowsheet row.
      expect(screen.getAllByText('72').length).toBeGreaterThan(0); // heart rate
      expect(screen.getAllByText('120/80').length).toBeGreaterThan(0); // BP
      expect(screen.getByText('62')).toBeInTheDocument();
      expect(screen.getByText('Synthetic vital observation retained')).toBeInTheDocument();
    });
  });

  it('opens the form at once when opened for a patient', async () => {
    render(
      <MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}>
        <VitalSignsPage />
      </MemoryRouter>
    );

    // Opened for a patient, the form is the task: it is open without a click.
    expect(await screen.findByText(/Record New Vital Signs/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Heart Rate/i)).toBeInTheDocument();
  });

  it('flags a systolic pressure the server alerts on as critical', async () => {
    // 85 mmHg: the page's old copy called it merely abnormal (its critical
    // limit was 70); the server's band, which the page now reads, says 90.
    const low = { ...mockFlowsheet.readings[0], reading_id: '2', blood_pressure_systolic: 85, blood_pressure_diastolic: 50 };
    const base = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string) =>
      url.includes('/api/clinical/vitals/flowsheet/PAT-001')
        ? Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ ...mockFlowsheet, readings: [low] }),
          })
        : base(url),
    );
    render(
      <MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}>
        <VitalSignsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const cell = screen.getAllByText(/^85\/50/).find((el) => el.tagName === 'TD');
      expect(cell?.className).toContain('bg-critical-subtle');
      // In words too, not only in colour (WCAG 1.4.1): the flowsheet cell and
      // the latest-reading tile both say it.
      expect(cell?.textContent).toContain('Critical');
      expect(screen.getAllByText('Critical').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('refuses a transposed blood pressure before sending it', async () => {
    render(
      <MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}>
        <VitalSignsPage />
      </MemoryRouter>
    );

    fireEvent.change(await screen.findByLabelText(/Systolic/i), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText(/Diastolic/i), { target: { value: '120' } });
    fireEvent.submit(screen.getByLabelText(/Systolic/i).closest('form')!);

    expect(await screen.findByText(/check the two are not swapped/i)).toBeInTheDocument();
    const posted = mockFetch.mock.calls.some(
      ([url, init]) => String(url).endsWith('/api/clinical/vitals') && init?.method === 'POST',
    );
    expect(posted).toBe(false);
  });

  it('keeps a half-filled form as a draft when the clinician is called away', async () => {
    const first = render(<MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}><VitalSignsPage /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText(/Heart Rate/i), { target: { value: '104' } });
    expect(screen.getByText('Draft kept on this tab')).toBeInTheDocument();
    first.unmount();
    render(<MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}><VitalSignsPage /></MemoryRouter>);
    expect(await screen.findByDisplayValue('104')).toBeInTheDocument();
  });

  it('refuses blank and notes-only readings but accepts an explicitly entered zero pain score', async () => {
    render(<MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}><VitalSignsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Save Vitals' }));
    expect(await screen.findByText('Enter at least one measured vital sign before saving.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Notes/i), { target: { value: 'Synthetic note only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Vitals' }));
    expect(mockFetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Pain Scale (0-10)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Vitals' }));
    await waitFor(() => expect(mockFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const [, init] = mockFetch.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(init.body)).toMatchObject({ pain_scale: 0, heart_rate: null, temperature_celsius: null });
  });
});
