import React, { useState } from 'react';
import { Baby, Heart, AlertTriangle, Clock, User, Activity } from 'lucide-react';
import PatientSelect, { useDirectoryPatient } from '../components/PatientSelect';
import { createOb, useTranslation, formatTimestamp, ChoiceChips, useScoringCatalog, fhrCategoryPreview } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import { useSubmitGuard } from '../hooks/useSubmitGuard';

type FetalHeartCategory = 'I' | 'II' | 'III';
type LaborStage = 'latent' | 'active' | 'second' | 'third' | 'postpartum';

// Every finding is unrecorded until entered: '' or null, never a normal value.
interface FetalHeartMonitoring {
  baseline: number | null;
  variability: 'absent' | 'minimal' | 'moderate' | 'marked' | '';
  accelerations: boolean | null;
  decelerations: 'none' | 'early' | 'variable' | 'late' | 'prolonged' | '';
}

/** One assessment filed in this session, as the history list shows it. */
interface ObAssessment {
  id: string;
  patientName: string;
  assessedAt: string;
  gravida: number | null;
  para: number | null;
  gestationalAge: number | null;
  dilation: number | null;
  effacement: number | null;
  station: number | null;
  /** The server's category; null when the tracing was incomplete. */
  fhrCategory: FetalHeartCategory | null;
  complications: string[];
}

const fhrCategories: Record<FetalHeartCategory, { desc: string; color: string }> = {
  'I': { desc: 'Normal - Continue routine monitoring', color: 'bg-ok-subtle text-ok-subtle-fg' },
  'II': { desc: 'Indeterminate - Evaluate and continue monitoring', color: 'bg-caution-subtle text-caution-subtle-fg' },
  'III': { desc: 'Abnormal - Requires immediate evaluation', color: 'bg-critical-subtle text-critical-subtle-fg' }
};

const obComplications = [
  'Preeclampsia', 'Eclampsia', 'HELLP syndrome', 'Placenta previa', 'Placental abruption',
  'Cord prolapse', 'Shoulder dystocia', 'Postpartum hemorrhage', 'Uterine rupture',
  'Chorioamnionitis', 'Preterm labor', 'PPROM', 'Fetal distress', 'Breech presentation'
];

const obInterventions = [
  'IV access', 'Fluid bolus', 'Magnesium sulfate', 'Betamethasone', 'Terbutaline',
  'Oxytocin augmentation', 'Amniotomy', 'Foley bulb', 'Epidural', 'C-section',
  'Vacuum assist', 'Forceps assist', 'Manual placenta removal', 'Uterine massage',
  'Methergine', 'Hemabate', 'Bakri balloon', 'Blood transfusion'
];

const ObstetricsPage: React.FC = () => {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToastActions();
  const fhrDesc = (cat: FetalHeartCategory): string => ({
    I: t('docObstetrics.fhrDescI'), II: t('docObstetrics.fhrDescII'), III: t('docObstetrics.fhrDescIII'),
  }[cat]);
  // One save at a time: a second press while a write is in flight used to send it twice.
  const { pending: submitPending, guard: guardSubmit } = useSubmitGuard();
  const [assessments, setAssessments] = useState<ObAssessment[]>([]);
  const [activeTab, setActiveTab] = useState<'assessment' | 'history'>('assessment');
  const [selectedPatient, setSelectedPatient] = useState('');

  // Nothing is pre-chosen (rule 9). The form opened on G1 P0 at 40 weeks with
  // prenatal care, membranes intact, clear fluid, a 0 cm / 0% / station 0
  // cervix, latent labour, cephalic presentation and a Category I tracing at
  // 140 bpm, and filed all of it for a woman nobody had examined. A finding
  // nobody recorded is absent, not normal and not zero (rule 12).
  const [gravida, setGravida] = useState<number | null>(null);
  const [para, setPara] = useState<number | null>(null);
  const [gestationalAge, setGestationalAge] = useState<number | null>(null);
  const [edd, setEdd] = useState('');
  const [prenatalCare, setPrenatalCare] = useState<boolean | null>(null);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [contractions, setContractions] = useState<{ present: boolean | null; frequency: string; duration: string }>({ present: null, frequency: '', duration: '' });
  const [membraneStatus, setMembraneStatus] = useState<'intact' | 'ruptured' | 'unknown' | ''>('');
  const [ruptureTime, setRuptureTime] = useState('');
  const [fluidColor, setFluidColor] = useState<'clear' | 'meconium' | 'bloody' | 'unknown' | ''>('');
  const [cervicalExam, setCervicalExam] = useState<{ dilation: number | null; effacement: number | null; station: number | null }>({ dilation: null, effacement: null, station: null });
  const [laborStage, setLaborStage] = useState<LaborStage | ''>('');
  const [presentation, setPresentation] = useState<'cephalic' | 'breech' | 'transverse' | 'unknown' | ''>('');
  const [selectedComplications, setSelectedComplications] = useState<string[]>([]);
  const [selectedInterventions, setSelectedInterventions] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const [fhr, setFhr] = useState<FetalHeartMonitoring>({
    baseline: null,
    variability: '',
    accelerations: null,
    decelerations: '',
  });


  // The NICHD category, as a preview of what the server computes and stores
  // (rule 8); null until all four tracing findings are entered.
  const { catalog } = useScoringCatalog();
  const fhrCategory = fhrCategoryPreview(fhr, catalog);

  const { entry: selectedPatientEntry, resolve: resolveSelectedPatient } = useDirectoryPatient(selectedPatient);
  const handleSubmit = guardSubmit(async () => {
    if (!selectedPatient) {
      showError(t('docObstetrics.errorSelectPatient'));
      return;
    }
    // Resolved on the server: the first page of the directory held nobody past the fiftieth.
    // Usually already resolved when the patient was chosen; awaiting only when it
    // is not keeps a double press from slipping past the pending-save guard.
    const patient = selectedPatientEntry ?? await resolveSelectedPatient();
    // Only what was recorded, under the names the server reads. The page used
    // to send `gestationalAge`, `edd` and a contractions object, none of which
    // the handler reads, so every assessment stored 0 weeks and no
    // contractions. The id, the assessor and the time are the server's.
    const leadingNumber = (text: string) => { const n = parseInt(text, 10); return Number.isFinite(n) ? n : undefined; };
    const weeks = gestationalAge === null ? undefined : Math.floor(gestationalAge);
    const cervixExamined = cervicalExam.dilation !== null || cervicalExam.effacement !== null || cervicalExam.station !== null;
    const payload = {
      patient_id: selectedPatient,
      gravida: gravida ?? undefined,
      para: para ?? undefined,
      gestational_age_weeks: weeks,
      gestational_age_days: gestationalAge === null || weeks === undefined ? undefined : Math.round((gestationalAge - weeks) * 7),
      edd_date: edd || undefined,
      prenatal_care: prenatalCare ?? undefined,
      chief_complaint: chiefComplaint || undefined,
      contractions: contractions.present ?? undefined,
      contraction_frequency_min: contractions.present ? leadingNumber(contractions.frequency) : undefined,
      contraction_duration_sec: contractions.present ? leadingNumber(contractions.duration) : undefined,
      rupture_of_membranes: membraneStatus === 'ruptured' ? true : membraneStatus === 'intact' ? false : undefined,
      rom_time: membraneStatus === 'ruptured' && ruptureTime ? new Date(ruptureTime).toISOString() : undefined,
      fluid_color: membraneStatus === 'ruptured' ? fluidColor || undefined : undefined,
      cervical_exam_performed: cervixExamined || undefined,
      dilation_cm: cervicalExam.dilation ?? undefined,
      effacement_percent: cervicalExam.effacement ?? undefined,
      station: cervicalExam.station ?? undefined,
      presentation: presentation || undefined,
      labor_stage: laborStage || undefined,
      fetal_heart_rate: fhr.baseline ?? undefined,
      fetal_heart_variability: fhr.variability || undefined,
      fetal_accelerations: fhr.accelerations ?? undefined,
      fetal_decelerations: fhr.decelerations || undefined,
      complications: selectedComplications,
      interventions: selectedInterventions,
      notes: notes || undefined,
    };
    let saved: { assessment_id?: string; fhr_category?: FetalHeartCategory | null };
    try {
      saved = await createOb(payload) as typeof saved;
    } catch (err) {
      console.error('Failed to save OB assessment:', err);
      // Stop here. Falling through added the record to the local list
      // and toasted success for a write that never happened.
      showError(t('common.saveFailed'));
      return;
    }
    setAssessments([{
      id: saved.assessment_id ?? '',
      patientName: patient ? patient.full_name : '',
      assessedAt: new Date().toISOString(),
      gravida, para, gestationalAge,
      dilation: cervicalExam.dilation, effacement: cervicalExam.effacement, station: cervicalExam.station,
      fhrCategory: saved.fhr_category ?? null,
      complications: selectedComplications,
    }, ...assessments]);
    showSuccess(t('docObstetrics.saved'));
  });

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-pink-700 to-rose-800 text-white p-6">
        <div className="flex items-center gap-3">
          <Baby className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docObstetrics.title')}</h1>
            <p className="text-white">{t('docObstetrics.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* FHR Category Alert */}
      {fhrCategory === 'III' && (
        <div className="bg-critical text-critical-fg p-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6" />
          <span className="font-semibold">{t('docObstetrics.cat3Banner')}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {['assessment', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'assessment' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-content-secondary border-b-2 border-pink-600'
                : 'text-content-muted hover:text-content-secondary'}`}
            >
              {tab === 'assessment' ? t('docObstetrics.tabAssessment') : t('docObstetrics.tabHistory')}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'assessment' ? (
          <form onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }} noValidate>
          <div className="space-y-6">
            {/* Patient & OB History */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docObstetrics.patientObHistory')}
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <PatientSelect
                    id="ob-patient"
                    label={t('docObstetrics.patient')}
                    value={selectedPatient}
                    onChange={(selectedPatientId) => setSelectedPatient(selectedPatientId)}
                  />
                </div>
                <div>
                  <label htmlFor="ob-gravida" className="text-sm text-content-muted">{t('docObstetrics.gravida')}</label>
                  <input
                    id="ob-gravida"
                    type="number"
                    value={gravida ?? ''}
                    onChange={e => setGravida(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full border rounded p-2"
                    min="1"
                  />
                </div>
                <div>
                  <label htmlFor="ob-para" className="text-sm text-content-muted">{t('docObstetrics.para')}</label>
                  <input
                    id="ob-para"
                    type="number"
                    value={para ?? ''}
                    onChange={e => setPara(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full border rounded p-2"
                    min="0"
                  />
                </div>
                <div>
                  <label htmlFor="ob-gestational-age" className="text-sm text-content-muted">{t('docObstetrics.gaWeeks')}</label>
                  <input
                    id="ob-gestational-age"
                    type="number"
                    value={gestationalAge ?? ''}
                    onChange={e => setGestationalAge(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full border rounded p-2"
                    step="0.1"
                  />
                </div>
                <div>
                  <label htmlFor="ob-edd" className="text-sm text-content-muted">{t('docObstetrics.edd')}</label>
                  <input
                    id="ob-edd"
                    type="date"
                    value={edd}
                    onChange={e => setEdd(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <ChoiceChips
                    id="ob-prenatal-care"
                    label={t('docObstetrics.prenatalCare')}
                    value={prenatalCare === null ? undefined : prenatalCare ? 'yes' : 'no'}
                    onChange={(next) => setPrenatalCare(next === undefined ? null : next === 'yes')}
                    options={[
                      { value: 'yes', label: t('docObstetrics.yes') },
                      { value: 'no', label: t('docObstetrics.no') },
                    ]}
                  />
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="ob-chief-complaint" className="text-sm text-content-muted">{t('docObstetrics.chiefComplaint')}</label>
                  <input
                    id="ob-chief-complaint"
                    type="text"
                    value={chiefComplaint}
                    onChange={e => setChiefComplaint(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docObstetrics.chiefComplaintPh')}
                  />
                </div>
              </div>
            </div>

            {/* Labor Assessment */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5" /> {t('docObstetrics.laborAssessment')}
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <ChoiceChips
                    id="ob-contractions"
                    label={t('docObstetrics.contractions')}
                    value={contractions.present === null ? undefined : contractions.present ? 'yes' : 'no'}
                    onChange={(next) => setContractions({ ...contractions, present: next === undefined ? null : next === 'yes' })}
                    options={[
                      { value: 'yes', label: t('docObstetrics.yes') },
                      { value: 'no', label: t('docObstetrics.no') },
                    ]}
                  />
                  {contractions.present && (
                    <div className="space-y-2">
                      <label htmlFor="ob-contractions-frequency" className="sr-only">{t('docObstetrics.contractionsFreqAria')}</label>
                      <input
                        id="ob-contractions-frequency"
                        type="text"
                        value={contractions.frequency}
                        onChange={e => setContractions({ ...contractions, frequency: e.target.value })}
                        className="w-full border rounded p-2"
                        placeholder={t('docObstetrics.contractionsFreqPh')}
                      />
                      <label htmlFor="ob-contractions-duration" className="sr-only">{t('docObstetrics.contractionsDurAria')}</label>
                      <input
                        id="ob-contractions-duration"
                        type="text"
                        value={contractions.duration}
                        onChange={e => setContractions({ ...contractions, duration: e.target.value })}
                        className="w-full border rounded p-2"
                        placeholder={t('docObstetrics.contractionsDurPh')}
                      />
                    </div>
                  )}
                </div>
                <div>
                  <ChoiceChips
                    id="ob-membrane-status"
                    label={t('docObstetrics.membraneStatus')}
                    value={membraneStatus || undefined}
                    onChange={(next) => setMembraneStatus((next ?? '') as 'intact' | 'ruptured' | 'unknown' | '')}
                    options={[
                      { value: 'intact', label: t('docObstetrics.msIntact') },
                      { value: 'ruptured', label: t('docObstetrics.msRuptured') },
                      { value: 'unknown', label: t('docObstetrics.msUnknown') },
                    ]}
                  />
                  {membraneStatus === 'ruptured' && (
                    <>
                      <label htmlFor="ob-rupture-time" className="sr-only">{t('docObstetrics.ruptureTimeAria')}</label>
                      <input
                        id="ob-rupture-time"
                        type="datetime-local"
                        value={ruptureTime}
                        onChange={e => setRuptureTime(e.target.value)}
                        className="w-full border rounded p-2 mt-2"
                      />
                      <ChoiceChips
                        id="ob-fluid-color"
                        label={t('docObstetrics.fluidColorAria')}
                        value={fluidColor || undefined}
                        onChange={(next) => setFluidColor((next ?? '') as 'clear' | 'meconium' | 'bloody' | 'unknown' | '')}
                        options={[
                          { value: 'clear', label: t('docObstetrics.fcClear') },
                          { value: 'meconium', label: t('docObstetrics.fcMeconium') },
                          { value: 'bloody', label: t('docObstetrics.fcBloody') },
                          { value: 'unknown', label: t('docObstetrics.fcUnknown') },
                        ]}
                      />
                    </>
                  )}
                </div>
                <div>
                  <ChoiceChips
                    id="ob-presentation"
                    label={t('docObstetrics.presentation')}
                    value={presentation || undefined}
                    onChange={(next) => setPresentation((next ?? '') as 'cephalic' | 'breech' | 'transverse' | 'unknown' | '')}
                    options={[
                      { value: 'cephalic', label: t('docObstetrics.presCephalic') },
                      { value: 'breech', label: t('docObstetrics.presBreech') },
                      { value: 'transverse', label: t('docObstetrics.presTransverse') },
                      { value: 'unknown', label: t('docObstetrics.presUnknown') },
                    ]}
                  />
                </div>
                <div>
                  <ChoiceChips
                    id="ob-labor-stage"
                    label={t('docObstetrics.laborStage')}
                    value={laborStage || undefined}
                    onChange={(next) => setLaborStage((next ?? '') as LaborStage | '')}
                    options={[
                      { value: 'latent', label: t('docObstetrics.lsLatent') },
                      { value: 'active', label: t('docObstetrics.lsActive') },
                      { value: 'second', label: t('docObstetrics.lsSecond') },
                      { value: 'third', label: t('docObstetrics.lsThird') },
                      { value: 'postpartum', label: t('docObstetrics.lsPostpartum') },
                    ]}
                  />
                </div>
              </div>
              <div className="grid md:grid-cols-3 gap-4 mt-4">
                <div>
                  <label htmlFor="ob-dilation" className="text-sm text-content-muted">{t('docObstetrics.dilation')}</label>
                  <input
                    id="ob-dilation"
                    type="number"
                    value={cervicalExam.dilation ?? ''}
                    onChange={e => setCervicalExam({ ...cervicalExam, dilation: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-full border rounded p-2"
                    min="0" max="10"
                  />
                </div>
                <div>
                  <label htmlFor="ob-effacement" className="text-sm text-content-muted">{t('docObstetrics.effacement')}</label>
                  <input
                    id="ob-effacement"
                    type="number"
                    value={cervicalExam.effacement ?? ''}
                    onChange={e => setCervicalExam({ ...cervicalExam, effacement: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-full border rounded p-2"
                    min="0" max="100"
                  />
                </div>
                <div>
                  <label htmlFor="ob-station" className="text-sm text-content-muted">{t('docObstetrics.station')}</label>
                  <select
                    id="ob-station"
                    value={cervicalExam.station ?? ''}
                    onChange={e => setCervicalExam({ ...cervicalExam, station: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docObstetrics.notExamined')}</option>
                    {[-3, -2, -1, 0, 1, 2, 3].map(s => (
                      <option key={s} value={s}>{s > 0 ? `+${s}` : s}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Fetal Heart Rate Monitoring */}
            <div className="bg-surface rounded-lg shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold flex items-center gap-2">
                  <Heart className="w-5 h-5" /> {t('docObstetrics.fhrMonitoring')}
                </h2>
                {fhrCategory && (
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${fhrCategories[fhrCategory].color}`}>
                    {t('docObstetrics.categoryBadge', { cat: fhrCategory })}
                  </span>
                )}
              </div>
              <p className="text-sm text-content-muted mb-4">{fhrCategory ? fhrDesc(fhrCategory) : t('docObstetrics.fhrNeedsAll')}</p>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="ob-fhr-baseline" className="text-sm text-content-muted">{t('docObstetrics.baseline')}</label>
                  <input
                    id="ob-fhr-baseline"
                    type="number"
                    value={fhr.baseline ?? ''}
                    onChange={e => setFhr({ ...fhr, baseline: e.target.value === '' ? null : Number(e.target.value) })}
                    className={`w-full border rounded p-2 ${fhr.baseline !== null && catalog?.fhr && (fhr.baseline < catalog.fhr.baseline_normal_low || fhr.baseline > catalog.fhr.baseline_normal_high) ? 'border-red-500 bg-critical-subtle' : ''}`}
                  />
                  <p className="text-xs text-content-muted">{t('docObstetrics.baselineNormal')}</p>
                </div>
                <div>
                  <ChoiceChips
                    id="ob-fhr-variability"
                    label={t('docObstetrics.variability')}
                    value={fhr.variability || undefined}
                    onChange={(next) => setFhr({ ...fhr, variability: (next ?? '') as FetalHeartMonitoring['variability'] })}
                    options={[
                      { value: 'absent', label: t('docObstetrics.varAbsent') },
                      { value: 'minimal', label: t('docObstetrics.varMinimal') },
                      { value: 'moderate', label: t('docObstetrics.varModerate') },
                      { value: 'marked', label: t('docObstetrics.varMarked') },
                    ]}
                  />
                </div>
                <div>
                  <ChoiceChips
                    id="ob-fhr-accelerations"
                    label={t('docObstetrics.accelerations')}
                    value={fhr.accelerations === null ? undefined : fhr.accelerations ? 'yes' : 'no'}
                    onChange={(next) => setFhr({ ...fhr, accelerations: next === undefined ? null : next === 'yes' })}
                    options={[
                      { value: 'yes', label: t('docObstetrics.accPresent') },
                      { value: 'no', label: t('docObstetrics.accAbsent') },
                    ]}
                  />
                </div>
                <div>
                  <ChoiceChips
                    id="ob-fhr-decelerations"
                    label={t('docObstetrics.decelerations')}
                    value={fhr.decelerations || undefined}
                    onChange={(next) => setFhr({ ...fhr, decelerations: (next ?? '') as FetalHeartMonitoring['decelerations'] })}
                    options={[
                      { value: 'none', label: t('docObstetrics.decNone') },
                      { value: 'early', label: t('docObstetrics.decEarly') },
                      { value: 'variable', label: t('docObstetrics.decVariable') },
                      { value: 'late', label: t('docObstetrics.decLate') },
                      { value: 'prolonged', label: t('docObstetrics.decProlonged') },
                    ]}
                  />
                </div>
              </div>
            </div>

            {/* Complications */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> {t('docObstetrics.complications')}
              </h2>
              <div className="flex flex-wrap gap-2">
                {obComplications.map(c => (
                  <label key={c} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedComplications.includes(c) ? 'bg-critical-subtle border-critical' : 'bg-surface-sunken'}`}>
                    <input
                      type="checkbox"
                      checked={selectedComplications.includes(c)}
                      onChange={e => {
                        if (e.target.checked) setSelectedComplications([...selectedComplications, c]);
                        else setSelectedComplications(selectedComplications.filter(x => x !== c));
                      }}
                      className="mr-1"
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>

            {/* Interventions */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Activity className="w-5 h-5" /> {t('docObstetrics.interventions')}
              </h2>
              <div className="flex flex-wrap gap-2">
                {obInterventions.map(i => (
                  <label key={i} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedInterventions.includes(i) ? 'bg-ok-subtle border-ok' : 'bg-surface-sunken'}`}>
                    <input
                      type="checkbox"
                      checked={selectedInterventions.includes(i)}
                      onChange={e => {
                        if (e.target.checked) setSelectedInterventions([...selectedInterventions, i]);
                        else setSelectedInterventions(selectedInterventions.filter(x => x !== i));
                      }}
                      className="mr-1"
                    />
                    {i}
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-surface rounded-lg shadow p-4">
              <label htmlFor="ob-notes" className="font-semibold mb-3 block">{t('docObstetrics.notes')}</label>
              <textarea
                id="ob-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder={t('docObstetrics.notesPh')}
              />
            </div>

            {/* Submit */}
            <button type="submit" aria-disabled={submitPending || undefined}
              className="aria-disabled:cursor-wait w-full py-3 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700"
            >
              {t('docObstetrics.save')}
            </button>
          </div>
          </form>
        ) : (
          <div className="space-y-4">
            {assessments.length === 0 ? (
              <div className="text-center py-8 text-content-muted">{t('docObstetrics.noAssessments')}</div>
            ) : (
              assessments.map(a => (
                <div key={a.id} className="bg-surface rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{a.patientName}</h3>
                      <p className="text-sm text-content-muted">{formatTimestamp(a.assessedAt)}</p>
                    </div>
                    {a.fhrCategory && (
                      <span className={`px-2 py-1 text-xs rounded ${fhrCategories[a.fhrCategory].color}`}>
                        {t('docObstetrics.fhrCat', { cat: a.fhrCategory })}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <div><strong>G{a.gravida ?? '—'}P{a.para ?? '—'}</strong></div>
                    <div>{a.gestationalAge === null ? '—' : t('docObstetrics.gaValue', { weeks: a.gestationalAge })}</div>
                    <div>{a.dilation ?? '—'}cm / {a.effacement ?? '—'}%</div>
                    <div>{a.station === null ? '—' : t('docObstetrics.stationValue', { station: a.station })}</div>
                  </div>
                  {a.complications.length > 0 && (
                    <p className="text-sm text-critical-subtle-fg mt-2">{t('docObstetrics.complicationsList', { list: a.complications.join(', ') })}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ObstetricsPage;
