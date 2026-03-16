import React, { useState, useEffect } from 'react';
import {
  Scissors,
  Search,
  Plus,
  Clock,
  CheckCircle,
  AlertTriangle,
  Calendar,
  User,
  Camera,
  MapPin,
  Activity,
  ClipboardCheck,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { apiUrl } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';

/**
 * LacerationRepairPage
 * 
 * Page for documenting laceration repairs and wound care.
 * Implements laceration repair form, wound photo upload, and follow-up tracking.
 */

type WoundType = 'laceration' | 'abrasion' | 'puncture' | 'avulsion' | 'incision';
type RepairStatus = 'pending' | 'in-progress' | 'completed' | 'follow-up-needed';
type ClosureMethod = 'sutures' | 'staples' | 'dermabond' | 'steri-strips' | 'combination';

interface LacerationRepair {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  injuryDate: Date;
  repairDate: Date;
  location: string;
  woundType: WoundType;
  length: number;
  depth: string;
  closureMethod: ClosureMethod;
  sutureType?: string;
  sutureCount?: number;
  anesthesia: string;
  tetanusGiven: boolean;
  antibioticsPrescribed: boolean;
  status: RepairStatus;
  performedBy: string;
  followUpDate?: Date;
  notes?: string;
}

interface PatientOption {
  id: string;
  name: string;
  mrn: string;
}

const LacerationRepairPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'repairs' | 'new' | 'follow-up'>('repairs');
  const [repairs, setRepairs] = useState<LacerationRepair[]>([]);
  const [selectedRepair, setSelectedRepair] = useState<LacerationRepair | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const { user } = useAuthStore();

  const [newRepair, setNewRepair] = useState({
    patientId: '',
    location: '',
    woundType: 'laceration' as WoundType,
    length: 0,
    depth: 'superficial',
    closureMethod: 'sutures' as ClosureMethod,
    sutureType: '4-0 Nylon',
    sutureCount: 0,
    anesthesia: '1% Lidocaine',
    tetanusGiven: false,
    antibioticsPrescribed: false,
    notes: ''
  });

  // Fetch patients for dropdown
  useEffect(() => {
    const fetchPatients = async () => {
      if (!user?.walletAddress) return;
      
      try {
        const response = await fetch(apiUrl('/api/patients'), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Doctor'
          }
        });
        
        if (response.ok) {
          const result = await response.json();
          // Handle PaginatedResponse {data: [], pagination: {...}}
          const patientData = result.data || result.patients || (Array.isArray(result) ? result : []);
          const patientList = patientData.map((p: { patient_id?: string; id?: string; name?: string; full_name?: string; mrn?: string; medical_record_number?: string }) => ({
            id: p.patient_id || p.id || '',
            name: p.name || p.full_name || 'Unknown',
            mrn: p.mrn || p.medical_record_number || ''
          }));
          setPatients(patientList);
        }
      } catch (err) {
        console.error('Error fetching patients:', err);
      }
    };
    
    fetchPatients();
  }, [user]);

  useEffect(() => {
    const fetchRepairs = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(apiUrl('/api/clinical/laceration-repairs'), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Doctor'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch repairs: ${response.status}`);
        }
        
        const result = await response.json();
        // Handle PaginatedResponse or direct array
        const repairData = result.data || result.repairs || (Array.isArray(result) ? result : []);
        // Convert date strings to Date objects
        const repairsWithDates = repairData.map((repair: LacerationRepair) => ({
          ...repair,
          injuryDate: new Date(repair.injuryDate),
          repairDate: new Date(repair.repairDate),
          followUpDate: repair.followUpDate ? new Date(repair.followUpDate) : undefined
        }));
        setRepairs(repairsWithDates);
      } catch (err) {
        console.error('Error fetching repairs:', err);
        setError(err instanceof Error ? err.message : 'Failed to load laceration repairs');
        setRepairs([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchRepairs();
  }, [user]);

  const getStatusBadge = (status: RepairStatus) => {
    const styles: Record<RepairStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      'pending': { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: <Clock className="w-3 h-3" /> },
      'in-progress': { bg: 'bg-blue-100', text: 'text-blue-700', icon: <Activity className="w-3 h-3" /> },
      'completed': { bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
      'follow-up-needed': { bg: 'bg-orange-100', text: 'text-orange-700', icon: <AlertTriangle className="w-3 h-3" /> }
    };
    const s = styles[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {status.replace(/-/g, ' ')}
      </span>
    );
  };

  const getWoundTypeLabel = (type: WoundType) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  const filteredRepairs = repairs.filter(r =>
    r.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.mrn.includes(searchQuery) ||
    r.location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const followUpToday = repairs.filter(r => {
    if (!r.followUpDate) return false;
    const today = new Date().toDateString();
    return r.followUpDate.toDateString() === today;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-pink-600 to-rose-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Scissors className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Laceration Repair</h1>
        </div>
        <p className="text-pink-100">Document wound repairs and track follow-ups</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-pink-600 animate-spin mb-2" />
          <p className="text-gray-500">Loading laceration repairs...</p>
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
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-gray-800">{repairs.length}</p>
              <p className="text-xs text-gray-500">Total Repairs</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{followUpToday.length}</p>
              <p className="text-xs text-gray-500">Follow-up Today</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{repairs.filter(r => r.status === 'completed').length}</p>
              <p className="text-xs text-gray-500">Completed</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white border-b">
            <div className="flex">
              {(['repairs', 'new', 'follow-up'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium capitalize ${
                    activeTab === tab ? 'text-pink-700 border-b-2 border-pink-700' : 'text-gray-500'
                  }`}
                >
                  {tab === 'repairs' ? 'All Repairs' : tab === 'new' ? 'New Repair' : 'Follow-up'}
                </button>
              ))}
            </div>
          </div>

          {/* Repairs List */}
          {activeTab === 'repairs' && (
            <div className="p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by patient, MRN, or location..."
                  className="w-full pl-10 pr-4 py-2 border rounded-lg"
                />
              </div>

          <div className="space-y-3">
            {filteredRepairs.map(repair => (
              <div
                key={repair.id}
                onClick={() => setSelectedRepair(repair)}
                className="bg-white rounded-lg shadow border p-4 cursor-pointer hover:shadow-md"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold">{repair.patientName}</h3>
                    <p className="text-sm text-gray-500">MRN: {repair.mrn}</p>
                  </div>
                  {getStatusBadge(repair.status)}
                </div>

                <div className="bg-gray-50 rounded p-3 mb-3">
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    <span className="font-medium">{repair.location}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {getWoundTypeLabel(repair.woundType)} • {repair.length} cm • {repair.closureMethod}
                    {repair.sutureCount && ` (${repair.sutureCount} ${repair.closureMethod === 'staples' ? 'staples' : 'sutures'})`}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {repair.repairDate.toLocaleDateString()}
                  </span>
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {repair.performedBy}
                  </span>
                </div>

                {repair.followUpDate && (
                  <div className={`mt-2 text-xs ${new Date(repair.followUpDate) <= new Date() ? 'text-orange-600' : 'text-gray-500'}`}>
                    <ClipboardCheck className="w-3 h-3 inline mr-1" />
                    Follow-up: {repair.followUpDate.toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Repair Form */}
      {activeTab === 'new' && (
        <div className="p-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">New Laceration Repair</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="laceration-patient" className="block text-sm font-medium mb-1">Patient *</label>
                <select
                  id="laceration-patient"
                  value={newRepair.patientId}
                  onChange={(e) => setNewRepair({ ...newRepair, patientId: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="">Select patient...</option>
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patient.name} ({patient.mrn})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="laceration-wound-type" className="block text-sm font-medium mb-1">Wound Type *</label>
                  <select
                    id="laceration-wound-type"
                    value={newRepair.woundType}
                    onChange={(e) => setNewRepair({ ...newRepair, woundType: e.target.value as WoundType })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="laceration">Laceration</option>
                    <option value="abrasion">Abrasion</option>
                    <option value="puncture">Puncture</option>
                    <option value="avulsion">Avulsion</option>
                    <option value="incision">Incision</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="laceration-length" className="block text-sm font-medium mb-1">Length (cm) *</label>
                  <input
                    id="laceration-length"
                    type="number"
                    step="0.5"
                    value={newRepair.length || ''}
                    onChange={(e) => setNewRepair({ ...newRepair, length: parseFloat(e.target.value) || 0 })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="laceration-location" className="block text-sm font-medium mb-1">Location *</label>
                <input
                  id="laceration-location"
                  type="text"
                  value={newRepair.location}
                  onChange={(e) => setNewRepair({ ...newRepair, location: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g., Right forearm, dorsal aspect"
                />
              </div>

              <div>
                <label htmlFor="laceration-depth" className="block text-sm font-medium mb-1">Depth</label>
                <select
                  id="laceration-depth"
                  value={newRepair.depth}
                  onChange={(e) => setNewRepair({ ...newRepair, depth: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="superficial">Superficial (epidermis only)</option>
                  <option value="partial thickness">Partial Thickness (into dermis)</option>
                  <option value="full thickness">Full Thickness (subcutaneous)</option>
                  <option value="deep structure">Deep Structure Involvement</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="laceration-closure-method" className="block text-sm font-medium mb-1">Closure Method *</label>
                  <select
                    id="laceration-closure-method"
                    value={newRepair.closureMethod}
                    onChange={(e) => setNewRepair({ ...newRepair, closureMethod: e.target.value as ClosureMethod })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="sutures">Sutures</option>
                    <option value="staples">Staples</option>
                    <option value="dermabond">Dermabond/Tissue Adhesive</option>
                    <option value="steri-strips">Steri-Strips</option>
                    <option value="combination">Combination</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="laceration-count" className="block text-sm font-medium mb-1">Count</label>
                  <input
                    id="laceration-count"
                    type="number"
                    value={newRepair.sutureCount || ''}
                    onChange={(e) => setNewRepair({ ...newRepair, sutureCount: parseInt(e.target.value) || 0 })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="# of sutures/staples"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="laceration-anesthesia" className="block text-sm font-medium mb-1">Anesthesia</label>
                <input
                  id="laceration-anesthesia"
                  type="text"
                  value={newRepair.anesthesia}
                  onChange={(e) => setNewRepair({ ...newRepair, anesthesia: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g., 1% Lidocaine with epinephrine"
                />
              </div>

              <div className="flex gap-6">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newRepair.tetanusGiven}
                    onChange={(e) => setNewRepair({ ...newRepair, tetanusGiven: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Tetanus Given</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newRepair.antibioticsPrescribed}
                    onChange={(e) => setNewRepair({ ...newRepair, antibioticsPrescribed: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Antibiotics Prescribed</span>
                </label>
              </div>

              <div>
                <label htmlFor="laceration-notes" className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  id="laceration-notes"
                  value={newRepair.notes}
                  onChange={(e) => setNewRepair({ ...newRepair, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder="Mechanism of injury, wound characteristics, complications..."
                />
              </div>

              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                <Camera className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-500">Click to upload wound photo</p>
              </div>

              <button className="w-full py-3 bg-pink-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                <Plus className="w-5 h-5" />
                Save Repair Documentation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up Tab */}
      {activeTab === 'follow-up' && (
        <div className="p-4">
          <h2 className="text-lg font-semibold mb-4">Upcoming Follow-ups</h2>
          <div className="space-y-3">
            {repairs.filter(r => r.followUpDate).sort((a, b) => (a.followUpDate?.getTime() || 0) - (b.followUpDate?.getTime() || 0)).map(repair => {
              const isToday = repair.followUpDate?.toDateString() === new Date().toDateString();
              const isPast = repair.followUpDate && repair.followUpDate < new Date();
              return (
                <div key={repair.id} className={`bg-white rounded-lg shadow border p-4 ${isToday ? 'border-l-4 border-l-orange-500' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{repair.patientName}</h3>
                      <p className="text-sm text-gray-500">{repair.location}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {repair.closureMethod} - {repair.sutureCount} {repair.closureMethod === 'staples' ? 'staples' : 'sutures'}
                      </p>
                    </div>
                    <div className={`text-right ${isPast ? 'text-red-600' : isToday ? 'text-orange-600' : 'text-gray-600'}`}>
                      <p className="font-semibold">{repair.followUpDate?.toLocaleDateString()}</p>
                      <p className="text-xs">{isToday ? 'Today' : isPast ? 'Overdue' : 'Upcoming'}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>)}

      {/* Detail Modal */}
      {selectedRepair && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Repair Details</h2>
              <button onClick={() => setSelectedRepair(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-gray-500">Patient</p>
                <p className="font-semibold">{selectedRepair.patientName} (MRN: {selectedRepair.mrn})</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Injury Date</p>
                  <p className="font-medium">{selectedRepair.injuryDate.toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Repair Date</p>
                  <p className="font-medium">{selectedRepair.repairDate.toLocaleDateString()}</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium mb-2">Wound Details</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-gray-500">Location:</span> {selectedRepair.location}</div>
                  <div><span className="text-gray-500">Type:</span> {getWoundTypeLabel(selectedRepair.woundType)}</div>
                  <div><span className="text-gray-500">Length:</span> {selectedRepair.length} cm</div>
                  <div><span className="text-gray-500">Depth:</span> {selectedRepair.depth}</div>
                </div>
              </div>

              <div className="bg-pink-50 rounded-lg p-4">
                <h4 className="font-medium mb-2">Repair Details</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-gray-500">Closure:</span> {selectedRepair.closureMethod}</div>
                  {selectedRepair.sutureCount && <div><span className="text-gray-500">Count:</span> {selectedRepair.sutureCount}</div>}
                  {selectedRepair.sutureType && <div><span className="text-gray-500">Suture:</span> {selectedRepair.sutureType}</div>}
                  <div><span className="text-gray-500">Anesthesia:</span> {selectedRepair.anesthesia}</div>
                </div>
                <div className="flex gap-4 mt-2">
                  <span className={`text-xs ${selectedRepair.tetanusGiven ? 'text-green-600' : 'text-gray-400'}`}>
                    {selectedRepair.tetanusGiven ? '✓' : '✗'} Tetanus
                  </span>
                  <span className={`text-xs ${selectedRepair.antibioticsPrescribed ? 'text-green-600' : 'text-gray-400'}`}>
                    {selectedRepair.antibioticsPrescribed ? '✓' : '✗'} Antibiotics
                  </span>
                </div>
              </div>

              {selectedRepair.notes && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">Notes</p>
                  <p className="text-sm bg-yellow-50 p-3 rounded">{selectedRepair.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LacerationRepairPage;
