import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DischargePage from './DischargePage';
import { useAuthStore } from '../store/authStore';

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
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
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
