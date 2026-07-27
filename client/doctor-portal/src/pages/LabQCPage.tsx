import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { listLabQc, createLabQc, useTranslation } from '@medichain/shared';
import { CheckCircle, XCircle, AlertTriangle, Activity, FileText, Search, Plus, Beaker, ThermometerSun, RefreshCw } from 'lucide-react';
import { useToastActions } from '../components/Toast';

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
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
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
      setError(err instanceof Error ? err.message : t('docLabQC.errorFetch'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, user]);

  const handleSubmitQC = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instrument || !analyte || !observedValue || !expectedMean || !expectedSD) {
      showWarning(t('docLabQC.warningRequiredFields'));
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
      violatedRules.push(t('docLabQC.violatedRule13s'));
    } else if (zScore > 2) {
      result = 'warning';
      violatedRules.push(t('docLabQC.violatedRule12s'));
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

    // Persist to the backend (was: local state only)
    try {
      await createLabQc(newTest);
      showSuccess(t('docLabQC.qcRecordedSuccess', { id: newTest.testId, result: result.toUpperCase() }));
    } catch {
      showWarning(t('docLabQC.qcRecordedLocally', { id: newTest.testId }));
    }
    setQcTests([...qcTests, newTest]);

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
      showWarning(t('docLabQC.warningRequiredFields'));
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
    showSuccess(t('docLabQC.calibrationRecordedSuccess', { id: newCalibration.calibrationId }));

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
      'pass': 'bg-green-100 text-green-800',
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
              <h1 className="text-3xl font-bold">{t('docLabQC.title')}</h1>
              <p className="text-green-100">{t('docLabQC.subtitle')}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-green-100">{t('docLabQC.loggedInAs')}</p>
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
          {t('docLabQC.tabQcTests')}
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
          {t('docLabQC.tabNewQC')}
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
          {t('docLabQC.tabCalibrations')}
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
          {t('docLabQC.tabNewCalibration')}
        </button>
      </div>

      {/* QC Tests Tab */}
      {activeTab === 'qcTests' && (
        <div>
          {/* Search and Filters */}
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="labqc-search" className="block text-sm font-medium text-gray-700 mb-1">
                  <Search className="inline h-4 w-4 mr-1" />
                  {t('docLabQC.searchLabel')}
                </label>
                <input
                  id="labqc-search"
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t('docLabQC.searchPh')}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
              <div>
                <label htmlFor="labqc-instrument-filter" className="block text-sm font-medium text-gray-700 mb-1">{t('docLabQC.instrumentLabel')}</label>
                <select
                  id="labqc-instrument-filter"
                  value={instrumentFilter}
                  onChange={(e) => setInstrumentFilter(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="all">{t('docLabQC.allInstruments')}</option>
                  {uniqueInstruments.map((inst) => (
                    <option key={inst} value={inst}>{inst}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="labqc-result-filter" className="block text-sm font-medium text-gray-700 mb-1">{t('docLabQC.resultLabel')}</label>
                <select
                  id="labqc-result-filter"
                  value={resultFilter}
                  onChange={(e) => setResultFilter(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="all">{t('docLabQC.allResults')}</option>
                  <option value="pass">{t('docLabQC.result_pass')}</option>
                  <option value="warning">{t('docLabQC.result_warning')}</option>
                  <option value="fail">{t('docLabQC.result_fail')}</option>
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableResult')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableTestId')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableInstrument')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableAnalyte')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableLevel')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableValues')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tablePerformedBy')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableDetails')}</th>
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
                            {t(`docLabQC.result_${test.result}`).toUpperCase()}
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
                        <div className="text-xs text-gray-500">{t('docLabQC.lotLine', { lot: test.lotNumber })}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{test.level}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm">
                          <div className="font-medium text-gray-900">{t('docLabQC.obsLine', { value: test.observedValue, unit: test.unit })}</div>
                          <div className="text-xs text-gray-500">{t('docLabQC.meanSdLine', { mean: test.expectedMean, sd: test.expectedSD })}</div>
                          <div className="text-xs text-gray-500">
                            {t('docLabQC.zScoreLine', { score: ((test.observedValue - test.expectedMean) / test.expectedSD).toFixed(2) })}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900">{test.performedBy}</div>
                        {test.reviewedBy && (
                          <div className="text-xs text-gray-500">{t('docLabQC.revLine', { name: test.reviewedBy })}</div>
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
                            {t('docLabQC.actionTaken')}
                          </div>
                        )}
                        {test.comments && (
                          <div className="text-xs text-gray-600 italic">{test.comments}</div>
                        )}
                        {test.correctiveAction && (
                          <div className="text-xs text-gray-700 mt-1 bg-blue-50 p-2 rounded">
                            <strong>{t('docLabQC.correctiveActionPrefix')}</strong> {test.correctiveAction}
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
          <h2 className="text-xl font-bold mb-4">{t('docLabQC.newQcTestHeading')}</h2>
          <form onSubmit={handleSubmitQC}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Instrument */}
              <div>
                <label htmlFor="labqc-instrument" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.instrumentRequired')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="labqc-instrument"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="">{t('docLabQC.selectInstrumentPh')}</option>
                  <option value="Chemistry Analyzer - Cobas c502">Chemistry Analyzer - Cobas c502</option>
                  <option value="Hematology Analyzer - Sysmex XN-1000">Hematology Analyzer - Sysmex XN-1000</option>
                  <option value="Coagulation Analyzer - ACL Top 750">Coagulation Analyzer - ACL Top 750</option>
                  <option value="Blood Gas Analyzer - ABL90 FLEX">Blood Gas Analyzer - ABL90 FLEX</option>
                  <option value="Immunoassay Analyzer - Architect i2000SR">Immunoassay Analyzer - Architect i2000SR</option>
                </select>
              </div>

              {/* Analyte */}
              <div>
                <label htmlFor="labqc-analyte" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.analyteRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="labqc-analyte"
                  type="text"
                  value={analyte}
                  onChange={(e) => setAnalyte(e.target.value)}
                  placeholder={t('docLabQC.analytePh')}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* QC Level */}
              <div>
                <label htmlFor="labqc-level" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.qcLevelRequired')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="labqc-level"
                  value={level}
                  onChange={(e) => setLevel(e.target.value as typeof level)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="Level 1">{t('docLabQC.level1')}</option>
                  <option value="Level 2">{t('docLabQC.level2')}</option>
                  <option value="Level 3">{t('docLabQC.level3')}</option>
                </select>
              </div>

              {/* Lot Number */}
              <div>
                <label htmlFor="labqc-lot-number" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.lotNumberRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="labqc-lot-number"
                  type="text"
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder={t('docLabQC.lotNumberPh')}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Expiry Date */}
              <div>
                <label htmlFor="labqc-expiry-date" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.expiryDateRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="labqc-expiry-date"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Observed Value */}
              <div>
                <label htmlFor="labqc-observed-value" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.observedValueRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="labqc-observed-value"
                  type="number"
                  step="0.01"
                  value={observedValue}
                  onChange={(e) => setObservedValue(e.target.value)}
                  placeholder={t('docLabQC.observedValuePh')}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Expected Mean */}
              <div>
                <label htmlFor="labqc-expected-mean" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.expectedMeanRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="labqc-expected-mean"
                  type="number"
                  step="0.01"
                  value={expectedMean}
                  onChange={(e) => setExpectedMean(e.target.value)}
                  placeholder={t('docLabQC.expectedMeanPh')}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Expected SD */}
              <div>
                <label htmlFor="labqc-expected-sd" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.expectedSdRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="labqc-expected-sd"
                  type="number"
                  step="0.01"
                  value={expectedSD}
                  onChange={(e) => setExpectedSD(e.target.value)}
                  placeholder={t('docLabQC.expectedSdPh')}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Unit */}
              <div>
                <label htmlFor="labqc-unit" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.unitRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="labqc-unit"
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder={t('docLabQC.unitPh')}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Corrective Action */}
              <div className="md:col-span-2">
                <label htmlFor="labqc-corrective-action" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.correctiveActionLabel')}
                </label>
                <textarea
                  id="labqc-corrective-action"
                  value={correctiveAction}
                  onChange={(e) => setCorrectiveAction(e.target.value)}
                  rows={2}
                  placeholder={t('docLabQC.correctiveActionPh')}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>

              {/* Comments */}
              <div className="md:col-span-2">
                <label htmlFor="labqc-comments" className="block text-sm font-medium text-gray-700 mb-1">{t('docLabQC.commentsLabel')}</label>
                <textarea
                  id="labqc-comments"
                  value={qcComments}
                  onChange={(e) => setQcComments(e.target.value)}
                  rows={2}
                  placeholder={t('docLabQC.commentsPh')}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>

            {/* Westgard Rules Info */}
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-2">{t('docLabQC.westgardRulesHeading')}</h3>
              <div className="text-sm text-blue-800 space-y-1">
                <p>• <strong>1-2s</strong>: {t('docLabQC.westgardRule12s')}</p>
                <p>• <strong>1-3s</strong>: {t('docLabQC.westgardRule13s')}</p>
                <p>• {t('docLabQC.westgardAutoNote')}</p>
              </div>
            </div>

            {/* Submit Button */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setActiveTab('qcTests')}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                {t('docLabQC.cancelButton')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('docLabQC.recordQcTestButton')}
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableResult')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableCalibrationId')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableDateTime')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableInstrument')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableType')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableCalibratorLot')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tablePerformedBy')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('docLabQC.tableDetails')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {calibrations.map((cal) => (
                  <tr key={cal.calibrationId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        {getResultIcon(cal.result)}
                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getResultBadge(cal.result)}`}>
                          {t(`docLabQC.result_${cal.result}`).toUpperCase()}
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
                        {t(`docLabQC.calTypeBadge_${cal.calibrationType}`).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{cal.calibratorLot}</div>
                      <div className="text-xs text-gray-500">{t('docLabQC.expLine', { date: cal.expiryDate })}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{cal.performedBy}</div>
                      {cal.reviewedBy && (
                        <div className="text-xs text-gray-500">{t('docLabQC.revLine', { name: cal.reviewedBy })}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {cal.parameters && (
                        <div className="text-xs space-y-1">
                          {cal.parameters.slice(0, 2).map((param, idx) => (
                            <div key={idx} className="text-gray-700">
                              <strong>{param.analyte}:</strong> {t('docLabQC.rSquaredLine', { value: param.r2 })}
                            </div>
                          ))}
                          {cal.parameters.length > 2 && (
                            <div className="text-gray-500">{t('docLabQC.moreCountLine', { count: cal.parameters.length - 2 })}</div>
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
          <h2 className="text-xl font-bold mb-4">{t('docLabQC.newCalibrationHeading')}</h2>
          <form onSubmit={handleSubmitCalibration}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Instrument */}
              <div>
                <label htmlFor="labqc-cal-instrument" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.instrumentRequired')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="labqc-cal-instrument"
                  value={calInstrument}
                  onChange={(e) => setCalInstrument(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="">{t('docLabQC.selectInstrumentPh')}</option>
                  <option value="Chemistry Analyzer - Cobas c502">Chemistry Analyzer - Cobas c502</option>
                  <option value="Hematology Analyzer - Sysmex XN-1000">Hematology Analyzer - Sysmex XN-1000</option>
                  <option value="Coagulation Analyzer - ACL Top 750">Coagulation Analyzer - ACL Top 750</option>
                  <option value="Blood Gas Analyzer - ABL90 FLEX">Blood Gas Analyzer - ABL90 FLEX</option>
                  <option value="Immunoassay Analyzer - Architect i2000SR">Immunoassay Analyzer - Architect i2000SR</option>
                </select>
              </div>

              {/* Calibration Type */}
              <div>
                <label htmlFor="labqc-cal-type" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.calibrationTypeRequired')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="labqc-cal-type"
                  value={calibrationType}
                  onChange={(e) => setCalibrationType(e.target.value as typeof calibrationType)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="full">{t('docLabQC.calType_full')}</option>
                  <option value="verification">{t('docLabQC.calType_verification')}</option>
                  <option value="linearity">{t('docLabQC.calType_linearity')}</option>
                </select>
              </div>

              {/* Calibrator Lot */}
              <div>
                <label htmlFor="labqc-cal-lot" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.calibratorLotRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="labqc-cal-lot"
                  type="text"
                  value={calibratorLot}
                  onChange={(e) => setCalibratorLot(e.target.value)}
                  placeholder={t('docLabQC.calibratorLotPh')}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Expiry Date */}
              <div>
                <label htmlFor="labqc-cal-expiry-date" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.expiryDateRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="labqc-cal-expiry-date"
                  type="date"
                  value={calExpiryDate}
                  onChange={(e) => setCalExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Result */}
              <div>
                <label htmlFor="labqc-cal-result" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('docLabQC.resultRequired')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="labqc-cal-result"
                  value={calResult}
                  onChange={(e) => setCalResult(e.target.value as typeof calResult)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="pass">{t('docLabQC.result_pass')}</option>
                  <option value="fail">{t('docLabQC.result_fail')}</option>
                </select>
              </div>

              {/* Comments */}
              <div className="md:col-span-2">
                <label htmlFor="labqc-cal-comments" className="block text-sm font-medium text-gray-700 mb-1">{t('docLabQC.commentsLabel')}</label>
                <textarea
                  id="labqc-cal-comments"
                  value={calComments}
                  onChange={(e) => setCalComments(e.target.value)}
                  rows={3}
                  placeholder={t('docLabQC.calCommentsPh')}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>

            {/* Info Panel */}
            <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="font-medium text-green-900 mb-2">{t('docLabQC.calibrationGuidelinesHeading')}</h3>
              <ul className="text-sm text-green-800 space-y-1">
                <li>• {t('docLabQC.guideline_full')}</li>
                <li>• {t('docLabQC.guideline_verification')}</li>
                <li>• {t('docLabQC.guideline_linearity')}</li>
                <li>• {t('docLabQC.guideline_qcAfter')}</li>
              </ul>
            </div>

            {/* Submit Button */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setActiveTab('calibrations')}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                {t('docLabQC.cancelButton')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('docLabQC.recordCalibrationButton')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default LabQCPage;
