import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  FlaskConical,
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
  Calendar,
} from 'lucide-react';

interface LabResult {
  submission_id?: string;
  id?: string;
  test_name: string;
  ordered_date?: string;
  result_date?: string;
  resulted_at?: string;
  value?: string | number;
  result_value?: string | number;
  unit?: string;
  reference_range?: string;
  normal_range?: string;
  status?: string;
  result_status?: string;
  is_abnormal?: boolean;
  is_critical?: boolean;
  notes?: string;
}

/**
 * LabResultsPage - View patient lab test results
 *
 * Features:
 * - Full lab results history
 * - Shows test name, dates, value, reference range, status
 * - Highlights critical values in red
 *
 * © 2025 Trustware. All rights reserved.
 */
export function LabResultsPage() {
  const navigate = useNavigate();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [results, setResults] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    if (patient) {
      loadResults();
    }
  }, [patient]);

  const loadResults = async () => {
    if (!patient) return;
    setLoading(true);
    try {
      const response = await fetch(apiUrl(`/api/lab/patient/${patient.healthId}`), {
        headers: {
          'X-User-Id': patient.walletAddress,
          'X-Health-Id': patient.healthId,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setResults(data.results || data.submissions || data.lab_results || []);
        setApiConnected(true);
      } else {
        setApiConnected(false);
        setResults([]);
      }
    } catch (err) {
      console.error('Failed to load lab results:', err);
      setApiConnected(false);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const isCritical = (r: LabResult) =>
    r.is_critical || r.result_status === 'critical' || r.status === 'critical';
  const isAbnormal = (r: LabResult) =>
    r.is_abnormal || r.result_status === 'abnormal' || r.status === 'abnormal';
  const isNormal = (r: LabResult) =>
    !isCritical(r) && (r.result_status === 'normal' || r.status === 'normal' || (!r.is_abnormal && !r.is_critical));

  const getStatusBadge = (r: LabResult) => {
    if (isCritical(r)) {
      return (
        <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">
          <AlertTriangle className="w-3 h-3" />
          Critical
        </span>
      );
    }
    if (isAbnormal(r)) {
      return (
        <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
          <AlertTriangle className="w-3 h-3" />
          Abnormal
        </span>
      );
    }
    if (isNormal(r)) {
      return (
        <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
          <CheckCircle className="w-3 h-3" />
          Normal
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-600">
        <Clock className="w-3 h-3" />
        Pending
      </span>
    );
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const displayValue = (r: LabResult) => {
    const val = r.result_value ?? r.value;
    if (val == null) return '—';
    return `${val}${r.unit ? ` ${r.unit}` : ''}`;
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Lab Results</h1>
          <p className="text-neutral-500">Your test results and reports</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? 'Live' : 'Demo'}
          </span>
          <button
            onClick={loadResults}
            className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Critical Values Alert */}
      {results.some(isCritical) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-red-800">Critical Values Detected</p>
            <p className="text-sm text-red-700">
              You have critical lab values. Please contact your healthcare provider immediately.
            </p>
          </div>
        </div>
      )}

      {/* Results List */}
      {results.length === 0 ? (
        <div className="text-center py-12">
          <FlaskConical className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
          <p className="text-neutral-500">No lab results found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {results.map((r, idx) => (
            <div
              key={r.submission_id || r.id || idx}
              className={`patient-card ${isCritical(r) ? 'border-l-4 border-l-red-500' : isAbnormal(r) ? 'border-l-4 border-l-yellow-400' : ''}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    isCritical(r) ? 'bg-red-100' : isAbnormal(r) ? 'bg-yellow-100' : 'bg-primary-100'
                  }`}>
                    <FlaskConical className={`w-5 h-5 ${
                      isCritical(r) ? 'text-red-600' : isAbnormal(r) ? 'text-yellow-600' : 'text-primary-600'
                    }`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-neutral-900">{r.test_name}</h3>
                    <div className="flex items-center gap-3 text-xs text-neutral-400 mt-0.5">
                      {r.ordered_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Ordered: {formatDate(r.ordered_date)}
                        </span>
                      )}
                      {(r.result_date || r.resulted_at) && (
                        <span className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Resulted: {formatDate(r.result_date || r.resulted_at)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {getStatusBadge(r)}
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-neutral-50 rounded-lg p-2">
                  <p className="text-xs text-neutral-400">Result</p>
                  <p className={`font-semibold ${isCritical(r) ? 'text-red-700' : 'text-neutral-900'}`}>
                    {displayValue(r)}
                  </p>
                </div>
                {(r.reference_range || r.normal_range) && (
                  <div className="bg-neutral-50 rounded-lg p-2">
                    <p className="text-xs text-neutral-400">Reference Range</p>
                    <p className="font-medium text-neutral-700">{r.reference_range || r.normal_range}</p>
                  </div>
                )}
              </div>

              {r.notes && (
                <p className="text-xs text-neutral-500 mt-2 italic">{r.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
