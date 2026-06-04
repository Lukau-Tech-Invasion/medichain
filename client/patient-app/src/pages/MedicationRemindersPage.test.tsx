import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MedicationRemindersPage } from './MedicationRemindersPage';
import { usePatientAuthStore } from '../store/authStore';
import * as sharedApi from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared API
vi.mock('@medichain/shared', () => ({
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
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
    });
  });

  it('renders medication reminders page with reminders', async () => {
    (sharedApi.getPatientReminders as any).mockResolvedValue({
      reminders: [
        {
          id: 'rem1',
          medication: 'Aspirin',
          dosage: '100mg',
          schedule: ['08:00 AM', '08:00 PM'],
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
    (sharedApi.getPatientReminders as any).mockResolvedValue({ reminders: [] });

    render(<MedicationRemindersPage />);

    await waitFor(() => {
      expect(screen.getByText(/No active reminders/i)).toBeInTheDocument();
    });
  });
});
