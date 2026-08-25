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
import { apiUrl, createIntakeOutput, getApiClient, listIntakeOutput, useTranslation } from '@medichain/shared';
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
  amount: number;
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
  totalIntake24h: number;
  totalOutput24h: number;
  netBalance: number;
  alerts: string[];
}

/** One stored intake/output record, as the API returns it. */
interface IoRecordRow {
  id: string;
  patient_id: string;
  record_date: string;
  shift: string;
  total_intake: number | null;
  total_output: number | null;
  net_balance: number | null;
  intake_items: Array<{ category?: string; amount_ml?: number; recorded_at?: string }> | null;
  output_items: Array<{ category?: string; amount_ml?: number; recorded_at?: string }> | null;
}

/** Fold a patient's stored fluid records into the shape the ward list renders. */
function toPatientIO(
  person: { patient_id: string; full_name: string },
  rows: IoRecordRow[]
): PatientIO {
  const mine = rows.filter(r => r.patient_id === person.patient_id);
  const sum = (pick: (r: IoRecordRow) => number | null) =>
    mine.reduce((total, r) => total + (pick(r) || 0), 0);
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
      amount: item.amount_ml || 0,
      unit: 'ml',
      source: '',
      notes: '',
      timestamp: new Date(item.recorded_at || r.record_date || Date.now()),
      recordedBy: '',
    })) as IOEntry[]
  );
  const totalIntake24h = sum(r => r.total_intake);
  const totalOutput24h = sum(r => r.total_output);
  return {
    patientId: person.patient_id,
    patientName: person.full_name,
    mrn: person.patient_id,
    room: '',
    entries,
    totalIntake24h,
    totalOutput24h,
    netBalance: totalIntake24h - totalOutput24h,
    alerts: [],
  };
}

const IntakeOutputPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'patients' | 'entry' | 'trends'>('patients');
  const [patients, setPatients] = useState<PatientIO[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientIO | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [_showEntryModal, setShowEntryModal] = useState(false);
  const [entryType, setEntryType] = useState<'intake' | 'output'>('intake');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();

  const [newEntry, setNewEntry] = useState({
    type: 'intake' as 'intake' | 'output',
    category: 'oral' as IntakeType | OutputType,
    amount: 0,
    unit: 'ml' as 'ml' | 'cc' | 'oz',
    source: '',
    notes: ''
  });

  useEffect(() => {
    const fetchIntakeOutput = async () => {
      if (!user?.walletAddress) {
        setLoading(false);
        return;
      }
      
      try {
        // The ward list is the patient roster with each patient's fluid record
        // folded in — not the raw io_records rows, which carry no patient name
        // and left every card rendering the untranslated `{{mrn}}` placeholder.
        const [rosterResponse, records] = await Promise.all([
          fetch(apiUrl('/api/patients?limit=100'), {
            headers: { 'Content-Type': 'application/json', ...getApiClient().getSessionHeaders(user.walletAddress) },
          }).then(r => (r.ok ? r.json() : { data: [] })),
          listIntakeOutput().catch(() => []),
        ]);

        const rows = (Array.isArray(records) ? records : []) as unknown as IoRecordRow[];
        const roster = (rosterResponse.data || []) as Array<{ patient_id: string; full_name: string }>;
        setPatients(roster.map(person => toPatientIO(person, rows)));
      } catch (err) {
        console.error('Failed to fetch I/O records:', err);
        setError(t('docIntakeOutput.errorLoad'));
      } finally {
        setLoading(false);
      }
    };
    
    fetchIntakeOutput();
  }, [user]);

  // Fetch detailed I/O for selected patient/date
  useEffect(() => {
    if (!selectedPatient || !user?.walletAddress) return;
    const fetchDetailedIO = async () => {
      const shift = 'day'; // Default shift
      try {
        // Route is `/api/emergency/io/{patient_id}/{type}/{timestamp}` — there is
        // no `/api/clinical/io/...`, so this 404'd. The handler reads the 1st and
        // 3rd segments (`IO-{patient_id}-{date}`) and ignores the middle, so the
        // shift goes in the middle slot and the date must be last — sending
        // (patient, date, shift) put the shift where the date belongs.
        const response = await fetch(apiUrl(`/api/emergency/io/${selectedPatient.patientId}/${shift}/${selectedDate}`), {
          headers: {
            ...getApiClient().getSessionHeaders(user.walletAddress),
            'X-Provider-Role': user.role || 'Doctor',
          },
        });
        if (response.ok) {
          const data = await response.json();
          if (data && (data.entries || data.intake || data.output)) {
            // Update the selected patient's entries with fresh data
            const rawEntries = Array.isArray(data.entries)
              ? data.entries
              : [
                  ...(Array.isArray(data.intake) ? data.intake : []),
                  ...(Array.isArray(data.output) ? data.output : []),
                ];
            const entries: IOEntry[] = rawEntries.map((e: IOEntry & { timestamp?: string; recorded_at?: string }) => ({
              ...e,
              timestamp: new Date(e.timestamp || e.recorded_at || Date.now())
            }));
            setSelectedPatient(prev => prev ? { ...prev, entries } : null);
          }
        }
      } catch (err) {
        console.error('Failed to fetch I/O detail:', err);
      }
    };
    fetchDetailedIO();
  }, [selectedPatient?.patientId, selectedDate, user]);

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

  const getBalanceStatus = (balance: number): { color: string; icon: React.ReactNode; label: string } => {
    if (balance > 1000) return { color: 'text-critical-subtle-fg', icon: <TrendingUp className="w-4 h-4" />, label: t('docIntakeOutput.balancePositiveHigh') };
    if (balance > 500) return { color: 'text-caution-subtle-fg', icon: <TrendingUp className="w-4 h-4" />, label: t('docIntakeOutput.balancePositive') };
    if (balance < -500) return { color: 'text-notice-subtle-fg', icon: <TrendingDown className="w-4 h-4" />, label: t('docIntakeOutput.balanceNegative') };
    return { color: 'text-ok-subtle-fg', icon: <CheckCircle className="w-4 h-4" />, label: t('docIntakeOutput.balanceBalanced') };
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

  const handleAddEntry = async () => {
    if (!selectedPatient || newEntry.amount <= 0) {
      showWarning(t('docIntakeOutput.warningValidAmount'));
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

      await createIntakeOutput(payload);
      showSuccess(t('docIntakeOutput.recordedSuccess', { type: t(`docIntakeOutput.typeLabel_${newEntry.type}`) }));
      
      // Refresh list
      const data = await listIntakeOutput();
      if (Array.isArray(data)) {
        setPatients(data.map((p: any) => ({
          ...p,
          entries: (p.entries || []).map((e: any) => ({
            ...e,
            timestamp: new Date(e.timestamp || e.recorded_at || Date.now())
          }))
        })));
        
        // Update selected patient too
        const updatedSelected = (data as unknown as NonNullable<typeof selectedPatient>[]).find(p => p.patientId === selectedPatient.patientId);
        if (updatedSelected) {
          setSelectedPatient({
            ...updatedSelected,
            entries: (updatedSelected.entries || []).map((e: any) => ({
              ...e,
              timestamp: new Date(e.timestamp || e.recorded_at || Date.now())
            }))
          });
        }
      }

      setShowEntryModal(false);
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
      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-600 to-teal-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Droplets className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docIntakeOutput.title')}</h1>
        </div>
        <p className="text-cyan-100">{t('docIntakeOutput.subtitle')}</p>
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
        <div className="m-4 bg-critical-subtle border border-critical rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-critical-subtle-fg">{error}</p>
            <p className="text-xs text-red-500 mt-1">{t('docIntakeOutput.apiCheckMessage')}</p>
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
                  <input
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
                  const balanceStatus = getBalanceStatus(patient.netBalance);
                  return (
                    <div
                      key={patient.patientId ?? `p-${pIdx}`}
                      className="bg-surface rounded-lg shadow border overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => setSelectedPatient(patient)}
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
                        <p className="text-xl font-bold text-notice-subtle-fg">{patient.totalIntake24h}</p>
                        <p className="text-xs text-blue-500">{t('docIntakeOutput.mlPer24h')}</p>
                      </div>
                      <div className="bg-caution-subtle rounded-lg p-3 text-center">
                        <div className="flex items-center justify-center gap-1 text-caution-subtle-fg mb-1">
                          <ArrowUp className="w-4 h-4" />
                          <span className="text-xs font-medium">{t('docIntakeOutput.outputLabel')}</span>
                        </div>
                        <p className="text-xl font-bold text-caution-subtle-fg">{patient.totalOutput24h}</p>
                        <p className="text-xs text-amber-500">{t('docIntakeOutput.mlPer24h')}</p>
                      </div>
                      <div className={`rounded-lg p-3 text-center ${patient.netBalance > 500 ? 'bg-critical-subtle' : patient.netBalance < -500 ? 'bg-notice-subtle' : 'bg-ok-subtle'}`}>
                        <div className={`flex items-center justify-center gap-1 mb-1 ${balanceStatus.color}`}>
                          {balanceStatus.icon}
                          <span className="text-xs font-medium">{t('docIntakeOutput.balanceLabel')}</span>
                        </div>
                        <p className={`text-xl font-bold ${balanceStatus.color}`}>
                          {patient.netBalance > 0 ? '+' : ''}{patient.netBalance}
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

            <div className="space-y-4">
              <div>
                <label htmlFor="io-patient" className="block text-sm font-medium mb-1">{t('docIntakeOutput.patientRequired')} *</label>
                <select id="io-patient" className="w-full border rounded-lg px-3 py-2"
                  value={selectedPatient?.patientId || ''}
                  onChange={(e) => setSelectedPatient(patients.find(p => p.patientId === e.target.value) || null)}>
                  <option value="">{t('docIntakeOutput.selectPatientPh')}</option>
                  {patients.map(p => (
                    <option key={p.patientId} value={p.patientId}>{p.patientName} - {p.patientId}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t('docIntakeOutput.typeRequired')} *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setEntryType('intake'); setNewEntry({ ...newEntry, type: 'intake', category: 'oral' }); }}
                    className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 ${
                      entryType === 'intake' ? 'border-blue-500 bg-notice-subtle text-notice-subtle-fg' : 'border-border'
                    }`}
                  >
                    <ArrowDown className="w-5 h-5" />
                    {t('docIntakeOutput.intakeLabel')}
                  </button>
                  <button
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
                <div>
                  <label htmlFor="io-amount" className="block text-sm font-medium mb-1">{t('docIntakeOutput.amountRequired')} *</label>
                  <input
                    id="io-amount"
                    type="number"
                    value={newEntry.amount || ''}
                    onChange={(e) => setNewEntry({ ...newEntry, amount: parseInt(e.target.value) || 0 })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label htmlFor="io-unit" className="block text-sm font-medium mb-1">{t('docIntakeOutput.unitLabel')}</label>
                  <select
                    id="io-unit"
                    value={newEntry.unit}
                    onChange={(e) => setNewEntry({ ...newEntry, unit: e.target.value as typeof newEntry.unit })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="ml">ml</option>
                    <option value="cc">cc</option>
                    <option value="oz">oz</option>
                  </select>
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

              <button
                onClick={handleAddEntry}
                disabled={isSubmitting}
                className={`w-full py-3 text-white rounded-lg font-medium flex items-center justify-center gap-2 ${
                  isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-cyan-600 hover:bg-cyan-700'
                }`}
              >
                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                {t('docIntakeOutput.recordEntryButton')}
              </button>
            </div>
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
                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="border rounded-lg px-3 py-2" />
                <button className="p-2 border rounded-lg hover:bg-surface-sunken"><Download className="w-5 h-5" /></button>
                <button className="p-2 border rounded-lg hover:bg-surface-sunken"><Printer className="w-5 h-5" /></button>
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
                  {patients.map(p => {
                    const status = getBalanceStatus(p.netBalance);
                    return (
                      <tr key={p.patientId} className="border-b hover:bg-surface-sunken">
                        <td className="p-3 font-medium">{p.patientName}</td>
                        <td className="p-3">{p.room}</td>
                        <td className="p-3 text-right text-notice-subtle-fg">{p.totalIntake24h}</td>
                        <td className="p-3 text-right text-caution-subtle-fg">{p.totalOutput24h}</td>
                        <td className={`p-3 text-right font-semibold ${status.color}`}>
                          {p.netBalance > 0 ? '+' : ''}{p.netBalance}
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
      {selectedPatient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{selectedPatient.patientName}</h2>
                <p className="text-sm text-content-muted">{t('docIntakeOutput.roomMrnLine', { room: selectedPatient.room, mrn: selectedPatient.mrn })}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowEntryModal(true); }}
                  className="px-3 py-1.5 bg-cyan-600 text-white rounded-lg text-sm font-medium flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" /> {t('docIntakeOutput.addEntryButton')}
                </button>
                <button onClick={() => setSelectedPatient(null)} className="text-content-muted hover:text-content-muted text-2xl">×</button>
              </div>
            </div>

            <div className="p-6">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-notice-subtle rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-notice-subtle-fg">{selectedPatient.totalIntake24h}</p>
                  <p className="text-sm text-notice-subtle-fg">{t('docIntakeOutput.totalIntake24h')}</p>
                </div>
                <div className="bg-caution-subtle rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-caution-subtle-fg">{selectedPatient.totalOutput24h}</p>
                  <p className="text-sm text-caution-subtle-fg">{t('docIntakeOutput.totalOutput24h')}</p>
                </div>
                <div className={`rounded-lg p-4 text-center ${selectedPatient.netBalance > 500 ? 'bg-critical-subtle' : 'bg-ok-subtle'}`}>
                  <p className={`text-2xl font-bold ${selectedPatient.netBalance > 500 ? 'text-critical-subtle-fg' : 'text-ok-subtle-fg'}`}>
                    {selectedPatient.netBalance > 0 ? '+' : ''}{selectedPatient.netBalance}
                  </p>
                  <p className={`text-sm ${selectedPatient.netBalance > 500 ? 'text-critical-subtle-fg' : 'text-ok-subtle-fg'}`}>{t('docIntakeOutput.netBalanceLabel')}</p>
                </div>
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
                        <td className="p-3 text-right font-medium">{entry.amount} {entry.unit}</td>
                        <td className="p-3 text-content-muted">{entry.source || entry.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default IntakeOutputPage;
