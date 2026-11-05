import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { DashboardPage, groupAccess } from './DashboardPage';
import { nextAppointment, nextDueDose, latestResult } from '../components/HomeToday';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';
import type { AccessLogEntry } from '@medichain/shared';

vi.mock('@medichain/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return {
    ...actual,
    getAccessLogs: vi.fn(),
    getPatient: vi.fn(),
    getPatientReminders: vi.fn(),
    getPatientAdherence: vi.fn(),
    getPatientAppointmentSummaries: vi.fn(),
    getPatientLabSubmissions: vi.fn(),
    logMedicationAdherence: vi.fn(),
  };
});

vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

function log(over: Partial<AccessLogEntry>): AccessLogEntry {
  return {
    access_id: Math.random().toString(), patient_id: 'p', accessor_id: 'dr-1', accessor_name: 'Dr Lindiwe Mokoena',
    accessor_role: 'Doctor', access_type: 'view', timestamp: '2026-10-13T09:00:00Z', ...over,
  } as AccessLogEntry;
}

function renderHome() {
  render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DashboardPage />
    </BrowserRouter>
  );
}

describe('DashboardPage (Patient)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: { id: '1', healthId: 'HEALTH123', fullName: 'Test Patient', userId: 'u-1', role: 'patient' },
      isAuthenticated: true,
      logout: vi.fn(),
    });
    vi.mocked(shared.getPatient).mockResolvedValue({
      patient_id: '1', full_name: 'Test Patient', health_id: 'HEALTH123',
      emergency_info: { blood_type: 'OPositive', allergies: ['Peanuts'], current_medications: ['Aspirin'], chronic_conditions: [] },
    } as never);
    vi.mocked(shared.getAccessLogs).mockResolvedValue({ patient_id: '1', access_logs: [], total_accesses: 0 });
    vi.mocked(shared.getPatientReminders).mockResolvedValue({ reminders: [] } as never);
    vi.mocked(shared.getPatientAdherence).mockResolvedValue({ logs: [] } as never);
    vi.mocked(shared.getPatientAppointmentSummaries).mockResolvedValue({ success: true, appointments: [], count: 0 });
    vi.mocked(shared.getPatientLabSubmissions).mockResolvedValue([]);
  });

  it('greets the patient and puts the emergency card first, with blood group and allergies', async () => {
    renderHome();
    expect(await screen.findByText(/Hello, Test/i)).toBeInTheDocument();
    const card = screen.getByText('Emergency Card').closest('a');
    expect(card).toHaveAttribute('href', '/emergency-card');
    expect(card?.textContent).toContain('O+');
    expect(card?.textContent).toContain('Peanuts');
  });

  it('draws no card facts when the profile cannot load', async () => {
    vi.mocked(shared.getPatient).mockRejectedValue(new Error('offline'));
    renderHome();
    expect(await screen.findByText(/data unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText('O+')).not.toBeInTheDocument();
    expect(screen.getByText(/no recent activity to show/i)).toBeInTheDocument();
  });

  it('lists today\'s dose, next visit and recent result', async () => {
    const today = new Date().toISOString().slice(0, 10);
    vi.mocked(shared.getPatientReminders).mockResolvedValue({ reminders: [
      { reminder_id: 'r1', medication_name: 'Metformin', dosage: '500 mg', reminder_times: ['18:00'] },
    ] } as never);
    vi.mocked(shared.getPatientAppointmentSummaries).mockResolvedValue({ success: true, count: 1, appointments: [
      { appointment_id: 'a1', status: 'scheduled', provider_name: 'Dr Mokoena', scheduled_date: today, start_time: '09:30' },
    ] });
    vi.mocked(shared.getPatientLabSubmissions).mockResolvedValue([
      { id: 'l1', test_name: 'HbA1c', submitted_at: new Date().toISOString() } as never,
    ]);
    renderHome();
    expect(await screen.findByText('Metformin 500 mg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Taken' })).toBeInTheDocument();
    expect(await screen.findByText('Dr Mokoena')).toBeInTheDocument();
    expect(await screen.findByText(/^HbA1c · /)).toBeInTheDocument();
  });
});

describe('Home helpers', () => {
  it('collapses repeated views into one line', () => {
    // Three visits an hour or more apart: three sessions, one line.
    const groups = groupAccess([
      log({ resource_type: 'Mental health assessments', timestamp: '2026-10-13T12:00:00Z' }),
      log({ resource_type: 'Mental health assessments', timestamp: '2026-10-13T09:00:00Z' }),
      log({ resource_type: 'Mental health assessments', timestamp: '2026-10-12T09:00:00Z' }),
      log({ accessor_id: 'dr-2', accessor_name: 'Dr B', resource_type: 'lab_results', timestamp: '2026-10-11T09:00:00Z' }),
    ], 'me', 3);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ count: 3, first: '2026-10-12T09:00:00Z', last: '2026-10-13T12:00:00Z' });
    expect(groups[1].what).toBe('Lab results');
  });

  it('leaves out the patient\'s own reads', () => {
    expect(groupAccess([log({ accessor_id: 'me' })], 'me', 3)).toEqual([]);
  });

  it('skips a dose already taken today and picks the earliest remaining', () => {
    const dose = nextDueDose(
      { reminders: [
        { reminder_id: 'a', medication_name: 'A', dosage: '', reminder_times: ['08:00'] },
        { reminder_id: 'b', medication_name: 'B', dosage: '', reminder_times: ['20:00', '12:00'] },
      ] } as never,
      { logs: [{ reminder_id: 'a', action_taken: 'taken', actual_time: '2026-11-05T08:01:00Z' }] } as never,
      '2026-11-05',
    );
    expect(dose).toMatchObject({ reminderId: 'b', time: '12:00' });
  });

  it('ignores cancelled and past visits, and old results', () => {
    expect(nextAppointment([
      { appointment_id: '1', status: 'cancelled', provider_name: 'X', scheduled_date: '2026-11-06' },
      { appointment_id: '2', status: 'scheduled', provider_name: 'Y', scheduled_date: '2026-11-01' },
    ], '2026-11-05')).toBeNull();
    expect(latestResult([{ submitted_at: '2026-09-01T00:00:00Z' } as never], Date.parse('2026-11-05T00:00:00Z'))).toBeNull();
  });
});
