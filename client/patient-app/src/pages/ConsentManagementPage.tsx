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
  Search,
  Calendar,
  Building2,
  Stethoscope,
  X,
  History,
  FileText,
  PenLine,
} from 'lucide-react';
import { apiUrl, getApiClient, getPatientConsents, getConsentTypes, signConsent, useTranslation } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

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
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
interface SignedConsent {
  consent_id: string;
  consent_type: string;
  signed_at: string | number;
  status?: string;
}

interface ConsentType {
  consent_type: string;
  display_name: string;
  description?: string;
}

interface ConsentTypeResponse {
  consent_type?: string;
  display_name?: string;
  type_id?: string;
  name?: string;
  description?: string;
}

export function ConsentManagementPage() {
  const { t } = useTranslation();
  const { patient } = usePatientAuthStore();
  const accessTypeLabel = (type: string) =>
    ({ full: t('consent.typeFull'), limited: t('consent.typeLimited'), emergency: t('consent.typeEmergency') }[type] || type);
  const grantStatusLabel = (s: string) =>
    ({ active: t('consent.statusActive'), expired: t('consent.statusExpired'), revoked: t('consent.statusRevoked') }[s] || s);
  const [activeTab, setActiveTab] = useState<'grants' | 'requests' | 'history' | 'consents'>('grants');
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGrant, setSelectedGrant] = useState<AccessGrant | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  // Consent forms state
  const [signedConsents, setSignedConsents] = useState<SignedConsent[]>([]);
  const [consentTypes, setConsentTypes] = useState<ConsentType[]>([]);
  const [isSigning, setIsSigning] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [patient?.healthId]);

  const loadData = async () => {
    setIsLoading(true);

    try {
      // Prefer patient from auth store; fall back to localStorage
      const patientId = patient?.healthId || (() => {
        const authData = localStorage.getItem('patient-auth');
        return authData ? JSON.parse(authData).patientId : null;
      })();

      if (!patientId) {
        setGrants([]);
        setRequests([]);
        setIsLoading(false);
        return;
      }

      const userId = patient?.walletAddress || patientId;

      // Fetch access grants from API
      const grantsResponse = await fetch(apiUrl(`/api/access/patient/${patientId}/grants`), {
        headers: { ...getApiClient().getSessionHeaders(userId), 'X-Health-Id': patientId },
      });
      if (grantsResponse.ok) {
        const data = await grantsResponse.json();
        setGrants(data.grants || []);
      } else {
        setGrants([]);
      }

      // Fetch pending access requests from API
      const requestsResponse = await fetch(apiUrl(`/api/access/patient/${patientId}/requests`), {
        headers: { ...getApiClient().getSessionHeaders(userId), 'X-Health-Id': patientId },
      });
      if (requestsResponse.ok) {
        const data = await requestsResponse.json();
        setRequests(data.requests || []);
      } else {
        setRequests([]);
      }

      // Fetch signed consents and consent types
      try {
        const [consentsResult, typesResult] = await Promise.all([
          getPatientConsents(patientId) as Promise<{ consents: SignedConsent[] }>,
          getConsentTypes() as Promise<{ consent_types: ConsentTypeResponse[] }>,
        ]);
        setSignedConsents(consentsResult.consents || []);
        setConsentTypes((typesResult.consent_types || []).map(type => ({
          consent_type: type.consent_type || type.type_id || '',
          display_name: type.display_name || type.name || type.type_id || '',
          description: type.description,
        })).filter(type => Boolean(type.consent_type)));
      } catch (err) {
        console.warn('Could not load consent forms:', err);
      }
    } catch (error) {
      console.error('Failed to load consent data:', error);
      setGrants([]);
      setRequests([]);
    }

    setIsLoading(false);
  };

  const handleSignConsent = async (consentType: string) => {
    if (!patient?.healthId) return;
    setIsSigning(consentType);
    setConsentError(null);
    try {
      await signConsent({ patient_id: patient.healthId, consent_type: consentType });
      // Reload consents
      const result = await getPatientConsents(patient.healthId) as { consents: SignedConsent[] };
      setSignedConsents(result.consents || []);
    } catch (err) {
      console.error('Failed to sign consent:', err);
      setConsentError(err instanceof Error ? err.message : 'The consent could not be signed.');
    } finally {
      setIsSigning(null);
    }
  };

  const formatDate = (dateValue: string | number) => {
    const date = typeof dateValue === 'number' ? new Date(dateValue * 1000) : new Date(dateValue);
    return date.toLocaleDateString('en-US', {
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
        return 'bg-emergency-100 text-critical-subtle-fg';
      default:
        return 'bg-surface-sunken text-content-muted';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-success-600';
      case 'expired':
        return 'text-warning-600';
      case 'revoked':
        return 'text-critical-subtle-fg';
      default:
        return 'text-content-muted';
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
    if (!selectedGrant || !patient) return;
    
    setIsRevoking(true);
    try {
      const response = await fetch(apiUrl(`/api/access/grants/${selectedGrant.id}/revoke`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getApiClient().getSessionHeaders(patient.walletAddress),
          'X-Health-Id': patient.healthId,
        },
      });
      
      if (response.ok) {
        setGrants(grants.map(g => 
          g.id === selectedGrant.id 
            ? { ...g, status: 'revoked' as const } 
            : g
        ));
      } else {
        console.error('Failed to revoke access');
      }
    } catch (error) {
      console.error('Error revoking access:', error);
    } finally {
      setIsRevoking(false);
      setShowRevokeConfirm(false);
      setSelectedGrant(null);
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    if (!patient) return;
    try {
      const response = await fetch(apiUrl(`/api/access/requests/${requestId}/approve`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getApiClient().getSessionHeaders(patient.walletAddress),
          'X-Health-Id': patient.healthId,
        },
      });
      
      if (response.ok) {
        setRequests(requests.map(r => 
          r.id === requestId 
            ? { ...r, status: 'approved' as const } 
            : r
        ));
      }
    } catch (error) {
      console.error('Error approving request:', error);
    }
  };

  const handleDenyRequest = async (requestId: string) => {
    if (!patient) return;
    try {
      const response = await fetch(apiUrl(`/api/access/requests/${requestId}/deny`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getApiClient().getSessionHeaders(patient.walletAddress),
          'X-Health-Id': patient.healthId,
        },
      });
      
      if (response.ok) {
        setRequests(requests.map(r => 
          r.id === requestId 
            ? { ...r, status: 'denied' as const } 
            : r
        ));
      }
    } catch (error) {
      console.error('Error denying request:', error);
    }
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
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-12 bg-surface-sunken rounded-xl" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-surface-sunken rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-content">{t('consent.accessControl')}</h1>
        <p className="text-content-muted">{t('consent.subtitle')}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="patient-card text-center">
          <div className="text-2xl font-bold text-success-600">{activeGrants.length}</div>
          <div className="text-xs text-content-muted">{t('consent.active')}</div>
        </div>
        <div className="patient-card text-center">
          <div className="text-2xl font-bold text-warning-600">{pendingRequests.length}</div>
          <div className="text-xs text-content-muted">{t('consent.pending')}</div>
        </div>
        <div className="patient-card text-center">
          <div className="text-2xl font-bold text-content-muted">{historyGrants.length}</div>
          <div className="text-xs text-content-muted">{t('consent.history')}</div>
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
              {t('consent.pendingRequestsCount', { count: pendingRequests.length })}
            </p>
            <p className="text-sm text-warning-600">{t('consent.tapToReview')}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-warning-400" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 bg-surface-sunken p-1 rounded-xl">
        <button
          onClick={() => setActiveTab('grants')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'grants'
              ? 'bg-surface text-content shadow-sm'
              : 'text-content-muted hover:text-content'
          }`}
        >
          <Shield className="w-4 h-4 inline mr-1" />
          {t('consent.activeCount', { count: activeGrants.length })}
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors relative ${
            activeTab === 'requests'
              ? 'bg-surface text-content shadow-sm'
              : 'text-content-muted hover:text-content'
          }`}
        >
          <UserCheck className="w-4 h-4 inline mr-1" />
          {t('consent.requests')}
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
              ? 'bg-surface text-content shadow-sm'
              : 'text-content-muted hover:text-content'
          }`}
        >
          <History className="w-4 h-4 inline mr-1" />
          {t('consent.history')}
        </button>
        <button
          onClick={() => setActiveTab('consents')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'consents'
              ? 'bg-surface text-content shadow-sm'
              : 'text-content-muted hover:text-content'
          }`}
        >
          <FileText className="w-4 h-4 inline mr-1" />
          {t('consent.forms')}
        </button>
      </div>

      {/* Search */}
      {activeTab !== 'requests' && activeTab !== 'consents' && (
        <div className="relative">
          <label htmlFor="consent-search" className="sr-only">{t('consent.searchProviders')}</label>
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
          <input
            id="consent-search"
            type="text"
            placeholder={t('consent.searchProviders')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-surface-sunken border-0 rounded-xl focus:ring-2 focus:ring-primary-500"
          />
        </div>
      )}

      {/* Consent Forms Tab */}
      {activeTab === 'consents' && (
        <div className="space-y-6">
          {consentError && <p role="alert" className="rounded-lg bg-critical-subtle p-3 text-sm text-critical-subtle-fg">{consentError}</p>}
          {/* Signed Consents */}
          <div>
            <h3 className="font-semibold text-content-secondary mb-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" /> {t('consent.signedForms')}
            </h3>
            {signedConsents.length === 0 ? (
              <p className="text-sm text-content-muted">{t('consent.noSigned')}</p>
            ) : (
              <div className="space-y-2">
                {signedConsents.map(c => (
                  <div key={c.consent_id} className="patient-card flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-primary-500" />
                      <div>
                        <p className="font-medium text-content">{c.consent_type}</p>
                        {c.signed_at && (
                          <p className="text-xs text-content-muted">{t('consent.signedOn', { date: formatDate(c.signed_at) })}</p>
                        )}
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded-full text-xs bg-ok-subtle text-ok-subtle-fg">{t('consent.signed')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Available Consent Types */}
          {consentTypes.length > 0 && (
            <div>
              <h3 className="font-semibold text-content-secondary mb-3 flex items-center gap-2">
                <PenLine className="w-4 h-4 text-primary-500" /> {t('consent.availableForms')}
              </h3>
              <div className="space-y-2">
                {consentTypes.map(ct => {
                  const alreadySigned = signedConsents.some(sc => sc.consent_type === ct.consent_type);
                  return (
                    <div key={ct.consent_type} className="patient-card flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-content-muted" />
                        <div>
                          <p className="font-medium text-content">{ct.display_name || ct.consent_type}</p>
                          {ct.description && (
                            <p className="text-xs text-content-muted">{ct.description}</p>
                          )}
                        </div>
                      </div>
                      {alreadySigned ? (
                        <span className="px-2 py-1 rounded-full text-xs bg-ok-subtle text-ok-subtle-fg">{t('consent.signed')}</span>
                      ) : (
                        <button
                          onClick={() => handleSignConsent(ct.consent_type)}
                          disabled={isSigning === ct.consent_type}
                          className="px-3 py-1.5 bg-primary-500 text-brand-fg text-xs rounded-lg hover:bg-brand transition-colors disabled:opacity-50"
                        >
                          {isSigning === ct.consent_type ? t('consent.signing') : t('consent.sign')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Access Grants/Requests/History Content */}
      {activeTab !== 'consents' && (activeTab === 'requests' ? (
        <div className="space-y-3">
          {pendingRequests.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="w-12 h-12 text-success-300 mx-auto mb-4" />
              <p className="text-content-muted">{t('consent.noRequests')}</p>
            </div>
          ) : (
            pendingRequests.map(request => (
              <div key={request.id} className="patient-card space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-brand-subtle rounded-xl flex items-center justify-center">
                    {getRoleIcon(request.providerRole)}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-content">{request.providerName}</h3>
                    <p className="text-sm text-content-muted">{request.providerRole} • {request.organization}</p>
                    <p className="text-xs text-content-muted mt-1">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {t('consent.requestedOn', { date: formatDateTime(request.requestedAt) })}
                    </p>
                  </div>
                </div>
                
                <div className="p-3 bg-surface-sunken rounded-xl">
                  <p className="text-sm text-content-muted">
                    <span className="font-medium">{t('consent.reasonLabel')}</span> {request.reason}
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => handleApproveRequest(request.id)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-success-500 text-white rounded-xl hover:bg-success-600 transition-colors"
                  >
                    <CheckCircle className="w-5 h-5" />
                    {t('consent.approve')}
                  </button>
                  <button
                    onClick={() => handleDenyRequest(request.id)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-critical text-critical-fg rounded-xl hover:bg-critical transition-colors"
                  >
                    <XCircle className="w-5 h-5" />
                    {t('consent.deny')}
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
              <p className="text-content-muted">
                {activeTab === 'grants' ? t('consent.noActiveGrants') : t('consent.noHistory')}
              </p>
            </div>
          ) : (
            filteredGrants.map(grant => (
              <div
                key={grant.id}
                className="patient-card hover:border-brand border-2 border-transparent cursor-pointer"
                onClick={() => setSelectedGrant(grant)}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-brand-subtle rounded-xl flex items-center justify-center text-brand-subtle-fg">
                    {getRoleIcon(grant.providerRole)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-content truncate">{grant.providerName}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${getAccessTypeColor(grant.accessType)}`}>
                        {accessTypeLabel(grant.accessType)}
                      </span>
                    </div>
                    <p className="text-sm text-content-muted">{grant.organization}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-content-muted">
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
                        {grantStatusLabel(grant.status)}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-content-muted flex-shrink-0" />
                </div>
              </div>
            ))
          )}
        </div>
      ))}

      {/* Grant Detail Modal */}
      {selectedGrant && !showRevokeConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-surface w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="sticky top-0 bg-surface p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold text-content">{t('consent.accessDetails')}</h2>
              <button
                onClick={() => setSelectedGrant(null)}
                className="p-2 hover:bg-surface-sunken rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-content-muted" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Provider Info */}
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 bg-brand-subtle rounded-2xl flex items-center justify-center text-brand-subtle-fg">
                  {getRoleIcon(selectedGrant.providerRole)}
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-content">{selectedGrant.providerName}</h3>
                  <p className="text-content-muted">{selectedGrant.providerRole}</p>
                  <p className="text-sm text-content-muted">{selectedGrant.organization}</p>
                </div>
              </div>

              {/* Access Info */}
              <div className="space-y-4 p-4 bg-surface-sunken rounded-xl">
                <div className="flex justify-between items-center">
                  <span className="text-content-muted">{t('consent.accessType')}</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getAccessTypeColor(selectedGrant.accessType)}`}>
                    {accessTypeLabel(selectedGrant.accessType)} {t('consent.accessWord')}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-content-muted">{t('consent.status')}</span>
                  <span className={`flex items-center gap-1 font-medium ${getStatusColor(selectedGrant.status)}`}>
                    {selectedGrant.status === 'active' ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    {grantStatusLabel(selectedGrant.status)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-content-muted">{t('consent.granted')}</span>
                  <span className="text-content">{formatDate(selectedGrant.grantedAt)}</span>
                </div>
                {selectedGrant.expiresAt && (
                  <div className="flex justify-between items-center">
                    <span className="text-content-muted">{t('consent.expires')}</span>
                    <span className="text-content">{formatDate(selectedGrant.expiresAt)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-content-muted">{t('consent.totalAccesses')}</span>
                  <span className="text-content">{t('consent.times', { count: selectedGrant.accessCount })}</span>
                </div>
                {selectedGrant.lastAccessed && (
                  <div className="flex justify-between items-center">
                    <span className="text-content-muted">{t('consent.lastAccessed')}</span>
                    <span className="text-content">{formatDateTime(selectedGrant.lastAccessed)}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              {selectedGrant.status === 'active' && (
                <button
                  onClick={() => setShowRevokeConfirm(true)}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-critical text-critical-fg rounded-xl hover:bg-critical transition-colors"
                >
                  <UserX className="w-5 h-5" />
                  {t('consent.revokeAccess')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Revoke Confirmation Modal */}
      {showRevokeConfirm && selectedGrant && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface w-full max-w-sm rounded-3xl p-6 space-y-6 animate-slide-up">
            <div className="text-center">
              <div className="w-16 h-16 bg-emergency-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-critical-subtle-fg" />
              </div>
              <h3 className="text-xl font-bold text-content mb-2">{t('consent.revokeConfirmTitle')}</h3>
              <p className="text-content-muted">
                {t('consent.revokeConfirmBody', { name: selectedGrant.providerName })}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowRevokeConfirm(false)}
                className="flex-1 px-4 py-3 border-2 border-border rounded-xl hover:bg-surface-sunken transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleRevokeAccess}
                disabled={isRevoking}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-critical text-critical-fg rounded-xl hover:bg-critical transition-colors disabled:opacity-50"
              >
                {isRevoking ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  t('consent.revoke')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
