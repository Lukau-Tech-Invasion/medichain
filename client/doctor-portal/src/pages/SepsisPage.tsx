import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createSepsis, getPatients, apiUrl } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import {
  Thermometer,
  Clock,
  Save,
  Search,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  Syringe,
  Droplets,
  Timer,
  Brain,
  Heart,
  Wind,
  History
} from 'lucide-react';

interface BundleItem {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  completedAt?: string;
  completedBy?: string;
}

interface LactateReading {
  timestamp: string;
  value: number;
  source: string;
}

export default function SepsisPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [emergencyHistory, setEmergencyHistory] = useState<Array<{event_id: string; event_type?: string; event_time?: number; assessed_at?: number; outcome?: string}>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sepsisStartTime, setSepsisStartTime] = useState<Date | null>(null);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);

  // qSOFA Scoring
  const [respiratoryRate, setRespiratoryRate] = useState<number>(0);
  const [systolicBP, setSystolicBP] = useState<number>(120);
  const [gcsScore, setGcsScore] = useState<number>(15);
  const [qsofaScore, setQsofaScore] = useState(0);

  // SOFA Scoring for ICU
  const [pao2fio2, _setPao2fio2] = useState<number>(400);
  const [platelets, _setPlatelets] = useState<number>(150);
  const [bilirubin, _setBilirubin] = useState<number>(1.0);
  const [map, _setMap] = useState<number>(70);
  const [creatinine, _setCreatinine] = useState<number>(1.0);
  const [sofaScore, setSofaScore] = useState(0);

  // Lactate Trending
  const [lactateReadings, setLactateReadings] = useState<LactateReading[]>([]);
  const [newLactate, setNewLactate] = useState('');

  // Sepsis Classification
  const [classification, setClassification] = useState<'sirs' | 'sepsis' | 'severe_sepsis' | 'septic_shock'>('sepsis');

  // Hour-1 Bundle
  const [hour1Bundle, setHour1Bundle] = useState<BundleItem[]>([
    { id: 'lactate', label: 'Measure Lactate Level', description: 'Draw initial lactate level', completed: false },
    { id: 'blood_cultures', label: 'Obtain Blood Cultures', description: 'Before antibiotics if possible', completed: false },
    { id: 'antibiotics', label: 'Administer Broad-Spectrum Antibiotics', description: 'Within 1 hour of recognition', completed: false },
    { id: 'fluids', label: 'Begin 30mL/kg Crystalloid', description: 'For hypotension or lactate ≥4', completed: false },
    { id: 'vasopressors', label: 'Apply Vasopressors', description: 'If hypotensive during/after fluid', completed: false }
  ]);

  // 3-Hour Bundle (legacy but still tracked)
  const [hour3Bundle, setHour3Bundle] = useState<BundleItem[]>([
    { id: 'repeat_lactate', label: 'Repeat Lactate', description: 'If initial lactate >2', completed: false },
    { id: 'reassess_volume', label: 'Reassess Volume Status', description: 'Document hemodynamic response', completed: false },
    { id: 'perfusion_check', label: 'Reassess Tissue Perfusion', description: 'Check cap refill, skin mottling', completed: false }
  ]);

  // Infection Source
  const [infectionSource, setInfectionSource] = useState<string>('');
  const [suspectedOrganism, setSuspectedOrganism] = useState<string>('');
  const [antibioticsGiven, setAntibioticsGiven] = useState<string[]>([]);
  const [fluidVolume, setFluidVolume] = useState<number>(0);
  const [vasopressorType, setVasopressorType] = useState<string>('');
  const [narrative, setNarrative] = useState('');

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    // Calculate qSOFA
    let score = 0;
    if (respiratoryRate >= 22) score++;
    if (systolicBP <= 100) score++;
    if (gcsScore < 15) score++;
    setQsofaScore(score);
  }, [respiratoryRate, systolicBP, gcsScore]);

  useEffect(() => {
    // Timer for elapsed time
    if (sepsisStartTime) {
      const interval = setInterval(() => {
        const now = new Date();
        const diff = Math.floor((now.getTime() - sepsisStartTime.getTime()) / 60000);
        setElapsedMinutes(diff);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [sepsisStartTime]);

  const loadPatients = async () => {
    try {
      const data = await getPatients();
      setPatients(data);
    } catch (err) {
      console.error('Failed to load patients', err);
    }
  };

  const fetchEmergencyHistory = async (patientId: string) => {
    if (!user || !patientId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/clinical/patient/${patientId}/emergency`), {
        headers: { 'X-User-Id': user.walletAddress, 'X-Provider-Role': user.role },
      });
      if (res.ok) {
        const data = await res.json();
        setEmergencyHistory(data.events || data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const filteredPatients = patients.filter(p =>
    p.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.patient_id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedPatientData = patients.find(p => p.patient_id === selectedPatient);

  const startSepsisProtocol = () => {
    setSepsisStartTime(new Date());
  };

  const toggleBundleItem = (bundleType: 'hour1' | 'hour3', itemId: string) => {
    const setBundles = bundleType === 'hour1' ? setHour1Bundle : setHour3Bundle;
    const bundles = bundleType === 'hour1' ? hour1Bundle : hour3Bundle;
    
    setBundles(bundles.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          completed: !item.completed,
          completedAt: !item.completed ? new Date().toISOString() : undefined,
          completedBy: !item.completed ? user?.userId : undefined
        };
      }
      return item;
    }));
  };

  const addLactateReading = () => {
    const value = parseFloat(newLactate);
    if (isNaN(value)) return;
    
    setLactateReadings(prev => [...prev, {
      timestamp: new Date().toISOString(),
      value,
      source: 'venous'
    }]);
    setNewLactate('');
    
    // Auto-complete bundle item if this is first lactate
    if (lactateReadings.length === 0) {
      toggleBundleItem('hour1', 'lactate');
    }
  };

  const _calculateSOFA = () => {
    let score = 0;
    // Respiration
    if (pao2fio2 < 100) score += 4;
    else if (pao2fio2 < 200) score += 3;
    else if (pao2fio2 < 300) score += 2;
    else if (pao2fio2 < 400) score += 1;
    
    // Coagulation
    if (platelets < 20) score += 4;
    else if (platelets < 50) score += 3;
    else if (platelets < 100) score += 2;
    else if (platelets < 150) score += 1;
    
    // Liver
    if (bilirubin >= 12) score += 4;
    else if (bilirubin >= 6) score += 3;
    else if (bilirubin >= 2) score += 2;
    else if (bilirubin >= 1.2) score += 1;
    
    // Cardiovascular
    if (map < 70) score += 1;
    // Add more for vasopressor use...
    
    // Renal
    if (creatinine >= 5) score += 4;
    else if (creatinine >= 3.5) score += 3;
    else if (creatinine >= 2) score += 2;
    else if (creatinine >= 1.2) score += 1;
    
    // CNS (GCS)
    if (gcsScore < 6) score += 4;
    else if (gcsScore < 10) score += 3;
    else if (gcsScore < 13) score += 2;
    else if (gcsScore < 15) score += 1;
    
    setSofaScore(score);
  };

  const hour1Complete = hour1Bundle.every(item => item.completed);
  const hour3Complete = hour3Bundle.every(item => item.completed);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) {
      setError('Please select a patient');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const sepsisData = {
        sepsis_id: `SEPSIS-${Date.now()}`,
        patient_id: selectedPatient,
        classification,
        qsofa_score: qsofaScore,
        sofa_score: sofaScore,
        vital_signs: {
          respiratory_rate: respiratoryRate,
          systolic_bp: systolicBP,
          gcs: gcsScore,
          map
        },
        labs: {
          lactate_readings: lactateReadings,
          pao2_fio2: pao2fio2,
          platelets,
          bilirubin,
          creatinine
        },
        infection: {
          source: infectionSource,
          suspected_organism: suspectedOrganism,
          antibiotics: antibioticsGiven
        },
        bundle_completion: {
          hour_1: hour1Bundle,
          hour_3: hour3Bundle,
          all_hour1_complete: hour1Complete,
          all_hour3_complete: hour3Complete
        },
        treatment: {
          fluid_volume_ml: fluidVolume,
          vasopressor: vasopressorType
        },
        protocol_start_time: sepsisStartTime?.toISOString(),
        elapsed_minutes: elapsedMinutes,
        narrative,
        documented_by: user?.userId || 'unknown',
        documented_at: Math.floor(Date.now() / 1000)
      };

      await createSepsis(sepsisData);
      setSuccess(true);
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError('Failed to save sepsis protocol. Please try again.');
      console.error('Failed to save sepsis data', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTimeColor = () => {
    if (elapsedMinutes <= 60) return 'text-green-600';
    if (elapsedMinutes <= 180) return 'text-yellow-600';
    return 'text-red-600';
  };

  const infectionSources = [
    'Pneumonia', 'UTI', 'Abdominal', 'Skin/Soft Tissue', 
    'Meningitis', 'Endocarditis', 'Bone/Joint', 'Catheter-Related', 'Unknown'
  ];

  const antibioticOptions = [
    'Vancomycin', 'Piperacillin-Tazobactam', 'Meropenem', 'Cefepime',
    'Ceftriaxone', 'Metronidazole', 'Azithromycin', 'Levofloxacin',
    'Gentamicin', 'Daptomycin'
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header with Timer */}
        <div className="bg-gradient-to-r from-orange-600 to-red-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-white/20 rounded-full">
                <Thermometer className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Sepsis Protocol</h1>
                <p className="text-orange-100">Time-critical sepsis management bundle</p>
              </div>
            </div>
            <div className="text-right">
              {sepsisStartTime ? (
                <div className="bg-white/20 rounded-lg p-4">
                  <p className="text-sm text-orange-100">Protocol Active</p>
                  <p className={`text-3xl font-bold ${getTimeColor()} bg-white rounded px-3 py-1`}>
                    {Math.floor(elapsedMinutes / 60)}:{(elapsedMinutes % 60).toString().padStart(2, '0')}
                  </p>
                  <p className="text-xs text-orange-100 mt-1">
                    {elapsedMinutes > 60 ? (
                      <span className="inline-flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" /> Exceeds 1-hour target</span>
                    ) : '✓ Within target'}
                  </p>
                </div>
              ) : (
                <button
                  onClick={startSepsisProtocol}
                  className="bg-white text-orange-600 px-6 py-3 rounded-lg font-bold hover:bg-orange-50 flex items-center"
                >
                  <Timer className="h-5 w-5 mr-2" />
                  Start Protocol Timer
                </button>
              )}
            </div>
          </div>
        </div>

        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center">
            <CheckCircle className="h-5 w-5 mr-2" />
            Sepsis protocol documented successfully! Redirecting...
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Patient & Scoring */}
            <div className="space-y-6">
              {/* Patient Selection */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Search className="h-5 w-5 mr-2 text-orange-500" />
                  Patient Selection
                </h2>
                <div className="relative mb-4">
                  <label htmlFor="sepsis-patient-search" className="sr-only">Search patients</label>
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    id="sepsis-patient-search"
                    type="text"
                    placeholder="Search patients..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>
                <label htmlFor="sepsis-patient-select" className="sr-only">Select patient</label>
                <select
                  id="sepsis-patient-select"
                  value={selectedPatient}
                  onChange={(e) => { setSelectedPatient(e.target.value); fetchEmergencyHistory(e.target.value); }}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                  required
                >
                  <option value="">Select a patient</option>
                  {filteredPatients.map(p => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} - {p.patient_id}
                    </option>
                  ))}
                </select>
                {selectedPatient && (
                  <div className="mt-3">
                    <h4 className="text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                      <History className="h-3 w-3 text-orange-500" /> Past Emergency Events
                    </h4>
                    {historyLoading ? (
                      <p className="text-gray-400 text-xs">Loading...</p>
                    ) : emergencyHistory.length === 0 ? (
                      <p className="text-gray-400 text-xs italic">No prior events.</p>
                    ) : (
                      <div className="space-y-1">
                        {emergencyHistory.slice(0, 3).map((ev) => (
                          <div key={ev.event_id} className="text-xs bg-orange-50 rounded p-1.5 flex justify-between">
                            <span>{ev.event_type || 'Sepsis'}</span>
                            <span className="text-gray-500">{ev.assessed_at ? new Date(ev.assessed_at * 1000).toLocaleDateString() : '-'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Classification */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Classification</h2>
                <div className="space-y-2">
                  {[
                    { value: 'sirs', label: 'SIRS', color: 'bg-yellow-500' },
                    { value: 'sepsis', label: 'Sepsis', color: 'bg-orange-500' },
                    { value: 'severe_sepsis', label: 'Severe Sepsis', color: 'bg-red-500' },
                    { value: 'septic_shock', label: 'Septic Shock', color: 'bg-red-800' }
                  ].map(cls => (
                    <button
                      key={cls.value}
                      type="button"
                      onClick={() => setClassification(cls.value as typeof classification)}
                      className={`w-full p-3 rounded-lg text-left font-medium transition-all ${
                        classification === cls.value
                          ? `${cls.color} text-white`
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {cls.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* qSOFA Score */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Brain className="h-5 w-5 mr-2 text-orange-500" />
                  qSOFA Score
                </h2>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="sepsis-respiratory-rate" className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">
                        <Wind className="h-4 w-4 inline mr-1" />
                        RR ≥22 /min
                      </span>
                      <span className={`font-bold ${respiratoryRate >= 22 ? 'text-red-600' : 'text-gray-400'}`}>
                        {respiratoryRate >= 22 ? '1' : '0'}
                      </span>
                    </label>
                    <input
                      id="sepsis-respiratory-rate"
                      type="range"
                      min="10"
                      max="40"
                      value={respiratoryRate}
                      onChange={(e) => setRespiratoryRate(parseInt(e.target.value))}
                      className="w-full mt-1"
                    />
                    <p className="text-xs text-gray-500 text-center">{respiratoryRate} /min</p>
                  </div>
                  <div>
                    <label htmlFor="sepsis-systolic-bp" className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">
                        <Heart className="h-4 w-4 inline mr-1" />
                        SBP ≤100 mmHg
                      </span>
                      <span className={`font-bold ${systolicBP <= 100 ? 'text-red-600' : 'text-gray-400'}`}>
                        {systolicBP <= 100 ? '1' : '0'}
                      </span>
                    </label>
                    <input
                      id="sepsis-systolic-bp"
                      type="range"
                      min="60"
                      max="180"
                      value={systolicBP}
                      onChange={(e) => setSystolicBP(parseInt(e.target.value))}
                      className="w-full mt-1"
                    />
                    <p className="text-xs text-gray-500 text-center">{systolicBP} mmHg</p>
                  </div>
                  <div>
                    <label htmlFor="sepsis-gcs-score" className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">
                        <Brain className="h-4 w-4 inline mr-1" />
                        GCS &lt;15
                      </span>
                      <span className={`font-bold ${gcsScore < 15 ? 'text-red-600' : 'text-gray-400'}`}>
                        {gcsScore < 15 ? '1' : '0'}
                      </span>
                    </label>
                    <input
                      id="sepsis-gcs-score"
                      type="range"
                      min="3"
                      max="15"
                      value={gcsScore}
                      onChange={(e) => setGcsScore(parseInt(e.target.value))}
                      className="w-full mt-1"
                    />
                    <p className="text-xs text-gray-500 text-center">GCS: {gcsScore}</p>
                  </div>
                </div>
                <div className={`mt-4 p-4 rounded-lg text-center ${
                  qsofaScore >= 2 ? 'bg-red-100' : 'bg-green-100'
                }`}>
                  <p className="text-sm font-medium text-gray-700">qSOFA Score</p>
                  <p className={`text-4xl font-bold ${qsofaScore >= 2 ? 'text-red-600' : 'text-green-600'}`}>
                    {qsofaScore}/3
                  </p>
                  {qsofaScore >= 2 && (
                    <p className="flex items-center gap-1 text-xs text-red-600 mt-1">
                      <AlertTriangle size={12} aria-hidden="true" /> High risk - Consider ICU
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Middle Column - Hour-1 Bundle */}
            <div className="space-y-6">
              {/* Hour-1 Bundle */}
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <Clock className="h-5 w-5 mr-2 text-orange-500" />
                    SEP-1: Hour-1 Bundle
                  </h2>
                  {hour1Complete ? (
                    <span className="bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
                      ✓ COMPLETE
                    </span>
                  ) : (
                    <span className="bg-yellow-100 text-yellow-700 text-xs font-bold px-3 py-1 rounded-full">
                      {hour1Bundle.filter(i => i.completed).length}/{hour1Bundle.length}
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {hour1Bundle.map(item => (
                    <div
                      key={item.id}
                      onClick={() => toggleBundleItem('hour1', item.id)}
                      className={`p-4 rounded-lg cursor-pointer transition-all ${
                        item.completed
                          ? 'bg-green-50 border-2 border-green-500'
                          : 'bg-gray-50 border-2 border-transparent hover:border-orange-300'
                      }`}
                    >
                      <div className="flex items-start">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center mr-3 ${
                          item.completed ? 'bg-green-500' : 'bg-gray-300'
                        }`}>
                          {item.completed ? (
                            <CheckCircle className="h-4 w-4 text-white" />
                          ) : (
                            <span className="w-3 h-3 bg-white rounded-full" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className={`font-medium ${item.completed ? 'text-green-700' : 'text-gray-700'}`}>
                            {item.label}
                          </p>
                          <p className="text-xs text-gray-500">{item.description}</p>
                          {item.completedAt && (
                            <p className="text-xs text-green-600 mt-1">
                              ✓ {new Date(item.completedAt).toLocaleTimeString()}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lactate Trending */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <TrendingUp className="h-5 w-5 mr-2 text-orange-500" />
                  Lactate Trending
                </h2>
                <div className="flex space-x-2 mb-4">
                  <label htmlFor="sepsis-lactate" className="sr-only">Lactate (mmol/L)</label>
                  <input
                    id="sepsis-lactate"
                    type="number"
                    step="0.1"
                    value={newLactate}
                    onChange={(e) => setNewLactate(e.target.value)}
                    placeholder="Lactate (mmol/L)"
                    className="flex-1 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                  />
                  <button
                    type="button"
                    onClick={addLactateReading}
                    className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700"
                  >
                    Add
                  </button>
                </div>
                <div className="space-y-2">
                  {lactateReadings.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">No lactate readings recorded</p>
                  ) : (
                    lactateReadings.map((reading, index) => (
                      <div key={index} className={`p-3 rounded-lg flex justify-between items-center ${
                        reading.value >= 4 ? 'bg-red-50' : reading.value >= 2 ? 'bg-yellow-50' : 'bg-green-50'
                      }`}>
                        <div>
                          <span className={`text-lg font-bold ${
                            reading.value >= 4 ? 'text-red-600' : reading.value >= 2 ? 'text-yellow-600' : 'text-green-600'
                          }`}>
                            {reading.value} mmol/L
                          </span>
                          {reading.value >= 4 && (
                            <span className="ml-2 text-xs bg-red-200 text-red-700 px-2 py-0.5 rounded">CRITICAL</span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(reading.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                {lactateReadings.length >= 2 && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-700">
                      Trend: {lactateReadings[lactateReadings.length - 1].value < lactateReadings[0].value 
                        ? '↓ Improving' : '↑ Worsening'}
                    </p>
                    <p className="text-xs text-blue-600">
                      Target: Decrease by ≥10% every 2 hours
                    </p>
                  </div>
                )}
              </div>

              {/* Infection Source */}
              <div className="bg-white rounded-lg shadow p-6">
                <label htmlFor="sepsis-infection-source" className="text-lg font-semibold text-gray-900 mb-4 block">Infection Source</label>
                <select
                  id="sepsis-infection-source"
                  value={infectionSource}
                  onChange={(e) => setInfectionSource(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 mb-4"
                >
                  <option value="">Select source</option>
                  {infectionSources.map(src => (
                    <option key={src} value={src}>{src}</option>
                  ))}
                </select>
                <label htmlFor="sepsis-suspected-organism" className="sr-only">Suspected organism</label>
                <input
                  id="sepsis-suspected-organism"
                  type="text"
                  value={suspectedOrganism}
                  onChange={(e) => setSuspectedOrganism(e.target.value)}
                  placeholder="Suspected organism (if known)"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            {/* Right Column - Treatment & Documentation */}
            <div className="space-y-6">
              {/* Antibiotics */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Syringe className="h-5 w-5 mr-2 text-orange-500" />
                  Antibiotics Administered
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {antibioticOptions.map(abx => (
                    <label key={abx} htmlFor={`sepsis-antibiotic-${abx.toLowerCase().replace(/[^a-z0-9]/g, '-')}`} className="flex items-center space-x-2 p-2 bg-gray-50 rounded">
                      <input
                        id={`sepsis-antibiotic-${abx.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                        type="checkbox"
                        checked={antibioticsGiven.includes(abx)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setAntibioticsGiven([...antibioticsGiven, abx]);
                            if (antibioticsGiven.length === 0) {
                              toggleBundleItem('hour1', 'antibiotics');
                            }
                          } else {
                            setAntibioticsGiven(antibioticsGiven.filter(a => a !== abx));
                          }
                        }}
                        className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                      />
                      <span className="text-sm">{abx}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Fluid Resuscitation */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Droplets className="h-5 w-5 mr-2 text-orange-500" />
                  Fluid Resuscitation
                </h2>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="sepsis-fluid-volume" className="block text-sm font-medium text-gray-700 mb-1">
                      Crystalloid Volume (mL)
                    </label>
                    <input
                      id="sepsis-fluid-volume"
                      type="number"
                      value={fluidVolume}
                      onChange={(e) => {
                        setFluidVolume(parseInt(e.target.value));
                        if (parseInt(e.target.value) >= 2000) {
                          toggleBundleItem('hour1', 'fluids');
                        }
                      }}
                      placeholder="e.g., 2000"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                    {selectedPatientData && fluidVolume > 0 && (
                      <p className="text-xs text-gray-500 mt-1">
                        Target: 30mL/kg ≈ {Math.round(70 * 30)} mL for average 70kg patient
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="sepsis-vasopressor" className="block text-sm font-medium text-gray-700 mb-1">
                      Vasopressor (if needed)
                    </label>
                    <select
                      id="sepsis-vasopressor"
                      value={vasopressorType}
                      onChange={(e) => {
                        setVasopressorType(e.target.value);
                        if (e.target.value) {
                          toggleBundleItem('hour1', 'vasopressors');
                        }
                      }}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="">None</option>
                      <option value="norepinephrine">Norepinephrine (1st line)</option>
                      <option value="vasopressin">Vasopressin</option>
                      <option value="epinephrine">Epinephrine</option>
                      <option value="dopamine">Dopamine</option>
                      <option value="phenylephrine">Phenylephrine</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* 3-Hour Bundle */}
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">3-Hour Reassessment</h2>
                  {hour3Complete ? (
                    <span className="bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
                      ✓ COMPLETE
                    </span>
                  ) : (
                    <span className="bg-gray-100 text-gray-600 text-xs font-bold px-3 py-1 rounded-full">
                      {hour3Bundle.filter(i => i.completed).length}/{hour3Bundle.length}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {hour3Bundle.map(item => (
                    <div
                      key={item.id}
                      onClick={() => toggleBundleItem('hour3', item.id)}
                      className={`p-3 rounded-lg cursor-pointer text-sm ${
                        item.completed
                          ? 'bg-green-50 border border-green-300'
                          : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center">
                        {item.completed ? (
                          <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                        ) : (
                          <XCircle className="h-4 w-4 text-gray-300 mr-2" />
                        )}
                        <span>{item.label}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Clinical Narrative */}
              <div className="bg-white rounded-lg shadow p-6">
                <label htmlFor="sepsis-narrative" className="text-lg font-semibold text-gray-900 mb-4 block">Clinical Narrative</label>
                <textarea
                  id="sepsis-narrative"
                  value={narrative}
                  onChange={(e) => setNarrative(e.target.value)}
                  placeholder="Document clinical course, response to treatment, concerns..."
                  rows={5}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="mt-6 flex justify-end space-x-4">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedPatient}
              className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Sepsis Protocol
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
