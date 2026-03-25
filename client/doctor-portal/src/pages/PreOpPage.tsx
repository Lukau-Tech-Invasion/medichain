import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createPreOp, getPatients, apiUrl } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import {
  Stethoscope,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Save,
  Search,
  User,
  RefreshCw,
  FileText,
  Scissors,
  Shield,
  Heart,
  Activity,
  Wind,
  Pill,
  History,
  Check,
  X,
  AlertCircle,
  Info
} from 'lucide-react';

type ASAClass = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI';
type MallampatiClass = 'I' | 'II' | 'III' | 'IV';
type AnesthesiaType = 'general' | 'regional' | 'local' | 'mac' | 'spinal' | 'epidural' | 'combined';

interface _PreOpAssessment {
  id: string;
  patientId: string;
  assessmentDate: string;
  assessmentTime: string;
  assessedBy: string;
  scheduledSurgery: string;
  surgeon: string;
  scheduledDate: string;
  scheduledTime: string;
  asaClass: ASAClass;
  asaEmergency: boolean;
  anesthesiaType: AnesthesiaType;
  airwayAssessment: {
    mallampati: MallampatiClass;
    mouthOpening: string;
    thyromental: string;
    neckMobility: string;
    dentition: string;
    beardPresent: boolean;
    obeseNeck: boolean;
    difficultyPredicted: boolean;
  };
  npoStatus: {
    lastSolid: string;
    lastClear: string;
    compliant: boolean;
  };
  consents: {
    surgicalConsent: boolean;
    anesthesiaConsent: boolean;
    bloodConsent: boolean;
  };
  labsReviewed: string[];
  allergies: string[];
  currentMedications: string[];
  holdMedications: string[];
  medicalHistory: string[];
  preOpChecklist: Record<string, boolean>;
  notes: string;
}

const asaClassifications: { value: ASAClass; label: string; description: string }[] = [
  { value: 'I', label: 'ASA I', description: 'Healthy patient - No organic, physiologic, or psychiatric disturbance' },
  { value: 'II', label: 'ASA II', description: 'Mild systemic disease - Well-controlled HTN, DM, obesity, pregnancy' },
  { value: 'III', label: 'ASA III', description: 'Severe systemic disease - Poorly controlled DM, ESRD on dialysis, CHF, stable angina' },
  { value: 'IV', label: 'ASA IV', description: 'Severe life-threatening disease - Recent MI, CVA, TIA, ongoing cardiac ischemia' },
  { value: 'V', label: 'ASA V', description: 'Moribund patient - Not expected to survive without surgery' },
  { value: 'VI', label: 'ASA VI', description: 'Brain-dead patient - Organ donor' }
];

const mallampatiClasses: { value: MallampatiClass; label: string; description: string }[] = [
  { value: 'I', label: 'Class I', description: 'Soft palate, uvula, fauces, pillars visible' },
  { value: 'II', label: 'Class II', description: 'Soft palate, uvula, fauces visible' },
  { value: 'III', label: 'Class III', description: 'Soft palate, base of uvula visible' },
  { value: 'IV', label: 'Class IV', description: 'Only hard palate visible (difficult intubation)' }
];

const anesthesiaTypes: { value: AnesthesiaType; label: string }[] = [
  { value: 'general', label: 'General Anesthesia' },
  { value: 'regional', label: 'Regional Block' },
  { value: 'local', label: 'Local Anesthesia' },
  { value: 'mac', label: 'MAC (Monitored Anesthesia Care)' },
  { value: 'spinal', label: 'Spinal Anesthesia' },
  { value: 'epidural', label: 'Epidural' },
  { value: 'combined', label: 'Combined Spinal-Epidural' }
];

export default function PreOpPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientProfile | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'assessment' | 'checklist' | 'history'>('assessment');
  const [recentRecords, setRecentRecords] = useState<Array<{id: string; patient_id?: string; scheduled_surgery?: string; surgery?: string; asa_class?: string; assessment_date?: string; created_at?: number}>>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  // Form state
  const [scheduledSurgery, setScheduledSurgery] = useState('');
  const [surgeon, setSurgeon] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [asaClass, setAsaClass] = useState<ASAClass>('II');
  const [asaEmergency, setAsaEmergency] = useState(false);
  const [anesthesiaType, setAnesthesiaType] = useState<AnesthesiaType>('general');

  const [airwayAssessment, setAirwayAssessment] = useState({
    mallampati: 'II' as MallampatiClass,
    mouthOpening: '>3cm',
    thyromental: '>6cm',
    neckMobility: 'full',
    dentition: 'intact',
    beardPresent: false,
    obeseNeck: false,
    difficultyPredicted: false
  });

  const [npoStatus, setNpoStatus] = useState({
    lastSolid: '',
    lastClear: '',
    compliant: true
  });

  const [consents, setConsents] = useState({
    surgicalConsent: false,
    anesthesiaConsent: false,
    bloodConsent: false
  });

  const [labsReviewed, setLabsReviewed] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [newAllergy, setNewAllergy] = useState('');
  const [currentMedications, setCurrentMedications] = useState<string[]>([]);
  const [newMedication, setNewMedication] = useState('');
  const [holdMedications, setHoldMedications] = useState<string[]>([]);
  const [medicalHistory, setMedicalHistory] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const [preOpChecklist, setPreOpChecklist] = useState<Record<string, boolean>>({
    'identityVerified': false,
    'siteMarked': false,
    'consentsSigned': false,
    'allergiesBandOn': false,
    'npoVerified': false,
    'labsReviewed': false,
    'ivAccess': false,
    'preOpMedsGiven': false,
    'jewelryRemoved': false,
    'denturesRemoved': false,
    'contactsRemoved': false,
    'prosthesesRemoved': false,
    'hbVerified': false,
    'bloodAvailable': false,
    'imagingReviewed': false,
    'anticoagHeld': false,
    'antibioticOrdered': false,
    'vteProphy': false,
    'familyNotified': false,
    'anesthesiaSeen': false
  });

  const checklistLabels: Record<string, string> = {
    'identityVerified': 'Patient identity verified (2 identifiers)',
    'siteMarked': 'Surgical site marked by surgeon',
    'consentsSigned': 'All consents signed and witnessed',
    'allergiesBandOn': 'Allergy band on patient',
    'npoVerified': 'NPO status verified',
    'labsReviewed': 'Labs reviewed and acceptable',
    'ivAccess': 'IV access established',
    'preOpMedsGiven': 'Pre-operative medications given',
    'jewelryRemoved': 'Jewelry/piercings removed',
    'denturesRemoved': 'Dentures/partials removed',
    'contactsRemoved': 'Contact lenses/glasses removed',
    'prosthesesRemoved': 'Hearing aids/prostheses removed',
    'hbVerified': 'H&H verified if applicable',
    'bloodAvailable': 'Blood products available if needed',
    'imagingReviewed': 'Imaging/studies reviewed',
    'anticoagHeld': 'Anticoagulants held appropriately',
    'antibioticOrdered': 'Prophylactic antibiotic ordered',
    'vteProphy': 'VTE prophylaxis ordered',
    'familyNotified': 'Family/support person notified',
    'anesthesiaSeen': 'Anesthesia evaluation complete'
  };

  const labOptions = [
    'CBC', 'BMP', 'CMP', 'Coags (PT/INR/PTT)', 'Type & Screen', 'Type & Cross',
    'Urinalysis', 'Pregnancy Test', 'ECG', 'Chest X-ray', 'Echo', 'Stress Test'
  ];

  const medicalHistoryOptions = [
    'Hypertension', 'Diabetes Mellitus', 'Coronary Artery Disease', 'CHF',
    'COPD', 'Asthma', 'Obstructive Sleep Apnea', 'Obesity', 'Renal Disease',
    'Liver Disease', 'Stroke/TIA', 'Seizures', 'GERD', 'DVT/PE',
    'Previous Anesthesia Complications', 'Malignant Hyperthermia Family Hx',
    'Difficult Airway History', 'Substance Use History'
  ];

  const holdMedicationOptions = [
    'Aspirin', 'Plavix (Clopidogrel)', 'Warfarin', 'Eliquis (Apixaban)',
    'Xarelto (Rivaroxaban)', 'Metformin', 'SGLT2 Inhibitors', 'ACE Inhibitors',
    'ARBs', 'Diuretics', 'NSAIDs', 'Herbal Supplements'
  ];

  useEffect(() => {
    if (activeTab === 'history' && selectedPatient && user) {
      const fetchRecentRecords = async () => {
        setRecordsLoading(true);
        try {
          const res = await fetch(apiUrl(`/api/clinical/pre-op/${selectedPatient.patient_id}`), {
            headers: { 'X-User-Id': user.walletAddress, 'X-Provider-Role': user.role },
          });
          if (res.ok) {
            const data = await res.json();
            setRecentRecords(Array.isArray(data) ? data : (data.records || data.assessments || []));
          }
        } catch (e) {
          console.error(e);
        } finally {
          setRecordsLoading(false);
        }
      };
      fetchRecentRecords();
    }
  }, [activeTab, selectedPatient, user]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const patientData = await getPatients();
        setPatients(patientData || []);

        const patientId = searchParams.get('patient');
        if (patientId && patientData) {
          const patient = patientData.find((p: PatientProfile) => p.patient_id === patientId);
          if (patient) setSelectedPatient(patient);
        }
      } catch (err) {
        console.error('Failed to fetch patients', err);
      }
    };
    fetchData();
  }, [searchParams]);

  const filteredPatients = patients.filter(p =>
    p.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.patient_id?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleLab = (lab: string) => {
    setLabsReviewed(prev =>
      prev.includes(lab) ? prev.filter(l => l !== lab) : [...prev, lab]
    );
  };

  const toggleMedicalHistory = (condition: string) => {
    setMedicalHistory(prev =>
      prev.includes(condition) ? prev.filter(c => c !== condition) : [...prev, condition]
    );
  };

  const toggleHoldMedication = (med: string) => {
    setHoldMedications(prev =>
      prev.includes(med) ? prev.filter(m => m !== med) : [...prev, med]
    );
  };

  const addAllergy = () => {
    if (newAllergy.trim() && !allergies.includes(newAllergy.trim())) {
      setAllergies(prev => [...prev, newAllergy.trim()]);
      setNewAllergy('');
    }
  };

  const addMedication = () => {
    if (newMedication.trim() && !currentMedications.includes(newMedication.trim())) {
      setCurrentMedications(prev => [...prev, newMedication.trim()]);
      setNewMedication('');
    }
  };

  const getAsaColor = (asa: ASAClass) => {
    switch (asa) {
      case 'I': return 'bg-green-100 text-green-800 border-green-500';
      case 'II': return 'bg-blue-100 text-blue-800 border-blue-500';
      case 'III': return 'bg-yellow-100 text-yellow-800 border-yellow-500';
      case 'IV': return 'bg-orange-100 text-orange-800 border-orange-500';
      case 'V': return 'bg-red-100 text-red-800 border-red-500';
      case 'VI': return 'bg-gray-100 text-gray-800 border-gray-500';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const checklistProgress = Object.values(preOpChecklist).filter(Boolean).length;
  const totalChecklistItems = Object.keys(preOpChecklist).length;

  const handleSave = async () => {
    if (!selectedPatient) {
      setError('Please select a patient');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const assessmentData = {
        assessment_id: `PREOP-${Date.now()}`,
        patient_id: selectedPatient.patient_id,
        assessment_date: new Date().toISOString().split('T')[0],
        assessment_time: new Date().toTimeString().slice(0, 5),
        assessed_by: user?.userId || 'unknown',
        scheduled_surgery: scheduledSurgery,
        surgeon,
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        asa_class: asaClass,
        asa_emergency: asaEmergency,
        anesthesia_type: anesthesiaType,
        airway_assessment: airwayAssessment,
        npo_status: npoStatus,
        consents,
        labs_reviewed: labsReviewed,
        allergies,
        current_medications: currentMedications,
        hold_medications: holdMedications,
        medical_history: medicalHistory,
        preop_checklist: preOpChecklist,
        notes,
        created_at: Math.floor(Date.now() / 1000)
      };

      await createPreOp(assessmentData);
      setSuccess('Pre-operative assessment saved successfully!');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError('Failed to save pre-operative assessment. Please try again.');
      console.error('Failed to save pre-op assessment', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-white/20 rounded-full">
                <Scissors className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Pre-Operative Assessment</h1>
                <p className="text-indigo-100">ASA Classification & Surgical Readiness</p>
              </div>
            </div>
            {selectedPatient && (
              <div className="text-right text-white">
                <p className="font-medium">{selectedPatient.full_name}</p>
                <p className="text-sm opacity-75">{selectedPatient.patient_id}</p>
                {asaClass && (
                  <span className={`inline-block mt-1 px-3 py-1 rounded-full text-sm font-bold ${getAsaColor(asaClass)}`}>
                    ASA {asaClass}{asaEmergency ? 'E' : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center">
            <CheckCircle2 className="h-5 w-5 mr-2" />
            {success}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        {/* Progress Bar */}
        <div className="bg-white rounded-lg shadow mb-6 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-gray-700">Checklist Progress</h3>
            <span className="text-sm text-gray-500">{checklistProgress}/{totalChecklistItems} items complete</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${
                checklistProgress === totalChecklistItems ? 'bg-green-500' :
                checklistProgress > totalChecklistItems / 2 ? 'bg-blue-500' : 'bg-yellow-500'
              }`}
              style={{ width: `${(checklistProgress / totalChecklistItems) * 100}%` }}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b flex">
            <button
              onClick={() => setActiveTab('assessment')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'assessment'
                  ? 'border-b-2 border-indigo-500 text-indigo-600'
                  : 'text-gray-500'
              }`}
            >
              <Stethoscope className="h-5 w-5" />
              <span>Assessment</span>
            </button>
            <button
              onClick={() => setActiveTab('checklist')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'checklist'
                  ? 'border-b-2 border-indigo-500 text-indigo-600'
                  : 'text-gray-500'
              }`}
            >
              <FileText className="h-5 w-5" />
              <span>Pre-Op Checklist</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'history'
                  ? 'border-b-2 border-indigo-500 text-indigo-600'
                  : 'text-gray-500'
              }`}
            >
              <History className="h-5 w-5" />
              <span>History</span>
            </button>
          </div>
        </div>

        {activeTab === 'assessment' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Patient & Surgery Info */}
            <div className="lg:col-span-1 space-y-4">
              {/* Patient Selection */}
              <div className="bg-white rounded-lg shadow p-4">
                <h2 className="font-bold text-gray-900 mb-4 flex items-center">
                  <User className="h-5 w-5 mr-2 text-indigo-500" />
                  Select Patient
                </h2>
                <div className="relative mb-4">
                  <label htmlFor="preop-search-patients" className="sr-only">Search patients</label>
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    id="preop-search-patients"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search patients..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {filteredPatients.map(patient => (
                    <button
                      key={patient.patient_id}
                      onClick={() => setSelectedPatient(patient)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        selectedPatient?.patient_id === patient.patient_id
                          ? 'bg-indigo-100 border-2 border-indigo-500'
                          : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                      }`}
                    >
                      <p className="font-medium text-gray-900">{patient.full_name}</p>
                      <p className="text-sm text-gray-500">{patient.patient_id}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Surgery Information */}
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                  <Scissors className="h-5 w-5 mr-2 text-indigo-500" />
                  Surgery Details
                </h3>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="preop-scheduled-procedure" className="block text-sm font-medium text-gray-700 mb-1">Scheduled Procedure</label>
                    <input
                      id="preop-scheduled-procedure"
                      type="text"
                      value={scheduledSurgery}
                      onChange={(e) => setScheduledSurgery(e.target.value)}
                      placeholder="e.g., Laparoscopic Cholecystectomy"
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="preop-surgeon" className="block text-sm font-medium text-gray-700 mb-1">Surgeon</label>
                    <input
                      id="preop-surgeon"
                      type="text"
                      value={surgeon}
                      onChange={(e) => setSurgeon(e.target.value)}
                      placeholder="Surgeon name"
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="preop-scheduled-date" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                      <input
                        id="preop-scheduled-date"
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded"
                      />
                    </div>
                    <div>
                      <label htmlFor="preop-scheduled-time" className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                      <input
                        id="preop-scheduled-time"
                        type="time"
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="preop-anesthesia-type" className="block text-sm font-medium text-gray-700 mb-1">Anesthesia Type</label>
                    <select
                      id="preop-anesthesia-type"
                      value={anesthesiaType}
                      onChange={(e) => setAnesthesiaType(e.target.value as AnesthesiaType)}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      {anesthesiaTypes.map(type => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* NPO Status */}
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                  <Clock className="h-5 w-5 mr-2 text-indigo-500" />
                  NPO Status
                </h3>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="preop-last-solid-food" className="block text-sm font-medium text-gray-700 mb-1">Last Solid Food</label>
                    <input
                      id="preop-last-solid-food"
                      type="datetime-local"
                      value={npoStatus.lastSolid}
                      onChange={(e) => setNpoStatus(prev => ({ ...prev, lastSolid: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="preop-last-clear-liquid" className="block text-sm font-medium text-gray-700 mb-1">Last Clear Liquid</label>
                    <input
                      id="preop-last-clear-liquid"
                      type="datetime-local"
                      value={npoStatus.lastClear}
                      onChange={(e) => setNpoStatus(prev => ({ ...prev, lastClear: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  <label htmlFor="preop-npo-compliant" className="flex items-center space-x-2 cursor-pointer">
                    <input
                      id="preop-npo-compliant"
                      type="checkbox"
                      checked={npoStatus.compliant}
                      onChange={() => setNpoStatus(prev => ({ ...prev, compliant: !prev.compliant }))}
                      className="rounded border-gray-300 text-green-600"
                    />
                    <span className={`font-medium ${npoStatus.compliant ? 'text-green-600' : 'text-red-600'}`}>
                      {npoStatus.compliant ? '✓ NPO Compliant' : '✗ NPO NOT Compliant'}
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Main Assessment Column */}
            <div className="lg:col-span-2 space-y-6">
              {/* ASA Classification */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                  <Shield className="h-6 w-6 mr-2 text-indigo-500" />
                  ASA Physical Status Classification
                </h2>
                <div className="space-y-3">
                  {asaClassifications.map(asa => (
                    <button
                      key={asa.value}
                      type="button"
                      onClick={() => setAsaClass(asa.value)}
                      className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                        asaClass === asa.value
                          ? getAsaColor(asa.value) + ' border-2'
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-lg">{asa.label}</span>
                        {asaClass === asa.value && <Check className="h-5 w-5" />}
                      </div>
                      <p className="text-sm mt-1 opacity-75">{asa.description}</p>
                    </button>
                  ))}
                </div>
                <label htmlFor="preop-asa-emergency" className="flex items-center space-x-2 mt-4 cursor-pointer">
                  <input
                    id="preop-asa-emergency"
                    type="checkbox"
                    checked={asaEmergency}
                    onChange={() => setAsaEmergency(!asaEmergency)}
                    className="rounded border-gray-300 text-red-600"
                  />
                  <span className="font-medium text-red-600">
                    Emergency Case (add "E" suffix)
                  </span>
                </label>
              </div>

              {/* Airway Assessment */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                  <Wind className="h-5 w-5 mr-2 text-indigo-500" />
                  Airway Assessment
                </h3>
                
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mallampati Classification</label>
                  <div className="grid grid-cols-4 gap-2">
                    {mallampatiClasses.map(mp => (
                      <button
                        key={mp.value}
                        type="button"
                        onClick={() => setAirwayAssessment(prev => ({ ...prev, mallampati: mp.value }))}
                        className={`p-3 rounded-lg border-2 text-center ${
                          airwayAssessment.mallampati === mp.value
                            ? 'bg-indigo-100 border-indigo-500 text-indigo-800'
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        <p className="font-bold">{mp.label}</p>
                        <p className="text-xs mt-1">{mp.description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="preop-mouth-opening" className="block text-sm font-medium text-gray-700 mb-1">Mouth Opening</label>
                    <select
                      id="preop-mouth-opening"
                      value={airwayAssessment.mouthOpening}
                      onChange={(e) => setAirwayAssessment(prev => ({ ...prev, mouthOpening: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      <option value=">3cm">&gt;3 cm (Normal)</option>
                      <option value="2-3cm">2-3 cm (Limited)</option>
                      <option value="<2cm">&lt;2 cm (Restricted)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="preop-thyromental-distance" className="block text-sm font-medium text-gray-700 mb-1">Thyromental Distance</label>
                    <select
                      id="preop-thyromental-distance"
                      value={airwayAssessment.thyromental}
                      onChange={(e) => setAirwayAssessment(prev => ({ ...prev, thyromental: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      <option value=">6cm">&gt;6 cm (Normal)</option>
                      <option value="6-6.5cm">6-6.5 cm (Borderline)</option>
                      <option value="<6cm">&lt;6 cm (Short)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="preop-neck-mobility" className="block text-sm font-medium text-gray-700 mb-1">Neck Mobility</label>
                    <select
                      id="preop-neck-mobility"
                      value={airwayAssessment.neckMobility}
                      onChange={(e) => setAirwayAssessment(prev => ({ ...prev, neckMobility: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      <option value="full">Full Range</option>
                      <option value="limited">Limited</option>
                      <option value="fixed">Fixed/Immobile</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="preop-dentition" className="block text-sm font-medium text-gray-700 mb-1">Dentition</label>
                    <select
                      id="preop-dentition"
                      value={airwayAssessment.dentition}
                      onChange={(e) => setAirwayAssessment(prev => ({ ...prev, dentition: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      <option value="intact">Intact</option>
                      <option value="loose">Loose/Damaged Teeth</option>
                      <option value="dentures">Dentures</option>
                      <option value="edentulous">Edentulous</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-4">
                  <label htmlFor="preop-beard-present" className="flex items-center space-x-2 cursor-pointer">
                    <input
                      id="preop-beard-present"
                      type="checkbox"
                      checked={airwayAssessment.beardPresent}
                      onChange={() => setAirwayAssessment(prev => ({ ...prev, beardPresent: !prev.beardPresent }))}
                      className="rounded border-gray-300 text-indigo-600"
                    />
                    <span className="text-sm">Beard Present</span>
                  </label>
                  <label htmlFor="preop-obese-neck" className="flex items-center space-x-2 cursor-pointer">
                    <input
                      id="preop-obese-neck"
                      type="checkbox"
                      checked={airwayAssessment.obeseNeck}
                      onChange={() => setAirwayAssessment(prev => ({ ...prev, obeseNeck: !prev.obeseNeck }))}
                      className="rounded border-gray-300 text-indigo-600"
                    />
                    <span className="text-sm">Obese Neck</span>
                  </label>
                  <label htmlFor="preop-difficult-airway" className="flex items-center space-x-2 cursor-pointer">
                    <input
                      id="preop-difficult-airway"
                      type="checkbox"
                      checked={airwayAssessment.difficultyPredicted}
                      onChange={() => setAirwayAssessment(prev => ({ ...prev, difficultyPredicted: !prev.difficultyPredicted }))}
                      className="rounded border-gray-300 text-red-600"
                    />
                    <span className="text-sm text-red-600 font-medium">Difficult Airway Predicted</span>
                  </label>
                </div>
              </div>

              {/* Medical History & Allergies */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                    <Heart className="h-5 w-5 mr-2 text-red-500" />
                    Medical History
                  </h3>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {medicalHistoryOptions.map(condition => (
                      <label key={condition} htmlFor={`preop-history-${condition.toLowerCase().replace(/[\s/]+/g, '-')}`} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          id={`preop-history-${condition.toLowerCase().replace(/[\s/]+/g, '-')}`}
                          type="checkbox"
                          checked={medicalHistory.includes(condition)}
                          onChange={() => toggleMedicalHistory(condition)}
                          className="rounded border-gray-300 text-indigo-600"
                        />
                        <span className="text-sm">{condition}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                    <AlertTriangle className="h-5 w-5 mr-2 text-yellow-500" />
                    Allergies
                  </h3>
                  <div className="flex space-x-2 mb-2">
                    <label htmlFor="preop-new-allergy" className="sr-only">Add allergy</label>
                    <input
                      id="preop-new-allergy"
                      type="text"
                      value={newAllergy}
                      onChange={(e) => setNewAllergy(e.target.value)}
                      placeholder="Add allergy..."
                      className="flex-1 p-2 border border-gray-300 rounded text-sm"
                      onKeyPress={(e) => e.key === 'Enter' && addAllergy()}
                    />
                    <button
                      type="button"
                      onClick={addAllergy}
                      className="px-3 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {allergies.map(allergy => (
                      <span
                        key={allergy}
                        className="inline-flex items-center px-2 py-1 bg-red-100 text-red-800 rounded-full text-sm"
                      >
                        {allergy}
                        <button
                          type="button"
                          onClick={() => setAllergies(prev => prev.filter(a => a !== allergy))}
                          className="ml-1 text-red-600 hover:text-red-800"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    {allergies.length === 0 && (
                      <span className="text-gray-400 text-sm">NKDA (No Known Drug Allergies)</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Medications */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                    <Pill className="h-5 w-5 mr-2 text-blue-500" />
                    Current Medications
                  </h3>
                  <div className="flex space-x-2 mb-2">
                    <label htmlFor="preop-new-medication" className="sr-only">Add medication</label>
                    <input
                      id="preop-new-medication"
                      type="text"
                      value={newMedication}
                      onChange={(e) => setNewMedication(e.target.value)}
                      placeholder="Add medication..."
                      className="flex-1 p-2 border border-gray-300 rounded text-sm"
                      onKeyPress={(e) => e.key === 'Enter' && addMedication()}
                    />
                    <button
                      type="button"
                      onClick={addMedication}
                      className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Add
                    </button>
                  </div>
                  <div className="max-h-24 overflow-y-auto flex flex-wrap gap-1">
                    {currentMedications.map(med => (
                      <span
                        key={med}
                        className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm"
                      >
                        {med}
                        <button
                          type="button"
                          onClick={() => setCurrentMedications(prev => prev.filter(m => m !== med))}
                          className="ml-1 text-blue-600 hover:text-blue-800"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                    <AlertCircle className="h-5 w-5 mr-2 text-orange-500" />
                    Medications to Hold
                  </h3>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {holdMedicationOptions.map(med => (
                      <label key={med} htmlFor={`preop-hold-${med.toLowerCase().replace(/[\s()]+/g, '-')}`} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          id={`preop-hold-${med.toLowerCase().replace(/[\s()]+/g, '-')}`}
                          type="checkbox"
                          checked={holdMedications.includes(med)}
                          onChange={() => toggleHoldMedication(med)}
                          className="rounded border-gray-300 text-orange-600"
                        />
                        <span className="text-sm">{med}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Labs & Consents */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                    <Activity className="h-5 w-5 mr-2 text-green-500" />
                    Labs Reviewed
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {labOptions.map(lab => (
                      <button
                        key={lab}
                        type="button"
                        onClick={() => toggleLab(lab)}
                        className={`px-3 py-1 rounded-full text-sm ${
                          labsReviewed.includes(lab)
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {lab}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                    <FileText className="h-5 w-5 mr-2 text-purple-500" />
                    Consents
                  </h3>
                  <div className="space-y-2">
                    {[
                      { key: 'surgicalConsent', label: 'Surgical Consent Signed' },
                      { key: 'anesthesiaConsent', label: 'Anesthesia Consent Signed' },
                      { key: 'bloodConsent', label: 'Blood Transfusion Consent' }
                    ].map(({ key, label }) => (
                      <label key={key} htmlFor={`preop-consent-${key}`} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          id={`preop-consent-${key}`}
                          type="checkbox"
                          checked={consents[key as keyof typeof consents]}
                          onChange={() => setConsents(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
                          className="rounded border-gray-300 text-purple-600"
                        />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="bg-white rounded-lg shadow p-6">
                <label htmlFor="preop-additional-notes" className="font-bold text-gray-900 mb-4 block">Additional Notes</label>
                <textarea
                  id="preop-additional-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Pre-operative concerns, special considerations, anesthesia plan notes..."
                  rows={4}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
              </div>

              {/* Submit Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={isSubmitting || !selectedPatient}
                  className="bg-indigo-600 text-white px-8 py-3 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="animate-spin h-5 w-5 mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-5 w-5 mr-2" />
                      Save Assessment
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'checklist' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
              <FileText className="h-6 w-6 mr-2 text-indigo-500" />
              Pre-Operative Checklist
            </h2>
            
            <div className="mb-4 p-3 bg-blue-50 rounded-lg flex items-start">
              <Info className="h-5 w-5 mr-2 text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-700">
                Complete all items before transferring patient to the operating room. Critical items are highlighted.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(checklistLabels).map(([key, label]) => {
                const isCritical = ['identityVerified', 'siteMarked', 'consentsSigned', 'npoVerified'].includes(key);
                
                return (
                  <label
                    key={key}
                    htmlFor={`preop-checklist-${key}`}
                    className={`flex items-center p-3 rounded-lg cursor-pointer border-2 transition-all ${
                      preOpChecklist[key]
                        ? 'bg-green-50 border-green-500'
                        : isCritical
                          ? 'bg-red-50 border-red-300'
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <input
                      id={`preop-checklist-${key}`}
                      type="checkbox"
                      checked={preOpChecklist[key]}
                      onChange={() => setPreOpChecklist(prev => ({ ...prev, [key]: !prev[key] }))}
                      className="rounded border-gray-300 text-green-600 mr-3"
                    />
                    <span className={`flex-1 ${preOpChecklist[key] ? 'line-through text-green-700' : ''}`}>
                      {label}
                    </span>
                    {isCritical && !preOpChecklist[key] && (
                      <span className="text-red-500 text-xs font-bold ml-2">CRITICAL</span>
                    )}
                    {preOpChecklist[key] && (
                      <Check className="h-5 w-5 text-green-500 ml-2" />
                    )}
                  </label>
                );
              })}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSave}
                disabled={isSubmitting || !selectedPatient}
                className="bg-indigo-600 text-white px-8 py-3 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="animate-spin h-5 w-5 mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-5 w-5 mr-2" />
                    Save Pre-Op Assessment
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
              <History className="h-6 w-6 mr-2 text-indigo-500" />
              Assessment History
            </h2>
            {!selectedPatient ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-sm">Select a patient to view their pre-op history.</p>
              </div>
            ) : recordsLoading ? (
              <div className="text-center py-8 text-gray-500">Loading records...</div>
            ) : recentRecords.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No assessment history available.</p>
                <p className="text-sm mt-1">Previous pre-operative assessments will appear here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">ID</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Surgery</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">ASA Class</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recentRecords.map((rec) => (
                      <tr key={rec.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs">{rec.id}</td>
                        <td className="px-4 py-2">{rec.scheduled_surgery || rec.surgery || 'N/A'}</td>
                        <td className="px-4 py-2">{rec.asa_class || 'N/A'}</td>
                        <td className="px-4 py-2">{rec.assessment_date || (rec.created_at ? new Date(rec.created_at * 1000).toLocaleDateString() : '-')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
