import React, { useState, useEffect } from 'react';
import { Scissors, User, FileText, Droplet, Package } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients, createOperativeNote, apiUrl, useTranslation } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientProfile } from '@medichain/shared';

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
  anesthesiaType: AnesthesiaType;
  incision: string;
  findings: string;
  procedure: string;
  closure: string;
  drains: string;
  ebl: number;
  urineOutput: number;
  fluidIn: number;
  specimens: Specimen[];
  woundClass: WoundClass;
  implants: string;
  complications: string;
  disposition: string;
  createdAt: string;
}

const commonProcedures = [
  'Appendectomy', 'Cholecystectomy', 'Hernia repair', 'Exploratory laparotomy',
  'Open reduction internal fixation', 'Arthroscopy', 'Laminectomy', 'Mastectomy',
  'Thyroidectomy', 'Colectomy', 'Coronary artery bypass', 'Valve replacement'
];

const woundClasses: WoundClass[] = ['clean', 'clean-contaminated', 'contaminated', 'dirty'];

const OperativeNotePage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [notes, setNotes] = useState<OperativeNote[]>([]);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [selectedPatient, setSelectedPatient] = useState('');

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
  const [anesthesiaType, setAnesthesiaType] = useState<AnesthesiaType>('general');
  const [incision, setIncision] = useState('');
  const [findings, setFindings] = useState('');
  const [procedureText, setProcedureText] = useState('');
  const [closure, setClosure] = useState('');
  const [drains, setDrains] = useState('');
  const [ebl, setEbl] = useState(0);
  const [urineOutput, setUrineOutput] = useState(0);
  const [fluidIn, setFluidIn] = useState(0);
  const [specimens, setSpecimens] = useState<Specimen[]>([]);
  const [woundClass, setWoundClass] = useState<WoundClass>('clean');
  const [implants, setImplants] = useState('');
  const [complications, setComplications] = useState('');
  const [disposition, setDisposition] = useState('');

  const [newSpecimen, setNewSpecimen] = useState({ description: '', disposition: 'pathology' as Specimen['disposition'] });

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
          const res = await fetch(apiUrl(`/api/surgical/operative-note/patient/${selectedPatient}`), {
            headers: { 'X-User-Id': user.walletAddress, 'X-Provider-Role': user.role },
          });
          if (res.ok) {
            const data = await res.json();
            const records = Array.isArray(data) ? data : (data.records || data.notes || []);
            // Merge with local notes
            const mappedRecords: OperativeNote[] = records.map((r: Record<string, unknown>) => ({
              id: r.id as string || String(r.note_id),
              patientId: r.patientId as string || r.patient_id as string || selectedPatient,
              patientName: r.patientName as string || r.patient_name as string || '',
              surgeon: r.surgeon as string || '',
              assistant: r.assistant as string || '',
              anesthesiologist: r.anesthesiologist as string || '',
              scrubNurse: r.scrubNurse as string || r.scrub_nurse as string || '',
              circulator: r.circulator as string || '',
              procedureDate: r.procedureDate as string || r.procedure_date as string || '',
              preOpDiagnosis: r.preOpDiagnosis as string || r.pre_op_diagnosis as string || '',
              postOpDiagnosis: r.postOpDiagnosis as string || r.post_op_diagnosis as string || '',
              procedureName: r.procedureName as string || r.procedure_name as string || '',
              cptCodes: r.cptCodes as string || r.cpt_codes as string || '',
              anesthesiaType: (r.anesthesiaType || r.anesthesia_type || 'general') as AnesthesiaType,
              incision: r.incision as string || '',
              findings: r.findings as string || '',
              procedure: r.procedure as string || '',
              closure: r.closure as string || '',
              drains: r.drains as string || '',
              ebl: r.ebl as number || 0,
              urineOutput: r.urineOutput as number || r.urine_output as number || 0,
              fluidIn: r.fluidIn as number || r.fluid_in as number || 0,
              specimens: (r.specimens as Specimen[]) || [],
              woundClass: (r.woundClass || r.wound_class || 'clean') as WoundClass,
              implants: r.implants as string || '',
              complications: r.complications as string || '',
              disposition: r.disposition as string || '',
              createdAt: r.createdAt as string || r.created_at as string || '',
            }));
            setNotes(prev => {
              const existingIds = new Set(prev.map(n => n.id));
              return [...prev, ...mappedRecords.filter(r => !existingIds.has(r.id))];
            });
          }
        } catch (e) {
          console.error('Failed to fetch operative note history:', e);
        }
      };
      fetchHistory();
    }
  }, [activeTab, selectedPatient, user]);

  const addSpecimen = () => {
    if (!newSpecimen.description) return;
    setSpecimens([...specimens, { id: `SPEC-${Date.now()}`, ...newSpecimen }]);
    setNewSpecimen({ description: '', disposition: 'pathology' });
  };

  const removeSpecimen = (id: string) => {
    setSpecimens(specimens.filter(s => s.id !== id));
  };

  const handleSubmit = async () => {
    if (!selectedPatient || !procedureName) {
      showWarning(t('docOperativeNote.warningSelectPatientProcedure'));
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const note: OperativeNote = {
      id: `OP-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      surgeon, assistant, anesthesiologist, scrubNurse, circulator,
      procedureDate, preOpDiagnosis, postOpDiagnosis, procedureName, cptCodes,
      anesthesiaType, incision, findings, procedure: procedureText, closure,
      drains, ebl, urineOutput, fluidIn, specimens, woundClass,
      implants, complications, disposition, createdAt: new Date().toISOString()
    };
    try {
      await createOperativeNote(note);
    } catch (err) {
      console.error('Failed to save operative note:', err);
    }
    setNotes([note, ...notes]);
    showSuccess(t('docOperativeNote.successSaved'));
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-500 text-white p-6">
        <div className="flex items-center gap-3">
          <Scissors className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docOperativeNote.title')}</h1>
            <p className="text-emerald-100">{t('docOperativeNote.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {['new', 'history'].map(tab => (
            <button
              key={tab}
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
          <div className="space-y-6">
            {/* Patient & Team */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docOperativeNote.patientTeamHeading')}
              </h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="opnote-patient" className="text-sm text-content-muted">{t('docOperativeNote.patientLabel')}</label>
                  <select
                    id="opnote-patient"
                    value={selectedPatient}
                    onChange={e => setSelectedPatient(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docOperativeNote.selectEllipsis')}</option>
                    {patients.map(p => (
                      <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>
                    ))}
                  </select>
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
                <div>
                  <label htmlFor="opnote-pre-op-diagnosis" className="text-sm text-content-muted">{t('docOperativeNote.preOpDiagnosisLabel')}</label>
                  <textarea
                    id="opnote-pre-op-diagnosis"
                    value={preOpDiagnosis}
                    onChange={e => setPreOpDiagnosis(e.target.value)}
                    className="w-full border rounded p-2 h-20"
                  />
                </div>
                <div>
                  <label htmlFor="opnote-post-op-diagnosis" className="text-sm text-content-muted">{t('docOperativeNote.postOpDiagnosisLabel')}</label>
                  <textarea
                    id="opnote-post-op-diagnosis"
                    value={postOpDiagnosis}
                    onChange={e => setPostOpDiagnosis(e.target.value)}
                    className="w-full border rounded p-2 h-20"
                  />
                </div>
                <div>
                  <label htmlFor="opnote-procedure-name" className="text-sm text-content-muted">{t('docOperativeNote.procedureNameLabel')}</label>
                  <input
                    id="opnote-procedure-name"
                    list="procedures"
                    value={procedureName}
                    onChange={e => setProcedureName(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docOperativeNote.procedureNamePh')}
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
                    onChange={e => setAnesthesiaType(e.target.value as AnesthesiaType)}
                    className="w-full border rounded p-2"
                  >
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
                    onChange={e => setWoundClass(e.target.value as WoundClass)}
                    className="w-full border rounded p-2"
                  >
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
                    onChange={e => setEbl(Number(e.target.value))}
                    className={`w-full border rounded p-2 ${ebl > 500 ? 'border-red-500 bg-critical-subtle' : ''}`}
                  />
                </div>
                <div>
                  <label htmlFor="opnote-fluids-in" className="text-sm text-content-muted">{t('docOperativeNote.fluidsInLabel')}</label>
                  <input
                    id="opnote-fluids-in"
                    type="number"
                    value={fluidIn}
                    onChange={e => setFluidIn(Number(e.target.value))}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="opnote-urine-output" className="text-sm text-content-muted">{t('docOperativeNote.urineOutputLabel')}</label>
                  <input
                    id="opnote-urine-output"
                    type="number"
                    value={urineOutput}
                    onChange={e => setUrineOutput(Number(e.target.value))}
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
                  className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                >
                  {t('docOperativeNote.addButton')}
                </button>
              </div>
              {specimens.length > 0 ? (
                <ul className="space-y-2">
                  {specimens.map(s => (
                    <li key={s.id} className="flex justify-between items-center bg-surface-sunken p-2 rounded">
                      <span>{s.description} → <span className="text-content-muted">{t(`docOperativeNote.disposition_${s.disposition}`)}</span></span>
                      <button onClick={() => removeSpecimen(s.id)} className="text-red-500 text-sm">{t('docOperativeNote.removeButton')}</button>
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
              className="w-full py-3 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700"
            >
              {t('docOperativeNote.saveButton')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {notes.length === 0 ? (
              <div className="text-center py-8 text-content-muted">{t('docOperativeNote.noNotesYet')}</div>
            ) : (
              notes.map(n => (
                <div key={n.id} className="bg-surface rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{n.patientName}</h3>
                      <p className="text-sm text-content-muted">{new Date(n.procedureDate).toLocaleDateString()}</p>
                    </div>
                    <span className="px-2 py-1 text-xs rounded bg-ok-subtle text-ok-subtle-fg">
                      {t(`docOperativeNote.woundClassBadge_${n.woundClass}`)}
                    </span>
                  </div>
                  <div className="text-sm space-y-1">
                    <p><strong>{t('docOperativeNote.procedureColLabel')}</strong> {n.procedureName}</p>
                    <p><strong>{t('docOperativeNote.surgeonColLabel')}</strong> {n.surgeon}</p>
                    <p><strong>{t('docOperativeNote.eblColLabel')}</strong> {n.ebl} mL | <strong>{t('docOperativeNote.specimensColLabel')}</strong> {n.specimens.length}</p>
                    {n.complications && <p className="text-critical-subtle-fg">{t('docOperativeNote.complicationsLine', { text: n.complications })}</p>}
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
