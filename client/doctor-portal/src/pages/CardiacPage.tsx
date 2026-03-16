import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createCardiac, getPatients } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import {
  Heart,
  HeartPulse,
  Activity,
  Clock,
  Save,
  Search,
  AlertTriangle,
  Zap,
  Plus
} from 'lucide-react';

interface CardiacEvent {
  time: string;
  type: string;
  details: string;
}

interface ECGReading {
  id: string;
  timestamp: string;
  rhythm: string;
  rate: number;
  interpretation: string;
  stElevation: boolean;
  leads: string[];
}

export default function CardiacPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Cardiac Event Form State
  const [eventType, setEventType] = useState<string>('stemi');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [symptomOnset, setSymptomOnset] = useState('');
  const [chestPainCharacter, setChestPainCharacter] = useState('');
  const [painRadiation, setPainRadiation] = useState<string[]>([]);
  const [associatedSymptoms, setAssociatedSymptoms] = useState<string[]>([]);
  const [heartRate, setHeartRate] = useState('');
  const [bloodPressure, setBloodPressure] = useState('');
  const [troponinLevel, setTroponinLevel] = useState('');
  const [bnpLevel, setBnpLevel] = useState('');
  const [killipClass, setKillipClass] = useState('1');
  const [timiScore, setTimiScore] = useState(0);
  const [treatment, setTreatment] = useState<string[]>([]);
  const [disposition, setDisposition] = useState('');
  const [narrative, setNarrative] = useState('');

  // ECG Readings
  const [ecgReadings, setEcgReadings] = useState<ECGReading[]>([]);
  const [showECGForm, setShowECGForm] = useState(false);
  const [newECG, setNewECG] = useState<Partial<ECGReading>>({
    rhythm: 'normal_sinus',
    rate: 72,
    interpretation: '',
    stElevation: false,
    leads: []
  });

  // Event Timeline
  const [events, setEvents] = useState<CardiacEvent[]>([]);

  useEffect(() => {
    loadPatients();
  }, []);

  const loadPatients = async () => {
    try {
      const data = await getPatients();
      setPatients(data);
    } catch (err) {
      console.error('Failed to load patients', err);
    }
  };

  const filteredPatients = patients.filter(p =>
    (p.full_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (p.patient_id?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  const selectedPatientData = patients.find(p => p.patient_id === selectedPatient);

  const addEvent = (type: string, details: string) => {
    setEvents(prev => [
      ...prev,
      { time: new Date().toLocaleTimeString(), type, details }
    ]);
  };

  const addECGReading = () => {
    if (!newECG.rhythm) return;
    const reading: ECGReading = {
      id: `ECG-${Date.now()}`,
      timestamp: new Date().toISOString(),
      rhythm: newECG.rhythm || 'normal_sinus',
      rate: newECG.rate || 72,
      interpretation: newECG.interpretation || '',
      stElevation: newECG.stElevation || false,
      leads: newECG.leads || []
    };
    setEcgReadings(prev => [...prev, reading]);
    addEvent('ECG', `${reading.rhythm} - Rate: ${reading.rate}`);
    setShowECGForm(false);
    setNewECG({ rhythm: 'normal_sinus', rate: 72, interpretation: '', stElevation: false, leads: [] });
  };

  const calculateTIMI = () => {
    let score = 0;
    // Age >= 65
    if (selectedPatientData) {
      const age = new Date().getFullYear() - new Date(selectedPatientData.date_of_birth).getFullYear();
      if (age >= 65) score++;
    }
    // >= 3 CAD risk factors
    if (associatedSymptoms.includes('diabetes') || associatedSymptoms.includes('hypertension')) score++;
    // Known CAD (>=50% stenosis)
    if (treatment.includes('prior_cad')) score++;
    // ASA use in past 7 days
    if (treatment.includes('aspirin')) score++;
    // Severe angina (>=2 events in 24h)
    if (chestPainCharacter === 'severe') score++;
    // ST changes >= 0.5mm
    if (ecgReadings.some(e => e.stElevation)) score++;
    // Positive cardiac marker
    if (parseFloat(troponinLevel) > 0.04) score++;
    
    setTimiScore(score);
    return score;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) {
      setError('Please select a patient');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const cardiacData = {
        event_id: `CARDIAC-${Date.now()}`,
        patient_id: selectedPatient,
        event_type: eventType,
        chief_complaint: chiefComplaint,
        symptom_onset: symptomOnset,
        chest_pain_character: chestPainCharacter,
        pain_radiation: painRadiation,
        associated_symptoms: associatedSymptoms,
        vital_signs: {
          heart_rate: parseInt(heartRate) || 0,
          blood_pressure: bloodPressure
        },
        lab_values: {
          troponin: parseFloat(troponinLevel) || 0,
          bnp: parseFloat(bnpLevel) || 0
        },
        killip_class: parseInt(killipClass),
        timi_score: timiScore,
        ecg_readings: ecgReadings,
        treatments: treatment,
        disposition,
        narrative,
        timeline: events,
        documented_by: user?.userId || 'unknown',
        documented_at: Math.floor(Date.now() / 1000)
      };

      await createCardiac(cardiacData);
      setSuccess(true);
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError('Failed to save cardiac event. Please try again.');
      console.error('Failed to save cardiac event', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const eventTypes = [
    { value: 'stemi', label: 'STEMI', color: 'bg-red-600' },
    { value: 'nstemi', label: 'NSTEMI', color: 'bg-orange-500' },
    { value: 'unstable_angina', label: 'Unstable Angina', color: 'bg-yellow-500' },
    { value: 'heart_failure', label: 'Heart Failure', color: 'bg-purple-500' },
    { value: 'arrhythmia', label: 'Arrhythmia', color: 'bg-blue-500' },
    { value: 'cardiac_arrest', label: 'Cardiac Arrest', color: 'bg-red-800' }
  ];

  const rhythmTypes = [
    'normal_sinus', 'sinus_tachycardia', 'sinus_bradycardia', 'atrial_fibrillation',
    'atrial_flutter', 'svt', 'ventricular_tachycardia', 'ventricular_fibrillation',
    'asystole', 'pea', 'first_degree_block', 'second_degree_type_1', 
    'second_degree_type_2', 'third_degree_block', 'paced_rhythm'
  ];

  const stemiLeads = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'I', 'II', 'III', 'aVR', 'aVL', 'aVF'];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-600 to-pink-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-white/20 rounded-full">
                <HeartPulse className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Cardiac Event Documentation</h1>
                <p className="text-red-100">Document and manage acute cardiac events</p>
              </div>
            </div>
            {eventType && (
              <div className={`px-4 py-2 rounded-full text-white font-bold ${eventTypes.find(e => e.value === eventType)?.color}`}>
                {eventTypes.find(e => e.value === eventType)?.label}
              </div>
            )}
          </div>
        </div>

        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center">
            <Heart className="h-5 w-5 mr-2" />
            Cardiac event documented successfully! Redirecting...
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
            {/* Left Column - Patient Selection & Event Type */}
            <div className="space-y-6">
              {/* Patient Selection */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Search className="h-5 w-5 mr-2 text-red-500" />
                  Patient Selection
                </h2>
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search patients..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <select
                  value={selectedPatient}
                  onChange={(e) => setSelectedPatient(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                  required
                >
                  <option value="">Select a patient</option>
                  {filteredPatients.map(p => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} - {p.patient_id}
                    </option>
                  ))}
                </select>
                {selectedPatientData && (
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <p className="font-medium">{selectedPatientData.full_name}</p>
                    <p className="text-sm text-gray-600">DOB: {selectedPatientData.date_of_birth}</p>
                    <p className="text-sm text-gray-600">Blood Type: {selectedPatientData.emergency_info?.blood_type || 'Unknown'}</p>
                  </div>
                )}
              </div>

              {/* Event Type */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Heart className="h-5 w-5 mr-2 text-red-500" />
                  Event Type
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {eventTypes.map(type => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => {
                        setEventType(type.value);
                        addEvent('Classification', type.label);
                      }}
                      className={`p-3 rounded-lg text-sm font-medium transition-all ${
                        eventType === type.value
                          ? `${type.color} text-white`
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Killip Classification */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Killip Classification</h2>
                <select
                  value={killipClass}
                  onChange={(e) => setKillipClass(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                >
                  <option value="1">Class I - No heart failure</option>
                  <option value="2">Class II - Rales, S3, JVD</option>
                  <option value="3">Class III - Pulmonary edema</option>
                  <option value="4">Class IV - Cardiogenic shock</option>
                </select>
                <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-700">TIMI Risk Score</span>
                    <button
                      type="button"
                      onClick={calculateTIMI}
                      className="text-xs bg-blue-600 text-white px-3 py-1 rounded-full hover:bg-blue-700"
                    >
                      Calculate
                    </button>
                  </div>
                  <p className="text-2xl font-bold text-blue-800 mt-2">{timiScore}/7</p>
                </div>
              </div>
            </div>

            {/* Middle Column - Clinical Details */}
            <div className="space-y-6">
              {/* Symptoms */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Activity className="h-5 w-5 mr-2 text-red-500" />
                  Clinical Presentation
                </h2>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="cardiac-chief-complaint" className="block text-sm font-medium text-gray-700 mb-1">Chief Complaint</label>
                    <input
                      id="cardiac-chief-complaint"
                      type="text"
                      value={chiefComplaint}
                      onChange={(e) => setChiefComplaint(e.target.value)}
                      placeholder="e.g., Crushing chest pain"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="cardiac-symptom-onset" className="block text-sm font-medium text-gray-700 mb-1">Symptom Onset</label>
                    <input
                      id="cardiac-symptom-onset"
                      type="datetime-local"
                      value={symptomOnset}
                      onChange={(e) => setSymptomOnset(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="cardiac-chest-pain-character" className="block text-sm font-medium text-gray-700 mb-1">Chest Pain Character</label>
                    <select
                      id="cardiac-chest-pain-character"
                      value={chestPainCharacter}
                      onChange={(e) => setChestPainCharacter(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                    >
                      <option value="">Select character</option>
                      <option value="crushing">Crushing/Pressure</option>
                      <option value="sharp">Sharp/Stabbing</option>
                      <option value="burning">Burning</option>
                      <option value="aching">Aching/Dull</option>
                      <option value="squeezing">Squeezing</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Pain Radiation</label>
                    <div className="flex flex-wrap gap-2">
                      {['Left arm', 'Right arm', 'Jaw', 'Back', 'Neck', 'Epigastric'].map(loc => (
                        <label key={loc} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={painRadiation.includes(loc)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPainRadiation([...painRadiation, loc]);
                              } else {
                                setPainRadiation(painRadiation.filter(l => l !== loc));
                              }
                            }}
                            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                          />
                          <span className="text-sm text-gray-600">{loc}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Associated Symptoms</label>
                    <div className="flex flex-wrap gap-2">
                      {['Diaphoresis', 'Dyspnea', 'Nausea', 'Vomiting', 'Syncope', 'Palpitations', 'Fatigue'].map(sym => (
                        <label key={sym} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={associatedSymptoms.includes(sym)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAssociatedSymptoms([...associatedSymptoms, sym]);
                              } else {
                                setAssociatedSymptoms(associatedSymptoms.filter(s => s !== sym));
                              }
                            }}
                            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                          />
                          <span className="text-sm text-gray-600">{sym}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Vitals & Labs */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Vitals & Labs</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="cardiac-heart-rate" className="block text-sm font-medium text-gray-700 mb-1">Heart Rate (bpm)</label>
                    <input
                      id="cardiac-heart-rate"
                      type="number"
                      value={heartRate}
                      onChange={(e) => setHeartRate(e.target.value)}
                      placeholder="72"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="cardiac-blood-pressure" className="block text-sm font-medium text-gray-700 mb-1">Blood Pressure</label>
                    <input
                      id="cardiac-blood-pressure"
                      type="text"
                      value={bloodPressure}
                      onChange={(e) => setBloodPressure(e.target.value)}
                      placeholder="120/80"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="cardiac-troponin" className="block text-sm font-medium text-gray-700 mb-1">Troponin (ng/mL)</label>
                    <input
                      id="cardiac-troponin"
                      type="number"
                      step="0.001"
                      value={troponinLevel}
                      onChange={(e) => setTroponinLevel(e.target.value)}
                      placeholder="0.04"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                    {parseFloat(troponinLevel) > 0.04 && (
                      <p className="text-xs text-red-600 mt-1 flex items-center">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Elevated
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="cardiac-bnp" className="block text-sm font-medium text-gray-700 mb-1">BNP (pg/mL)</label>
                    <input
                      id="cardiac-bnp"
                      type="number"
                      value={bnpLevel}
                      onChange={(e) => setBnpLevel(e.target.value)}
                      placeholder="100"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
              </div>

              {/* Treatments */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Treatments Administered</h2>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'aspirin', label: 'Aspirin' },
                    { value: 'heparin', label: 'Heparin' },
                    { value: 'nitroglycerin', label: 'Nitroglycerin' },
                    { value: 'morphine', label: 'Morphine' },
                    { value: 'beta_blocker', label: 'Beta Blocker' },
                    { value: 'statin', label: 'Statin' },
                    { value: 'pci', label: 'PCI/Cath' },
                    { value: 'thrombolytics', label: 'Thrombolytics' },
                    { value: 'oxygen', label: 'Oxygen' },
                    { value: 'ace_inhibitor', label: 'ACE Inhibitor' }
                  ].map(tx => (
                    <label key={tx.value} className="flex items-center space-x-2 p-2 bg-gray-50 rounded">
                      <input
                        type="checkbox"
                        checked={treatment.includes(tx.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setTreatment([...treatment, tx.value]);
                            addEvent('Treatment', tx.label);
                          } else {
                            setTreatment(treatment.filter(t => t !== tx.value));
                          }
                        }}
                        className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      <span className="text-sm">{tx.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column - ECG & Timeline */}
            <div className="space-y-6">
              {/* ECG Readings */}
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <Zap className="h-5 w-5 mr-2 text-red-500" />
                    ECG Readings
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowECGForm(!showECGForm)}
                    className="flex items-center text-sm text-red-600 hover:text-red-700"
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add ECG
                  </button>
                </div>

                {showECGForm && (
                  <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
                    <div>
                      <label htmlFor="cardiac-ecg-rhythm" className="block text-sm font-medium text-gray-700 mb-1">Rhythm</label>
                      <select
                        id="cardiac-ecg-rhythm"
                        value={newECG.rhythm}
                        onChange={(e) => setNewECG({ ...newECG, rhythm: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                      >
                        {rhythmTypes.map(r => (
                          <option key={r} value={r}>{r.replace(/_/g, ' ').toUpperCase()}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="cardiac-ecg-rate" className="block text-sm font-medium text-gray-700 mb-1">Rate (bpm)</label>
                      <input
                        id="cardiac-ecg-rate"
                        type="number"
                        value={newECG.rate}
                        onChange={(e) => setNewECG({ ...newECG, rate: parseInt(e.target.value) })}
                        className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={newECG.stElevation}
                          onChange={(e) => setNewECG({ ...newECG, stElevation: e.target.checked })}
                          className="rounded border-gray-300 text-red-600"
                        />
                        <span className="text-sm font-medium text-gray-700">ST Elevation</span>
                      </label>
                    </div>
                    {newECG.stElevation && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Affected Leads</label>
                        <div className="flex flex-wrap gap-2">
                          {stemiLeads.map(lead => (
                            <label key={lead} className="flex items-center space-x-1">
                              <input
                                type="checkbox"
                                checked={newECG.leads?.includes(lead)}
                                onChange={(e) => {
                                  const leads = newECG.leads || [];
                                  if (e.target.checked) {
                                    setNewECG({ ...newECG, leads: [...leads, lead] });
                                  } else {
                                    setNewECG({ ...newECG, leads: leads.filter(l => l !== lead) });
                                  }
                                }}
                                className="rounded border-gray-300 text-red-600"
                              />
                              <span className="text-xs">{lead}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <label htmlFor="cardiac-ecg-interpretation" className="block text-sm font-medium text-gray-700 mb-1">Interpretation</label>
                      <textarea
                        id="cardiac-ecg-interpretation"
                        value={newECG.interpretation}
                        onChange={(e) => setNewECG({ ...newECG, interpretation: e.target.value })}
                        placeholder="ECG findings..."
                        rows={2}
                        className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addECGReading}
                      className="w-full bg-red-600 text-white py-2 rounded-lg hover:bg-red-700"
                    >
                      Save ECG Reading
                    </button>
                  </div>
                )}

                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {ecgReadings.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">No ECG readings recorded</p>
                  ) : (
                    ecgReadings.map(ecg => (
                      <div key={ecg.id} className="p-3 bg-gray-50 rounded-lg">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-sm">{ecg.rhythm.replace(/_/g, ' ').toUpperCase()}</p>
                            <p className="text-xs text-gray-500">Rate: {ecg.rate} bpm</p>
                            {ecg.stElevation && (
                              <p className="text-xs text-red-600 font-medium">
                                ST↑: {ecg.leads.join(', ')}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">
                            {new Date(ecg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Event Timeline */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Clock className="h-5 w-5 mr-2 text-red-500" />
                  Event Timeline
                </h2>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {events.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">No events logged</p>
                  ) : (
                    events.map((event, index) => (
                      <div key={index} className="flex items-start space-x-3 p-2 bg-gray-50 rounded">
                        <div className="w-2 h-2 bg-red-500 rounded-full mt-2"></div>
                        <div className="flex-1">
                          <p className="text-xs text-gray-500">{event.time}</p>
                          <p className="text-sm font-medium text-gray-700">{event.type}</p>
                          <p className="text-sm text-gray-600">{event.details}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Disposition & Narrative */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 id="cardiac-disposition-heading" className="text-lg font-semibold text-gray-900 mb-4">Disposition</h2>
                <select
                  id="cardiac-disposition"
                  aria-labelledby="cardiac-disposition-heading"
                  value={disposition}
                  onChange={(e) => setDisposition(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 mb-4"
                >
                  <option value="">Select disposition</option>
                  <option value="cath_lab">Cath Lab (PCI)</option>
                  <option value="ccu">Cardiac Care Unit</option>
                  <option value="icu">ICU</option>
                  <option value="telemetry">Telemetry Floor</option>
                  <option value="observation">Observation</option>
                  <option value="transfer">Transfer to Another Facility</option>
                  <option value="discharge">Discharge</option>
                  <option value="deceased">Deceased</option>
                </select>
                <div>
                  <label htmlFor="cardiac-clinical-narrative" className="block text-sm font-medium text-gray-700 mb-1">Clinical Narrative</label>
                  <textarea
                    id="cardiac-clinical-narrative"
                    value={narrative}
                    onChange={(e) => setNarrative(e.target.value)}
                    placeholder="Document the clinical course..."
                    rows={4}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                  />
                </div>
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
              className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Cardiac Event
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
