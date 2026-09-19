import { render, screen, waitFor } from '@testing-library/react';
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
}));

describe('MedicationRemindersPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
});
