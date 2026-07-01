import React, { useState, useEffect, useCallback } from 'react';
import {
  FlaskConical,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  Calendar,
  User,
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
  Printer,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { getAllLabSubmissions, useTranslation } from '@medichain/shared';

/**
 * LabResultPage
 * 
 * Page for viewing and managing lab results for patients.
 * Implements lab results table, filtering, and result details modal.
 */

type ResultStatus = 'pending' | 'in-progress' | 'completed' | 'cancelled';
type ResultFlag = 'normal' | 'abnormal-low' | 'abnormal-high' | 'critical-low' | 'critical-high';

interface LabTest {
  testCode: string;
  testName: string;
  result: string;
  unit: string;
  referenceRange: string;
  flag: ResultFlag;
}

interface LabResult {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  orderDate: Date;
  collectionDate?: Date;
  resultDate?: Date;
  panelName: string;
  status: ResultStatus;
  orderedBy: string;
  tests: LabTest[];
  specimen: string;
  notes?: string;
}

const LabResultPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'results' | 'pending' | 'critical'>('results');
  const [results, setResults] = useState<LabResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<LabResult | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ResultStatus | 'all'>('all');

  // Fetch lab results from API
  const fetchLabResults = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const submissions = await getAllLabSubmissions();
      // Map API response to LabResult interface
      const mappedResults: LabResult[] = ((submissions as unknown) as unknown[]).map((s: any) => ({
        id: s.id || s.submission_id || '',
        patientId: s.patient_id || s.patientId || '',
        patientName: s.patient_name || s.patientName || t('docLabResult.unknownPatient'),
        mrn: s.mrn || '',
        orderDate: new Date(s.order_date || s.orderDate || Date.now()),
        collectionDate: s.collection_date || s.collectionDate ? new Date(s.collection_date || s.collectionDate!) : undefined,
        resultDate: s.result_date || s.resultDate ? new Date(s.result_date || s.resultDate!) : undefined,
        panelName: s.panel_name || s.panelName || t('docLabResult.unknownPanel'),
        status: (s.status as ResultStatus) || 'pending',
        orderedBy: s.ordered_by || s.orderedBy || '',
        tests: s.tests || [],
        specimen: s.specimen || '',
        notes: s.notes,
      }));
      setResults(mappedResults);
    } catch (err) {
      console.error('Failed to fetch lab results:', err);
      setError(err instanceof Error ? err.message : t('docLabResult.failLoad'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchLabResults();
  }, [fetchLabResults]);

  const getStatusBadge = (status: ResultStatus) => {
    const styles: Record<ResultStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      'pending': { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: <Clock className="w-3 h-3" /> },
      'in-progress': { bg: 'bg-blue-100', text: 'text-blue-700', icon: <RefreshCw className="w-3 h-3" /> },
      'completed': { bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
      'cancelled': { bg: 'bg-gray-100', text: 'text-gray-700', icon: <XCircle className="w-3 h-3" /> }
    };
    const s = styles[status];
    const labels: Record<ResultStatus, string> = {
      'pending': t('docLabResult.statusPending'),
      'in-progress': t('docLabResult.statusInProgress'),
      'completed': t('docLabResult.statusCompleted'),
      'cancelled': t('docLabResult.statusCancelled'),
    };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {labels[status]}
      </span>
    );
  };

  const getFlagBadge = (flag: ResultFlag) => {
    const styles: Record<ResultFlag, { bg: string; text: string; icon: React.ReactNode }> = {
      'normal': { bg: 'bg-green-100', text: 'text-green-700', icon: <Minus className="w-3 h-3" /> },
      'abnormal-low': { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: <TrendingDown className="w-3 h-3" /> },
      'abnormal-high': { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: <TrendingUp className="w-3 h-3" /> },
      'critical-low': { bg: 'bg-red-100', text: 'text-red-700', icon: <TrendingDown className="w-3 h-3" /> },
      'critical-high': { bg: 'bg-red-100', text: 'text-red-700', icon: <TrendingUp className="w-3 h-3" /> }
    };
    const s = styles[flag];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon}
      </span>
    );
  };

  const hasCritical = (result: LabResult) => result.tests.some(tt => tt.flag.includes('critical'));

  const filteredResults = results.filter(r => {
    const matchesSearch = r.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.mrn.includes(searchQuery) ||
      r.panelName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    const matchesTab = activeTab === 'results' ||
      (activeTab === 'pending' && (r.status === 'pending' || r.status === 'in-progress')) ||
      (activeTab === 'critical' && hasCritical(r));
    return matchesSearch && matchesStatus && matchesTab;
  });

  const pendingCount = results.filter(r => r.status === 'pending' || r.status === 'in-progress').length;
  const criticalCount = results.filter(r => hasCritical(r)).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <FlaskConical className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docLabResult.title')}</h1>
        </div>
        <p className="text-emerald-100">{t('docLabResult.subtitle')}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{results.length}</p>
          <p className="text-xs text-gray-500">{t('docLabResult.totalResults')}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
          <p className="text-xs text-gray-500">{t('docLabResult.pendingInProgress')}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
          <p className="text-xs text-gray-500">{t('docLabResult.criticalValues')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {(['results', 'pending', 'critical'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-sm font-medium ${
                activeTab === tab ? 'text-emerald-700 border-b-2 border-emerald-700' : 'text-gray-500'
              }`}
            >
              {tab === 'results' ? t('docLabResult.tabAll') : tab === 'pending' ? t('docLabResult.tabPending', { count: pendingCount }) : t('docLabResult.tabCritical', { count: criticalCount })}
            </button>
          ))}
        </div>
      </div>

      {/* Search & Filter */}
      <div className="p-4 flex gap-2">
        <div className="relative flex-1">
          <label htmlFor="labresult-search" className="sr-only">{t('docLabResult.searchLabel')}</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            id="labresult-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('docLabResult.searchPlaceholder')}
            className="w-full pl-10 pr-4 py-2 border rounded-lg"
          />
        </div>
        <label htmlFor="labresult-status-filter" className="sr-only">{t('docLabResult.filterLabel')}</label>
        <select
          id="labresult-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="border rounded-lg px-3 py-2"
        >
          <option value="all">{t('docLabResult.statusAll')}</option>
          <option value="pending">{t('docLabResult.statusPending')}</option>
          <option value="in-progress">{t('docLabResult.statusInProgress')}</option>
          <option value="completed">{t('docLabResult.statusCompleted')}</option>
        </select>
      </div>

      {/* Results List */}
      <div className="px-4 pb-6 space-y-3">
        {filteredResults.map(result => (
          <div
            key={result.id}
            onClick={() => setSelectedResult(result)}
            className={`bg-white rounded-lg shadow border p-4 cursor-pointer hover:shadow-md transition-shadow ${
              hasCritical(result) ? 'border-l-4 border-l-red-500' : ''
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-semibold">{result.panelName}</h3>
                <p className="text-sm text-gray-500">{result.patientName} • {t('docLabResult.mrn', { mrn: result.mrn })}</p>
              </div>
              {getStatusBadge(result.status)}
            </div>

            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {result.orderDate.toLocaleDateString()}
              </span>
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {result.orderedBy}
              </span>
            </div>

            {result.status === 'completed' && result.tests.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {result.tests.filter(tt => tt.flag !== 'normal').slice(0, 3).map(test => (
                  <span key={test.testCode} className={`text-xs px-2 py-1 rounded ${
                    test.flag.includes('critical') ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {test.testCode}: {test.result} {test.unit}
                  </span>
                ))}
                {result.tests.filter(tt => tt.flag !== 'normal').length > 3 && (
                  <span className="text-xs text-gray-500">{t('docLabResult.more', { count: result.tests.filter(tt => tt.flag !== 'normal').length - 3 })}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Result Detail Modal */}
      {selectedResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{selectedResult.panelName}</h2>
                <p className="text-sm text-gray-500">{selectedResult.patientName} • {t('docLabResult.mrn', { mrn: selectedResult.mrn })}</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 hover:bg-gray-100 rounded"><Download className="w-5 h-5" /></button>
                <button className="p-2 hover:bg-gray-100 rounded"><Printer className="w-5 h-5" /></button>
                <button onClick={() => setSelectedResult(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                <div>
                  <p className="text-gray-500">{t('docLabResult.orderDate')}</p>
                  <p className="font-medium">{selectedResult.orderDate.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-500">{t('docLabResult.collectionDate')}</p>
                  <p className="font-medium">{selectedResult.collectionDate?.toLocaleString() || t('docLabResult.pending')}</p>
                </div>
                <div>
                  <p className="text-gray-500">{t('docLabResult.resultDate')}</p>
                  <p className="font-medium">{selectedResult.resultDate?.toLocaleString() || t('docLabResult.pending')}</p>
                </div>
                <div>
                  <p className="text-gray-500">{t('docLabResult.specimen')}</p>
                  <p className="font-medium">{selectedResult.specimen}</p>
                </div>
              </div>

              {selectedResult.status === 'completed' && selectedResult.tests.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3">{t('docLabResult.colTest')}</th>
                        <th className="text-right p-3">{t('docLabResult.colResult')}</th>
                        <th className="text-center p-3">{t('docLabResult.colFlag')}</th>
                        <th className="text-left p-3">{t('docLabResult.colReferenceRange')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedResult.tests.map(test => (
                        <tr key={test.testCode} className={`border-t ${test.flag.includes('critical') ? 'bg-red-50' : test.flag !== 'normal' ? 'bg-yellow-50' : ''}`}>
                          <td className="p-3">
                            <p className="font-medium">{test.testName}</p>
                            <p className="text-xs text-gray-500">{test.testCode}</p>
                          </td>
                          <td className="p-3 text-right font-mono font-semibold">{test.result} {test.unit}</td>
                          <td className="p-3 text-center">{getFlagBadge(test.flag)}</td>
                          <td className="p-3 text-gray-600">{test.referenceRange} {test.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
                  <p>{t('docLabResult.resultsPending')}</p>
                </div>
              )}

              {selectedResult.notes && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800"><strong>{t('docLabResult.noteLabel')}</strong> {selectedResult.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LabResultPage;
