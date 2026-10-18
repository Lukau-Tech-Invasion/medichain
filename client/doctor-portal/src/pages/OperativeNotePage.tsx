import React, { useState, useEffect, useRef } from 'react';
import { Scissors, User, FileText, Droplet, Package } from 'lucide-react';
import PatientSelect, { useDirectoryPatient } from '../components/PatientSelect';
import { useAuthStore } from '../store/authStore';
import {
  createOperativeNote,
  getApiClient,
  useScoringCatalog,
  useTranslation,
  Input,
  Textarea,
  useValidatedForm,
  operativeNoteSchema,
  formatDateOnly,
} from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import { StoredValue } from '../components/StoredSoapDetails';

type AnesthesiaType = 'general' | 'spinal' | 'epidural' | 'regional' | 'local' | 'mac' | 'none';
type WoundClass = 'clean' | 'clean-contaminated' | 'contaminated' | 'dirty';

interface Specimen {
  id: string;
  description: string;
  disposition: 'pathology' | 'culture' | 'cytology' | 'discarded';
}

interface OperativeNote {
  id: string;
  patientId: string;
  patientName: string;
  surgeon: string;
  assistant: string;
  anesthesiologist: string;
  scrubNurse: string;
  circulator: string;
  procedureDate: string;
  preOpDiagnosis: string;
  postOpDiagnosis: string;
  procedureName: string;
  cptCodes: string;
  /** Absent when not recorded -- never a guessed "general". */
  anesthesiaType?: AnesthesiaType;
  incision: string;
  findings: string;
  procedure: string;
  closure: string;
  drains: string;
  /** Millilitres; absent when not measured, which is not 0 mL (rule 12). */
  ebl?: number;
  urineOutput?: number;
  fluidIn?: number;
  specimens: Specimen[];
  woundClass?: WoundClass;
  implants: string;
  complications: string;
  disposition: string;
  createdAt: string;
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
type RecordList = { records?: Record<string, unknown>[]; notes?: Record<string, unknown>[] } | Record<string, unknown>[];

/** Map stored documentation for one patient without guessing absent measurements. */
function storedOperativeNote(r: Record<string, unknown>, patientId: string): OperativeNote {
  const text = (...keys: string[]): string => {
    for (const key of keys) if (typeof r[key] === 'string' && r[key]) return r[key] as string;
    return '';
  };
  return {
    id: text('id', 'note_id'), patientId: text('patientId', 'patient_id') || patientId,
    patientName: text('patientName', 'patient_name') || patientId,
    surgeon: text('surgeon'), assistant: text('assistant'), anesthesiologist: text('anesthesiologist'),
    scrubNurse: text('scrubNurse', 'scrub_nurse'), circulator: text('circulator'),
    procedureDate: text('procedureDate', 'procedure_date'),
    preOpDiagnosis: text('preOpDiagnosis', 'pre_op_diagnosis'), postOpDiagnosis: text('postOpDiagnosis', 'post_op_diagnosis'),
    procedureName: text('procedureName', 'procedure_name'), cptCodes: text('cptCodes', 'cpt_codes'),
    anesthesiaType: (r.anesthesiaType || r.anesthesia_type || undefined) as AnesthesiaType | undefined,
    incision: text('incision'), findings: text('findings'), procedure: text('procedure'),
    closure: text('closure'), drains: text('drains'),
    ebl: storedNumber(r.ebl), urineOutput: storedNumber(r.urineOutput ?? r.urine_output),
    fluidIn: storedNumber(r.fluidIn ?? r.fluid_in), specimens: Array.isArray(r.specimens) ? r.specimens as Specimen[] : [],
    woundClass: (r.woundClass || r.wound_class || undefined) as WoundClass | undefined,
    implants: text('implants'), complications: text('complications'), disposition: text('disposition'),
    createdAt: text('createdAt', 'created_at'),
  };
}

const commonProcedures = [
  'Appendectomy', 'Cholecystectomy', 'Hernia repair', 'Exploratory laparotomy',
  'Open reduction internal fixation', 'Arthroscopy', 'Laminectomy', 'Mastectomy',
  'Thyroidectomy', 'Colectomy', 'Coronary artery bypass', 'Valve replacement'
];

const woundClasses: WoundClass[] = ['clean', 'clean-contaminated', 'contaminated', 'dirty'];

/** A number the surgeon entered, or nothing when the box was left empty. */
function measured(value: string): number | undefined {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A stored number, or nothing when it was not recorded. */
function storedNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const OperativeNotePage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();
  const [notes, setNotes] = useState<OperativeNote[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const submissionPending = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState('');
  const patientNotes = notes.filter(note => note.patientId === selectedPatient);

  // Form state
  const [surgeon, setSurgeon] = useState(user?.userId || '');
  const [assistant, setAssistant] = useState('');
  const [anesthesiologist, setAnesthesiologist] = useState('');
  const [scrubNurse, setScrubNurse] = useState('');
  const [circulator, setCirculator] = useState('');
  const [procedureDate, setProcedureDate] = useState(new Date().toISOString().split('T')[0]);
  const [preOpDiagnosis, setPreOpDiagnosis] = useState('');
  const [postOpDiagnosis, setPostOpDiagnosis] = useState('');
  const [procedureName, setProcedureName] = useState('');
  const [cptCodes, setCptCodes] = useState('');
  // Nothing pre-selected and no measurement pre-filled: an untouched form
  // used to file "general anaesthetic, clean wound, EBL 0 mL" (rule 9).
  const [anesthesiaType, setAnesthesiaType] = useState<AnesthesiaType | ''>('');
  const [incision, setIncision] = useState('');
  const [findings, setFindings] = useState('');
  const [procedureText, setProcedureText] = useState('');
  const [closure, setClosure] = useState('');
  const [drains, setDrains] = useState('');
  const [ebl, setEbl] = useState('');
  const [urineOutput, setUrineOutput] = useState('');
  const [fluidIn, setFluidIn] = useState('');
  const [specimens, setSpecimens] = useState<Specimen[]>([]);
  const [woundClass, setWoundClass] = useState<WoundClass | ''>('');
  const { catalog } = useScoringCatalog();
  // The blood-loss flag's threshold is the server's (rule 8), not a literal.
  const eblFlagMl = catalog?.operative?.ebl_significant_ml;
  const eblFlagged = eblFlagMl != null && (measured(ebl) ?? 0) > eblFlagMl;
  const [implants, setImplants] = useState('');
  const [complications, setComplications] = useState('');
  const [disposition, setDisposition] = useState('');

  const [newSpecimen, setNewSpecimen] = useState({ description: '', disposition: 'pathology' as Specimen['disposition'] });


  useEffect(() => {
    if (activeTab === 'history' && selectedPatient && user) {
      let cancelled = false;
      const fetchHistory = async () => {
        setHistoryLoading(true);
        setHistoryError('');
        setNotes([]);
        try {
          const data = await getApiClient().get<RecordList>(`/api/surgical/operative-note/patient/${selectedPatient}`);
          const records = Array.isArray(data) ? data : (data.records || data.notes || []);
          const mappedRecords = records.map(record => storedOperativeNote(record, selectedPatient));
          if (!cancelled) setNotes(mappedRecords.filter(record => record.patientId === selectedPatient));
        } catch (e) {
          console.error('Failed to fetch operative note history:', e);
          if (!cancelled) setHistoryError(t('docOperativeNote.historyReadFailed'));
        } finally {
          if (!cancelled) setHistoryLoading(false);
        }
      };
      fetchHistory();
      return () => { cancelled = true; };
    }
  }, [activeTab, selectedPatient, user, t]);

  const addSpecimen = () => {
    if (!newSpecimen.description) return;
    setSpecimens([...specimens, { id: `SPEC-${Date.now()}`, ...newSpecimen }]);
    setNewSpecimen({ description: '', disposition: 'pathology' });
  };

  const removeSpecimen = (id: string) => {
    setSpecimens(specimens.filter(s => s.id !== id));
  };

  const { errors, validate, validateField, clearField } = useValidatedForm(operativeNoteSchema);

  /** The fields a note cannot be filed without, from this page's own state. */
  const opNote = () => ({ selectedPatient, procedureName, preOpDiagnosis, postOpDiagnosis });

  /** Clear completed documentation while retaining the selected patient's history context. */
  const resetCompletedDraft = () => {
    setSurgeon(user?.userId || '');
    setAssistant(''); setAnesthesiologist(''); setScrubNurse(''); setCirculator('');
    setProcedureDate(new Date().toISOString().split('T')[0]);
    setPreOpDiagnosis(''); setPostOpDiagnosis(''); setProcedureName(''); setCptCodes('');
    setAnesthesiaType(''); setIncision(''); setFindings(''); setProcedureText('');
    setClosure(''); setDrains(''); setEbl(''); setUrineOutput(''); setFluidIn('');
    setSpecimens([]); setWoundClass(''); setImplants(''); setComplications(''); setDisposition('');
    setNewSpecimen({ description: '', disposition: 'pathology' });
  };

  /** Submit one draft at a time; failed writes keep the entered documentation. */
  const { entry: selectedPatientEntry } = useDirectoryPatient(selectedPatient);
  const handleSubmit = async () => {
    if (submissionPending.current) return;
    // Was a toast naming two fields. Both diagnoses are required now as well:
    // the difference between them is what the operation found, and a note
    // carrying only one cannot answer the question a morbidity review asks
    // first.
    if (!validate(opNote())) {
      return;
    }
    // Resolved on the server when the patient was chosen (the first page of the
    // directory held nobody past the fiftieth). Read synchronously: awaiting here,
    // before the pending-save guard is set, let a double press submit twice.
    const patient = selectedPatientEntry;
    const note: OperativeNote = {
      // Assigned by the server.
      id: '',
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      surgeon, assistant, anesthesiologist, scrubNurse, circulator,
      procedureDate, preOpDiagnosis, postOpDiagnosis, procedureName, cptCodes,
      anesthesiaType: anesthesiaType || undefined, incision, findings, procedure: procedureText, closure,
      drains, ebl: measured(ebl), urineOutput: measured(urineOutput), fluidIn: measured(fluidIn),
      specimens, woundClass: woundClass || undefined,
      implants, complications, disposition, createdAt: new Date().toISOString()
    };
    submissionPending.current = true;
    setIsSubmitting(true);
    try {
      await createOperativeNote(note);
      resetCompletedDraft();
      setActiveTab('history');
      showSuccess(t('docOperativeNote.successSaved'));
    } catch (err) {
      console.error('Failed to save operative note:', err);
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
      <div className="bg-gradient-to-r from-emerald-700 to-teal-800 text-white p-6">
        <div className="flex items-center gap-3">
          <Scissors className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docOperativeNote.title')}</h1>
            <p className="text-white">{t('docOperativeNote.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {['new', 'history'].map(tab => (
            <button
              key={tab}
              disabled={isSubmitting}
              onClick={() => setActiveTab(tab as 'new' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-ok-subtle-fg border-b-2 border-emerald-600'
                : 'text-content-muted hover:text-content-secondary'}`}
            >
              {tab === 'new' ? t('docOperativeNote.tabNew') : t('docOperativeNote.tabHistory')}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'new' ? (
          <fieldset disabled={isSubmitting} className="space-y-6">
            {/* Patient & Team */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docOperativeNote.patientTeamHeading')}
              </h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <PatientSelect
                    id="opnote-patient"
                    label={t('docOperativeNote.patientLabel')}
                    value={selectedPatient}
                    onChange={(selectedPatientId) => setSelectedPatient(selectedPatientId)}
                  />
                </div>
                <div>
                  <label htmlFor="opnote-procedure-date" className="text-sm text-content-muted">{t('docOperativeNote.procedureDateLabel')}</label>
                  <input
                    id="opnote-procedure-date"
                    type="date"
                    value={procedureDate}
                    onChange={e => setProcedureDate(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="opnote-surgeon" className="text-sm text-content-muted">{t('docOperativeNote.surgeonLabel')}</label>
                  <input
                    id="opnote-surgeon"
                    type="text"
                    value={surgeon}
                    onChange={e => setSurgeon(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="opnote-assistant" className="text-sm text-content-muted">{t('docOperativeNote.assistantLabel')}</label>
                  <input
                    id="opnote-assistant"
                    type="text"
                    value={assistant}
                    onChange={e => setAssistant(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="opnote-anesthesiologist" className="text-sm text-content-muted">{t('docOperativeNote.anesthesiologistLabel')}</label>
                  <input
                    id="opnote-anesthesiologist"
                    type="text"
                    value={anesthesiologist}
                    onChange={e => setAnesthesiologist(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="opnote-scrub-nurse" className="text-sm text-content-muted">{t('docOperativeNote.scrubNurseLabel')}</label>
                  <input
                    id="opnote-scrub-nurse"
                    type="text"
                    value={scrubNurse}
                    onChange={e => setScrubNurse(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="opnote-circulator" className="text-sm text-content-muted">{t('docOperativeNote.circulatorLabel')}</label>
                  <input                    id="opnote-circulator"                    type="text"
                    value={circulator}
                    onChange={e => setCirculator(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
              </div>
            </div>

            {/* Diagnosis & Procedure */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <FileText className="w-5 h-5" /> {t('docOperativeNote.diagnosisProcedureHeading')}
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                <Textarea
                  id="opnote-pre-op-diagnosis"
                  label={t('docOperativeNote.preOpDiagnosisLabel')}
                  value={preOpDiagnosis}
                  onChange={e => { clearField('preOpDiagnosis'); setPreOpDiagnosis(e.target.value); }}
                  onBlur={() => validateField('preOpDiagnosis', opNote())}
                  error={errors.preOpDiagnosis}
                  rows={3}
                  required
                />
                <Textarea
                  id="opnote-post-op-diagnosis"
                  label={t('docOperativeNote.postOpDiagnosisLabel')}
                  value={postOpDiagnosis}
                  onChange={e => { clearField('postOpDiagnosis'); setPostOpDiagnosis(e.target.value); }}
                  onBlur={() => validateField('postOpDiagnosis', opNote())}
                  error={errors.postOpDiagnosis}
                  rows={3}
                  required
                />
                <div>
                  <label htmlFor="opnote-procedure-name" className="text-sm text-content-muted">{t('docOperativeNote.procedureNameLabel')}</label>
                  <Input
                    id="opnote-procedure-name"
                    list="procedures"
                    value={procedureName}
                    onChange={e => { clearField('procedureName'); setProcedureName(e.target.value); }}
                    onBlur={() => validateField('procedureName', opNote())}
                    error={errors.procedureName}
                    placeholder={t('docOperativeNote.procedureNamePh')}
                    required
                  />
                  <datalist id="procedures">
                    {commonProcedures.map(p => <option key={p} value={p} />)}
                  </datalist>
                </div>
                <div>
                  <label htmlFor="opnote-cpt-codes" className="text-sm text-content-muted">{t('docOperativeNote.cptCodesLabel')}</label>
                  <input
                    id="opnote-cpt-codes"
                    type="text"
                    value={cptCodes}
                    onChange={e => setCptCodes(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docOperativeNote.cptCodesPh')}
                  />
                </div>
                <div>
                  <label htmlFor="opnote-anesthesia-type" className="text-sm text-content-muted">{t('docOperativeNote.anesthesiaTypeLabel')}</label>
                  <select                    id="opnote-anesthesia-type"                    value={anesthesiaType}
                    onChange={e => setAnesthesiaType(e.target.value as AnesthesiaType | '')}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docOperativeNote.notRecorded')}</option>
                    <option value="general">{t('docOperativeNote.anesthesia_general')}</option>
                    <option value="spinal">{t('docOperativeNote.anesthesia_spinal')}</option>
                    <option value="epidural">{t('docOperativeNote.anesthesia_epidural')}</option>
                    <option value="regional">{t('docOperativeNote.anesthesia_regional')}</option>
                    <option value="local">{t('docOperativeNote.anesthesia_local')}</option>
                    <option value="mac">{t('docOperativeNote.anesthesia_mac')}</option>
                    <option value="none">{t('docOperativeNote.anesthesia_none')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="opnote-wound-class" className="text-sm text-content-muted">{t('docOperativeNote.woundClassificationLabel')}</label>
                  <select
                    id="opnote-wound-class"
                    value={woundClass}
                    onChange={e => setWoundClass(e.target.value as WoundClass | '')}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docOperativeNote.notRecorded')}</option>
                    {woundClasses.map(k => (
                      <option key={k} value={k}>{t(`docOperativeNote.woundClass_${k}`)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Operative Details */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docOperativeNote.operativeDetailsHeading')}</h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="opnote-incision" className="text-sm text-content-muted">{t('docOperativeNote.incisionLabel')}</label>
                  <input
                    id="opnote-incision"
                    type="text"
                    value={incision}
                    onChange={e => setIncision(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docOperativeNote.incisionPh')}
                  />
                </div>
                <div>
                  <label htmlFor="opnote-findings" className="text-sm text-content-muted">{t('docOperativeNote.findingsLabel')}</label>
                  <textarea
                    id="opnote-findings"
                    value={findings}
                    onChange={e => setFindings(e.target.value)}
                    className="w-full border rounded p-2 h-24"
                    placeholder={t('docOperativeNote.findingsPh')}
                  />
                </div>
                <div>
                  <label htmlFor="opnote-procedure-description" className="text-sm text-content-muted">{t('docOperativeNote.procedureDescriptionLabel')}</label>
                  <textarea
                    id="opnote-procedure-description"
                    value={procedureText}
                    onChange={e => setProcedureText(e.target.value)}
                    className="w-full border rounded p-2 h-32"
                    placeholder={t('docOperativeNote.procedureDescriptionPh')}
                  />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="opnote-closure" className="text-sm text-content-muted">{t('docOperativeNote.closureLabel')}</label>
                    <input
                      id="opnote-closure"
                      type="text"
                      value={closure}
                      onChange={e => setClosure(e.target.value)}
                      className="w-full border rounded p-2"
                      placeholder={t('docOperativeNote.closurePh')}
                    />
                  </div>
                  <div>
                    <label htmlFor="opnote-drains" className="text-sm text-content-muted">{t('docOperativeNote.drainsLabel')}</label>
                    <input                      id="opnote-drains"                      type="text"
                      value={drains}
                      onChange={e => setDrains(e.target.value)}
                      className="w-full border rounded p-2"
                      placeholder={t('docOperativeNote.drainsPh')}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Fluids & EBL */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Droplet className="w-5 h-5" /> {t('docOperativeNote.fluidsBloodLossHeading')}
              </h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="opnote-ebl" className="text-sm text-content-muted">{t('docOperativeNote.eblLabel')}</label>
                  <input
                    id="opnote-ebl"
                    type="number"
                    value={ebl}
                    onChange={e => setEbl(e.target.value)}
                    className={`w-full border rounded p-2 ${eblFlagged ? 'border-critical bg-critical-subtle text-critical-subtle-fg' : ''}`}
                  />
                </div>
                <div>
                  <label htmlFor="opnote-fluids-in" className="text-sm text-content-muted">{t('docOperativeNote.fluidsInLabel')}</label>
                  <input
                    id="opnote-fluids-in"
                    type="number"
                    value={fluidIn}
                    onChange={e => setFluidIn(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="opnote-urine-output" className="text-sm text-content-muted">{t('docOperativeNote.urineOutputLabel')}</label>
                  <input
                    id="opnote-urine-output"
                    type="number"
                    value={urineOutput}
                    onChange={e => setUrineOutput(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
              </div>
            </div>

            {/* Specimens */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Package className="w-5 h-5" /> {t('docOperativeNote.specimensHeading')}
              </h2>
              <div className="flex gap-2 mb-4">
                <input
                  id="opnote-specimen-description"
                  type="text"
                  value={newSpecimen.description}
                  onChange={e => setNewSpecimen({ ...newSpecimen, description: e.target.value })}
                  className="flex-1 border rounded p-2"
                  placeholder={t('docOperativeNote.specimenDescriptionPh')}
                  aria-label={t('docOperativeNote.specimenDescriptionAriaLabel')}
                />
                <select
                  id="opnote-specimen-disposition"
                  value={newSpecimen.disposition}
                  onChange={e => setNewSpecimen({ ...newSpecimen, disposition: e.target.value as Specimen['disposition'] })}
                  className="border rounded p-2"
                  aria-label={t('docOperativeNote.specimenDispositionAriaLabel')}
                >
                  <option value="pathology">{t('docOperativeNote.disposition_pathology')}</option>
                  <option value="culture">{t('docOperativeNote.disposition_culture')}</option>
                  <option value="cytology">{t('docOperativeNote.disposition_cytology')}</option>
                  <option value="discarded">{t('docOperativeNote.disposition_discarded')}</option>
                </select>
                <button
                  onClick={addSpecimen}
                  className="px-4 py-2 bg-ok text-ok-fg rounded hover:bg-ok"
                >
                  {t('docOperativeNote.addButton')}
                </button>
              </div>
              {specimens.length > 0 ? (
                <ul className="space-y-2">
                  {specimens.map(s => (
                    <li key={s.id} className="flex justify-between items-center bg-surface-sunken p-2 rounded">
                      <span>{s.description} → <span className="text-content-muted">{t(`docOperativeNote.disposition_${s.disposition}`)}</span></span>
                      <button onClick={() => removeSpecimen(s.id)} className="text-critical text-sm">{t('docOperativeNote.removeButton')}</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-content-muted text-sm">{t('docOperativeNote.noSpecimensAdded')}</p>
              )}
            </div>

            {/* Additional Info */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docOperativeNote.additionalInfoHeading')}</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="opnote-implants" className="text-sm text-content-muted">{t('docOperativeNote.implantsLabel')}</label>
                  <input
                    id="opnote-implants"
                    type="text"
                    value={implants}
                    onChange={e => setImplants(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docOperativeNote.implantsPh')}
                  />
                </div>
                <div>
                  <label htmlFor="opnote-disposition" className="text-sm text-content-muted">{t('docOperativeNote.dispositionLabel')}</label>
                  <input
                    id="opnote-disposition"
                    type="text"
                    value={disposition}
                    onChange={e => setDisposition(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docOperativeNote.dispositionPh')}
                  />
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="opnote-complications" className="text-sm text-content-muted">{t('docOperativeNote.complicationsLabel')}</label>
                  <textarea                    id="opnote-complications"                    value={complications}
                    onChange={e => setComplications(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docOperativeNote.complicationsPh')}
                  />
                </div>
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full py-3 bg-ok text-ok-fg rounded-lg font-semibold hover:bg-ok"
            >
              {isSubmitting ? t('common.saving') : t('docOperativeNote.saveButton')}
            </button>
          </fieldset>
        ) : (
          <div className="space-y-4">
            {selectedPatient && <p className="text-sm text-content-muted">{t('docOperativeNote.selectedHistory', { patientId: selectedPatient })}</p>}
            {!selectedPatient ? (
              <p className="text-center py-8 text-content-muted">{t('docOperativeNote.selectPatientForHistory')}</p>
            ) : historyLoading ? (
              <p role="status">{t('docOperativeNote.loadingHistory')}</p>
            ) : historyError ? (
              <p role="alert" className="text-critical-subtle-fg">{historyError}</p>
            ) : patientNotes.length === 0 ? (
              <div className="text-center py-8 text-content-muted">{t('docOperativeNote.noNotesYet')}</div>
            ) : (
              patientNotes.map(n => (
                <div key={n.id} className="bg-surface rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{n.patientName}</h3>
                      <p className="text-sm text-content-muted">{formatDateOnly(n.procedureDate)}</p>
                    </div>
                    {n.woundClass && (
                      <span className="px-2 py-1 text-xs rounded bg-ok-subtle text-ok-subtle-fg">
                        {t(`docOperativeNote.woundClassBadge_${n.woundClass}`)}
                      </span>
                    )}
                  </div>
                  <div className="text-sm space-y-1">
                    <p><strong>{t('docOperativeNote.procedureColLabel')}</strong> {n.procedureName}</p>
                    <p><strong>{t('docOperativeNote.surgeonColLabel')}</strong> {n.surgeon}</p>
                    <p><strong>{t('docOperativeNote.eblColLabel')}</strong> {n.ebl === undefined ? t('docOperativeNote.notRecorded') : `${n.ebl} mL`} | <strong>{t('docOperativeNote.specimensColLabel')}</strong> {n.specimens.length}</p>
                    {n.complications && <p className="text-critical-subtle-fg">{t('docOperativeNote.complicationsLine', { text: n.complications })}</p>}
                    <details className="mt-3 rounded border border-border-interactive p-3">
                      <summary className="cursor-pointer font-medium">{t('docOperativeNote.savedDetails')}</summary>
                      <div className="mt-3"><StoredValue value={n} /></div>
                    </details>
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

export default OperativeNotePage;
