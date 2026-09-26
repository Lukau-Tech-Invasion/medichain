import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  getPatientEPrescriptions,
  getPatientPharmacyDecisions,
  getPatientReminders,
  getPatientAdherence,
  logMedicationAdherence,
  useTranslation,
  formatTimestamp,
} from '@medichain/shared';
import type { PharmacyDecision } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  Pill,
  Clock,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Bell,
  ChevronRight,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
} from 'lucide-react';

interface Medication {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  prescribedBy: string;
  startDate: string;
  endDate?: string;
  refillsRemaining: number;
  lastTaken?: string;
  nextDose?: string;
  instructions: string;
  sideEffects: string[];
  interactions: string[];
  status?: string;
}

interface MedicationReminder {
  id: string;
  medicationId: string;
  medicationName: string;
  dosage: string;
  scheduledTime: string;
  taken: boolean;
  takenAt?: string;
}

/**
 * MedicationsPage - Patient medication management
 * 
 * Features:
 * - View all current medications
 * - Medication reminders
 * - Track doses taken
 * - Refill requests
 * 
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
/**
 * A prescription as `GET /api/e-prescriptions/patient/{id}` returns it: the
 * medicine is NESTED under `medication`. The page used to read only flat
 * `medication_name`/`name`, found neither, and dropped every prescription, so
 * a patient's medicines list was empty whatever had been prescribed. The flat
 * fields stay as a fallback for older rows.
 */
interface RawPrescription {
  prescription_id?: string; medication_id?: string;
  medication?: {
    name?: string;
    strength?: string;
    form?: string;
    directions?: string;
  };
  medication_name?: string; name?: string;
  dosage?: string;
  frequency?: string;
  prescriber_name?: string; prescribed_by?: string;
  prescribed_date?: string; start_date?: string;
  /** Unix seconds. */
  signed_at?: number | null;
  /** Unix seconds. */
  created_at?: number;
  end_date?: string;
  refills_remaining?: number;
  instructions?: string;
  patient_instructions?: string;
  side_effects?: string[];
  interactions?: string[];
  status?: string;
}

/**
 * The server's prescription status as the patient reads it. A signed or
 * dispensed prescription is one they are on; one that was never issued
 * (`Draft`, `Error`) has no status to show rather than a guessed one.
 */
function patientFacingStatus(status: string | undefined): string | undefined {
  switch (status) {
    case 'Pending':
    case 'Signed':
    case 'Transmitted':
    case 'Received':
    case 'InProgress':
    case 'Dispensed':
    case 'PartialFill':
      return 'active';
    case 'Cancelled':
      return 'cancelled';
    case 'Expired':
      return 'expired';
    case 'Draft':
    case 'Error':
    case undefined:
    case '':
      return undefined;
    default:
      return status;
  }
}

const isoDate = (seconds: number | null | undefined): string =>
  typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString().slice(0, 10)
    : '';

/**
 * Maps a persisted prescription without inventing clinical directions when a
 * legacy or incomplete record omits them.
 */
export function mapPrescription(m: RawPrescription): Medication | null {
  const id = m.prescription_id || m.medication_id;
  const name = m.medication?.name || m.medication_name || m.name;
  if (!id || !name) return null;

  const strength = m.medication?.strength;
  const dosage = strength
    ? [strength, m.medication?.form].filter(Boolean).join(' ')
    : m.dosage ?? '';
  const instructions = m.medication?.directions
    ? [m.medication.directions, m.patient_instructions].filter(Boolean).join(' — ')
    : m.instructions ?? '';

  return {
    id,
    name,
    dosage,
    // A prescription carries its frequency inside the directions; nothing is
    // parsed out of them here.
    frequency: m.frequency ?? '',
    prescribedBy: m.prescriber_name || m.prescribed_by || '',
    startDate: m.prescribed_date || m.start_date || isoDate(m.signed_at ?? m.created_at),
    endDate: m.end_date,
    refillsRemaining: m.refills_remaining ?? 0,
    instructions,
    sideEffects: m.side_effects ?? [],
    interactions: m.interactions ?? [],
    status: patientFacingStatus(m.status),
  };
}

export function MedicationsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const statusLabel = (s: string) =>
    ({ active: t('medications.statusActive'), completed: t('medications.statusCompleted'), paused: t('medications.statusPaused') }[s] ||
      s.charAt(0).toUpperCase() + s.slice(1));
  const [medications, setMedications] = useState<Medication[]>([]);
  const [reminders, setReminders] = useState<MedicationReminder[]>([]);
  // A pharmacist's decision about this patient's medicine -- why something
  // they were prescribed did not arrive. Recorded on the pharmacy side and,
  // until this, readable only by clinical staff.
  const [pharmacyNotes, setPharmacyNotes] = useState<PharmacyDecision[]>([]);
  const [loading, setLoading] = useState(true);
  // Said out loud when a dose could not be recorded. Silence plus a tick is the
  // worst of both: the patient believes the record exists and it does not.
  const [adherenceError, setAdherenceError] = useState('');
  const [apiConnected, setApiConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'current' | 'reminders' | 'history'>('current');

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  const loadMedications = useCallback(async () => {
    if (!patient) return;
    
    setLoading(true);
    try {
      const patientId = patient.healthId;

      // Fetch prescriptions from correct endpoint
      const [prescData, remindersData, adherenceData] = await Promise.all([
        getPatientEPrescriptions(patientId),
        getPatientReminders(patientId),
        getPatientAdherence(patientId),
      ]);

      setApiConnected(true);
      getPatientPharmacyDecisions(patientId)
        .then((body) => setPharmacyNotes(body.decisions ?? []))
        .catch(() => setPharmacyNotes([]));

      const meds = (((prescData as { prescriptions?: unknown[]; medications?: unknown[] }).prescriptions ||
        (prescData as { prescriptions?: unknown[]; medications?: unknown[] }).medications || []) as RawPrescription[])
        .map(mapPrescription)
        .filter((medication): medication is Medication => medication !== null);

      setMedications(meds);
        
        const today = new Date().toISOString().slice(0, 10);
        const dosesTakenToday = new Map(
          (adherenceData.logs ?? [])
            .filter((log) =>
              (log.action_taken === 'taken' || log.action_taken === 'taken_late') &&
              log.actual_time?.slice(0, 10) === today &&
              log.reminder_id
            )
            .map((log) => [log.reminder_id as string, log.actual_time as string])
        );
        const apiReminders: MedicationReminder[] = (remindersData.reminders ?? []).flatMap((reminder) =>
          reminder.reminder_times.map((scheduledTime) => {
            const takenAt = dosesTakenToday.get(reminder.reminder_id);
            return {
              id: `${reminder.reminder_id}:${scheduledTime}`,
              medicationId: reminder.reminder_id,
              medicationName: reminder.medication_name,
              dosage: reminder.dosage,
              scheduledTime,
              taken: Boolean(takenAt),
              takenAt: takenAt
                ? formatTimestamp(takenAt, { hour: '2-digit', minute: '2-digit' })
                : undefined,
            };
          })
        );
      setReminders(apiReminders.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime)));
    } catch (error) {
      console.error('Error loading medications:', error);
      setApiConnected(false);
      setMedications([]);
    } finally {
      setLoading(false);
    }
  }, [patient]);

  useEffect(() => {
    if (patient) {
      loadMedications();
    }
  }, [patient, loadMedications]);

  const markAsTaken = async (reminderId: string) => {
    if (!patient) return;

    try {
      // `{ reminder_id, action }` is what the endpoint reads. This used to send
      // `{ patient_id, taken, taken_at }`, which the handler could not
      // deserialize at all -- so every dose a patient marked as taken answered
      // 400, was swallowed by a console.warn, and was recorded nowhere while
      // the tick stayed on screen.
      await logMedicationAdherence({ reminder_id: reminderId, action: 'taken' });
    } catch (err) {
      console.error('Failed to log adherence:', err);
      setAdherenceError(t('medications.doseNotRecorded'));
      return;
    }

    // Ticked only after the server has it. The tick used to go on first and
    // stay on regardless, which is the difference between "we recorded your
    // dose" and "we drew a tick".
    const takenAt = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    setReminders(prev => prev.map(r =>
      r.id === reminderId
        ? { ...r, taken: true, takenAt }
        : r
    ));
    setAdherenceError('');
  };

  const pendingReminders = reminders.filter(r => !r.taken);
  const completedReminders = reminders.filter(r => r.taken);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content">{t('medications.pageTitle')}</h1>
          <p className="text-content-muted">{t('medications.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? t('common.live') : t('common.offline')}
          </span>
          <button
            onClick={loadMedications}
            className="p-2 text-content-muted hover:bg-surface-sunken rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {pharmacyNotes.length > 0 && (
        <section className="bg-caution-subtle border border-caution rounded-xl p-4" data-testid="pharmacy-notes">
          <h2 className="font-semibold text-caution-subtle-fg mb-2">{t('medications.pharmacyNotesHeading')}</h2>
          <ul className="space-y-1">
            {pharmacyNotes.map((note) => (
              <li key={note.decision_id} className="text-sm text-caution-subtle-fg">
                {t(`medications.pharmacyNote_${note.decision}`, { allergen: note.allergen, reason: note.reason })}
                <span className="ml-1 opacity-80">({formatTimestamp(note.decided_at)})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Today's Reminders Summary */}
      <div className="bg-gradient-to-r from-primary-700 to-primary-800 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{t('medications.todaysMeds')}</h2>
            <p className="text-white text-sm">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <Bell className="w-6 h-6" />
        </div>
        
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface/10 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold">{reminders.length}</div>
            <div className="text-xs text-white">{t('medications.totalDoses')}</div>
          </div>
          <div className="bg-surface/10 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold">{completedReminders.length}</div>
            <div className="text-xs text-white">{t('medications.taken')}</div>
          </div>
          <div className="bg-surface/10 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-yellow-300">{pendingReminders.length}</div>
            <div className="text-xs text-white">{t('medications.pending')}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        {(['current', 'reminders', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-brand text-brand'
                : 'border-transparent text-content-muted hover:text-content-secondary'
            }`}
          >
            {tab === 'current' ? t('medications.tabCurrent') : tab === 'reminders' ? t('medications.tabSchedule') : t('medications.tabHistory')}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'reminders' && (
        <div className="space-y-4">
          {adherenceError && (
            <div role="alert" className="p-3 rounded-lg bg-critical-subtle text-critical-subtle-fg text-sm">
              {adherenceError}
            </div>
          )}
          {/* Pending */}
          {pendingReminders.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium text-content-secondary flex items-center gap-2">
                <Clock className="w-4 h-4" /> {t('medications.upcoming')}
              </h3>
              {pendingReminders.map(reminder => (
                <div key={reminder.id} className="patient-card flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-brand-subtle rounded-xl flex items-center justify-center">
                      <Pill className="w-6 h-6 text-brand" />
                    </div>
                    <div>
                      <p className="font-medium text-content">{reminder.medicationName}</p>
                      <p className="text-sm text-content-muted">{reminder.dosage} • {reminder.scheduledTime}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => markAsTaken(reminder.id)}
                    className="px-4 py-2 bg-primary-500 text-brand-fg rounded-lg hover:bg-brand transition-colors text-sm font-medium"
                  >
                    {t('medications.markTaken')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Completed */}
          {completedReminders.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium text-content-secondary flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-ok" /> {t('medications.completed')}
              </h3>
              {completedReminders.map(reminder => (
                <div key={reminder.id} className="patient-card flex items-center justify-between opacity-75">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-ok-subtle rounded-xl flex items-center justify-center">
                      <CheckCircle className="w-6 h-6 text-ok-subtle-fg" />
                    </div>
                    <div>
                      <p className="font-medium text-content line-through">{reminder.medicationName}</p>
                      <p className="text-sm text-content-muted">{reminder.dosage} • {t('medications.takenAt', { time: reminder.takenAt || '' })}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {reminders.length === 0 && (
            <div className="text-center py-12">
              <Pill className="w-12 h-12 text-content-muted mx-auto mb-3" />
              <p className="text-content-muted">{t('medications.noneToday')}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'current' && (
        <div className="space-y-4">
          {medications.map(med => (
            <div key={med.id} className="patient-card">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-brand-subtle rounded-xl flex items-center justify-center">
                    <Pill className="w-6 h-6 text-brand" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-content">{med.name}</h3>
                    <p className="text-sm text-content-muted">
                      {[med.dosage, med.frequency].filter(Boolean).join(' • ') || t('medications.regimenNotRecorded')}
                    </p>
                    {med.status && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        med.status === 'active' ? 'bg-ok-subtle text-ok-subtle-fg' :
                        med.status === 'completed' ? 'bg-surface-sunken text-content-muted' :
                        'bg-caution-subtle text-caution-subtle-fg'
                      }`}>{statusLabel(med.status)}</span>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-content-muted" />
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-surface-sunken rounded-lg p-3">
                  <p className="text-xs text-content-muted">{t('medications.prescribedBy')}</p>
                  <p className="text-sm font-medium text-content">{med.prescribedBy}</p>
                </div>
                <div className="bg-surface-sunken rounded-lg p-3">
                  <p className="text-xs text-content-muted">{t('medications.refillsRemaining')}</p>
                  <p className={`flex items-center gap-1 text-sm font-medium ${med.refillsRemaining <= 1 ? 'text-critical-subtle-fg' : 'text-content'}`}>
                    {med.refillsRemaining}
                    {med.refillsRemaining <= 1 && <AlertTriangle className="w-4 h-4" aria-label={t('medications.lowRefills')} />}
                  </p>
                </div>
              </div>

              <p className="text-sm text-content-muted mb-3">
                <span className="font-medium">{t('medications.instructionsLabel')}</span>{' '}
                {med.instructions || t('medications.instructionsNotRecorded')}
              </p>

              {med.sideEffects.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-caution-subtle-fg bg-caution-subtle rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium">{t('medications.sideEffectsLabel')}</span>{' '}
                    {med.sideEffects.join(', ')}
                  </div>
                </div>
              )}

              {med.interactions.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-critical-subtle-fg bg-critical-subtle rounded-lg p-3 mt-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium">{t('medications.interactionsLabel')}</span>{' '}
                    {med.interactions.join(', ')}
                  </div>
                </div>
              )}

              {med.refillsRemaining <= 1 && (
                <p className="mt-3 text-sm text-caution-subtle-fg">
                  {t('medications.refillRequestUnavailable')}
                </p>
              )}
            </div>
          ))}

          {medications.length === 0 && (
            <div className="text-center py-12">
              <Pill className="w-12 h-12 text-content-muted mx-auto mb-3" />
              <p className="text-content-muted">{t('medications.noneActive')}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="patient-card">
            <div className="flex items-center gap-3 mb-4">
              <Calendar className="w-5 h-5 text-content-muted" />
              <h3 className="font-medium text-content">{t('medications.historyTitle')}</h3>
            </div>
            <p className="text-sm text-content-muted text-center py-8">
              {t('medications.historyEmpty')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
