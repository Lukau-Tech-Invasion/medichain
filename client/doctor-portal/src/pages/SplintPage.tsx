import React, { useState, useEffect } from 'react';
import { Bone, AlertTriangle, User, CheckCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients, createSplint, useTranslation } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientProfile } from '@medichain/shared';

type ImmobilizationType = 'splint' | 'cast' | 'sling' | 'brace' | 'boot';
type Material = 'fiberglass' | 'plaster' | 'prefab' | 'aluminum' | 'soft';

interface SplintRecord {
  id: string;
  patientId: string;
  patientName: string;
  appliedBy: string;
  appliedAt: string;
  type: ImmobilizationType;
  material: Material;
  bodyPart: string;
  side: 'left' | 'right' | 'bilateral';
  indication: string;
  fractureSite: string;
  preApplicationNV: { intact: boolean; notes: string };
  postApplicationNV: { intact: boolean; notes: string };
  paddingAdequate: boolean;
  edgesSmooth: boolean;
  patientInstructions: boolean;
  weightBearing: 'non' | 'touch' | 'partial' | 'full';
  elevationInstructed: boolean;
  iceInstructed: boolean;
  returnPrecautions: string[];
  followUp: string;
  notes: string;
}

const bodyParts = [
  'Thumb spica', 'Volar wrist', 'Sugar tong (forearm)', 'Long arm', 'Ulnar gutter',
  'Radial gutter', 'Posterior ankle', 'Stirrup ankle', 'Short leg', 'Long leg',
  'Knee immobilizer', 'Shoulder sling', 'Clavicle strap', 'Finger splint'
];

const indications = [
  'Fracture immobilization', 'Post-reduction', 'Soft tissue injury', 'Tendon injury',
  'Ligament sprain', 'Joint protection', 'Post-operative', 'Pain management'
];

const returnPrecautionsList = [
  'Increased pain', 'Numbness or tingling', 'Pale or blue fingers/toes',
  'Swelling beyond splint', 'Inability to move fingers/toes', 'Splint feels too tight',
  'Foul odor', 'Fever', 'Cast breakdown/damage'
];

const SplintPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const typeLabel = (v: string): string => ({
    splint: t('docSplint.typeSplint'), cast: t('docSplint.typeCast'), sling: t('docSplint.typeSling'),
    brace: t('docSplint.typeBrace'), boot: t('docSplint.typeBoot'),
  }[v] ?? v);
  const sideLabel = (v: string): string => ({
    left: t('docSplint.sideLeft'), right: t('docSplint.sideRight'), bilateral: t('docSplint.sideBilateral'),
  }[v] ?? v);
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [records, setRecords] = useState<SplintRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [selectedPatient, setSelectedPatient] = useState('');

  const [type, setType] = useState<ImmobilizationType>('splint');
  const [material, setMaterial] = useState<Material>('fiberglass');
  const [bodyPart, setBodyPart] = useState('');
  const [side, setSide] = useState<'left' | 'right' | 'bilateral'>('right');
  const [indication, setIndication] = useState('');
  const [fractureSite, setFractureSite] = useState('');
  const [preNV, setPreNV] = useState({ intact: true, notes: '' });
  const [postNV, setPostNV] = useState({ intact: true, notes: '' });
  const [paddingAdequate, setPaddingAdequate] = useState(true);
  const [edgesSmooth, setEdgesSmooth] = useState(true);
  const [patientInstructions, setPatientInstructions] = useState(true);
  const [weightBearing, setWeightBearing] = useState<'non' | 'touch' | 'partial' | 'full'>('non');
  const [elevationInstructed, setElevationInstructed] = useState(true);
  const [iceInstructed, setIceInstructed] = useState(true);
  const [selectedPrecautions, setSelectedPrecautions] = useState<string[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [notes, setNotes] = useState('');

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

  // NV check warning
  const nvWarning = !preNV.intact || !postNV.intact;

  const handleSubmit = async () => {
    if (!selectedPatient || !bodyPart) {
      showWarning(t('docSplint.warnSelect'));
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const record: SplintRecord = {
      id: `SPL-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      appliedBy: user?.username || 'Unknown',
      appliedAt: new Date().toISOString(),
      type, material, bodyPart, side, indication, fractureSite,
      preApplicationNV: preNV, postApplicationNV: postNV,
      paddingAdequate, edgesSmooth, patientInstructions,
      weightBearing, elevationInstructed, iceInstructed,
      returnPrecautions: selectedPrecautions, followUp, notes
    };
    try {
      await createSplint(record);
    } catch (err) {
      console.error('Failed to save splint record:', err);
    }
    setRecords([record, ...records]);
    showSuccess(t('docSplint.saved'));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-500 text-white p-6">
        <div className="flex items-center gap-3">
          <Bone className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docSplint.title')}</h1>
            <p className="text-blue-100">{t('docSplint.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* NV Warning */}
      {nvWarning && (
        <div className="bg-red-600 text-white p-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6" />
          <span className="font-semibold">{t('docSplint.nvWarning')}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {['new', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'new' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab === 'new' ? t('docSplint.tabNew') : t('docSplint.tabHistory')}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'new' ? (
          <div className="space-y-6">
            {/* Patient & Type */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docSplint.patientDevice')}
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="splint-patient" className="text-sm text-gray-600">{t('docSplint.patient')}</label>
                  <select
                    id="splint-patient"
                    value={selectedPatient}
                    onChange={e => setSelectedPatient(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docSplint.select')}</option>
                    {patients.map(p => (
                      <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="splint-type" className="text-sm text-gray-600">{t('docSplint.type')}</label>
                  <select
                    id="splint-type"
                    value={type}
                    onChange={e => setType(e.target.value as ImmobilizationType)}
                    className="w-full border rounded p-2"
                  >
                    <option value="splint">{t('docSplint.typeSplint')}</option>
                    <option value="cast">{t('docSplint.typeCast')}</option>
                    <option value="sling">{t('docSplint.typeSling')}</option>
                    <option value="brace">{t('docSplint.typeBrace')}</option>
                    <option value="boot">{t('docSplint.typeBoot')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="splint-material" className="text-sm text-gray-600">{t('docSplint.material')}</label>
                  <select
                    id="splint-material"
                    value={material}
                    onChange={e => setMaterial(e.target.value as Material)}
                    className="w-full border rounded p-2"
                  >
                    <option value="fiberglass">{t('docSplint.matFiberglass')}</option>
                    <option value="plaster">{t('docSplint.matPlaster')}</option>
                    <option value="prefab">{t('docSplint.matPrefab')}</option>
                    <option value="aluminum">{t('docSplint.matAluminum')}</option>
                    <option value="soft">{t('docSplint.matSoft')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="splint-side" className="text-sm text-gray-600">{t('docSplint.side')}</label>
                  <select
                    id="splint-side"
                    value={side}
                    onChange={e => setSide(e.target.value as 'left' | 'right' | 'bilateral')}
                    className="w-full border rounded p-2"
                  >
                    <option value="left">{t('docSplint.sideLeft')}</option>
                    <option value="right">{t('docSplint.sideRight')}</option>
                    <option value="bilateral">{t('docSplint.sideBilateral')}</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Body Part & Indication */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docSplint.locationIndication')}</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="splint-body-part" className="text-sm text-gray-600">{t('docSplint.bodyPartLabel')}</label>
                  <select
                    id="splint-body-part"
                    value={bodyPart}
                    onChange={e => setBodyPart(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docSplint.select')}</option>
                    {bodyParts.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="splint-indication" className="text-sm text-gray-600">{t('docSplint.indicationLabel')}</label>
                  <select
                    id="splint-indication"
                    value={indication}
                    onChange={e => setIndication(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docSplint.select')}</option>
                    {indications.map(i => (
                      <option key={i} value={i}>{i}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="splint-fracture-site" className="text-sm text-gray-600">{t('docSplint.fractureSite')}</label>
                  <input
                    id="splint-fracture-site"
                    type="text"
                    value={fractureSite}
                    onChange={e => setFractureSite(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docSplint.fractureSitePh')}
                  />
                </div>
              </div>
            </div>

            {/* NV Checks */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" /> {t('docSplint.nvAssessment')}
              </h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="p-3 bg-gray-50 rounded">
                  <h3 className="font-medium mb-2">{t('docSplint.preApplication')}</h3>
                  <label htmlFor="splint-pre-nv-intact" className="flex items-center gap-2 mb-2">
                    <input
                      id="splint-pre-nv-intact"
                      type="checkbox"
                      checked={preNV.intact}
                      onChange={e => setPreNV({ ...preNV, intact: e.target.checked })}
                    />
                    <span className={preNV.intact ? 'text-green-600' : 'text-red-600 font-semibold'}>
                      {t('docSplint.nvStatusIntact')}
                    </span>
                  </label>
                  <input
                    type="text"
                    value={preNV.notes}
                    onChange={e => setPreNV({ ...preNV, notes: e.target.value })}
                    className="w-full border rounded p-2"
                    placeholder={t('docSplint.nvNotesPh')}
                  />
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <h3 className="font-medium mb-2">{t('docSplint.postApplication')}</h3>
                  <label htmlFor="splint-post-nv-intact" className="flex items-center gap-2 mb-2">
                    <input
                      id="splint-post-nv-intact"
                      type="checkbox"
                      checked={postNV.intact}
                      onChange={e => setPostNV({ ...postNV, intact: e.target.checked })}
                    />
                    <span className={postNV.intact ? 'text-green-600' : 'text-red-600 font-semibold'}>
                      {t('docSplint.nvStatusIntact')}
                    </span>
                  </label>
                  <input
                    type="text"
                    value={postNV.notes}
                    onChange={e => setPostNV({ ...postNV, notes: e.target.value })}
                    className="w-full border rounded p-2"
                    placeholder={t('docSplint.nvNotesPh')}
                  />
                </div>
              </div>
            </div>

            {/* Quality Checklist */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docSplint.checklist')}</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <label htmlFor="splint-padding-adequate" className="flex items-center gap-2">
                  <input
                    id="splint-padding-adequate"
                    type="checkbox"
                    checked={paddingAdequate}
                    onChange={e => setPaddingAdequate(e.target.checked)}
                  />
                  {t('docSplint.chkPadding')}
                </label>
                <label htmlFor="splint-edges-smooth" className="flex items-center gap-2">
                  <input
                    id="splint-edges-smooth"
                    type="checkbox"
                    checked={edgesSmooth}
                    onChange={e => setEdgesSmooth(e.target.checked)}
                  />
                  {t('docSplint.chkEdges')}
                </label>
                <label htmlFor="splint-patient-instructions" className="flex items-center gap-2">
                  <input
                    id="splint-patient-instructions"
                    type="checkbox"
                    checked={patientInstructions}
                    onChange={e => setPatientInstructions(e.target.checked)}
                  />
                  {t('docSplint.chkInstructions')}
                </label>
              </div>
            </div>

            {/* Activity Restrictions */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docSplint.activityInstructions')}</h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="splint-weight-bearing" className="text-sm text-gray-600">{t('docSplint.weightBearing')}</label>
                  <select
                    id="splint-weight-bearing"
                    value={weightBearing}
                    onChange={e => setWeightBearing(e.target.value as 'non' | 'touch' | 'partial' | 'full')}
                    className="w-full border rounded p-2"
                  >
                    <option value="non">{t('docSplint.wbNon')}</option>
                    <option value="touch">{t('docSplint.wbTouch')}</option>
                    <option value="partial">{t('docSplint.wbPartial')}</option>
                    <option value="full">{t('docSplint.wbFull')}</option>
                  </select>
                </div>
                <label htmlFor="splint-elevation-instructed" className="flex items-center gap-2">
                  <input
                    id="splint-elevation-instructed"
                    type="checkbox"
                    checked={elevationInstructed}
                    onChange={e => setElevationInstructed(e.target.checked)}
                  />
                  {t('docSplint.elevation')}
                </label>
                <label htmlFor="splint-ice-instructed" className="flex items-center gap-2">
                  <input
                    id="splint-ice-instructed"
                    type="checkbox"
                    checked={iceInstructed}
                    onChange={e => setIceInstructed(e.target.checked)}
                  />
                  {t('docSplint.ice')}
                </label>
                <div>
                  <label htmlFor="splint-follow-up" className="text-sm text-gray-600">{t('docSplint.followUp')}</label>
                  <input
                    id="splint-follow-up"
                    type="text"
                    value={followUp}
                    onChange={e => setFollowUp(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docSplint.followUpPh')}
                  />
                </div>
              </div>
            </div>

            {/* Return Precautions */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> {t('docSplint.returnPrecautions')}
              </h2>
              <div className="flex flex-wrap gap-2">
                {returnPrecautionsList.map(p => (
                  <label key={p} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedPrecautions.includes(p) ? 'bg-yellow-100 border-yellow-300' : 'bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={selectedPrecautions.includes(p)}
                      onChange={e => {
                        if (e.target.checked) setSelectedPrecautions([...selectedPrecautions, p]);
                        else setSelectedPrecautions(selectedPrecautions.filter(x => x !== p));
                      }}
                      className="mr-1"
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docSplint.notes')}</h2>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder={t('docSplint.notesPh')}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
            >
              {t('docSplint.save')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {records.length === 0 ? (
              <div className="text-center py-8 text-gray-500">{t('docSplint.noRecords')}</div>
            ) : (
              records.map(r => (
                <div key={r.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{r.patientName}</h3>
                      <p className="text-sm text-gray-500">{new Date(r.appliedAt).toLocaleString()}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-700 capitalize">{typeLabel(r.type)}</span>
                      <span className={`px-2 py-1 text-xs rounded ${r.postApplicationNV.intact ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {t('docSplint.nvLabel')} {r.postApplicationNV.intact ? t('docSplint.intact') : t('docSplint.compromised')}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm">
                    <p><strong>{r.bodyPart}</strong> - {sideLabel(r.side)} {t('docSplint.sideSuffix')}</p>
                    <p className="text-gray-600">{r.indication}</p>
                    {r.followUp && <p className="text-blue-600">{t('docSplint.followUpPrefix', { value: r.followUp })}</p>}
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

export default SplintPage;
