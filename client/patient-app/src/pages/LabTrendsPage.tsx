import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle,
  LineChart as Loader2
} from 'lucide-react';
import { getLabTrends, useTranslation, formatDateOnly, formatTimestamp } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

/**
 * LabTrendsPage
 * 
 * Full-featured page for viewing historical lab result trends.
 * Includes interactive charts, reference ranges, and trend analysis.
 */

export type TrendDirection = 'up' | 'down' | 'stable' | 'unknown';
export type ResultStatus = 'normal' | 'low' | 'high' | 'critical-low' | 'critical-high' | 'unknown';

export interface LabTest {
  id: string;
  name: string;
  shortName: string;
  category: string;
  unit: string;
  normalMin: number | null;
  normalMax: number | null;
  criticalMin: number | null;
  criticalMax: number | null;
}

export interface LabResult {
  id: string;
  testId: string;
  value: number;
  date: string;
  status: ResultStatus;
  notes?: string;
  orderedBy: string;
  lab: string;
}

export interface LabTrend {
  test: LabTest;
  results: LabResult[];
  trend: TrendDirection;
  percentChange: number | null;
  latestValue: number;
  latestStatus: ResultStatus;
}

function rangeStart(range: '3m' | '6m' | '1y' | '2y' | 'all'): Date | null {
  if (range === 'all') return null;
  const start = new Date();
  const months = range === '3m' ? 3 : range === '6m' ? 6 : range === '1y' ? 12 : 24;
  start.setMonth(start.getMonth() - months);
  return start;
}

function trendsInRange(trends: LabTrend[], start: Date | null): LabTrend[] {
  if (!start) return trends;
  return trends.flatMap((trend) => {
    const results = trend.results.filter((result) => new Date(result.date) >= start);
    const latest = results[0];
    if (!latest) return [];
    // The API's trend calculation covered a different time span. Preserve the
    // readings but do not represent that aggregate as a trend for this subset.
    return [{ ...trend, results, latestValue: latest.value, latestStatus: latest.status, percentChange: null, trend: 'unknown' }];
  });
}

const LabTrendsPage: React.FC = () => {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'3m' | '6m' | '1y' | '2y' | 'all'>('1y');
  const [labTrends, setLabTrends] = useState<LabTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const { patient } = usePatientAuthStore();

  const categories = ['Metabolic Panel', 'Lipid Panel', 'CBC', 'Thyroid', 'Liver', 'Kidney'];

  // Map stored (English) category names to localized labels; fall back to the raw value.
  const catLabel: Record<string, string> = {
    'Metabolic Panel': t('labTrends.catMetabolic'),
    'Lipid Panel': t('labTrends.catLipid'),
    CBC: t('labTrends.catCbc'),
    Thyroid: t('labTrends.catThyroid'),
    Liver: t('labTrends.catLiver'),
    Kidney: t('labTrends.catKidney'),
  };

  const statusLabel = (s: ResultStatus): string => {
    switch (s) {
      case 'normal': return t('labTrends.statusNormal');
      case 'low': return t('labTrends.statusLow');
      case 'high': return t('labTrends.statusHigh');
      case 'critical-low': return t('labTrends.statusCriticalLow');
      case 'critical-high': return t('labTrends.statusCriticalHigh');
      case 'unknown': return t('labTrends.statusUnknown');
    }
  };

  const loadLabTrends = useCallback(async () => {
    setLoading(true);
    
    // Try to load from API first
    // The patient's record id, not their wallet address: results are filed
    // under the record, so a wallet-keyed read found nothing for anybody.
    if (patient?.healthId) {
      try {
        const response = await getLabTrends(patient.healthId) as { success?: boolean; trends?: unknown[] };
        // API returns { success: true, trends: [...] }
        if (response?.success && response?.trends && Array.isArray(response.trends) && response.trends.length > 0) {
          // Transform API response to frontend format
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const transformed: LabTrend[] = response.trends.flatMap((apiTrend: any) => {
            // Map API data points to LabResult format
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            // Newest first: everything below reads results[0] as the latest.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const points = [...(apiTrend.data_points || [])].sort((a: any, b: any) => b.collected_at - a.collected_at);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const results: LabResult[] = points.map((dp: any, idx: number) => {
              const mapStatus = (status: string): ResultStatus => {
                switch (status) {
                  case 'CriticalLow': return 'critical-low';
                  case 'CriticalHigh': return 'critical-high';
                  case 'Low': return 'low';
                  case 'High': return 'high';
                  case 'Normal': return 'normal';
                  default: return 'unknown';
                }
              };
              return {
                id: dp.result_id || `result-${idx}`,
                testId: apiTrend.loinc_code,
                value: dp.value,
                date: new Date(dp.collected_at * 1000).toISOString().split('T')[0],
                status: mapStatus(dp.status),
                notes: dp.flag,
                orderedBy: 'Provider',
                lab: dp.performing_lab || 'Laboratory'
              };
            });

            // Determine trend direction
            const mapTrend = (direction: string): TrendDirection => {
              if (direction === 'Increasing') return 'up';
              if (direction === 'Decreasing') return 'down';
              if (direction === 'Stable') return 'stable';
              // One result, or a first value of zero: no direction to show.
              return 'unknown';
            };

            // Create LabTest from API data
            const referenceRange = apiTrend.reference_range ?? {};
            const numberOrNull = (value: unknown): number | null =>
              typeof value === 'number' && Number.isFinite(value) ? value : null;
            const test: LabTest = {
              id: apiTrend.loinc_code,
              name: apiTrend.test_name,
              shortName: apiTrend.test_name.split(' ')[0],
              category: 'General', // API doesn't provide category, default to General
              unit: apiTrend.unit,
              normalMin: numberOrNull(referenceRange.low),
              normalMax: numberOrNull(referenceRange.high),
              criticalMin: numberOrNull(referenceRange.critical_low),
              criticalMax: numberOrNull(referenceRange.critical_high)
            };

            const latestResult = results[0];
            if (!latestResult) return [];
            return [{
              test,
              results,
              trend: mapTrend(apiTrend.trend_analysis?.direction),
              percentChange: numberOrNull(apiTrend.trend_analysis?.percent_change),
              latestValue: latestResult.value,
              latestStatus: latestResult.status
            }];
          });
          setLabTrends(transformed);
          setLoading(false);
          return;
        }
      } catch (err) {
        console.warn('No lab trends from API:', err);
      }
    }
    
    setLoading(false);
  }, [patient?.healthId]);

  useEffect(() => {
    loadLabTrends();
  }, [patient, loadLabTrends]);

  const getStatusColor = (status: ResultStatus) => {
    switch (status) {
      case 'normal': return 'text-ok-subtle-fg';
      case 'low': return 'text-caution-subtle-fg';
      case 'high': return 'text-content-secondary';
      case 'critical-low': return 'text-critical-subtle-fg';
      case 'critical-high': return 'text-critical-subtle-fg';
      case 'unknown': return 'text-content-muted';
    }
  };

  const getStatusBg = (status: ResultStatus) => {
    switch (status) {
      case 'normal': return 'bg-ok-subtle';
      case 'low': return 'bg-caution-subtle';
      case 'high': return 'bg-surface-sunken';
      case 'critical-low': return 'bg-critical-subtle';
      case 'critical-high': return 'bg-critical-subtle';
      case 'unknown': return 'bg-surface-sunken';
    }
  };

  const getTrendIcon = (trend: TrendDirection, isGoodIfDown: boolean = false) => {
    if (trend === 'stable' || trend === 'unknown') return <Minus className="w-4 h-4 text-content-muted" />;
    if (trend === 'up') {
      return isGoodIfDown 
        ? <TrendingUp className="w-4 h-4 text-caution" />
        : <TrendingUp className="w-4 h-4 text-ok" />;
    }
    return isGoodIfDown 
      ? <TrendingDown className="w-4 h-4 text-ok" />
      : <TrendingDown className="w-4 h-4 text-caution" />;
  };

  const visibleTrends = trendsInRange(labTrends, rangeStart(timeRange));
  const filteredTrends = visibleTrends.filter(lt =>
    selectedCategory === 'all' || lt.test.category === selectedCategory
  );

  const selectedTrend = selectedTest ? visibleTrends.find(t => t.test.id === selectedTest) : null;

  // Simple bar chart renderer
  const renderMiniChart = (trend: LabTrend) => {
    const results = trend.results.slice(0, 6).reverse();
    const maxVal = Math.max(...results.map(r => r.value));
    const minVal = Math.min(...results.map(r => r.value));
    const range = maxVal - minVal;

    return (
      <div className="flex items-end gap-1 h-12">
        {results.map((r, idx) => {
          const height = range > 0 ? ((r.value - minVal) / range) * 100 : 50;
          const isLatest = idx === results.length - 1;
          return (
            <div
              key={r.id}
              className={`flex-1 rounded-t transition-all ${
                r.status === 'normal' ? 'bg-green-400' :
                r.status === 'low' || r.status === 'high' ? 'bg-yellow-400' :
                r.status === 'unknown' ? 'bg-gray-400' :
                'bg-red-400'
              } ${isLatest ? 'opacity-100' : 'opacity-60'}`}
              style={{ height: `${Math.max(height, 10)}%` }}
              title={`${r.date}: ${r.value} ${trend.test.unit}`}
            />
          );
        })}
      </div>
    );
  };

  // Detailed chart for selected test
  const renderDetailChart = (trend: LabTrend) => {
    const results = trend.results.slice().reverse();
    const normalMin = trend.test.normalMin;
    const normalMax = trend.test.normalMax;
    const hasReferenceRange = normalMin !== null && normalMax !== null;
    const plottedValues = [
      ...results.map((result) => result.value),
      ...(hasReferenceRange ? [normalMin!, normalMax!] : []),
    ];
    const maxVal = Math.max(...plottedValues);
    const minVal = Math.min(...plottedValues);
    const range = maxVal - minVal;

    const normalMinY = hasReferenceRange && range > 0 ? ((normalMin! - minVal) / range) * 100 : 0;
    const normalMaxY = hasReferenceRange && range > 0 ? ((normalMax! - minVal) / range) * 100 : 0;

    return (
      <div className="relative h-48 bg-surface-sunken rounded-lg p-4">
        {/* Reference range background */}
        {hasReferenceRange && <div
          className="absolute left-4 right-4 bg-ok-subtle opacity-40 rounded"
          style={{
            bottom: `${normalMinY}%`,
            height: `${normalMaxY - normalMinY}%`
          }}
        />}
        
        {/* Reference lines */}
        {hasReferenceRange && <div
          className="absolute left-4 right-4 border-t-2 border-dashed border-ok"
          style={{ bottom: `${normalMaxY}%` }}
        >
          <span className="absolute -top-5 right-0 text-xs text-ok-subtle-fg">
            {t('labTrends.max', { value: normalMax! })}
          </span>
        </div>}
        {hasReferenceRange && <div
          className="absolute left-4 right-4 border-t-2 border-dashed border-ok"
          style={{ bottom: `${normalMinY}%` }}
        >
          <span className="absolute -bottom-4 right-0 text-xs text-ok-subtle-fg">
            {t('labTrends.min', { value: normalMin! })}
          </span>
        </div>}

        {/* Data points */}
        <div className="relative h-full flex items-end justify-between px-4">
          {results.map((r) => {
            const y = range > 0 ? ((r.value - minVal) / range) * 100 : 50;
            return (
              <div key={r.id} className="flex flex-col items-center">
                <div
                  className={`w-3 h-3 rounded-full border-2 ${
                    r.status === 'normal' ? 'bg-green-500 border-green-600' :
                    r.status === 'low' || r.status === 'high' ? 'bg-caution border-yellow-600' :
                    r.status === 'unknown' ? 'bg-gray-400 border-gray-500' :
                    'bg-red-500 border-red-600'
                  }`}
                  style={{ marginBottom: `${y}%` }}
                  title={`${r.value} ${trend.test.unit}`}
                />
              </div>
            );
          })}
        </div>

        {/* X-axis labels */}
        <div className="flex justify-between text-xs text-content-muted mt-2 px-4">
          {results.map(r => (
            <span key={r.id}>{formatTimestamp(r.date, { month: 'short', year: '2-digit' })}</span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Loading State */}
      {loading && (
        <div className="fixed inset-0 bg-surface/80 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-ok-subtle-fg animate-spin" />
            <span className="text-content-muted">{t('labTrends.loading')}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-700 to-teal-800 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Activity className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('labTrends.title')}</h1>
        </div>
        <p className="text-white">{t('labTrends.subtitle')}</p>
      </div>

      {/* Time Range Selector */}
      <div className="p-4 -mt-4">
        <div className="bg-surface rounded-lg shadow p-2 flex gap-2">
          {[
            { value: '3m', label: t('labTrends.range3m') },
            { value: '6m', label: t('labTrends.range6m') },
            { value: '1y', label: t('labTrends.range1y') },
            { value: '2y', label: t('labTrends.range2y') },
            { value: 'all', label: t('labTrends.rangeAll') }
          ].map(option => (
            <button
              key={option.value}
              onClick={() => setTimeRange(option.value as typeof timeRange)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                timeRange === option.value
                  ? 'bg-ok text-ok-fg'
                  : 'text-content-muted hover:bg-surface-sunken'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Category Filter */}
      <div className="px-4 mb-4">
        <div className="flex gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
              selectedCategory === 'all'
                ? 'bg-ok text-ok-fg'
                : 'bg-surface text-content-muted border border-border'
            }`}
          >
            {t('labTrends.allTests')}
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-ok text-ok-fg'
                  : 'bg-surface text-content-muted border border-border'
              }`}
            >
              {catLabel[cat] || cat}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="px-4 mb-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface rounded-lg shadow p-3 text-center">
            <div className="text-2xl font-bold text-ok-subtle-fg">
              {labTrends.filter(lt => lt.latestStatus === 'normal').length}
            </div>
            <div className="text-xs text-content-muted">{t('labTrends.summaryNormal')}</div>
          </div>
          <div className="bg-surface rounded-lg shadow p-3 text-center">
            <div className="text-2xl font-bold text-caution-subtle-fg">
              {labTrends.filter(lt => lt.latestStatus === 'low' || lt.latestStatus === 'high').length}
            </div>
            <div className="text-xs text-content-muted">{t('labTrends.summaryOutOfRange')}</div>
          </div>
          <div className="bg-surface rounded-lg shadow p-3 text-center">
            <div className="text-2xl font-bold text-critical-subtle-fg">
              {labTrends.filter(lt => lt.latestStatus.includes('critical')).length}
            </div>
            <div className="text-xs text-content-muted">{t('labTrends.summaryCritical')}</div>
          </div>
        </div>
      </div>

      {/* Selected Test Detail */}
      {selectedTrend && (
        <div className="px-4 mb-4">
          <div className="bg-surface rounded-lg shadow overflow-hidden">
            <div className="bg-ok-subtle p-4 flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-ok-subtle-fg">{selectedTrend.test.name}</h3>
                <p className="text-sm text-ok-subtle-fg">{catLabel[selectedTrend.test.category] || selectedTrend.test.category}</p>
              </div>
              <button
                onClick={() => setSelectedTest(null)}
                className="text-ok-subtle-fg text-sm"
              >
                {t('labTrends.close')}
              </button>
            </div>
            
            <div className="p-4">
              {/* Current Value */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-3xl font-bold text-content">{selectedTrend.latestValue}</span>
                  <span className="text-lg text-content-muted ml-1">{selectedTrend.test.unit}</span>
                </div>
                <div className={`px-3 py-1 rounded-full text-sm font-medium uppercase ${getStatusBg(selectedTrend.latestStatus)} ${getStatusColor(selectedTrend.latestStatus)}`}>
                  {statusLabel(selectedTrend.latestStatus)}
                </div>
              </div>

              {/* Chart */}
              {renderDetailChart(selectedTrend)}

              {/* Reference Range */}
              <div className="mt-4 p-3 bg-surface-sunken rounded-lg">
                <h4 className="text-sm font-medium text-content-secondary mb-2">{t('labTrends.referenceRange')}</h4>
                <div className="flex justify-between text-sm">
                  <span className="text-content-muted">
                    {selectedTrend.test.normalMin !== null && selectedTrend.test.normalMax !== null
                      ? t('labTrends.normalRange', { min: selectedTrend.test.normalMin, max: selectedTrend.test.normalMax, unit: selectedTrend.test.unit })
                      : t('labTrends.referenceRangeUnavailable')}
                  </span>
                </div>
              </div>

              {/* History Table */}
              <div className="mt-4">
                <h4 className="text-sm font-medium text-content-secondary mb-2">{t('labTrends.history')}</h4>
                <div className="space-y-2">
                  {selectedTrend.results.slice(0, 5).map(r => (
                    <div key={r.id} className="flex justify-between items-center py-2 border-b border-border">
                      <span className="text-sm text-content-muted">{formatDateOnly(r.date)}</span>
                      <span className={`font-medium ${getStatusColor(r.status)}`}>
                        {r.value} {selectedTrend.test.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Test Cards */}
      <div className="px-4 pb-8 space-y-3">
        {filteredTrends.map(trend => (
          <button
            key={trend.test.id}
            onClick={() => setSelectedTest(trend.test.id)}
            className={`w-full bg-surface rounded-lg shadow p-4 text-left transition-all ${
              selectedTest === trend.test.id ? 'ring-2 ring-emerald-500' : ''
            }`}
          >
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-medium text-content">{trend.test.name}</h3>
                <p className="text-xs text-content-muted">{catLabel[trend.test.category] || trend.test.category}</p>
              </div>
              <div className={`px-2 py-1 rounded text-xs font-medium ${getStatusBg(trend.latestStatus)} ${getStatusColor(trend.latestStatus)}`}>
                {trend.latestStatus === 'normal' ? (
                  <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3" /> {statusLabel(trend.latestStatus)}</span>
                ) : trend.latestStatus === 'unknown' ? (
                  <span>{statusLabel(trend.latestStatus)}</span>
                ) : (
                  <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {statusLabel(trend.latestStatus)}</span>
                )}
              </div>
            </div>

            <div className="flex justify-between items-end">
              <div>
                <span className="text-2xl font-bold text-content">{trend.latestValue}</span>
                <span className="text-sm text-content-muted ml-1">{trend.test.unit}</span>
                <div className="flex items-center gap-1 mt-1 text-sm">
                  {getTrendIcon(trend.trend)}
                  <span className={`${
                    trend.percentChange === null ? 'text-content-muted' : trend.percentChange > 0 ? 'text-content-secondary' :
                    trend.percentChange < 0 ? 'text-ok-subtle-fg' : 'text-content-muted'
                  }`}>
                    {trend.percentChange === null ? t('labTrends.changeUnavailable') : `${trend.percentChange > 0 ? '+' : ''}${trend.percentChange}%`}
                  </span>
                </div>
              </div>
              <div className="w-24">
                {renderMiniChart(trend)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default LabTrendsPage;
