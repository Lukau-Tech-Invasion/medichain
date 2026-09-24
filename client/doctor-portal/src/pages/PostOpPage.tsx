import React, { useState, useEffect } from 'react';
import { Activity, User, CheckCircle, AlertTriangle, ThermometerSun } from 'lucide-react';
import PatientSelect from '../components/PatientSelect';
import { useAuthStore } from '../store/authStore';
import { getPatients, createPostOp, getApiClient, useTranslation, formatTimestamp, useScoringCatalog, aldreteTotal, bandFor } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientProfile } from '@medichain/shared';

/** `null` until the clinician scores that component. */
type AldreteValue = 0 | 1 | 2 | null;
interface AldreteCriteria {
  activity: AldreteValue;
  respiration: AldreteValue;
  circulation: AldreteValue;
  consciousness: AldreteValue;
  oxygenSaturation: AldreteValue;
}

type Nausea = 'none' | 'mild' | 'moderate' | 'severe';
type Bleeding = 'none' | 'minimal' | 'moderate' | 'significant';

/** Every vital is a string while it is being typed; '' means not taken. */
interface VitalsForm {
  bp: string;
  hr: string;
  rr: string;
  spo2: string;
  temp: string;
}

/** Only the vitals someone actually took, as numbers where they are numbers. */
function takenVitals(v: VitalsForm): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (v.bp.trim()) out.bp = v.bp.trim();
  for (const key of ['hr', 'rr', 'spo2', 'temp'] as const) {
    const n = parseFloat(v[key]);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

interface PostOpNote {
  id: string;
  patientId: string;
  patientName: string;
  documentedBy: string;
  documentedAt: string;
  procedure: string;
  surgeon: string;
  anesthesiaType: string;
  arrivalTime: string;
  aldrete: AldreteCriteria;
  /** The server's total; absent when not every component was scored. */
  alderetScore?: number | null;
  /** The server's reading of the total against the recovery threshold. */
  readyForDischarge?: boolean | null;
  vitals: Record<string, string | number>;
  painScore?: number | null;
  nauseaVomiting?: Nausea | '';
  bleeding?: Bleeding | '';
  urineOutput: string;
  fluidIntake: string;
  oralIntake: string;
  ivAccess: string;
  medications: string;
  dressingStatus: string;
  drains: string;
  dischargeCriteria: string[];
  dischargeTime: string;
  dischargeDisposition: string;
  complications: string;
  notes: string;
}


/**
 * What this endpoint returns, as this page already reads it.
 *
 * `res.json()` was `any`, so a field this endpoint does not return typechecked
 * anyway and showed up as a blank panel instead of a compile error. The union
 * below is the one the call site already handles -- the list endpoints are
 * genuinely inconsistent about enveloping -- so naming it changes nothing at
 * run time and makes the reads checkable.
 */
type RecordList = { records?: PostOpNote[]; notes?: PostOpNote[] } | PostOpNote[];

const aldreteDescriptions = {
  activity: { 2: 'Moves all extremities', 1: 'Moves two extremities', 0: 'Unable to move' },
  respiration: { 2: 'Breathes deeply, coughs', 1: 'Dyspnea, limited breathing', 0: 'Apneic' },
  circulation: { 2: 'BP ±20% of pre-op', 1: 'BP ±20-50% of pre-op', 0: 'BP ±50% of pre-op' },
  consciousness: { 2: 'Fully awake', 1: 'Arousable', 0: 'Unresponsive' },
  oxygenSaturation: { 2: 'SpO2 >92% on room air', 1: 'Needs O2 for SpO2 >90%', 0: 'SpO2 <90% with O2' }
};

const dischargeCriteriaList = [
  'Aldrete score ≥9', 'Stable vital signs x30min', 'Pain controlled', 'Minimal nausea',
  'No significant bleeding', 'Able to ambulate (if appropriate)', 'Voided or catheter plan',
  'Tolerates fluids', 'Responsible adult present', 'Discharge instructions given',
  'Prescriptions provided', 'Follow-up scheduled'
];

const PostOpPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [notes, setNotes] = useState<PostOpNote[]>([]);
  const [activeTab, setActiveTab] = useState<'assessment' | 'history'>('assessment');
  const [selectedPatient, setSelectedPatient] = useState('');

  const [procedure, setProcedure] = useState('');
  const [surgeon, setSurgeon] = useState('');
  const [anesthesiaType, setAnesthesiaType] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  // Nothing is pre-scored and no vital is pre-filled. Every component used to
  // start at 2 and the vitals at 120/80, 80, 16, 98%, 36.8 C, so an untouched
  // form was filed as a normal patient scoring 10 -- "ready for discharge" --
  // about someone nobody had assessed (CLAUDE.md rules 9 and 12).
  const [aldrete, setAldrete] = useState<AldreteCriteria>({
    activity: null, respiration: null, circulation: null, consciousness: null, oxygenSaturation: null
  });
  const [vitals, setVitals] = useState<VitalsForm>({ bp: '', hr: '', rr: '', spo2: '', temp: '' });
  const [painScore, setPainScore] = useState<number | null>(null);
  const [nauseaVomiting, setNauseaVomiting] = useState<Nausea | ''>('');
  const [bleeding, setBleeding] = useState<Bleeding | ''>('');
  const { catalog } = useScoringCatalog();
  const [urineOutput, setUrineOutput] = useState('');
  const [fluidIntake, setFluidIntake] = useState('');
  const [oralIntake, setOralIntake] = useState('');
  const [ivAccess, setIvAccess] = useState('');
  const [medications, setMedications] = useState('');
  const [dressingStatus, setDressingStatus] = useState('');
  const [drains, setDrains] = useState('');
  const [selectedCriteria, setSelectedCriteria] = useState<string[]>([]);
  const [dischargeTime, setDischargeTime] = useState('');
  const [dischargeDisposition, setDischargeDisposition] = useState('');
  const [complications, setComplications] = useState('');
  const [notes2, setNotes2] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const pts = await getPatients();
        setPatients(pts);
      } catch (err) {
        console.error('Failed to load patients:', err);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 'history' && selectedPatient && user) {
      const fetchHistory = async () => {
        try {
          const data = await getApiClient().get<RecordList>(`/api/surgical/post-op/patient/${selectedPatient}`);
          const records = Array.isArray(data) ? data : (data.records || data.notes || []);
          setNotes(prev => {
            const existingIds = new Set(prev.map((n: PostOpNote) => n.id));
            return [...prev, ...records.filter((r: PostOpNote) => !existingIds.has(r.id))];
          });
        } catch (e) {
          console.error('Failed to fetch post-op history:', e);
        }
      };
      fetchHistory();
    }
  }, [activeTab, selectedPatient, user]);

  // A preview only: the total is recomputed and stored by the server, and the
  // threshold comes from the scoring catalog (rule 8). `null` until every
  // component is scored.
  const aldreteScore = aldreteTotal(aldrete, catalog);
  const aldreteBand = aldreteScore === null ? null : bandFor(aldreteScore, catalog?.aldrete?.bands);
  const readyForDischarge = aldreteBand === 'ready';

  const handleSubmit = async () => {
    if (!selectedPatient) {
      showError(t('docPostOp.errorSelectPatient'));
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const note: PostOpNote = {
      id: '',
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      documentedBy: user?.userId ?? '',
      documentedAt: new Date().toISOString(),
      procedure, surgeon, anesthesiaType, arrivalTime, aldrete,
      vitals: takenVitals(vitals),
      painScore: painScore ?? undefined,
      nauseaVomiting: nauseaVomiting || undefined,
      bleeding: bleeding || undefined,
      urineOutput, fluidIntake, oralIntake, ivAccess,
      medications, dressingStatus, drains,
      dischargeCriteria: selectedCriteria, dischargeTime, dischargeDisposition,
      complications, notes: notes2
    };
    let created: { id?: string };
    try {
      created = await createPostOp(note);
    } catch (err) {
      console.error('Failed to save post-op note:', err);
      // Stop here. Falling through added the record to the local list
      // and toasted success for a write that never happened.
      showError(t('common.saveFailed'));
      return;
    }
    // The server assigns the id and scores the assessment; the local copy
    // carries both so the history's de-duplication by id still holds.
    setNotes([{ ...note, id: created.id ?? '', alderetScore: aldreteScore, readyForDischarge: aldreteScore === null ? null : readyForDischarge }, ...notes]);
    showSuccess(t('docPostOp.saved'));
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-700 to-purple-800 text-white p-6">
        <div className="flex items-center gap-3">
          <Activity className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docPostOp.title')}</h1>
            <p className="text-white">{t('docPostOp.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Aldrete Score Banner */}
      <div className={`p-4 flex items-center justify-between ${aldreteScore === null ? 'bg-surface-sunken' : readyForDischarge ? 'bg-ok-subtle' : 'bg-caution-subtle'}`}>
        <div className="flex items-center gap-3">
          {aldreteScore === null ? null : readyForDischarge ? (
            <CheckCircle className="w-6 h-6 text-ok-subtle-fg" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-caution-subtle-fg" />
          )}
          <span className={`font-semibold ${aldreteScore === null ? 'text-content-secondary' : readyForDischarge ? 'text-ok-subtle-fg' : 'text-caution-subtle-fg'}`}>
            {aldreteScore === null
              ? t('docPostOp.bannerUnscored')
              : t('docPostOp.banner', { score: aldreteScore, status: readyForDischarge ? t('docPostOp.statusReady') : t('docPostOp.statusMonitoring') })}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {['assessment', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'assessment' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-content-secondary border-b-2 border-violet-600'
                : 'text-content-muted hover:text-content-secondary'}`}
            >
              {tab === 'assessment' ? t('docPostOp.tabAssessment') : t('docPostOp.tabHistory')}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'assessment' ? (
          <div className="space-y-6">
            {/* Patient & Procedure Info */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docPostOp.patientProcedure')}
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <PatientSelect
                    id="postop-patient"
                    label={t('docPostOp.patient')}
                    value={selectedPatient}
                    onChange={(selectedPatientId) => setSelectedPatient(selectedPatientId)}
                  />
                </div>
                <div>
                  <label htmlFor="postop-procedure" className="text-sm text-content-muted">{t('docPostOp.procedure')}</label>
                  <input
                    id="postop-procedure"
                    type="text"
                    value={procedure}
                    onChange={e => setProcedure(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-surgeon" className="text-sm text-content-muted">{t('docPostOp.surgeon')}</label>
                  <input
                    id="postop-surgeon"
                    type="text"
                    value={surgeon}
                    onChange={e => setSurgeon(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-anesthesia" className="text-sm text-content-muted">{t('docPostOp.anesthesia')}</label>
                  <input
                    id="postop-anesthesia"
                    type="text"
                    value={anesthesiaType}
                    onChange={e => setAnesthesiaType(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docPostOp.anesthesiaPh')}
                  />
                </div>
                <div>
                  <label htmlFor="postop-arrival-time" className="text-sm text-content-muted">{t('docPostOp.pacuArrival')}</label>
                  <input
                    id="postop-arrival-time"
                    type="time"
                    value={arrivalTime}
                    onChange={e => setArrivalTime(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
              </div>
            </div>

            {/* Aldrete Score */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" /> {t('docPostOp.aldreteScore')}
              </h2>
              <div className="space-y-4">
                {(Object.keys(aldreteDescriptions) as (keyof AldreteCriteria)[]).map(key => (
                  <div key={key} className="flex items-center gap-4">
                    <span className="w-40 font-medium">{t(`docPostOp.crit_${key}`)}</span>
                    <div className="flex gap-2">
                      {[0, 1, 2].map(val => (
                        <button
                          key={val}
                          onClick={() => setAldrete({ ...aldrete, [key]: val as 0 | 1 | 2 })}
                          className={`px-4 py-2 rounded border ${aldrete[key] === val
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-surface hover:bg-surface-sunken'}`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                    <span className="text-sm text-content-muted">
                      {aldrete[key] === null ? t('docPostOp.notAssessed') : aldreteDescriptions[key][aldrete[key] as 0 | 1 | 2]}
                    </span>
                  </div>
                ))}
                <div className="mt-4 pt-4 border-t flex items-center justify-between">
                  <span className="text-xl font-bold">
                    {aldreteScore === null ? t('docPostOp.totalUnscored') : t('docPostOp.totalScore', { score: aldreteScore })}
                  </span>
                  {aldreteScore !== null && (
                    <span className={`px-3 py-1 rounded ${readyForDischarge ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'}`}>
                      {readyForDischarge ? t('docPostOp.dischargeReady') : t('docPostOp.notReady')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Vital Signs */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <ThermometerSun className="w-5 h-5" /> {t('docPostOp.vitalSigns')}
              </h2>
              <div className="grid md:grid-cols-5 gap-4">
                <div>
                  <label htmlFor="postop-bp" className="text-sm text-content-muted">BP</label>
                  <input
                    id="postop-bp"
                    type="text"
                    value={vitals.bp}
                    onChange={e => setVitals({ ...vitals, bp: e.target.value })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-hr" className="text-sm text-content-muted">HR</label>
                  <input
                    id="postop-hr"
                    type="number"
                    value={vitals.hr}
                    onChange={e => setVitals({ ...vitals, hr: e.target.value })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-rr" className="text-sm text-content-muted">RR</label>
                  <input
                    id="postop-rr"
                    type="number"
                    value={vitals.rr}
                    onChange={e => setVitals({ ...vitals, rr: e.target.value })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-spo2" className="text-sm text-content-muted">{t('docPostOp.spo2Pct')}</label>
                  <input
                    id="postop-spo2"
                    type="number"
                    value={vitals.spo2}
                    onChange={e => setVitals({ ...vitals, spo2: e.target.value })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-temp" className="text-sm text-content-muted">{t('docPostOp.tempC')}</label>
                  <input
                    id="postop-temp"
                    type="number"
                    step="0.1"
                    value={vitals.temp}
                    onChange={e => setVitals({ ...vitals, temp: e.target.value })}
                    className="w-full border rounded p-2"
                  />
                </div>
              </div>
              <div className="grid md:grid-cols-4 gap-4 mt-4">
                <div>
                  <label htmlFor="postop-pain-score" className="text-sm text-content-muted">{t('docPostOp.painScore')}</label>
                  {/* A select rather than a slider: a slider always has a value,
                      so "not asked" could not be told from the 3 it started on. */}
                  <select
                    id="postop-pain-score"
                    value={painScore === null ? '' : String(painScore)}
                    onChange={e => setPainScore(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docPostOp.notAssessed')}</option>
                    {Array.from({ length: 11 }, (_, n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="postop-nausea" className="text-sm text-content-muted">{t('docPostOp.nausea')}</label>
                  <select
                    id="postop-nausea"
                    value={nauseaVomiting}
                    onChange={e => setNauseaVomiting(e.target.value as Nausea | '')}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docPostOp.notAssessed')}</option>
                    <option value="none">{t('docPostOp.nauseaNone')}</option>
                    <option value="mild">{t('docPostOp.nauseaMild')}</option>
                    <option value="moderate">{t('docPostOp.nauseaModerate')}</option>
                    <option value="severe">{t('docPostOp.nauseaSevere')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="postop-bleeding" className="text-sm text-content-muted">{t('docPostOp.bleeding')}</label>
                  <select
                    id="postop-bleeding"
                    value={bleeding}
                    onChange={e => setBleeding(e.target.value as Bleeding | '')}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docPostOp.notAssessed')}</option>
                    <option value="none">{t('docPostOp.bleedNone')}</option>
                    <option value="minimal">{t('docPostOp.bleedMinimal')}</option>
                    <option value="moderate">{t('docPostOp.bleedModerate')}</option>
                    <option value="significant">{t('docPostOp.bleedSignificant')}</option>
                  </select>
                </div>
              </div>
            </div>

            {/* I&O, Meds, Dressing */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docPostOp.ioCare')}</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="postop-urine-output" className="text-sm text-content-muted">{t('docPostOp.urineOutput')}</label>
                  <input
                    id="postop-urine-output"
                    type="text"
                    value={urineOutput}
                    onChange={e => setUrineOutput(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docPostOp.urineOutputPh')}
                  />
                </div>
                <div>
                  <label htmlFor="postop-fluid-intake" className="text-sm text-content-muted">{t('docPostOp.ivFluidIntake')}</label>
                  <input
                    id="postop-fluid-intake"
                    type="text"
                    value={fluidIntake}
                    onChange={e => setFluidIntake(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docPostOp.ivFluidIntakePh')}
                  />
                </div>
                <div>
                  <label htmlFor="postop-oral-intake" className="text-sm text-content-muted">{t('docPostOp.oralIntake')}</label>
                  <input
                    id="postop-oral-intake"
                    type="text"
                    value={oralIntake}
                    onChange={e => setOralIntake(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docPostOp.oralIntakePh')}
                  />
                </div>
                <div>
                  <label htmlFor="postop-iv-access" className="text-sm text-content-muted">{t('docPostOp.ivAccess')}</label>
                  <input
                    id="postop-iv-access"
                    type="text"
                    value={ivAccess}
                    onChange={e => setIvAccess(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docPostOp.ivAccessPh')}
                  />
                </div>
                <div>
                  <label htmlFor="postop-medications" className="text-sm text-content-muted">{t('docPostOp.medsGiven')}</label>
                  <input
                    id="postop-medications"
                    type="text"
                    value={medications}
                    onChange={e => setMedications(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docPostOp.medsGivenPh')}
                  />
                </div>
                <div>
                  <label htmlFor="postop-dressing" className="text-sm text-content-muted">{t('docPostOp.dressingStatus')}</label>
                  <input
                    id="postop-dressing"
                    type="text"
                    value={dressingStatus}
                    onChange={e => setDressingStatus(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docPostOp.dressingStatusPh')}
                  />
                </div>
                <div>
                  <label htmlFor="postop-drains" className="text-sm text-content-muted">{t('docPostOp.drains')}</label>
                  <input
                    id="postop-drains"
                    type="text"
                    value={drains}
                    onChange={e => setDrains(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docPostOp.drainsPh')}
                  />
                </div>
              </div>
            </div>

            {/* Discharge Criteria */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docPostOp.dischargeCriteria')}</h2>
              <div className="flex flex-wrap gap-2 mb-4">
                {dischargeCriteriaList.map(c => (
                  <label key={c} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedCriteria.includes(c) ? 'bg-ok-subtle border-ok' : 'bg-surface-sunken'}`}>
                    <input
                      type="checkbox"
                      checked={selectedCriteria.includes(c)}
                      onChange={e => {
                        if (e.target.checked) setSelectedCriteria([...selectedCriteria, c]);
                        else setSelectedCriteria(selectedCriteria.filter(x => x !== c));
                      }}
                      className="mr-1"
                    />
                    {c}
                  </label>
                ))}
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="postop-discharge-time" className="text-sm text-content-muted">{t('docPostOp.dischargeTime')}</label>
                  <input
                    id="postop-discharge-time"
                    type="time"
                    value={dischargeTime}
                    onChange={e => setDischargeTime(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-disposition" className="text-sm text-content-muted">{t('docPostOp.disposition')}</label>
                  <input
                    id="postop-disposition"
                    type="text"
                    value={dischargeDisposition}
                    onChange={e => setDischargeDisposition(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docPostOp.dispositionPh')}
                  />
                </div>
              </div>
            </div>

            {/* Complications & Notes */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docPostOp.complicationsNotes')}</h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="postop-complications" className="text-sm text-content-muted">{t('docPostOp.complications')}</label>
                  <input
                    id="postop-complications"
                    type="text"
                    value={complications}
                    onChange={e => setComplications(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docPostOp.complicationsPh')}
                  />
                </div>
                <div>
                  <label htmlFor="postop-notes" className="text-sm text-content-muted">{t('docPostOp.notes')}</label>
                  <textarea
                    id="postop-notes"
                    value={notes2}
                    onChange={e => setNotes2(e.target.value)}
                    className="w-full border rounded p-2 h-24"
                  />
                </div>
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700"
            >
              {t('docPostOp.save')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {notes.length === 0 ? (
              <div className="text-center py-8 text-content-muted">{t('docPostOp.noNotes')}</div>
            ) : (
              notes.map(n => (
                <div key={n.id} className="bg-surface rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{n.patientName}</h3>
                      <p className="text-sm text-content-muted">{formatTimestamp(n.documentedAt)}</p>
                    </div>
                    {typeof n.alderetScore === 'number' && (
                      <span className={`px-2 py-1 text-xs rounded ${n.readyForDischarge ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'}`}>
                        {t('docPostOp.aldreteBadge', { score: n.alderetScore })}
                      </span>
                    )}
                  </div>
                  <div className="text-sm">
                    <p><strong>{t('docPostOp.lblProcedure')}</strong> {n.procedure}</p>
                    <p>{t('docPostOp.painSummary', { pain: n.painScore ?? '—', nausea: n.nauseaVomiting || '—', bleeding: n.bleeding || '—' })}</p>
                    {n.dischargeTime && <p className="text-ok-subtle-fg">{t('docPostOp.dischargedLine', { time: n.dischargeTime })}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PostOpPage;
