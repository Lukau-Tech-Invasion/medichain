import { useEffect, useState } from 'react';
import { getPatientReminders, createMedicationReminder, useTranslation } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

export function MedicationRemindersPage() {
  const { t } = useTranslation();
  // Use wallet-authenticated patient from auth store
  const { patient } = usePatientAuthStore();
  const [reminders, setReminders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (patient?.healthId) {
      getPatientReminders(patient.healthId)
        .then((res: any) => setReminders(res.reminders || []))
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [patient?.healthId]);

  if (loading) return <div className="p-4">{t('medications.loadingReminders')}</div>;

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">{t('medications.remindersTitle')}</h1>

      <div className="space-y-4">
        {reminders.length === 0 ? (
          <p className="text-gray-500">{t('medications.noReminders')}</p>
        ) : (
          reminders.map((reminder) => (
            <div key={reminder.id} className="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500">
              <h3 className="font-bold">{reminder.medication}</h3>
              <p className="text-sm text-gray-600">{t('medications.dosageColon', { dosage: reminder.dosage })}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {reminder.schedule?.map((time: string) => (
                  <span key={time} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                    {time}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      
      <button className="fixed bottom-20 right-4 bg-blue-600 text-white p-4 rounded-full shadow-lg">
        {t('medications.addReminder')}
      </button>
    </div>
  );
}
