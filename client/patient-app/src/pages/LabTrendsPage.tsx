import React, { useState, useEffect } from 'react';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  ChevronDown,
  AlertTriangle,
  CheckCircle,
  Info,
  Download,
  Share2,
  Filter,
  BarChart3,
  LineChart as LineChartIcon,
  Loader2
} from 'lucide-react';
import { getLabTrends, IS_DEMO, useTranslation } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

/**
 * LabTrendsPage
 * 
 * Full-featured page for viewing historical lab result trends.
 * Includes interactive charts, reference ranges, and trend analysis.
 */

export type TrendDirection = 'up' | 'down' | 'stable';
export type ResultStatus = 'normal' | 'low' | 'high' | 'critical-low' | 'critical-high';

export interface LabTest {
  id: string;
  name: string;
  shortName: string;
  category: string;
  unit: string;
  normalMin: number;
  normalMax: number;
  criticalMin: number;
  criticalMax: number;
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
  percentChange: number;
  latestValue: number;
  latestStatus: ResultStatus;
}

const LabTrendsPage: React.FC = () => {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'3m' | '6m' | '1y' | '2y' | 'all'>('1y');
  const [labTrends, setLabTrends] = useState<LabTrend[]>([]);
  const [showFilters, setShowFilters] = useState(false);
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
    }
  };

  useEffect(() => {
    loadLabTrends();
  }, [patient]);

  const loadLabTrends = async () => {
    setLoading(true);
    
    // Try to load from API first
    if (patient?.walletAddress) {
      try {
        const response = await getLabTrends(patient.walletAddress) as { success?: boolean; trends?: unknown[] };
        // API returns { success: true, trends: [...] }
        if (response?.success && response?.trends && Array.isArray(response.trends) && response.trends.length > 0) {
          // Transform API response to frontend format
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const transformed: LabTrend[] = response.trends.map((apiTrend: any) => {
            // Map API data points to LabResult format
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const results: LabResult[] = (apiTrend.data_points || []).map((dp: any, idx: number) => {
              const mapStatus = (status: string): ResultStatus => {
                switch (status) {
                  case 'CriticalLow': return 'critical-low';
                  case 'CriticalHigh': return 'critical-high';
                  case 'Low': return 'low';
                  case 'High': return 'high';
                  default: return 'normal';
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
              return 'stable';
            };

            // Create LabTest from API data
            const test: LabTest = {
              id: apiTrend.loinc_code,
              name: apiTrend.test_name,
              shortName: apiTrend.test_name.split(' ')[0],
              category: 'General', // API doesn't provide category, default to General
              unit: apiTrend.unit,
              normalMin: apiTrend.reference_range?.low || 0,
              normalMax: apiTrend.reference_range?.high || 100,
              criticalMin: apiTrend.reference_range?.critical_low || 0,
              criticalMax: apiTrend.reference_range?.critical_high || 999
            };

            const latestResult = results[0];
            return {
              test,
              results,
              trend: mapTrend(apiTrend.trend_analysis?.direction),
              percentChange: apiTrend.trend_analysis?.percent_change || 0,
              latestValue: latestResult?.value || 0,
              latestStatus: latestResult?.status || 'normal'
            };
          });
          setLabTrends(transformed);
          setLoading(false);
          return;
        }
      } catch (err) {
        console.warn('No lab trends from API, using demo data:', err);
      }
    }
    
    // Fallback to demo data (demo mode only — production shows an empty state)
    if (IS_DEMO) {
      await loadDemoData();
    }
    setLoading(false);
  };

  // Dynamically imported so the sample data isn't bundled into production
  // builds (demo mode is gated by IS_DEMO, but the bundler can't statically
  // prove that across a module boundary unless the import itself is dynamic).
  const loadDemoData = async () => {
    const { getDemoLabTrends } = await import('./LabTrendsPage.demoData');
    setLabTrends(getDemoLabTrends());
  };

  const getStatusColor = (status: ResultStatus) => {
    switch (status) {
      case 'normal': return 'text-ok-subtle-fg';
      case 'low': return 'text-caution-subtle-fg';
      case 'high': return 'text-content-secondary';
      case 'critical-low': return 'text-critical-subtle-fg';
      case 'critical-high': return 'text-critical-subtle-fg';
    }
  };

  const getStatusBg = (status: ResultStatus) => {
    switch (status) {
      case 'normal': return 'bg-ok-subtle';
      case 'low': return 'bg-caution-subtle';
      case 'high': return 'bg-surface-sunken';
      case 'critical-low': return 'bg-critical-subtle';
      case 'critical-high': return 'bg-critical-subtle';
    }
  };

  const getTrendIcon = (trend: TrendDirection, isGoodIfDown: boolean = false) => {
    if (trend === 'stable') return <Minus className="w-4 h-4 text-content-muted" />;
    if (trend === 'up') {
      return isGoodIfDown 
        ? <TrendingUp className="w-4 h-4 text-orange-500" />
        : <TrendingUp className="w-4 h-4 text-green-500" />;
    }
    return isGoodIfDown 
      ? <TrendingDown className="w-4 h-4 text-green-500" />
      : <TrendingDown className="w-4 h-4 text-orange-500" />;
  };

  const filteredTrends = labTrends.filter(lt =>
    selectedCategory === 'all' || lt.test.category === selectedCategory
  );

  const selectedTrend = selectedTest ? labTrends.find(t => t.test.id === selectedTest) : null;

  // Simple bar chart renderer
  const renderMiniChart = (trend: LabTrend) => {
    const results = trend.results.slice(0, 6).reverse();
    const maxVal = Math.max(...results.map(r => r.value), trend.test.normalMax * 1.2);
    const minVal = Math.min(...results.map(r => r.value), trend.test.normalMin * 0.8);
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
    const maxVal = Math.max(...results.map(r => r.value), trend.test.normalMax * 1.2);
    const minVal = Math.min(...results.map(r => r.value), trend.test.normalMin * 0.8);
    const range = maxVal - minVal;

    const normalMinY = range > 0 ? ((trend.test.normalMin - minVal) / range) * 100 : 50;
    const normalMaxY = range > 0 ? ((trend.test.normalMax - minVal) / range) * 100 : 50;

    return (
      <div className="relative h-48 bg-surface-sunken rounded-lg p-4">
        {/* Reference range background */}
        <div
          className="absolute left-4 right-4 bg-ok-subtle opacity-40 rounded"
          style={{
            bottom: `${normalMinY}%`,
            height: `${normalMaxY - normalMinY}%`
          }}
        />
        
        {/* Reference lines */}
        <div
          className="absolute left-4 right-4 border-t-2 border-dashed border-ok"
          style={{ bottom: `${normalMaxY}%` }}
        >
          <span className="absolute -top-5 right-0 text-xs text-ok-subtle-fg">
            {t('labTrends.max', { value: trend.test.normalMax })}
          </span>
        </div>
        <div
          className="absolute left-4 right-4 border-t-2 border-dashed border-ok"
          style={{ bottom: `${normalMinY}%` }}
        >
          <span className="absolute -bottom-4 right-0 text-xs text-ok-subtle-fg">
            {t('labTrends.min', { value: trend.test.normalMin })}
          </span>
        </div>

        {/* Data points */}
        <div className="relative h-full flex items-end justify-between px-4">
          {results.map((r, idx) => {
            const y = range > 0 ? ((r.value - minVal) / range) * 100 : 50;
            return (
              <div key={r.id} className="flex flex-col items-center">
                <div
                  className={`w-3 h-3 rounded-full border-2 ${
                    r.status === 'normal' ? 'bg-green-500 border-green-600' :
                    r.status === 'low' || r.status === 'high' ? 'bg-caution border-yellow-600' :
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
            <span key={r.id}>{new Date(r.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</span>
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
      <div className="bg-gradient-to-r from-emerald-600 to-teal-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Activity className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('labTrends.title')}</h1>
        </div>
        <p className="text-emerald-100">{t('labTrends.subtitle')}</p>
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
                  ? 'bg-emerald-500 text-white'
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
                ? 'bg-emerald-500 text-white'
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
                  ? 'bg-emerald-500 text-white'
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
                  <span className="text-content-muted">{t('labTrends.normalRange', { min: selectedTrend.test.normalMin, max: selectedTrend.test.normalMax, unit: selectedTrend.test.unit })}</span>
                </div>
              </div>

              {/* History Table */}
              <div className="mt-4">
                <h4 className="text-sm font-medium text-content-secondary mb-2">{t('labTrends.history')}</h4>
                <div className="space-y-2">
                  {selectedTrend.results.slice(0, 5).map(r => (
                    <div key={r.id} className="flex justify-between items-center py-2 border-b border-border">
                      <span className="text-sm text-content-muted">{new Date(r.date).toLocaleDateString()}</span>
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
                    trend.percentChange > 0 ? 'text-content-secondary' : 
                    trend.percentChange < 0 ? 'text-ok-subtle-fg' : 'text-content-muted'
                  }`}>
                    {trend.percentChange > 0 ? '+' : ''}{trend.percentChange}%
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
