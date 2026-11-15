/**
 * Reminders where the medicine is (patient-app plan, 2026-11-04): each
 * medicine card lists its own reminders, marks today's doses taken, stops a
 * reminder, and adds one already filled in with the medicine's name and dose.
 *
 * A reminder is matched to a medicine by name, the only thing they share: the
 * reminder API stores a medication name, not a prescription id. Reminders that
 * match no medicine are listed on their own by the page, so none is hidden.
 */
import { useState } from 'react';
import { Bell, CheckCircle } from 'lucide-react';
import {
  ChoiceChips,
  Input,
  createMedicationReminder,
  deleteMedicationReminder,
  medicationReminderSchema,
  notifySuccess,
  useTranslation,
  useValidatedForm,
  type MedicationReminder,
} from '@medichain/shared';

/** One scheduled dose today, from a reminder's times. */
export interface DoseToday {
  /** `<reminder_id>:<time>`, unique on the page. */
  id: string;
  reminderId: string;
  scheduledTime: string;
  taken: boolean;
  takenAt?: string;
}

/** Whether a reminder is for this medicine: either name contains the other. */
export function reminderMatches(reminderName: string, medicineName: string): boolean {
  const a = reminderName.trim().toLowerCase();
  const b = medicineName.trim().toLowerCase();
  return Boolean(a && b) && (a.includes(b) || b.includes(a));
}

/**
 * The form that creates a reminder. Each control keeps the API's vocabulary
 * and nothing is defaulted that the patient did not choose (rule 9): a reminder
 * with no time is refused, not given a plausible one.
 */
export function ReminderForm({ patientId, medication: initialMedication = '', dosage: initialDosage = '', idPrefix = 'reminder', onSaved, onCancel }: {
  patientId: string;
  medication?: string;
  dosage?: string;
  /** Distinguishes the fields when several medicines show a form. */
  idPrefix?: string;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [medication, setMedication] = useState(initialMedication);
  const [dosage, setDosage] = useState(initialDosage);
  const [frequency, setFrequency] = useState('daily');
  const [notifyPush, setNotifyPush] = useState(true);
  const [notifySms, setNotifySms] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [times, setTimes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { errors, validate, validateField, clearField } = useValidatedForm(medicationReminderSchema);
  const fields = (timeCount = 1) => ({ medication, dosage, reminderTimeCount: timeCount });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const reminderTimes = times.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!validate(fields(reminderTimes.length))) return;
    setSaving(true);
    setError(null);
    try {
      await createMedicationReminder({
        patient_id: patientId,
        medication_name: medication.trim(),
        dosage: dosage.trim(),
        frequency,
        reminder_times: reminderTimes,
        start_date: new Date().toISOString().slice(0, 10),
        push_notification: notifyPush,
        sms: notifySms,
        email: notifyEmail,
      });
      notifySuccess('Reminder added.');
      await onSaved();
    } catch (err) {
      // A reminder that failed to save must not leave the screen looking as though it did.
      setError(err instanceof Error ? err.message : t('medications.reminderSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-border bg-surface p-4">
      {error && <div role="alert" className="rounded-lg bg-critical-subtle p-3 text-sm text-critical-subtle-fg">{error}</div>}
      <div>
        <label htmlFor={id('medication')} className="mb-1 block text-sm font-medium">{t('medications.reminderMedicationLabel')}</label>
        <Input id={id('medication')} value={medication}
          onChange={(e) => { clearField('medication'); setMedication(e.target.value); }}
          onBlur={() => validateField('medication', fields())} error={errors.medication} autoComplete="off" required />
      </div>
      <div>
        <label htmlFor={id('dosage')} className="mb-1 block text-sm font-medium">{t('medications.reminderDosageLabel')}</label>
        <Input id={id('dosage')} value={dosage}
          onChange={(e) => { clearField('dosage'); setDosage(e.target.value); }}
          onBlur={() => validateField('dosage', fields())} error={errors.dosage} autoComplete="off" required />
      </div>
      <ChoiceChips
        id={id('frequency')}
        label={t('medications.reminderFrequencyLabel')}
        value={frequency}
        onChange={(next) => { if (next !== undefined) setFrequency(next); }}
        options={[
          { value: 'once', label: t('medications.freqOnce') },
          { value: 'daily', label: t('medications.freqDaily') },
          { value: 'twice_daily', label: t('medications.freqTwiceDaily') },
          { value: 'three_times_daily', label: t('medications.freqThreeTimesDaily') },
          { value: 'weekly', label: t('medications.freqWeekly') },
          { value: 'as_needed', label: t('medications.freqAsNeeded') },
        ]}
      />
      <fieldset className="rounded-lg border border-border-interactive p-3">
        <legend className="px-1 text-sm font-medium">{t('medications.notifyLegend')}</legend>
        <label className="flex items-center gap-2 py-1 text-sm">
          <input type="checkbox" checked={notifyPush} onChange={(e) => setNotifyPush(e.target.checked)} />
          {t('medications.notifyPush')}
        </label>
        <label className="flex items-center gap-2 py-1 text-sm">
          <input type="checkbox" checked={notifySms} onChange={(e) => setNotifySms(e.target.checked)} />
          {t('medications.notifySms')}
        </label>
        <label className="flex items-center gap-2 py-1 text-sm">
          <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
          {t('medications.notifyEmail')}
        </label>
        <p className="mt-1 text-xs text-content-muted">{t('medications.notifySmsNote')}</p>
      </fieldset>
      <div>
        <label htmlFor={id('times')} className="mb-1 block text-sm font-medium">{t('medications.reminderTimesLabel')}</label>
        <textarea
          id={id('times')}
          className="w-full rounded-lg border border-border-interactive bg-surface px-3 py-2 text-content"
          rows={3}
          value={times}
          onChange={(e) => { setTimes(e.target.value); clearField('reminderTimeCount'); }}
          aria-invalid={Boolean(errors.reminderTimeCount)}
          aria-describedby={errors.reminderTimeCount ? id('times-error') : undefined}
          placeholder={t('medications.reminderTimesPh')}
        />
        {errors.reminderTimeCount && <p id={id('times-error')} role="alert" className="text-sm text-critical">{errors.reminderTimeCount}</p>}
      </div>
      <div className="flex gap-2">
        <button type="submit" aria-disabled={saving || undefined} className="rounded-lg bg-brand px-4 py-2 text-brand-fg">
          {saving ? t('common.saving') : t('medications.saveReminder')}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border-interactive px-4 py-2">
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/** One medicine's reminders and today's doses, with add, stop and taken. */
export function MedicineReminders({ medicine, dosage, reminders, doses, patientId, onChanged, onTaken }: {
  medicine: string;
  dosage?: string;
  /** The reminders already matched to this medicine. */
  reminders: MedicationReminder[];
  /** Today's doses from those reminders. */
  doses: DoseToday[];
  patientId: string;
  onChanged: () => void | Promise<void>;
  onTaken: (dose: DoseToday) => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formPrefix = `reminder-${medicine.replace(/[^A-Za-z0-9]/g, '-').toLowerCase()}`;

  const stop = async (reminderId: string) => {
    setStopping(reminderId);
    setError(null);
    try {
      await deleteMedicationReminder(reminderId);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('medications.reminderDeactivateFailed'));
    } finally {
      setStopping(null);
    }
  };

  return (
    <section aria-label={t('medications.remindersFor', { name: medicine })} className="mt-3 border-t border-border pt-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-content">
        <Bell className="h-4 w-4 text-brand" aria-hidden="true" />
        {t('medications.remindersTitle')}
      </h4>
      {error && <p role="alert" className="mt-2 text-sm text-critical-subtle-fg">{error}</p>}
      {reminders.length === 0 && !adding && (
        <p className="mt-1 text-sm text-content-muted">{t('medications.noReminderForMedicine')}</p>
      )}
      <ul className="mt-2 space-y-2">
        {reminders.map((reminder) => (
          <li key={reminder.reminder_id} className="rounded-lg bg-surface-sunken p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-content">
                {reminder.dosage && <span className="font-medium">{reminder.dosage}</span>}
              </p>
              <button
                type="button"
                onClick={() => void stop(reminder.reminder_id)}
                disabled={stopping === reminder.reminder_id}
                className="min-h-[32px] text-sm text-critical-subtle-fg hover:underline disabled:opacity-60"
              >
                {stopping === reminder.reminder_id ? t('medications.deactivatingReminder') : t('medications.deactivateReminder')}
              </button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {doses.filter((dose) => dose.reminderId === reminder.reminder_id).map((dose) => (
                <li key={dose.id}>
                  {dose.taken ? (
                    <span className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-ok-subtle px-3 text-xs font-medium text-ok-subtle-fg">
                      <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      {dose.scheduledTime} · {t('medications.takenAt', { time: dose.takenAt ?? '' })}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onTaken(dose)}
                      aria-label={t('medications.markTakenAt', { name: medicine, time: dose.scheduledTime })}
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-border-interactive bg-surface px-3 text-xs font-medium text-content hover:bg-brand-subtle"
                    >
                      {dose.scheduledTime} · {t('medications.markTaken')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {adding ? (
        <ReminderForm
          patientId={patientId}
          medication={medicine}
          dosage={dosage}
          idPrefix={formPrefix}
          onSaved={async () => { setAdding(false); await onChanged(); }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="mt-2 inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-brand hover:underline">
          <Bell className="h-4 w-4" aria-hidden="true" />
          {t('medications.addReminderFor', { name: medicine })}
        </button>
      )}
    </section>
  );
}
