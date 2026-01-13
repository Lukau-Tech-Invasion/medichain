import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { listLabQc, createLabQc } from '@medichain/shared';
import { CheckCircle, XCircle, AlertTriangle, Activity, FileText, Search, Plus, Beaker, ThermometerSun, RefreshCw } from 'lucide-react';

/**
 * LabQCPage
 * 
 * Laboratory quality control management system
 * - Daily QC tests for instruments (Chemistry, Hematology, Coagulation, etc.)
 * - Instrument calibration records
 * - QC material lot tracking
 * - Westgard rules evaluation
 * - Out-of-range investigation and corrective actions
 * - Levey-Jennings chart data tracking
 */

interface QCTest {
  testId: string;
  date: string;
  time: string;
  instrument: string;
  analyte: string;
  level: 'Level 1' | 'Level 2' | 'Level 3';
  lotNumber: string;
  expiryDate: string;
  observedValue: number;
  expectedMean: number;
  expectedSD: number;
  unit: string;
  result: 'pass' | 'fail' | 'warning';
  violatedRules?: string[];
  performedBy: string;
  reviewedBy?: string;
  correctiveAction?: string;
  comments?: string;
}

interface Calibration {
  calibrationId: string;
  date: string;
  time: string;
  instrument: string;
  calibrationType: 'full' | 'verification' | 'linearity';
  calibratorLot: string;
  expiryDate: string;
  result: 'pass' | 'fail';
  parameters?: {
    analyte: string;
    slope: number;
    intercept: number;
    r2: number;
  }[];
  performedBy: string;
  reviewedBy?: string;
  comments?: string;
}

const LabQCPage: React.FC = () => {
  const { user } = useAuthStore();
  const [qcTests, setQcTests] = useState<QCTest[]>([]);
  const [calibrations, setCalibrations] = useState<Calibration[]>([]);
  const [activeTab, setActiveTab] = useState<'qcTests' | 'newQC' | 'calibrations' | 'newCalibration'>('qcTests');
  const [searchTerm, setSearchTerm] = useState('');
  const [instrumentFilter, setInstrumentFilter] = useState<string>('all');
  const [resultFilter, setResultFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New QC Test form state
  const [instrument, setInstrument] = useState('');
  const [analyte, setAnalyte] = useState('');
  const [level, setLevel] = useState<'Level 1' | 'Level 2' | 'Level 3'>('Level 1');
  const [lotNumber, setLotNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [observedValue, setObservedValue] = useState('');
  const [expectedMean, setExpectedMean] = useState('');
  const [expectedSD, setExpectedSD] = useState('');
  const [unit, setUnit] = useState('');
  const [qcComments, setQcComments] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');

  // New Calibration form state
  const [calInstrument, setCalInstrument] = useState('');
  const [calibrationType, setCalibrationType] = useState<'full' | 'verification' | 'linearity'>('full');
  const [calibratorLot, setCalibratorLot] = useState('');
  const [calExpiryDate, setCalExpiryDate] = useState('');
  const [calResult, setCalResult] = useState<'pass' | 'fail'>('pass');
  const [calComments, setCalComments] = useState('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await listLabQc();
      
      // Map API response to QCTest interface
      const items = (response.items || []) as Record<string, unknown>[];
      const mappedTests: QCTest[] = items.map((item) => ({
        testId: (item.test_id || item.testId || '') as string,
        date: (item.date || '') as string,
        time: (item.time || '') as string,
        instrument: (item.instrument || '') as string,
        analyte: (item.analyte || '') as string,
        level: (item.level || 'Level 1') as 'Level 1' | 'Level 2' | 'Level 3',
        lotNumber: (item.lot_number || item.lotNumber || '') as string,
        expiryDate: (item.expiry_date || item.expiryDate || '') as string,
        observedValue: (item.observed_value || item.observedValue || 0) as number,
        expectedMean: (item.expected_mean || item.expectedMean || 0) as number,
        expectedSD: (item.expected_sd || item.expectedSD || 0) as number,
        unit: (item.unit || '') as string,
        result: (item.result || 'pass') as 'pass' | 'fail' | 'warning',
        violatedRules: item.violated_rules || item.violatedRules,
        performedBy: (item.performed_by || item.performedBy || '') as string,
        reviewedBy: item.reviewed_by || item.reviewedBy,
        correctiveAction: item.corrective_action || item.correctiveAction,
        comments: item.comments,
      } as QCTest));
      
      setQcTests(mappedTests);
      
      // Calibrations are part of the same response or separate
      const calItems = (response as { calibrations?: Record<string, unknown>[] }).calibrations || [];
      const mappedCalibrations: Calibration[] = calItems.map((item: Record<string, unknown>) => ({
        calibrationId: (item.calibration_id || item.calibrationId || '') as string,
        date: (item.date || '') as string,
        time: (item.time || '') as string,
        instrument: (item.instrument || '') as string,
        calibrationType: (item.calibration_type || item.calibrationType || 'full') as 'full' | 'verification' | 'linearity',
        calibratorLot: (item.calibrator_lot || item.calibratorLot || '') as string,
        expiryDate: (item.expiry_date || item.expiryDate || '') as string,
        result: (item.result || 'pass') as 'pass' | 'fail',
        parameters: item.parameters,
        performedBy: (item.performed_by || item.performedBy || '') as string,
        reviewedBy: item.reviewed_by || item.reviewedBy,
        comments: item.comments,
      } as Calibration));
      
      setCalibrations(mappedCalibrations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch QC data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, user]);

  const handleSubmitQC = (e: React.FormEvent) => {
    e.preventDefault();
    if (!instrument || !analyte || !observedValue || !expectedMean || !expectedSD) {
      alert('Please fill in all required fields');
      return;
    }

    const obs = parseFloat(observedValue);
    const mean = parseFloat(expectedMean);
    const sd = parseFloat(expectedSD);

    // Westgard rules evaluation
    const zScore = Math.abs((obs - mean) / sd);
    let result: 'pass' | 'fail' | 'warning' = 'pass';
    const violatedRules: string[] = [];

    if (zScore > 3) {
      result = 'fail';
      violatedRules.push('1-3s (Out of Control)');
    } else if (zScore > 2) {
      result = 'warning';
      violatedRules.push('1-2s (Warning)');
    }

    const newTest: QCTest = {
      testId: `QC-${String(qcTests.length + 1).padStart(3, '0')}`,
      date: new Date().toISOString().split('T')[0],
      time: new Date().toTimeString().slice(0, 5),
      instrument,
      analyte,
      level,
      lotNumber,
      expiryDate,
      observedValue: obs,
      expectedMean: mean,
      expectedSD: sd,
      unit,
      result,
      violatedRules: violatedRules.length > 0 ? violatedRules : undefined,
      performedBy: user?.userId || 'Unknown',
      correctiveAction: correctiveAction || undefined,
      comments: qcComments || undefined
    };

    setQcTests([...qcTests, newTest]);
    alert(`QC test ${newTest.testId} recorded - Result: ${result.toUpperCase()}`);

    // Reset form
    setInstrument('');
    setAnalyte('');
    setLevel('Level 1');
    setLotNumber('');
    setExpiryDate('');
    setObservedValue('');
    setExpectedMean('');
    setExpectedSD('');
    setUnit('');
    setQcComments('');
    setCorrectiveAction('');
    setActiveTab('qcTests');
  };

  const handleSubmitCalibration = (e: React.FormEvent) => {
    e.preventDefault();
    if (!calInstrument || !calibratorLot || !calExpiryDate) {
      alert('Please fill in all required fields');
      return;
    }

    const newCalibration: Calibration = {
      calibrationId: `CAL-${String(calibrations.length + 1).padStart(3, '0')}`,
      date: new Date().toISOString().split('T')[0],
      time: new Date().toTimeString().slice(0, 5),
      instrument: calInstrument,
      calibrationType,
      calibratorLot,
      expiryDate: calExpiryDate,
      result: calResult,
      performedBy: user?.userId || 'Unknown',
      comments: calComments || undefined
    };

    setCalibrations([...calibrations, newCalibration]);
    alert(`Calibration ${newCalibration.calibrationId} recorded successfully`);

    // Reset form
    setCalInstrument('');
    setCalibrationType('full');
    setCalibratorLot('');
    setCalExpiryDate('');
    setCalResult('pass');
    setCalComments('');
    setActiveTab('calibrations');
  };

  const filteredQcTests = qcTests.filter(test => {
    const matchesSearch = 
      test.testId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      test.instrument.toLowerCase().includes(searchTerm.toLowerCase()) ||
      test.analyte.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesInstrument = instrumentFilter === 'all' || test.instrument === instrumentFilter;
    const matchesResult = resultFilter === 'all' || test.result === resultFilter;

    return matchesSearch && matchesInstrument && matchesResult;
  });

  const getResultIcon = (result: string) => {
    switch (result) {
      case 'pass':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      case 'fail':
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return null;
    }
  };

  const getResultBadge = (result: string) => {
    const styles: Record<string, string> = {
      /* eslint-disable @typescript-eslint/naming-convention */
      'pass': 'bg-green-100 text-green-800', // QC result status, not a password
      /* eslint-enable @typescript-eslint/naming-convention */
      warning: 'bg-yellow-100 text-yellow-800',
      fail: 'bg-red-100 text-red-800'
    };
    return styles[result] || 'bg-gray-100 text-gray-800';
  };

  const uniqueInstruments = Array.from(new Set(qcTests.map(t => t.instrument)));

  return (
    <div className="p-6">
      {/* Header with gradient */}
      <div className="bg-gradient-to-r from-green-600 to-emerald-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Beaker className="h-8 w-8" />
            <div>
              <h1 className="text-3xl font-bold">Laboratory Quality Control</h1>
              <p className="text-green-100">Daily QC testing and instrument calibration</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-green-100">Logged in as</p>
            <p className="font-semibold">{user?.userId || 'Unknown'}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b">
        <button
          onClick={() => setActiveTab('qcTests')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'qcTests'
              ? 'text-green-600 border-b-2 border-green-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText className="inline h-4 w-4 mr-2" />
          QC Tests
        </button>
        <button
          onClick={() => setActiveTab('newQC')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'newQC'
              ? 'text-green-600 border-b-2 border-green-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Plus className="inline h-4 w-4 mr-2" />
          New QC Test
        </button>
        <button
          onClick={() => setActiveTab('calibrations')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'calibrations'
              ? 'text-green-600 border-b-2 border-green-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <ThermometerSun className="inline h-4 w-4 mr-2" />
          Calibrations
        </button>
        <button
          onClick={() => setActiveTab('newCalibration')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'newCalibration'
              ? 'text-green-600 border-b-2 border-green-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Plus className="inline h-4 w-4 mr-2" />
          New Calibration
        </button>
      </div>

      {/* QC Tests Tab */}
      {activeTab === 'qcTests' && (
        <div>
          {/* Search and Filters */}
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Search className="inline h-4 w-4 mr-1" />
                  Search
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Test ID, instrument, analyte..."
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Instrument</label>
                <select
                  value={instrumentFilter}
                  onChange={(e) => setInstrumentFilter(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="all">All Instruments</option>
                  {uniqueInstruments.map((inst) => (
                    <option key={inst} value={inst}>{inst}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Result</label>
                <select
                  value={resultFilter}
                  onChange={(e) => setResultFilter(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="all">All Results</option>
                  <option value="pass">Pass</option>
                  <option value="warning">Warning</option>
                  <option value="fail">Fail</option>
                </select>
              </div>
            </div>
          </div>

          {/* QC Tests Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Result</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Test ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Instrument</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Analyte</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Values</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Performed By</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredQcTests.map((test) => (
                    <tr
                      key={test.testId}
                      className={`${test.result === 'fail' ? 'bg-red-50' : test.result === 'warning' ? 'bg-yellow-50' : ''} hover:bg-gray-50`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center space-x-2">
                          {getResultIcon(test.result)}
                          <span className={`px-2 py-1 text-xs font-semibold rounded ${getResultBadge(test.result)}`}>
                            {test.result.toUpperCase()}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{test.testId}</div>
                        <div className="text-xs text-gray-500">{test.date} {test.time}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{test.instrument}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{test.analyte}</div>
                        <div className="text-xs text-gray-500">Lot: {test.lotNumber}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{test.level}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm">
                          <div className="font-medium text-gray-900">Obs: {test.observedValue} {test.unit}</div>
                          <div className="text-xs text-gray-500">Mean: {test.expectedMean} ± {test.expectedSD}</div>
                          <div className="text-xs text-gray-500">
                            Z-score: {((test.observedValue - test.expectedMean) / test.expectedSD).toFixed(2)}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900">{test.performedBy}</div>
                        {test.reviewedBy && (
                          <div className="text-xs text-gray-500">Rev: {test.reviewedBy}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {test.violatedRules && (
                          <div className="text-xs text-red-600 mb-1">
                            {test.violatedRules.map((rule, idx) => (
                              <div key={idx} className="flex items-center">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                {rule}
                              </div>
                            ))}
                          </div>
                        )}
                        {test.correctiveAction && (
                          <div className="text-xs text-blue-600 mb-1">
                            <Activity className="inline h-3 w-3 mr-1" />
                            Action taken
                          </div>
                        )}
                        {test.comments && (
                          <div className="text-xs text-gray-600 italic">{test.comments}</div>
                        )}
                        {test.correctiveAction && (
                          <div className="text-xs text-gray-700 mt-1 bg-blue-50 p-2 rounded">
                            <strong>Corrective Action:</strong> {test.correctiveAction}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* New QC Test Tab */}
      {activeTab === 'newQC' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">New QC Test</h2>
          <form onSubmit={handleSubmitQC}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Instrument */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Instrument <span className="text-red-500">*</span>
                </label>
                <select
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="">Select instrument...</option>
                  <option value="Chemistry Analyzer - Cobas c502">Chemistry Analyzer - Cobas c502</option>
                  <option value="Hematology Analyzer - Sysmex XN-1000">Hematology Analyzer - Sysmex XN-1000</option>
                  <option value="Coagulation Analyzer - ACL Top 750">Coagulation Analyzer - ACL Top 750</option>
                  <option value="Blood Gas Analyzer - ABL90 FLEX">Blood Gas Analyzer - ABL90 FLEX</option>
                  <option value="Immunoassay Analyzer - Architect i2000SR">Immunoassay Analyzer - Architect i2000SR</option>
                </select>
              </div>

              {/* Analyte */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Analyte <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={analyte}
                  onChange={(e) => setAnalyte(e.target.value)}
                  placeholder="e.g., Glucose, WBC, PT"
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* QC Level */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  QC Level <span className="text-red-500">*</span>
                </label>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="Level 1">Level 1 (Low)</option>
                  <option value="Level 2">Level 2 (Normal)</option>
                  <option value="Level 3">Level 3 (High)</option>
                </select>
              </div>

              {/* Lot Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Lot Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="QC material lot number"
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Expiry Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expiry Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Observed Value */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Observed Value <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={observedValue}
                  onChange={(e) => setObservedValue(e.target.value)}
                  placeholder="Measured value"
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Expected Mean */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Mean <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={expectedMean}
                  onChange={(e) => setExpectedMean(e.target.value)}
                  placeholder="Target value"
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Expected SD */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected SD <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={expectedSD}
                  onChange={(e) => setExpectedSD(e.target.value)}
                  placeholder="Standard deviation"
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Unit */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Unit <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="e.g., mg/dL, 10^9/L"
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Corrective Action */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Corrective Action (if out of range)
                </label>
                <textarea
                  value={correctiveAction}
                  onChange={(e) => setCorrectiveAction(e.target.value)}
                  rows={2}
                  placeholder="Document any actions taken if QC failed..."
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>

              {/* Comments */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Comments</label>
                <textarea
                  value={qcComments}
                  onChange={(e) => setQcComments(e.target.value)}
                  rows={2}
                  placeholder="Additional notes..."
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>

            {/* Westgard Rules Info */}
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-2">Westgard Rules Applied</h3>
              <div className="text-sm text-blue-800 space-y-1">
                <p>• <strong>1-2s</strong>: One control exceeds ±2SD (Warning)</p>
                <p>• <strong>1-3s</strong>: One control exceeds ±3SD (Reject/Out of Control)</p>
                <p>• System automatically calculates Z-score and evaluates rules</p>
              </div>
            </div>

            {/* Submit Button */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setActiveTab('qcTests')}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center"
              >
                <Plus className="h-4 w-4 mr-2" />
                Record QC Test
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Calibrations Tab */}
      {activeTab === 'calibrations' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Result</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Calibration ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date/Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Instrument</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Calibrator Lot</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Performed By</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {calibrations.map((cal) => (
                  <tr key={cal.calibrationId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        {getResultIcon(cal.result)}
                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getResultBadge(cal.result)}`}>
                          {cal.result.toUpperCase()}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{cal.calibrationId}</td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{cal.date}</div>
                      <div className="text-xs text-gray-500">{cal.time}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{cal.instrument}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 text-xs font-semibold rounded bg-purple-100 text-purple-800">
                        {cal.calibrationType.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{cal.calibratorLot}</div>
                      <div className="text-xs text-gray-500">Exp: {cal.expiryDate}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{cal.performedBy}</div>
                      {cal.reviewedBy && (
                        <div className="text-xs text-gray-500">Rev: {cal.reviewedBy}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {cal.parameters && (
                        <div className="text-xs space-y-1">
                          {cal.parameters.slice(0, 2).map((param, idx) => (
                            <div key={idx} className="text-gray-700">
                              <strong>{param.analyte}:</strong> R²={param.r2}
                            </div>
                          ))}
                          {cal.parameters.length > 2 && (
                            <div className="text-gray-500">+{cal.parameters.length - 2} more</div>
                          )}
                        </div>
                      )}
                      {cal.comments && (
                        <div className="text-xs text-gray-600 italic mt-1">{cal.comments}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Calibration Tab */}
      {activeTab === 'newCalibration' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">New Calibration</h2>
          <form onSubmit={handleSubmitCalibration}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Instrument */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Instrument <span className="text-red-500">*</span>
                </label>
                <select
                  value={calInstrument}
                  onChange={(e) => setCalInstrument(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="">Select instrument...</option>
                  <option value="Chemistry Analyzer - Cobas c502">Chemistry Analyzer - Cobas c502</option>
                  <option value="Hematology Analyzer - Sysmex XN-1000">Hematology Analyzer - Sysmex XN-1000</option>
                  <option value="Coagulation Analyzer - ACL Top 750">Coagulation Analyzer - ACL Top 750</option>
                  <option value="Blood Gas Analyzer - ABL90 FLEX">Blood Gas Analyzer - ABL90 FLEX</option>
                  <option value="Immunoassay Analyzer - Architect i2000SR">Immunoassay Analyzer - Architect i2000SR</option>
                </select>
              </div>

              {/* Calibration Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Calibration Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={calibrationType}
                  onChange={(e) => setCalibrationType(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="full">Full Calibration</option>
                  <option value="verification">Calibration Verification</option>
                  <option value="linearity">Linearity Check</option>
                </select>
              </div>

              {/* Calibrator Lot */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Calibrator Lot Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={calibratorLot}
                  onChange={(e) => setCalibratorLot(e.target.value)}
                  placeholder="Calibrator lot number"
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Expiry Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expiry Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={calExpiryDate}
                  onChange={(e) => setCalExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Result */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Result <span className="text-red-500">*</span>
                </label>
                <select
                  value={calResult}
                  onChange={(e) => setCalResult(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                </select>
              </div>

              {/* Comments */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Comments</label>
                <textarea
                  value={calComments}
                  onChange={(e) => setCalComments(e.target.value)}
                  rows={3}
                  placeholder="Document calibration parameters, linearity data, or any issues..."
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>

            {/* Info Panel */}
            <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="font-medium text-green-900 mb-2">Calibration Guidelines</h3>
              <ul className="text-sm text-green-800 space-y-1">
                <li>• Full calibration required after reagent change or maintenance</li>
                <li>• Verification calibration required after new lot of calibrator</li>
                <li>• Linearity checks should be performed per manufacturer specifications</li>
                <li>• Run QC immediately after calibration to verify accuracy</li>
              </ul>
            </div>

            {/* Submit Button */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setActiveTab('calibrations')}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center"
              >
                <Plus className="h-4 w-4 mr-2" />
                Record Calibration
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default LabQCPage;
