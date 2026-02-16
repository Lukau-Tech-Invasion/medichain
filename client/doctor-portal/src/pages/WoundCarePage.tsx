import React, { useState, useEffect } from 'react';
import {
  Heart,
  Search,
  Plus,
  Camera,
  TrendingUp,
  TrendingDown,
  Minus,
  User,
  Clock,
  AlertTriangle,
  CheckCircle,
  Upload,
  Ruler,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { apiUrl } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';

/**
 * WoundCarePage
 * 
 * Page for wound assessment and documentation.
 * Implements wound assessment form, wound photo upload, and healing tracking.
 */

type WoundType = 'pressure-ulcer' | 'surgical' | 'diabetic-ulcer' | 'venous-ulcer' | 'arterial-ulcer' | 'traumatic' | 'burn' | 'skin-tear';
type WoundStatus = 'new' | 'healing' | 'stable' | 'deteriorating' | 'healed' | 'infected';
type StageType = 'stage-1' | 'stage-2' | 'stage-3' | 'stage-4' | 'unstageable' | 'dti' | 'n/a';

interface WoundMeasurement {
  date: Date;
  length: number;
  width: number;
  depth: number;
  area: number;
}

interface WoundAssessment {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  location: string;
  woundType: WoundType;
  stage?: StageType;
  status: WoundStatus;
  discoveredDate: Date;
  lastAssessment: Date;
  measurements: WoundMeasurement[];
  exudate: 'none' | 'minimal' | 'moderate' | 'copious';
  tissue: ('granulation' | 'epithelial' | 'slough' | 'eschar' | 'necrotic')[];
  edges: 'attached' | 'rolled' | 'undermined' | 'macerated';
  periwound: string;
  painLevel: number;
  dressing: string;
  frequency: string;
  notes: string;
  photos: string[];
  assessedBy: string;
}

const WoundCarePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'wounds' | 'assess' | 'tracking'>('wounds');
  const [wounds, setWounds] = useState<WoundAssessment[]>([]);
  const [selectedWound, setSelectedWound] = useState<WoundAssessment | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();

  useEffect(() => {
    const fetchWounds = async () => {
      if (!user?.walletAddress) {
        setError('User not authenticated');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(apiUrl('/api/clinical/wound-assessments'), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Nurse'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch wound assessments: ${response.status}`);
        }

        const data = await response.json();
        // Convert date strings to Date objects
        const assessments = data.map((w: WoundAssessment) => ({
          ...w,
          discoveredDate: new Date(w.discoveredDate),
          lastAssessment: new Date(w.lastAssessment),
          measurements: w.measurements.map((m: WoundMeasurement) => ({
            ...m,
            date: new Date(m.date)
          }))
        }));
        setWounds(assessments);
        setError(null);
      } catch (err) {
        console.error('Error fetching wound assessments:', err);
        setError(err instanceof Error ? err.message : 'Failed to load wound assessments');
      } finally {
        setLoading(false);
      }
    };

    fetchWounds();
  }, [user]);

  const getStatusBadge = (status: WoundStatus) => {
    const styles: Record<WoundStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      'new': { bg: 'bg-blue-100', text: 'text-blue-700', icon: <Plus className="w-3 h-3" /> },
      'healing': { bg: 'bg-green-100', text: 'text-green-700', icon: <TrendingDown className="w-3 h-3" /> },
      'stable': { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: <Minus className="w-3 h-3" /> },
      'deteriorating': { bg: 'bg-red-100', text: 'text-red-700', icon: <TrendingUp className="w-3 h-3" /> },
      'healed': { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: <CheckCircle className="w-3 h-3" /> },
      'infected': { bg: 'bg-red-200', text: 'text-red-800', icon: <AlertTriangle className="w-3 h-3" /> }
    };
    const s = styles[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {status}
      </span>
    );
  };

  const getWoundTypeLabel = (type: WoundType): string => {
    const labels: Record<WoundType, string> = {
      'pressure-ulcer': 'Pressure Ulcer',
      'surgical': 'Surgical',
      'diabetic-ulcer': 'Diabetic Ulcer',
      'venous-ulcer': 'Venous Ulcer',
      'arterial-ulcer': 'Arterial Ulcer',
      'traumatic': 'Traumatic',
      'burn': 'Burn',
      'skin-tear': 'Skin Tear'
    };
    return labels[type];
  };

  const getHealingTrend = (measurements: WoundMeasurement[]) => {
    if (measurements.length < 2) return null;
    const latest = measurements[measurements.length - 1].area;
    const previous = measurements[measurements.length - 2].area;
    const change = ((latest - previous) / previous) * 100;
    if (change < -5) return { icon: <TrendingDown className="w-4 h-4 text-green-500" />, text: 'Improving', color: 'text-green-600' };
    if (change > 5) return { icon: <TrendingUp className="w-4 h-4 text-red-500" />, text: 'Worsening', color: 'text-red-600' };
    return { icon: <Minus className="w-4 h-4 text-yellow-500" />, text: 'Stable', color: 'text-yellow-600' };
  };

  const filteredWounds = wounds.filter(w =>
    w.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    w.mrn.includes(searchQuery) ||
    w.location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-rose-600 to-pink-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Heart className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Wound Care</h1>
        </div>
        <p className="text-rose-100">Assessment, documentation, and healing tracking</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-rose-600 animate-spin mb-2" />
          <p className="text-gray-500">Loading wound assessments...</p>
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
              <p className="text-2xl font-bold text-gray-800">{wounds.length}</p>
              <p className="text-xs text-gray-500">Active Wounds</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{wounds.filter(w => w.status === 'healing').length}</p>
              <p className="text-xs text-gray-500">Healing</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{wounds.filter(w => w.status === 'deteriorating' || w.status === 'infected').length}</p>
              <p className="text-xs text-gray-500">Needs Attention</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white border-b">
            <div className="flex">
              {(['wounds', 'assess', 'tracking'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium capitalize ${
                    activeTab === tab ? 'text-rose-700 border-b-2 border-rose-700' : 'text-gray-500'
                  }`}
                >
                  {tab === 'wounds' ? 'All Wounds' : tab === 'assess' ? 'New Assessment' : 'Healing Trends'}
                </button>
              ))}
            </div>
          </div>

          {/* Wounds Tab */}
      {activeTab === 'wounds' && (
        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patient or location..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>

          <div className="space-y-3">
            {filteredWounds.map(wound => {
              const latestMeasurement = wound.measurements[wound.measurements.length - 1];
              const trend = getHealingTrend(wound.measurements);
              return (
                <div
                  key={wound.id}
                  onClick={() => setSelectedWound(wound)}
                  className={`bg-white rounded-lg shadow border p-4 cursor-pointer hover:shadow-md ${
                    wound.status === 'deteriorating' || wound.status === 'infected' ? 'border-l-4 border-l-red-500' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{wound.patientName}</h3>
                        <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                          {getWoundTypeLabel(wound.woundType)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">MRN: {wound.mrn} • {wound.location}</p>
                    </div>
                    {getStatusBadge(wound.status)}
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-gray-50 rounded p-2 text-center">
                      <Ruler className="w-4 h-4 mx-auto text-gray-400 mb-1" />
                      <p className="text-sm font-semibold">{latestMeasurement.area.toFixed(1)} cm²</p>
                      <p className="text-xs text-gray-500">Area</p>
                    </div>
                    <div className="bg-gray-50 rounded p-2 text-center">
                      <p className="text-sm font-semibold">{wound.stage !== 'n/a' ? wound.stage?.replace('-', ' ') : '—'}</p>
                      <p className="text-xs text-gray-500">Stage</p>
                    </div>
                    <div className="bg-gray-50 rounded p-2 text-center">
                      {trend && (
                        <>
                          <div className="flex justify-center">{trend.icon}</div>
                          <p className={`text-xs ${trend.color}`}>{trend.text}</p>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      <span>{wound.assessedBy}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{wound.lastAssessment.toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Assessment Tab */}
      {activeTab === 'assess' && (
        <div className="p-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">New Wound Assessment</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="wound-patient" className="block text-sm font-medium mb-1">Patient *</label>
                <select id="wound-patient" className="w-full border rounded-lg px-3 py-2">
                  <option value="">Select patient...</option>
                  {wounds.map(w => (
                    <option key={w.patientId} value={w.patientId}>{w.patientName} - {w.mrn}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="wound-type" className="block text-sm font-medium mb-1">Wound Type *</label>
                  <select id="wound-type" className="w-full border rounded-lg px-3 py-2">
                    <option value="pressure-ulcer">Pressure Ulcer</option>
                    <option value="surgical">Surgical</option>
                    <option value="diabetic-ulcer">Diabetic Ulcer</option>
                    <option value="venous-ulcer">Venous Ulcer</option>
                    <option value="arterial-ulcer">Arterial Ulcer</option>
                    <option value="traumatic">Traumatic</option>
                    <option value="burn">Burn</option>
                    <option value="skin-tear">Skin Tear</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="wound-location" className="block text-sm font-medium mb-1">Location *</label>
                  <input id="wound-location" type="text" className="w-full border rounded-lg px-3 py-2" placeholder="e.g., Sacrum, R heel" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="wound-length" className="block text-sm font-medium mb-1">Length (cm)</label>
                  <input id="wound-length" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="0.0" />
                </div>
                <div>
                  <label htmlFor="wound-width" className="block text-sm font-medium mb-1">Width (cm)</label>
                  <input id="wound-width" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="0.0" />
                </div>
                <div>
                  <label htmlFor="wound-depth" className="block text-sm font-medium mb-1">Depth (cm)</label>
                  <input id="wound-depth" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="0.0" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="wound-exudate" className="block text-sm font-medium mb-1">Exudate</label>
                  <select id="wound-exudate" className="w-full border rounded-lg px-3 py-2">
                    <option value="none">None</option>
                    <option value="minimal">Minimal</option>
                    <option value="moderate">Moderate</option>
                    <option value="copious">Copious</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="wound-pain-level" className="block text-sm font-medium mb-1">Pain Level (0-10)</label>
                  <input id="wound-pain-level" type="number" min="0" max="10" className="w-full border rounded-lg px-3 py-2" placeholder="0" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Tissue Type (select all)</label>
                <div className="flex flex-wrap gap-2">
                  {['Granulation', 'Epithelial', 'Slough', 'Eschar', 'Necrotic'].map(tissue => (
                    <label key={tissue} className="flex items-center gap-1 bg-gray-100 px-3 py-1 rounded-full text-sm">
                      <input type="checkbox" className="w-4 h-4" />
                      <span>{tissue}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Photo Upload</label>
                <div className="border-2 border-dashed rounded-lg p-6 text-center">
                  <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-500">Tap to upload wound photo</p>
                  <p className="text-xs text-gray-400 mt-1">Include ruler for measurement reference</p>
                </div>
              </div>

              <div>
                <label htmlFor="wound-notes" className="block text-sm font-medium mb-1">Notes</label>
                <textarea id="wound-notes" className="w-full border rounded-lg px-3 py-2" rows={2} placeholder="Assessment findings..." />
              </div>

              <button className="w-full py-3 bg-rose-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                <Plus className="w-5 h-5" /> Save Assessment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tracking Tab */}
      {activeTab === 'tracking' && (
        <div className="p-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Healing Progress</h2>
            <div className="space-y-4">
              {wounds.map(wound => {
                const trend = getHealingTrend(wound.measurements);
                const firstArea = wound.measurements[0].area;
                const latestArea = wound.measurements[wound.measurements.length - 1].area;
                const healingPercent = ((firstArea - latestArea) / firstArea) * 100;
                
                return (
                  <div key={wound.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-medium">{wound.patientName}</h3>
                        <p className="text-sm text-gray-500">{wound.location}</p>
                      </div>
                      {trend && (
                        <div className={`flex items-center gap-1 ${trend.color}`}>
                          {trend.icon}
                          <span className="text-sm font-medium">{trend.text}</span>
                        </div>
                      )}
                    </div>

                    <div className="mb-3">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-500">Healing Progress</span>
                        <span className="font-medium">{Math.max(0, healingPercent).toFixed(0)}%</span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: `${Math.max(0, Math.min(100, healingPercent))}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div>
                        <p className="text-gray-500">Initial</p>
                        <p className="font-semibold">{firstArea.toFixed(1)} cm²</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Current</p>
                        <p className="font-semibold">{latestArea.toFixed(1)} cm²</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Days</p>
                        <p className="font-semibold">{Math.round((new Date().getTime() - wound.discoveredDate.getTime()) / (1000 * 60 * 60 * 24))}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* Wound Detail Modal */}
      {selectedWound && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{selectedWound.patientName}</h2>
                <p className="text-sm text-gray-500">{selectedWound.location} • {getWoundTypeLabel(selectedWound.woundType)}</p>
              </div>
              <button onClick={() => setSelectedWound(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center">
                {getStatusBadge(selectedWound.status)}
                {selectedWound.stage !== 'n/a' && (
                  <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-sm">
                    {selectedWound.stage?.replace('-', ' ')}
                  </span>
                )}
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-medium mb-2">Measurements History</h3>
                <div className="space-y-2">
                  {selectedWound.measurements.slice().reverse().map((m, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-gray-500">{m.date.toLocaleDateString()}</span>
                      <span>{m.length} × {m.width} × {m.depth} cm ({m.area.toFixed(1)} cm²)</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-sm text-gray-500">Exudate</p>
                  <p className="font-medium capitalize">{selectedWound.exudate}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-sm text-gray-500">Pain Level</p>
                  <p className="font-medium">{selectedWound.painLevel}/10</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500 mb-1">Tissue Types</p>
                <div className="flex flex-wrap gap-1">
                  {selectedWound.tissue.map((t, idx) => (
                    <span key={idx} className="bg-white border px-2 py-0.5 rounded text-sm capitalize">{t}</span>
                  ))}
                </div>
              </div>

              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-blue-600 font-medium mb-1">Current Dressing</p>
                <p className="text-sm">{selectedWound.dressing}</p>
                <p className="text-xs text-blue-500 mt-1">Change: {selectedWound.frequency}</p>
              </div>

              {selectedWound.notes && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-500 mb-1">Notes</p>
                  <p className="text-sm">{selectedWound.notes}</p>
                </div>
              )}

              <button className="w-full py-3 bg-rose-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                <Camera className="w-5 h-5" /> Add New Assessment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WoundCarePage;
