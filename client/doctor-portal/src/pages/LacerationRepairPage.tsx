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
  ClipboardCheck
} from 'lucide-react';

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

const LacerationRepairPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'repairs' | 'new' | 'follow-up'>('repairs');
  const [repairs, setRepairs] = useState<LacerationRepair[]>([]);
  const [selectedRepair, setSelectedRepair] = useState<LacerationRepair | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  useEffect(() => {
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);
    const daysFromNow = (d: number) => new Date(now.getTime() + d * 86400000);

    setRepairs([
      {
        id: 'LAC-001',
        patientId: 'PAT-12345',
        patientName: 'Ahmed Al-Rashid',
        mrn: '789012',
        injuryDate: daysAgo(0),
        repairDate: daysAgo(0),
        location: 'Right forearm, dorsal aspect',
        woundType: 'laceration',
        length: 4.5,
        depth: 'partial thickness',
        closureMethod: 'sutures',
        sutureType: '4-0 Nylon',
        sutureCount: 8,
        anesthesia: '1% Lidocaine with epinephrine',
        tetanusGiven: true,
        antibioticsPrescribed: false,
        status: 'completed',
        performedBy: 'Dr. Sarah Johnson',
        followUpDate: daysFromNow(10),
        notes: 'Clean laceration from glass. No neurovascular compromise.'
      },
      {
        id: 'LAC-002',
        patientId: 'PAT-67890',
        patientName: 'Fatima Hassan',
        mrn: '456789',
        injuryDate: daysAgo(1),
        repairDate: daysAgo(1),
        location: 'Left knee',
        woundType: 'abrasion',
        length: 6,
        depth: 'superficial',
        closureMethod: 'dermabond',
        anesthesia: 'None required',
        tetanusGiven: false,
        antibioticsPrescribed: false,
        status: 'follow-up-needed',
        performedBy: 'Dr. Michael Chen',
        followUpDate: daysFromNow(3)
      },
      {
        id: 'LAC-003',
        patientId: 'PAT-11223',
        patientName: 'Omar Khalil',
        mrn: '334455',
        injuryDate: daysAgo(7),
        repairDate: daysAgo(7),
        location: 'Scalp, occipital region',
        woundType: 'laceration',
        length: 3,
        depth: 'full thickness to galea',
        closureMethod: 'staples',
        sutureCount: 5,
        anesthesia: '1% Lidocaine',
        tetanusGiven: true,
        antibioticsPrescribed: true,
        status: 'completed',
        performedBy: 'Dr. Emily Rodriguez',
        followUpDate: daysAgo(0),
        notes: 'Fall injury. CT head negative. Staples ready for removal today.'
      }
    ]);
  }, []);

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
                <label className="block text-sm font-medium mb-1">Patient *</label>
                <select className="w-full border rounded-lg px-3 py-2">
                  <option value="">Select patient...</option>
                  <option value="PAT-12345">Ahmed Al-Rashid (789012)</option>
                  <option value="PAT-67890">Fatima Hassan (456789)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Wound Type *</label>
                  <select
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
                  <label className="block text-sm font-medium mb-1">Length (cm) *</label>
                  <input
                    type="number"
                    step="0.5"
                    value={newRepair.length || ''}
                    onChange={(e) => setNewRepair({ ...newRepair, length: parseFloat(e.target.value) || 0 })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Location *</label>
                <input
                  type="text"
                  value={newRepair.location}
                  onChange={(e) => setNewRepair({ ...newRepair, location: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g., Right forearm, dorsal aspect"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Depth</label>
                <select
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
                  <label className="block text-sm font-medium mb-1">Closure Method *</label>
                  <select
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
                  <label className="block text-sm font-medium mb-1">Count</label>
                  <input
                    type="number"
                    value={newRepair.sutureCount || ''}
                    onChange={(e) => setNewRepair({ ...newRepair, sutureCount: parseInt(e.target.value) || 0 })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="# of sutures/staples"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Anesthesia</label>
                <input
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
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
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
