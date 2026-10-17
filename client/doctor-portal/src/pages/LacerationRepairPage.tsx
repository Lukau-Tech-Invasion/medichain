import React, { useState, useEffect, useRef } from 'react';
import {
  Scissors,
  Search,
  Plus,
  Clock,
  CheckCircle,
  AlertTriangle,
  Calendar,
  User,
  MapPin,
  Activity,
  ClipboardCheck,
  Loader2,
  AlertCircle
} from 'lucide-react';
import PatientSelect from '../components/PatientSelect';
import StaffName from '../components/StaffName';
import { WoundPhotoPicker, WoundPhotoViewer } from '../components/WoundPhotos';
import {
  createLaceration,
  getApiClient,
  getApiErrorMessage,
  useTranslation,
  clickable,
} from '@medichain/shared';
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
  injuryDate?: Date;
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
  photos: string[];
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

/**
 * The API's laceration repair, as this screen needs it.
 *
 * `GET /api/clinical/laceration-repairs` returns `LacerationRepairEntity`, and
 * this screen's `LacerationRepair` above is not that shape: `length_cm` vs
 * `length`, `closure_technique` vs `closureMethod`, `performed_at` vs
 * `repairDate`, `anesthetic_agent` vs `anesthesia`. The rows were previously
 * handed to `setRepairs` raw, so every card rendered `undefined`.
 *
 * Fields this screen collects that the typed columns have no home for -- the
 * wound type, the depth *category* (the column is `depth_cm`, a number) and
 * whether antibiotics were prescribed -- are carried in the record's `data`
 * blob, which is where the handler puts the whole submission.
 */
function toLacerationRepair(raw: Record<string, unknown>): LacerationRepair {
  const blob = (raw.data ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (raw[key] !== undefined && raw[key] !== null) return raw[key];
      if (blob[key] !== undefined && blob[key] !== null) return blob[key];
    }
    return undefined;
  };
  const str = (...keys: string[]): string => {
    const v = pick(...keys);
    return typeof v === 'string' ? v : v === undefined ? '' : String(v);
  };
  const num = (...keys: string[]): number => {
    const v = pick(...keys);
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : 0;
  };
  // The repair timestamp cannot establish when the injury occurred.
  const performedAt = str('performed_at', 'created_at');
  const injuryAt = str('injury_date', 'injury_at');

  return {
    id: str('id', 'record_id'),
    patientId: str('patient_id'),
    patientName: str('patient_name') || str('patient_id'),
    mrn: str('mrn', 'patient_id'),
    injuryDate: injuryAt && Number.isFinite(Date.parse(injuryAt)) ? new Date(injuryAt) : undefined,
    repairDate: new Date(performedAt),
    location: str('location'),
    woundType: (str('wound_type') || 'laceration') as WoundType,
    length: num('length_cm'),
    depth: str('depth_category'),
    closureMethod: (str('closure_technique') || 'sutures') as ClosureMethod,
    sutureType: [str('suture_size'), str('suture_material')].filter(Boolean).join(' ') || undefined,
    sutureCount: (pick('number_of_sutures') as number | undefined) ?? undefined,
    anesthesia: str('anesthetic_agent', 'anesthesia_type'),
    tetanusGiven: pick('tetanus_given') === true,
    antibioticsPrescribed: pick('antibiotics_prescribed') === true,
    // The form has no status control and the record carries no status column,
    // so every repair documented here is a completed one. Claiming any other
    // status would be asserting something nobody recorded.
    status: 'completed',
    performedBy: str('performed_by'),
    followUpDate: str('follow_up_date') ? new Date(str('follow_up_date')) : undefined,
    notes: str('notes') || undefined,
    photos: Array.isArray(blob.photos) ? blob.photos.filter((photo): photo is string => typeof photo === 'string') : [],
  };
}

/** Read the durable list and map its stored fields for the repair cards. */
async function readLacerationRepairs(): Promise<LacerationRepair[]> {
  const result = await getApiClient().get<
    { data?: Record<string, unknown>[]; repairs?: Record<string, unknown>[] } | Record<string, unknown>[]
  >('/api/clinical/laceration-repairs');
  const rows = Array.isArray(result) ? result : (result.data ?? result.repairs ?? []);
  return rows.map(toLacerationRepair);
}

const LacerationRepairPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'repairs' | 'new' | 'follow-up'>('repairs');
  const [repairs, setRepairs] = useState<LacerationRepair[]>([]);
  const [selectedRepair, setSelectedRepair] = useState<LacerationRepair | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The page-level roster existed only to fill a patient dropdown.
  // `PatientSelect` queries the server as the clinician types, so the
  // whole roster is no longer fetched into this screen.
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
  const [saving, setSaving] = useState(false);
  const submissionPending = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [photoHashes, setPhotoHashes] = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);

  // The roster fetch that filled the patient dropdown is gone with it:
  // `PatientSelect` asks the server as the clinician types.

  useEffect(() => {
    const fetchRepairs = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        setError(null);
        
        setRepairs(await readLacerationRepairs());
      } catch (err) {
        console.error('Error fetching repairs:', err);
        setError(t('docLaceration.errLoad'));
        setRepairs([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchRepairs();
  }, [user, t]);

  /** Retry only the list read; a confirmed repair is never submitted again here. */
  const refreshRepairList = async () => {
    setRefreshing(true);
    try {
      setRepairs(await readLacerationRepairs());
      setRefreshWarning(null);
    } catch (err) {
      console.error('Saved repair list refresh failed:', err);
      setRefreshWarning(t('docLaceration.savedRefreshFailed'));
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * File the repair.
   *
   * The Save button had no `onClick` at all: the form collected everything and
   * then dropped it. `createLaceration` and the handler behind it have existed
   * the whole time -- `POST /api/clinical/laceration` -- with no caller
   * anywhere in either application.
   *
   * # What this sends, and what it deliberately does not
   *
   * Only what the clinician actually entered. The form pre-fills a suture
   * gauge, an anaesthetic agent and a depth category, and those are visible
   * controls the clinician can see and change, so sending them is honest. The
   * two numbers are not: `length` and `sutureCount` both initialise to 0, and
   * **an unmeasured wound is not a zero-centimetre wound**. A length of zero is
   * refused before sending, and a suture count of zero is omitted rather than
   * asserted.
   *
   * # Names
   *
   * The screen's names are not the API's. `sutureType` is one control holding
   * both gauge and material ('4-0 Nylon'), which the record stores as
   * `suture_size` and `suture_material` -- removal timing depends on both. The
   * wound type, the depth *category* and the antibiotics flag have no typed
   * column at all (the column is `depth_cm`, a number), so they travel under
   * their own names and land in the record's `data` blob, which is what
   * `toLacerationRepair` reads them back out of.
   */
  const handleSaveRepair = async () => {
    if (!user || submissionPending.current || photoUploading) return;
    setSaveError(null);
    setSaved(null);

    if (!newRepair.patientId || !newRepair.location.trim()) {
      setSaveError(t('docLaceration.errPatientAndSiteRequired'));
      return;
    }
    if (!(newRepair.length > 0)) {
      setSaveError(t('docLaceration.errLengthRequired'));
      return;
    }

    // '4-0 Nylon' -> size '4-0', material 'Nylon'.
    const usesSutures =
      newRepair.closureMethod === 'sutures' || newRepair.closureMethod === 'combination';
    const [sutureSize, ...materialWords] = (newRepair.sutureType || '').split(' ');
    const sutureMaterial = materialWords.join(' ');

    const payload: Record<string, unknown> = {
      patient_id: newRepair.patientId,
      location: newRepair.location.trim(),
      length_cm: newRepair.length,
      closure_technique: newRepair.closureMethod,
      wound_type: newRepair.woundType,
      depth_category: newRepair.depth,
      tetanus_given: newRepair.tetanusGiven,
      antibiotics_prescribed: newRepair.antibioticsPrescribed,
      performed_at: new Date().toISOString(),
    };
    if (usesSutures && sutureSize && sutureMaterial) {
      payload.suture_size = sutureSize;
      payload.suture_material = sutureMaterial;
    }
    if (newRepair.sutureCount > 0) payload.number_of_sutures = newRepair.sutureCount;
    if (newRepair.anesthesia.trim()) payload.anesthetic_agent = newRepair.anesthesia.trim();
    if (newRepair.notes.trim()) payload.notes = newRepair.notes.trim();
    if (photoHashes.length > 0) payload.photos = photoHashes;

    submissionPending.current = true;
    try {
      setSaving(true);
      const result = await createLaceration(payload);
      const recordId = (result as { record_id?: string })?.record_id;
      setSaved(recordId || t('docLaceration.savedFallback'));

      // The write is confirmed. Clear it before reading the list so a failed
      // refresh cannot leave this saved draft available for another submission.
      setNewRepair({
        patientId: '',
        location: '',
        woundType: 'laceration',
        length: 0,
        depth: 'superficial',
        closureMethod: 'sutures',
        sutureType: '4-0 Nylon',
        sutureCount: 0,
        anesthesia: '1% Lidocaine',
        tetanusGiven: false,
        antibioticsPrescribed: false,
        notes: '',
      });
      setActiveTab('repairs');
      setPhotoHashes([]);
      await refreshRepairList();
    } catch (err) {
      // Stop here, and say so. Falling through to a cleared form would
      // announce success for a write that never happened.
      setSaveError(getApiErrorMessage(err, t('docLaceration.errSaveFailed')));
    } finally {
      submissionPending.current = false;
      setSaving(false);
    }
  };

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
      <div className="bg-gradient-to-r from-pink-700 to-rose-800 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Scissors className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docLaceration.title')}</h1>
        </div>
        <p className="text-white">{t('docLaceration.subtitle')}</p>
      </div>

      {/* Loading State */}
      {saved && <div role="status" className="m-4 bg-ok-subtle border border-ok rounded-lg p-3">
        <p className="text-sm text-ok-subtle-fg">{t('docLaceration.savedAs', { id: saved })}</p>
      </div>}
      {refreshWarning && <div role="alert" className="m-4 bg-caution-subtle border border-caution rounded-lg p-3">
        <p>{refreshWarning}</p>
        <button type="button" disabled={refreshing || saving} onClick={() => void refreshRepairList()}
          className="mt-2 rounded border border-border-interactive p-2">
          {refreshing ? t('docLaceration.loading') : t('docLaceration.retryListRefresh')}
        </button>
      </div>}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-content-secondary animate-spin mb-2" />
          <p className="text-content-muted">{t('docLaceration.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-critical-subtle border border-critical rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-critical flex-shrink-0" />
          <div>
            <p className="text-sm text-critical-subtle-fg">{error}</p>
            <p className="text-xs text-critical mt-1">{t('docLaceration.errApiHint')}</p>
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
                  disabled={saving || photoUploading}
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
                {...clickable(() => setSelectedRepair(repair))}
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
                  <div className="flex items-center gap-2 text-sm mb-1 min-h-[24px] py-1">
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
                    <StaffName id={repair.performedBy} />
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

            <fieldset disabled={saving} className="space-y-4">
              <div>
                <PatientSelect
                  id="laceration-patient"
                  label={t('docLaceration.patientReq')}
                  value={newRepair.patientId}
                  disabled={saving || photoUploading || photoHashes.length > 0}
                  onChange={(selectedPatientId) => setNewRepair({ ...newRepair, patientId: selectedPatientId })}
                />
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

              <WoundPhotoPicker patientId={newRepair.patientId} hashes={photoHashes}
                onChange={setPhotoHashes} onBusy={setPhotoUploading} />

              {saveError && (
                <div role="alert" className="bg-critical-subtle border border-critical rounded-lg p-3">
                  <p className="text-sm text-critical-subtle-fg">{saveError}</p>
                </div>
              )}

              <button
                type="button"
                onClick={handleSaveRepair}
                disabled={saving || photoUploading}
                className="w-full py-3 bg-brand text-brand-fg rounded-lg font-medium flex items-center justify-center gap-2 disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed min-h-[24px]"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                {saving ? t('docLaceration.saving') : t('docLaceration.saveRepair')}
              </button>
            </fieldset>
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
                  <p className="font-medium">{selectedRepair.injuryDate?.toLocaleDateString() ?? t('docLaceration.notRecorded')}</p>
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
                  <div><span className="text-content-muted">{t('docLaceration.lblAnesthesia')}</span> {selectedRepair.anesthesia || t('docLaceration.notRecorded')}</div>
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
              <WoundPhotoViewer key={selectedRepair.id} patientId={selectedRepair.patientId} hashes={selectedRepair.photos} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LacerationRepairPage;
