import { useState, useEffect } from 'react';
import { useAuthStore, usePatientStore } from '../store';
import { apiUrl } from '@medichain/shared';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  Heart,
  Thermometer,
  Wind,
  Droplet,
  Plus,
  Search,
  AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  CheckCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface VitalReading {
  reading_id: string;
  patient_id: string;
  recorded_at: string;
  recorded_by: string;
  heart_rate: number | null;
  respiratory_rate: number | null;
  blood_pressure_systolic: number | null;
  blood_pressure_diastolic: number | null;
  temperature_celsius: number | null;
  oxygen_saturation: number | null;
  pain_scale: number | null;
  gcs_total: number | null;
  blood_glucose: number | null;
  weight_kg: number | null;
  notes?: string;
}

interface VitalFlowsheet {
  patient_id: string;
  patient_name: string;
  readings: VitalReading[];
}

// Normal ranges for vitals
const VITAL_RANGES = {
  heart_rate: { min: 60, max: 100, unit: 'bpm', label: 'Heart Rate' },
  respiratory_rate: { min: 12, max: 20, unit: '/min', label: 'Resp Rate' },
  bp_systolic: { min: 90, max: 140, unit: 'mmHg', label: 'Systolic BP' },
  bp_diastolic: { min: 60, max: 90, unit: 'mmHg', label: 'Diastolic BP' },
  temperature: { min: 36.1, max: 37.8, unit: '°C', label: 'Temperature' },
  oxygen_saturation: { min: 95, max: 100, unit: '%', label: 'SpO2' },
  pain_scale: { min: 0, max: 3, unit: '/10', label: 'Pain' },
  gcs: { min: 15, max: 15, unit: '', label: 'GCS' },
  blood_glucose: { min: 70, max: 140, unit: 'mg/dL', label: 'Glucose' },
};

function isAbnormal(value: number | null, type: keyof typeof VITAL_RANGES): boolean {
  if (value === null) return false;
  const range = VITAL_RANGES[type];
  return value < range.min || value > range.max;
}

function isCritical(value: number | null, type: keyof typeof VITAL_RANGES): boolean {
  if (value === null) return false;
  const criticalRanges: Record<string, { min: number; max: number }> = {
    heart_rate: { min: 40, max: 150 },
    respiratory_rate: { min: 8, max: 30 },
    bp_systolic: { min: 70, max: 180 },
    oxygen_saturation: { min: 88, max: 100 },
    gcs: { min: 9, max: 15 },
    blood_glucose: { min: 50, max: 400 },
  };
  const range = criticalRanges[type];
  if (!range) return false;
  return value < range.min || value > range.max;
}

function getTrend(current: number | null, previous: number | null): 'up' | 'down' | 'stable' | null {
  if (current === null || previous === null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 1) return 'stable';
  return diff > 0 ? 'up' : 'down';
}

function VitalSignsPage() {
  const [searchParams] = useSearchParams();
  const patientIdFromUrl = searchParams.get('patientId');
  const navigate = useNavigate();
  
  const { user, isAuthenticated } = useAuthStore();
  const { recentPatients } = usePatientStore();
  
  const [selectedPatientId, setSelectedPatientId] = useState(patientIdFromUrl || '');
  const [flowsheet, setFlowsheet] = useState<VitalFlowsheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  
  // New vital signs form
  const [newVitals, setNewVitals] = useState({
    heart_rate: '',
    respiratory_rate: '',
    bp_systolic: '',
    bp_diastolic: '',
    temperature: '',
    oxygen_saturation: '',
    pain_scale: '',
    gcs_total: '',
    blood_glucose: '',
    weight_kg: '',
    notes: '',
  });

  // Auth redirect
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // Fetch flowsheet when patient is selected
  useEffect(() => {
    if (!selectedPatientId || !user) {
      setFlowsheet(null);
      return;
    }

    const fetchFlowsheet = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          apiUrl(`/api/clinical/vitals/flowsheet/${selectedPatientId}`),
          {
            headers: { 
              'X-User-Id': user.walletAddress,
              'X-Provider-Role': user.role,
            },
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch vital signs flowsheet');
        }

        const data = await response.json();
        setFlowsheet(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading flowsheet');
      } finally {
        setLoading(false);
      }
    };

    fetchFlowsheet();
  }, [selectedPatientId, user]);

  const handleSubmitVitals = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId || !user) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        patient_id: selectedPatientId,
        heart_rate: newVitals.heart_rate ? Number(newVitals.heart_rate) : null,
        respiratory_rate: newVitals.respiratory_rate ? Number(newVitals.respiratory_rate) : null,
        blood_pressure_systolic: newVitals.bp_systolic ? Number(newVitals.bp_systolic) : null,
        blood_pressure_diastolic: newVitals.bp_diastolic ? Number(newVitals.bp_diastolic) : null,
        temperature_celsius: newVitals.temperature ? Number(newVitals.temperature) : null,
        oxygen_saturation: newVitals.oxygen_saturation ? Number(newVitals.oxygen_saturation) : null,
        pain_scale: newVitals.pain_scale ? Number(newVitals.pain_scale) : null,
        gcs_total: newVitals.gcs_total ? Number(newVitals.gcs_total) : null,
        blood_glucose: newVitals.blood_glucose ? Number(newVitals.blood_glucose) : null,
        weight_kg: newVitals.weight_kg ? Number(newVitals.weight_kg) : null,
        notes: newVitals.notes || null,
      };

      const response = await fetch(apiUrl('/api/clinical/vitals/record'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to record vital signs');
      }

      setSuccess('Vital signs recorded successfully');
      setShowForm(false);
      setNewVitals({
        heart_rate: '',
        respiratory_rate: '',
        bp_systolic: '',
        bp_diastolic: '',
        temperature: '',
        oxygen_saturation: '',
        pain_scale: '',
        gcs_total: '',
        blood_glucose: '',
        weight_kg: '',
        notes: '',
      });

      // Refresh flowsheet
      const refreshResponse = await fetch(
        apiUrl(`/api/clinical/vitals/flowsheet/${selectedPatientId}`),
        { 
          headers: { 
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
          } 
        }
      );
      if (refreshResponse.ok) {
        setFlowsheet(await refreshResponse.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error recording vitals');
    } finally {
      setSubmitting(false);
    }
  };

  const lastReading = flowsheet?.readings?.[0];
  const previousReading = flowsheet?.readings?.[1];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Activity className="text-primary-600" size={28} />
            Vital Signs Flowsheet
          </h1>
          <p className="text-gray-500 mt-1">Record and monitor patient vital signs over time</p>
        </div>
        <Link
          to="/dashboard"
          className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Patient Selection */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Patient
        </label>
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <select
              value={selectedPatientId}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 appearance-none"
            >
              <option value="">Select a patient...</option>
              {recentPatients.map((patient) => (
                <option key={patient.patientId} value={patient.patientId}>
                  {patient.fullName} ({patient.patientId})
                </option>
              ))}
            </select>
          </div>
          {selectedPatientId && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2"
            >
              <Plus size={20} />
              Record Vitals
            </button>
          )}
        </div>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
          <CheckCircle className="text-green-600" size={20} />
          <span className="text-green-800">{success}</span>
        </div>
      )}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertTriangle className="text-red-600" size={20} />
          <span className="text-red-800">{error}</span>
        </div>
      )}

      {/* New Vitals Form */}
      {showForm && selectedPatientId && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Record New Vital Signs</h2>
          <form onSubmit={handleSubmitVitals}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Heart className="inline mr-1" size={14} />
                  Heart Rate (bpm)
                </label>
                <input
                  type="number"
                  value={newVitals.heart_rate}
                  onChange={(e) => setNewVitals({ ...newVitals, heart_rate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="60-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Wind className="inline mr-1" size={14} />
                  Resp Rate (/min)
                </label>
                <input
                  type="number"
                  value={newVitals.respiratory_rate}
                  onChange={(e) => setNewVitals({ ...newVitals, respiratory_rate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="12-20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  BP Systolic (mmHg)
                </label>
                <input
                  type="number"
                  value={newVitals.bp_systolic}
                  onChange={(e) => setNewVitals({ ...newVitals, bp_systolic: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="90-140"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  BP Diastolic (mmHg)
                </label>
                <input
                  type="number"
                  value={newVitals.bp_diastolic}
                  onChange={(e) => setNewVitals({ ...newVitals, bp_diastolic: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="60-90"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Thermometer className="inline mr-1" size={14} />
                  Temperature (°C)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={newVitals.temperature}
                  onChange={(e) => setNewVitals({ ...newVitals, temperature: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="36.1-37.8"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Droplet className="inline mr-1" size={14} />
                  SpO2 (%)
                </label>
                <input
                  type="number"
                  value={newVitals.oxygen_saturation}
                  onChange={(e) => setNewVitals({ ...newVitals, oxygen_saturation: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="95-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Pain Scale (0-10)
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={newVitals.pain_scale}
                  onChange={(e) => setNewVitals({ ...newVitals, pain_scale: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="0-10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  GCS Score (3-15)
                </label>
                <input
                  type="number"
                  min="3"
                  max="15"
                  value={newVitals.gcs_total}
                  onChange={(e) => setNewVitals({ ...newVitals, gcs_total: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="15"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Blood Glucose (mg/dL)
                </label>
                <input
                  type="number"
                  value={newVitals.blood_glucose}
                  onChange={(e) => setNewVitals({ ...newVitals, blood_glucose: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="70-140"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Weight (kg)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={newVitals.weight_kg}
                  onChange={(e) => setNewVitals({ ...newVitals, weight_kg: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="kg"
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={newVitals.notes}
                onChange={(e) => setNewVitals({ ...newVitals, notes: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                rows={2}
                placeholder="Additional observations..."
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
              >
                {submitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle size={18} />}
                Save Vitals
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Loader2 className="mx-auto mb-3 text-primary-500 animate-spin" size={48} />
          <p className="text-gray-500">Loading vital signs...</p>
        </div>
      )}

      {/* Current Vitals Summary */}
      {!loading && flowsheet && lastReading && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Latest Vital Signs</h2>
            <span className="text-sm text-gray-500 flex items-center gap-1">
              <Clock size={14} />
              {new Date(lastReading.recorded_at).toLocaleString()}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {/* Heart Rate */}
            <div className={`p-4 rounded-lg ${isCritical(lastReading.heart_rate, 'heart_rate') ? 'bg-red-50 border-2 border-red-300' : isAbnormal(lastReading.heart_rate, 'heart_rate') ? 'bg-yellow-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2 text-gray-600 mb-1">
                <Heart size={16} className={isCritical(lastReading.heart_rate, 'heart_rate') ? 'text-red-500' : 'text-gray-400'} />
                <span className="text-sm">Heart Rate</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{lastReading.heart_rate ?? '—'}</span>
                <span className="text-sm text-gray-500">bpm</span>
                {getTrend(lastReading.heart_rate, previousReading?.heart_rate ?? null) === 'up' && <TrendingUp size={16} className="text-red-500" />}
                {getTrend(lastReading.heart_rate, previousReading?.heart_rate ?? null) === 'down' && <TrendingDown size={16} className="text-green-500" />}
                {getTrend(lastReading.heart_rate, previousReading?.heart_rate ?? null) === 'stable' && <Minus size={16} className="text-gray-400" />}
              </div>
            </div>

            {/* Blood Pressure */}
            <div className={`p-4 rounded-lg ${isCritical(lastReading.blood_pressure_systolic, 'bp_systolic') ? 'bg-red-50 border-2 border-red-300' : isAbnormal(lastReading.blood_pressure_systolic, 'bp_systolic') ? 'bg-yellow-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2 text-gray-600 mb-1">
                <Activity size={16} className="text-gray-400" />
                <span className="text-sm">Blood Pressure</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">
                  {lastReading.blood_pressure_systolic ?? '—'}/{lastReading.blood_pressure_diastolic ?? '—'}
                </span>
                <span className="text-sm text-gray-500">mmHg</span>
              </div>
            </div>

            {/* SpO2 */}
            <div className={`p-4 rounded-lg ${isCritical(lastReading.oxygen_saturation, 'oxygen_saturation') ? 'bg-red-50 border-2 border-red-300' : isAbnormal(lastReading.oxygen_saturation, 'oxygen_saturation') ? 'bg-yellow-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2 text-gray-600 mb-1">
                <Droplet size={16} className={isCritical(lastReading.oxygen_saturation, 'oxygen_saturation') ? 'text-red-500' : 'text-gray-400'} />
                <span className="text-sm">SpO2</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{lastReading.oxygen_saturation ?? '—'}</span>
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>

            {/* Temperature */}
            <div className={`p-4 rounded-lg ${isAbnormal(lastReading.temperature_celsius, 'temperature') ? 'bg-yellow-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2 text-gray-600 mb-1">
                <Thermometer size={16} className="text-gray-400" />
                <span className="text-sm">Temperature</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{lastReading.temperature_celsius?.toFixed(1) ?? '—'}</span>
                <span className="text-sm text-gray-500">°C</span>
              </div>
            </div>

            {/* Resp Rate */}
            <div className={`p-4 rounded-lg ${isCritical(lastReading.respiratory_rate, 'respiratory_rate') ? 'bg-red-50 border-2 border-red-300' : isAbnormal(lastReading.respiratory_rate, 'respiratory_rate') ? 'bg-yellow-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2 text-gray-600 mb-1">
                <Wind size={16} className="text-gray-400" />
                <span className="text-sm">Resp Rate</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{lastReading.respiratory_rate ?? '—'}</span>
                <span className="text-sm text-gray-500">/min</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Flowsheet History */}
      {!loading && flowsheet && flowsheet.readings.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-50"
          >
            <h2 className="text-lg font-semibold text-gray-900">
              Vital Signs History ({flowsheet.readings.length} readings)
            </h2>
            {showHistory ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
          {showHistory && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-y">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Time</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">HR</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">BP</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">SpO2</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Temp</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">RR</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Pain</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">GCS</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {flowsheet.readings.map((reading) => (
                    <tr key={reading.reading_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {new Date(reading.recorded_at).toLocaleString()}
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${isCritical(reading.heart_rate, 'heart_rate') ? 'text-red-600 bg-red-50' : isAbnormal(reading.heart_rate, 'heart_rate') ? 'text-yellow-600' : ''}`}>
                        {reading.heart_rate ?? '—'}
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${isCritical(reading.blood_pressure_systolic, 'bp_systolic') ? 'text-red-600 bg-red-50' : ''}`}>
                        {reading.blood_pressure_systolic ?? '—'}/{reading.blood_pressure_diastolic ?? '—'}
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${isCritical(reading.oxygen_saturation, 'oxygen_saturation') ? 'text-red-600 bg-red-50' : isAbnormal(reading.oxygen_saturation, 'oxygen_saturation') ? 'text-yellow-600' : ''}`}>
                        {reading.oxygen_saturation ?? '—'}%
                      </td>
                      <td className={`px-4 py-3 text-center ${isAbnormal(reading.temperature_celsius, 'temperature') ? 'text-yellow-600' : ''}`}>
                        {reading.temperature_celsius?.toFixed(1) ?? '—'}°C
                      </td>
                      <td className={`px-4 py-3 text-center ${isCritical(reading.respiratory_rate, 'respiratory_rate') ? 'text-red-600 bg-red-50' : ''}`}>
                        {reading.respiratory_rate ?? '—'}
                      </td>
                      <td className={`px-4 py-3 text-center ${reading.pain_scale && reading.pain_scale > 6 ? 'text-red-600' : ''}`}>
                        {reading.pain_scale ?? '—'}/10
                      </td>
                      <td className={`px-4 py-3 text-center ${isCritical(reading.gcs_total, 'gcs') ? 'text-red-600 bg-red-50' : ''}`}>
                        {reading.gcs_total ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{reading.recorded_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* No Data State */}
      {!loading && selectedPatientId && (!flowsheet || flowsheet.readings.length === 0) && (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Activity className="mx-auto mb-3 text-gray-300" size={48} />
          <p className="text-gray-500">No vital signs recorded yet</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Record First Vitals
          </button>
        </div>
      )}

      {/* No Patient Selected */}
      {!selectedPatientId && (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Search className="mx-auto mb-3 text-gray-300" size={48} />
          <p className="text-gray-500">Select a patient to view or record vital signs</p>
        </div>
      )}
    </div>
  );
}

export default VitalSignsPage;
