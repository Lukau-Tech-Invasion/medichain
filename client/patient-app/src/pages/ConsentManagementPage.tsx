import { useState, useEffect } from 'react';
import {
  Shield,
  UserCheck,
  UserX,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronRight,
  Plus,
  Search,
  Calendar,
  Building2,
  Stethoscope,
  Eye,
  FileText,
  X,
  History,
} from 'lucide-react';

interface AccessGrant {
  id: string;
  providerId: string;
  providerName: string;
  providerRole: string;
  organization: string;
  accessType: 'full' | 'limited' | 'emergency';
  grantedAt: string;
  expiresAt: string | null;
  status: 'active' | 'expired' | 'revoked';
  lastAccessed: string | null;
  accessCount: number;
}

interface AccessRequest {
  id: string;
  providerId: string;
  providerName: string;
  providerRole: string;
  organization: string;
  requestedAt: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
}

/**
 * Consent Management Page
 * 
 * Manage who can access your medical records.
 * Grant, revoke, and review access permissions.
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function ConsentManagementPage() {
  const [activeTab, setActiveTab] = useState<'grants' | 'requests' | 'history'>('grants');
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGrant, setSelectedGrant] = useState<AccessGrant | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Demo grants
    const demoGrants: AccessGrant[] = [
      {
        id: '1',
        providerId: 'DOC-001',
        providerName: 'Dr. Sarah Smith',
        providerRole: 'Doctor',
        organization: 'City General Hospital',
        accessType: 'full',
        grantedAt: '2025-06-15T10:00:00Z',
        expiresAt: null,
        status: 'active',
        lastAccessed: '2026-01-04T09:30:00Z',
        accessCount: 24,
      },
      {
        id: '2',
        providerId: 'NURSE-001',
        providerName: 'Nurse Johnson',
        providerRole: 'Nurse',
        organization: 'City General Hospital',
        accessType: 'limited',
        grantedAt: '2025-12-01T14:00:00Z',
        expiresAt: '2026-06-01T14:00:00Z',
        status: 'active',
        lastAccessed: '2026-01-03T11:15:00Z',
        accessCount: 8,
      },
      {
        id: '3',
        providerId: 'LAB-001',
        providerName: 'Lab Technician',
        providerRole: 'LabTechnician',
        organization: 'PathLab Diagnostics',
        accessType: 'limited',
        grantedAt: '2025-11-20T09:00:00Z',
        expiresAt: '2026-02-20T09:00:00Z',
        status: 'active',
        lastAccessed: '2026-01-04T08:00:00Z',
        accessCount: 3,
      },
      {
        id: '4',
        providerId: 'DOC-002',
        providerName: 'Dr. Michael Brown',
        providerRole: 'Doctor',
        organization: 'Emergency Response Unit',
        accessType: 'emergency',
        grantedAt: '2025-10-15T16:30:00Z',
        expiresAt: '2025-10-15T16:45:00Z',
        status: 'expired',
        lastAccessed: '2025-10-15T16:32:00Z',
        accessCount: 1,
      },
    ];

    // Demo requests
    const demoRequests: AccessRequest[] = [
      {
        id: '1',
        providerId: 'PHARM-001',
        providerName: 'PharmaCare Pharmacy',
        providerRole: 'Pharmacist',
        organization: 'PharmaCare Chain',
        requestedAt: '2026-01-04T10:00:00Z',
        reason: 'Verify prescription for medication refill',
        status: 'pending',
      },
      {
        id: '2',
        providerId: 'DOC-003',
        providerName: 'Dr. Emily Chen',
        providerRole: 'Doctor',
        organization: 'Specialist Clinic',
        requestedAt: '2026-01-03T15:30:00Z',
        reason: 'Referral consultation for diabetes management',
        status: 'pending',
      },
    ];

    setGrants(demoGrants);
    setRequests(demoRequests);
    setIsLoading(false);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getAccessTypeColor = (type: string) => {
    switch (type) {
      case 'full':
        return 'bg-success-100 text-success-700';
      case 'limited':
        return 'bg-info-light text-info';
      case 'emergency':
        return 'bg-emergency-100 text-emergency-600';
      default:
        return 'bg-neutral-100 text-neutral-600';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-success-600';
      case 'expired':
        return 'text-warning-600';
      case 'revoked':
        return 'text-emergency-500';
      default:
        return 'text-neutral-600';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'Doctor':
        return <Stethoscope className="w-5 h-5" />;
      case 'Nurse':
        return <UserCheck className="w-5 h-5" />;
      default:
        return <Building2 className="w-5 h-5" />;
    }
  };

  const handleRevokeAccess = async () => {
    if (!selectedGrant) return;
    
    setIsRevoking(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setGrants(grants.map(g => 
      g.id === selectedGrant.id 
        ? { ...g, status: 'revoked' as const } 
        : g
    ));
    
    setIsRevoking(false);
    setShowRevokeConfirm(false);
    setSelectedGrant(null);
  };

  const handleApproveRequest = async (requestId: string) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    setRequests(requests.map(r => 
      r.id === requestId 
        ? { ...r, status: 'approved' as const } 
        : r
    ));
  };

  const handleDenyRequest = async (requestId: string) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    setRequests(requests.map(r => 
      r.id === requestId 
        ? { ...r, status: 'denied' as const } 
        : r
    ));
  };

  const activeGrants = grants.filter(g => g.status === 'active');
  const historyGrants = grants.filter(g => g.status !== 'active');
  const pendingRequests = requests.filter(r => r.status === 'pending');

  const filteredGrants = (activeTab === 'grants' ? activeGrants : historyGrants).filter(g =>
    g.providerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.organization.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-8 bg-neutral-200 rounded w-48" />
        <div className="h-12 bg-neutral-200 rounded-xl" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-neutral-200 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Access Control</h1>
        <p className="text-neutral-600">Manage who can view your medical records</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="patient-card text-center">
          <div className="text-2xl font-bold text-success-600">{activeGrants.length}</div>
          <div className="text-xs text-neutral-500">Active</div>
        </div>
        <div className="patient-card text-center">
          <div className="text-2xl font-bold text-warning-600">{pendingRequests.length}</div>
          <div className="text-xs text-neutral-500">Pending</div>
        </div>
        <div className="patient-card text-center">
          <div className="text-2xl font-bold text-neutral-400">{historyGrants.length}</div>
          <div className="text-xs text-neutral-500">History</div>
        </div>
      </div>

      {/* Pending Requests Alert */}
      {pendingRequests.length > 0 && (
        <div 
          className="warning-card flex items-center gap-3 cursor-pointer"
          onClick={() => setActiveTab('requests')}
        >
          <AlertTriangle className="w-5 h-5 text-warning-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-warning-800">
              {pendingRequests.length} pending access request{pendingRequests.length > 1 ? 's' : ''}
            </p>
            <p className="text-sm text-warning-600">Tap to review</p>
          </div>
          <ChevronRight className="w-5 h-5 text-warning-400" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 bg-neutral-100 p-1 rounded-xl">
        <button
          onClick={() => setActiveTab('grants')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'grants'
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          <Shield className="w-4 h-4 inline mr-1" />
          Active ({activeGrants.length})
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors relative ${
            activeTab === 'requests'
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          <UserCheck className="w-4 h-4 inline mr-1" />
          Requests
          {pendingRequests.length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-warning-500 text-white text-xs rounded-full flex items-center justify-center">
              {pendingRequests.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'history'
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          <History className="w-4 h-4 inline mr-1" />
          History
        </button>
      </div>

      {/* Search */}
      {activeTab !== 'requests' && (
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
          <input
            type="text"
            placeholder="Search providers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-neutral-100 border-0 rounded-xl focus:ring-2 focus:ring-primary-500"
          />
        </div>
      )}

      {/* Content */}
      {activeTab === 'requests' ? (
        <div className="space-y-3">
          {pendingRequests.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="w-12 h-12 text-success-300 mx-auto mb-4" />
              <p className="text-neutral-500">No pending requests</p>
            </div>
          ) : (
            pendingRequests.map(request => (
              <div key={request.id} className="patient-card space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
                    {getRoleIcon(request.providerRole)}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-neutral-900">{request.providerName}</h3>
                    <p className="text-sm text-neutral-500">{request.providerRole} • {request.organization}</p>
                    <p className="text-xs text-neutral-400 mt-1">
                      <Clock className="w-3 h-3 inline mr-1" />
                      Requested {formatDateTime(request.requestedAt)}
                    </p>
                  </div>
                </div>
                
                <div className="p-3 bg-neutral-50 rounded-xl">
                  <p className="text-sm text-neutral-600">
                    <span className="font-medium">Reason:</span> {request.reason}
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => handleApproveRequest(request.id)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-success-500 text-white rounded-xl hover:bg-success-600 transition-colors"
                  >
                    <CheckCircle className="w-5 h-5" />
                    Approve
                  </button>
                  <button
                    onClick={() => handleDenyRequest(request.id)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emergency-500 text-white rounded-xl hover:bg-emergency-600 transition-colors"
                  >
                    <XCircle className="w-5 h-5" />
                    Deny
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGrants.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
              <p className="text-neutral-500">
                {activeTab === 'grants' ? 'No active access grants' : 'No access history'}
              </p>
            </div>
          ) : (
            filteredGrants.map(grant => (
              <div
                key={grant.id}
                className="patient-card hover:border-primary-200 border-2 border-transparent cursor-pointer"
                onClick={() => setSelectedGrant(grant)}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center text-primary-600">
                    {getRoleIcon(grant.providerRole)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-neutral-900 truncate">{grant.providerName}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${getAccessTypeColor(grant.accessType)}`}>
                        {grant.accessType}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-500">{grant.organization}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-neutral-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(grant.grantedAt)}
                      </span>
                      <span className={`flex items-center gap-1 ${getStatusColor(grant.status)}`}>
                        {grant.status === 'active' ? (
                          <CheckCircle className="w-3 h-3" />
                        ) : grant.status === 'revoked' ? (
                          <XCircle className="w-3 h-3" />
                        ) : (
                          <Clock className="w-3 h-3" />
                        )}
                        {grant.status}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-neutral-400 flex-shrink-0" />
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Grant Detail Modal */}
      {selectedGrant && !showRevokeConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="sticky top-0 bg-white p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold text-neutral-900">Access Details</h2>
              <button
                onClick={() => setSelectedGrant(null)}
                className="p-2 hover:bg-neutral-100 rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-neutral-500" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Provider Info */}
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 bg-primary-100 rounded-2xl flex items-center justify-center text-primary-600">
                  {getRoleIcon(selectedGrant.providerRole)}
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-neutral-900">{selectedGrant.providerName}</h3>
                  <p className="text-neutral-600">{selectedGrant.providerRole}</p>
                  <p className="text-sm text-neutral-500">{selectedGrant.organization}</p>
                </div>
              </div>

              {/* Access Info */}
              <div className="space-y-4 p-4 bg-neutral-50 rounded-xl">
                <div className="flex justify-between items-center">
                  <span className="text-neutral-600">Access Type</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getAccessTypeColor(selectedGrant.accessType)}`}>
                    {selectedGrant.accessType.charAt(0).toUpperCase() + selectedGrant.accessType.slice(1)} Access
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-neutral-600">Status</span>
                  <span className={`flex items-center gap-1 font-medium ${getStatusColor(selectedGrant.status)}`}>
                    {selectedGrant.status === 'active' ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    {selectedGrant.status.charAt(0).toUpperCase() + selectedGrant.status.slice(1)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-neutral-600">Granted</span>
                  <span className="text-neutral-900">{formatDate(selectedGrant.grantedAt)}</span>
                </div>
                {selectedGrant.expiresAt && (
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-600">Expires</span>
                    <span className="text-neutral-900">{formatDate(selectedGrant.expiresAt)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-neutral-600">Total Accesses</span>
                  <span className="text-neutral-900">{selectedGrant.accessCount} times</span>
                </div>
                {selectedGrant.lastAccessed && (
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-600">Last Accessed</span>
                    <span className="text-neutral-900">{formatDateTime(selectedGrant.lastAccessed)}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              {selectedGrant.status === 'active' && (
                <button
                  onClick={() => setShowRevokeConfirm(true)}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emergency-500 text-white rounded-xl hover:bg-emergency-600 transition-colors"
                >
                  <UserX className="w-5 h-5" />
                  Revoke Access
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Revoke Confirmation Modal */}
      {showRevokeConfirm && selectedGrant && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 space-y-6 animate-slide-up">
            <div className="text-center">
              <div className="w-16 h-16 bg-emergency-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-emergency-500" />
              </div>
              <h3 className="text-xl font-bold text-neutral-900 mb-2">Revoke Access?</h3>
              <p className="text-neutral-600">
                {selectedGrant.providerName} will no longer be able to view your medical records.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowRevokeConfirm(false)}
                className="flex-1 px-4 py-3 border-2 border-neutral-200 rounded-xl hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRevokeAccess}
                disabled={isRevoking}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emergency-500 text-white rounded-xl hover:bg-emergency-600 transition-colors disabled:opacity-50"
              >
                {isRevoking ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  'Revoke'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
