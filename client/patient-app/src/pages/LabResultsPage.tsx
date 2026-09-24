import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPatientLabSubmissions, useTranslation, formatTimestamp } from '@medichain/shared';
import type { LabResultSubmission } from '@medichain/shared';
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
 * Flatten each approved laboratory submission into the measurements the
 * patient can actually read. The submission is the review/audit unit; each
 * analyser result is the clinically meaningful line in this screen.
 */
function patientResultsFromSubmissions(submissions: LabResultSubmission[]): LabResult[] {
  return submissions.flatMap((submission) =>
    submission.results.map((result, index) => {
      const flag = result.flag?.toLowerCase();
      return {
        id: `${submission.id}:${index}`,
        test_name: `${submission.test_name} — ${result.parameter}`,
        resulted_at: submission.reviewed_at ?? submission.submitted_at,
        result_value: result.value,
        unit: result.unit,
        normal_range: result.reference_range,
        status: flag === 'normal' || !flag ? 'normal' : 'abnormal',
        is_abnormal: Boolean(flag && flag !== 'normal'),
        is_critical: Boolean(flag?.startsWith('critical')),
        notes: submission.notes || undefined,
      };
    })
  );
}

/**
 * LabResultsPage - View patient lab test results
 *
 * Features:
 * - Full lab results history
 * - Shows test name, dates, value, reference range, status
 * - Highlights critical values in red
 *
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function LabResultsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [results, setResults] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  const loadResults = useCallback(async () => {
    if (!patient) return;
    setLoading(true);
    try {
      const submissions = await getPatientLabSubmissions(patient.healthId);
      setResults(patientResultsFromSubmissions(submissions));
      setApiConnected(true);
    } catch (err) {
      console.error('Failed to load lab results:', err);
      setApiConnected(false);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [patient]);

  useEffect(() => {
    if (patient) {
      loadResults();
    }
  }, [patient, loadResults]);

  const isCritical = (r: LabResult) =>
    r.is_critical || r.result_status === 'critical' || r.status === 'critical';
  const isAbnormal = (r: LabResult) =>
    r.is_abnormal || r.result_status === 'abnormal' || r.status === 'abnormal';
  const isNormal = (r: LabResult) =>
    !isCritical(r) && (r.result_status === 'normal' || r.status === 'normal' || (!r.is_abnormal && !r.is_critical));

  const getStatusBadge = (r: LabResult) => {
    if (isCritical(r)) {
      return (
        <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-critical-subtle text-critical-subtle-fg">
          <AlertTriangle className="w-3 h-3" />
          {t('labResults.statusCritical')}
        </span>
      );
    }
    if (isAbnormal(r)) {
      return (
        <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-caution-subtle text-caution-subtle-fg">
          <AlertTriangle className="w-3 h-3" />
          {t('labResults.statusAbnormal')}
        </span>
      );
    }
    if (isNormal(r)) {
      return (
        <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-ok-subtle text-ok-subtle-fg">
          <CheckCircle className="w-3 h-3" />
          {t('labResults.statusNormal')}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-surface-sunken text-content-muted">
        <Clock className="w-3 h-3" />
        {t('labResults.statusPending')}
      </span>
    );
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return formatTimestamp(dateStr, {
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
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content">{t('labResults.title')}</h1>
          <p className="text-content-muted">{t('labResults.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? t('common.live') : t('common.demo')}
          </span>
          <button
            onClick={loadResults}
            className="p-2 text-content-muted hover:bg-surface-sunken rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Critical Values Alert */}
      {results.some(isCritical) && (
        <div className="bg-critical-subtle border border-critical rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-critical-subtle-fg mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-critical-subtle-fg">{t('labResults.criticalTitle')}</p>
            <p className="text-sm text-critical-subtle-fg">
              {t('labResults.criticalBody')}
            </p>
          </div>
        </div>
      )}

      {/* Results List */}
      {results.length === 0 ? (
        <div className="text-center py-12">
          <FlaskConical className="w-12 h-12 text-content-muted mx-auto mb-3" />
          <p className="text-content-muted">{t('labResults.noResults')}</p>
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
                    isCritical(r) ? 'bg-critical-subtle' : isAbnormal(r) ? 'bg-caution-subtle' : 'bg-brand-subtle'
                  }`}>
                    <FlaskConical className={`w-5 h-5 ${
                      isCritical(r) ? 'text-critical-subtle-fg' : isAbnormal(r) ? 'text-caution-subtle-fg' : 'text-brand'
                    }`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-content">{r.test_name}</h3>
                    <div className="flex items-center gap-3 text-xs text-content-muted mt-0.5">
                      {r.ordered_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {t('labResults.orderedOn', { date: formatDate(r.ordered_date) })}
                        </span>
                      )}
                      {(r.result_date || r.resulted_at) && (
                        <span className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          {t('labResults.resultedOn', { date: formatDate(r.result_date || r.resulted_at) })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {getStatusBadge(r)}
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-surface-sunken rounded-lg p-2">
                  <p className="text-xs text-content-muted">{t('labResults.result')}</p>
                  <p className={`font-semibold ${isCritical(r) ? 'text-critical-subtle-fg' : 'text-content'}`}>
                    {displayValue(r)}
                  </p>
                </div>
                {(r.reference_range || r.normal_range) && (
                  <div className="bg-surface-sunken rounded-lg p-2">
                    <p className="text-xs text-content-muted">{t('labResults.referenceRange')}</p>
                    <p className="font-medium text-content-secondary">{r.reference_range || r.normal_range}</p>
                  </div>
                )}
              </div>

              {r.notes && (
                <p className="text-xs text-content-muted mt-2 italic">{r.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
