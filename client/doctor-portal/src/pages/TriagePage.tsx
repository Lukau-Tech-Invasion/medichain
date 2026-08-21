import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { apiUrl, getApiErrorMessage, useTranslation } from '@medichain/shared';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Activity,
  Heart,
  Thermometer,
  Wind,
  Droplet,
  Clock,
  User,
  Search,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Loader2,
  Plus,
} from 'lucide-react';

interface VitalSigns {
  heart_rate: number | null;
  respiratory_rate: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  temperature_celsius: number | null;
  oxygen_saturation: number | null;
  pain_scale: number | null;
  gcs_score: number | null;
  blood_glucose: number | null;
  weight_kg: number | null;
}

interface TriageAssessment {
  assessment_id: string;
  patient_id: string;
  esi_level: { level: number };
  chief_complaint: string;
  vital_signs: VitalSigns;
  pain_scale: number | null;
  notes: string | null;
  performed_by: string;
  performed_at: number;
}

interface Patient {
  patient_id: string;
  full_name: string;
  health_id: string;
  date_of_birth: string;
}

function TriagePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, isAuthenticated } = useAuthStore();

  const ESI_LEVELS = [
    {
      level: 1,
      name: t('docTriage.esi1_name'),
      color: 'bg-red-800',
      textColor: 'text-critical-subtle-fg',
      bgLight: 'bg-critical-subtle',
      borderColor: 'border-red-500',
      description: t('docTriage.esi1_description'),
      wait: t('docTriage.esi1_wait'),
      examples: t('docTriage.esi1_examples'),
    },
    {
      level: 2,
      name: t('docTriage.esi2_name'),
      color: 'bg-orange-700',
      textColor: 'text-content-secondary',
      bgLight: 'bg-surface-sunken',
      borderColor: 'border-orange-500',
      description: t('docTriage.esi2_description'),
      wait: t('docTriage.esi2_wait'),
      examples: t('docTriage.esi2_examples'),
    },
    {
      level: 3,
      name: t('docTriage.esi3_name'),
      color: 'bg-amber-700',
      textColor: 'text-caution-subtle-fg',
      bgLight: 'bg-caution-subtle',
      borderColor: 'border-yellow-500',
      description: t('docTriage.esi3_description'),
      wait: t('docTriage.esi3_wait'),
      examples: t('docTriage.esi3_examples'),
    },
    {
      level: 4,
      name: t('docTriage.esi4_name'),
      color: 'bg-green-800',
      textColor: 'text-ok-subtle-fg',
      bgLight: 'bg-ok-subtle',
      borderColor: 'border-green-500',
      description: t('docTriage.esi4_description'),
      wait: t('docTriage.esi4_wait'),
      examples: t('docTriage.esi4_examples'),
    },
    {
      level: 5,
      name: t('docTriage.esi5_name'),
      color: 'bg-sky-800',
      textColor: 'text-notice-subtle-fg',
      bgLight: 'bg-notice-subtle',
      borderColor: 'border-blue-500',
      description: t('docTriage.esi5_description'),
      wait: t('docTriage.esi5_wait'),
      examples: t('docTriage.esi5_examples'),
    },
  ];

  const [activeTab, setActiveTab] = useState<'new' | 'queue'>('new');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  
  // Triage form state
  const [selectedESI, setSelectedESI] = useState<number | null>(null);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [notes, setNotes] = useState('');
  const [vitalSigns, setVitalSigns] = useState<VitalSigns>({
    heart_rate: null,
    respiratory_rate: null,
    bp_systolic: null,
    bp_diastolic: null,
    temperature_celsius: null,
    oxygen_saturation: null,
    pain_scale: null,
    gcs_score: null,
    blood_glucose: null,
    weight_kg: null,
  });
  
  // Triage queue state
  const [triageQueue, setTriageQueue] = useState<TriageAssessment[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [apiConnected, setApiConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // Fetch patients
  useEffect(() => {
    if (!user) return;
    
    const fetchPatients = async () => {
      try {
        const response = await fetch(apiUrl('/api/patients'), {
          headers: { 
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
          },
        });
        if (response.ok) {
          const data = await response.json();
          const patientArray = Array.isArray(data) ? data : (data.data || []);
          setPatients(patientArray);
          setApiConnected(true);
        }
      } catch (err) {
        console.error('Failed to fetch patients:', err);
        setApiConnected(false);
      }
    };
    fetchPatients();
  }, [user]);

  // Fetch triage queue
  useEffect(() => {
    if (!user) return;
    if (activeTab !== 'queue') return;
    
    const fetchTriageQueue = async () => {
      setLoading(true);
      try {
        const response = await fetch(apiUrl('/api/clinical/triage/queue'), {
          headers: { 
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
          },
        });
        if (response.ok) {
          const data = await response.json();
          // The API returns `{ queue, total, success }` (GET
          // /api/clinical/triage/queue, api/src/handlers/triage.rs). This read
          // `data.assessments`, a key the server never sends, so the triage
          // queue rendered empty in production no matter how many patients were
          // waiting. The old unit test mocked a third shape (`triage_queue`),
          // so it agreed with neither and never caught it.
          setTriageQueue(data.queue || data.assessments || []);
        }
      } catch (err) {
        console.error('Failed to fetch triage queue:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchTriageQueue();
  }, [activeTab, user?.userId]);

  // Filter patients based on search
  const filteredPatients = patients.filter(p =>
    (p.full_name?.toLowerCase() || '').includes(patientSearch.toLowerCase()) ||
    (p.patient_id?.toLowerCase() || '').includes(patientSearch.toLowerCase()) ||
    (p.health_id?.toLowerCase() || '').includes(patientSearch.toLowerCase())
  );

  // Check for critical vital signs
  const hasCriticalVitals = (): boolean => {
    const { heart_rate, respiratory_rate, bp_systolic, temperature_celsius, oxygen_saturation, gcs_score } = vitalSigns;
    if (heart_rate && (heart_rate < 40 || heart_rate > 150)) return true;
    if (respiratory_rate && (respiratory_rate < 8 || respiratory_rate > 35)) return true;
    if (bp_systolic && (bp_systolic < 80 || bp_systolic > 220)) return true;
    if (temperature_celsius && (temperature_celsius < 35 || temperature_celsius > 40)) return true;
    if (oxygen_saturation && oxygen_saturation < 90) return true;
    if (gcs_score && gcs_score < 9) return true;
    return false;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedPatientId) {
      setError(t('docTriage.errorSelectPatient'));
      return;
    }
    if (selectedESI === null) {
      setError(t('docTriage.errorSelectESI'));
      return;
    }
    if (!chiefComplaint.trim()) {
      setError(t('docTriage.errorChiefComplaint'));
      return;
    }
    
    if (!user) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(apiUrl('/api/clinical/triage'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify({
          patient_id: selectedPatientId,
          esi_level: selectedESI,
          chief_complaint: chiefComplaint,
          vital_signs: vitalSigns,
          pain_scale: vitalSigns.pain_scale,
          notes: notes || null,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(t('docTriage.successMessage', { id: data.assessment_id, level: data.esi_level, wait: data.expected_wait }));
        // Reset form
        setSelectedPatientId('');
        setPatientSearch('');
        setSelectedESI(null);
        setChiefComplaint('');
        setNotes('');
        setVitalSigns({
          heart_rate: null,
          respiratory_rate: null,
          bp_systolic: null,
          bp_diastolic: null,
          temperature_celsius: null,
          oxygen_saturation: null,
          pain_scale: null,
          gcs_score: null,
          blood_glucose: null,
          weight_kg: null,
        });
      } else {
        setError(getApiErrorMessage(data, t('docTriage.errorCreateFailed')));
      }
    } catch (err) {
      setError(t('docTriage.errorConnection'));
    } finally {
      setSubmitting(false);
    }
  };

  // Update vital sign helper
  const updateVitalSign = (field: keyof VitalSigns, value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    setVitalSigns(prev => ({ ...prev, [field]: numValue }));
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content flex items-center gap-2">
            <AlertTriangle className="text-orange-500" />
            {t('docTriage.title')}
          </h1>
          <p className="text-content-muted mt-1">
            {t('docTriage.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            apiConnected ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-critical-subtle text-critical-subtle-fg'
          }`}>
            <span className={`w-2 h-2 rounded-full ${apiConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            {apiConnected ? t('docTriage.apiConnected') : t('docTriage.apiDisconnected')}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface-sunken p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('new')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'new'
              ? 'bg-surface text-content shadow-sm'
              : 'text-content-muted hover:text-content'
          }`}
        >
          <Plus size={16} className="inline mr-1" />
          {t('docTriage.tabNewAssessment')}
        </button>
        <button
          onClick={() => setActiveTab('queue')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'queue'
              ? 'bg-surface text-content shadow-sm'
              : 'text-content-muted hover:text-content'
          }`}
        >
          <Clock size={16} className="inline mr-1" />
          {t('docTriage.tabTriageQueue')}
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-6 p-4 bg-critical-subtle border border-critical rounded-lg flex items-center gap-2 text-critical-subtle-fg">
          <AlertCircle size={20} />
          {error}
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 bg-ok-subtle border border-ok rounded-lg flex items-center gap-2 text-ok-subtle-fg">
          <CheckCircle size={20} />
          {success}
        </div>
      )}

      {activeTab === 'new' ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Patient Selection */}
          <div className="bg-surface rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
              <User size={20} />
              {t('docTriage.patientSelectionTitle')}
            </h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
              <input
                type="text"
                value={patientSearch}
                onChange={(e) => {
                  setPatientSearch(e.target.value);
                  setShowPatientDropdown(true);
                }}
                onFocus={() => setShowPatientDropdown(true)}
                placeholder={t('docTriage.searchPatientPlaceholder')}
                className="w-full pl-10 pr-4 py-3 border border-border rounded-lg focus:ring-2 focus:ring-primary-500"
              />
              {showPatientDropdown && filteredPatients.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-60 overflow-auto">
                  {filteredPatients.slice(0, 10).map((patient) => (
                    <button
                      key={patient.patient_id}
                      type="button"
                      onClick={() => {
                        setSelectedPatientId(patient.patient_id);
                        setPatientSearch(patient.full_name);
                        setShowPatientDropdown(false);
                      }}
                      className={`w-full text-left px-4 py-3 hover:bg-surface-sunken border-b border-border last:border-0 ${
                        selectedPatientId === patient.patient_id ? 'bg-brand-subtle' : ''
                      }`}
                    >
                      <p className="font-medium text-content">{patient.full_name}</p>
                      <p className="text-sm text-content-muted">
                        {patient.patient_id} • {t('docTriage.healthIdPrefix', { id: patient.health_id })}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedPatientId && (
              <p className="mt-2 text-sm text-ok-subtle-fg flex items-center gap-1">
                <CheckCircle size={16} />
                {t('docTriage.patientSelected', { id: selectedPatientId })}
              </p>
            )}
          </div>

          {/* ESI Level Selection */}
          <div className="bg-surface rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
              <AlertTriangle size={20} />
              {t('docTriage.esiLevelTitle')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {ESI_LEVELS.map((esi) => (
                <button
                  key={esi.level}
                  type="button"
                  onClick={() => setSelectedESI(esi.level)}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    selectedESI === esi.level
                      ? `${esi.borderColor} ${esi.bgLight}`
                      : 'border-border hover:border-border-strong'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-8 h-8 rounded-full ${esi.color} text-white flex items-center justify-center font-bold`}>
                      {esi.level}
                    </span>
                    <span className={`font-semibold ${esi.textColor}`}>{esi.name}</span>
                  </div>
                  <p className="text-xs text-content-muted mb-1">{esi.description}</p>
                  <p className="text-xs text-content-muted flex items-center gap-1">
                    <Clock size={12} />
                    {esi.wait}
                  </p>
                </button>
              ))}
            </div>
            {selectedESI !== null && (
              <div className={`mt-4 p-3 rounded-lg ${ESI_LEVELS[selectedESI - 1].bgLight}`}>
                <p className="text-sm text-content-secondary">
                  <strong>{t('docTriage.examplesLabel')}</strong> {ESI_LEVELS[selectedESI - 1].examples}
                </p>
              </div>
            )}
          </div>

          {/* Chief Complaint */}
          <div className="bg-surface rounded-xl shadow p-6">
            {/* A heading is not a label: this required field had no
                accessible name at all, so a screen reader announced an unnamed
                text box — unlike every other field on this form, which uses
                `<label htmlFor>`. Kept as a heading visually, bound properly. */}
            <label
              htmlFor="triage-chief-complaint"
              className="block text-lg font-semibold text-content mb-4"
            >
              {t('docTriage.chiefComplaintTitle')}
            </label>
            <textarea
              id="triage-chief-complaint"
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder={t('docTriage.chiefComplaintPlaceholder')}
              rows={3}
              className="w-full px-4 py-3 border border-border rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>

          {/* Vital Signs */}
          <div className="bg-surface rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
              <Activity size={20} />
              {t('docTriage.vitalSignsTitle')}
              {hasCriticalVitals() && (
                <span className="ml-2 px-2 py-1 bg-critical-subtle text-critical-subtle-fg text-xs font-medium rounded-full animate-pulse">
                  {t('docTriage.criticalValuesDetected')}
                </span>
              )}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Heart Rate */}
              <div>
                <label htmlFor="triage-heart-rate" className="flex text-sm font-medium text-content-secondary mb-1 items-center gap-1">
                  <Heart size={14} className="text-red-500" />
                  {t('docTriage.heartRateLabel')}
                </label>
                <input
                  id="triage-heart-rate"
                  type="number"
                  value={vitalSigns.heart_rate ?? ''}
                  onChange={(e) => updateVitalSign('heart_rate', e.target.value)}
                  placeholder="60-100"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.heart_rate && (vitalSigns.heart_rate < 40 || vitalSigns.heart_rate > 150)
                      ? 'border-red-500 bg-critical-subtle'
                      : 'border-border'
                  }`}
                />
              </div>
              
              {/* Respiratory Rate */}
              <div>
                <label htmlFor="triage-respiratory-rate" className="flex text-sm font-medium text-content-secondary mb-1 items-center gap-1">
                  <Wind size={14} className="text-blue-500" />
                  {t('docTriage.respRateLabel')}
                </label>
                <input
                  id="triage-respiratory-rate"
                  type="number"
                  value={vitalSigns.respiratory_rate ?? ''}
                  onChange={(e) => updateVitalSign('respiratory_rate', e.target.value)}
                  placeholder="12-20"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.respiratory_rate && (vitalSigns.respiratory_rate < 8 || vitalSigns.respiratory_rate > 35)
                      ? 'border-red-500 bg-critical-subtle'
                      : 'border-border'
                  }`}
                />
              </div>
              
              {/* Blood Pressure */}
              <div>
                <label htmlFor="triage-bp-systolic" className="flex text-sm font-medium text-content-secondary mb-1 items-center gap-1">
                  <Activity size={14} className="text-purple-500" />
                  {t('docTriage.bpSystolicLabel')}
                </label>
                <input
                  id="triage-bp-systolic"
                  type="number"
                  value={vitalSigns.bp_systolic ?? ''}
                  onChange={(e) => updateVitalSign('bp_systolic', e.target.value)}
                  placeholder="90-120"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.bp_systolic && (vitalSigns.bp_systolic < 80 || vitalSigns.bp_systolic > 220)
                      ? 'border-red-500 bg-critical-subtle'
                      : 'border-border'
                  }`}
                />
              </div>
              
              <div>
                <label htmlFor="triage-bp-diastolic" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docTriage.bpDiastolicLabel')}
                </label>
                <input
                  id="triage-bp-diastolic"
                  type="number"
                  value={vitalSigns.bp_diastolic ?? ''}
                  onChange={(e) => updateVitalSign('bp_diastolic', e.target.value)}
                  placeholder="60-80"
                  className="w-full px-3 py-2 border border-border rounded-lg"
                />
              </div>
              
              {/* Temperature */}
              <div>
                <label htmlFor="triage-temperature" className="flex text-sm font-medium text-content-secondary mb-1 items-center gap-1">
                  <Thermometer size={14} className="text-orange-500" />
                  {t('docTriage.temperatureLabel')}
                </label>
                <input
                  id="triage-temperature"
                  type="number"
                  step="0.1"
                  value={vitalSigns.temperature_celsius ?? ''}
                  onChange={(e) => updateVitalSign('temperature_celsius', e.target.value)}
                  placeholder="36.1-37.2"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.temperature_celsius && (vitalSigns.temperature_celsius < 35 || vitalSigns.temperature_celsius > 40)
                      ? 'border-red-500 bg-critical-subtle'
                      : 'border-border'
                  }`}
                />
              </div>
              
              {/* O2 Saturation */}
              <div>
                <label htmlFor="triage-oxygen-saturation" className="flex text-sm font-medium text-content-secondary mb-1 items-center gap-1">
                  <Droplet size={14} className="text-cyan-500" />
                  {t('docTriage.o2SatLabel')}
                </label>
                <input
                  id="triage-oxygen-saturation"
                  type="number"
                  value={vitalSigns.oxygen_saturation ?? ''}
                  onChange={(e) => updateVitalSign('oxygen_saturation', e.target.value)}
                  placeholder="95-100"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.oxygen_saturation && vitalSigns.oxygen_saturation < 90
                      ? 'border-red-500 bg-critical-subtle'
                      : 'border-border'
                  }`}
                />
              </div>
              
              {/* Pain Scale */}
              <div>
                <label htmlFor="triage-pain-scale" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docTriage.painScaleLabel')}
                </label>
                <input
                  id="triage-pain-scale"
                  type="number"
                  min="0"
                  max="10"
                  value={vitalSigns.pain_scale ?? ''}
                  onChange={(e) => updateVitalSign('pain_scale', e.target.value)}
                  placeholder="0-10"
                  className="w-full px-3 py-2 border border-border rounded-lg"
                />
              </div>
              
              {/* GCS */}
              <div>
                <label htmlFor="triage-gcs-score" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docTriage.gcsLabel')}
                </label>
                <input
                  id="triage-gcs-score"
                  type="number"
                  min="3"
                  max="15"
                  value={vitalSigns.gcs_score ?? ''}
                  onChange={(e) => updateVitalSign('gcs_score', e.target.value)}
                  placeholder={t('docTriage.gcsPlaceholder')}
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.gcs_score && vitalSigns.gcs_score < 9
                      ? 'border-red-500 bg-critical-subtle'
                      : 'border-border'
                  }`}
                />
              </div>
              
              {/* Blood Glucose */}
              <div>
                <label htmlFor="triage-blood-glucose" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docTriage.bloodGlucoseLabel')}
                </label>
                <input
                  id="triage-blood-glucose"
                  type="number"
                  value={vitalSigns.blood_glucose ?? ''}
                  onChange={(e) => updateVitalSign('blood_glucose', e.target.value)}
                  placeholder="70-100"
                  className="w-full px-3 py-2 border border-border rounded-lg"
                />
              </div>
              
              {/* Weight */}
              <div>
                <label htmlFor="triage-weight" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docTriage.weightLabel')}
                </label>
                <input
                  id="triage-weight"
                  type="number"
                  step="0.1"
                  value={vitalSigns.weight_kg ?? ''}
                  onChange={(e) => updateVitalSign('weight_kg', e.target.value)}
                  placeholder={t('docTriage.weightPlaceholder')}
                  className="w-full px-3 py-2 border border-border rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-surface rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-content mb-4">{t('docTriage.notesTitle')}</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('docTriage.notesPlaceholder')}
              rows={3}
              className="w-full px-4 py-3 border border-border rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Submit Button */}
          <div className="flex justify-end gap-4">
            <Link
              to="/dashboard"
              className="px-6 py-3 border border-border rounded-lg hover:bg-surface-sunken transition-colors"
            >
              {t('docTriage.cancel')}
            </Link>
            <button
              type="submit"
              disabled={submitting || !selectedPatientId || selectedESI === null || !chiefComplaint.trim()}
              className="px-6 py-3 bg-brand text-brand-fg rounded-lg hover:bg-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  {t('docTriage.creatingAssessment')}
                </>
              ) : (
                <>
                  <CheckCircle size={20} />
                  {t('docTriage.completeTriageAssessment')}
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        /* Triage Queue Tab */
        <div className="bg-surface rounded-xl shadow">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold text-content">{t('docTriage.currentQueueTitle')}</h2>
            <p className="text-sm text-content-muted">{t('docTriage.queueSubtitle')}</p>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="mx-auto mb-3 text-primary-500 animate-spin" size={48} />
              <p className="text-content-muted">{t('docTriage.loadingQueue')}</p>
            </div>
          ) : triageQueue.length > 0 ? (
            <div className="divide-y divide-border">
              {triageQueue
                .sort((a, b) => {
                  const levelA = typeof a.esi_level === 'object' ? a.esi_level.level : a.esi_level;
                  const levelB = typeof b.esi_level === 'object' ? b.esi_level.level : b.esi_level;
                  return levelA - levelB;
                })
                .map((assessment) => {
                  const level = typeof assessment.esi_level === 'object' 
                    ? assessment.esi_level.level 
                    : assessment.esi_level;
                  const esiConfig = ESI_LEVELS[level - 1];
                  const patient = patients.find(p => p.patient_id === assessment.patient_id);
                  
                  return (
                    <Link
                      key={assessment.assessment_id}
                      to={`/patients/${assessment.patient_id}`}
                      className="flex items-center justify-between p-4 hover:bg-surface-sunken transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <span className={`w-10 h-10 rounded-full ${esiConfig?.color || 'bg-gray-500'} text-white flex items-center justify-center font-bold`}>
                          {level}
                        </span>
                        <div>
                          <p className="font-medium text-content">
                            {patient?.full_name || assessment.patient_id}
                          </p>
                          <p className="text-sm text-content-muted">{assessment.chief_complaint}</p>
                          <p className="text-xs text-content-muted mt-1">
                            {new Date(assessment.performed_at * 1000).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${esiConfig?.bgLight} ${esiConfig?.textColor}`}>
                            {t('docTriage.esiBadge', { level, name: esiConfig?.name })}
                          </span>
                          <p className="text-xs text-content-muted mt-1">{esiConfig?.wait}</p>
                        </div>
                        <ChevronRight className="text-gray-300" size={20} />
                      </div>
                    </Link>
                  );
                })}
            </div>
          ) : (
            <div className="p-12 text-center">
              <Clock className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-content-muted">{t('docTriage.noPatientsInQueue')}</p>
              <button
                onClick={() => setActiveTab('new')}
                className="mt-4 px-4 py-2 bg-brand text-brand-fg rounded-lg hover:bg-brand transition-colors"
              >
                {t('docTriage.startNewTriage')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TriagePage;
