import { useState, useEffect } from 'react';
import { useAuthStore } from '../store';
import { apiUrl, exportDocumentToPdf, getApiClient, useTranslation } from '@medichain/shared';
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
  Download,
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
  const [exportingId, setExportingId] = useState<string | null>(null);

  useEffect(() => {
    fetchSubmissions();
  }, [filterStatus]);

  const fetchSubmissions = async () => {
    setIsLoading(true);
    try {
      const statusParam = filterStatus === 'all' ? '' : `?status=${filterStatus}`;
      const response = await fetch(apiUrl(`/api/lab/submissions${statusParam}`), {
        headers: {
          ...getApiClient().getSessionHeaders(user?.userId),
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
          ...getApiClient().getSessionHeaders(user?.userId),
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
          ...getApiClient().getSessionHeaders(user?.userId),
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

  const handleExportPdf = async (submission: LabSubmission) => {
    setExportingId(submission.id);
    try {
      const { date, time } = formatTimestamp(submission.submitted_at);
      await exportDocumentToPdf({
        title: submission.test_name,
        subtitle: `${submission.patient_name} (${submission.patient_id}) — ${date} ${time}`,
        filename: `lab-result-${submission.id}.pdf`,
        sections: [
          {
            heading: t('docLabResults.testResults'),
            lines: submission.results.map(
              r => `${r.parameter}: ${r.value} ${r.unit} (${t('docLabResults.colReference')}: ${r.reference_range}${r.flag ? ` — ${r.flag}` : ''})`
            ),
          },
          ...(submission.notes
            ? [{ heading: t('docLabResults.techNotes'), lines: [submission.notes] }]
            : []),
        ],
      });
    } catch (error) {
      console.error('Failed to export lab result PDF:', error);
    } finally {
      setExportingId(null);
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
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-caution-subtle text-caution-subtle-fg">
            <Clock size={12} />
            {t('docLabResults.pendingReview')}
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-ok-subtle text-ok-subtle-fg">
            <CheckCircle size={12} />
            {t('docLabResults.approved')}
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-critical-subtle text-critical-subtle-fg">
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
          <div className="w-10 h-10 bg-surface-sunken rounded-lg flex items-center justify-center">
            <FlaskConical className="text-content-secondary" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-content">{t('docLabResults.title')}</h1>
            <p className="text-content-muted">{t('docLabResults.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-caution-subtle border border-caution rounded-xl p-4">
          <div className="flex items-center gap-3">
            <Clock className="text-caution-subtle-fg" size={24} />
            <div>
              <p className="text-sm text-caution-subtle-fg font-medium">{t('docLabResults.pendingReview')}</p>
              <p className="text-2xl font-bold text-caution-subtle-fg">{pendingCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-ok-subtle border border-ok rounded-xl p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="text-ok-subtle-fg" size={24} />
            <div>
              <p className="text-sm text-ok-subtle-fg font-medium">{t('docLabResults.approvedToday')}</p>
              <p className="text-2xl font-bold text-ok-subtle-fg">0</p>
            </div>
          </div>
        </div>
        <div className="bg-critical-subtle border border-critical rounded-xl p-4">
          <div className="flex items-center gap-3">
            <XCircle className="text-critical-subtle-fg" size={24} />
            <div>
              <p className="text-sm text-critical-subtle-fg font-medium">{t('docLabResults.rejectedToday')}</p>
              <p className="text-2xl font-bold text-critical-subtle-fg">0</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface rounded-xl shadow-sm border border-border p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <label htmlFor="labresults-search" className="sr-only">{t('docLabResults.searchAria')}</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
            <input
              id="labresults-search"
              type="text"
              placeholder={t('docLabResults.searchPh')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
          
          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <label htmlFor="labresults-status-filter" className="sr-only">{t('docLabResults.filterAria')}</label>
            <Filter size={20} className="text-content-muted" aria-hidden="true" />
            <select
              id="labresults-status-filter"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
              className="px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
          <div className="bg-surface rounded-xl shadow-sm border border-border p-12">
            <div className="flex flex-col items-center justify-center">
              <Loader2 className="animate-spin text-content-secondary mb-4" size={40} />
              <p className="text-content-muted">{t('docLabResults.loading')}</p>
            </div>
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="bg-surface rounded-xl shadow-sm border border-border p-12">
            <div className="flex flex-col items-center justify-center">
              <FlaskConical className="text-gray-300 mb-4" size={48} />
              <p className="text-content-muted text-lg font-medium">{t('docLabResults.noSubmissions')}</p>
              <p className="text-content-muted text-sm">
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
                className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden"
              >
                {/* Header */}
                <div
                  className="p-4 cursor-pointer hover:bg-surface-sunken transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : submission.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-surface-sunken rounded-full flex items-center justify-center">
                        <FlaskConical className="text-content-secondary" size={24} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-content">{submission.test_name}</h3>
                        <div className="flex items-center gap-2 text-sm text-content-muted mt-1">
                          <User size={14} />
                          <span>{submission.patient_name}</span>
                          <span className="text-gray-300">•</span>
                          <span>{submission.patient_id}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-content-muted mt-1">
                          <Clock size={12} />
                          <span>{t('docLabResults.submittedAt', { date, time })}</span>
                          <span className="text-gray-300">•</span>
                          <span>{t('docLabResults.byUser', { name: submission.submitted_by })}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(submission.status)}
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-sunken text-content-secondary">
                        {submission.test_category}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="text-content-muted" size={20} />
                      ) : (
                        <ChevronDown className="text-content-muted" size={20} />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t border-border">
                    {/* Results Table */}
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-content flex items-center gap-2">
                          <FileText size={16} />
                          {t('docLabResults.testResults')}
                        </h4>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExportPdf(submission);
                          }}
                          disabled={exportingId === submission.id}
                          className="no-print px-3 py-1.5 text-sm border border-border text-content-secondary rounded-lg hover:bg-surface-sunken transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                          {exportingId === submission.id ? (
                            <Loader2 className="animate-spin" size={14} />
                          ) : (
                            <Download size={14} />
                          )}
                          {exportingId === submission.id ? t('docLabResults.exportingPdf') : t('docLabResults.exportPdf')}
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-2 px-3 font-medium text-content-muted">{t('docLabResults.colParameter')}</th>
                              <th className="text-left py-2 px-3 font-medium text-content-muted">{t('docLabResults.colValue')}</th>
                              <th className="text-left py-2 px-3 font-medium text-content-muted">{t('docLabResults.colUnit')}</th>
                              <th className="text-left py-2 px-3 font-medium text-content-muted">{t('docLabResults.colReference')}</th>
                              <th className="text-left py-2 px-3 font-medium text-content-muted">{t('docLabResults.colFlag')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {submission.results.map((result, idx) => (
                              <tr key={idx} className="border-b border-border last:border-0">
                                <td className="py-2 px-3 text-content">{result.parameter}</td>
                                <td className="py-2 px-3 font-medium text-content">{result.value}</td>
                                <td className="py-2 px-3 text-content-muted">{result.unit}</td>
                                <td className="py-2 px-3 text-content-muted">{result.reference_range}</td>
                                <td className="py-2 px-3">
                                  {result.flag && (
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                                      result.flag === 'HIGH' ? 'bg-critical-subtle text-critical-subtle-fg' :
                                      result.flag === 'LOW' ? 'bg-notice-subtle text-notice-subtle-fg' :
                                      'bg-caution-subtle text-caution-subtle-fg'
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
                        <h4 className="font-medium text-content mb-2">{t('docLabResults.techNotes')}</h4>
                        <p className="text-sm text-content-muted bg-surface-sunken p-3 rounded-lg">{submission.notes}</p>
                      </div>
                    )}

                    {/* Rejection Reason (if rejected) */}
                    {submission.status === 'rejected' && submission.rejection_reason && (
                      <div className="px-4 pb-4">
                        <h4 className="font-medium text-critical-subtle-fg mb-2 flex items-center gap-2">
                          <XCircle size={16} />
                          {t('docLabResults.rejectionReason')}
                        </h4>
                        <p className="text-sm text-critical-subtle-fg bg-critical-subtle p-3 rounded-lg">{submission.rejection_reason}</p>
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
                          className="px-4 py-2 border border-critical text-critical-subtle-fg rounded-lg hover:bg-critical-subtle transition-colors disabled:opacity-50 flex items-center gap-2"
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
                          className="px-4 py-2 bg-ok text-ok-fg rounded-lg hover:bg-ok transition-colors disabled:opacity-50 flex items-center gap-2"
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
          <div className="bg-surface rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
              <XCircle className="text-red-500" size={24} />
              {t('docLabResults.rejectTitle')}
            </h3>
            <label htmlFor="labresults-rejection-reason" className="text-sm text-content-muted mb-4 block">
              {t('docLabResults.rejectPrompt')}
            </label>
            <textarea
              id="labresults-rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder={t('docLabResults.rejectPh')}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
              rows={4}
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => {
                  setShowRejectModal(null);
                  setRejectionReason('');
                }}
                className="px-4 py-2 text-content-muted hover:bg-surface-sunken rounded-lg transition-colors"
              >
                {t('docLabResults.cancel')}
              </button>
              <button
                onClick={() => handleReject(showRejectModal)}
                disabled={!rejectionReason.trim() || isReviewing === showRejectModal}
                className="px-4 py-2 bg-critical text-critical-fg rounded-lg hover:bg-critical transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
