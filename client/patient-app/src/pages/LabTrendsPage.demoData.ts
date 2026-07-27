/**
 * Sample lab trend data for IS_DEMO mode only. Split into its own module
 * (dynamically imported from LabTrendsPage) so Rollup/esbuild can tree-shake
 * it out of production bundles — the `if (IS_DEMO)` check alone can't prove
 * that to the bundler when the data lives inline in the page component.
 */
import type { LabTest, LabResult, LabTrend, ResultStatus, TrendDirection } from './LabTrendsPage';

const DEMO_TESTS: LabTest[] = [
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

function generateResults(test: LabTest): LabResult[] {
  const results: LabResult[] = [];
  const dates = [
    '2024-12-01', '2024-09-15', '2024-06-01', '2024-03-15',
    '2023-12-01', '2023-06-15', '2023-01-01', '2022-06-01'
  ];

  dates.forEach((date, idx) => {
    const baseValue = (test.normalMin + test.normalMax) / 2;
    const variance = (test.normalMax - test.normalMin) * 0.3;
    let value = baseValue + (Math.random() * variance * 2 - variance);

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
}

export function getDemoLabTrends(): LabTrend[] {
  return DEMO_TESTS.map(test => {
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
}
