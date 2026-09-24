import { useEffect, useState } from 'react';
import {
  createMedicationReminder,
  deleteMedicationReminder,
  getPatientReminders,
  type MedicationReminder,
  useTranslation,
  Input,
  useValidatedForm,
  medicationReminderSchema,
} from '@medichain/shared';

import { usePatientAuthStore } from '../store/authStore';

export function MedicationRemindersPage() {
  const { t } = useTranslation();
  // Use wallet-authenticated patient from auth store
  const { patient } = usePatientAuthStore();
  const [reminders, setReminders] = useState<MedicationReminder[]>([]);
  const [loading, setLoading] = useState(true);

  // The Add Reminder button used to be a `<button>` with no `onClick`.
  //
  // It was the only action on the page and it did nothing: a patient could read
  // reminders somebody else had created and could never create one.
  // `POST /api/reminders/medication` has existed the whole time and had no
  // caller anywhere in either application.
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deactivatingReminderId, setDeactivatingReminderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [medication, setMedication] = useState('');
  const [dosage, setDosage] = useState('');
  // The API's own vocabulary, not free text. This was an open input, so
  // anything the patient typed that the backend did not recognise was stored as
  // "daily" -- "twice a day" became one reminder a day -- and a blank one failed
  // deserialization with a bare 400 the form rendered as a generic save error.
  const [frequency, setFrequency] = useState('daily');
  // Which channels to remind on. The scheduler reads all three; nothing sent
  // them, so `sms` and `email` were false on every reminder ever created and
  // the SMS branch was unreachable from the only screen that creates one.
  const [notifyPush, setNotifyPush] = useState(true);
  const [notifySms, setNotifySms] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(false);
  // Times as the patient types them, one per line. Not defaulted to a plausible
  // schedule: a reminder nobody set a time for is not a reminder.
  const [times, setTimes] = useState('');

  const load = async (healthId: string) => {
    try {
      const res = await getPatientReminders(healthId);
      setReminders(res.reminders);
    } catch (err) {
      console.error(err);
      setError(t('medications.remindersLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (patient?.healthId) {
      void load(patient.healthId);
    } else {
      setLoading(false);
    }
    // `load` is stable for a given health id; re-creating it each render would
    // re-fetch on every keystroke in the form below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.healthId]);

  const { errors, validate, validateField, clearField } = useValidatedForm(
    medicationReminderSchema
  );

  /** The fields a reminder needs; the time count is counted at submit. */
  const reminderFields = (timeCount = 1) => ({
    medication,
    dosage,
    reminderTimeCount: timeCount,
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient?.healthId) return;

    const reminderTimes = times
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    // Was one banner for three fields. The dose matters as much as the name:
    // "Metformin" at 08:00 does not say whether to take one tablet or two, and
    // a reminder that has to be checked against something else is not a
    // reminder.
    if (!validate(reminderFields(reminderTimes.length))) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createMedicationReminder({
        patient_id: patient.healthId,
        medication_name: medication.trim(),
        dosage: dosage.trim(),
        frequency,
        reminder_times: reminderTimes,
        start_date: new Date().toISOString().slice(0, 10),
        push_notification: notifyPush,
        sms: notifySms,
        email: notifyEmail,
      });
      setMedication('');
      setDosage('');
      setFrequency('daily');
      setTimes('');
      setNotifyPush(true);
      setNotifySms(false);
      setNotifyEmail(false);
      setShowForm(false);
      await load(patient.healthId);
    } catch (err) {
      // Surfaced, not swallowed. A reminder that failed to save must not leave
      // the screen looking as though it did.
      console.error(err);
      setError(err instanceof Error ? err.message : t('medications.reminderSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (reminderId: string) => {
    if (!patient?.healthId) return;

    setDeactivatingReminderId(reminderId);
    setError(null);
    try {
      await deleteMedicationReminder(reminderId);
      await load(patient.healthId);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : t('medications.reminderDeactivateFailed'));
    } finally {
      setDeactivatingReminderId(null);
    }
  };

  if (loading) return <div className="p-4">{t('medications.loadingReminders')}</div>;

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">{t('medications.remindersTitle')}</h1>

      {error && (
        <div role="alert" className="mb-4 p-3 rounded-lg bg-critical-subtle text-critical-subtle-fg text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {reminders.length === 0 ? (
          <p className="text-content-muted">{t('medications.noReminders')}</p>
        ) : (
          reminders.map((reminder) => (
            <div key={reminder.reminder_id} className="bg-surface p-4 rounded-lg shadow border-l-4 border-blue-500">
              <h3 className="font-bold">{reminder.medication_name}</h3>
              <p className="text-sm text-content-muted">{t('medications.dosageColon', { dosage: reminder.dosage })}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {reminder.reminder_times.map((time) => (
                  <span key={time} className="bg-notice-subtle text-notice-subtle-fg text-xs px-2 py-1 rounded-full">
                    {time}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void handleDeactivate(reminder.reminder_id)}
                disabled={deactivatingReminderId === reminder.reminder_id}
                className="mt-3 text-sm text-critical hover:underline disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100"
              >
                {deactivatingReminderId === reminder.reminder_id
                  ? t('medications.deactivatingReminder')
                  : t('medications.deactivateReminder')}
              </button>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="mt-6 bg-surface p-4 rounded-lg shadow space-y-3">
          <div>
            <label htmlFor="reminder-medication" className="block text-sm font-medium mb-1">
              {t('medications.reminderMedicationLabel')}
            </label>
            <Input
              id="reminder-medication"
              value={medication}
              onChange={(e) => { clearField('medication'); setMedication(e.target.value); }}
              onBlur={() => validateField('medication', reminderFields())}
              error={errors.medication}
              autoComplete="off"
              required
            />
          </div>
          <div>
            <label htmlFor="reminder-dosage" className="block text-sm font-medium mb-1">
              {t('medications.reminderDosageLabel')}
            </label>
            <Input
              id="reminder-dosage"
              value={dosage}
              onChange={(e) => { clearField('dosage'); setDosage(e.target.value); }}
              onBlur={() => validateField('dosage', reminderFields())}
              error={errors.dosage}
              autoComplete="off"
              required
            />
          </div>
          <div>
            <label htmlFor="reminder-frequency" className="block text-sm font-medium mb-1">
              {t('medications.reminderFrequencyLabel')}
            </label>
            <select
              id="reminder-frequency"
              className="w-full border border-border-interactive rounded-lg px-3 py-2 bg-surface text-content"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              <option value="once">{t('medications.freqOnce')}</option>
              <option value="daily">{t('medications.freqDaily')}</option>
              <option value="twice_daily">{t('medications.freqTwiceDaily')}</option>
              <option value="three_times_daily">{t('medications.freqThreeTimesDaily')}</option>
              <option value="weekly">{t('medications.freqWeekly')}</option>
              <option value="as_needed">{t('medications.freqAsNeeded')}</option>
            </select>
          </div>
          <fieldset className="border border-border-interactive rounded-lg p-3">
            <legend className="text-sm font-medium px-1">{t('medications.notifyLegend')}</legend>
            <label className="flex items-center gap-2 text-sm py-1">
              <input
                type="checkbox"
                checked={notifyPush}
                onChange={(e) => setNotifyPush(e.target.checked)}
              />
              {t('medications.notifyPush')}
            </label>
            <label className="flex items-center gap-2 text-sm py-1">
              <input
                type="checkbox"
                checked={notifySms}
                onChange={(e) => setNotifySms(e.target.checked)}
              />
              {t('medications.notifySms')}
            </label>
            <label className="flex items-center gap-2 text-sm py-1">
              <input
                type="checkbox"
                checked={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.checked)}
              />
              {t('medications.notifyEmail')}
            </label>
            <p className="text-xs text-content-muted mt-1">{t('medications.notifySmsNote')}</p>
          </fieldset>
          <div>
            <label htmlFor="reminder-times" className="block text-sm font-medium mb-1">
              {t('medications.reminderTimesLabel')}
            </label>
            <textarea
              id="reminder-times"
              className="w-full border border-border-interactive rounded-lg px-3 py-2 bg-surface text-content"
              rows={3}
              value={times}
              onChange={(e) => setTimes(e.target.value)}
              placeholder={t('medications.reminderTimesPh')}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100"
            >
              {saving ? t('common.saving') : t('medications.saveReminder')}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg border border-border-interactive"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="fixed bottom-20 right-4 bg-blue-600 text-white p-4 rounded-full shadow-lg"
        >
          {t('medications.addReminder')}
        </button>
      )}
    </div>
  );
}
