import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMci, useTranslation, useScoringCatalog } from '@medichain/shared';
import {
  AlertTriangle,
  Users,
  Clock,
  Save,
  Plus,
  Trash2,
  MapPin,
  Tag,
  Activity,
  UserPlus,
  RefreshCw,
  FileText,
  Building2,
  Phone,
  Radio,
  Truck
} from 'lucide-react';

type TriageCategory = 'immediate' | 'delayed' | 'minor' | 'expectant' | 'deceased';

interface MCIPatient {
  id: string;
  tagNumber: string;
  category: TriageCategory;
  age: string;
  gender: string;
  chiefComplaint: string;
  injuries: string[];
  vitals: {
    /** START's first question: did they walk to the collection point unaided? */
    ambulatory: boolean;
    respiratoryRate: number;
    /** Radial pulse rate. 0 means no palpable radial pulse. */
    pulse: number;
    capRefill: number;
    mentalStatus: string;
  };
  location: string;
  destination: string;
  triageTime: string;
  transportTime?: string;
  notes: string;
}

interface IncidentInfo {
  incidentName: string;
  incidentType: string;
  location: string;
  startTime: string;
  commandPost: string;
  incidentCommander: string;
  contactNumber: string;
  estimatedCasualties: number;
  resourcesRequested: string[];
}

const INCIDENT_TYPE_KEYS: Record<string, string> = {
  'Motor Vehicle Accident': 'mva',
  'Mass Shooting': 'shooting',
  'Explosion': 'explosion',
  'Building Collapse': 'buildingCollapse',
  'Chemical Spill': 'chemicalSpill',
  'Fire': 'fire',
  'Natural Disaster': 'naturalDisaster',
  'Train Derailment': 'trainDerailment',
  'Plane Crash': 'planeCrash',
  'Terrorist Attack': 'terroristAttack',
  'Crowd Crush': 'crowdCrush',
  'Other': 'other',
};

const RESOURCE_KEYS: Record<string, string> = {
  'Additional Ambulances': 'ambulances',
  'Fire Department': 'fireDept',
  'Hazmat Team': 'hazmat',
  'Search & Rescue': 'searchRescue',
  'Helicopter/Air Ambulance': 'helicopter',
  'Law Enforcement': 'lawEnforcement',
  'Red Cross': 'redCross',
  'Medical Examiner': 'medicalExaminer',
  'Crisis Counseling Team': 'crisisCounseling',
  'Blood Bank': 'bloodBank',
  'Additional Medical Staff': 'additionalStaff',
};

const INJURY_KEYS: Record<string, string> = {
  'Laceration': 'laceration',
  'Fracture': 'fracture',
  'Burn': 'burn',
  'Crush Injury': 'crush',
  'Head Injury': 'head',
  'Chest Trauma': 'chestTrauma',
  'Abdominal Trauma': 'abdominalTrauma',
  'Spinal Injury': 'spinal',
  'Amputation': 'amputation',
  'Smoke Inhalation': 'smokeInhalation',
  'Chemical Exposure': 'chemicalExposure',
  'Internal Bleeding': 'internalBleeding',
};

export default function MCIPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // `user` is no longer read here: the server attributes each record to
  // whoever authenticated the request, rather than to whatever `assessed_by`
  // the body claimed.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'triage' | 'summary' | 'resources'>('triage');

  // Incident Information
  const [incident, setIncident] = useState<IncidentInfo>({
    incidentName: '',
    incidentType: '',
    location: '',
    startTime: new Date().toISOString().slice(0, 16),
    commandPost: '',
    incidentCommander: '',
    contactNumber: '',
    estimatedCasualties: 0,
    resourcesRequested: []
  });

  // MCI Patients
  const [patients, setPatients] = useState<MCIPatient[]>([]);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [tagCounter, setTagCounter] = useState(1);
  // START's thresholds come from the API, not from this file.
  const { catalog } = useScoringCatalog();

  // New Patient Form
  const [newPatient, setNewPatient] = useState<Partial<MCIPatient>>({
    category: 'immediate',
    age: '',
    gender: 'unknown',
    chiefComplaint: '',
    injuries: [],
    vitals: {
      ambulatory: false,
      respiratoryRate: 16,
      pulse: 80,
      capRefill: 2,
      mentalStatus: 'alert'
    },
    location: '',
    destination: '',
    notes: ''
  });

  /**
   * The five START triage categories.
   *
   * The hues are conventional and cannot change — a triage officer reads the
   * colour before the word. The *shades* can, and had to: white on the previous
   * `bg-green-500` measured 2.28:1 and white on the yellow measures 1.67:1, on a
   * board whose entire purpose is to be counted at a glance across a room.
   *
   * `summaryFg` exists because a single foreground cannot serve all five. Yellow
   * takes dark text — which is what a physical yellow triage tag uses — and the
   * rest take white. Rendering `text-white` uniformly is what made the DELAYED
   * count unreadable.
   *
   * The yellow is a fixed `bg-amber-500` rather than the `bg-caution` token on
   * purpose. That token flips with the theme — amber-700 on light, amber-400 on
   * dark — so no single foreground could pass in both, and more importantly a
   * triage colour code must not change because the operator prefers dark mode.
   * The five colours here mean the same thing on every screen in the building.
   *
   * And `text-black`, not `text-gray-900`: `src/index.css` used to carry
   * `.dark .text-gray-900 { @apply text-white }`, a compatibility override at
   * specificity (0,2,0) that beat the utility. On this card — whose background
   * does *not* flip — that turned the dark text white and put it back at 2.15:1.
   * The same layer repainted a green alert's text grey on the critical-value
   * screen (WF-018). It was removed on 2026-09-23; `text-black` stays because it
   * says what this card needs regardless.
   */
  const triageCategories: {
    value: TriageCategory;
    label: string;
    color: string;
    bgColor: string;
    summaryFg: string;
    description: string;
  }[] = [
    { value: 'immediate', label: t('docMCI.category_immediate_label'), color: 'text-critical-subtle-fg', bgColor: 'bg-red-600', summaryFg: 'text-white', description: t('docMCI.category_immediate_desc') },
    { value: 'delayed', label: t('docMCI.category_delayed_label'), color: 'text-caution-subtle-fg', bgColor: 'bg-amber-500', summaryFg: 'text-black', description: t('docMCI.category_delayed_desc') },
    { value: 'minor', label: t('docMCI.category_minor_label'), color: 'text-ok-subtle-fg', bgColor: 'bg-green-700', summaryFg: 'text-white', description: t('docMCI.category_minor_desc') },
    { value: 'expectant', label: t('docMCI.category_expectant_label'), color: 'text-content-secondary', bgColor: 'bg-gray-600', summaryFg: 'text-white', description: t('docMCI.category_expectant_desc') },
    { value: 'deceased', label: t('docMCI.category_deceased_label'), color: 'text-black', bgColor: 'bg-black', summaryFg: 'text-white', description: t('docMCI.category_deceased_desc') }
  ];

  const incidentTypes = [
    'Motor Vehicle Accident', 'Mass Shooting', 'Explosion', 'Building Collapse',
    'Chemical Spill', 'Fire', 'Natural Disaster', 'Train Derailment',
    'Plane Crash', 'Terrorist Attack', 'Crowd Crush', 'Other'
  ];

  const resourceOptions = [
    'Additional Ambulances', 'Fire Department', 'Hazmat Team', 'Search & Rescue',
    'Helicopter/Air Ambulance', 'Law Enforcement', 'Red Cross', 'Medical Examiner',
    'Crisis Counseling Team', 'Blood Bank', 'Additional Medical Staff'
  ];

  const commonInjuries = [
    'Laceration', 'Fracture', 'Burn', 'Crush Injury', 'Head Injury',
    'Chest Trauma', 'Abdominal Trauma', 'Spinal Injury', 'Amputation',
    'Smoke Inhalation', 'Chemical Exposure', 'Internal Bleeding'
  ];

  /**
   * START triage preview for the tag the responder is filling in.
   *
   * The stored category is the server's — `createMci` returns one per casualty
   * and this page adopts them on save. This exists only so the tag colour
   * appears as the observations are entered, and it uses the thresholds from
   * `GET /api/clinical/scoring/catalog` rather than its own literals.
   *
   * What it replaces got START's shape wrong in two ways. It never asked
   * whether the casualty could walk, which is the algorithm's first and most
   * decisive question, and it treated a pulse over 120 as Immediate, which is
   * not a START criterion at all — the perfusion check is capillary refill over
   * two seconds *or* an absent radial pulse.
   */
  const previewSTARTCategory = (vitals: MCIPatient['vitals']): TriageCategory | null => {
    const start = catalog?.start_triage;
    if (!start) return null;
    const { respiratory_rate_immediate_above, capillary_refill_immediate_above_secs } = start;

    if (vitals.ambulatory) return 'minor';
    if (vitals.respiratoryRate === 0) return 'deceased';
    if (vitals.respiratoryRate > respiratory_rate_immediate_above) return 'immediate';
    if (vitals.capRefill > capillary_refill_immediate_above_secs) return 'immediate';
    if (vitals.pulse === 0) return 'immediate';
    if (vitals.mentalStatus !== 'alert') return 'immediate';
    return 'delayed';
  };

  const addPatient = () => {
    const tagNum = `MCI-${tagCounter.toString().padStart(4, '0')}`;
    // The board shows this until the incident is filed; the server's category
    // replaces it on save. `immediate` is the fallback when the catalog has not
    // loaded, because over-triage costs a transport slot and under-triage costs
    // the casualty.
    const category = previewSTARTCategory(newPatient.vitals!) ?? 'immediate';
    
    const patient: MCIPatient = {
      id: `P-${Date.now()}`,
      tagNumber: tagNum,
      category,
      age: newPatient.age || 'Unknown',
      gender: newPatient.gender || 'unknown',
      chiefComplaint: newPatient.chiefComplaint || '',
      injuries: newPatient.injuries || [],
      vitals: newPatient.vitals!,
      location: newPatient.location || '',
      destination: newPatient.destination || '',
      triageTime: new Date().toISOString(),
      notes: newPatient.notes || ''
    };

    setPatients(prev => [...prev, patient]);
    setTagCounter(prev => prev + 1);
    setShowAddPatient(false);
    setNewPatient({
      category: 'immediate',
      age: '',
      gender: 'unknown',
      chiefComplaint: '',
      injuries: [],
      vitals: { ambulatory: false, respiratoryRate: 16, pulse: 80, capRefill: 2, mentalStatus: 'alert' },
      location: '',
      destination: '',
      notes: ''
    });
  };

  const updatePatientCategory = (patientId: string, category: TriageCategory) => {
    setPatients(prev => prev.map(p => 
      p.id === patientId ? { ...p, category } : p
    ));
  };

  const markTransported = (patientId: string, destination: string) => {
    setPatients(prev => prev.map(p => 
      p.id === patientId ? { ...p, destination, transportTime: new Date().toISOString() } : p
    ));
  };

  const removePatient = (patientId: string) => {
    setPatients(prev => prev.filter(p => p.id !== patientId));
  };

  const getCategoryCounts = () => {
    return triageCategories.reduce((acc, cat) => {
      acc[cat.value] = patients.filter(p => p.category === cat.value).length;
      return acc;
    }, {} as Record<TriageCategory, number>);
  };

  const counts = getCategoryCounts();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incident.incidentName) {
      setError(t('docMCI.errorIncidentName'));
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // The incident and its casualty board, as the API reads them. The old
      // payload wrapped everything in `mci_id` / `documented_by` / a
      // `category_counts` the server recomputes, and the handler — which read
      // flat top-level keys — matched none of it. What got written was one row
      // for a nameless incident of type `natural_disaster` with a single `red`
      // casualty who did not exist, and the whole board was dropped.
      //
      // `category` is still sent per casualty, but as an *override*: the server
      // scores START itself and stores both, so the record shows the decision
      // that was made and the algorithm it departed from.
      const mciData = {
        incident,
        patients: patients.map((p) => ({
          tagNumber: p.tagNumber,
          age: p.age,
          gender: p.gender,
          chiefComplaint: p.chiefComplaint,
          injuries: p.injuries,
          vitals: p.vitals,
          location: p.location,
          destination: p.destination,
          triageTime: p.triageTime,
          notes: p.notes,
          category: p.category,
        })),
      };

      const saved = await createMci(mciData);
      // Adopt the server's triage. If it disagrees with the board, the record
      // is the one that matters and the responder should see it before the
      // patients move.
      setPatients((prev) =>
        prev.map((patient) => {
          const scored = saved.triage.find((row) => row.tag_number === patient.tagNumber);
          return scored
            ? { ...patient, category: scored.triage_category as TriageCategory }
            : patient;
        }),
      );
      setSuccess(true);
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError(t('docMCI.errorSave'));
      console.error('Failed to save MCI data', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header - Alert Banner */}
        <div className="bg-gradient-to-r from-red-700 to-orange-800 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-surface/20 rounded-full animate-pulse">
                <AlertTriangle className="h-10 w-10 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">{t('docMCI.title')}</h1>
                <p className="text-white">{t('docMCI.subtitle')}</p>
              </div>
            </div>
            <div className="text-right text-white">
              <p className="text-sm">{t('docMCI.totalPatients')}</p>
              <p className="text-4xl font-bold">{patients.length}</p>
            </div>
          </div>
        </div>

        {/* Category Summary Bar */}
        <div className="grid grid-cols-5 gap-2 mb-6">
          {triageCategories.map(cat => (
            <div key={cat.value} className={`${cat.bgColor} rounded-lg p-4 text-center`}>
              <p className={`${cat.summaryFg} text-4xl font-bold`}>{counts[cat.value] || 0}</p>
              <p className={`${cat.summaryFg} text-sm font-medium`}>{cat.label}</p>
            </div>
          ))}
        </div>

        {success && (
          <div className="mb-6 bg-ok-subtle border border-ok text-ok-subtle-fg p-4 rounded-lg flex items-center">
            <Activity className="h-5 w-5 mr-2" />
            {t('docMCI.savedSuccess')}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-critical-subtle border border-critical text-critical-subtle-fg p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="bg-gray-800 rounded-t-lg">
          <div className="flex space-x-1 p-1">
            {[
              { id: 'triage', label: t('docMCI.tabTriage'), icon: Users },
              { id: 'summary', label: t('docMCI.tabSummary'), icon: FileText },
              { id: 'resources', label: t('docMCI.tabResources'), icon: Truck }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex-1 flex items-center justify-center space-x-2 py-3 px-4 rounded-lg font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-surface text-content'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <tab.icon className="h-5 w-5" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="bg-surface rounded-b-lg shadow-lg">
            {/* Triage Tab */}
            {activeTab === 'triage' && (
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-content">{t('docMCI.patientTriageListHeading')}</h2>
                  <button
                    type="button"
                    onClick={() => setShowAddPatient(true)}
                    className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                  >
                    <UserPlus className="h-5 w-5" />
                    <span>{t('docMCI.addPatientButton')}</span>
                  </button>
                </div>

                {/* Add Patient Form */}
                {showAddPatient && (
                  <div className="mb-6 p-6 bg-surface-sunken rounded-lg border-2 border-notice">
                    <h3 className="text-lg font-bold mb-4 flex items-center">
                      <Tag className="h-5 w-5 mr-2 text-notice-subtle-fg" />
                      {t('docMCI.newPatientTagHeading', { num: tagCounter.toString().padStart(4, '0') })}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Quick Vitals for START */}
                      <div className="md:col-span-3 bg-caution-subtle p-4 rounded-lg">
                        <p className="font-medium text-caution-subtle-fg mb-3">{t('docMCI.startTriageVitalsLabel')}</p>
                        {/* START asks this first, and the answer ends the
                            algorithm: anyone who can walk is Minor, whatever
                            their vitals say. The page used to skip the question
                            entirely — a comment in the old in-browser START
                            implementation read "we assume non-ambulatory if
                            triaging" — so every walking-wounded casualty was
                            triaged as if they could not walk, which in a real
                            incident spends a transport slot on someone who does
                            not need one. */}
                        <label className="flex items-center gap-2 mb-3 text-sm font-medium text-caution-subtle-fg cursor-pointer">
                          <input
                            id="mci-ambulatory"
                            type="checkbox"
                            checked={newPatient.vitals?.ambulatory ?? false}
                            onChange={(e) => setNewPatient({
                              ...newPatient,
                              vitals: { ...newPatient.vitals!, ambulatory: e.target.checked }
                            })}
                            className="h-4 w-4 rounded border-border-interactive"
                          />
                          {t('docMCI.ambulatoryLabel')}
                        </label>
                        <div className="grid grid-cols-4 gap-4">
                          <div>
                            <label htmlFor="mci-respiratory-rate" className="block text-sm font-medium text-content-secondary mb-1">{t('docMCI.respiratoryRateLabel')}</label>
                            <input
                              id="mci-respiratory-rate"
                              type="number"
                              value={newPatient.vitals?.respiratoryRate}
                              onChange={(e) => setNewPatient({
                                ...newPatient,
                                vitals: { ...newPatient.vitals!, respiratoryRate: parseInt(e.target.value) }
                              })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div>
                            <label htmlFor="mci-radial-pulse" className="block text-sm font-medium text-content-secondary mb-1">{t('docMCI.radialPulseLabel')}</label>
                            <input
                              id="mci-radial-pulse"
                              type="number"
                              value={newPatient.vitals?.pulse}
                              onChange={(e) => setNewPatient({
                                ...newPatient,
                                vitals: { ...newPatient.vitals!, pulse: parseInt(e.target.value) }
                              })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div>
                            <label htmlFor="mci-cap-refill" className="block text-sm font-medium text-content-secondary mb-1">{t('docMCI.capRefillLabel')}</label>
                            <input
                              id="mci-cap-refill"
                              type="number"
                              value={newPatient.vitals?.capRefill}
                              onChange={(e) => setNewPatient({
                                ...newPatient,
                                vitals: { ...newPatient.vitals!, capRefill: parseInt(e.target.value) }
                              })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div>
                            <label htmlFor="mci-mental-status" className="block text-sm font-medium text-content-secondary mb-1">{t('docMCI.mentalStatusLabel')}</label>
                            <select
                              id="mci-mental-status"
                              value={newPatient.vitals?.mentalStatus}
                              onChange={(e) => setNewPatient({
                                ...newPatient,
                                vitals: { ...newPatient.vitals!, mentalStatus: e.target.value }
                              })}
                              className="w-full p-2 border rounded"
                            >
                              <option value="alert">{t('docMCI.mentalStatus_alert')}</option>
                              <option value="confused">{t('docMCI.mentalStatus_confused')}</option>
                              <option value="unresponsive">{t('docMCI.mentalStatus_unresponsive')}</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="mci-age" className="block text-sm font-medium text-content-secondary mb-1">{t('docMCI.ageLabel')}</label>
                        <input
                          id="mci-age"
                          type="text"
                          value={newPatient.age}
                          onChange={(e) => setNewPatient({ ...newPatient, age: e.target.value })}
                          placeholder={t('docMCI.agePh')}
                          className="w-full p-2 border rounded"
                        />
                      </div>
                      <div>
                        <label htmlFor="mci-gender" className="block text-sm font-medium text-content-secondary mb-1">{t('docMCI.genderLabel')}</label>
                        <select
                          id="mci-gender"
                          value={newPatient.gender}
                          onChange={(e) => setNewPatient({ ...newPatient, gender: e.target.value })}
                          className="w-full p-2 border rounded"
                        >
                          <option value="unknown">{t('docMCI.gender_unknown')}</option>
                          <option value="male">{t('docMCI.gender_male')}</option>
                          <option value="female">{t('docMCI.gender_female')}</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="mci-location-found" className="block text-sm font-medium text-content-secondary mb-1">{t('docMCI.locationFoundLabel')}</label>
                        <input
                          id="mci-location-found"
                          type="text"
                          value={newPatient.location}
                          onChange={(e) => setNewPatient({ ...newPatient, location: e.target.value })}
                          placeholder={t('docMCI.locationFoundPh')}
                          className="w-full p-2 border rounded"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label htmlFor="mci-chief-complaint" className="block text-sm font-medium text-content-secondary mb-1">{t('docMCI.chiefComplaintLabel')}</label>
                        <input
                          id="mci-chief-complaint"
                          type="text"
                          value={newPatient.chiefComplaint}
                          onChange={(e) => setNewPatient({ ...newPatient, chiefComplaint: e.target.value })}
                          placeholder={t('docMCI.chiefComplaintPh')}
                          className="w-full p-2 border rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-content-secondary mb-1">{t('docMCI.injuriesLabel')}</label>
                        <div className="flex flex-wrap gap-1">
                          {commonInjuries.slice(0, 6).map(injury => (
                            <button
                              key={injury}
                              type="button"
                              onClick={() => {
                                const injuries = newPatient.injuries || [];
                                if (injuries.includes(injury)) {
                                  setNewPatient({ ...newPatient, injuries: injuries.filter(i => i !== injury) });
                                } else {
                                  setNewPatient({ ...newPatient, injuries: [...injuries, injury] });
                                }
                              }}
                              className={`text-xs px-2 py-1 rounded ${
                                newPatient.injuries?.includes(injury)
                                  ? 'bg-red-700 text-white'
                                  : 'bg-surface-sunken text-content-secondary'
                              }`}
                            >
                              {t(`docMCI.injury_${INJURY_KEYS[injury]}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end space-x-3 mt-4">
                      <button
                        type="button"
                        onClick={() => setShowAddPatient(false)}
                        className="px-4 py-2 bg-surface-sunken text-content-secondary rounded-lg hover:bg-gray-300"
                      >
                        {t('docMCI.cancelButton')}
                      </button>
                      <button
                        type="button"
                        onClick={addPatient}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        {t('docMCI.addAndTagPatientButton')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Patient List by Category */}
                {triageCategories.map(cat => {
                  const categoryPatients = patients.filter(p => p.category === cat.value);
                  if (categoryPatients.length === 0) return null;
                  
                  return (
                    <div key={cat.value} className="mb-6">
                      <div className={`${cat.bgColor} text-white px-4 py-2 rounded-t-lg flex items-center justify-between`}>
                        <span className="font-bold">{cat.label} ({categoryPatients.length})</span>
                        <span className="text-sm">{cat.description}</span>
                      </div>
                      <div className="bg-surface-sunken rounded-b-lg border border-t-0">
                        {categoryPatients.map(patient => (
                          <div key={patient.id} className="p-4 border-b last:border-b-0 flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                              <div className={`${cat.bgColor} text-white px-3 py-1 rounded font-mono font-bold`}>
                                {patient.tagNumber}
                              </div>
                              <div>
                                <p className="font-medium">
                                  {patient.age} {patient.gender} - {patient.chiefComplaint || t('docMCI.unknownComplaint')}
                                </p>
                                <p className="text-sm text-content-muted">
                                  {t('docMCI.vitalsLine', { rr: patient.vitals.respiratoryRate, pulse: patient.vitals.pulse, cap: patient.vitals.capRefill, mentalStatus: t(`docMCI.mentalStatus_${patient.vitals.mentalStatus}`) })}
                                </p>
                                {patient.location && (
                                  <p className="text-xs text-content-muted flex items-center mt-1">
                                    <MapPin className="h-3 w-3 mr-1" /> {patient.location}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              {/* Re-triage buttons */}
                              <div className="flex space-x-1">
                                {triageCategories.filter(c => c.value !== patient.category).map(c => (
                                  <button
                                    key={c.value}
                                    type="button"
                                    onClick={() => updatePatientCategory(patient.id, c.value)}
                                    className={`w-6 h-6 rounded ${c.bgColor} hover:opacity-80`}
                                    title={t('docMCI.changeToTitle', { label: c.label })}
                                  />
                                ))}
                              </div>
                              {!patient.transportTime ? (
                                <button
                                  type="button"
                                  onClick={() => markTransported(patient.id, 'Hospital')}
                                  className="text-notice-subtle-fg hover:text-notice-subtle-fg p-2"
                                  title={t('docMCI.markTransportedTitle')}
                                >
                                  <Truck className="h-5 w-5" />
                                </button>
                              ) : (
                                <span className="text-xs text-ok-subtle-fg flex items-center">
                                  <Truck className="h-4 w-4 mr-1" /> {t('docMCI.transportedLabel')}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => removePatient(patient.id)}
                                className="text-critical-subtle-fg hover:text-critical-subtle-fg p-2"
                              >
                                <Trash2 className="h-5 w-5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {patients.length === 0 && (
                  <div className="text-center py-12 text-content-muted">
                    <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{t('docMCI.noPatientsTriaged', { button: t('docMCI.addPatientButton') })}</p>
                  </div>
                )}
              </div>
            )}

            {/* Incident Info Tab */}
            {activeTab === 'summary' && (
              <div className="p-6">
                <h2 className="text-xl font-bold text-content mb-6">{t('docMCI.incidentInformationHeading')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="mci-incident-name" className="block text-sm font-medium text-content-secondary mb-1">{t('docMCI.incidentNameLabel')}</label>
                    <input
                      id="mci-incident-name"
                      type="text"
                      value={incident.incidentName}
                      onChange={(e) => setIncident({ ...incident, incidentName: e.target.value })}
                      placeholder={t('docMCI.incidentNamePh')}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="mci-incident-type" className="block text-sm font-medium text-content-secondary mb-1">{t('docMCI.incidentTypeLabel')}</label>
                    <select
                      id="mci-incident-type"
                      value={incident.incidentType}
                      onChange={(e) => setIncident({ ...incident, incidentType: e.target.value })}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="">{t('docMCI.selectTypePh')}</option>
                      {incidentTypes.map(type => (
                        <option key={type} value={type}>{t(`docMCI.incidentType_${INCIDENT_TYPE_KEYS[type]}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label htmlFor="mci-location" className="flex items-center text-sm font-medium text-content-secondary mb-1 min-h-[24px] py-1">
                      <MapPin className="h-4 w-4 mr-1" /> {t('docMCI.locationLabel')}
                    </label>
                    <input
                      id="mci-location"
                      type="text"
                      value={incident.location}
                      onChange={(e) => setIncident({ ...incident, location: e.target.value })}
                      placeholder={t('docMCI.locationPh')}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="mci-start-time" className="block text-sm font-medium text-content-secondary mb-1">
                      <Clock className="h-4 w-4 inline mr-1" /> {t('docMCI.incidentStartTimeLabel')}
                    </label>
                    <input
                      id="mci-start-time"
                      type="datetime-local"
                      value={incident.startTime}
                      onChange={(e) => setIncident({ ...incident, startTime: e.target.value })}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="mci-estimated-casualties" className="block text-sm font-medium text-content-secondary mb-1">
                      {t('docMCI.estimatedCasualtiesLabel')}
                    </label>
                    <input
                      id="mci-estimated-casualties"
                      type="number"
                      value={incident.estimatedCasualties}
                      onChange={(e) => setIncident({ ...incident, estimatedCasualties: parseInt(e.target.value) })}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="mci-command-post" className="block text-sm font-medium text-content-secondary mb-1">
                      <Building2 className="h-4 w-4 inline mr-1" /> {t('docMCI.commandPostLocationLabel')}
                    </label>
                    <input
                      id="mci-command-post"
                      type="text"
                      value={incident.commandPost}
                      onChange={(e) => setIncident({ ...incident, commandPost: e.target.value })}
                      placeholder={t('docMCI.commandPostLocationPh')}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="mci-incident-commander" className="block text-sm font-medium text-content-secondary mb-1">
                      <Radio className="h-4 w-4 inline mr-1" /> {t('docMCI.incidentCommanderLabel')}
                    </label>
                    <input
                      id="mci-incident-commander"
                      type="text"
                      value={incident.incidentCommander}
                      onChange={(e) => setIncident({ ...incident, incidentCommander: e.target.value })}
                      placeholder={t('docMCI.incidentCommanderPh')}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="mci-contact-number" className="block text-sm font-medium text-content-secondary mb-1">
                      <Phone className="h-4 w-4 inline mr-1" /> {t('docMCI.contactNumberLabel')}
                    </label>
                    <input
                      id="mci-contact-number"
                      type="tel"
                      value={incident.contactNumber}
                      onChange={(e) => setIncident({ ...incident, contactNumber: e.target.value })}
                      placeholder={t('docMCI.contactNumberPh')}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Resources Tab */}
            {activeTab === 'resources' && (
              <div className="p-6">
                <h2 className="text-xl font-bold text-content mb-6">{t('docMCI.resourcesRequestedHeading')}</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {resourceOptions.map(resource => (
                    <label key={resource} className="flex items-center space-x-3 p-4 bg-surface-sunken rounded-lg cursor-pointer hover:bg-surface-sunken">
                      <input
                        type="checkbox"
                        checked={incident.resourcesRequested.includes(resource)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setIncident({ ...incident, resourcesRequested: [...incident.resourcesRequested, resource] });
                          } else {
                            setIncident({ ...incident, resourcesRequested: incident.resourcesRequested.filter(r => r !== resource) });
                          }
                        }}
                        className="rounded border-border-interactive text-content-secondary focus:ring-orange-500 h-5 w-5"
                      />
                      <span className="font-medium text-content-secondary">{t(`docMCI.resource_${RESOURCE_KEYS[resource]}`)}</span>
                    </label>
                  ))}
                </div>

                {incident.resourcesRequested.length > 0 && (
                  <div className="mt-6 p-4 bg-surface-sunken rounded-lg">
                    <h3 className="font-medium text-content-secondary mb-2">{t('docMCI.resourcesRequestedLabel')}</h3>
                    <div className="flex flex-wrap gap-2">
                      {incident.resourcesRequested.map(resource => (
                        <span key={resource} className="bg-orange-200 text-content-secondary px-3 py-1 rounded-full text-sm">
                          {t(`docMCI.resource_${RESOURCE_KEYS[resource]}`)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Submit Button */}
          <div className="mt-6 flex justify-end space-x-4">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
            >
              {t('docMCI.cancelButton')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || patients.length === 0}
              className="px-6 py-3 bg-critical text-critical-fg rounded-lg hover:bg-critical disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed flex items-center"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="animate-spin h-4 w-4 mr-2" />
                  {t('docMCI.saving')}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t('docMCI.saveMciRecordButton')}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
