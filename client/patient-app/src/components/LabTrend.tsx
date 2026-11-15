/**
 * A lab parameter's history: the trend the server computed and its chart.
 *
 * Shared by the results list, where each result opens its own trend (patient
 * app plan, 2026-11-04), and the overview of every parameter. Trends are keyed
 * by the parameter as the lab named it (`lab_trends.rs`), the same name a
 * result line carries, so a result finds its trend by name.
 */
import { formatTimestamp, useTranslation } from '@medichain/shared';

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

/** The server's trends (`GET /api/clinical/lab-trends/{id}`), newest result first. */
export function trendsFromApi(trends: unknown[]): LabTrend[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (trends as any[]).flatMap((apiTrend: any) => {
    // Map API data points to LabResult format
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
}

/** The trend for a result line's parameter, if the patient has one. */
export function trendFor(trends: LabTrend[], parameter: string): LabTrend | undefined {
  const key = parameter.trim().toLowerCase();
  return trends.find((trend) => trend.test.name.trim().toLowerCase() === key);
}

/** A parameter's results over time, against its reference range. */
export function TrendChart({ trend }: { trend: LabTrend }) {
  const { t } = useTranslation();
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
  }
