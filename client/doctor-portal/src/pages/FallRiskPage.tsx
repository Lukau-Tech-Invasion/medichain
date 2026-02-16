import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createFallRisk, getPatients } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import {
  AlertTriangle,
  Shield,
  CheckCircle2,
  Save,
  Search,
  User,
  Activity,
  TrendingUp,
  History,
  FileText,
  AlertCircle,
  Footprints,
  HeartPulse,
  Brain,
  Eye,
  RefreshCw
} from 'lucide-react';

type RiskLevel = 'low' | 'moderate' | 'high';

interface MorseScale {
  fallHistory: 0 | 25;
  secondaryDiagnosis: 0 | 15;
  ambulatoryAid: 0 | 15 | 30;
  ivTherapy: 0 | 20;
  gait: 0 | 10 | 20;
  mentalStatus: 0 | 15;
}

interface FallRiskAssessment {
  id: string;
  patientId: string;
  assessmentDate: string;
  assessmentTime: string;
  assessedBy: string;
  morseScale: MorseScale;
  totalScore: number;
  riskLevel: RiskLevel;
  interventions: string[];
  additionalFactors: string[];
  environmentalHazards: string[];
  medications: {
    sedatives: boolean;
    antihypertensives: boolean;
    diuretics: boolean;
    psychotropics: boolean;
    narcotics: boolean;
  };
  recentFall: {
    occurred: boolean;
    date?: string;
    circumstances?: string;
    injuries?: string;
  };
  mobility: {
    bedridden: boolean;
    wheelchairBound: boolean;
    usesWalker: boolean;
    usesCane: boolean;
    independent: boolean;
  };
  notes: string;
}

export default function FallRiskPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientProfile | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'assessment' | 'history'>('assessment');
  const [_assessmentHistory, _setAssessmentHistory] = useState<FallRiskAssessment[]>([]);

  const [morseScale, setMorseScale] = useState<MorseScale>({
    fallHistory: 0,
    secondaryDiagnosis: 0,
    ambulatoryAid: 0,
    ivTherapy: 0,
    gait: 0,
    mentalStatus: 0
  });

  const [medications, setMedications] = useState({
    sedatives: false,
    antihypertensives: false,
    diuretics: false,
    psychotropics: false,
    narcotics: false
  });

  const [recentFall, setRecentFall] = useState({
    occurred: false,
    date: '',
    circumstances: '',
    injuries: ''
  });

  const [mobility, setMobility] = useState({
    bedridden: false,
    wheelchairBound: false,
    usesWalker: false,
    usesCane: false,
    independent: true
  });

  const [interventions, setInterventions] = useState<string[]>([]);
  const [additionalFactors, setAdditionalFactors] = useState<string[]>([]);
  const [environmentalHazards, setEnvironmentalHazards] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const interventionOptions = [
    'Fall Risk Band Applied',
    'Bed in Low Position',
    'Side Rails Up x2',
    'Side Rails Up x4',
    'Call Light Within Reach',
    'Non-Slip Footwear',
    'Hourly Rounding',
    'Toileting Schedule',
    'Bed Alarm Activated',
    'Chair Alarm Activated',
    'Floor Mat in Place',
    'Gait Belt for Ambulation',
    'Physical Therapy Consult',
    'Occupational Therapy Consult',
    'Family Education Provided',
    'Remove IV if Possible',
    'Medication Review',
    'Vision/Hearing Aids Available',
    'Clear Pathway to Bathroom',
    '1:1 Sitter Ordered'
  ];

  const additionalFactorOptions = [
    'Age > 65',
    'Age > 80',
    'History of Stroke',
    'Parkinson\'s Disease',
    'Neuropathy',
    'Orthostatic Hypotension',
    'Urinary Urgency/Incontinence',
    'Cognitive Impairment',
    'Delirium',
    'Vision Impairment',
    'Hearing Impairment',
    'Lower Extremity Weakness',
    'Balance Disorder',
    'Recent Surgery',
    'Post-Procedure',
    'Sleep Deprivation',
    'Alcohol Use',
    'Dehydration',
    'Anemia'
  ];

  const environmentalHazardOptions = [
    'Wet Floor',
    'Poor Lighting',
    'Cluttered Room',
    'Loose Cords/Wires',
    'Unfamiliar Environment',
    'High Bed Position',
    'Slippery Footwear',
    'No Grab Bars',
    'Obstacles in Path',
    'Equipment in Way'
  ];

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

  const calculateTotalScore = (): number => {
    return (
      morseScale.fallHistory +
      morseScale.secondaryDiagnosis +
      morseScale.ambulatoryAid +
      morseScale.ivTherapy +
      morseScale.gait +
      morseScale.mentalStatus
    );
  };

  const getRiskLevel = (score: number): RiskLevel => {
    if (score >= 45) return 'high';
    if (score >= 25) return 'moderate';
    return 'low';
  };

  const getRiskColor = (level: RiskLevel) => {
    switch (level) {
      case 'high': return 'text-red-600 bg-red-50 border-red-500';
      case 'moderate': return 'text-yellow-600 bg-yellow-50 border-yellow-500';
      default: return 'text-green-600 bg-green-50 border-green-500';
    }
  };

  const getRiskBadge = (level: RiskLevel) => {
    switch (level) {
      case 'high': return 'bg-red-500 text-white';
      case 'moderate': return 'bg-yellow-500 text-white';
      default: return 'bg-green-500 text-white';
    }
  };

  const totalScore = calculateTotalScore();
  const riskLevel = getRiskLevel(totalScore);

  const toggleIntervention = (intervention: string) => {
    setInterventions(prev =>
      prev.includes(intervention)
        ? prev.filter(i => i !== intervention)
        : [...prev, intervention]
    );
  };

  const toggleAdditionalFactor = (factor: string) => {
    setAdditionalFactors(prev =>
      prev.includes(factor)
        ? prev.filter(f => f !== factor)
        : [...prev, factor]
    );
  };

  const toggleEnvironmentalHazard = (hazard: string) => {
    setEnvironmentalHazards(prev =>
      prev.includes(hazard)
        ? prev.filter(h => h !== hazard)
        : [...prev, hazard]
    );
  };

  const handleSave = async () => {
    if (!selectedPatient) {
      setError('Please select a patient');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const assessmentData = {
        assessment_id: `FALL-${Date.now()}`,
        patient_id: selectedPatient.patient_id,
        assessment_date: new Date().toISOString().split('T')[0],
        assessment_time: new Date().toTimeString().slice(0, 5),
        assessed_by: user?.userId || 'unknown',
        morse_scale: morseScale,
        total_score: totalScore,
        risk_level: riskLevel,
        interventions,
        additional_factors: additionalFactors,
        environmental_hazards: environmentalHazards,
        medications,
        recent_fall: recentFall,
        mobility,
        notes,
        created_at: Math.floor(Date.now() / 1000)
      };

      await createFallRisk(assessmentData);
      setSuccess('Fall risk assessment saved successfully!');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError('Failed to save fall risk assessment. Please try again.');
      console.error('Failed to save fall risk assessment', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-amber-500 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-white/20 rounded-full">
                <Footprints className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Fall Risk Assessment</h1>
                <p className="text-orange-100">Morse Fall Scale & Intervention Planning</p>
              </div>
            </div>
            {selectedPatient && (
              <div className="text-right text-white">
                <p className="font-medium">{selectedPatient.full_name}</p>
                <p className="text-sm opacity-75">{selectedPatient.patient_id}</p>
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

        {/* Risk Score Display */}
        {selectedPatient && (
          <div className={`mb-6 rounded-lg border-2 p-6 ${getRiskColor(riskLevel)}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="p-3 rounded-full bg-white shadow">
                  {riskLevel === 'high' && <AlertTriangle className="h-8 w-8 text-red-500" />}
                  {riskLevel === 'moderate' && <AlertCircle className="h-8 w-8 text-yellow-500" />}
                  {riskLevel === 'low' && <Shield className="h-8 w-8 text-green-500" />}
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Morse Fall Scale Score: {totalScore}</h2>
                  <p className="text-lg font-medium capitalize">{riskLevel} Risk</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm">
                  Low: 0-24 | Moderate: 25-44 | High: ≥45
                </p>
                <span className={`mt-2 inline-block px-4 py-2 rounded-full text-lg font-bold ${getRiskBadge(riskLevel)}`}>
                  {riskLevel.toUpperCase()} RISK
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b flex">
            <button
              onClick={() => setActiveTab('assessment')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'assessment'
                  ? 'border-b-2 border-orange-500 text-orange-600'
                  : 'text-gray-500'
              }`}
            >
              <FileText className="h-5 w-5" />
              <span>Assessment</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'history'
                  ? 'border-b-2 border-orange-500 text-orange-600'
                  : 'text-gray-500'
              }`}
            >
              <History className="h-5 w-5" />
              <span>Assessment History</span>
            </button>
          </div>
        </div>

        {activeTab === 'assessment' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Patient Selection */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow p-4">
                <h2 className="font-bold text-gray-900 mb-4 flex items-center">
                  <User className="h-5 w-5 mr-2 text-orange-500" />
                  Select Patient
                </h2>
                <div className="relative mb-4">
                  <label htmlFor="fallrisk-patient-search" className="sr-only">Search patients</label>
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    id="fallrisk-patient-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search patients..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {filteredPatients.map(patient => (
                    <button
                      key={patient.patient_id}
                      onClick={() => setSelectedPatient(patient)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        selectedPatient?.patient_id === patient.patient_id
                          ? 'bg-orange-100 border-2 border-orange-500'
                          : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                      }`}
                    >
                      <p className="font-medium text-gray-900">{patient.full_name}</p>
                      <p className="text-sm text-gray-500">{patient.patient_id}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Risk Factor Medications */}
              <div className="bg-white rounded-lg shadow p-4 mt-4">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                  <HeartPulse className="h-5 w-5 mr-2 text-orange-500" />
                  High-Risk Medications
                </h3>
                <div className="space-y-2">
                  {[
                    { key: 'sedatives', label: 'Sedatives/Hypnotics' },
                    { key: 'antihypertensives', label: 'Antihypertensives' },
                    { key: 'diuretics', label: 'Diuretics' },
                    { key: 'psychotropics', label: 'Psychotropics' },
                    { key: 'narcotics', label: 'Narcotics/Opioids' }
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={medications[key as keyof typeof medications]}
                        onChange={() => setMedications(prev => ({ ...prev, [key]: !prev[key as keyof typeof medications] }))}
                        className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                      />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Mobility Status */}
              <div className="bg-white rounded-lg shadow p-4 mt-4">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                  <Activity className="h-5 w-5 mr-2 text-orange-500" />
                  Mobility Status
                </h3>
                <div className="space-y-2">
                  {[
                    { key: 'bedridden', label: 'Bedridden' },
                    { key: 'wheelchairBound', label: 'Wheelchair Bound' },
                    { key: 'usesWalker', label: 'Uses Walker' },
                    { key: 'usesCane', label: 'Uses Cane' },
                    { key: 'independent', label: 'Independent' }
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={mobility[key as keyof typeof mobility]}
                        onChange={() => setMobility(prev => ({ ...prev, [key]: !prev[key as keyof typeof mobility] }))}
                        className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                      />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Main Assessment */}
            <div className="lg:col-span-2 space-y-6">
              {/* Morse Fall Scale */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                  <TrendingUp className="h-6 w-6 mr-2 text-orange-500" />
                  Morse Fall Scale
                </h2>

                <div className="space-y-4">
                  {/* Fall History */}
                  <fieldset className="bg-gray-50 rounded-lg p-4">
                    <legend className="block font-medium text-gray-900 mb-2">
                      1. History of Falling (immediate or within 3 months)
                    </legend>
                    <div className="flex space-x-4">
                      <label htmlFor="fallrisk-fall-history-no" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-fall-history-no"
                          type="radio"
                          name="fallHistory"
                          checked={morseScale.fallHistory === 0}
                          onChange={() => setMorseScale(prev => ({ ...prev, fallHistory: 0 }))}
                          className="mr-2"
                        />
                        <span>No (0 points)</span>
                      </label>
                      <label htmlFor="fallrisk-fall-history-yes" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-fall-history-yes"
                          type="radio"
                          name="fallHistory"
                          checked={morseScale.fallHistory === 25}
                          onChange={() => setMorseScale(prev => ({ ...prev, fallHistory: 25 }))}
                          className="mr-2"
                        />
                        <span>Yes (25 points)</span>
                      </label>
                    </div>
                  </fieldset>

                  {/* Secondary Diagnosis */}
                  <fieldset className="bg-gray-50 rounded-lg p-4">
                    <legend className="block font-medium text-gray-900 mb-2">
                      2. Secondary Diagnosis (more than one medical diagnosis)
                    </legend>
                    <div className="flex space-x-4">
                      <label htmlFor="fallrisk-secondary-diagnosis-no" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-secondary-diagnosis-no"
                          type="radio"
                          name="secondaryDiagnosis"
                          checked={morseScale.secondaryDiagnosis === 0}
                          onChange={() => setMorseScale(prev => ({ ...prev, secondaryDiagnosis: 0 }))}
                          className="mr-2"
                        />
                        <span>No (0 points)</span>
                      </label>
                      <label htmlFor="fallrisk-secondary-diagnosis-yes" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-secondary-diagnosis-yes"
                          type="radio"
                          name="secondaryDiagnosis"
                          checked={morseScale.secondaryDiagnosis === 15}
                          onChange={() => setMorseScale(prev => ({ ...prev, secondaryDiagnosis: 15 }))}
                          className="mr-2"
                        />
                        <span>Yes (15 points)</span>
                      </label>
                    </div>
                  </fieldset>

                  {/* Ambulatory Aid */}
                  <fieldset className="bg-gray-50 rounded-lg p-4">
                    <legend className="block font-medium text-gray-900 mb-2">
                      3. Ambulatory Aid
                    </legend>
                    <div className="space-y-2">
                      <label htmlFor="fallrisk-ambulatory-aid-none" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-ambulatory-aid-none"
                          type="radio"
                          name="ambulatoryAid"
                          checked={morseScale.ambulatoryAid === 0}
                          onChange={() => setMorseScale(prev => ({ ...prev, ambulatoryAid: 0 }))}
                          className="mr-2"
                        />
                        <span>None / Bed Rest / Nurse Assist (0 points)</span>
                      </label>
                      <label htmlFor="fallrisk-ambulatory-aid-crutches" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-ambulatory-aid-crutches"
                          type="radio"
                          name="ambulatoryAid"
                          checked={morseScale.ambulatoryAid === 15}
                          onChange={() => setMorseScale(prev => ({ ...prev, ambulatoryAid: 15 }))}
                          className="mr-2"
                        />
                        <span>Crutches / Cane / Walker (15 points)</span>
                      </label>
                      <label htmlFor="fallrisk-ambulatory-aid-furniture" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-ambulatory-aid-furniture"
                          type="radio"
                          name="ambulatoryAid"
                          checked={morseScale.ambulatoryAid === 30}
                          onChange={() => setMorseScale(prev => ({ ...prev, ambulatoryAid: 30 }))}
                          className="mr-2"
                        />
                        <span>Furniture / Wall (30 points)</span>
                      </label>
                    </div>
                  </fieldset>

                  {/* IV Therapy */}
                  <fieldset className="bg-gray-50 rounded-lg p-4">
                    <legend className="block font-medium text-gray-900 mb-2">
                      4. IV Therapy / Heparin Lock
                    </legend>
                    <div className="flex space-x-4">
                      <label htmlFor="fallrisk-iv-therapy-no" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-iv-therapy-no"
                          type="radio"
                          name="ivTherapy"
                          checked={morseScale.ivTherapy === 0}
                          onChange={() => setMorseScale(prev => ({ ...prev, ivTherapy: 0 }))}
                          className="mr-2"
                        />
                        <span>No (0 points)</span>
                      </label>
                      <label htmlFor="fallrisk-iv-therapy-yes" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-iv-therapy-yes"
                          type="radio"
                          name="ivTherapy"
                          checked={morseScale.ivTherapy === 20}
                          onChange={() => setMorseScale(prev => ({ ...prev, ivTherapy: 20 }))}
                          className="mr-2"
                        />
                        <span>Yes (20 points)</span>
                      </label>
                    </div>
                  </fieldset>

                  {/* Gait */}
                  <fieldset className="bg-gray-50 rounded-lg p-4">
                    <legend className="block font-medium text-gray-900 mb-2">
                      5. Gait / Transferring
                    </legend>
                    <div className="space-y-2">
                      <label htmlFor="fallrisk-gait-normal" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-gait-normal"
                          type="radio"
                          name="gait"
                          checked={morseScale.gait === 0}
                          onChange={() => setMorseScale(prev => ({ ...prev, gait: 0 }))}
                          className="mr-2"
                        />
                        <span>Normal / Bedrest / Immobile (0 points)</span>
                      </label>
                      <label htmlFor="fallrisk-gait-weak" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-gait-weak"
                          type="radio"
                          name="gait"
                          checked={morseScale.gait === 10}
                          onChange={() => setMorseScale(prev => ({ ...prev, gait: 10 }))}
                          className="mr-2"
                        />
                        <span>Weak (10 points)</span>
                      </label>
                      <label htmlFor="fallrisk-gait-impaired" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-gait-impaired"
                          type="radio"
                          name="gait"
                          checked={morseScale.gait === 20}
                          onChange={() => setMorseScale(prev => ({ ...prev, gait: 20 }))}
                          className="mr-2"
                        />
                        <span>Impaired (20 points)</span>
                      </label>
                    </div>
                  </fieldset>

                  {/* Mental Status */}
                  <fieldset className="bg-gray-50 rounded-lg p-4">
                    <legend className="block font-medium text-gray-900 mb-2">
                      6. Mental Status
                    </legend>
                    <div className="flex space-x-4">
                      <label htmlFor="fallrisk-mental-status-oriented" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-mental-status-oriented"
                          type="radio"
                          name="mentalStatus"
                          checked={morseScale.mentalStatus === 0}
                          onChange={() => setMorseScale(prev => ({ ...prev, mentalStatus: 0 }))}
                          className="mr-2"
                        />
                        <span>Oriented to own ability (0 points)</span>
                      </label>
                      <label htmlFor="fallrisk-mental-status-overestimates" className="flex items-center cursor-pointer">
                        <input
                          id="fallrisk-mental-status-overestimates"
                          type="radio"
                          name="mentalStatus"
                          checked={morseScale.mentalStatus === 15}
                          onChange={() => setMorseScale(prev => ({ ...prev, mentalStatus: 15 }))}
                          className="mr-2"
                        />
                        <span>Overestimates / Forgets limitations (15 points)</span>
                      </label>
                    </div>
                  </fieldset>
                </div>
              </div>

              {/* Recent Fall History */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                  <AlertTriangle className="h-5 w-5 mr-2 text-orange-500" />
                  Recent Fall Documentation
                </h3>
                <label className="flex items-center space-x-2 mb-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recentFall.occurred}
                    onChange={() => setRecentFall(prev => ({ ...prev, occurred: !prev.occurred }))}
                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                  />
                  <span className="font-medium">Patient has had a recent fall</span>
                </label>
                {recentFall.occurred && (
                  <div className="space-y-3 pl-6">
                    <div>
                      <label htmlFor="fallrisk-fall-date" className="block text-sm font-medium text-gray-700 mb-1">Date of Fall</label>
                      <input
                        id="fallrisk-fall-date"
                        type="date"
                        value={recentFall.date}
                        onChange={(e) => setRecentFall(prev => ({ ...prev, date: e.target.value }))}
                        className="w-full p-2 border border-gray-300 rounded"
                      />
                    </div>
                    <div>
                      <label htmlFor="fallrisk-fall-circumstances" className="block text-sm font-medium text-gray-700 mb-1">Circumstances</label>
                      <textarea
                        id="fallrisk-fall-circumstances"
                        value={recentFall.circumstances}
                        onChange={(e) => setRecentFall(prev => ({ ...prev, circumstances: e.target.value }))}
                        placeholder="Describe how the fall occurred..."
                        rows={2}
                        className="w-full p-2 border border-gray-300 rounded"
                      />
                    </div>
                    <div>
                      <label htmlFor="fallrisk-fall-injuries" className="block text-sm font-medium text-gray-700 mb-1">Injuries Sustained</label>
                      <input
                        id="fallrisk-fall-injuries"
                        type="text"
                        value={recentFall.injuries}
                        onChange={(e) => setRecentFall(prev => ({ ...prev, injuries: e.target.value }))}
                        placeholder="Any injuries from the fall..."
                        className="w-full p-2 border border-gray-300 rounded"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Additional Risk Factors */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                  <Brain className="h-5 w-5 mr-2 text-orange-500" />
                  Additional Risk Factors
                </h3>
                <div className="flex flex-wrap gap-2">
                  {additionalFactorOptions.map(factor => (
                    <button
                      key={factor}
                      type="button"
                      onClick={() => toggleAdditionalFactor(factor)}
                      className={`px-3 py-1 rounded-full text-sm transition-colors ${
                        additionalFactors.includes(factor)
                          ? 'bg-orange-500 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {factor}
                    </button>
                  ))}
                </div>
              </div>

              {/* Environmental Hazards */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                  <Eye className="h-5 w-5 mr-2 text-orange-500" />
                  Environmental Hazards
                </h3>
                <div className="flex flex-wrap gap-2">
                  {environmentalHazardOptions.map(hazard => (
                    <button
                      key={hazard}
                      type="button"
                      onClick={() => toggleEnvironmentalHazard(hazard)}
                      className={`px-3 py-1 rounded-full text-sm transition-colors ${
                        environmentalHazards.includes(hazard)
                          ? 'bg-red-500 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {hazard}
                    </button>
                  ))}
                </div>
              </div>

              {/* Interventions */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                  <Shield className="h-5 w-5 mr-2 text-green-500" />
                  Fall Prevention Interventions
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {interventionOptions.map(intervention => (
                    <label
                      key={intervention}
                      className="flex items-center space-x-2 cursor-pointer p-2 rounded hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={interventions.includes(intervention)}
                        onChange={() => toggleIntervention(intervention)}
                        className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                      />
                      <span className="text-sm text-gray-700">{intervention}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div className="bg-white rounded-lg shadow p-6">
                <label htmlFor="fallrisk-additional-notes" className="font-bold text-gray-900 mb-4 block">Additional Notes</label>
                <textarea
                  id="fallrisk-additional-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional notes or observations..."
                  rows={4}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
              </div>

              {/* Submit Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={isSubmitting || !selectedPatient}
                  className="bg-orange-600 text-white px-8 py-3 rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center"
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

        {activeTab === 'history' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
              <History className="h-6 w-6 mr-2 text-orange-500" />
              Assessment History
            </h2>
            {_assessmentHistory.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No assessment history available.</p>
                <p className="text-sm mt-1">Previous assessments will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {_assessmentHistory.map((assessment: FallRiskAssessment) => (
                  <div key={assessment.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold">{assessment.patientId}</p>
                        <p className="text-sm text-gray-500">
                          {assessment.assessmentDate} at {assessment.assessmentTime}
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded text-sm ${getRiskBadge(assessment.riskLevel)}`}>
                        Score: {assessment.totalScore} - {assessment.riskLevel.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-2">
                      Interventions: {assessment.interventions.length}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
