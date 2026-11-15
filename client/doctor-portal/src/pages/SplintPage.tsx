import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bone, AlertTriangle, User, CheckCircle } from 'lucide-react';
import PatientSelect, { useDirectoryPatient } from '../components/PatientSelect';
import {
  createSplint,
  fromStoredRecord,
  getApiClient,
  rowsOfResponse,
  useTranslation,
  formatTimestamp, ChoiceChips, useDraftFields } from '@medichain/shared';
import { useToastActions } from '../components/Toast';

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

/**
 * What a new splint record starts with: nothing (rule 9). It used to open on a
 * right-sided fibreglass splint, non-weight-bearing, neurovascular status
 * intact before and after, padding adequate, edges smooth and every
 * instruction given -- and filed all of it for a limb nobody had checked.
 */
const UNRECORDED_NV = { intact: null as boolean | null, notes: '' };

/** Display actual stored draft fields, including unknown checks, without assuming normal findings. */
const SplintRecordDetails: React.FC<{ record: SplintRecord }> = ({ record }) => {
  const { t } = useTranslation();
  const missing = t('docSplint.notRecorded');
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : missing;
  const check = (value: unknown) => value === true ? t('common.yes') : value === false ? t('common.no') : missing;
  const fields = [
    [t('docSplint.material'), text(record.material)],
    [t('docSplint.fractureSite'), text(record.fractureSite)],
    [`${t('docSplint.preApplication')} — ${t('docSplint.nvStatusIntact')}`, check(record.preApplicationNV?.intact)],
    [`${t('docSplint.preApplication')} — ${t('docSplint.notes')}`, text(record.preApplicationNV?.notes)],
    [`${t('docSplint.postApplication')} — ${t('docSplint.nvStatusIntact')}`, check(record.postApplicationNV?.intact)],
    [`${t('docSplint.postApplication')} — ${t('docSplint.notes')}`, text(record.postApplicationNV?.notes)],
    [t('docSplint.chkPadding'), check(record.paddingAdequate)],
    [t('docSplint.chkEdges'), check(record.edgesSmooth)],
    [t('docSplint.chkInstructions'), check(record.patientInstructions)],
    [t('docSplint.weightBearing'), ({ non: t('docSplint.wbNon'), touch: t('docSplint.wbTouch'),
      partial: t('docSplint.wbPartial'), full: t('docSplint.wbFull') })[record.weightBearing] ?? missing],
    [t('docSplint.elevation'), check(record.elevationInstructed)],
    [t('docSplint.ice'), check(record.iceInstructed)],
    [t('docSplint.returnPrecautions'), Array.isArray(record.returnPrecautions) ? record.returnPrecautions.join(', ') || missing : missing],
    [t('docSplint.followUp'), text(record.followUp)], [t('docSplint.notes'), text(record.notes)],
  ];
  return <details className="mt-4 border-t border-divider pt-3">
    <summary className="cursor-pointer font-medium focus-visible:outline focus-visible:outline-2">{t('docSplint.viewDetails')}</summary>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">{fields.map(([label, value]) =>
      <div key={label}><dt className="text-sm text-content-muted">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>
  </details>;
};

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
  const { showSuccess, showError } = useToastActions();
  const typeLabel = (v: string): string => ({
    splint: t('docSplint.typeSplint'), cast: t('docSplint.typeCast'), sling: t('docSplint.typeSling'),
    brace: t('docSplint.typeBrace'), boot: t('docSplint.typeBoot'),
  }[v] ?? v);
  const sideLabel = (v: string): string => ({
    left: t('docSplint.sideLeft'), right: t('docSplint.sideRight'), bilateral: t('docSplint.sideBilateral'),
  }[v] ?? v);
  const [records, setRecords] = useState<SplintRecord[]>([]);

  /**
   * Read the ward's records back from the API.
   *
   * This screen had no read path at all: it posted, then did
   * `setRecords([...])` with its own local object. What it displayed was
   * this session's typing, and a reload emptied it -- while every record was
   * safely in the database, reachable only by an id the screen never showed.
   *
   * The stored rows carry the whole submission in `data`, so they come back
   * in this screen's own shape; `fromStoredRecord` overlays the
   * server-assigned id and the column the server stamped rather than
   * accepted.
   */
  const loadSplintRecords = useCallback(async () => {
    try {
      const body = await getApiClient().get<unknown>('/api/clinical/splint-records');
      setRecords(
        rowsOfResponse(body).map((row) =>
          fromStoredRecord<SplintRecord>(row, { appliedBy: 'applied_by' })
        )
      );
    } catch (err) {
      // A failed read must not look like an empty ward.
      console.error('Failed to load records:', err);
    }
  }, []);

  useEffect(() => {
    loadSplintRecords();
  }, [loadSplintRecords]);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [selectedPatient, setSelectedPatient] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionPending = useRef(false);

  const [type, setType] = useState<ImmobilizationType | ''>('');
  const [material, setMaterial] = useState<Material | ''>('');
  const [bodyPart, setBodyPart] = useState('');
  const [side, setSide] = useState<'left' | 'right' | 'bilateral' | ''>('');
  const [indication, setIndication] = useState('');
  const [fractureSite, setFractureSite] = useState('');
  const [preNV, setPreNV] = useState(UNRECORDED_NV);
  const [postNV, setPostNV] = useState(UNRECORDED_NV);
  // Checks a clinician ticks: unticked means "not confirmed", and only a tick
  // is sent.
  const [paddingAdequate, setPaddingAdequate] = useState(false);
  const [edgesSmooth, setEdgesSmooth] = useState(false);
  const [patientInstructions, setPatientInstructions] = useState(false);
  const [weightBearing, setWeightBearing] = useState<'non' | 'touch' | 'partial' | 'full' | ''>('');
  const [elevationInstructed, setElevationInstructed] = useState(false);
  const [iceInstructed, setIceInstructed] = useState(false);
  const [selectedPrecautions, setSelectedPrecautions] = useState<string[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [notes, setNotes] = useState('');
  // Kept for this tab while unsent, named by "Close patient" (mockup c5).
  const splintDraft = useDraftFields('splint', selectedPatient || undefined, t('docSplint.formLabel'), {
    type: [type, setType],
    material: [material, setMaterial],
    bodyPart: [bodyPart, setBodyPart],
    side: [side, setSide],
    indication: [indication, setIndication],
    fractureSite: [fractureSite, setFractureSite],
    preNV: [preNV, setPreNV],
    postNV: [postNV, setPostNV],
    paddingAdequate: [paddingAdequate, setPaddingAdequate],
    edgesSmooth: [edgesSmooth, setEdgesSmooth],
    patientInstructions: [patientInstructions, setPatientInstructions],
    weightBearing: [weightBearing, setWeightBearing],
    elevationInstructed: [elevationInstructed, setElevationInstructed],
    iceInstructed: [iceInstructed, setIceInstructed],
    selectedPrecautions: [selectedPrecautions, setSelectedPrecautions],
    followUp: [followUp, setFollowUp],
    notes: [notes, setNotes],
  });


  // NV check warning
  // Only a status someone recorded as compromised warns; unrecorded is not.
  const nvWarning = preNV.intact === false || postNV.intact === false;

  /** Clear only a confirmed saved draft and show its durable history. */
  const resetCompletedDraft = () => {
    setSelectedPatient(''); setType(''); setMaterial('');
    setBodyPart(''); setSide(''); setIndication(''); setFractureSite('');
    setPreNV(UNRECORDED_NV); setPostNV(UNRECORDED_NV);
    setPaddingAdequate(false); setEdgesSmooth(false);
    setPatientInstructions(false); setWeightBearing('');
    setElevationInstructed(false); setIceInstructed(false);
    setSelectedPrecautions([]); setFollowUp(''); setNotes(''); setActiveTab('history');
  };

  const { entry: selectedPatientEntry } = useDirectoryPatient(selectedPatient);
  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (submissionPending.current) return;
    if (!selectedPatient || !bodyPart) {
      showError(t('docSplint.errorSelect'));
      return;
    }
    // What was applied is the record; the server would otherwise call it a splint.
    if (!type) {
      showError(t('docSplint.errorType'));
      return;
    }
    submissionPending.current = true;
    setIsSubmitting(true);
    // Resolved on the server when the patient was chosen (the first page of the
    // directory held nobody past the fiftieth). Read synchronously: awaiting here,
    // before the pending-save guard is set, let a double press submit twice.
    const patient = selectedPatientEntry;
    // Only what was recorded: an unchosen field is absent, an unticked check
    // is not sent, and the id and author are the server's.
    const record = {
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      appliedAt: new Date().toISOString(),
      type, material: material || undefined, bodyPart, side: side || undefined, indication, fractureSite,
      preApplicationNV: preNV.intact === null && !preNV.notes ? undefined : preNV,
      postApplicationNV: postNV.intact === null && !postNV.notes ? undefined : postNV,
      paddingAdequate: paddingAdequate || undefined,
      edgesSmooth: edgesSmooth || undefined,
      patientInstructions: patientInstructions || undefined,
      weightBearing: weightBearing || undefined,
      elevationInstructed: elevationInstructed || undefined,
      iceInstructed: iceInstructed || undefined,
      returnPrecautions: selectedPrecautions, followUp, notes
    };
    try {
      await createSplint(record);
      // Read durable rows instead of adding the just-submitted draft to local history.
      await loadSplintRecords();
      resetCompletedDraft();
      splintDraft.markSaved();
      showSuccess(t('docSplint.saved'));
    } catch (err) {
      console.error('Failed to save splint record:', err);
      // Stop here. Falling through added the record to the local list
      // and toasted success for a write that never happened.
      showError(t('common.saveFailed'));
    } finally {
      submissionPending.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 to-indigo-800 text-white p-6">
        <div className="flex items-center gap-3">
          <Bone className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docSplint.title')}</h1>
            <p className="text-white">{t('docSplint.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* NV Warning */}
      {activeTab === 'new' && nvWarning && (
        <div className="bg-critical text-critical-fg p-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6" />
          <span className="font-semibold">{t('docSplint.nvWarning')}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {['new', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'new' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-notice-subtle-fg border-b-2 border-blue-600'
                : 'text-content-muted hover:text-content-secondary'}`}
            >
              {tab === 'new' ? t('docSplint.tabNew') : t('docSplint.tabHistory')}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'new' ? (
          <form onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }} noValidate>
          <fieldset disabled={isSubmitting} className="space-y-6">
            {/* Patient & Type */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docSplint.patientDevice')}
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <PatientSelect
                    id="splint-patient"
                    label={t('docSplint.patient')}
                    value={selectedPatient}
                    onChange={(selectedPatientId) => setSelectedPatient(selectedPatientId)}
                  />
                </div>
                <div>
                  <ChoiceChips
                    id="splint-type"
                    label={t('docSplint.type')}
                    value={type || undefined}
                    onChange={(next) => setType((next ?? '') as ImmobilizationType | '')}
                    options={[
                      { value: 'splint', label: t('docSplint.typeSplint') },
                      { value: 'cast', label: t('docSplint.typeCast') },
                      { value: 'sling', label: t('docSplint.typeSling') },
                      { value: 'brace', label: t('docSplint.typeBrace') },
                      { value: 'boot', label: t('docSplint.typeBoot') },
                    ]}
                  />
                </div>
                <div>
                  <ChoiceChips
                    id="splint-material"
                    label={t('docSplint.material')}
                    value={material || undefined}
                    onChange={(next) => setMaterial((next ?? '') as Material | '')}
                    options={[
                      { value: 'fiberglass', label: t('docSplint.matFiberglass') },
                      { value: 'plaster', label: t('docSplint.matPlaster') },
                      { value: 'prefab', label: t('docSplint.matPrefab') },
                      { value: 'aluminum', label: t('docSplint.matAluminum') },
                      { value: 'soft', label: t('docSplint.matSoft') },
                    ]}
                  />
                </div>
                <div>
                  <ChoiceChips
                    id="splint-side"
                    label={t('docSplint.side')}
                    value={side || undefined}
                    onChange={(next) => setSide((next ?? '') as 'left' | 'right' | 'bilateral' | '')}
                    options={[
                      { value: 'left', label: t('docSplint.sideLeft') },
                      { value: 'right', label: t('docSplint.sideRight') },
                      { value: 'bilateral', label: t('docSplint.sideBilateral') },
                    ]}
                  />
                </div>
              </div>
            </div>

            {/* Body Part & Indication */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docSplint.locationIndication')}</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="splint-body-part" className="text-sm text-content-muted">{t('docSplint.bodyPartLabel')}</label>
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
                  <label htmlFor="splint-indication" className="text-sm text-content-muted">{t('docSplint.indicationLabel')}</label>
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
                  <label htmlFor="splint-fracture-site" className="text-sm text-content-muted">{t('docSplint.fractureSite')}</label>
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
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" /> {t('docSplint.nvAssessment')}
              </h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="p-3 bg-surface-sunken rounded">
                  <h3 className="font-medium mb-2">{t('docSplint.preApplication')}</h3>
                  <ChoiceChips
                    id="splint-pre-nv-intact"
                    label={t('docSplint.nvStatus')}
                    value={preNV.intact === null ? undefined : preNV.intact ? 'intact' : 'compromised'}
                    onChange={(next) => setPreNV({ ...preNV, intact: next === undefined ? null : next === 'intact' })}
                    options={[
                      { value: 'intact', label: t('docSplint.nvStatusIntact') },
                      { value: 'compromised', label: t('docSplint.nvCompromised') },
                    ]}
                  />
                  <input aria-label={t('docSplint.nvNotesPh')}
                    type="text"
                    value={preNV.notes}
                    onChange={e => setPreNV({ ...preNV, notes: e.target.value })}
                    className="w-full border rounded p-2"
                    placeholder={t('docSplint.nvNotesPh')}
                  />
                </div>
                <div className="p-3 bg-surface-sunken rounded">
                  <h3 className="font-medium mb-2">{t('docSplint.postApplication')}</h3>
                  <ChoiceChips
                    id="splint-post-nv-intact"
                    label={t('docSplint.nvStatus')}
                    value={postNV.intact === null ? undefined : postNV.intact ? 'intact' : 'compromised'}
                    onChange={(next) => setPostNV({ ...postNV, intact: next === undefined ? null : next === 'intact' })}
                    options={[
                      { value: 'intact', label: t('docSplint.nvStatusIntact') },
                      { value: 'compromised', label: t('docSplint.nvCompromised') },
                    ]}
                  />
                  <input aria-label={t('docSplint.nvNotesPh')}
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
            <div className="bg-surface rounded-lg shadow p-4">
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
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docSplint.activityInstructions')}</h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <ChoiceChips
                    id="splint-weight-bearing"
                    label={t('docSplint.weightBearing')}
                    value={weightBearing || undefined}
                    onChange={(next) => setWeightBearing((next ?? '') as 'non' | 'touch' | 'partial' | 'full' | '')}
                    options={[
                      { value: 'non', label: t('docSplint.wbNon') },
                      { value: 'touch', label: t('docSplint.wbTouch') },
                      { value: 'partial', label: t('docSplint.wbPartial') },
                      { value: 'full', label: t('docSplint.wbFull') },
                    ]}
                  />
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
                  <label htmlFor="splint-follow-up" className="text-sm text-content-muted">{t('docSplint.followUp')}</label>
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
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> {t('docSplint.returnPrecautions')}
              </h2>
              <div className="flex flex-wrap gap-2">
                {returnPrecautionsList.map(p => (
                  <label key={p} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedPrecautions.includes(p) ? 'bg-caution-subtle border-caution' : 'bg-surface-sunken'}`}>
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
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docSplint.notes')}</h2>
              <textarea aria-label={t('docSplint.notesPh')}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder={t('docSplint.notesPh')}
              />
            </div>

            {/* Submit */}
            <button type="submit"
              aria-disabled={isSubmitting || undefined}
              aria-busy={isSubmitting}
              className="aria-disabled:cursor-wait w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
            >
              {t('docSplint.save')}
            </button>
          </fieldset>
          </form>
        ) : (
          <div className="space-y-4">
            {records.length === 0 ? (
              <div className="text-center py-8 text-content-muted">{t('docSplint.noRecords')}</div>
            ) : (
              records.map(r => (
                <div key={r.id} className="bg-surface rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{r.patientName}</h3>
                      <p className="text-sm text-content-muted">{r.appliedAt ? formatTimestamp(r.appliedAt) : ""}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="px-2 py-1 text-xs rounded bg-notice-subtle text-notice-subtle-fg capitalize">{typeLabel(r.type)}</span>
                      <span className={`px-2 py-1 text-xs rounded ${r.postApplicationNV?.intact === true ? 'bg-ok-subtle text-ok-subtle-fg' : r.postApplicationNV?.intact === false ? 'bg-critical-subtle text-critical-subtle-fg' : 'bg-surface-sunken text-content-muted'}`}>
                        {t('docSplint.nvLabel')} {r.postApplicationNV?.intact === true ? t('docSplint.intact') : r.postApplicationNV?.intact === false ? t('docSplint.compromised') : t('docSplint.notRecorded')}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm">
                    <p><strong>{r.bodyPart}</strong> - {sideLabel(r.side)} {t('docSplint.sideSuffix')}</p>
                    <p className="text-content-muted">{r.indication}</p>
                    {r.followUp && <p className="text-notice-subtle-fg">{t('docSplint.followUpPrefix', { value: r.followUp })}</p>}
                  </div>
                  <SplintRecordDetails record={r} />
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
