import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { MedicationRemindersPage } from './MedicationRemindersPage';
import { usePatientAuthStore } from '../store/authStore';
import * as sharedApi from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared API
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatientReminders: vi.fn(),
  createMedicationReminder: vi.fn(),
  deleteMedicationReminder: vi.fn(),
}));

describe('MedicationRemindersPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sharedApi.getPatientReminders).mockReset();
    vi.mocked(sharedApi.createMedicationReminder).mockReset();
    vi.mocked(sharedApi.deleteMedicationReminder).mockReset();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
    });
  });

  it('renders medication reminders page with reminders', async () => {
    vi.mocked(sharedApi.getPatientReminders).mockResolvedValue({
      success: true,
      patient_id: 'HEALTH123',
      count: 1,
      reminders: [
        {
          reminder_id: 'rem1',
          patient_id: 'HEALTH123',
          medication_name: 'Aspirin',
          dosage: '100mg',
          frequency: 'Daily',
          reminder_times: ['08:00 AM', '08:00 PM'],
          start_date: '2026-09-17',
          end_date: null,
          instructions: null,
          active: true,
          created_at: 0,
        }
      ],
    });

    render(<MedicationRemindersPage />);

    await waitFor(() => {
      expect(screen.getByText(/Medication Reminders/i)).toBeInTheDocument();
      expect(screen.getByText('Aspirin')).toBeInTheDocument();
      expect(screen.getByText(/Dosage: 100mg/i)).toBeInTheDocument();
      expect(screen.getByText('08:00 AM')).toBeInTheDocument();
    });
  });

  it('shows no reminders message when list is empty', async () => {
    vi.mocked(sharedApi.getPatientReminders).mockResolvedValue({
      success: true,
      patient_id: 'HEALTH123',
      count: 0,
      reminders: [],
    });

    render(<MedicationRemindersPage />);

    await waitFor(() => {
      expect(screen.getByText(/No active reminders/i)).toBeInTheDocument();
    });
  });

  it('creates a reminder with the authenticated patient and reloads the list', async () => {
    vi.mocked(sharedApi.getPatientReminders)
      .mockResolvedValueOnce({ success: true, patient_id: 'HEALTH123', count: 0, reminders: [] })
      .mockResolvedValueOnce({ success: true, patient_id: 'HEALTH123', count: 0, reminders: [] });
    vi.mocked(sharedApi.createMedicationReminder).mockResolvedValue({
      success: true, reminder_id: 'rem2', message: 'Medication reminder created successfully',
    });

    render(<MedicationRemindersPage />);
    await screen.findByText(/No active reminders/i);
    fireEvent.click(screen.getByRole('button', { name: /add reminder/i }));
    fireEvent.change(screen.getByLabelText('Medicine'), { target: { value: 'Metformin' } });
    fireEvent.change(screen.getByLabelText('Dose'), { target: { value: '500 mg' } });
    fireEvent.change(screen.getByLabelText('Times'), { target: { value: '08:00\n20:00' } });
    fireEvent.click(screen.getByRole('button', { name: /save reminder/i }));

    await waitFor(() => expect(sharedApi.createMedicationReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: 'HEALTH123', medication_name: 'Metformin', dosage: '500 mg',
        frequency: 'daily', reminder_times: ['08:00', '20:00'],
      })
    ));
    expect(sharedApi.getPatientReminders).toHaveBeenCalledTimes(2);
  });

  it('deactivates an existing reminder and reloads the list', async () => {
    const reminder = {
      reminder_id: 'rem1', patient_id: 'HEALTH123', medication_name: 'Aspirin', dosage: '100mg',
      frequency: 'Daily', reminder_times: ['08:00 AM'], start_date: '2026-09-17', end_date: null,
      instructions: null, active: true, created_at: 0,
    };
    vi.mocked(sharedApi.getPatientReminders)
      .mockResolvedValueOnce({ success: true, patient_id: 'HEALTH123', count: 1, reminders: [reminder] })
      .mockResolvedValueOnce({ success: true, patient_id: 'HEALTH123', count: 0, reminders: [] });
    vi.mocked(sharedApi.deleteMedicationReminder).mockResolvedValue({
      success: true, message: 'Reminder deactivated',
    });

    render(<MedicationRemindersPage />);
    await screen.findByText('Aspirin');
    fireEvent.click(screen.getByRole('button', { name: /deactivate reminder/i }));

    await waitFor(() => expect(sharedApi.deleteMedicationReminder).toHaveBeenCalledWith('rem1'));
    expect(await screen.findByText(/No active reminders/i)).toBeInTheDocument();
  });
});
