import React, { useState, useEffect } from 'react';
import { Syringe, User, Heart, Droplets, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients, createAnesthesia, useTranslation } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { useToastActions } from '../components/Toast';

type AnesthesiaType = 'general' | 'spinal' | 'epidural' | 'regional' | 'local' | 'mac' | 'combined';
type ASAClass = '1' | '2' | '3' | '4' | '5' | '6' | '1E' | '2E' | '3E' | '4E' | '5E';

interface VitalReading {
  time: string;
  bp: string;
  hr: number;
  spo2: number;
  etco2: number;
  rr: number;
  fio2: number;
}

interface AnesthesiaRecord {
  id: string;
  patientId: string;
  patientName: string;
  documentedBy: string;
  documentedAt: string;
  procedure: string;
  asaClass: ASAClass;
  anesthesiaType: AnesthesiaType;
  airwayType: string;
  intubationTime: string;
  extubationTime: string;
  inductionAgents: string;
  maintenanceAgents: string;
  analgesics: string;
  relaxants: string;
  reversals: string;
  vasoactives: string;
  antiemetics: string;
  fluidsGiven: string;
  bloodProducts: string;
  ebl: number;
  urineOutput: number;
  vitals: VitalReading[];
  complications: string[];
  notes: string;
}

const asaDescriptions: Record<ASAClass, string> = {
  '1': 'Healthy patient', '2': 'Mild systemic disease', '3': 'Severe systemic disease',
  '4': 'Severe disease, constant threat to life', '5': 'Moribund, not expected to survive',
  '6': 'Brain-dead organ donor',
  '1E': 'ASA 1 Emergency', '2E': 'ASA 2 Emergency', '3E': 'ASA 3 Emergency',
  '4E': 'ASA 4 Emergency', '5E': 'ASA 5 Emergency'
};

const airwayTypes = ['ETT', 'LMA', 'Mask', 'Nasal Cannula', 'Non-Rebreather', 'CPAP/BiPAP', 'None'];

const complicationsList = [
  'Difficult intubation', 'Aspiration', 'Bronchospasm', 'Laryngospasm',
  'Hypotension', 'Hypertension', 'Bradycardia', 'Tachycardia', 'Arrhythmia',
  'Hypoxia', 'Awareness', 'Allergic reaction', 'PONV', 'Hypothermia', 'None'
];

const AnesthesiaPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [records, setRecords] = useState<AnesthesiaRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'record' | 'history'>('record');
  const [selectedPatient, setSelectedPatient] = useState('');

  const [procedure, setProcedure] = useState('');
  const [asaClass, setAsaClass] = useState<ASAClass>('1');
  const [anesthesiaType, setAnesthesiaType] = useState<AnesthesiaType>('general');
  const [airwayType, setAirwayType] = useState('ETT');
  const [intubationTime, setIntubationTime] = useState('');
  const [extubationTime, setExtubationTime] = useState('');
  const [inductionAgents, setInductionAgents] = useState('');
  const [maintenanceAgents, setMaintenanceAgents] = useState('');
  const [analgesics, setAnalgesics] = useState('');
  const [relaxants, setRelaxants] = useState('');
  const [reversals, setReversals] = useState('');
  const [vasoactives, setVasoactives] = useState('');
  const [antiemetics, setAntiemetics] = useState('');
  const [fluidsGiven, setFluidsGiven] = useState('');
  const [bloodProducts, setBloodProducts] = useState('');
  const [ebl, setEbl] = useState(0);
  const [urineOutput, setUrineOutput] = useState(0);
  const [vitals, setVitals] = useState<VitalReading[]>([]);
  const [complications, setComplications] = useState<string[]>([]);
  const [notes, setNotes2] = useState('');

  // New vital entry
  const [newVital, setNewVital] = useState<VitalReading>({
    time: '', bp: '120/80', hr: 70, spo2: 99, etco2: 35, rr: 12, fio2: 100
  });

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

  const addVital = () => {
    if (!newVital.time) {
      showWarning(t('docAnesthesia.warnEnterTime'));
      return;
    }
    setVitals([...vitals, { ...newVital }]);
    setNewVital({ time: '', bp: '120/80', hr: 70, spo2: 99, etco2: 35, rr: 12, fio2: 100 });
  };

  const handleSubmit = async () => {
    if (!selectedPatient) {
      showError(t('docAnesthesia.warnSelectPatient'));
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const record: AnesthesiaRecord = {
      id: `ANES-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      documentedBy: user?.userId || 'Unknown',
      documentedAt: new Date().toISOString(),
      procedure, asaClass, anesthesiaType, airwayType, intubationTime, extubationTime,
      inductionAgents, maintenanceAgents, analgesics, relaxants, reversals,
      vasoactives, antiemetics, fluidsGiven, bloodProducts, ebl, urineOutput,
      vitals, complications, notes
    };
    try {
      await createAnesthesia(record);
    } catch (err) {
      console.error('Failed to save anesthesia record:', err);
    }
    setRecords([record, ...records]);
    showSuccess(t('docAnesthesia.saved'));
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-600 to-teal-500 text-white p-6">
        <div className="flex items-center gap-3">
          <Syringe className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docAnesthesia.title')}</h1>
            <p className="text-cyan-100">{t('docAnesthesia.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {['record', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'record' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-cyan-600 border-b-2 border-cyan-600'
                : 'text-content-muted hover:text-content-secondary'}`}
            >
              {tab === 'record' ? t('docAnesthesia.tabRecord') : t('docAnesthesia.tabHistory')}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'record' ? (
          <div className="space-y-6">
            {/* Patient & Case Info */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docAnesthesia.patientCaseInfo')}
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="anes-patient" className="text-sm text-content-muted">{t('docAnesthesia.patient')}</label>
                  <select
                    id="anes-patient"
                    value={selectedPatient}
                    onChange={e => setSelectedPatient(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docAnesthesia.select')}</option>
                    {patients.map(p => (
                      <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="anes-procedure" className="text-sm text-content-muted">{t('docAnesthesia.procedure')}</label>
                  <input
                    id="anes-procedure"
                    type="text"
                    value={procedure}
                    onChange={e => setProcedure(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="anes-asa-class" className="text-sm text-content-muted">{t('docAnesthesia.asaClass')}</label>
                  <select                    id="anes-asa-class"                    value={asaClass}
                    onChange={e => setAsaClass(e.target.value as ASAClass)}
                    className="w-full border rounded p-2"
                  >
                    {Object.entries(asaDescriptions).map(([k, v]) => (
                      <option key={k} value={k}>{t('docAnesthesia.asaOption', { class: k, desc: v })}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="anes-type" className="text-sm text-content-muted">{t('docAnesthesia.anesthesiaType')}</label>
                  <select
                    id="anes-type"
                    value={anesthesiaType}
                    onChange={e => setAnesthesiaType(e.target.value as AnesthesiaType)}
                    className="w-full border rounded p-2"
                  >
                    <option value="general">{t('docAnesthesia.typeGeneral')}</option>
                    <option value="spinal">{t('docAnesthesia.typeSpinal')}</option>
                    <option value="epidural">{t('docAnesthesia.typeEpidural')}</option>
                    <option value="regional">{t('docAnesthesia.typeRegional')}</option>
                    <option value="local">{t('docAnesthesia.typeLocal')}</option>
                    <option value="mac">{t('docAnesthesia.typeMac')}</option>
                    <option value="combined">{t('docAnesthesia.typeCombined')}</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Airway */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docAnesthesia.airwayManagement')}</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="anes-airway-type" className="text-sm text-content-muted">{t('docAnesthesia.airwayType')}</label>
                  <select
                    id="anes-airway-type"
                    value={airwayType}
                    onChange={e => setAirwayType(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    {airwayTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="anes-intubation-time" className="text-sm text-content-muted">{t('docAnesthesia.intubationTime')}</label>
                  <input
                    id="anes-intubation-time"
                    type="time"
                    value={intubationTime}
                    onChange={e => setIntubationTime(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="anes-extubation-time" className="text-sm text-content-muted">{t('docAnesthesia.extubationTime')}</label>
                  <input
                    id="anes-extubation-time"
                    type="time"
                    value={extubationTime}
                    onChange={e => setExtubationTime(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
              </div>
            </div>

            {/* Medications */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Syringe className="w-5 h-5" /> {t('docAnesthesia.medications')}
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="anes-induction-agents" className="text-sm text-content-muted">{t('docAnesthesia.inductionAgents')}</label>
                  <input
                    id="anes-induction-agents"
                    type="text"
                    value={inductionAgents}
                    onChange={e => setInductionAgents(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docAnesthesia.inductionPh')}
                  />
                </div>
                <div>
                  <label htmlFor="anes-maintenance-agents" className="text-sm text-content-muted">{t('docAnesthesia.maintenanceAgents')}</label>
                  <input
                    id="anes-maintenance-agents"
                    type="text"
                    value={maintenanceAgents}
                    onChange={e => setMaintenanceAgents(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docAnesthesia.maintenancePh')}
                  />
                </div>
                <div>
                  <label htmlFor="anes-analgesics" className="text-sm text-content-muted">{t('docAnesthesia.analgesics')}</label>
                  <input
                    id="anes-analgesics"
                    type="text"
                    value={analgesics}
                    onChange={e => setAnalgesics(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docAnesthesia.analgesicsPh')}
                  />
                </div>
                <div>
                  <label htmlFor="anes-relaxants" className="text-sm text-content-muted">{t('docAnesthesia.relaxants')}</label>
                  <input
                    id="anes-relaxants"
                    type="text"
                    value={relaxants}
                    onChange={e => setRelaxants(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docAnesthesia.relaxantsPh')}
                  />
                </div>
                <div>
                  <label htmlFor="anes-reversals" className="text-sm text-content-muted">{t('docAnesthesia.reversals')}</label>
                  <input
                    id="anes-reversals"
                    type="text"
                    value={reversals}
                    onChange={e => setReversals(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docAnesthesia.reversalsPh')}
                  />
                </div>
                <div>
                  <label htmlFor="anes-vasoactives" className="text-sm text-content-muted">{t('docAnesthesia.vasoactives')}</label>
                  <input
                    id="anes-vasoactives"
                    type="text"
                    value={vasoactives}
                    onChange={e => setVasoactives(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docAnesthesia.vasoactivesPh')}
                  />
                </div>
                <div>
                  <label htmlFor="anes-antiemetics" className="text-sm text-content-muted">{t('docAnesthesia.antiemetics')}</label>
                  <input
                    id="anes-antiemetics"
                    type="text"
                    value={antiemetics}
                    onChange={e => setAntiemetics(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docAnesthesia.antiemeticsPh')}
                  />
                </div>
              </div>
            </div>

            {/* Fluids & I/O */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Droplets className="w-5 h-5" /> {t('docAnesthesia.fluidsBlood')}
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="anes-fluids" className="text-sm text-content-muted">{t('docAnesthesia.crystalloids')}</label>
                  <input
                    id="anes-fluids"
                    type="text"
                    value={fluidsGiven}
                    onChange={e => setFluidsGiven(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docAnesthesia.crystalloidsPh')}
                  />
                </div>
                <div>
                  <label htmlFor="anes-blood-products" className="text-sm text-content-muted">{t('docAnesthesia.bloodProducts')}</label>
                  <input
                    id="anes-blood-products"
                    type="text"
                    value={bloodProducts}
                    onChange={e => setBloodProducts(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docAnesthesia.bloodProductsPh')}
                  />
                </div>
                <div>
                  <label htmlFor="anes-ebl" className="text-sm text-content-muted">{t('docAnesthesia.ebl')}</label>
                  <input
                    id="anes-ebl"
                    type="number"
                    value={ebl}
                    onChange={e => setEbl(Number(e.target.value))}
                    className={`w-full border rounded p-2 ${ebl > 500 ? 'border-red-500 bg-critical-subtle' : ''}`}
                  />
                </div>
                <div>
                  <label htmlFor="anes-urine-output" className="text-sm text-content-muted">{t('docAnesthesia.urineOutput')}</label>
                  <input
                    id="anes-urine-output"
                    type="number"
                    value={urineOutput}
                    onChange={e => setUrineOutput(Number(e.target.value))}
                    className="w-full border rounded p-2"
                  />
                </div>
              </div>
            </div>

            {/* Vitals Trend */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Heart className="w-5 h-5" /> {t('docAnesthesia.intraopVitals')}
              </h2>
              {vitals.length > 0 && (
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-sunken">
                      <tr>
                        <th className="p-2 text-left">{t('docAnesthesia.vitalTime')}</th>
                        <th className="p-2">BP</th>
                        <th className="p-2">HR</th>
                        <th className="p-2">SpO2</th>
                        <th className="p-2">EtCO2</th>
                        <th className="p-2">RR</th>
                        <th className="p-2">FiO2</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vitals.map((v, i) => (
                        <tr key={i} className="border-b">
                          <td className="p-2">{v.time}</td>
                          <td className="p-2 text-center">{v.bp}</td>
                          <td className="p-2 text-center">{v.hr}</td>
                          <td className="p-2 text-center">{v.spo2}%</td>
                          <td className="p-2 text-center">{v.etco2}</td>
                          <td className="p-2 text-center">{v.rr}</td>
                          <td className="p-2 text-center">{v.fio2}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="grid grid-cols-8 gap-2 items-end">
                <div>
                  <label htmlFor="anes-vital-time" className="text-xs text-content-muted">{t('docAnesthesia.vitalTime')}</label>
                  <input
                    id="anes-vital-time"
                    type="time"
                    value={newVital.time}
                    onChange={e => setNewVital({ ...newVital, time: e.target.value })}
                    className="w-full border rounded p-1 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="anes-vital-bp" className="text-xs text-content-muted">BP</label>
                  <input
                    id="anes-vital-bp"
                    type="text"
                    value={newVital.bp}
                    onChange={e => setNewVital({ ...newVital, bp: e.target.value })}
                    className="w-full border rounded p-1 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="anes-vital-hr" className="text-xs text-content-muted">HR</label>
                  <input
                    id="anes-vital-hr"
                    type="number"
                    value={newVital.hr}
                    onChange={e => setNewVital({ ...newVital, hr: Number(e.target.value) })}
                    className="w-full border rounded p-1 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="anes-vital-spo2" className="text-xs text-content-muted">SpO2</label>
                  <input
                    id="anes-vital-spo2"
                    type="number"
                    value={newVital.spo2}
                    onChange={e => setNewVital({ ...newVital, spo2: Number(e.target.value) })}
                    className="w-full border rounded p-1 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="anes-vital-etco2" className="text-xs text-content-muted">EtCO2</label>
                  <input
                    id="anes-vital-etco2"
                    type="number"
                    value={newVital.etco2}
                    onChange={e => setNewVital({ ...newVital, etco2: Number(e.target.value) })}
                    className="w-full border rounded p-1 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="anes-vital-rr" className="text-xs text-content-muted">RR</label>
                  <input
                    id="anes-vital-rr"
                    type="number"
                    value={newVital.rr}
                    onChange={e => setNewVital({ ...newVital, rr: Number(e.target.value) })}
                    className="w-full border rounded p-1 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="anes-vital-fio2" className="text-xs text-content-muted">FiO2%</label>
                  <input
                    id="anes-vital-fio2"
                    type="number"
                    value={newVital.fio2}
                    onChange={e => setNewVital({ ...newVital, fio2: Number(e.target.value) })}
                    className="w-full border rounded p-1 text-sm"
                  />
                </div>
                <button onClick={addVital} className="bg-cyan-600 text-white rounded p-1 text-sm">{t('docAnesthesia.addBtn')}</button>
              </div>
            </div>

            {/* Complications */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> {t('docAnesthesia.complications')}
              </h2>
              <div className="flex flex-wrap gap-2">
                {complicationsList.map(c => (
                  <label key={c} className={`px-3 py-1 rounded border text-sm cursor-pointer ${complications.includes(c)
                    ? c === 'None' ? 'bg-ok-subtle border-ok' : 'bg-critical-subtle border-critical'
                    : 'bg-surface-sunken'}`}>
                    <input
                      type="checkbox"
                      checked={complications.includes(c)}
                      onChange={e => {
                        if (e.target.checked) setComplications([...complications, c]);
                        else setComplications(complications.filter(x => x !== c));
                      }}
                      className="mr-1"
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-surface rounded-lg shadow p-4">
              <label htmlFor="anes-notes" className="font-semibold mb-3 block">{t('docAnesthesia.notes')}</label>
              <textarea
                id="anes-notes"
                value={notes}
                onChange={e => setNotes2(e.target.value)}
                className="w-full border rounded p-2 h-24"
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-cyan-600 text-white rounded-lg font-semibold hover:bg-cyan-700"
            >
              {t('docAnesthesia.save')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {records.length === 0 ? (
              <div className="text-center py-8 text-content-muted">{t('docAnesthesia.noRecords')}</div>
            ) : (
              records.map(r => (
                <div key={r.id} className="bg-surface rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{r.patientName}</h3>
                      <p className="text-sm text-content-muted">{new Date(r.documentedAt).toLocaleString()}</p>
                    </div>
                    <span className="px-2 py-1 text-xs rounded bg-cyan-100 text-cyan-700">
                      {t('docAnesthesia.asaBadge', { class: r.asaClass })}
                    </span>
                  </div>
                  <div className="text-sm">
                    <p><strong>{t('docAnesthesia.lblProcedure')}</strong> {r.procedure}</p>
                    <p><strong>{t('docAnesthesia.lblType')}</strong> {r.anesthesiaType} | <strong>{t('docAnesthesia.lblAirway')}</strong> {r.airwayType}</p>
                    <p>{t('docAnesthesia.summaryLine', { ebl: r.ebl, uo: r.urineOutput, count: r.vitals.length })}</p>
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

export default AnesthesiaPage;
