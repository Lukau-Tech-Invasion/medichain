/**
 * Shift handoff (mockup c2). The patients the nurse cared for this shift load
 * from the shift's own records, each drafted as SBAR lines beside the record
 * they came from. The nurse reviews each patient in turn -- edits the lines,
 * makes the Stable / Watch / Unstable call, adds to-dos -- and hands them all
 * over at once. The handoff is kept as a draft on this tab until it is sent.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import {
  createShiftHandoff,
  getApiClient,
  getApiErrorMessage,
  getShiftHandoffDraft,
  useFormDraft,
  useTranslation,
  useUnsavedChanges,
  useValidatedForm,
  shiftHandoffSchema,
  localDateInput,
  formatTimestamp,
  ChoiceChips,
  clearDraft,
  keepEnterInField,
} from '@medichain/shared';
import StaffName from '../components/StaffName';
import StaffSelect from '../components/StaffSelect';
import type { PatientDirectoryEntry } from '@medichain/shared';
import PatientSelect from '../components/PatientSelect';
import { AlertTriangle, CheckCircle2, FileText, History, RefreshCw, Send } from 'lucide-react';
import { useReturnAfterSave } from '../workspace/useReturnAfterSave';
import { HandoffPatientList } from './handoff/HandoffPatientList';
import { HandoffPatientEditor } from './handoff/HandoffPatientEditor';
import {
  blankPatient,
  fromDraft,
  nextToReview,
  toPayload,
  type PatientHandoff,
  type Priority,
} from './handoff/handoffModel';

type ShiftType = 'day-to-evening' | 'evening-to-night' | 'night-to-day';

interface ShiftDetails {
  shiftType: ShiftType;
  handoffDate: string;
  handoffTime: string;
  outgoingNurse: string;
  incomingNurse: string;
  unit: string;
}

const UNIT_KEYS: Record<string, string> = {
  'Medical-Surgical': 'medical-surgical',
  'ICU': 'icu',
  'CCU': 'ccu',
  'PICU': 'picu',
  'NICU': 'nicu',
  'L&D': 'ld',
  'ED': 'ed',
  'Oncology': 'oncology',
  'Orthopedics': 'orthopedics',
  'Neurology': 'neurology',
  'Cardiology': 'cardiology',
  'Telemetry': 'telemetry'
};

/**
 * What this endpoint returns, as this page already reads it.
 *
 * `res.json()` was `any`, so a field this endpoint does not return typechecked
 * anyway and showed up as a blank panel instead of a compile error. The union
 * below is the one the call site already handles -- the list endpoints are
 * genuinely inconsistent about enveloping -- so naming it changes nothing at
 * run time and makes the reads checkable.
 */
interface SavedHandoff {
  id: string;
  patient_id: string;
  outgoing_provider_id: string;
  incoming_provider_id: string;
  handoff_datetime: string;
  location_from?: string;
  code_status?: string;
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  acknowledged_by_incoming: boolean;
  acknowledged_at?: string;
  data?: {
    shift_direction?: ShiftType;
    patient?: {
      patientName?: string;
      patient_name?: string;
      room?: string;
      diagnosis?: string;
      priority?: string;
      isolation?: string;
      ivAccess?: string;
      diet?: string;
      activity?: string;
      pendingLabs?: string;
      pendingTests?: string;
      pendingOrders?: string;
      familyUpdates?: string;
      additionalNotes?: string;
      safetyRisks?: string[];
      medications?: { scheduled?: string; prn?: string; drips?: string };
      stability?: string;
      todos?: string[];
    };
  };
}

type HandoffList = { handoffs?: SavedHandoff[] } | SavedHandoff[];

/** How far back the History tab reaches. The API caps it at 30. */
const HANDOFF_HISTORY_DAYS = 14;
const DRAFT_ID = 'shift-handoff';

interface KeptDraft {
  handoff: ShiftDetails;
  patients: PatientHandoff[];
  selected: string[];
  openId: string | null;
}

/** Patients from the server's draft that the page does not hold yet. */
function mergeNew(current: PatientHandoff[], incoming: PatientHandoff[]): PatientHandoff[] {
  const have = new Set(current.map((p) => p.patientId));
  return [...current, ...incoming.filter((p) => !have.has(p.patientId))];
}

export default function ShiftHandoffPage() {
  const returnAfterSave = useReturnAfterSave();
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'handoff' | 'history'>('handoff');

  const [handoff, setHandoff] = useState<ShiftDetails>({
    shiftType: 'day-to-evening',
    handoffDate: localDateInput(),
    handoffTime: new Date().toTimeString().slice(0, 5),
    outgoingNurse: user?.userId || '',
    incomingNurse: '',
    unit: 'Medical-Surgical',
  });
  const [patients, setPatients] = useState<PatientHandoff[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  // Something the nurse did, not something the draft loaded.
  const [touched, setTouched] = useState(false);
  const [draftState, setDraftState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [draftError, setDraftError] = useState('');
  const [allReviewed, setAllReviewed] = useState(false);

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  // The directory entry the server's search returned for the chosen patient.
  const [selectedPatientEntry, setSelectedPatientEntry] = useState<PatientDirectoryEntry | null>(null);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [newPatient, setNewPatient] = useState<{ room: string; diagnosis: string; priority: Priority }>({ room: '', diagnosis: '', priority: 'routine' });
  const [handoffHistory, setHandoffHistory] = useState<SavedHandoff[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [receiptPending, setReceiptPending] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState('');

  // Kept on this tab while it is being written (memory only, like every draft).
  useFormDraft<KeptDraft>(DRAFT_ID, undefined, { handoff, patients, selected: [...selected], openId }, touched, (kept) => {
    setHandoff(kept.handoff);
    setPatients((now) => mergeNew(kept.patients, now));
    setSelected(new Set(kept.selected));
    setOpenId(kept.openId);
    setTouched(true);
  });
  useUnsavedChanges(touched, t('docShiftHandoff.title'), { keptAsDraft: true });

  const loadDraft = useCallback(() => {
    setDraftState('loading');
    setDraftError('');
    getShiftHandoffDraft().then(
      (r) => {
        const drafted = r.patients.map((d) => fromDraft(d, t('today.unreadablePatient')));
        setPatients((now) => mergeNew(now, drafted));
        // Patients with something recorded this shift are handed over unless
        // the nurse says otherwise; a ward patient nobody charted is listed,
        // unticked, so leaving them out of the handoff is a choice.
        setSelected((now) => (now.size ? now : new Set(drafted.filter((p) => p.entries > 0).map((p) => p.patientId))));
        setOpenId((now) => now ?? drafted.find((p) => p.entries > 0)?.patientId ?? drafted[0]?.patientId ?? null);
        setDraftState('loaded');
      },
      (e) => {
        setDraftError(getApiErrorMessage(e, t('handoffDraft.loadFailed')));
        setDraftState('failed');
      },
    );
  }, [t]);

  useEffect(loadDraft, [loadDraft]);

  /** Persist receipt for one saved record, then re-read authoritative history. */
  const acknowledgeReceipt = async (id: string) => {
    if (receiptPending) return;
    setReceiptPending(id);
    setReceiptError('');
    try {
      await getApiClient().put(`/api/emergency/handoff/${encodeURIComponent(id)}/receipt`, {});
      setHistoryAttempt(attempt => attempt + 1);
    } catch (error) {
      console.error('Handoff receipt could not be confirmed', error);
      setReceiptError(t('docShiftHandoff.receiptFailed'));
    } finally {
      setReceiptPending(null);
    }
  };

  const shiftTypes: Record<ShiftType, { label: string; time: string }> = {
    'day-to-evening': { label: t('docShiftHandoff.shiftType_day-to-evening'), time: '15:00' },
    'evening-to-night': { label: t('docShiftHandoff.shiftType_evening-to-night'), time: '23:00' },
    'night-to-day': { label: t('docShiftHandoff.shiftType_night-to-day'), time: '07:00' }
  };

  const units = Object.keys(UNIT_KEYS);

  useEffect(() => { setHandoffHistory([]); }, [user?.userId]);

  useEffect(() => {
    let active = true;
    if (activeTab === 'history' && user) {
      const fetchHistory = async () => {
        setHistoryLoading(true);
        setHistoryError('');
        try {
          // The history tab asked for today only, because that was all the
          // endpoint could answer -- so yesterday's handover, the one a
          // clinician starting a shift most needs, was never on it.
          const data = await getApiClient().get<HandoffList>(
            `/api/clinical/shift-handoff/${user.userId}?days=${HANDOFF_HISTORY_DAYS}`
          );
          const rows = Array.isArray(data) ? data : data.handoffs;
          if (!Array.isArray(rows)) throw new Error('Invalid handoff history response');
          if (active) setHandoffHistory(rows);
        } catch (err) {
          console.error('Failed to fetch handoff history:', err);
          if (active) setHistoryError(t('docShiftHandoff.errorHistoryLoad'));
        } finally {
          if (active) setHistoryLoading(false);
        }
      };
      fetchHistory();
    }
    return () => { active = false; };
  }, [activeTab, user?.userId, historyAttempt, t]);

  const edit = (patientId: string, updates: Partial<PatientHandoff>) => {
    setTouched(true);
    setPatients((prev) => prev.map((p) => (p.patientId === patientId ? { ...p, ...updates } : p)));
  };

  const toggleSelected = (patientId: string) => {
    setTouched(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(patientId)) next.delete(patientId); else next.add(patientId);
      return next;
    });
  };

  const openPatient = (patientId: string) => {
    setAllReviewed(false);
    setOpenId(patientId);
  };

  const nextPatient = () => {
    if (!openId) return;
    const reviewed = patients.map((p) => (p.patientId === openId ? { ...p, reviewed: true } : p));
    setTouched(true);
    setPatients(reviewed);
    const next = nextToReview(reviewed, selected, openId);
    setAllReviewed(next === null);
    if (next) setOpenId(next);
  };

  const addPatientToHandoff = (patient: PatientDirectoryEntry) => {
    if (patients.some((p) => p.patientId === patient.patient_id)) {
      setError(t('docShiftHandoff.errorPatientAlreadyAdded'));
      return;
    }
    const added = { ...blankPatient(patient.patient_id, patient.full_name, newPatient.room), diagnosis: newPatient.diagnosis, priority: newPatient.priority };
    setTouched(true);
    setPatients((prev) => [...prev, added]);
    setSelected((prev) => new Set(prev).add(added.patientId));
    setOpenId(added.patientId);
    setShowAddPatient(false);
    setNewPatient({ room: '', diagnosis: '', priority: 'routine' });
    setSelectedPatientId(null);
    setSelectedPatientEntry(null);
  };

  const handingOver = patients.filter((p) => selected.has(p.patientId));
  const open = patients.find((p) => p.patientId === openId) ?? null;

  const { errors, validate, clearField } = useValidatedForm(shiftHandoffSchema);
  const handleSave = async () => {
    if (isSubmitting) return;
    // A handover with nobody named as receiving it records that care was handed
    // to no one, which is the gap a handover exists to close.
    if (!validate(handoff)) {
      return;
    }
    if (handingOver.length === 0) {
      setError(t('docShiftHandoff.errorNoPatients'));
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await createShiftHandoff({
        shift_type: handoff.shiftType,
        handoff_date: handoff.handoffDate,
        handoff_time: handoff.handoffTime,
        handoff_datetime: new Date(`${handoff.handoffDate}T${handoff.handoffTime}`).toISOString(),
        outgoing_nurse: handoff.outgoingNurse,
        incoming_nurse: handoff.incomingNurse,
        unit: handoff.unit,
        patients: handingOver.map(toPayload),
      });
      clearDraft(DRAFT_ID);
      setTouched(false);
      setSuccess(t('docShiftHandoff.successMessage'));
      setTimeout(() => returnAfterSave(), 2000);
    } catch (err) {
      setError(t('docShiftHandoff.errorSaveFailed'));
      console.error('Failed to save shift handoff', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const field = 'w-full rounded-lg border border-border-interactive bg-surface p-2 text-sm text-content';

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-content">{t('docShiftHandoff.title')}</h1>
          <p className="text-sm text-content-secondary">
            {[t(`docShiftHandoff.unit_${UNIT_KEYS[handoff.unit]}`), shiftTypes[handoff.shiftType]?.label, user?.username].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div role="tablist" aria-label={t('docShiftHandoff.title')} className="flex gap-1 rounded-lg bg-surface-sunken p-1">
          {(['handoff', 'history'] as const).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-md px-3 text-sm font-semibold text-content-secondary aria-selected:bg-surface aria-selected:text-content aria-selected:shadow">
              {tab === 'handoff' ? <FileText className="h-4 w-4" aria-hidden="true" /> : <History className="h-4 w-4" aria-hidden="true" />}
              {t(tab === 'handoff' ? 'docShiftHandoff.tabCreateHandoff' : 'docShiftHandoff.tabHandoffHistory')}
            </button>
          ))}
        </div>
      </header>

      {success && (
        <div className="flex items-center rounded-lg border border-ok bg-ok-subtle p-3 text-ok-subtle-fg">
          <CheckCircle2 className="mr-2 h-5 w-5" aria-hidden="true" />
          {success}
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center rounded-lg border border-critical bg-critical-subtle p-3 text-critical-subtle-fg">
          <AlertTriangle className="mr-2 h-5 w-5" aria-hidden="true" />
          {error}
        </div>
      )}

      {activeTab === 'handoff' && (
        <form onSubmit={(event) => { event.preventDefault(); void handleSave(); }} onKeyDown={keepEnterInField} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <StaffSelect
                id="handoff-incoming-nurse"
                label={t('docShiftHandoff.incomingNurseLabel')}
                roleFilter="Nurse"
                value={handoff.incomingNurse}
                onChange={(id) => { clearField('incomingNurse'); setTouched(true); setHandoff({ ...handoff, incomingNurse: id }); }}
                placeholder={t('docShiftHandoff.incomingNursePlaceholder')}
                required
              />
              {errors.incomingNurse && <p role="alert" className="mt-1 text-sm text-critical">{errors.incomingNurse}</p>}
            </div>
            <div>
              <label htmlFor="handoff-shift-type" className="block text-xs font-medium text-content-secondary">{t('docShiftHandoff.shiftTypeLabel')}</label>
              <select id="handoff-shift-type" value={handoff.shiftType} className={field}
                onChange={(e) => setHandoff({ ...handoff, shiftType: e.target.value as ShiftType })}>
                {Object.entries(shiftTypes).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="handoff-unit" className="block text-xs font-medium text-content-secondary">{t('docShiftHandoff.unitLabel')}</label>
              <select id="handoff-unit" value={handoff.unit} className={field} onChange={(e) => setHandoff({ ...handoff, unit: e.target.value })}>
                {units.map((u) => <option key={u} value={u}>{t(`docShiftHandoff.unit_${UNIT_KEYS[u]}`)}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="handoff-date" className="block text-xs font-medium text-content-secondary">{t('docShiftHandoff.dateLabel')}</label>
                <input id="handoff-date" type="date" value={handoff.handoffDate} className={field}
                  onChange={(e) => setHandoff({ ...handoff, handoffDate: e.target.value })} />
              </div>
              <div>
                <label htmlFor="handoff-time" className="block text-xs font-medium text-content-secondary">{t('docShiftHandoff.timeLabel')}</label>
                <input id="handoff-time" type="time" value={handoff.handoffTime} className={field}
                  onChange={(e) => setHandoff({ ...handoff, handoffTime: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
              {draftState === 'loading' && <p className="text-sm text-content-muted">{t('docShiftHandoff.loadingShift')}</p>}
              {draftState === 'failed' && (
                <div role="alert" className="rounded-lg bg-critical-subtle p-3 text-sm text-critical-subtle-fg">
                  <p>{draftError}</p>
                  <button type="button" onClick={loadDraft} className="mt-2 font-semibold underline">{t('docShiftHandoff.retryShift')}</button>
                </div>
              )}
              {draftState === 'loaded' && patients.length === 0 && <p className="text-sm text-content-muted">{t('handoffDraft.none')}</p>}
              <HandoffPatientList
                patients={patients}
                selected={selected}
                openId={openId}
                onToggle={toggleSelected}
                onSelectAll={() => { setTouched(true); setSelected(new Set(patients.map((p) => p.patientId))); }}
                onOpen={openPatient}
                onAddPatient={() => setShowAddPatient(true)}
              />
              {showAddPatient && (
                <div className="space-y-3 border-t border-border pt-3">
                  {/* Searched on the server: the list this replaced held only
                      the first 50 patients. Adding one twice is refused. */}
                  <PatientSelect
                    id="handoff-add-patient"
                    label={t('docShiftHandoff.searchPatientsPlaceholder')}
                    value={selectedPatientId ?? ''}
                    onChange={(patientId, patient) => {
                      setSelectedPatientId(patientId || null);
                      setSelectedPatientEntry(patient ?? null);
                    }}
                  />
                  {selectedPatientId && (
                    <>
                      <div>
                        <label htmlFor="handoff-new-patient-room" className="block text-xs font-medium text-content-secondary">{t('docShiftHandoff.roomLabel')}</label>
                        <input id="handoff-new-patient-room" type="text" value={newPatient.room} className={field}
                          onChange={(e) => setNewPatient({ ...newPatient, room: e.target.value })} placeholder={t('docShiftHandoff.roomPlaceholder')} />
                      </div>
                      <div>
                        <label htmlFor="handoff-new-patient-diagnosis" className="block text-xs font-medium text-content-secondary">{t('docShiftHandoff.diagnosisLabel')}</label>
                        <input id="handoff-new-patient-diagnosis" type="text" value={newPatient.diagnosis} className={field}
                          onChange={(e) => setNewPatient({ ...newPatient, diagnosis: e.target.value })} placeholder={t('docShiftHandoff.diagnosisPlaceholder')} />
                      </div>
                      <ChoiceChips<Priority>
                        id="handoff-new-patient-priority"
                        label={t('docShiftHandoff.priorityLabel')}
                        value={newPatient.priority}
                        onChange={(priority) => priority && setNewPatient({ ...newPatient, priority })}
                        options={[
                          { value: 'routine', label: t('docShiftHandoff.priority_routine') },
                          { value: 'urgent', label: t('docShiftHandoff.priority_urgent') },
                          { value: 'critical', label: t('docShiftHandoff.priority_critical') },
                        ]}
                      />
                    </>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { if (selectedPatientEntry) addPatientToHandoff(selectedPatientEntry); }}
                      aria-disabled={!selectedPatientEntry || undefined}
                      className="min-h-[40px] flex-1 rounded-lg bg-brand px-3 text-sm font-semibold text-brand-fg hover:bg-brand-hover">
                      {t('docShiftHandoff.addToHandoffButton')}
                    </button>
                    <button type="button" onClick={() => setShowAddPatient(false)}
                      className="min-h-[40px] rounded-lg border border-border-interactive px-3 text-sm font-semibold text-content">
                      {t('docShiftHandoff.cancelAdd')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-surface p-4">
              {open ? (
                <HandoffPatientEditor patient={open} onChange={(updates) => edit(open.patientId, updates)} />
              ) : (
                <p className="text-sm text-content-muted">{t('docShiftHandoff.noPatientsDesc')}</p>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow">
            <p className="mr-auto text-sm text-content-muted" aria-live="polite">
              {allReviewed ? t('docShiftHandoff.allReviewed') : touched ? t('docShiftHandoff.draftKept') : ''}
            </p>
            {open && (
              <button type="button" onClick={nextPatient}
                className="min-h-[44px] rounded-lg border border-border-interactive px-4 font-semibold text-content hover:bg-surface-sunken">
                {t('docShiftHandoff.nextPatient')}
              </button>
            )}
            <button type="submit" aria-disabled={isSubmitting || undefined}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-brand px-4 font-semibold text-brand-fg hover:bg-brand-hover aria-disabled:cursor-wait">
              {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              {isSubmitting ? t('docShiftHandoff.submitting') : (handingOver.length === 1 ? t('docShiftHandoff.handOverOne') : t('docShiftHandoff.handOverN', { n: handingOver.length }))}
            </button>
          </div>
        </form>
      )}

        {activeTab === 'history' && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-4 flex items-center text-lg font-bold text-content">
              <History className="mr-2 h-5 w-5" aria-hidden="true" />
              {t('docShiftHandoff.handoffHistoryTitle')}
            </h2>
            {historyError && <div role="alert" className="mb-4 rounded-lg border border-critical bg-critical-subtle p-4 text-critical-subtle-fg">
              <p>{historyError}</p>
              <button type="button" onClick={() => setHistoryAttempt(attempt => attempt + 1)} className="mt-2 rounded-lg border border-current px-3 py-2 font-semibold focus-visible:outline focus-visible:outline-2">{t('docShiftHandoff.retryHistory')}</button>
            </div>}
            {receiptError && <p role="alert" className="mb-4 rounded-lg border border-critical bg-critical-subtle p-4 text-critical-subtle-fg">{receiptError}</p>}
            {historyLoading ? (
              <div className="text-center py-8 text-content-muted">{t('docShiftHandoff.loadingHistory')}</div>
            ) : handoffHistory.length === 0 && !historyError ? (
              <div className="text-center py-12 text-content-muted">
                <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>{t('docShiftHandoff.noHistoryAvailable')}</p>
                <p className="text-sm mt-1">{t('docShiftHandoff.noHistoryHint')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {handoffHistory.map(h => (
                  <div key={h.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold">{h.data?.shift_direction ? shiftTypes[h.data.shift_direction]?.label ?? h.data.shift_direction : 'Shift handoff'}</p>
                        <p className="text-sm text-content-muted">
                          {formatTimestamp(h.handoff_datetime)} · {h.location_from || 'Unit not recorded'}
                        </p>
                        <p className="text-sm">
                          <StaffName id={h.outgoing_provider_id} /> → <StaffName id={h.incoming_provider_id} />
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded text-sm ${
                        h.acknowledged_by_incoming ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'
                      }`}>
                        {t(`docShiftHandoff.status_${h.acknowledged_by_incoming ? 'acknowledged' : 'pending'}`)}
                      </span>
                    </div>
                    <p className="text-sm text-content-muted mt-2">{h.data?.patient?.patientName || h.data?.patient?.patient_name || h.patient_id} · {h.code_status || 'Not recorded'}</p>
                    {h.acknowledged_at && <p className="mt-2 text-sm">{t('docShiftHandoff.receiptAcknowledged', { time: formatTimestamp(h.acknowledged_at) })}</p>}
                    {h.incoming_provider_id === user?.userId && !h.acknowledged_by_incoming && <div className="mt-3">
                      <p className="text-sm text-content-muted">{t('docShiftHandoff.receiptExplanation')}</p>
                      <button type="button" disabled={receiptPending !== null || historyLoading} onClick={() => acknowledgeReceipt(h.id)} className="mt-2 rounded-lg border border-border-interactive px-3 py-2 font-semibold focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
                        {t(receiptPending === h.id ? 'docShiftHandoff.acknowledgingReceipt' : 'docShiftHandoff.acknowledgeReceipt')}
                      </button>
                    </div>}
                    <details className="mt-3">
                      <summary className="cursor-pointer">View saved SBAR</summary>
                      <dl className="mt-2 space-y-2">
                        {(['situation', 'background', 'assessment', 'recommendation'] as const).map(field => (
                          <div key={field}><dt className="font-semibold capitalize">{field}</dt><dd className="whitespace-pre-wrap">{h[field] || 'Not recorded'}</dd></div>
                        ))}
                        {(['room', 'diagnosis', 'priority', 'ivAccess', 'diet', 'activity', 'pendingLabs', 'pendingTests', 'pendingOrders', 'familyUpdates', 'additionalNotes'] as const).map(field => (
                          <div key={field}><dt className="font-semibold">{t(`docShiftHandoff.${field}Label`)}</dt><dd className="whitespace-pre-wrap">{h.data?.patient?.[field] || t('docNursing.notRecorded')}</dd></div>
                        ))}
                        {(['scheduled', 'prn', 'drips'] as const).map(field => (
                          <div key={field}><dt className="font-semibold">{t(`docShiftHandoff.${field}Label`)}</dt><dd className="whitespace-pre-wrap">{h.data?.patient?.medications?.[field] || t('docNursing.notRecorded')}</dd></div>
                        ))}
                        <div><dt className="font-semibold">{t('docShiftHandoff.safetyRisksTitle')}</dt><dd>{h.data?.patient?.safetyRisks?.length ? h.data.patient.safetyRisks.join(', ') : t('docNursing.notRecorded')}</dd></div>
                        <div><dt className="font-semibold">{t('docShiftHandoff.isolationLabel')}</dt><dd>{h.data?.patient?.isolation || t('docNursing.notRecorded')}</dd></div>
                        <div><dt className="font-semibold">{t('docShiftHandoff.stabilityLabel')}</dt><dd>{h.data?.patient?.stability ? t(`docShiftHandoff.stability_${h.data.patient.stability}`) : t('docNursing.notRecorded')}</dd></div>
                        <div><dt className="font-semibold">{t('docShiftHandoff.todosLabel')}</dt><dd>{h.data?.patient?.todos?.length ? <ul className="list-disc pl-5">{h.data.patient.todos.map((todo, i) => <li key={i}>{todo}</li>)}</ul> : t('docNursing.notRecorded')}</dd></div>
                      </dl>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
