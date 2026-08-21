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
import { apiUrl, useTranslation } from '@medichain/shared';
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

/**
 * Suture materials and gauges in routine laceration-repair use.
 *
 * Absorbable (Vicryl, chromic/plain gut, PDS) for deep and mucosal layers;
 * non-absorbable (nylon, Prolene, silk) for skin, which needs removal. Gauge is
 * chosen by site — finer on the face, heavier over the scalp and extremities.
 */
const SUTURE_TYPES = [
  '4-0 Nylon',
  '5-0 Nylon',
  '6-0 Nylon',
  '3-0 Nylon',
  '4-0 Prolene',
  '5-0 Prolene',
  '3-0 Vicryl',
  '4-0 Vicryl',
  '5-0 Vicryl Rapide',
  '4-0 Chromic Gut',
  '5-0 Chromic Gut',
  '4-0 Plain Gut',
  '3-0 Silk',
  '4-0 PDS',
] as const;

const LacerationRepairPage: React.FC = () => {
  const { t } = useTranslation();
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
        setError(err instanceof Error ? err.message : t('docLaceration.errLoad'));
        setRepairs([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchRepairs();
  }, [user]);

  const getStatusBadge = (status: RepairStatus) => {
    const styles: Record<RepairStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      'pending': { bg: 'bg-caution-subtle', text: 'text-caution-subtle-fg', icon: <Clock className="w-3 h-3" /> },
      'in-progress': { bg: 'bg-notice-subtle', text: 'text-notice-subtle-fg', icon: <Activity className="w-3 h-3" /> },
      'completed': { bg: 'bg-ok-subtle', text: 'text-ok-subtle-fg', icon: <CheckCircle className="w-3 h-3" /> },
      'follow-up-needed': { bg: 'bg-surface-sunken', text: 'text-content-secondary', icon: <AlertTriangle className="w-3 h-3" /> }
    };
    const s = styles[status];
    const statusLabels: Record<RepairStatus, string> = {
      'pending': t('docLaceration.statPending'),
      'in-progress': t('docLaceration.statInProgress'),
      'completed': t('docLaceration.statCompleted'),
      'follow-up-needed': t('docLaceration.statFollowUpNeeded'),
    };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {statusLabels[status]}
      </span>
    );
  };

  const getWoundTypeLabel = (type: WoundType): string => ({
    laceration: t('docLaceration.wtLaceration'),
    abrasion: t('docLaceration.wtAbrasion'),
    puncture: t('docLaceration.wtPuncture'),
    avulsion: t('docLaceration.wtAvulsion'),
    incision: t('docLaceration.wtIncision'),
  }[type]);

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
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-pink-600 to-rose-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Scissors className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docLaceration.title')}</h1>
        </div>
        <p className="text-pink-100">{t('docLaceration.subtitle')}</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-content-secondary animate-spin mb-2" />
          <p className="text-content-muted">{t('docLaceration.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-critical-subtle border border-critical rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-critical-subtle-fg">{error}</p>
            <p className="text-xs text-red-500 mt-1">{t('docLaceration.errApiHint')}</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-content-secondary">{repairs.length}</p>
              <p className="text-xs text-content-muted">{t('docLaceration.totalRepairs')}</p>
            </div>
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-content-secondary">{followUpToday.length}</p>
              <p className="text-xs text-content-muted">{t('docLaceration.followUpToday')}</p>
            </div>
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-ok-subtle-fg">{repairs.filter(r => r.status === 'completed').length}</p>
              <p className="text-xs text-content-muted">{t('docLaceration.completed')}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-surface border-b">
            <div className="flex">
              {(['repairs', 'new', 'follow-up'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium capitalize ${
                    activeTab === tab ? 'text-content-secondary border-b-2 border-pink-700' : 'text-content-muted'
                  }`}
                >
                  {tab === 'repairs' ? t('docLaceration.tabAllRepairs') : tab === 'new' ? t('docLaceration.tabNewRepair') : t('docLaceration.tabFollowUp')}
                </button>
              ))}
            </div>
          </div>

          {/* Repairs List */}
          {activeTab === 'repairs' && (
            <div className="p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('docLaceration.searchPh')}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg"
                />
              </div>

          <div className="space-y-3">
            {filteredRepairs.map(repair => (
              <div
                key={repair.id}
                onClick={() => setSelectedRepair(repair)}
                className="bg-surface rounded-lg shadow border p-4 cursor-pointer hover:shadow-md"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold">{repair.patientName}</h3>
                    <p className="text-sm text-content-muted">{t('docLaceration.mrn', { mrn: repair.mrn })}</p>
                  </div>
                  {getStatusBadge(repair.status)}
                </div>

                <div className="bg-surface-sunken rounded p-3 mb-3">
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <MapPin className="w-4 h-4 text-content-muted" />
                    <span className="font-medium">{repair.location}</span>
                  </div>
                  <p className="text-xs text-content-muted">
                    {getWoundTypeLabel(repair.woundType)} • {repair.length} cm • {repair.closureMethod}
                    {repair.sutureCount ? ` ${t('docLaceration.countUnit', { count: repair.sutureCount, unit: repair.closureMethod === 'staples' ? t('docLaceration.unitStaples') : t('docLaceration.unitSutures') })}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs text-content-muted">
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
                  <div className={`mt-2 text-xs ${new Date(repair.followUpDate) <= new Date() ? 'text-content-secondary' : 'text-content-muted'}`}>
                    <ClipboardCheck className="w-3 h-3 inline mr-1" />
                    {t('docLaceration.followUpLabel', { date: repair.followUpDate.toLocaleDateString() })}
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
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docLaceration.newRepair')}</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="laceration-patient" className="block text-sm font-medium mb-1">{t('docLaceration.patientReq')}</label>
                <select
                  id="laceration-patient"
                  value={newRepair.patientId}
                  onChange={(e) => setNewRepair({ ...newRepair, patientId: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="">{t('docLaceration.selectPatient')}</option>
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patient.name} ({patient.mrn})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="laceration-wound-type" className="block text-sm font-medium mb-1">{t('docLaceration.woundTypeReq')}</label>
                  <select
                    id="laceration-wound-type"
                    value={newRepair.woundType}
                    onChange={(e) => setNewRepair({ ...newRepair, woundType: e.target.value as WoundType })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="laceration">{t('docLaceration.wtLaceration')}</option>
                    <option value="abrasion">{t('docLaceration.wtAbrasion')}</option>
                    <option value="puncture">{t('docLaceration.wtPuncture')}</option>
                    <option value="avulsion">{t('docLaceration.wtAvulsion')}</option>
                    <option value="incision">{t('docLaceration.wtIncision')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="laceration-length" className="block text-sm font-medium mb-1">{t('docLaceration.lengthReq')}</label>
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
                <label htmlFor="laceration-location" className="block text-sm font-medium mb-1">{t('docLaceration.locationReq')}</label>
                <input
                  id="laceration-location"
                  type="text"
                  value={newRepair.location}
                  onChange={(e) => setNewRepair({ ...newRepair, location: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder={t('docLaceration.locationPh')}
                />
              </div>

              <div>
                <label htmlFor="laceration-depth" className="block text-sm font-medium mb-1">{t('docLaceration.depth')}</label>
                <select
                  id="laceration-depth"
                  value={newRepair.depth}
                  onChange={(e) => setNewRepair({ ...newRepair, depth: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="superficial">{t('docLaceration.depthSuperficial')}</option>
                  <option value="partial thickness">{t('docLaceration.depthPartial')}</option>
                  <option value="full thickness">{t('docLaceration.depthFull')}</option>
                  <option value="deep structure">{t('docLaceration.depthDeep')}</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="laceration-closure-method" className="block text-sm font-medium mb-1">{t('docLaceration.closureReq')}</label>
                  <select
                    id="laceration-closure-method"
                    value={newRepair.closureMethod}
                    onChange={(e) => setNewRepair({ ...newRepair, closureMethod: e.target.value as ClosureMethod })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="sutures">{t('docLaceration.clSutures')}</option>
                    <option value="staples">{t('docLaceration.clStaples')}</option>
                    <option value="dermabond">{t('docLaceration.clDermabond')}</option>
                    <option value="steri-strips">{t('docLaceration.clSteriStrips')}</option>
                    <option value="combination">{t('docLaceration.clCombination')}</option>
                  </select>
                </div>
                {/* Suture material and gauge. `sutureType` was initialised to
                    '4-0 Nylon' and had no control, so every repair was filed as
                    4-0 nylon whatever was actually used — and the backend
                    persists it (`suture_material`/`suture_size`). Material and
                    gauge determine removal timing, so a wrong value misdirects
                    the follow-up visit. */}
                {(newRepair.closureMethod === 'sutures' || newRepair.closureMethod === 'combination') && (
                  <div>
                    <label htmlFor="laceration-suture-type" className="block text-sm font-medium mb-1">{t('docLaceration.sutureTypeReq')}</label>
                    <select
                      id="laceration-suture-type"
                      value={newRepair.sutureType}
                      onChange={(e) => setNewRepair({ ...newRepair, sutureType: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2"
                    >
                      {SUTURE_TYPES.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label htmlFor="laceration-count" className="block text-sm font-medium mb-1">{t('docLaceration.count')}</label>
                  <input
                    id="laceration-count"
                    type="number"
                    value={newRepair.sutureCount || ''}
                    onChange={(e) => setNewRepair({ ...newRepair, sutureCount: parseInt(e.target.value) || 0 })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder={t('docLaceration.countPh')}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="laceration-anesthesia" className="block text-sm font-medium mb-1">{t('docLaceration.anesthesia')}</label>
                <input
                  id="laceration-anesthesia"
                  type="text"
                  value={newRepair.anesthesia}
                  onChange={(e) => setNewRepair({ ...newRepair, anesthesia: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder={t('docLaceration.anesthesiaPh')}
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
                  <span className="text-sm">{t('docLaceration.tetanusGiven')}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newRepair.antibioticsPrescribed}
                    onChange={(e) => setNewRepair({ ...newRepair, antibioticsPrescribed: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">{t('docLaceration.antibioticsPrescribed')}</span>
                </label>
              </div>

              <div>
                <label htmlFor="laceration-notes" className="block text-sm font-medium mb-1">{t('docLaceration.notes')}</label>
                <textarea
                  id="laceration-notes"
                  value={newRepair.notes}
                  onChange={(e) => setNewRepair({ ...newRepair, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder={t('docLaceration.notesPh')}
                />
              </div>

              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                <Camera className="w-8 h-8 mx-auto text-content-muted mb-2" />
                <p className="text-sm text-content-muted">{t('docLaceration.uploadPhoto')}</p>
              </div>

              <button className="w-full py-3 bg-pink-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                <Plus className="w-5 h-5" />
                {t('docLaceration.saveRepair')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up Tab */}
      {activeTab === 'follow-up' && (
        <div className="p-4">
          <h2 className="text-lg font-semibold mb-4">{t('docLaceration.upcomingFollowUps')}</h2>
          <div className="space-y-3">
            {repairs.filter(r => r.followUpDate).sort((a, b) => (a.followUpDate?.getTime() || 0) - (b.followUpDate?.getTime() || 0)).map(repair => {
              const isToday = repair.followUpDate?.toDateString() === new Date().toDateString();
              const isPast = repair.followUpDate && repair.followUpDate < new Date();
              return (
                <div key={repair.id} className={`bg-surface rounded-lg shadow border p-4 ${isToday ? 'border-l-4 border-l-orange-500' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{repair.patientName}</h3>
                      <p className="text-sm text-content-muted">{repair.location}</p>
                      <p className="text-xs text-content-muted mt-1">
                        {repair.closureMethod} - {repair.sutureCount} {repair.closureMethod === 'staples' ? t('docLaceration.unitStaples') : t('docLaceration.unitSutures')}
                      </p>
                    </div>
                    <div className={`text-right ${isPast ? 'text-critical-subtle-fg' : isToday ? 'text-content-secondary' : 'text-content-muted'}`}>
                      <p className="font-semibold">{repair.followUpDate?.toLocaleDateString()}</p>
                      <p className="text-xs">{isToday ? t('docLaceration.today') : isPast ? t('docLaceration.overdue') : t('docLaceration.upcoming')}</p>
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
          <div className="bg-surface rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b p-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">{t('docLaceration.repairDetails')}</h2>
              <button onClick={() => setSelectedRepair(null)} className="text-content-muted hover:text-content-muted text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-content-muted">{t('docLaceration.patient')}</p>
                <p className="font-semibold">{selectedRepair.patientName} ({t('docLaceration.mrn', { mrn: selectedRepair.mrn })})</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-content-muted">{t('docLaceration.injuryDate')}</p>
                  <p className="font-medium">{selectedRepair.injuryDate.toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-content-muted">{t('docLaceration.repairDate')}</p>
                  <p className="font-medium">{selectedRepair.repairDate.toLocaleDateString()}</p>
                </div>
              </div>

              <div className="bg-surface-sunken rounded-lg p-4">
                <h4 className="font-medium mb-2">{t('docLaceration.woundDetails')}</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-content-muted">{t('docLaceration.lblLocation')}</span> {selectedRepair.location}</div>
                  <div><span className="text-content-muted">{t('docLaceration.lblType')}</span> {getWoundTypeLabel(selectedRepair.woundType)}</div>
                  <div><span className="text-content-muted">{t('docLaceration.lblLength')}</span> {selectedRepair.length} cm</div>
                  <div><span className="text-content-muted">{t('docLaceration.lblDepth')}</span> {selectedRepair.depth}</div>
                </div>
              </div>

              <div className="bg-surface-sunken rounded-lg p-4">
                <h4 className="font-medium mb-2">{t('docLaceration.repairDetails')}</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-content-muted">{t('docLaceration.lblClosure')}</span> {selectedRepair.closureMethod}</div>
                  {selectedRepair.sutureCount && <div><span className="text-content-muted">{t('docLaceration.lblCount')}</span> {selectedRepair.sutureCount}</div>}
                  {selectedRepair.sutureType && <div><span className="text-content-muted">{t('docLaceration.lblSuture')}</span> {selectedRepair.sutureType}</div>}
                  <div><span className="text-content-muted">{t('docLaceration.lblAnesthesia')}</span> {selectedRepair.anesthesia}</div>
                </div>
                <div className="flex gap-4 mt-2">
                  <span className={`text-xs ${selectedRepair.tetanusGiven ? 'text-ok-subtle-fg' : 'text-content-muted'}`}>
                    {selectedRepair.tetanusGiven ? '✓' : '✗'} {t('docLaceration.tetanus')}
                  </span>
                  <span className={`text-xs ${selectedRepair.antibioticsPrescribed ? 'text-ok-subtle-fg' : 'text-content-muted'}`}>
                    {selectedRepair.antibioticsPrescribed ? '✓' : '✗'} {t('docLaceration.antibiotics')}
                  </span>
                </div>
              </div>

              {selectedRepair.notes && (
                <div>
                  <p className="text-sm text-content-muted mb-1">{t('docLaceration.notes')}</p>
                  <p className="text-sm bg-caution-subtle p-3 rounded">{selectedRepair.notes}</p>
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
