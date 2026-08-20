import React, { useState, useEffect } from 'react';
import {
  AlertOctagon,
  Search,
  Eye,
  Clock,
  User,
  MapPin,
  Calendar,
  FileText,
  AlertTriangle,
  CheckCircle,
  Users,
  Shield,
  Printer,
  Loader2,
  AlertCircle
} from 'lucide-react';
import {
  apiUrl,
  listIncidentReports,
  createIncidentReport,
  useTranslation,
} from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import PatientSelect from '../components/PatientSelect';

/**
 * IncidentReportPage
 * 
 * Page for incident reporting and documentation.
 * Implements incident report form, incident list, and follow-up tracking.
 */

type IncidentType = 'fall' | 'medication-error' | 'equipment-failure' | 'security' | 'behavioral' | 'exposure' | 'other';
type IncidentSeverity = 'near-miss' | 'minor' | 'moderate' | 'major' | 'sentinel';
type IncidentStatus = 'open' | 'under-investigation' | 'pending-review' | 'closed' | 'escalated';

interface Incident {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  dateTime: Date;
  location: string;
  department: string;
  description: string;
  patientInvolved: boolean;
  patientId?: string;
  patientName?: string;
  staffInvolved: string[];
  witnesses: string[];
  immediateActions: string;
  reportedBy: string;
  reportedAt: Date;
  assignedTo?: string;
  followUpActions: { action: string; dueDate: Date; completed: boolean }[];
  rootCause?: string;
  preventiveMeasures?: string;
}

/** One incident report row, as the API returns it. */
interface IncidentRow {
  id: string;
  patient_id: string | null;
  reporter_id: string;
  incident_datetime: string;
  discovery_datetime: string;
  incident_type: string;
  severity: string;
  location: string;
  department: string | null;
  description: string;
  immediate_actions_taken: string | null;
  witnesses: string[] | null;
  corrective_actions: string[] | null;
  investigation_status: string | null;
}

/**
 * Map a stored incident onto the shape this page renders.
 *
 * The two share no field names — the page expects camelCase with `type`,
 * `dateTime` and `reportedAt`, while the API returns snake_case columns. Reading
 * it raw produced Invalid Dates and undefined fields, and the list threw as soon
 * as one report existed.
 */
function toIncident(row: IncidentRow): Incident {
  const asDate = (value: string | null | undefined) => {
    const d = new Date(value || '');
    return isNaN(d.getTime()) ? new Date() : d;
  };
  return {
    id: row.id,
    type: row.incident_type as IncidentType,
    severity: row.severity as IncidentSeverity,
    status: (row.investigation_status || 'open') as IncidentStatus,
    dateTime: asDate(row.incident_datetime),
    location: row.location || '',
    department: row.department || '',
    description: row.description || '',
    patientInvolved: !!row.patient_id,
    patientId: row.patient_id || undefined,
    staffInvolved: Array.isArray(row.corrective_actions) ? row.corrective_actions : [],
    witnesses: Array.isArray(row.witnesses) ? row.witnesses : [],
    immediateActions: row.immediate_actions_taken || '',
    reportedBy: row.reporter_id || '',
    reportedAt: asDate(row.discovery_datetime),
    followUpActions: [],
  };
}

const IncidentReportPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'list' | 'new' | 'dashboard'>('list');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<IncidentType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | 'all'>('all');
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [formStep, setFormStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();

  const [formData, setFormData] = useState({
    type: 'fall' as IncidentType,
    severity: 'minor' as IncidentSeverity,
    dateTime: '',
    location: '',
    department: 'emergency',
    description: '',
    patientInvolved: false,
    patientId: '',
    staffInvolved: '',
    witnesses: '',
    immediateActions: ''
  });

  useEffect(() => {
    const fetchIncidents = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        setError(null);
        
        const data = await listIncidentReports();
        // Convert date strings to Date objects
        const incidentsWithDates = (((data as unknown) as IncidentRow[]) || []).map(toIncident);
        setIncidents(incidentsWithDates);
      } catch (err) {
        console.error('Error fetching incidents:', err);
        setError(err instanceof Error ? err.message : t('docIncidentReport.errorLoad'));
        setIncidents([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchIncidents();
  }, [user]);

  const handleSubmitReport = async () => {
    if (!formData.description || !formData.location || !formData.dateTime) {
      showError(t('docIncidentReport.errorRequiredFields'));
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        id: `INC-${Date.now()}`,
        ...formData,
        dateTime: new Date(formData.dateTime).toISOString(),
        reportedBy: user?.username || 'Healthcare Provider',
        reportedAt: new Date().toISOString(),
        status: 'open' as IncidentStatus,
        staffInvolved: formData.staffInvolved.split(',').map(s => s.trim()).filter(Boolean),
        witnesses: formData.witnesses.split(',').map(s => s.trim()).filter(Boolean),
        followUpActions: [],
      };

      await createIncidentReport(payload);
      showSuccess(t('docIncidentReport.successSubmit'));
      
      // Refresh list
      const updatedData = await listIncidentReports();
      const incidentsWithDates = (((updatedData as unknown) as IncidentRow[]) || []).map(toIncident);
      setIncidents(incidentsWithDates);
      
      setActiveTab('list');
      resetForm();
    } catch (err) {
      console.error('Error submitting report:', err);
      showError(t('docIncidentReport.errorSubmit'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormStep(1);
    setFormData({
      type: 'fall',
      severity: 'minor',
      dateTime: '',
      location: '',
      department: '',
      description: '',
      patientInvolved: false,
      patientId: '',
      staffInvolved: '',
      witnesses: '',
      immediateActions: ''
    });
  };

  const getTypeBadge = (type: IncidentType) => {
    const config: Record<IncidentType, { bg: string; icon: React.ReactNode }> = {
      'fall': { bg: 'bg-orange-100 text-orange-700', icon: <User className="w-3 h-3" /> },
      'medication-error': { bg: 'bg-critical-subtle text-critical-subtle-fg', icon: <AlertTriangle className="w-3 h-3" /> },
      'equipment-failure': { bg: 'bg-notice-subtle text-notice-subtle-fg', icon: <AlertOctagon className="w-3 h-3" /> },
      'security': { bg: 'bg-purple-100 text-purple-700', icon: <Shield className="w-3 h-3" /> },
      'behavioral': { bg: 'bg-caution-subtle text-caution-subtle-fg', icon: <Users className="w-3 h-3" /> },
      'exposure': { bg: 'bg-pink-100 text-pink-700', icon: <AlertTriangle className="w-3 h-3" /> },
      'other': { bg: 'bg-surface-sunken text-content-secondary', icon: <FileText className="w-3 h-3" /> }
    };
    const { bg, icon } = config[type];
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${bg}`}>
        {icon}
        {t(`docIncidentReport.type_${type}`)}
      </span>
    );
  };

  const getSeverityBadge = (severity: IncidentSeverity) => {
    const styles: Record<IncidentSeverity, string> = {
      'near-miss': 'bg-ok-subtle text-ok-subtle-fg',
      'minor': 'bg-caution-subtle text-caution-subtle-fg',
      'moderate': 'bg-orange-100 text-orange-700',
      'major': 'bg-critical-subtle text-critical-subtle-fg',
      'sentinel': 'bg-red-600 text-white'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[severity]}`}>
        {t(`docIncidentReport.severity_${severity}`)}
      </span>
    );
  };

  const getStatusBadge = (status: IncidentStatus) => {
    const config: Record<IncidentStatus, { bg: string; icon: React.ReactNode }> = {
      'open': { bg: 'bg-notice-subtle text-notice-subtle-fg', icon: <Clock className="w-3 h-3" /> },
      'under-investigation': { bg: 'bg-caution-subtle text-caution-subtle-fg', icon: <Search className="w-3 h-3" /> },
      'pending-review': { bg: 'bg-purple-100 text-purple-700', icon: <Eye className="w-3 h-3" /> },
      'closed': { bg: 'bg-ok-subtle text-ok-subtle-fg', icon: <CheckCircle className="w-3 h-3" /> },
      'escalated': { bg: 'bg-critical-subtle text-critical-subtle-fg', icon: <AlertTriangle className="w-3 h-3" /> }
    };
    const { bg, icon } = config[status];
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${bg}`}>
        {icon}
        {t(`docIncidentReport.status_${status}`)}
      </span>
    );
  };

  const filteredIncidents = incidents.filter(inc => {
    const matchesSearch = inc.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          inc.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (inc.patientName?.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesType = typeFilter === 'all' || inc.type === typeFilter;
    const matchesStatus = statusFilter === 'all' || inc.status === statusFilter;
    return matchesSearch && matchesType && matchesStatus;
  });

  const stats = {
    open: incidents.filter(i => i.status === 'open').length,
    investigating: incidents.filter(i => i.status === 'under-investigation').length,
    thisWeek: incidents.filter(i => i.dateTime > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length,
    sentinel: incidents.filter(i => i.severity === 'sentinel').length
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-rose-700 to-red-600 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <AlertOctagon className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docIncidentReport.title')}</h1>
        </div>
        <p className="text-rose-200">{t('docIncidentReport.subtitle')}</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-critical-subtle-fg animate-spin mb-2" />
          <p className="text-content-muted">{t('docIncidentReport.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-critical-subtle border border-critical rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-critical-subtle-fg">{error}</p>
            <p className="text-xs text-red-500 mt-1">{t('docIncidentReport.apiCheckMessage')}</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Stats Bar */}
          <div className="bg-surface border-b px-6 py-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-notice-subtle-fg">{stats.open}</p>
                <p className="text-xs text-content-muted">{t('docIncidentReport.statOpen')}</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-caution-subtle-fg">{stats.investigating}</p>
                <p className="text-xs text-content-muted">{t('docIncidentReport.statInvestigating')}</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-content-muted">{stats.thisWeek}</p>
                <p className="text-xs text-content-muted">{t('docIncidentReport.statThisWeek')}</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-critical-subtle-fg">{stats.sentinel}</p>
                <p className="text-xs text-content-muted">{t('docIncidentReport.statSentinel')}</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-surface border-b">
            <div className="flex">
              {(['list', 'new', 'dashboard'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium capitalize ${
                    activeTab === tab ? 'text-critical-subtle-fg border-b-2 border-rose-700' : 'text-content-muted'
                  }`}
                >
                  {tab === 'new' ? t('docIncidentReport.tabReport') : tab === 'list' ? t('docIncidentReport.tabAll') : t('docIncidentReport.tabDashboard')}
                </button>
              ))}
            </div>
          </div>

          {/* List Tab */}
          {activeTab === 'list' && (
            <div className="p-6">
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('docIncidentReport.searchPh')}
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
              className="px-4 py-2 border rounded-lg"
            >
              <option value="all">{t('docIncidentReport.allTypes')}</option>
              <option value="fall">{t('docIncidentReport.type_fall')}</option>
              <option value="medication-error">{t('docIncidentReport.type_medication-error')}</option>
              <option value="equipment-failure">{t('docIncidentReport.type_equipment-failure')}</option>
              <option value="security">{t('docIncidentReport.type_security')}</option>
              <option value="behavioral">{t('docIncidentReport.type_behavioral')}</option>
              <option value="exposure">{t('docIncidentReport.type_exposure')}</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="px-4 py-2 border rounded-lg"
            >
              <option value="all">{t('docIncidentReport.allStatuses')}</option>
              <option value="open">{t('docIncidentReport.status_open')}</option>
              <option value="under-investigation">{t('docIncidentReport.status_under-investigation')}</option>
              <option value="pending-review">{t('docIncidentReport.status_pending-review')}</option>
              <option value="closed">{t('docIncidentReport.status_closed')}</option>
            </select>
          </div>

          <div className="space-y-4">
            {filteredIncidents.map(incident => (
              <div key={incident.id} className="bg-surface rounded-lg shadow border p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-content">{incident.id}</span>
                      {getTypeBadge(incident.type)}
                      {getSeverityBadge(incident.severity)}
                      {getStatusBadge(incident.status)}
                    </div>
                    <p className="text-sm text-content-muted mt-1 flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      {incident.dateTime.toLocaleString()}
                      <MapPin className="w-4 h-4 ml-2" />
                      {incident.location}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedIncident(incident)} className="p-2 hover:bg-surface-sunken rounded-lg" aria-label="View incident details">
                      <Eye className="w-5 h-5 text-content-muted" />
                    </button>
                    <button className="p-2 hover:bg-surface-sunken rounded-lg" aria-label="Print incident report">
                      <Printer className="w-5 h-5 text-content-muted" />
                    </button>
                  </div>
                </div>

                <p className="text-content-secondary mb-4 line-clamp-2">{incident.description}</p>

                {incident.patientInvolved && (
                  <div className="bg-notice-subtle rounded-lg p-3 mb-4 flex items-center gap-2">
                    <User className="w-4 h-4 text-notice-subtle-fg" />
                    <span className="text-sm text-notice-subtle-fg">{t('docIncidentReport.patientLine', { name: incident.patientName || '', id: incident.patientId || '' })}</span>
                  </div>
                )}

                {incident.followUpActions.length > 0 && (
                  <div className="border-t pt-4">
                    <p className="text-sm font-medium text-content-secondary mb-2">{t('docIncidentReport.followUpActionsLabel')}</p>
                    <div className="flex gap-2 flex-wrap">
                      {incident.followUpActions.map((action, idx) => (
                        <span
                          key={idx}
                          className={`px-2 py-1 rounded text-xs ${
                            action.completed ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'
                          }`}
                        >
                          {action.completed ? <CheckCircle className="w-3 h-3 inline mr-1" /> : <Clock className="w-3 h-3 inline mr-1" />}
                          {action.action}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Incident Tab */}
      {activeTab === 'new' && (
        <div className="p-6">
          <div className="bg-surface rounded-lg shadow p-6 max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">{t('docIncidentReport.reportNewIncidentHeading')}</h2>
              <div className="flex items-center gap-2">
                {[1, 2, 3].map(step => (
                  <div
                    key={step}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      formStep === step ? 'bg-rose-600 text-white' : formStep > step ? 'bg-green-500 text-white' : 'bg-surface-sunken'
                    }`}
                  >
                    {formStep > step ? <CheckCircle className="w-4 h-4" /> : step}
                  </div>
                ))}
              </div>
            </div>

            {formStep === 1 && (
              <div className="space-y-4">
                <h3 className="font-medium text-content">{t('docIncidentReport.step1Heading')}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="inc-incident-type" className="block text-sm font-medium mb-1">{t('docIncidentReport.incidentTypeRequired')} *</label>
                    <select
                      id="inc-incident-type"
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value as IncidentType })}
                      className="w-full border rounded-lg px-3 py-2"
                    >
                      <option value="fall">{t('docIncidentReport.typeOption_fall')}</option>
                      <option value="medication-error">{t('docIncidentReport.typeOption_medication-error')}</option>
                      <option value="equipment-failure">{t('docIncidentReport.typeOption_equipment-failure')}</option>
                      <option value="security">{t('docIncidentReport.typeOption_security')}</option>
                      <option value="behavioral">{t('docIncidentReport.typeOption_behavioral')}</option>
                      <option value="exposure">{t('docIncidentReport.typeOption_exposure')}</option>
                      <option value="other">{t('docIncidentReport.typeOption_other')}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="inc-severity" className="block text-sm font-medium mb-1">{t('docIncidentReport.severityRequired')} *</label>
                    <select
                      id="inc-severity"
                      value={formData.severity}
                      onChange={(e) => setFormData({ ...formData, severity: e.target.value as IncidentSeverity })}
                      className="w-full border rounded-lg px-3 py-2"
                    >
                      <option value="near-miss">{t('docIncidentReport.severityOption_near-miss')}</option>
                      <option value="minor">{t('docIncidentReport.severityOption_minor')}</option>
                      <option value="moderate">{t('docIncidentReport.severityOption_moderate')}</option>
                      <option value="major">{t('docIncidentReport.severityOption_major')}</option>
                      <option value="sentinel">{t('docIncidentReport.severityOption_sentinel')}</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="inc-date-time" className="block text-sm font-medium mb-1">{t('docIncidentReport.dateTimeRequired')} *</label>
                    <input id="inc-date-time" type="datetime-local" className="w-full border rounded-lg px-3 py-2"
                      value={formData.dateTime}
                      onChange={(e) => setFormData(f => ({ ...f, dateTime: e.target.value }))} />
                  </div>
                  <div>
                    <label htmlFor="inc-department" className="block text-sm font-medium mb-1">{t('docIncidentReport.departmentRequired')} *</label>
                    <select id="inc-department" className="w-full border rounded-lg px-3 py-2"
                      value={formData.department}
                      onChange={(e) => setFormData(f => ({ ...f, department: e.target.value }))}>
                      <option value="emergency">{t('docIncidentReport.dept_emergency')}</option>
                      <option value="med-surg">{t('docIncidentReport.dept_medSurg')}</option>
                      <option value="icu">{t('docIncidentReport.dept_icu')}</option>
                      <option value="pharmacy">{t('docIncidentReport.dept_pharmacy')}</option>
                      <option value="radiology">{t('docIncidentReport.dept_radiology')}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="inc-exact-location" className="block text-sm font-medium mb-1">{t('docIncidentReport.exactLocationRequired')} *</label>
                  <input id="inc-exact-location" type="text" className="w-full border rounded-lg px-3 py-2" placeholder={t('docIncidentReport.exactLocationPh')}
                    value={formData.location}
                    onChange={(e) => setFormData(f => ({ ...f, location: e.target.value }))} />
                </div>
              </div>
            )}

            {formStep === 2 && (
              <div className="space-y-4">
                <h3 className="font-medium text-content">{t('docIncidentReport.step2Heading')}</h3>
                <div>
                  <label htmlFor="inc-description" className="block text-sm font-medium mb-1">{t('docIncidentReport.descriptionRequired')} *</label>
                  <textarea id="inc-description" className="w-full border rounded-lg px-3 py-2 h-32" placeholder={t('docIncidentReport.descriptionPh')}
                    value={formData.description}
                    onChange={(e) => setFormData(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="flex items-center gap-3 p-3 bg-surface-sunken rounded-lg">
                  <input
                    id="inc-patient-involved"
                    type="checkbox"
                    checked={formData.patientInvolved}
                    onChange={(e) => setFormData(f => ({ ...f, patientInvolved: e.target.checked }))}
                    className="w-5 h-5"
                  />
                  <label htmlFor="inc-patient-involved" className="font-medium">{t('docIncidentReport.patientInvolvedCheckbox')}</label>
                </div>
                {formData.patientInvolved && (
                  <PatientSelect
                    id="inc-patient-id"
                    label={t('docIncidentReport.patientSelectLabel')}
                    value={formData.patientId}
                    onChange={(patientId) => setFormData(f => ({ ...f, patientId }))}
                    placeholder={t('docIncidentReport.patientSelectPh')}
                  />
                )}
                <div>
                  <label htmlFor="inc-staff-involved" className="block text-sm font-medium mb-1">{t('docIncidentReport.staffInvolvedLabel')}</label>
                  <input id="inc-staff-involved" type="text" className="w-full border rounded-lg px-3 py-2" placeholder={t('docIncidentReport.staffInvolvedPh')}
                    value={formData.staffInvolved}
                    onChange={(e) => setFormData(f => ({ ...f, staffInvolved: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="inc-witnesses" className="block text-sm font-medium mb-1">{t('docIncidentReport.witnessesLabel')}</label>
                  <input id="inc-witnesses" type="text" className="w-full border rounded-lg px-3 py-2" placeholder={t('docIncidentReport.witnessesPh')}
                    value={formData.witnesses}
                    onChange={(e) => setFormData(f => ({ ...f, witnesses: e.target.value }))} />
                </div>
              </div>
            )}

            {formStep === 3 && (
              <div className="space-y-4">
                <h3 className="font-medium text-content">{t('docIncidentReport.step3Heading')}</h3>
                <div>
                  <label htmlFor="inc-immediate-actions" className="block text-sm font-medium mb-1">{t('docIncidentReport.immediateActionsRequired')} *</label>
                  <textarea id="inc-immediate-actions" className="w-full border rounded-lg px-3 py-2 h-32" placeholder={t('docIncidentReport.immediateActionsPh')}
                    value={formData.immediateActions}
                    onChange={(e) => setFormData(f => ({ ...f, immediateActions: e.target.value }))} />
                </div>
                <div className="bg-caution-subtle border border-caution rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-caution-subtle-fg flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-caution-subtle-fg">
                      <p className="font-medium">{t('docIncidentReport.reportingDeclarationHeading')}</p>
                      <p>{t('docIncidentReport.reportingDeclarationText')}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between mt-6 pt-6 border-t">
              <button
                onClick={() => setFormStep(Math.max(1, formStep - 1))}
                className={`px-4 py-2 border rounded-lg ${formStep === 1 ? 'invisible' : ''}`}
              >
                {t('docIncidentReport.backButton')}
              </button>
              {formStep < 3 ? (
                <button onClick={() => setFormStep(formStep + 1)} className="px-6 py-2 bg-rose-600 text-white rounded-lg font-medium">
                  {t('docIncidentReport.continueButton')}
                </button>
              ) : (
                <button
                  onClick={handleSubmitReport}
                  disabled={isSubmitting}
                  className="px-6 py-2 bg-rose-600 text-white rounded-lg font-medium flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                  {t('docIncidentReport.submitReportButton')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-surface rounded-lg shadow p-6">
              <h3 className="font-semibold mb-4">{t('docIncidentReport.incidentsByTypeHeading')}</h3>
              <div className="space-y-3">
                {['fall', 'medication-error', 'equipment-failure', 'security'].map(type => (
                  <div key={type} className="flex items-center gap-3">
                    <div className="w-24 text-sm">{t(`docIncidentReport.type_${type}`)}</div>
                    <div className="flex-1 h-4 bg-surface-sunken rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.random() * 80 + 20}%` }} />
                    </div>
                    <div className="w-8 text-sm text-right">{Math.floor(Math.random() * 10 + 1)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-surface rounded-lg shadow p-6">
              <h3 className="font-semibold mb-4">{t('docIncidentReport.severityDistributionHeading')}</h3>
              <div className="flex justify-around">
                {['near-miss', 'minor', 'moderate', 'major'].map(sev => (
                  <div key={sev} className="text-center">
                    <div className="text-2xl font-bold text-content-secondary">{Math.floor(Math.random() * 10 + 1)}</div>
                    <div className="text-xs text-content-muted">{t(`docIncidentReport.severity_${sev}`)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      </>)}

      {/* Detail Modal */}
      {selectedIncident && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b p-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">{selectedIncident.id}</h2>
              <button onClick={() => setSelectedIncident(null)} className="text-content-muted hover:text-content-muted text-2xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex gap-2 flex-wrap">
                {getTypeBadge(selectedIncident.type)}
                {getSeverityBadge(selectedIncident.severity)}
                {getStatusBadge(selectedIncident.status)}
              </div>
              <div className="bg-surface-sunken rounded-lg p-4">
                <h4 className="font-medium mb-2">{t('docIncidentReport.descriptionHeading')}</h4>
                <p className="text-content-secondary">{selectedIncident.description}</p>
              </div>
              <div className="bg-surface-sunken rounded-lg p-4">
                <h4 className="font-medium mb-2">{t('docIncidentReport.immediateActionsHeading')}</h4>
                <p className="text-content-secondary">{selectedIncident.immediateActions}</p>
              </div>
              {selectedIncident.rootCause && (
                <div className="bg-surface-sunken rounded-lg p-4">
                  <h4 className="font-medium mb-2">{t('docIncidentReport.rootCauseHeading')}</h4>
                  <p className="text-content-secondary">{selectedIncident.rootCause}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IncidentReportPage;
