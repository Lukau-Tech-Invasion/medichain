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
import { apiUrl } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';

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

const IntakeOutputPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'patients' | 'entry' | 'trends'>('patients');
  const [patients, setPatients] = useState<PatientIO[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientIO | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [_showEntryModal, setShowEntryModal] = useState(false);
  const [entryType, setEntryType] = useState<'intake' | 'output'>('intake');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();

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
        const response = await fetch(apiUrl('/api/clinical/intake-output'), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Doctor',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            setPatients(data.map((p: PatientIO & { entries: (IOEntry & { timestamp: string })[] }) => ({
              ...p,
              entries: p.entries.map((e: IOEntry & { timestamp: string }) => ({
                ...e,
                timestamp: new Date(e.timestamp)
              }))
            })));
          }
        } else if (response.status === 401) {
          setError('Session expired. Please log in again.');
        } else {
          setError('Failed to load intake/output records');
        }
      } catch (err) {
        console.error('Failed to fetch I/O records:', err);
        setError('Unable to connect to server');
      } finally {
        setLoading(false);
      }
    };
    
    fetchIntakeOutput();
  }, [user]);

  const getIntakeCategories = (): IntakeType[] => ['oral', 'iv', 'tube-feeding', 'blood-products', 'other-intake'];
  const getOutputCategories = (): OutputType[] => ['urine', 'stool', 'emesis', 'drainage', 'blood-loss', 'other-output'];

  const getCategoryLabel = (cat: IntakeType | OutputType): string => {
    const labels: Record<string, string> = {
      'oral': 'Oral Fluids',
      'iv': 'IV Fluids',
      'tube-feeding': 'Tube Feeding',
      'blood-products': 'Blood Products',
      'other-intake': 'Other Intake',
      'urine': 'Urine',
      'stool': 'Stool',
      'emesis': 'Emesis/Vomit',
      'drainage': 'Drainage',
      'blood-loss': 'Blood Loss',
      'other-output': 'Other Output'
    };
    return labels[cat] || cat;
  };

  const getCategoryColor = (cat: IntakeType | OutputType): string => {
    const colors: Record<string, string> = {
      'oral': 'bg-blue-100 text-blue-700',
      'iv': 'bg-cyan-100 text-cyan-700',
      'tube-feeding': 'bg-purple-100 text-purple-700',
      'blood-products': 'bg-red-100 text-red-700',
      'urine': 'bg-yellow-100 text-yellow-700',
      'stool': 'bg-amber-100 text-amber-700',
      'emesis': 'bg-orange-100 text-orange-700',
      'drainage': 'bg-green-100 text-green-700',
      'blood-loss': 'bg-rose-100 text-rose-700'
    };
    return colors[cat] || 'bg-gray-100 text-gray-700';
  };

  const getBalanceStatus = (balance: number): { color: string; icon: React.ReactNode; label: string } => {
    if (balance > 1000) return { color: 'text-red-600', icon: <TrendingUp className="w-4 h-4" />, label: 'Positive (High)' };
    if (balance > 500) return { color: 'text-yellow-600', icon: <TrendingUp className="w-4 h-4" />, label: 'Positive' };
    if (balance < -500) return { color: 'text-blue-600', icon: <TrendingDown className="w-4 h-4" />, label: 'Negative' };
    return { color: 'text-green-600', icon: <CheckCircle className="w-4 h-4" />, label: 'Balanced' };
  };

  const filteredPatients = patients.filter(p =>
    p.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.mrn.includes(searchQuery) ||
    p.room.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddEntry = () => {
    if (!selectedPatient || newEntry.amount <= 0) return;
    // Would save to backend
    setShowEntryModal(false);
    setNewEntry({ type: 'intake', category: 'oral', amount: 0, unit: 'ml', source: '', notes: '' });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-600 to-teal-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Droplets className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Intake & Output</h1>
        </div>
        <p className="text-cyan-100">Track patient fluid balance</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-cyan-600 animate-spin mb-2" />
          <p className="text-gray-500">Loading I/O records...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-red-700">{error}</p>
            <p className="text-xs text-red-500 mt-1">Check that the API server is running on port 8080</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Tabs */}
          <div className="bg-white border-b">
            <div className="flex">
              {(['patients', 'entry', 'trends'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium capitalize ${
                    activeTab === tab ? 'text-cyan-700 border-b-2 border-cyan-700' : 'text-gray-500'
                  }`}
                >
                  {tab === 'entry' ? 'Quick Entry' : tab === 'patients' ? 'All Patients' : 'Trends'}
                </button>
              ))}
            </div>
          </div>

          {/* Patients Tab */}
          {activeTab === 'patients' && (
            <div className="p-6">
              <div className="flex gap-4 mb-6">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, MRN, or room..."
                    className="w-full pl-10 pr-4 py-2 border rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-4">
                {filteredPatients.map(patient => {
                  const balanceStatus = getBalanceStatus(patient.netBalance);
                  return (
                    <div
                      key={patient.patientId}
                      className="bg-white rounded-lg shadow border overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => setSelectedPatient(patient)}
                    >
                      <div className="p-6">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="font-semibold text-lg">{patient.patientName}</h3>
                        <p className="text-sm text-gray-500">MRN: {patient.mrn} • Room: {patient.room}</p>
                      </div>
                      {patient.alerts.length > 0 && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs">
                          <AlertTriangle className="w-3 h-3" />
                          {patient.alerts.length} Alert{patient.alerts.length > 1 ? 's' : ''}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div className="bg-blue-50 rounded-lg p-3 text-center">
                        <div className="flex items-center justify-center gap-1 text-blue-600 mb-1">
                          <ArrowDown className="w-4 h-4" />
                          <span className="text-xs font-medium">Intake</span>
                        </div>
                        <p className="text-xl font-bold text-blue-700">{patient.totalIntake24h}</p>
                        <p className="text-xs text-blue-500">ml/24h</p>
                      </div>
                      <div className="bg-amber-50 rounded-lg p-3 text-center">
                        <div className="flex items-center justify-center gap-1 text-amber-600 mb-1">
                          <ArrowUp className="w-4 h-4" />
                          <span className="text-xs font-medium">Output</span>
                        </div>
                        <p className="text-xl font-bold text-amber-700">{patient.totalOutput24h}</p>
                        <p className="text-xs text-amber-500">ml/24h</p>
                      </div>
                      <div className={`rounded-lg p-3 text-center ${patient.netBalance > 500 ? 'bg-red-50' : patient.netBalance < -500 ? 'bg-blue-50' : 'bg-green-50'}`}>
                        <div className={`flex items-center justify-center gap-1 mb-1 ${balanceStatus.color}`}>
                          {balanceStatus.icon}
                          <span className="text-xs font-medium">Balance</span>
                        </div>
                        <p className={`text-xl font-bold ${balanceStatus.color}`}>
                          {patient.netBalance > 0 ? '+' : ''}{patient.netBalance}
                        </p>
                        <p className={`text-xs ${balanceStatus.color}`}>ml</p>
                      </div>
                    </div>

                    {patient.alerts.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <div className="text-sm text-red-700">
                            {patient.alerts.map((alert, idx) => (
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
          <div className="bg-white rounded-lg shadow p-6 max-w-lg mx-auto">
            <h2 className="text-lg font-semibold mb-4">Quick I/O Entry</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="io-patient" className="block text-sm font-medium mb-1">Patient *</label>
                <select id="io-patient" className="w-full border rounded-lg px-3 py-2">
                  <option value="">Select patient...</option>
                  {patients.map(p => (
                    <option key={p.patientId} value={p.patientId}>{p.patientName} - {p.room}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Type *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setEntryType('intake'); setNewEntry({ ...newEntry, type: 'intake', category: 'oral' }); }}
                    className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 ${
                      entryType === 'intake' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200'
                    }`}
                  >
                    <ArrowDown className="w-5 h-5" />
                    Intake
                  </button>
                  <button
                    onClick={() => { setEntryType('output'); setNewEntry({ ...newEntry, type: 'output', category: 'urine' }); }}
                    className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 ${
                      entryType === 'output' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200'
                    }`}
                  >
                    <ArrowUp className="w-5 h-5" />
                    Output
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="io-category" className="block text-sm font-medium mb-1">Category *</label>
                <select
                  id="io-category"
                  value={newEntry.category}
                  onChange={(e) => setNewEntry({ ...newEntry, category: e.target.value as any })}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  {(entryType === 'intake' ? getIntakeCategories() : getOutputCategories()).map(cat => (
                    <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="io-amount" className="block text-sm font-medium mb-1">Amount *</label>
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
                  <label htmlFor="io-unit" className="block text-sm font-medium mb-1">Unit</label>
                  <select
                    id="io-unit"
                    value={newEntry.unit}
                    onChange={(e) => setNewEntry({ ...newEntry, unit: e.target.value as any })}
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
                  <label htmlFor="io-source" className="block text-sm font-medium mb-1">Source</label>
                  <input
                    id="io-source"
                    type="text"
                    value={newEntry.source}
                    onChange={(e) => setNewEntry({ ...newEntry, source: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="e.g., Water, NS @ 100ml/hr"
                  />
                </div>
              )}

              <div>
                <label htmlFor="io-notes" className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  id="io-notes"
                  value={newEntry.notes}
                  onChange={(e) => setNewEntry({ ...newEntry, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={2}
                  placeholder="Optional notes..."
                />
              </div>

              <button
                onClick={handleAddEntry}
                className="w-full py-3 bg-cyan-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Record Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trends Tab */}
      {activeTab === 'trends' && (
        <div className="p-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">I/O Trends</h2>
              <div className="flex gap-2">
                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="border rounded-lg px-3 py-2" />
                <button className="p-2 border rounded-lg hover:bg-gray-50"><Download className="w-5 h-5" /></button>
                <button className="p-2 border rounded-lg hover:bg-gray-50"><Printer className="w-5 h-5" /></button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3">Patient</th>
                    <th className="text-left p-3">Room</th>
                    <th className="text-right p-3">Intake (ml)</th>
                    <th className="text-right p-3">Output (ml)</th>
                    <th className="text-right p-3">Balance (ml)</th>
                    <th className="text-center p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map(p => {
                    const status = getBalanceStatus(p.netBalance);
                    return (
                      <tr key={p.patientId} className="border-b hover:bg-gray-50">
                        <td className="p-3 font-medium">{p.patientName}</td>
                        <td className="p-3">{p.room}</td>
                        <td className="p-3 text-right text-blue-600">{p.totalIntake24h}</td>
                        <td className="p-3 text-right text-amber-600">{p.totalOutput24h}</td>
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
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{selectedPatient.patientName}</h2>
                <p className="text-sm text-gray-500">Room {selectedPatient.room} • MRN: {selectedPatient.mrn}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowEntryModal(true); }}
                  className="px-3 py-1.5 bg-cyan-600 text-white rounded-lg text-sm font-medium flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" /> Add Entry
                </button>
                <button onClick={() => setSelectedPatient(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
              </div>
            </div>

            <div className="p-6">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-blue-700">{selectedPatient.totalIntake24h}</p>
                  <p className="text-sm text-blue-600">Total Intake (24h)</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-amber-700">{selectedPatient.totalOutput24h}</p>
                  <p className="text-sm text-amber-600">Total Output (24h)</p>
                </div>
                <div className={`rounded-lg p-4 text-center ${selectedPatient.netBalance > 500 ? 'bg-red-50' : 'bg-green-50'}`}>
                  <p className={`text-2xl font-bold ${selectedPatient.netBalance > 500 ? 'text-red-700' : 'text-green-700'}`}>
                    {selectedPatient.netBalance > 0 ? '+' : ''}{selectedPatient.netBalance}
                  </p>
                  <p className={`text-sm ${selectedPatient.netBalance > 500 ? 'text-red-600' : 'text-green-600'}`}>Net Balance</p>
                </div>
              </div>

              {/* Entries Table */}
              <h3 className="font-semibold mb-3">Today's Entries</h3>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-3">Time</th>
                      <th className="text-left p-3">Type</th>
                      <th className="text-left p-3">Category</th>
                      <th className="text-right p-3">Amount</th>
                      <th className="text-left p-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPatient.entries.map(entry => (
                      <tr key={entry.id} className="border-t">
                        <td className="p-3">{entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${entry.type === 'intake' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                            {entry.type === 'intake' ? <ArrowDown className="w-3 h-3 inline mr-1" /> : <ArrowUp className="w-3 h-3 inline mr-1" />}
                            {entry.type}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-xs ${getCategoryColor(entry.category)}`}>
                            {getCategoryLabel(entry.category)}
                          </span>
                        </td>
                        <td className="p-3 text-right font-medium">{entry.amount} {entry.unit}</td>
                        <td className="p-3 text-gray-500">{entry.source || entry.notes || '-'}</td>
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
