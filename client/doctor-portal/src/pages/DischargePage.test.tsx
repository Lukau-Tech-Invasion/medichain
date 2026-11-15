import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DischargePage from './DischargePage';
import { useAuthStore } from '../store/authStore';
import { selectPatient } from '../test/selectPatient';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('DischargePage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        // The page reads `discharges` — a list of DischargeSummary records —
        // not a single `discharge_summary` envelope. Medications and follow-ups
        // are structured records, not bare strings.
        json: () => Promise.resolve({
          discharges: [
            {
              id: 'DIS-001',
              patient_id: 'PAT-001',
              patient_name: 'Test Patient',
              admission_date: '2026-08-04T00:00:00Z',
              discharge_date: new Date().toISOString(),
              discharge_disposition: 'home',
              primary_diagnosis: 'Pneumonia',
              secondary_diagnoses: ['Asthma'],
              procedures_performed: ['Chest X-Ray'],
              discharge_condition: 'stable',
              discharge_instructions: [
                { category: 'Wound care', instructions: ['Keep dressing dry'] },
              ],
              follow_up_appointments: [
                {
                  specialty: 'General Practice',
                  provider: 'Dr Smith',
                  date: '2026-08-18',
                  time: '09:00',
                  location: 'Clinic A',
                  phone: '+27123456789',
                },
              ],
              discharge_medications: [
                {
                  name: 'Amoxicillin',
                  dosage: '500 mg',
                  frequency: 'TDS',
                  duration: '7 days',
                  instructions: 'Take with food',
                },
              ],
              activity_restrictions: ['No heavy lifting for 1 week'],
              diet_instructions: 'Regular diet',
              warning_signs: ['Fever above 38C'],
              emergency_contact_instructions: 'Call the ward',
              prepared_by: 'Dr Smith',
              approved_by: 'Dr Jones',
              status: 'approved',
            },
          ],
        }),
      });
    });
  });

  it('renders discharge page', async () => {
    render(
      <MemoryRouter>
        <DischargePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Discharge Planning/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Pneumonia/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Amoxicillin/i).length).toBeGreaterThan(0);
    });
  });

  it('sends only what the clinician chose: no invented condition, disposition or admission', async () => {
    const json = (body: unknown, status = 200) => Promise.resolve({
      ok: status < 400, status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
    });
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/access-context')) {
        return json({ access_context_id: 'CTX-DC', expires_at: new Date(Date.now() + 3600000).toISOString() });
      }
      if (url.includes('/api/patients')) {
        return json({ data: [{ patient_id: 'PAT-001', full_name: 'Test Patient', date_of_birth: '1980-01-01' }] });
      }
      if (init?.method === 'POST' && url.includes('/api/clinical/discharge-summary')) {
        return json({ success: true, summary_id: 'DCS-1' }, 201);
      }
      return json({ discharges: [] });
    });
    render(<MemoryRouter><DischargePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /New Discharge/ }));
    expect(screen.getByLabelText(/Discharge Disposition/i)).toHaveValue('');
    expect(screen.getByLabelText(/Admission date/i)).toHaveValue('');
    await selectPatient('', 'Test Patient', 'dc-patient');
    fireEvent.change(screen.getByLabelText(/Primary Diagnosis/i), { target: { value: 'Synthetic pneumonia' } });
    fireEvent.change(screen.getByLabelText(/Discharge Disposition/i), { target: { value: 'rehab' } });

    // No condition chosen: refused in words, nothing sent.
    fireEvent.click(screen.getByRole('button', { name: 'Create Discharge Summary' }));
    expect(await screen.findByText("Choose the patient's condition at discharge.")).toBeInTheDocument();
    const posts = () => mockFetch.mock.calls.filter(([url, init]) =>
      String(url).includes('/api/clinical/discharge-summary') && (init as RequestInit | undefined)?.method === 'POST');
    expect(posts()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'declined' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Discharge Summary' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const sent = JSON.parse(String((posts()[0][1] as RequestInit).body));
    expect(sent.discharge_condition).toBe('deteriorated');
    expect(sent.discharge_disposition).toBe('rehab');
    expect('admission_datetime' in sent).toBe(false);
    expect(sent.diet_instructions).toBe('');
  });

  it('shows follow-up instructions', async () => {
    render(
      <MemoryRouter>
        <DischargePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/General Practice/i).length).toBeGreaterThan(0);
    });
  });
});
