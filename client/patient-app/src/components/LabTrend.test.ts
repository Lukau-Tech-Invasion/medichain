import { describe, it, expect } from 'vitest';
import { trendFor, trendsFromApi } from './LabTrend';

describe('lab trends', () => {
  it('does not invent a status, reference range or percent change the API did not give', () => {
    const [trend] = trendsFromApi([{
      loinc_code: '9999-1', test_name: 'Unranged test', unit: 'units', reference_range: null,
      data_points: [{ result_id: 'r1', value: 12, collected_at: 1736935200, status: 'Unknown' }],
      trend_analysis: { direction: 'InsufficientData', percent_change: null },
    }]);
    expect(trend.latestStatus).toBe('unknown');
    expect(trend.test.normalMin).toBeNull();
    expect(trend.test.normalMax).toBeNull();
    expect(trend.percentChange).toBeNull();
    expect(trend.trend).toBe('unknown');
  });

  it('puts the newest result first and finds a trend by the parameter a result carries', () => {
    const trends = trendsFromApi([{
      loinc_code: 'Glucose', test_name: 'Glucose', unit: 'mg/dL',
      data_points: [
        { result_id: 'old', value: 80, collected_at: 1730000000, status: 'Normal' },
        { result_id: 'new', value: 95, collected_at: 1736935200, status: 'High' },
      ],
      trend_analysis: { direction: 'Increasing', percent_change: 18.8 },
    }]);
    expect(trends[0].results.map((r) => r.id)).toEqual(['new', 'old']);
    expect(trends[0].latestStatus).toBe('high');
    expect(trendFor(trends, ' glucose ')?.test.name).toBe('Glucose');
    expect(trendFor(trends, 'Hemoglobin')).toBeUndefined();
  });
});
