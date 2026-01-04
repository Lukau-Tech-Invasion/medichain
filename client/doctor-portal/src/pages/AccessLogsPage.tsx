import { useState, useEffect } from 'react';
import { useAuthStore } from '../store';
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

// Mock access logs for demo
const mockAccessLogs: AccessLog[] = [
  {
    access_id: 'ACC-001',
    patient_id: 'PAT-001-DEMO',
    accessor_id: 'DOC-001',
    accessor_role: 'Doctor',
    access_type: 'nfc_tap',
    location: 'Emergency Room A',
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    emergency: true,
  },
  {
    access_id: 'ACC-002',
    patient_id: 'PAT-001-DEMO',
    accessor_id: 'NURSE-001',
    accessor_role: 'Nurse',
    access_type: 'list_records',
    location: null,
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    emergency: false,
  },
  {
    access_id: 'ACC-003',
    patient_id: 'PAT-002',
    accessor_id: 'DOC-001',
    accessor_role: 'Doctor',
    access_type: 'download_record',
    location: null,
    timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    emergency: false,
  },
  {
    access_id: 'ACC-004',
    patient_id: 'PAT-001-DEMO',
    accessor_id: 'LAB-001',
    accessor_role: 'LabTechnician',
    access_type: 'upload_record',
    location: 'Lab Center',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    emergency: false,
  },
  {
    access_id: 'ACC-005',
    patient_id: 'PAT-003',
    accessor_id: 'DOC-001',
    accessor_role: 'Doctor',
    access_type: 'qr_verification',
    location: 'Clinic B',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    emergency: true,
  },
];

function AccessLogsPage() {
  // Note: user is available for future API calls requiring authentication
  const { user: _user } = useAuthStore();
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'emergency' | 'regular'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const logsPerPage = 10;

  useEffect(() => {
    // Simulate API call
    const fetchLogs = async () => {
      setIsLoading(true);
      await new Promise(resolve => setTimeout(resolve, 500));
      setLogs(mockAccessLogs);
      setIsLoading(false);
    };

    fetchLogs();
  }, []);

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
      nfc_tap: 'NFC Card Tap',
      qr_verification: 'QR Code Scan',
      list_records: 'View Records',
      download_record: 'Download Record',
      upload_record: 'Upload Record',
      emergency: 'Emergency Access',
    };
    return labels[type] || type;
  };

  const getAccessTypeIcon = (type: string, emergency: boolean) => {
    if (emergency) {
      return <AlertTriangle className="text-emergency-600" size={16} />;
    }
    switch (type) {
      case 'nfc_tap':
      case 'qr_verification':
        return <Shield className="text-primary-600" size={16} />;
      case 'upload_record':
      case 'download_record':
        return <FileText className="text-gray-600" size={16} />;
      default:
        return <Clock className="text-gray-400" size={16} />;
    }
  };

  // Filter logs
  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.patient_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.accessor_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.access_type.toLowerCase().includes(searchQuery.toLowerCase());
    
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
    // In production, this would generate a CSV/PDF report
    const csvContent = [
      'Access ID,Patient ID,Accessor ID,Role,Access Type,Location,Timestamp,Emergency',
      ...filteredLogs.map(log => 
        `${log.access_id},${log.patient_id},${log.accessor_id},${log.accessor_role},${log.access_type},${log.location || 'N/A'},${log.timestamp},${log.emergency}`
      )
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
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <FileText className="text-primary-600" size={24} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Access Logs</h1>
          </div>
          <p className="text-gray-500">
            Blockchain-verified audit trail of all medical record accesses
          </p>
        </div>
        
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <Download size={18} />
          Export CSV
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Accesses</p>
              <p className="text-2xl font-bold text-gray-900">{logs.length}</p>
            </div>
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <FileText className="text-primary-600" size={20} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Emergency Accesses</p>
              <p className="text-2xl font-bold text-emergency-600">
                {logs.filter(l => l.emergency).length}
              </p>
            </div>
            <div className="w-10 h-10 bg-emergency-100 rounded-lg flex items-center justify-center">
              <AlertTriangle className="text-emergency-600" size={20} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Unique Patients</p>
              <p className="text-2xl font-bold text-gray-900">
                {new Set(logs.map(l => l.patient_id)).size}
              </p>
            </div>
            <div className="w-10 h-10 bg-success-100 rounded-lg flex items-center justify-center">
              <User className="text-success-600" size={20} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Today's Accesses</p>
              <p className="text-2xl font-bold text-gray-900">
                {logs.filter(l => {
                  const today = new Date().toDateString();
                  return new Date(l.timestamp).toDateString() === today;
                }).length}
              </p>
            </div>
            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
              <Calendar className="text-gray-600" size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by patient ID, accessor, or access type..."
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as typeof filterType)}
              className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            >
              <option value="all">All Accesses</option>
              <option value="emergency">Emergency Only</option>
              <option value="regular">Regular Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-primary-600" size={32} />
          </div>
        ) : paginatedLogs.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="mx-auto mb-4 text-gray-300" size={48} />
            <p className="text-gray-500">No access logs found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Access Type
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Patient
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Accessor
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Location
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Timestamp
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedLogs.map((log) => {
                    const { date, time } = formatTimestamp(log.timestamp);
                    return (
                      <tr key={log.access_id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {getAccessTypeIcon(log.access_type, log.emergency)}
                            <span className="text-sm font-medium text-gray-900">
                              {getAccessTypeLabel(log.access_type)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-mono text-gray-900">{log.patient_id}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <span className="text-sm font-mono text-gray-900">{log.accessor_id}</span>
                            <p className="text-xs text-gray-500">{log.accessor_role}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-500">
                            {log.location || '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <span className="text-sm text-gray-900">{date}</span>
                            <p className="text-xs text-gray-500">{time}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {log.emergency ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-emergency-100 text-emergency-700 text-xs font-medium rounded-full">
                              <AlertTriangle size={12} />
                              Emergency
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-success-100 text-success-700 text-xs font-medium rounded-full">
                              <Shield size={12} />
                              Verified
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
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
                <p className="text-sm text-gray-500">
                  Showing {(currentPage - 1) * logsPerPage + 1} to{' '}
                  {Math.min(currentPage * logsPerPage, filteredLogs.length)} of{' '}
                  {filteredLogs.length} results
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <span className="text-sm text-gray-700">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className="mt-6 bg-primary-50 border border-primary-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Shield className="text-primary-600 mt-0.5" size={20} />
          <div>
            <h4 className="font-medium text-primary-900">Blockchain Verified</h4>
            <p className="text-sm text-primary-700 mt-1">
              All access logs are immutably recorded on the MediChain blockchain. 
              Each entry is cryptographically signed and cannot be altered or deleted, 
              ensuring complete HIPAA and GDPR compliance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AccessLogsPage;
