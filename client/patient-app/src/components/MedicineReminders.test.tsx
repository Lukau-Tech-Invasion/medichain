import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@medichain/shared';
import * as sharedApi from '@medichain/shared';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MedicineReminders, ReminderForm, reminderMatches } from './MedicineReminders';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createMedicationReminder: vi.fn(),
  deleteMedicationReminder: vi.fn(),
}));

const wrap = (ui: React.ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

describe('reminders on a medicine', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('matches a reminder to a medicine by name, either way round, ignoring case', () => {
    expect(reminderMatches('metformin', 'Metformin 500 mg')).toBe(true);
    expect(reminderMatches('Metformin XR', 'metformin')).toBe(true);
    expect(reminderMatches('Aspirin', 'Metformin')).toBe(false);
    expect(reminderMatches('', 'Metformin')).toBe(false);
  });

  it('creates a reminder for the patient with what was entered, then reports it saved', async () => {
    vi.mocked(sharedApi.createMedicationReminder).mockResolvedValue({
      success: true, reminder_id: 'rem2', message: 'Medication reminder created successfully',
    });
    const onSaved = vi.fn();
    wrap(<ReminderForm patientId="HEALTH123" medication="Metformin" dosage="500 mg" onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Times'), { target: { value: '08:00\n20:00' } });
    fireEvent.click(screen.getByRole('button', { name: /save reminder/i }));

    await waitFor(() => expect(sharedApi.createMedicationReminder).toHaveBeenCalledWith(expect.objectContaining({
      patient_id: 'HEALTH123', medication_name: 'Metformin', dosage: '500 mg',
      frequency: 'daily', reminder_times: ['08:00', '20:00'],
    })));
    expect(onSaved).toHaveBeenCalled();
  });

  it('refuses a reminder with no time rather than inventing one', async () => {
    wrap(<ReminderForm patientId="HEALTH123" medication="Metformin" dosage="500 mg" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /save reminder/i }));
    await screen.findByRole('alert');
    expect(sharedApi.createMedicationReminder).not.toHaveBeenCalled();
  });

  it('stops a reminder and reloads', async () => {
    vi.mocked(sharedApi.deleteMedicationReminder).mockResolvedValue({ success: true, message: 'Reminder deactivated' });
    const onChanged = vi.fn();
    wrap(
      <MedicineReminders
        medicine="Aspirin"
        reminders={[{
          reminder_id: 'rem1', patient_id: 'HEALTH123', medication_name: 'Aspirin', dosage: '100mg',
          frequency: 'daily', reminder_times: ['08:00'], start_date: '2026-09-17', active: true,
        } as unknown as sharedApi.MedicationReminder]}
        doses={[{ id: 'rem1:08:00', reminderId: 'rem1', scheduledTime: '08:00', taken: false }]}
        patientId="HEALTH123"
        onChanged={onChanged}
        onTaken={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /deactivate reminder/i }));
    await waitFor(() => expect(sharedApi.deleteMedicationReminder).toHaveBeenCalledWith('rem1'));
    expect(onChanged).toHaveBeenCalled();
  });
});
