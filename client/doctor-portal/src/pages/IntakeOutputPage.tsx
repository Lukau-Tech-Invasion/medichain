import RecordPrintPreview from '../components/RecordPrintPreview';
import React, { useState, useEffect } from 'react';
import {
  Droplets,
  Search,
  Plus,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  ArrowDown,
  ArrowUp,
  Download,
  Printer,
  Loader2,
  AlertCircle
} from 'lucide-react';
import PatientSelect from '../components/PatientSelect';
import {
  createIntakeOutput,
  listIntakeOutput,
  useTranslation,
  clickable,
  useScoringCatalog,
  fluidBalanceBand,
  Input,
  useValidatedForm,
  intakeOutputSchema,
  getPatients, ModalPanel, submitOnce, useSubmission, ChoiceChips,
  useDraftFields,
  draftFieldsOf,
} from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';

/**
 * IntakeOutputPage
 * 
 * Page for tracking patient fluid intake and output (I&O).
 * Implements I&O chart, add entry form, and critical value alerts.
 */

type IntakeType = 'oral' | 'iv' | 'tube-feeding' | 'blood-products' | 'other-intake';
type OutputType = 'urine' | 'stool' | 'emesis' | 'drainage' | 'blood-loss' | 'other-output';

interface IOEntry {
  id: string;
  patientId: string;
  timestamp: Date;
  type: 'intake' | 'output';
  category: IntakeType | OutputType;
  amount: number | null;
  unit: 'ml' | 'cc' | 'oz';
  source?: string;
  notes?: string;
  recordedBy: string;
}

interface PatientIO {
  patientId: string;
  patientName: string;
  mrn: string;
  room: string;
  entries: IOEntry[];
  totalIntake24h: number | null;
  totalOutput24h: number | null;
  netBalance: number | null;
  alerts: string[];
}

/** Build the exact trend table the clinician sees; CSV values are quoted. */
export const intakeOutputTrendCsv = (date: string, rows: PatientIO[]) => {
  const quote = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [
    ['Date', 'Patient', 'Patient ID', 'Room', 'Intake (mL)', 'Output (mL)', 'Balance (mL)'],
    ...rows.map(row => [date, row.patientName, row.patientId, row.room, row.totalIntake24h, row.totalOutput24h, row.netBalance]),
  ].map(row => row.map(quote).join(',')).join('\r\n');
};

/** One stored intake/output record, as the API returns it. */
interface IoRecordRow {
  id: string;
  patient_id: string;
  record_date: string;
  shift: string;
  total_intake: number | null;
  total_output: number | null;
  net_balance: number | null;
  intake_items: Array<{ category?: string; amount_ml?: number; recorded_at?: string; notes?: string; source?: string; recorded_by?: string }> | null;
  output_items: Array<{ category?: string; amount_ml?: number; recorded_at?: string; notes?: string; source?: string; recorded_by?: string }> | null;
}

/** Fold a patient's stored fluid records into the shape the ward list renders. */
export function toPatientIO(
  person: { patient_id: string; full_name: string },
  rows: IoRecordRow[],
  window = { start: Date.now() - 24 * 60 * 60 * 1000, end: Date.now() }
): PatientIO {
  const mine = rows.filter(r => r.patient_id === person.patient_id);
  const entries: IOEntry[] = mine.flatMap(r =>
    [
      ...(r.intake_items || []).map(item => ({ item, type: 'intake' as const })),
      ...(r.output_items || []).map(item => ({ item, type: 'output' as const })),
    ].map(({ item, type }, index) => ({
      id: `${r.id}-${type}-${index}`,
      type,
      // Categories are stored as "intake:oral" so the two directions cannot be
      // confused when totals are recomputed; show just the category.
      category: (item.category || '').split(':').pop() || '',
      amount: typeof item.amount_ml === 'number' && Number.isFinite(item.amount_ml) ? item.amount_ml : null,
      unit: 'ml',
      source: item.source || '',
      notes: item.notes || '',
      timestamp: new Date(item.recorded_at || r.record_date),
      recordedBy: item.recorded_by || '',
    })) as IOEntry[]
  ).filter(entry => entry.timestamp.getTime() >= window.start && entry.timestamp.getTime() < window.end);
  const sum = (type: IOEntry['type']): number | null => !entries.length ? null : entries
    .filter(entry => entry.type === type).reduce<number | null>((total, entry) =>
      total === null || entry.amount === null ? null : total + entry.amount, 0);
  const totalIntake24h = sum('intake');
  const totalOutput24h = sum('output');
  return {
    patientId: person.patient_id,
    patientName: person.full_name,
    mrn: person.patient_id,
    room: '',
    entries,
    totalIntake24h,
    totalOutput24h,
    netBalance: totalIntake24h === null || totalOutput24h === null ? null : totalIntake24h - totalOutput24h,
    alerts: [],
  };
}


const IntakeOutputPage: React.FC = () => {
  const [printRecord, setPrintRecord] = useState<unknown>(null);
  const { t } = useTranslation();
  const submission = useSubmission('intake-output');
  const { catalog } = useScoringCatalog();
  const [activeTab, setActiveTab] = useState<'patients' | 'entry' | 'trends'>('patients');
  const [patients, setPatients] = useState<PatientIO[]>([]);
  const [storedRows, setStoredRows] = useState<IoRecordRow[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientIO | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [entryType, setEntryType] = useState<'intake' | 'output'>('intake');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  // Calendar-day trends use local midnight; bedside cards use the last 24 hours.
  const dayStart = new Date(`${selectedDate}T00:00:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const trendPatients = patients.map(person => toPatientIO({
    patient_id: person.patientId, full_name: person.patientName,
  }, storedRows, { start: dayStart.getTime(), end: dayEnd.getTime() }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();

  const [newEntry, setNewEntry] = useState({
    type: 'intake' as 'intake' | 'output',
    category: 'oral' as IntakeType | OutputType,
    amount: 0,
    unit: 'ml' as 'ml' | 'cc' | 'oz',
    source: '',
    notes: ''
  });
  // Kept for this tab while unsent; the patient alone is not unsaved work.
  const ioDraft = useDraftFields('intake-output', selectedPatient?.patientId, t('docIntakeOutput.formLabel'),
    draftFieldsOf(newEntry, setNewEntry, ['type', 'category', 'amount', 'unit', 'source', 'notes']));

  const exportTrendCsv = () => {
    const blob = new Blob([intakeOutputTrendCsv(selectedDate, trendPatients)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `intake-output-${selectedDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    let active = true;
    const fetchIntakeOutput = async () => {
      if (!user?.userId) {
        setLoading(false);
        return;
      }
      
      setLoading(true);
      setError(null);
      try {
        // The ward list is the patient roster with each patient's fluid record
        // folded in — not the raw io_records rows, which carry no patient name
        // and left every card rendering the untranslated `{{mrn}}` placeholder.
        const [roster, records] = await Promise.all([
          getPatients({ limit: 100 }),
          listIntakeOutput(),
        ]);

        if (!Array.isArray(records)) throw new Error('Invalid I/O response');
        const rows = records as unknown as IoRecordRow[];
        if (!active) return;
        setStoredRows(rows);
        setPatients(roster.map(person => toPatientIO(person, rows)));
      } catch (err) {
        console.error('Failed to fetch I/O records:', err);
        if (active) setError(t('docIntakeOutput.errorLoad'));
      } finally {
        if (active) setLoading(false);
      }
    };
    
    fetchIntakeOutput();
    return () => { active = false; };
  }, [user, t, readAttempt]);

  const getIntakeCategories = (): IntakeType[] => ['oral', 'iv', 'tube-feeding', 'blood-products', 'other-intake'];
  const getOutputCategories = (): OutputType[] => ['urine', 'stool', 'emesis', 'drainage', 'blood-loss', 'other-output'];

  const getCategoryLabel = (cat: IntakeType | OutputType): string => {
    const labels: Record<string, string> = {
      'oral': t('docIntakeOutput.category_oral'),
      'iv': t('docIntakeOutput.category_iv'),
      'tube-feeding': t('docIntakeOutput.category_tube-feeding'),
      'blood-products': t('docIntakeOutput.category_blood-products'),
      'other-intake': t('docIntakeOutput.category_other-intake'),
      'urine': t('docIntakeOutput.category_urine'),
      'stool': t('docIntakeOutput.category_stool'),
      'emesis': t('docIntakeOutput.category_emesis'),
      'drainage': t('docIntakeOutput.category_drainage'),
      'blood-loss': t('docIntakeOutput.category_blood-loss'),
      'other-output': t('docIntakeOutput.category_other-output')
    };
    return labels[cat] || cat;
  };

  const getCategoryColor = (cat: IntakeType | OutputType): string => {
    const colors: Record<string, string> = {
      'oral': 'bg-notice-subtle text-notice-subtle-fg',
      'iv': 'bg-surface-sunken text-content-secondary',
      'tube-feeding': 'bg-surface-sunken text-content-secondary',
      'blood-products': 'bg-critical-subtle text-critical-subtle-fg',
      'urine': 'bg-caution-subtle text-caution-subtle-fg',
      'stool': 'bg-caution-subtle text-caution-subtle-fg',
      'emesis': 'bg-surface-sunken text-content-secondary',
      'drainage': 'bg-ok-subtle text-ok-subtle-fg',
      'blood-loss': 'bg-critical-subtle text-critical-subtle-fg'
    };
    return colors[cat] || 'bg-surface-sunken text-content-secondary';
  };

  // The band comes from `GET /api/clinical/scoring/catalog`, not from literals
  // here. `> 1000`, `> 500` and `< -500` are ward policy — a patient running a
  // litre positive is a patient being fluid-overloaded — and policy in a
  // component cannot be changed without a front-end deploy.
  //
  // `surface` travels with `color` because the two have to name the same band.
  // The cards used to pick their background from their own `> 500` / `< -500`
  // literals while the text came from the catalog — a second copy of the ward
  // policy this comment says must not live in a component, and one that
  // disagreed with the first whenever the catalog had not loaded. The visible
  // result was a green "balanced" card carrying grey placeholder text at 3.59:1
  // against it, which is both below WCAG AA and a claim the page had no band to
  // make.
  /** Display absent observations separately from incomplete recorded entries. */
  const displayVolume = (value: number | null, patient: PatientIO) =>
    value ?? t(patient.entries.length ? 'docIntakeOutput.volumeUnknown' : 'docIntakeOutput.noEntriesRecorded');

  const getBalanceStatus = (
    balance: number | null, hasEntries = true
  ): { color: string; surface: string; icon: React.ReactNode; label: string } => {
    if (balance === null) return { color: 'text-content-muted', surface: 'bg-surface-sunken', icon: <AlertCircle className="w-4 h-4" />, label: t(hasEntries ? 'docIntakeOutput.volumeUnknown' : 'docIntakeOutput.noEntriesRecorded') };
    switch (fluidBalanceBand(balance, catalog)) {
      case 'positive_high':
        return { color: 'text-critical-subtle-fg', surface: 'bg-critical-subtle', icon: <TrendingUp className="w-4 h-4" />, label: t('docIntakeOutput.balancePositiveHigh') };
      case 'positive':
        return { color: 'text-caution-subtle-fg', surface: 'bg-caution-subtle', icon: <TrendingUp className="w-4 h-4" />, label: t('docIntakeOutput.balancePositive') };
      case 'negative':
        return { color: 'text-notice-subtle-fg', surface: 'bg-notice-subtle', icon: <TrendingDown className="w-4 h-4" />, label: t('docIntakeOutput.balanceNegative') };
      case 'balanced':
        return { color: 'text-ok-subtle-fg', surface: 'bg-ok-subtle', icon: <CheckCircle className="w-4 h-4" />, label: t('docIntakeOutput.balanceBalanced') };
      default:
        // Catalog not loaded: no band, so no colour, no background and no claim
        // about it. A neutral surface is the honest one — a green card is a
        // statement that this patient's fluid balance is fine.
        return { color: 'text-content-muted', surface: 'bg-surface-sunken', icon: <CheckCircle className="w-4 h-4" />, label: '—' };
    }
  };

  // `patientName`, `mrn` and `room` are all optional in practice — a patient
  // with no assigned room, or a record whose name has not resolved yet, threw
  // `Cannot read properties of undefined (reading 'toLowerCase')` and took the
  // whole page down with an uncaught error rather than just filtering it out.
  const q = searchQuery.toLowerCase();
  const filteredPatients = patients.filter(p =>
    (p.patientName ?? '').toLowerCase().includes(q) ||
    (p.mrn ?? '').includes(searchQuery) ||
    (p.room ?? '').toLowerCase().includes(q)
  );

  const { errors, validate, validateField, clearField } = useValidatedForm(intakeOutputSchema);

  const handleAddEntry = async () => {
    // Selecting a patient is a precondition for the chart, not a field error.
    if (!selectedPatient) {
      showError(t('docIntakeOutput.errorValidAmount'));
      return;
    }
    // The amount was checked as `<= 0` and reported in a toast. It now carries
    // an upper bound too: a stray zero turning 250 into 2500 moves a running
    // fluid balance by two litres, and that total drives resuscitation and
    // diuresis decisions.
    if (!validate(newEntry)) {
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        id: `IO-${Date.now()}`,
        patientId: selectedPatient.patientId,
        timestamp: new Date().toISOString(),
        ...newEntry,
        recordedBy: user?.username || 'Healthcare Provider'
      };

      // One key per submission: a double tap, or a retry after a timeout that
      // had in fact saved, is answered "already saved" instead of writing twice.
      const outcome = await submitOnce(submission, payload, () => createIntakeOutput(payload));
      if (outcome === 'busy') return;
      if (outcome === 'queued') {
        // Kept on this device; the totals cannot include it until it is sent.
        showSuccess(t('forms.queued'));
        ioDraft.markSaved();
        setNewEntry({ type: 'intake', category: 'oral', amount: 0, unit: 'ml', source: '', notes: '' });
        return;
      }
      showSuccess(t('docIntakeOutput.recordedSuccess', { type: t(`docIntakeOutput.typeLabel_${newEntry.type}`) }));
      
      // Reuse the persisted-row mapping used on initial load; raw rows are
      // not patient cards and must not replace names or the selected identity.
      const records = await listIntakeOutput();
      const rows = records as unknown as IoRecordRow[];
      setStoredRows(rows);
      const refreshed = patients.map(person => toPatientIO({
        patient_id: person.patientId, full_name: person.patientName,
      }, rows));
      setPatients(refreshed);
      setSelectedPatient(refreshed.find(person => person.patientId === selectedPatient.patientId) || null);

      ioDraft.markSaved();
      setNewEntry({ type: 'intake', category: 'oral', amount: 0, unit: 'ml', source: '', notes: '' });
    } catch (err) {
      console.error('Error recording I/O:', err);
      showError(t('docIntakeOutput.errorRecord'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      <RecordPrintPreview title="Intake/output summary" record={printRecord} onClose={() => setPrintRecord(null)} />
      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-700 to-teal-800 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Droplets className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docIntakeOutput.title')}</h1>
        </div>
        <p className="text-white">{t('docIntakeOutput.subtitle')}</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-content-secondary animate-spin mb-2" />
          <p className="text-content-muted">{t('docIntakeOutput.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div role="alert" className="m-4 bg-critical-subtle border border-critical rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-critical flex-shrink-0" />
          <div>
            <p className="text-sm text-critical-subtle-fg">{error}</p>
            <button type="button" onClick={() => setReadAttempt(attempt => attempt + 1)} className="mt-2 rounded-lg border border-current px-3 py-2 font-semibold focus-visible:outline focus-visible:outline-2">{t('docIntakeOutput.retryLoad')}</button>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Tabs */}
          <div className="bg-surface border-b">
            <div className="flex">
              {(['patients', 'entry', 'trends'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium capitalize ${
                    activeTab === tab ? 'text-content-secondary border-b-2 border-cyan-700' : 'text-content-muted'
                  }`}
                >
                  {tab === 'entry' ? t('docIntakeOutput.tabEntry') : tab === 'patients' ? t('docIntakeOutput.tabPatients') : t('docIntakeOutput.tabTrends')}
                </button>
              ))}
            </div>
          </div>

          {/* Patients Tab */}
          {activeTab === 'patients' && (
            <div className="p-6">
              <div className="flex gap-4 mb-6">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
                  <input aria-label={t('docIntakeOutput.searchPh')}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('docIntakeOutput.searchPh')}
                    className="w-full pl-10 pr-4 py-2 border rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-4">
                {filteredPatients.map((patient, pIdx) => {
                  const balanceStatus = getBalanceStatus(patient.netBalance, patient.entries.length > 0);
                  return (
                    <div
                      key={patient.patientId ?? `p-${pIdx}`}
                      className="bg-surface rounded-lg shadow border overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                      {...clickable(() => { setSelectedPatient(patient); setDetailOpen(true); })}
                    >
                      <div className="p-6">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="font-semibold text-lg">{patient.patientName}</h3>
                        <p className="text-sm text-content-muted">{t('docIntakeOutput.mrnRoomLine', { mrn: patient.mrn, room: patient.room })}</p>
                      </div>
                      {(patient.alerts ?? []).length > 0 && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-critical-subtle text-critical-subtle-fg rounded-full text-xs">
                          <AlertTriangle className="w-3 h-3" />
                          {t((patient.alerts ?? []).length > 1 ? 'docIntakeOutput.alertPlural' : 'docIntakeOutput.alertSingular', { count: (patient.alerts ?? []).length })}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div className="bg-notice-subtle rounded-lg p-3 text-center">
                        <div className="flex items-center justify-center gap-1 text-notice-subtle-fg mb-1">
                          <ArrowDown className="w-4 h-4" />
                          <span className="text-xs font-medium">{t('docIntakeOutput.intakeLabel')}</span>
                        </div>
                        <p className="text-xl font-bold text-notice-subtle-fg">{displayVolume(patient.totalIntake24h, patient)}</p>
                        <p className="text-xs text-notice-subtle-fg">{t('docIntakeOutput.mlPer24h')}</p>
                      </div>
                      <div className="bg-caution-subtle rounded-lg p-3 text-center">
                        <div className="flex items-center justify-center gap-1 text-caution-subtle-fg mb-1">
                          <ArrowUp className="w-4 h-4" />
                          <span className="text-xs font-medium">{t('docIntakeOutput.outputLabel')}</span>
                        </div>
                        <p className="text-xl font-bold text-caution-subtle-fg">{displayVolume(patient.totalOutput24h, patient)}</p>
                        <p className="text-xs text-caution-subtle-fg">{t('docIntakeOutput.mlPer24h')}</p>
                      </div>
                      <div className={`rounded-lg p-3 text-center ${balanceStatus.surface}`}>
                        <div className={`flex items-center justify-center gap-1 mb-1 ${balanceStatus.color}`}>
                          {balanceStatus.icon}
                          <span className="text-xs font-medium">{t('docIntakeOutput.balanceLabel')}</span>
                        </div>
                        <p className={`text-xl font-bold ${balanceStatus.color}`}>
                          {patient.netBalance !== null && patient.netBalance > 0 ? '+' : ''}{displayVolume(patient.netBalance, patient)}
                        </p>
                        <p className={`text-xs ${balanceStatus.color}`}>{t('docIntakeOutput.mlUnit')}</p>
                      </div>
                    </div>

                    {(patient.alerts ?? []).length > 0 && (
                      <div className="bg-critical-subtle border border-critical rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-critical-subtle-fg flex-shrink-0 mt-0.5" />
                          <div className="text-sm text-critical-subtle-fg">
                            {(patient.alerts ?? []).map((alert, idx) => (
                              <p key={idx}>{alert}</p>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Entry Tab */}
      {activeTab === 'entry' && (
        <div className="p-6">
          <div className="bg-surface rounded-lg shadow p-6 max-w-lg mx-auto">
            <h2 className="text-lg font-semibold mb-4">{t('docIntakeOutput.quickEntryHeading')}</h2>

            <form onSubmit={(event) => { event.preventDefault(); void handleAddEntry(); }} noValidate>
            <div className="space-y-4">
              <div>
                <PatientSelect
                  id="io-patient"
                  label={t('docIntakeOutput.patientRequired')}
                  required
                  value={selectedPatient?.patientId || ''}
                  onChange={(selectedPatientId) => setSelectedPatient(patients.find(p => p.patientId === selectedPatientId) || null)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t('docIntakeOutput.typeRequired')} *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button"
                    onClick={() => { setEntryType('intake'); setNewEntry({ ...newEntry, type: 'intake', category: 'oral' }); }}
                    className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 ${
                      entryType === 'intake' ? 'border-blue-500 bg-notice-subtle text-notice-subtle-fg' : 'border-border'
                    }`}
                  >
                    <ArrowDown className="w-5 h-5" />
                    {t('docIntakeOutput.intakeLabel')}
                  </button>
                  <button type="button"
                    onClick={() => { setEntryType('output'); setNewEntry({ ...newEntry, type: 'output', category: 'urine' }); }}
                    className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 ${
                      entryType === 'output' ? 'border-amber-500 bg-caution-subtle text-caution-subtle-fg' : 'border-border'
                    }`}
                  >
                    <ArrowUp className="w-5 h-5" />
                    {t('docIntakeOutput.outputLabel')}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="io-category" className="block text-sm font-medium mb-1">{t('docIntakeOutput.categoryRequired')} *</label>
                <select
                  id="io-category"
                  value={newEntry.category}
                  onChange={(e) => setNewEntry({ ...newEntry, category: e.target.value as typeof newEntry.category })}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  {(entryType === 'intake' ? getIntakeCategories() : getOutputCategories()).map(cat => (
                    <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input
                  id="io-amount"
                  type="number"
                  label={t('docIntakeOutput.amountRequired')}
                  value={newEntry.amount || ''}
                  onChange={(e) => {
                    clearField('amount');
                    setNewEntry({ ...newEntry, amount: parseInt(e.target.value) || 0 });
                  }}
                  onBlur={() => validateField('amount', newEntry)}
                  error={errors.amount}
                  placeholder="0"
                  required
                />
                <div>
                  <ChoiceChips
                    id="io-unit"
                    label={t('docIntakeOutput.unitLabel')}
                    value={newEntry.unit}
                    onChange={(next) => { if (next === undefined) return; setNewEntry({ ...newEntry, unit: next as typeof newEntry.unit }); }}
                    options={[
                      { value: 'ml', label: 'ml' },
                      { value: 'cc', label: 'cc' },
                      { value: 'oz', label: 'oz' },
                    ]}
                  />
                </div>
              </div>

              {entryType === 'intake' && (
                <div>
                  <label htmlFor="io-source" className="block text-sm font-medium mb-1">{t('docIntakeOutput.sourceLabel')}</label>
                  <input
                    id="io-source"
                    type="text"
                    value={newEntry.source}
                    onChange={(e) => setNewEntry({ ...newEntry, source: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder={t('docIntakeOutput.sourcePh')}
                  />
                </div>
              )}

              <div>
                <label htmlFor="io-notes" className="block text-sm font-medium mb-1">{t('docIntakeOutput.notesLabel')}</label>
                <textarea
                  id="io-notes"
                  value={newEntry.notes}
                  onChange={(e) => setNewEntry({ ...newEntry, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={2}
                  placeholder={t('docIntakeOutput.notesPh')}
                />
              </div>

              <button type="submit"
                aria-disabled={isSubmitting || undefined}
                className={`w-full py-3 text-white rounded-lg font-medium flex items-center justify-center gap-2 ${
                  isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-cyan-700 hover:bg-cyan-800'
                }`}
              >
                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                {t('docIntakeOutput.recordEntryButton')}
              </button>
            </div>
            </form>
          </div>
        </div>
      )}

      {/* Trends Tab */}
      {activeTab === 'trends' && (
        <div className="p-6">
          <div className="bg-surface rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">{t('docIntakeOutput.ioTrendsHeading')}</h2>
              <div className="flex gap-2">
                <input type="date" aria-label="Reporting date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="border rounded-lg px-3 py-2" />
                <button type="button" onClick={exportTrendCsv} aria-label={t('docIntakeOutput.exportTrend')} className="p-2 border rounded-lg hover:bg-surface-sunken"><Download className="w-5 h-5" /></button>
                <button type="button" onClick={() => setPrintRecord({ reportingDate: selectedDate, reportingWindow: 'Local calendar day', patients: trendPatients.map(patient => ({ patientId: patient.patientId, patientName: patient.patientName, room: patient.room, intakeMl: patient.totalIntake24h, outputMl: patient.totalOutput24h, balanceMl: patient.netBalance })) })} aria-label={t('docIntakeOutput.printTrend')} className="p-2 border rounded-lg hover:bg-surface-sunken"><Printer className="w-5 h-5" /></button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-sunken">
                  <tr>
                    <th className="text-left p-3">{t('docIntakeOutput.tablePatient')}</th>
                    <th className="text-left p-3">{t('docIntakeOutput.tableRoom')}</th>
                    <th className="text-right p-3">{t('docIntakeOutput.tableIntakeMl')}</th>
                    <th className="text-right p-3">{t('docIntakeOutput.tableOutputMl')}</th>
                    <th className="text-right p-3">{t('docIntakeOutput.tableBalanceMl')}</th>
                    <th className="text-center p-3">{t('docIntakeOutput.tableStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {trendPatients.map(p => {
                    const status = getBalanceStatus(p.netBalance, p.entries.length > 0);
                    return (
                      <tr key={p.patientId} className="border-b hover:bg-surface-sunken">
                        <td className="p-3 font-medium">{p.patientName}</td>
                        <td className="p-3">{p.room}</td>
                        <td className="p-3 text-right text-notice-subtle-fg">{displayVolume(p.totalIntake24h, p)}</td>
                        <td className="p-3 text-right text-caution-subtle-fg">{displayVolume(p.totalOutput24h, p)}</td>
                        <td className={`p-3 text-right font-semibold ${status.color}`}>
                          {p.netBalance !== null && p.netBalance > 0 ? '+' : ''}{displayVolume(p.netBalance, p)}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex items-center gap-1 ${status.color}`}>
                            {status.icon}
                            <span className="text-xs">{status.label}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Patient Detail Modal */}
      {detailOpen && selectedPatient && (
        <ModalPanel labelledBy="intake-output-dialog-title" onClose={() => setDetailOpen(false)} overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" className="bg-surface rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b p-4 flex items-center justify-between">
              <div>
                <h2 id="intake-output-dialog-title" className="text-xl font-semibold">{selectedPatient.patientName}</h2>
                <p className="text-sm text-content-muted">{t('docIntakeOutput.roomMrnLine', { room: selectedPatient.room, mrn: selectedPatient.mrn })}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setDetailOpen(false)} className="text-content-muted hover:text-content-muted text-2xl">×</button>
              </div>
            </div>

            <div className="p-6">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-notice-subtle rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-notice-subtle-fg">{displayVolume(selectedPatient.totalIntake24h, selectedPatient)}</p>
                  <p className="text-sm text-notice-subtle-fg">{t('docIntakeOutput.totalIntake24h')}</p>
                </div>
                <div className="bg-caution-subtle rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-caution-subtle-fg">{displayVolume(selectedPatient.totalOutput24h, selectedPatient)}</p>
                  <p className="text-sm text-caution-subtle-fg">{t('docIntakeOutput.totalOutput24h')}</p>
                </div>
                {(() => {
                  const detail = getBalanceStatus(selectedPatient.netBalance, selectedPatient.entries.length > 0);
                  return (
                    <div className={`rounded-lg p-4 text-center ${detail.surface}`}>
                      <p className={`text-2xl font-bold ${detail.color}`}>
                        {selectedPatient.netBalance !== null && selectedPatient.netBalance > 0 ? '+' : ''}{displayVolume(selectedPatient.netBalance, selectedPatient)}
                      </p>
                      <p className={`text-sm ${detail.color}`}>{t('docIntakeOutput.netBalanceLabel')}</p>
                    </div>
                  );
                })()}
              </div>

              {/* Entries Table */}
              <h3 className="font-semibold mb-3">{t('docIntakeOutput.todaysEntriesHeading')}</h3>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunken">
                    <tr>
                      <th className="text-left p-3">{t('docIntakeOutput.tableTime')}</th>
                      <th className="text-left p-3">{t('docIntakeOutput.tableType')}</th>
                      <th className="text-left p-3">{t('docIntakeOutput.tableCategory')}</th>
                      <th className="text-right p-3">{t('docIntakeOutput.tableAmount')}</th>
                      <th className="text-left p-3">{t('docIntakeOutput.tableNotes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedPatient.entries ?? []).map(entry => (
                      <tr key={entry.id} className="border-t">
                        <td className="p-3">{entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${entry.type === 'intake' ? 'bg-notice-subtle text-notice-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'}`}>
                            {entry.type === 'intake' ? <ArrowDown className="w-3 h-3 inline mr-1" /> : <ArrowUp className="w-3 h-3 inline mr-1" />}
                            {t(`docIntakeOutput.typeLabel_${entry.type}`)}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-xs ${getCategoryColor(entry.category)}`}>
                            {getCategoryLabel(entry.category)}
                          </span>
                        </td>
                        <td className="p-3 text-right font-medium">{entry.amount ?? t('docIntakeOutput.volumeUnknown')} {entry.amount !== null ? entry.unit : ''}</td>
                        <td className="p-3 text-content-muted">{[entry.source, entry.notes].filter(Boolean).join(' — ') || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </ModalPanel>
      )}
        </>
      )}
    </div>
  );
};

export default IntakeOutputPage;
