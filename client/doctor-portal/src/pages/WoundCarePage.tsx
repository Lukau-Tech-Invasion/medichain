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
import { apiUrl, useTranslation, useProviderDirectory } from '@medichain/shared';
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

/** One stored assessment, as the API returns it. */
interface WoundAssessmentRow {
  id: string;
  patient_id: string;
  wound_id: string;
  wound_location: string;
  wound_type: string;
  length_cm: string | number | null;
  width_cm: string | number | null;
  depth_cm: string | number | null;
  tissue_type: string | null;
  drainage_amount: string | null;
  pain_level: number | null;
  notes: string | null;
  assessed_by: string;
  assessed_at: string;
}

/**
 * Map a stored wound assessment onto the shape this page renders.
 *
 * The two disagreed on every field name — the page expected `measurements[]`,
 * `tissue[]`, `patientName` and camelCase throughout, while the API returns flat
 * snake_case columns. `w.measurements.map(...)` therefore threw as soon as a
 * single wound existed, which is why the list looked fine only while it was
 * empty.
 */
function toWoundAssessment(row: WoundAssessmentRow): WoundAssessment {
  const num = (v: string | number | null) => (v === null ? 0 : Number(v));
  const length = num(row.length_cm);
  const width = num(row.width_cm);
  const assessedAt = new Date(row.assessed_at);
  const exudate = (row.drainage_amount || 'none') as WoundAssessment['exudate'];
  const pain = row.pain_level ?? 0;
  // "Needs attention" uses the rule the database's own v_wound_care_alerts view
  // already encodes, rather than inventing a clinical judgement here.
  const needsAttention = pain >= 7 || exudate === 'moderate' || exudate === 'copious';
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_id,
    mrn: row.patient_id,
    location: row.wound_location,
    woundType: row.wound_type as WoundType,
    status: needsAttention ? 'deteriorating' : 'stable',
    discoveredDate: assessedAt,
    lastAssessment: assessedAt,
    measurements: [
      {
        date: assessedAt,
        length,
        width,
        depth: num(row.depth_cm),
        area: Number((length * width).toFixed(2)),
      },
    ],
    exudate,
    tissue: (row.tissue_type || '')
      .split(',')
      .map(x => x.trim().toLowerCase())
      .filter(Boolean) as WoundAssessment['tissue'],
    edges: 'attached',
    periwound: '',
    painLevel: pain,
    dressing: '',
    frequency: '',
    notes: row.notes || '',
    photos: [],
    assessedBy: row.assessed_by,
  };
}

const WoundCarePage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'wounds' | 'assess' | 'tracking'>('wounds');
  const [wounds, setWounds] = useState<WoundAssessment[]>([]);
  const [selectedWound, setSelectedWound] = useState<WoundAssessment | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const { providerName } = useProviderDirectory(user?.walletAddress);

  // The assessment tab was previously pure markup: no state, no handler, and a
  // Save button with no onClick at all, so nothing a nurse typed was ever sent.
  const [patients, setPatients] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    patientId: '',
    woundType: 'pressure-ulcer',
    location: '',
    lengthCm: '',
    widthCm: '',
    depthCm: '',
    exudate: 'none',
    painLevel: '',
    tissueTypes: [] as string[],
    notes: '',
  });

  // The patient picker used to be built from existing wound records, so a
  // patient with no wound yet could never be selected — i.e. a first assessment
  // was impossible. Load the real roster instead.
  useEffect(() => {
    if (!user?.walletAddress) return;
    fetch(apiUrl('/api/patients?limit=100'), {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': user.walletAddress },
    })
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(body => {
        const rows = (body.data || []) as Array<{ patient_id: string; full_name: string }>;
        setPatients(rows.map(r => ({ id: r.patient_id, name: r.full_name })));
      })
      .catch(() => setPatients([]));
  }, [user?.walletAddress]);

  const saveAssessment = async () => {
    if (!user?.walletAddress) return;
    if (!form.patientId || !form.location.trim()) {
      setSaveMessage(t('docWoundCare.errPatientAndLocation'));
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    try {
      const numeric = (v: string) => (v.trim() === '' ? null : Number(v));
      const response = await fetch(apiUrl('/api/emergency/wound'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role || 'Nurse',
        },
        body: JSON.stringify({
          patient_id: form.patientId,
          wound_type: form.woundType,
          location: form.location.trim(),
          length_cm: numeric(form.lengthCm),
          width_cm: numeric(form.widthCm),
          depth_cm: numeric(form.depthCm),
          exudate: form.exudate,
          pain_level: numeric(form.painLevel),
          tissue_types: form.tissueTypes,
          notes: form.notes.trim() || null,
        }),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      setSaveMessage(t('docWoundCare.savedOk'));
      setForm({
        patientId: '', woundType: 'pressure-ulcer', location: '', lengthCm: '',
        widthCm: '', depthCm: '', exudate: 'none', painLevel: '', tissueTypes: [], notes: '',
      });
    } catch (err) {
      console.error('Failed to save wound assessment:', err);
      setSaveMessage(t('docWoundCare.errSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  /** The patient's name if the roster has loaded, otherwise their record id. */
  const patientLabel = (patientId: string) =>
    patients.find(p => p.id === patientId)?.name || patientId;

  const toggleTissue = (tissue: string) =>
    setForm(f => ({
      ...f,
      tissueTypes: f.tissueTypes.includes(tissue)
        ? f.tissueTypes.filter(x => x !== tissue)
        : [...f.tissueTypes, tissue],
    }));

  useEffect(() => {
    const fetchWounds = async () => {
      if (!user?.walletAddress) {
        setError(t('docWoundCare.errNotAuth'));
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(apiUrl('/api/emergency/wound/list'), {
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
        setWounds((Array.isArray(data) ? data : []).map(toWoundAssessment));
        setError(null);
      } catch (err) {
        console.error('Error fetching wound assessments:', err);
        setError(err instanceof Error ? err.message : t('docWoundCare.errLoad'));
      } finally {
        setLoading(false);
      }
    };

    fetchWounds();
  }, [user]);

  // Fetch wound detail when selected
  useEffect(() => {
    if (!selectedWound || !user?.walletAddress) return;
    const fetchWoundDetail = async () => {
      try {
        const response = await fetch(apiUrl(`/api/emergency/wound/${selectedWound.id}`), {
          headers: {
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Nurse',
          },
        });
        if (response.ok) {
          const data = await response.json();
          if (data && data.id) {
            setSelectedWound({
              ...data,
              discoveredDate: new Date(data.discoveredDate || data.discovered_date || selectedWound.discoveredDate),
              lastAssessment: new Date(data.lastAssessment || data.last_assessment || selectedWound.lastAssessment),
              measurements: (data.measurements || []).map((m: WoundMeasurement & { date: string }) => ({
                ...m,
                date: new Date(m.date)
              }))
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch wound detail:', err);
      }
    };
    fetchWoundDetail();
  }, [selectedWound?.id, user]);

  const getStatusBadge = (status: WoundStatus) => {
    const styles: Record<WoundStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      'new': { bg: 'bg-notice-subtle', text: 'text-notice-subtle-fg', icon: <Plus className="w-3 h-3" /> },
      'healing': { bg: 'bg-ok-subtle', text: 'text-ok-subtle-fg', icon: <TrendingDown className="w-3 h-3" /> },
      'stable': { bg: 'bg-caution-subtle', text: 'text-caution-subtle-fg', icon: <Minus className="w-3 h-3" /> },
      'deteriorating': { bg: 'bg-critical-subtle', text: 'text-critical-subtle-fg', icon: <TrendingUp className="w-3 h-3" /> },
      'healed': { bg: 'bg-ok-subtle', text: 'text-ok-subtle-fg', icon: <CheckCircle className="w-3 h-3" /> },
      'infected': { bg: 'bg-red-200', text: 'text-critical-subtle-fg', icon: <AlertTriangle className="w-3 h-3" /> }
    };
    const s = styles[status];
    const statusLabels: Record<WoundStatus, string> = {
      'new': t('docWoundCare.statusNew'),
      'healing': t('docWoundCare.statusHealing'),
      'stable': t('docWoundCare.statusStable'),
      'deteriorating': t('docWoundCare.statusDeteriorating'),
      'healed': t('docWoundCare.statusHealed'),
      'infected': t('docWoundCare.statusInfected'),
    };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {statusLabels[status]}
      </span>
    );
  };

  const getWoundTypeLabel = (type: WoundType): string => {
    const labels: Record<WoundType, string> = {
      'pressure-ulcer': t('docWoundCare.wtPressure'),
      'surgical': t('docWoundCare.wtSurgical'),
      'diabetic-ulcer': t('docWoundCare.wtDiabetic'),
      'venous-ulcer': t('docWoundCare.wtVenous'),
      'arterial-ulcer': t('docWoundCare.wtArterial'),
      'traumatic': t('docWoundCare.wtTraumatic'),
      'burn': t('docWoundCare.wtBurn'),
      'skin-tear': t('docWoundCare.wtSkinTear')
    };
    return labels[type];
  };

  const getHealingTrend = (measurements: WoundMeasurement[]) => {
    if (measurements.length < 2) return null;
    const latest = measurements[measurements.length - 1].area;
    const previous = measurements[measurements.length - 2].area;
    const change = ((latest - previous) / previous) * 100;
    if (change < -5) return { icon: <TrendingDown className="w-4 h-4 text-green-500" />, text: t('docWoundCare.trendImproving'), color: 'text-ok-subtle-fg' };
    if (change > 5) return { icon: <TrendingUp className="w-4 h-4 text-red-500" />, text: t('docWoundCare.trendWorsening'), color: 'text-critical-subtle-fg' };
    return { icon: <Minus className="w-4 h-4 text-yellow-500" />, text: t('docWoundCare.trendStable'), color: 'text-caution-subtle-fg' };
  };

  const filteredWounds = wounds.filter(w =>
    patientLabel(w.patientId).toLowerCase().includes(searchQuery.toLowerCase()) ||
    w.mrn.includes(searchQuery) ||
    w.location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-rose-600 to-pink-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Heart className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docWoundCare.title')}</h1>
        </div>
        <p className="text-critical-fg">{t('docWoundCare.subtitle')}</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-critical-subtle-fg animate-spin mb-2" />
          <p className="text-content-muted">{t('docWoundCare.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-critical-subtle border border-critical rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-critical-subtle-fg">{error}</p>
            <p className="text-xs text-red-500 mt-1">{t('docWoundCare.errApiHint')}</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-content-secondary">{wounds.length}</p>
              <p className="text-xs text-content-muted">{t('docWoundCare.activeWounds')}</p>
            </div>
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-ok-subtle-fg">{wounds.filter(w => w.status === 'healing').length}</p>
              <p className="text-xs text-content-muted">{t('docWoundCare.healing')}</p>
            </div>
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-critical-subtle-fg">{wounds.filter(w => w.status === 'deteriorating' || w.status === 'infected').length}</p>
              <p className="text-xs text-content-muted">{t('docWoundCare.needsAttention')}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-surface border-b">
            <div className="flex">
              {(['wounds', 'assess', 'tracking'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium capitalize ${
                    activeTab === tab ? 'text-critical-subtle-fg border-b-2 border-rose-700' : 'text-content-muted'
                  }`}
                >
                  {tab === 'wounds' ? t('docWoundCare.tabAllWounds') : tab === 'assess' ? t('docWoundCare.tabNewAssessment') : t('docWoundCare.tabHealingTrends')}
                </button>
              ))}
            </div>
          </div>

          {/* Wounds Tab */}
      {activeTab === 'wounds' && (
        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('docWoundCare.searchPh')}
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
                  className={`bg-surface rounded-lg shadow border p-4 cursor-pointer hover:shadow-md ${
                    wound.status === 'deteriorating' || wound.status === 'infected' ? 'border-l-4 border-l-red-500' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{patientLabel(wound.patientId)}</h3>
                        <span className="text-xs bg-surface-sunken px-2 py-0.5 rounded">
                          {getWoundTypeLabel(wound.woundType)}
                        </span>
                      </div>
                      <p className="text-sm text-content-muted">{t('docWoundCare.mrnLocation', { mrn: wound.mrn, location: wound.location })}</p>
                    </div>
                    {getStatusBadge(wound.status)}
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-surface-sunken rounded p-2 text-center">
                      <Ruler className="w-4 h-4 mx-auto text-content-muted mb-1" />
                      <p className="text-sm font-semibold">{latestMeasurement.area.toFixed(1)} cm²</p>
                      <p className="text-xs text-content-muted">{t('docWoundCare.area')}</p>
                    </div>
                    <div className="bg-surface-sunken rounded p-2 text-center">
                      <p className="text-sm font-semibold">{wound.stage !== 'n/a' ? wound.stage?.replace('-', ' ') : '—'}</p>
                      <p className="text-xs text-content-muted">{t('docWoundCare.stage')}</p>
                    </div>
                    <div className="bg-surface-sunken rounded p-2 text-center">
                      {trend && (
                        <>
                          <div className="flex justify-center">{trend.icon}</div>
                          <p className={`text-xs ${trend.color}`}>{trend.text}</p>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-content-muted">
                    <div className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      <span>{providerName(wound.assessedBy)}</span>
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
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docWoundCare.newAssessment')}</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="wound-patient" className="block text-sm font-medium mb-1">{t('docWoundCare.patientReq')}</label>
                <select id="wound-patient" className="w-full border rounded-lg px-3 py-2"
                  value={form.patientId} onChange={(e) => setForm(f => ({ ...f, patientId: e.target.value }))}>
                  <option value="">{t('docWoundCare.selectPatient')}</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.name} - {p.id}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="wound-type" className="block text-sm font-medium mb-1">{t('docWoundCare.woundTypeReq')}</label>
                  <select id="wound-type" className="w-full border rounded-lg px-3 py-2"
                    value={form.woundType} onChange={(e) => setForm(f => ({ ...f, woundType: e.target.value }))}>
                    <option value="pressure-ulcer">{t('docWoundCare.wtPressure')}</option>
                    <option value="surgical">{t('docWoundCare.wtSurgical')}</option>
                    <option value="diabetic-ulcer">{t('docWoundCare.wtDiabetic')}</option>
                    <option value="venous-ulcer">{t('docWoundCare.wtVenous')}</option>
                    <option value="arterial-ulcer">{t('docWoundCare.wtArterial')}</option>
                    <option value="traumatic">{t('docWoundCare.wtTraumatic')}</option>
                    <option value="burn">{t('docWoundCare.wtBurn')}</option>
                    <option value="skin-tear">{t('docWoundCare.wtSkinTear')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="wound-location" className="block text-sm font-medium mb-1">{t('docWoundCare.locationReq')}</label>
                  <input id="wound-location" type="text" className="w-full border rounded-lg px-3 py-2" placeholder={t('docWoundCare.locationPh')}
                    value={form.location} onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="wound-length" className="block text-sm font-medium mb-1">{t('docWoundCare.lengthCm')}</label>
                  <input id="wound-length" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="0.0"
                    value={form.lengthCm} onChange={(e) => setForm(f => ({ ...f, lengthCm: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="wound-width" className="block text-sm font-medium mb-1">{t('docWoundCare.widthCm')}</label>
                  <input id="wound-width" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="0.0"
                    value={form.widthCm} onChange={(e) => setForm(f => ({ ...f, widthCm: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="wound-depth" className="block text-sm font-medium mb-1">{t('docWoundCare.depthCm')}</label>
                  <input id="wound-depth" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="0.0"
                    value={form.depthCm} onChange={(e) => setForm(f => ({ ...f, depthCm: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="wound-exudate" className="block text-sm font-medium mb-1">{t('docWoundCare.exudate')}</label>
                  <select id="wound-exudate" className="w-full border rounded-lg px-3 py-2"
                    value={form.exudate} onChange={(e) => setForm(f => ({ ...f, exudate: e.target.value }))}>
                    <option value="none">{t('docWoundCare.exNone')}</option>
                    <option value="minimal">{t('docWoundCare.exMinimal')}</option>
                    <option value="moderate">{t('docWoundCare.exModerate')}</option>
                    <option value="copious">{t('docWoundCare.exCopious')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="wound-pain-level" className="block text-sm font-medium mb-1">{t('docWoundCare.painLevel')}</label>
                  <input id="wound-pain-level" type="number" min="0" max="10" className="w-full border rounded-lg px-3 py-2" placeholder="0"
                    value={form.painLevel} onChange={(e) => setForm(f => ({ ...f, painLevel: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t('docWoundCare.tissueType')}</label>
                <div className="flex flex-wrap gap-2">
                  {[t('docWoundCare.tsGranulation'), t('docWoundCare.tsEpithelial'), t('docWoundCare.tsSlough'), t('docWoundCare.tsEschar'), t('docWoundCare.tsNecrotic')].map(tissue => (
                    <label key={tissue} className="flex items-center gap-1 bg-surface-sunken px-3 py-1 rounded-full text-sm">
                      <input type="checkbox" className="w-4 h-4"
                        checked={form.tissueTypes.includes(tissue)} onChange={() => toggleTissue(tissue)} />
                      <span>{tissue}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t('docWoundCare.photoUpload')}</label>
                <div className="border-2 border-dashed rounded-lg p-6 text-center">
                  <Upload className="w-8 h-8 mx-auto text-content-muted mb-2" />
                  <p className="text-sm text-content-muted">{t('docWoundCare.tapToUpload')}</p>
                  <p className="text-xs text-content-muted mt-1">{t('docWoundCare.includeRuler')}</p>
                </div>
              </div>

              <div>
                <label htmlFor="wound-notes" className="block text-sm font-medium mb-1">{t('docWoundCare.notes')}</label>
                <textarea id="wound-notes" className="w-full border rounded-lg px-3 py-2" rows={2} placeholder={t('docWoundCare.notesPh')}
                  value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              {saveMessage && (
                <p className="text-sm text-center text-content-secondary" role="status">{saveMessage}</p>
              )}
              <button
                onClick={saveAssessment}
                disabled={saving}
                className="w-full py-3 bg-critical text-critical-fg rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Plus className="w-5 h-5" /> {t('docWoundCare.saveAssessment')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tracking Tab */}
      {activeTab === 'tracking' && (
        <div className="p-4">
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docWoundCare.healingProgress')}</h2>
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
                        <h3 className="font-medium">{patientLabel(wound.patientId)}</h3>
                        <p className="text-sm text-content-muted">{wound.location}</p>
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
                        <span className="text-content-muted">{t('docWoundCare.healingProgress')}</span>
                        <span className="font-medium">{Math.max(0, healingPercent).toFixed(0)}%</span>
                      </div>
                      <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: `${Math.max(0, Math.min(100, healingPercent))}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div>
                        <p className="text-content-muted">{t('docWoundCare.initial')}</p>
                        <p className="font-semibold">{firstArea.toFixed(1)} cm²</p>
                      </div>
                      <div>
                        <p className="text-content-muted">{t('docWoundCare.current')}</p>
                        <p className="font-semibold">{latestArea.toFixed(1)} cm²</p>
                      </div>
                      <div>
                        <p className="text-content-muted">{t('docWoundCare.days')}</p>
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
          <div className="bg-surface rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{patientLabel(selectedWound.patientId)}</h2>
                <p className="text-sm text-content-muted">{selectedWound.location} • {getWoundTypeLabel(selectedWound.woundType)}</p>
              </div>
              <button onClick={() => setSelectedWound(null)} className="text-content-muted hover:text-content-muted text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center">
                {getStatusBadge(selectedWound.status)}
                {selectedWound.stage !== 'n/a' && (
                  <span className="bg-surface-sunken text-content-secondary px-2 py-1 rounded text-sm">
                    {selectedWound.stage?.replace('-', ' ')}
                  </span>
                )}
              </div>

              <div className="bg-surface-sunken rounded-lg p-4">
                <h3 className="font-medium mb-2">{t('docWoundCare.measurementsHistory')}</h3>
                <div className="space-y-2">
                  {selectedWound.measurements.slice().reverse().map((m, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-content-muted">{m.date.toLocaleDateString()}</span>
                      <span>{m.length} × {m.width} × {m.depth} cm ({m.area.toFixed(1)} cm²)</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-surface-sunken rounded-lg p-3">
                  <p className="text-sm text-content-muted">{t('docWoundCare.exudate')}</p>
                  <p className="font-medium capitalize">{selectedWound.exudate}</p>
                </div>
                <div className="bg-surface-sunken rounded-lg p-3">
                  <p className="text-sm text-content-muted">{t('docWoundCare.painLevel')}</p>
                  <p className="font-medium">{t('docWoundCare.painValue', { value: selectedWound.painLevel })}</p>
                </div>
              </div>

              <div className="bg-surface-sunken rounded-lg p-4">
                <p className="text-sm text-content-muted mb-1">{t('docWoundCare.tissueTypes')}</p>
                <div className="flex flex-wrap gap-1">
                  {selectedWound.tissue.map((t, idx) => (
                    <span key={idx} className="bg-surface border px-2 py-0.5 rounded text-sm capitalize">{t}</span>
                  ))}
                </div>
              </div>

              <div className="bg-notice-subtle rounded-lg p-4">
                <p className="text-sm text-notice-subtle-fg font-medium mb-1">{t('docWoundCare.currentDressing')}</p>
                <p className="text-sm">{selectedWound.dressing}</p>
                <p className="text-xs text-blue-500 mt-1">{t('docWoundCare.changeFreq', { freq: selectedWound.frequency })}</p>
              </div>

              {selectedWound.notes && (
                <div className="bg-surface-sunken rounded-lg p-4">
                  <p className="text-sm text-content-muted mb-1">{t('docWoundCare.notes')}</p>
                  <p className="text-sm">{selectedWound.notes}</p>
                </div>
              )}

              <button className="w-full py-3 bg-critical text-critical-fg rounded-lg font-medium flex items-center justify-center gap-2">
                <Camera className="w-5 h-5" /> {t('docWoundCare.addNewAssessment')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WoundCarePage;
