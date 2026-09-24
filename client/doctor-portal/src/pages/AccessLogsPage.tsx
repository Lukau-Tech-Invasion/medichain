import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store';
import {
  getApiClient,
  getApiErrorMessage,
  listEmergencyGrants,
  revokeEmergencyGrant,
  useTranslation,
  formatTimestamp as formatStamp,
} from '@medichain/shared';
import type { EmergencyAccessGrant } from '@medichain/shared';
import { 
  FileText, 
  Search, 
  Filter,
  Calendar,
  User,
  AlertTriangle,
  Shield,
  Clock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download
} from 'lucide-react';
import StaffName, { useStaffDirectory } from '../components/StaffName';

interface AccessLog {
  access_id: string;
  patient_id: string;
  accessor_id: string;
  accessor_role: string;
  access_type: string;
  location: string | null;
  timestamp: string;
  emergency: boolean;
}

function AccessLogsPage() {
  const { t } = useTranslation();
  // Note: user is available for future API calls requiring authentication
  const { user } = useAuthStore();
  // Resolves a wallet to the person's name for the CSV export; the table
  // itself renders `<StaffName>`, which cannot be called inside a `.map()`.
  const staffName = useStaffDirectory();
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // "Nobody has accessed any record" and "the audit trail could not be read"
  // are opposite findings, and an empty list asserts the first.
  const [loadError, setLoadError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'emergency' | 'regular'>('all');
  const [currentPage, setCurrentPage] = useState(1);

  // --- Break-glass grants ----------------------------------------------------
  //
  // An emergency grant could be read only as `GET /api/emergency/grants/{id}`,
  // an id nobody holds unless they issued it. So an administrator could not
  // answer "who is inside a record right now", and the revoke endpoint was
  // effectively unreachable -- finding the grant required already knowing its
  // id. Break-glass access that cannot be reviewed or cut short is not
  // oversight; it is a log nobody reads. `GET /api/emergency/grants` is new.
  //
  // Revoked and expired grants are shown too: during an incident review "who
  // has emergency access" and "who had it" are the same question.
  const [grants, setGrants] = useState<EmergencyAccessGrant[]>([]);
  const [grantsLoaded, setGrantsLoaded] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [grantBusy, setGrantBusy] = useState<string | null>(null);

  const isAdmin = user?.role === 'Admin';

  const loadGrants = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const body = await listEmergencyGrants();
      setGrants(body.grants ?? []);
      setGrantsError(null);
    } catch (err) {
      // An empty list and a failed read are opposite answers to "is anyone
      // inside a record right now".
      setGrantsError(getApiErrorMessage(err, t('docAccessLogs.grantsLoadFailed')));
    } finally {
      setGrantsLoaded(true);
    }
  }, [isAdmin, t]);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  const endGrant = async (grantId: string) => {
    setGrantsError(null);
    setGrantBusy(grantId);
    try {
      await revokeEmergencyGrant(grantId, 'Ended from access review');
      await loadGrants();
    } catch (err) {
      setGrantsError(getApiErrorMessage(err, t('docAccessLogs.grantRevokeFailed')));
    } finally {
      setGrantBusy(null);
    }
  };
  const logsPerPage = 10;

  useEffect(() => {
    const fetchLogs = async () => {
      setIsLoading(true);
      try {
        const user = useAuthStore.getState().user;
        if (!user?.walletAddress) {
          setLogs([]);
          return;
        }
        
        // Fetch all access logs from the access logs endpoint
        const data = await getApiClient().get<
          { access_logs?: AccessLog[]; data?: AccessLog[] } | AccessLog[]
        >('/api/access/logs');
        // Handle both direct array and object with access_logs property
        const logsArray = Array.isArray(data)
          ? data
          : (data.access_logs ?? data.data ?? []);
        setLogs(logsArray);
        setLoadError('');
      } catch (error) {
        console.error('Error fetching access logs:', error);
        // An empty list here reads as "nobody has accessed any record", which
        // on an audit screen is the opposite of "the audit trail could not be
        // read". The `else` branch this replaces set exactly that, silently.
        setLogs([]);
        setLoadError(t('docAccessLogs.loadFailed'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchLogs();
    // `t` is now read inside, for the load-failure message.
  }, [t]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return {
      date: date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      }),
      time: date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
    };
  };

  const getAccessTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      nfc_tap: t('docAccessLogs.typeNfcTap'),
      qr_verification: t('docAccessLogs.typeQr'),
      list_records: t('docAccessLogs.typeListRecords'),
      download_record: t('docAccessLogs.typeDownload'),
      upload_record: t('docAccessLogs.typeUpload'),
      emergency: t('docAccessLogs.typeEmergency'),
    };
    return labels[type] || type;
  };

  const getAccessTypeIcon = (type: string, emergency: boolean) => {
    if (emergency) {
      return <AlertTriangle className="text-critical-subtle-fg" size={16} />;
    }
    switch (type) {
      case 'nfc_tap':
      case 'qr_verification':
        return <Shield className="text-brand" size={16} />;
      case 'upload_record':
      case 'download_record':
        return <FileText className="text-content-muted" size={16} />;
      default:
        return <Clock className="text-content-muted" size={16} />;
    }
  };

  // Filter logs
  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      (log.patient_id?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (log.accessor_id?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (log.access_type?.toLowerCase() || '').includes(searchQuery.toLowerCase());
    
    const matchesFilter = 
      filterType === 'all' || 
      (filterType === 'emergency' && log.emergency) ||
      (filterType === 'regular' && !log.emergency);

    return matchesSearch && matchesFilter;
  });

  // Pagination
  const totalPages = Math.ceil(filteredLogs.length / logsPerPage);
  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * logsPerPage,
    currentPage * logsPerPage
  );

  const handleExport = () => {
    // The accessor's NAME as well as their wallet. This file is the artefact
    // somebody reads during an access review, and a column of SS58 addresses
    // answers "was this access appropriate?" for nobody. The wallet stays
    // beside it because it is the unambiguous identifier.
    const csvContent = [
      'Access ID,Patient ID,Accessor ID,Accessor Name,Role,Access Type,Location,Timestamp,Emergency',
      ...filteredLogs.map(log => {
        const name = (staffName(log.accessor_id) || '').replace(/,/g, ' ');
        return `${log.access_id},${log.patient_id},${log.accessor_id},${name},${log.accessor_role},${log.access_type},${log.location || 'N/A'},${log.timestamp},${log.emergency}`;
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `access-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-brand-subtle rounded-lg flex items-center justify-center">
              <FileText className="text-brand" size={24} />
            </div>
            <h1 className="text-2xl font-bold text-content">{t('docAccessLogs.title')}</h1>
          </div>
          <p className="text-content-muted">
            {t('docAccessLogs.subtitle')}
          </p>
        </div>

        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-surface-sunken text-content-secondary rounded-lg hover:bg-surface-sunken transition-colors"
        >
          <Download size={18} />
          {t('docAccessLogs.exportCsv')}
        </button>
      </div>

      {/* Break-glass grants. Administrators only -- this is the whole
          deployment's emergency activity, naming patients and the clinicians
          who opened their records. */}
      {isAdmin && (
        <div className="bg-surface rounded-xl shadow p-6 mb-8">
          <h2 className="font-semibold text-content mb-1">{t('docAccessLogs.grantsHeading')}</h2>
          <p className="text-sm text-content-muted mb-4">{t('docAccessLogs.grantsSubtitle')}</p>

          {grantsError && (
            <div role="alert" className="mb-4 bg-critical-subtle border border-critical rounded-lg p-3">
              <p className="text-sm text-critical-subtle-fg">{grantsError}</p>
            </div>
          )}

          {!grantsLoaded ? (
            <p className="text-sm text-content-muted">{t('docAccessLogs.grantsLoading')}</p>
          ) : grants.length === 0 ? (
            <p className="text-sm text-content-muted">{t('docAccessLogs.grantsNone')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="grant-table">
                <thead>
                  <tr className="text-left text-content-muted">
                    <th scope="col" className="py-2 pr-4">{t('docAccessLogs.grantPatient')}</th>
                    <th scope="col" className="py-2 pr-4">{t('docAccessLogs.grantClinician')}</th>
                    <th scope="col" className="py-2 pr-4">{t('docAccessLogs.grantReason')}</th>
                    <th scope="col" className="py-2 pr-4">{t('docAccessLogs.grantExpires')}</th>
                    <th scope="col" className="py-2 pr-4">{t('docAccessLogs.grantStatus')}</th>
                    <th scope="col" className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {grants.map((grant) => {
                    // The server's own status, not a time comparison made here:
                    // a grant is active, expired or revoked because the store
                    // says so.
                    const open = grant.status === 'Active' || grant.status === 'active';
                    return (
                      <tr key={grant.id} className="border-t border-border">
                        <td className="py-2 pr-4 text-content">{grant.patient_id}</td>
                        <td className="py-2 pr-4 text-content-secondary break-all">
                          {grant.requesting_person_id}
                        </td>
                        <td className="py-2 pr-4 text-content-secondary">
                          {grant.reason_text || grant.reason_code}
                        </td>
                        <td className="py-2 pr-4 text-content-muted">
                          {formatStamp(grant.expires_at)}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={`px-2 py-1 rounded-full text-xs ${
                              open
                                ? 'bg-critical-subtle text-critical-subtle-fg'
                                : 'bg-surface-sunken text-content-secondary'
                            }`}
                          >
                            {grant.status}
                          </span>
                        </td>
                        <td className="py-2">
                          {open && (
                            <button
                              type="button"
                              onClick={() => void endGrant(grant.id)}
                              disabled={grantBusy === grant.id}
                              className="px-3 py-1 text-xs rounded-lg border border-critical text-critical-subtle-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 min-h-[24px] whitespace-nowrap"
                            >
                              {grantBusy === grant.id
                                ? t('docAccessLogs.grantWorking')
                                : t('docAccessLogs.grantEnd')}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface rounded-xl shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-content-muted">{t('docAccessLogs.totalAccesses')}</p>
              <p className="text-2xl font-bold text-content">{logs.length}</p>
            </div>
            <div className="w-10 h-10 bg-brand-subtle rounded-lg flex items-center justify-center">
              <FileText className="text-brand" size={20} />
            </div>
          </div>
        </div>
        
        <div className="bg-surface rounded-xl shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-content-muted">{t('docAccessLogs.emergencyAccesses')}</p>
              <p className="text-2xl font-bold text-critical-subtle-fg">
                {logs.filter(l => l.emergency).length}
              </p>
            </div>
            <div className="w-10 h-10 bg-critical-subtle rounded-lg flex items-center justify-center">
              <AlertTriangle className="text-critical-subtle-fg" size={20} />
            </div>
          </div>
        </div>
        
        <div className="bg-surface rounded-xl shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-content-muted">{t('docAccessLogs.uniquePatients')}</p>
              <p className="text-2xl font-bold text-content">
                {new Set(logs.map(l => l.patient_id)).size}
              </p>
            </div>
            <div className="w-10 h-10 bg-ok-subtle rounded-lg flex items-center justify-center">
              <User className="text-ok-subtle-fg" size={20} />
            </div>
          </div>
        </div>
        
        <div className="bg-surface rounded-xl shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-content-muted">{t('docAccessLogs.todaysAccesses')}</p>
              <p className="text-2xl font-bold text-content">
                {logs.filter(l => {
                  const today = new Date().toDateString();
                  return new Date(l.timestamp).toDateString() === today;
                }).length}
              </p>
            </div>
            <div className="w-10 h-10 bg-surface-sunken rounded-lg flex items-center justify-center">
              <Calendar className="text-content-muted" size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface rounded-xl shadow p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-content-muted" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('docAccessLogs.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-content-muted" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as typeof filterType)}
              className="px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
            >
              <option value="all">{t('docAccessLogs.filterAll')}</option>
              <option value="emergency">{t('docAccessLogs.filterEmergency')}</option>
              <option value="regular">{t('docAccessLogs.filterRegular')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-surface rounded-xl shadow overflow-hidden">
        {loadError && (
          <div role="alert" className="mb-4 p-3 rounded-lg bg-critical-subtle text-critical-subtle-fg text-sm">
            {loadError}
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-brand" size={32} />
          </div>
        ) : paginatedLogs.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="mx-auto mb-4 text-content-muted" size={48} />
            <p className="text-content-muted">{t('docAccessLogs.noneFound')}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-sunken border-b border-border">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs font-medium text-content-muted uppercase tracking-wider">
                      {t('docAccessLogs.colAccessType')}
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-content-muted uppercase tracking-wider">
                      {t('docAccessLogs.colPatient')}
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-content-muted uppercase tracking-wider">
                      {t('docAccessLogs.colAccessor')}
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-content-muted uppercase tracking-wider">
                      {t('docAccessLogs.colLocation')}
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-content-muted uppercase tracking-wider">
                      {t('docAccessLogs.colTimestamp')}
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-content-muted uppercase tracking-wider">
                      {t('docAccessLogs.colStatus')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginatedLogs.map((log) => {
                    const { date, time } = formatTimestamp(log.timestamp);
                    return (
                      <tr key={log.access_id} className="hover:bg-surface-sunken">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {getAccessTypeIcon(log.access_type, log.emergency)}
                            <span className="text-sm font-medium text-content">
                              {getAccessTypeLabel(log.access_type)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-mono text-content">{log.patient_id}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <StaffName id={log.accessor_id} className="text-sm text-content" />
                            <p className="text-xs text-content-muted">{log.accessor_role}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-content-muted">
                            {log.location || '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <span className="text-sm text-content">{date}</span>
                            <p className="text-xs text-content-muted">{time}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {log.emergency ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-critical-subtle text-critical-subtle-fg text-xs font-medium rounded-full">
                              <AlertTriangle size={12} />
                              {t('docAccessLogs.statusEmergency')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-ok-subtle text-ok-subtle-fg text-xs font-medium rounded-full">
                              <Shield size={12} />
                              {t('docAccessLogs.statusVerified')}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-border">
                <p className="text-sm text-content-muted">
                  {t('docAccessLogs.showingResults', {
                    from: (currentPage - 1) * logsPerPage + 1,
                    to: Math.min(currentPage * logsPerPage, filteredLogs.length),
                    total: filteredLogs.length,
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg hover:bg-surface-sunken disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <span className="text-sm text-content-secondary">
                    {t('docAccessLogs.pageOf', { current: currentPage, total: totalPages })}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-lg hover:bg-surface-sunken disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Blockchain Notice */}
      <div className="mt-6 bg-brand-subtle border border-brand rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Shield className="text-brand mt-0.5" size={20} />
          <div>
            <h4 className="font-medium text-brand-subtle-fg">{t('docAccessLogs.blockchainVerified')}</h4>
            <p className="text-sm text-brand mt-1">
              {t('docAccessLogs.blockchainBody')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AccessLogsPage;
