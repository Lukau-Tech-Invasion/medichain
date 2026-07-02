import { useState, useEffect } from 'react';
import { useAuthStore } from '../store';
import { apiUrl, useTranslation } from '@medichain/shared';
import {
  FlaskConical,
  Search,
  Filter,
  Clock,
  CheckCircle,
  XCircle,
  User,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
} from 'lucide-react';

interface LabTestResult {
  parameter: string;
  value: string;
  unit: string;
  reference_range: string;
  flag?: string;
}

interface LabSubmission {
  id: string;
  patient_id: string;
  patient_name: string;
  test_name: string;
  test_category: string;
  results: LabTestResult[];
  notes?: string;
  submitted_by: string;
  submitted_at: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: string;
  reviewed_at?: string;
  rejection_reason?: string;
}

function LabResultsPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [submissions, setSubmissions] = useState<LabSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);

  useEffect(() => {
    fetchSubmissions();
  }, [filterStatus]);

  const fetchSubmissions = async () => {
    setIsLoading(true);
    try {
      const statusParam = filterStatus === 'all' ? '' : `?status=${filterStatus}`;
      const response = await fetch(apiUrl(`/api/lab/submissions${statusParam}`), {
        headers: {
          'X-User-Id': user?.userId || '',
        },
      });
      if (response.ok) {
        const data = await response.json();
        // Handle both array response and object with submissions field
        const submissionsArray = Array.isArray(data) ? data : (data.submissions || data.results || []);
        setSubmissions(submissionsArray);
      } else {
        console.error('Failed to fetch lab submissions');
        setSubmissions([]);
      }
    } catch (error) {
      console.error('Error fetching lab submissions:', error);
      setSubmissions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (submissionId: string) => {
    setIsReviewing(submissionId);
    try {
      const response = await fetch(apiUrl(`/api/lab/submissions/${submissionId}/review`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user?.userId || '',
        },
        body: JSON.stringify({ action: 'approve' }),
      });
      
      if (response.ok) {
        // Update local state
        setSubmissions(prev => 
          prev.map(s => 
            s.id === submissionId 
              ? { ...s, status: 'approved' as const, reviewed_by: user?.userId, reviewed_at: new Date().toISOString() }
              : s
          )
        );
      } else {
        console.error('Failed to approve submission');
      }
    } catch (error) {
      console.error('Failed to approve:', error);
    } finally {
      setIsReviewing(null);
    }
  };

  const handleReject = async (submissionId: string) => {
    if (!rejectionReason.trim()) return;
    
    setIsReviewing(submissionId);
    try {
      const response = await fetch(apiUrl(`/api/lab/submissions/${submissionId}/review`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user?.userId || '',
        },
        body: JSON.stringify({ action: 'reject', rejection_reason: rejectionReason }),
      });
      
      if (response.ok) {
        // Update local state
        setSubmissions(prev => 
          prev.map(s => 
            s.id === submissionId 
              ? { 
                  ...s, 
                  status: 'rejected' as const, 
                  reviewed_by: user?.userId, 
                  reviewed_at: new Date().toISOString(),
                  rejection_reason: rejectionReason,
                }
              : s
          )
        );
        setShowRejectModal(null);
        setRejectionReason('');
      } else {
        console.error('Failed to reject submission');
      }
    } catch (error) {
      console.error('Failed to reject:', error);
    } finally {
      setIsReviewing(null);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return {
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    };
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <Clock size={12} />
            {t('docLabResults.pendingReview')}
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle size={12} />
            {t('docLabResults.approved')}
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <XCircle size={12} />
            {t('docLabResults.rejected')}
          </span>
        );
      default:
        return null;
    }
  };

  const filteredSubmissions = submissions.filter(submission => {
    const matchesSearch = 
      submission.patient_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      submission.test_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      submission.patient_id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const pendingCount = submissions.filter(s => s.status === 'pending').length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
            <FlaskConical className="text-purple-600" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('docLabResults.title')}</h1>
            <p className="text-gray-500">{t('docLabResults.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <Clock className="text-yellow-600" size={24} />
            <div>
              <p className="text-sm text-yellow-600 font-medium">{t('docLabResults.pendingReview')}</p>
              <p className="text-2xl font-bold text-yellow-800">{pendingCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="text-green-600" size={24} />
            <div>
              <p className="text-sm text-green-600 font-medium">{t('docLabResults.approvedToday')}</p>
              <p className="text-2xl font-bold text-green-800">0</p>
            </div>
          </div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <XCircle className="text-red-600" size={24} />
            <div>
              <p className="text-sm text-red-600 font-medium">{t('docLabResults.rejectedToday')}</p>
              <p className="text-2xl font-bold text-red-800">0</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <label htmlFor="labresults-search" className="sr-only">{t('docLabResults.searchAria')}</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              id="labresults-search"
              type="text"
              placeholder={t('docLabResults.searchPh')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
          
          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <label htmlFor="labresults-status-filter" className="sr-only">{t('docLabResults.filterAria')}</label>
            <Filter size={20} className="text-gray-400" aria-hidden="true" />
            <select
              id="labresults-status-filter"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
              className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="pending">{t('docLabResults.optPending')}</option>
              <option value="approved">{t('docLabResults.approved')}</option>
              <option value="rejected">{t('docLabResults.rejected')}</option>
              <option value="all">{t('docLabResults.optAll')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Submissions List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
            <div className="flex flex-col items-center justify-center">
              <Loader2 className="animate-spin text-purple-600 mb-4" size={40} />
              <p className="text-gray-500">{t('docLabResults.loading')}</p>
            </div>
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
            <div className="flex flex-col items-center justify-center">
              <FlaskConical className="text-gray-300 mb-4" size={48} />
              <p className="text-gray-500 text-lg font-medium">{t('docLabResults.noSubmissions')}</p>
              <p className="text-gray-400 text-sm">
                {filterStatus === 'pending' ? t('docLabResults.allReviewed') : t('docLabResults.adjustFilters')}
              </p>
            </div>
          </div>
        ) : (
          filteredSubmissions.map((submission) => {
            const isExpanded = expandedId === submission.id;
            const { date, time } = formatTimestamp(submission.submitted_at);

            return (
              <div
                key={submission.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
              >
                {/* Header */}
                <div
                  className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : submission.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                        <FlaskConical className="text-purple-600" size={24} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{submission.test_name}</h3>
                        <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                          <User size={14} />
                          <span>{submission.patient_name}</span>
                          <span className="text-gray-300">•</span>
                          <span>{submission.patient_id}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                          <Clock size={12} />
                          <span>{t('docLabResults.submittedAt', { date, time })}</span>
                          <span className="text-gray-300">•</span>
                          <span>{t('docLabResults.byUser', { name: submission.submitted_by })}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(submission.status)}
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {submission.test_category}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="text-gray-400" size={20} />
                      ) : (
                        <ChevronDown className="text-gray-400" size={20} />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t border-gray-200">
                    {/* Results Table */}
                    <div className="p-4">
                      <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                        <FileText size={16} />
                        {t('docLabResults.testResults')}
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-2 px-3 font-medium text-gray-600">{t('docLabResults.colParameter')}</th>
                              <th className="text-left py-2 px-3 font-medium text-gray-600">{t('docLabResults.colValue')}</th>
                              <th className="text-left py-2 px-3 font-medium text-gray-600">{t('docLabResults.colUnit')}</th>
                              <th className="text-left py-2 px-3 font-medium text-gray-600">{t('docLabResults.colReference')}</th>
                              <th className="text-left py-2 px-3 font-medium text-gray-600">{t('docLabResults.colFlag')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {submission.results.map((result, idx) => (
                              <tr key={idx} className="border-b border-gray-100 last:border-0">
                                <td className="py-2 px-3 text-gray-900">{result.parameter}</td>
                                <td className="py-2 px-3 font-medium text-gray-900">{result.value}</td>
                                <td className="py-2 px-3 text-gray-500">{result.unit}</td>
                                <td className="py-2 px-3 text-gray-500">{result.reference_range}</td>
                                <td className="py-2 px-3">
                                  {result.flag && (
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                                      result.flag === 'HIGH' ? 'bg-red-100 text-red-700' :
                                      result.flag === 'LOW' ? 'bg-blue-100 text-blue-700' :
                                      'bg-yellow-100 text-yellow-700'
                                    }`}>
                                      <AlertTriangle size={10} />
                                      {result.flag}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Notes */}
                    {submission.notes && (
                      <div className="px-4 pb-4">
                        <h4 className="font-medium text-gray-900 mb-2">{t('docLabResults.techNotes')}</h4>
                        <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">{submission.notes}</p>
                      </div>
                    )}

                    {/* Rejection Reason (if rejected) */}
                    {submission.status === 'rejected' && submission.rejection_reason && (
                      <div className="px-4 pb-4">
                        <h4 className="font-medium text-red-700 mb-2 flex items-center gap-2">
                          <XCircle size={16} />
                          {t('docLabResults.rejectionReason')}
                        </h4>
                        <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{submission.rejection_reason}</p>
                      </div>
                    )}

                    {/* Actions (only for pending) */}
                    {submission.status === 'pending' && (
                      <div className="px-4 pb-4 flex justify-end gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowRejectModal(submission.id);
                          }}
                          disabled={isReviewing === submission.id}
                          className="px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                          <XCircle size={18} />
                          {t('docLabResults.reject')}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleApprove(submission.id);
                          }}
                          disabled={isReviewing === submission.id}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                          {isReviewing === submission.id ? (
                            <Loader2 className="animate-spin" size={18} />
                          ) : (
                            <CheckCircle size={18} />
                          )}
                          {t('docLabResults.approve')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <XCircle className="text-red-500" size={24} />
              {t('docLabResults.rejectTitle')}
            </h3>
            <label htmlFor="labresults-rejection-reason" className="text-sm text-gray-600 mb-4 block">
              {t('docLabResults.rejectPrompt')}
            </label>
            <textarea
              id="labresults-rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder={t('docLabResults.rejectPh')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
              rows={4}
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => {
                  setShowRejectModal(null);
                  setRejectionReason('');
                }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
              >
                {t('docLabResults.cancel')}
              </button>
              <button
                onClick={() => handleReject(showRejectModal)}
                disabled={!rejectionReason.trim() || isReviewing === showRejectModal}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isReviewing === showRejectModal ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  <XCircle size={18} />
                )}
                {t('docLabResults.rejectSubmission')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LabResultsPage;
