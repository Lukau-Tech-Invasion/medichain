import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import VitalSignsPage from './VitalSignsPage';
import { useAuthStore } from '../store';

// Mock the stores
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('VitalSignsPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
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
    });
  });

  it('allows opening the add new vitals form', async () => {
    render(
      <MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}>
        <VitalSignsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const addButton = screen.getByText(/Record Vitals/i);
      fireEvent.click(addButton);
    });

    expect(screen.getByText(/Record New Vital Signs/i)).toBeInTheDocument();
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
      const cell = screen.getAllByText('85/50').find((el) => el.tagName === 'TD');
      expect(cell?.className).toContain('bg-critical-subtle');
    });
  });

  it('refuses a transposed blood pressure before sending it', async () => {
    render(
      <MemoryRouter initialEntries={['/vitals?patientId=PAT-001']}>
        <VitalSignsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      fireEvent.click(screen.getByText(/Record Vitals/i));
    });
    fireEvent.change(screen.getByLabelText(/Systolic/i), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText(/Diastolic/i), { target: { value: '120' } });
    fireEvent.submit(screen.getByLabelText(/Systolic/i).closest('form')!);

    expect(await screen.findByText(/check the two are not swapped/i)).toBeInTheDocument();
    const posted = mockFetch.mock.calls.some(
      ([url, init]) => String(url).endsWith('/api/clinical/vitals') && init?.method === 'POST',
    );
    expect(posted).toBe(false);
  });
});
