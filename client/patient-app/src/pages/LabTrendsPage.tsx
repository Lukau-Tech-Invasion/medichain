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
import { getLabTrends, IS_DEMO } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

/**
 * LabTrendsPage
 * 
 * Full-featured page for viewing historical lab result trends.
 * Includes interactive charts, reference ranges, and trend analysis.
 */

type TrendDirection = 'up' | 'down' | 'stable';
type ResultStatus = 'normal' | 'low' | 'high' | 'critical-low' | 'critical-high';

interface LabTest {
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

interface LabResult {
  id: string;
  testId: string;
  value: number;
  date: string;
  status: ResultStatus;
  notes?: string;
  orderedBy: string;
  lab: string;
}

interface LabTrend {
  test: LabTest;
  results: LabResult[];
  trend: TrendDirection;
  percentChange: number;
  latestValue: number;
  latestStatus: ResultStatus;
}

const LabTrendsPage: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'3m' | '6m' | '1y' | '2y' | 'all'>('1y');
  const [labTrends, setLabTrends] = useState<LabTrend[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const { patient } = usePatientAuthStore();

  const categories = ['Metabolic Panel', 'Lipid Panel', 'CBC', 'Thyroid', 'Liver', 'Kidney'];

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
      loadDemoData();
    }
    setLoading(false);
  };

  const loadDemoData = () => {
    // Sample lab tests and historical data
    const tests: LabTest[] = [
      { id: 'glucose', name: 'Glucose (Fasting)', shortName: 'Glucose', category: 'Metabolic Panel', unit: 'mg/dL', normalMin: 70, normalMax: 100, criticalMin: 50, criticalMax: 400 },
      { id: 'hba1c', name: 'Hemoglobin A1c', shortName: 'HbA1c', category: 'Metabolic Panel', unit: '%', normalMin: 4.0, normalMax: 5.6, criticalMin: 3.0, criticalMax: 14.0 },
      { id: 'cholesterol', name: 'Total Cholesterol', shortName: 'Chol', category: 'Lipid Panel', unit: 'mg/dL', normalMin: 0, normalMax: 200, criticalMin: 0, criticalMax: 400 },
      { id: 'ldl', name: 'LDL Cholesterol', shortName: 'LDL', category: 'Lipid Panel', unit: 'mg/dL', normalMin: 0, normalMax: 100, criticalMin: 0, criticalMax: 250 },
      { id: 'hdl', name: 'HDL Cholesterol', shortName: 'HDL', category: 'Lipid Panel', unit: 'mg/dL', normalMin: 40, normalMax: 200, criticalMin: 20, criticalMax: 200 },
      { id: 'triglycerides', name: 'Triglycerides', shortName: 'TG', category: 'Lipid Panel', unit: 'mg/dL', normalMin: 0, normalMax: 150, criticalMin: 0, criticalMax: 500 },
      { id: 'wbc', name: 'White Blood Cells', shortName: 'WBC', category: 'CBC', unit: 'K/uL', normalMin: 4.5, normalMax: 11.0, criticalMin: 2.0, criticalMax: 30.0 },
      { id: 'rbc', name: 'Red Blood Cells', shortName: 'RBC', category: 'CBC', unit: 'M/uL', normalMin: 4.5, normalMax: 5.5, criticalMin: 3.0, criticalMax: 7.0 },
      { id: 'hemoglobin', name: 'Hemoglobin', shortName: 'Hgb', category: 'CBC', unit: 'g/dL', normalMin: 12.0, normalMax: 16.0, criticalMin: 7.0, criticalMax: 20.0 },
      { id: 'platelets', name: 'Platelets', shortName: 'PLT', category: 'CBC', unit: 'K/uL', normalMin: 150, normalMax: 400, criticalMin: 50, criticalMax: 1000 },
      { id: 'tsh', name: 'TSH', shortName: 'TSH', category: 'Thyroid', unit: 'mIU/L', normalMin: 0.4, normalMax: 4.0, criticalMin: 0.1, criticalMax: 10.0 },
      { id: 't4', name: 'Free T4', shortName: 'T4', category: 'Thyroid', unit: 'ng/dL', normalMin: 0.8, normalMax: 1.8, criticalMin: 0.3, criticalMax: 5.0 },
      { id: 'alt', name: 'ALT (SGPT)', shortName: 'ALT', category: 'Liver', unit: 'U/L', normalMin: 7, normalMax: 56, criticalMin: 0, criticalMax: 500 },
      { id: 'ast', name: 'AST (SGOT)', shortName: 'AST', category: 'Liver', unit: 'U/L', normalMin: 10, normalMax: 40, criticalMin: 0, criticalMax: 500 },
      { id: 'creatinine', name: 'Creatinine', shortName: 'Cr', category: 'Kidney', unit: 'mg/dL', normalMin: 0.7, normalMax: 1.3, criticalMin: 0.3, criticalMax: 10.0 },
      { id: 'bun', name: 'BUN', shortName: 'BUN', category: 'Kidney', unit: 'mg/dL', normalMin: 7, normalMax: 20, criticalMin: 2, criticalMax: 100 },
      { id: 'egfr', name: 'eGFR', shortName: 'eGFR', category: 'Kidney', unit: 'mL/min/1.73m²', normalMin: 90, normalMax: 200, criticalMin: 15, criticalMax: 200 }
    ];

    // Generate sample historical results
    const generateResults = (test: LabTest): LabResult[] => {
      const results: LabResult[] = [];
      const dates = [
        '2024-12-01', '2024-09-15', '2024-06-01', '2024-03-15',
        '2023-12-01', '2023-06-15', '2023-01-01', '2022-06-01'
      ];

      dates.forEach((date, idx) => {
        // Generate realistic values with some variance
        const baseValue = (test.normalMin + test.normalMax) / 2;
        const variance = (test.normalMax - test.normalMin) * 0.3;
        let value = baseValue + (Math.random() * variance * 2 - variance);
        
        // Add some abnormal values for demonstration
        if (test.id === 'ldl' && idx < 2) value = test.normalMax + 15;
        if (test.id === 'hdl' && idx < 2) value = test.normalMin - 5;
        if (test.id === 'glucose' && idx === 0) value = 105;

        value = Math.round(value * 10) / 10;

        let status: ResultStatus = 'normal';
        if (value < test.criticalMin) status = 'critical-low';
        else if (value > test.criticalMax) status = 'critical-high';
        else if (value < test.normalMin) status = 'low';
        else if (value > test.normalMax) status = 'high';

        results.push({
          id: `${test.id}-${date}`,
          testId: test.id,
          value,
          date,
          status,
          orderedBy: 'Dr. Sarah Chen',
          lab: 'Quest Diagnostics'
        });
      });

      return results;
    };

    const trends: LabTrend[] = tests.map(test => {
      const results = generateResults(test);
      const latestValue = results[0].value;
      const previousValue = results[1]?.value || latestValue;
      const percentChange = previousValue !== 0 ? ((latestValue - previousValue) / previousValue) * 100 : 0;
      
      let trend: TrendDirection = 'stable';
      if (percentChange > 5) trend = 'up';
      else if (percentChange < -5) trend = 'down';

      return {
        test,
        results,
        trend,
        percentChange: Math.round(percentChange * 10) / 10,
        latestValue,
        latestStatus: results[0].status
      };
    });

    setLabTrends(trends);
  };

  const getStatusColor = (status: ResultStatus) => {
    switch (status) {
      case 'normal': return 'text-green-600';
      case 'low': return 'text-yellow-600';
      case 'high': return 'text-orange-600';
      case 'critical-low': return 'text-red-600';
      case 'critical-high': return 'text-red-600';
    }
  };

  const getStatusBg = (status: ResultStatus) => {
    switch (status) {
      case 'normal': return 'bg-green-100';
      case 'low': return 'bg-yellow-100';
      case 'high': return 'bg-orange-100';
      case 'critical-low': return 'bg-red-100';
      case 'critical-high': return 'bg-red-100';
    }
  };

  const getTrendIcon = (trend: TrendDirection, isGoodIfDown: boolean = false) => {
    if (trend === 'stable') return <Minus className="w-4 h-4 text-gray-500" />;
    if (trend === 'up') {
      return isGoodIfDown 
        ? <TrendingUp className="w-4 h-4 text-orange-500" />
        : <TrendingUp className="w-4 h-4 text-green-500" />;
    }
    return isGoodIfDown 
      ? <TrendingDown className="w-4 h-4 text-green-500" />
      : <TrendingDown className="w-4 h-4 text-orange-500" />;
  };

  const filteredTrends = labTrends.filter(t => 
    selectedCategory === 'all' || t.test.category === selectedCategory
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
      <div className="relative h-48 bg-gray-50 rounded-lg p-4">
        {/* Reference range background */}
        <div
          className="absolute left-4 right-4 bg-green-100 opacity-40 rounded"
          style={{
            bottom: `${normalMinY}%`,
            height: `${normalMaxY - normalMinY}%`
          }}
        />
        
        {/* Reference lines */}
        <div
          className="absolute left-4 right-4 border-t-2 border-dashed border-green-400"
          style={{ bottom: `${normalMaxY}%` }}
        >
          <span className="absolute -top-5 right-0 text-xs text-green-600">
            Max: {trend.test.normalMax}
          </span>
        </div>
        <div
          className="absolute left-4 right-4 border-t-2 border-dashed border-green-400"
          style={{ bottom: `${normalMinY}%` }}
        >
          <span className="absolute -bottom-4 right-0 text-xs text-green-600">
            Min: {trend.test.normalMin}
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
                    r.status === 'low' || r.status === 'high' ? 'bg-yellow-500 border-yellow-600' :
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
        <div className="flex justify-between text-xs text-gray-400 mt-2 px-4">
          {results.map(r => (
            <span key={r.id}>{new Date(r.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Loading State */}
      {loading && (
        <div className="fixed inset-0 bg-white/80 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
            <span className="text-gray-600">Loading lab trends...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Activity className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Lab Trends</h1>
        </div>
        <p className="text-emerald-100">Track your lab results over time</p>
      </div>

      {/* Time Range Selector */}
      <div className="p-4 -mt-4">
        <div className="bg-white rounded-lg shadow p-2 flex gap-2">
          {[
            { value: '3m', label: '3 Months' },
            { value: '6m', label: '6 Months' },
            { value: '1y', label: '1 Year' },
            { value: '2y', label: '2 Years' },
            { value: 'all', label: 'All' }
          ].map(option => (
            <button
              key={option.value}
              onClick={() => setTimeRange(option.value as typeof timeRange)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                timeRange === option.value
                  ? 'bg-emerald-500 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
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
                : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            All Tests
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-emerald-500 text-white'
                  : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="px-4 mb-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-lg shadow p-3 text-center">
            <div className="text-2xl font-bold text-green-600">
              {labTrends.filter(t => t.latestStatus === 'normal').length}
            </div>
            <div className="text-xs text-gray-500">Normal</div>
          </div>
          <div className="bg-white rounded-lg shadow p-3 text-center">
            <div className="text-2xl font-bold text-yellow-600">
              {labTrends.filter(t => t.latestStatus === 'low' || t.latestStatus === 'high').length}
            </div>
            <div className="text-xs text-gray-500">Out of Range</div>
          </div>
          <div className="bg-white rounded-lg shadow p-3 text-center">
            <div className="text-2xl font-bold text-red-600">
              {labTrends.filter(t => t.latestStatus.includes('critical')).length}
            </div>
            <div className="text-xs text-gray-500">Critical</div>
          </div>
        </div>
      </div>

      {/* Selected Test Detail */}
      {selectedTrend && (
        <div className="px-4 mb-4">
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="bg-emerald-50 p-4 flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-emerald-900">{selectedTrend.test.name}</h3>
                <p className="text-sm text-emerald-700">{selectedTrend.test.category}</p>
              </div>
              <button
                onClick={() => setSelectedTest(null)}
                className="text-emerald-600 text-sm"
              >
                Close
              </button>
            </div>
            
            <div className="p-4">
              {/* Current Value */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-3xl font-bold text-gray-900">{selectedTrend.latestValue}</span>
                  <span className="text-lg text-gray-500 ml-1">{selectedTrend.test.unit}</span>
                </div>
                <div className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusBg(selectedTrend.latestStatus)} ${getStatusColor(selectedTrend.latestStatus)}`}>
                  {selectedTrend.latestStatus.replace('-', ' ').toUpperCase()}
                </div>
              </div>

              {/* Chart */}
              {renderDetailChart(selectedTrend)}

              {/* Reference Range */}
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Reference Range</h4>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Normal: {selectedTrend.test.normalMin} - {selectedTrend.test.normalMax} {selectedTrend.test.unit}</span>
                </div>
              </div>

              {/* History Table */}
              <div className="mt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">History</h4>
                <div className="space-y-2">
                  {selectedTrend.results.slice(0, 5).map(r => (
                    <div key={r.id} className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-sm text-gray-600">{new Date(r.date).toLocaleDateString()}</span>
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
            className={`w-full bg-white rounded-lg shadow p-4 text-left transition-all ${
              selectedTest === trend.test.id ? 'ring-2 ring-emerald-500' : ''
            }`}
          >
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-medium text-gray-900">{trend.test.name}</h3>
                <p className="text-xs text-gray-500">{trend.test.category}</p>
              </div>
              <div className={`px-2 py-1 rounded text-xs font-medium ${getStatusBg(trend.latestStatus)} ${getStatusColor(trend.latestStatus)}`}>
                {trend.latestStatus === 'normal' ? (
                  <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Normal</span>
                ) : (
                  <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {trend.latestStatus.replace('-', ' ')}</span>
                )}
              </div>
            </div>

            <div className="flex justify-between items-end">
              <div>
                <span className="text-2xl font-bold text-gray-900">{trend.latestValue}</span>
                <span className="text-sm text-gray-500 ml-1">{trend.test.unit}</span>
                <div className="flex items-center gap-1 mt-1 text-sm">
                  {getTrendIcon(trend.trend)}
                  <span className={`${
                    trend.percentChange > 0 ? 'text-orange-600' : 
                    trend.percentChange < 0 ? 'text-green-600' : 'text-gray-500'
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
