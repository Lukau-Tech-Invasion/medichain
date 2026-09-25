import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { mapPrescription, MedicationsPage } from './MedicationsPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('MedicationsPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/e-prescriptions/patient/')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({
            prescriptions: [
              // The shape the API returns: the medicine nested under
              // `medication`. The flat shape this used to mock is one the
              // server never sent, which is how an always-empty list passed.
              {
                prescription_id: 'med1',
                medication: {
                  name: 'Aspirin',
                  strength: '100 mg',
                  form: 'tablet',
                  directions: 'Take with food',
                },
                prescriber_name: 'Dr. House',
                signed_at: 1735689600,
                status: 'Transmitted',
                refills_remaining: 0,
              }
            ],
          }),
        });
      }
      if (url.includes('/api/reminders/medication/')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ reminders: [] }),
        });
      }
      if (url.includes('/api/reminders/adherence/')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ logs: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });
    });
  });

  it('does not invent directions or an active status for incomplete prescriptions', () => {
    expect(mapPrescription({
      prescription_id: 'med1',
      medication_name: 'Aspirin',
    })).toMatchObject({
      frequency: '',
      instructions: '',
      status: undefined,
    });
  });

  it('reads the nested e-prescription shape the API returns', () => {
    expect(mapPrescription({
      prescription_id: 'RX-1',
      medication: { name: 'Amlodipine', strength: '5 mg', form: 'tablet', directions: 'Once daily' },
      patient_instructions: 'Take in the morning',
      prescriber_name: 'Dr Browser Test',
      signed_at: 1790335111,
      status: 'Transmitted',
    })).toMatchObject({
      id: 'RX-1',
      name: 'Amlodipine',
      dosage: '5 mg tablet',
      instructions: 'Once daily — Take in the morning',
      prescribedBy: 'Dr Browser Test',
      startDate: '2026-09-25',
      status: 'active',
    });
    expect(mapPrescription({ prescription_id: 'RX-2', medication: { name: 'X' }, status: 'Draft' })?.status)
      .toBeUndefined();
  });

  it('renders medications page with current medications', async () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Medications/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Aspirin/i)).toBeInTheDocument();
      expect(screen.getByText(/Take with food/i)).toBeInTheDocument();
    });
  });

  it('does not present an unsupported refill request as a working action', async () => {
    render(<MemoryRouter><MedicationsPage /></MemoryRouter>);

    expect(await screen.findByText(/Online refill requests are not available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request refill/i })).not.toBeInTheDocument();
  });

  it('allows switching to reminders tab', async () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Current/i)).toBeInTheDocument();
    });

    const remindersTab = screen.getByText(/Today's Schedule/i);
    fireEvent.click(remindersTab);
    
    await waitFor(() => {
      expect(screen.getByText(/Today's Schedule/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Today's Schedule/i).length).toBeGreaterThan(0);
    });
  });

  it('uses persisted reminder times and does not infer a schedule from a prescription', async () => {
    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/e-prescriptions/patient/')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ prescriptions: [{
            prescription_id: 'med1', medication_name: 'Aspirin', dosage: '100mg', frequency: 'Once daily',
          }] }),
        });
      }
      if (url.includes('/api/reminders/medication/')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ reminders: [{
            reminder_id: 'REM-1', patient_id: 'HEALTH123', medication_name: 'Aspirin', dosage: '100mg',
            frequency: 'Daily', reminder_times: ['07:30'], start_date: '2026-09-17', end_date: null,
            instructions: null, active: true, created_at: 0,
          }] }),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ logs: [] }),
      });
    });

    render(<MemoryRouter><MedicationsPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText(/Today's Schedule/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Today's Schedule/i));
    expect(await screen.findByText(/07:30/)).toBeInTheDocument();
    expect(screen.queryByText('08:00')).not.toBeInTheDocument();
  });

  it('shows no medications message when list is empty', async () => {
    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/e-prescriptions/patient/')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ prescriptions: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });
    });

    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/No active medications/i)).toBeInTheDocument();
    });
  });

  it('tells the patient why the pharmacy did not dispense something', async () => {
    const base = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string) =>
      url.includes('/api/clinical/patient/HEALTH123/pharmacy-decisions')
        ? Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({
              success: true, count: 1,
              decisions: [{
                decision_id: 'DEC-1', patient_id: 'HEALTH123', allergen: 'Penicillin',
                decision: 'refused_to_dispense', reason: 'Amoxicillin is a penicillin',
                prescription_id: null, decided_by: '5Pharm', decided_at: '2026-09-24T10:00:00Z',
              }],
            }),
          })
        : base(url));
    render(<MemoryRouter><MedicationsPage /></MemoryRouter>);

    const notes = await screen.findByTestId('pharmacy-notes');
    expect(notes.textContent).toMatch(/Penicillin: not dispensed because of your allergy/);
    expect(notes.textContent).toMatch(/Amoxicillin is a penicillin/);
  });
});
