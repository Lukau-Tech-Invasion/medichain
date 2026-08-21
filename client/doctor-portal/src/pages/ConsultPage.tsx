import React, { useState, useEffect, useCallback } from 'react';
import { getPatients, listConsults, createConsult, respondToConsult, useTranslation, lookupOr, componentOr } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientProfile } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import {
  MessageSquare,
  Clock,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Search,
  Plus,
  Send,
  FileText,
  Activity,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';

type ConsultSpecialty =
  | 'cardiology'
  | 'neurology'
  | 'orthopedics'
  | 'general-surgery'
  | 'psychiatry'
  | 'infectious-disease'
  | 'nephrology'
  | 'pulmonology'
  | 'gastroenterology'
  | 'endocrinology'
  | 'hematology'
  | 'oncology'
  | 'dermatology'
  | 'urology'
  | 'ophthalmology'
  | 'ent'
  | 'obstetrics-gynecology'
  | 'pediatrics'
  | 'radiology'
  | 'pathology'
  | 'anesthesiology'
  | 'plastic-surgery'
  | 'vascular-surgery';

type ConsultUrgency = 'routine' | 'urgent' | 'emergent' | 'stat';

type ConsultStatus = 'requested' | 'acknowledged' | 'in-progress' | 'completed' | 'declined' | 'cancelled';

interface ConsultResponse {
  responseId: string;
  respondedBy: string;
  respondedAt: string;
  assessment: string;
  recommendations: string;
  followUp?: string;
  attachments?: string[];
}

interface Consult {
  consultId: string;
  patientId: string;
  patientName: string;
  specialty: ConsultSpecialty;
  urgency: ConsultUrgency;
  status: ConsultStatus;
  reason: string;
  clinicalQuestion: string;
  relevantHistory: string;
  currentMedications?: string;
  vitalSigns?: string;
  labResults?: string;
  imagingResults?: string;
  requestedBy: string;
  requestedAt: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  response?: ConsultResponse;
  notes?: string;
}

const ConsultPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [consults, setConsults] = useState<Consult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'new-request' | 'completed' | 'my-consults'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ConsultStatus | 'all'>('all');
  const [specialtyFilter, setSpecialtyFilter] = useState<ConsultSpecialty | 'all'>('all');
  const [selectedConsult, setSelectedConsult] = useState<string>('');
  const [isRespondingBusy, setIsRespondingBusy] = useState(false);

  const [newConsult, setNewConsult] = useState({
    patientId: '',
    specialty: 'cardiology' as ConsultSpecialty,
    urgency: 'routine' as ConsultUrgency,
    reason: '',
    clinicalQuestion: '',
    relevantHistory: '',
    currentMedications: '',
    vitalSigns: '',
    labResults: '',
    imagingResults: '',
    notes: '',
  });

  const [consultResponse, setConsultResponse] = useState({
    assessment: '',
    recommendations: '',
    followUp: '',
  });

  const fetchConsults = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await listConsults();
      if (response.success && Array.isArray(response.items)) {
        setConsults(response.items as Consult[]);
      }
    } catch (err) {
      console.error('Error fetching consults:', err);
      setError(t('docConsult.errorLoadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      const patientData = await getPatients();
      setPatients(patientData);
    };
    loadData();
  }, []);

  useEffect(() => {
    fetchConsults();
  }, [fetchConsults]);

  const handleRequestConsult = async () => {
    if (!newConsult.patientId || !newConsult.reason || !newConsult.clinicalQuestion) {
      showWarning(t('docConsult.errorRequiredFields'));
      return;
    }

    const patient = patients.find((p) => p.patient_id === newConsult.patientId);
    if (!patient) {
      // A bare `return` here meant that if the selected patient was not in the
      // loaded roster the form did nothing at all - no request, no error, no
      // feedback of any kind. The clinician fills the whole consult and the
      // Submit button appears inert.
      showError(t('docConsult.errorPatientNotLoaded'));
      return;
    }

    const consult: Consult = {
      consultId: `CONS-${String(consults.length + 1).padStart(3, '0')}`,
      patientId: patient.patient_id,
      patientName: patient.full_name,
      specialty: newConsult.specialty,
      urgency: newConsult.urgency,
      status: 'requested',
      reason: newConsult.reason,
      clinicalQuestion: newConsult.clinicalQuestion,
      relevantHistory: newConsult.relevantHistory,
      currentMedications: newConsult.currentMedications || undefined,
      vitalSigns: newConsult.vitalSigns || undefined,
      labResults: newConsult.labResults || undefined,
      imagingResults: newConsult.imagingResults || undefined,
      requestedBy: user?.userId || 'USER-001',
      requestedAt: new Date().toISOString(),
      notes: newConsult.notes || undefined,
    };

    try {
      await createConsult(consult);
    } catch (err) {
      console.error('Failed to save consult:', err);
    }

    setConsults([consult, ...consults]);
    setNewConsult({
      patientId: '',
      specialty: 'cardiology',
      urgency: 'routine',
      reason: '',
      clinicalQuestion: '',
      relevantHistory: '',
      currentMedications: '',
      vitalSigns: '',
      labResults: '',
      imagingResults: '',
      notes: '',
    });
    setActiveTab('active');
    showSuccess(t('docConsult.successRequested', { id: consult.consultId }));
  };

  const handleRespondToConsult = async () => {
    if (!selectedConsult || !consultResponse.assessment || !consultResponse.recommendations) {
      showWarning(t('docConsult.errorRequiredResponseFields'));
      return;
    }

    // This used to mutate the local array and announce success without calling
    // the API — there was no endpoint to call. A specialist could write the
    // assessment the requesting clinician was waiting on, see it confirmed, and
    // lose it on reload while the consult still showed as outstanding to
    // everyone else. Persist first; only then update what is on screen.
    setIsRespondingBusy(true);
    try {
      await respondToConsult(selectedConsult, {
        assessment: consultResponse.assessment,
        recommendations: consultResponse.recommendations,
        follow_up: consultResponse.followUp || undefined,
      });
    } catch (err) {
      showError(err instanceof Error ? err.message : t('docConsult.errorResponseFailed'));
      setIsRespondingBusy(false);
      return;
    }

    setConsultResponse({
      assessment: '',
      recommendations: '',
      followUp: '',
    });
    setSelectedConsult('');
    setIsRespondingBusy(false);
    showSuccess(t('docConsult.successResponseSubmitted'));
    // Re-read so the list shows what the server stored, including the
    // server-assigned responder and completion time.
    fetchConsults();
  };

  // `status` and `urgency` are unions in TypeScript but plain strings on the
  // wire — the list is asserted with `as`, never validated — so these lookups
  // must be total. An unmapped status used to return `undefined`, and rendering
  // `undefined` as a JSX element throws "Element type is invalid", which
  // unmounts the whole consult list rather than just the badge.
  const getStatusBadge = (status: ConsultStatus) =>
    lookupOr(
      {
        requested: 'bg-caution-subtle text-caution-subtle-fg',
        acknowledged: 'bg-notice-subtle text-notice-subtle-fg',
        'in-progress': 'bg-surface-sunken text-content-secondary',
        completed: 'bg-ok-subtle text-ok-subtle-fg',
        declined: 'bg-critical-subtle text-critical-subtle-fg',
        cancelled: 'bg-surface-sunken text-content-secondary',
      },
      status,
      'bg-surface-sunken text-content-secondary'
    );

  const getStatusIcon = (status: ConsultStatus) =>
    componentOr(
      {
        requested: Clock,
        acknowledged: AlertCircle,
        'in-progress': Activity,
        completed: CheckCircle,
        declined: XCircle,
        cancelled: XCircle,
      },
      status,
      // A neutral marker: an unrecognised status is "something we cannot
      // characterise", which is closer to a query than to a completion.
      HelpCircle
    );

  const getUrgencyBadge = (urgency: ConsultUrgency) =>
    lookupOr(
      {
        routine: 'bg-surface-sunken text-content-secondary',
        urgent: 'bg-surface-sunken text-content-secondary',
        emergent: 'bg-critical-subtle text-critical-subtle-fg',
        stat: 'bg-red-200 text-critical-subtle-fg',
      },
      urgency,
      'bg-surface-sunken text-content-secondary'
    );

  const formatSpecialty = (specialty: string) => {
    return t(`docConsult.specialty_${specialty}`);
  };

  const _formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString();
  };

  const formatDateTime = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const _filteredConsults = consults.filter((c) => {
    const matchesSearch =
      c.consultId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.reason.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchesSpecialty = specialtyFilter === 'all' || c.specialty === specialtyFilter;

    return matchesSearch && matchesStatus && matchesSpecialty;
  });

  const activeConsults = consults.filter((c) => c.status !== 'completed' && c.status !== 'cancelled');
  const completedConsults = consults.filter((c) => c.status === 'completed');
  const myConsults = consults.filter((c) => c.requestedBy === (user?.userId || 'USER-001'));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-blue-600 to-cyan-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">{t('docConsult.title')}</h1>
        <p className="text-blue-100">{t('docConsult.subtitle')}</p>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'active' ? 'text-notice-subtle-fg border-b-2 border-blue-700' : 'text-content-muted hover:text-notice-subtle-fg'
          }`}
        >
          {t('docConsult.tabActive', { count: activeConsults.length })}
        </button>
        <button
          onClick={() => setActiveTab('new-request')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new-request' ? 'text-notice-subtle-fg border-b-2 border-blue-700' : 'text-content-muted hover:text-notice-subtle-fg'
          }`}
        >
          {t('docConsult.tabNewRequest')}
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'completed' ? 'text-notice-subtle-fg border-b-2 border-blue-700' : 'text-content-muted hover:text-notice-subtle-fg'
          }`}
        >
          {t('docConsult.tabCompleted', { count: completedConsults.length })}
        </button>
        <button
          onClick={() => setActiveTab('my-consults')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'my-consults' ? 'text-notice-subtle-fg border-b-2 border-blue-700' : 'text-content-muted hover:text-notice-subtle-fg'
          }`}
        >
          {t('docConsult.tabMyRequests', { count: myConsults.length })}
        </button>
      </div>

      {(activeTab === 'active' || activeTab === 'completed' || activeTab === 'my-consults') && (
        <div className="space-y-4">
          <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="consult-search" className="block text-sm font-semibold text-content-secondary mb-2">{t('docConsult.searchLabel')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-content-muted w-5 h-5" />
                  <input
                    id="consult-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('docConsult.searchPh')}
                    className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="consult-status-filter" className="block text-sm font-semibold text-content-secondary mb-2">{t('docConsult.statusLabel')}</label>
                <select
                  id="consult-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as ConsultStatus | 'all')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="all">{t('docConsult.filterAllStatuses')}</option>
                  <option value="requested">{t('docConsult.status_requested')}</option>
                  <option value="acknowledged">{t('docConsult.status_acknowledged')}</option>
                  <option value="in-progress">{t('docConsult.status_in-progress')}</option>
                  <option value="completed">{t('docConsult.status_completed')}</option>
                  <option value="declined">{t('docConsult.status_declined')}</option>
                  <option value="cancelled">{t('docConsult.status_cancelled')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="consult-specialty-filter" className="block text-sm font-semibold text-content-secondary mb-2">{t('docConsult.specialtyLabel')}</label>
                <select
                  id="consult-specialty-filter"
                  value={specialtyFilter}
                  onChange={(e) => setSpecialtyFilter(e.target.value as ConsultSpecialty | 'all')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="all">{t('docConsult.filterAllSpecialties')}</option>
                  <option value="cardiology">{t('docConsult.specialty_cardiology')}</option>
                  <option value="neurology">{t('docConsult.specialty_neurology')}</option>
                  <option value="orthopedics">{t('docConsult.specialty_orthopedics')}</option>
                  <option value="general-surgery">{t('docConsult.specialty_general-surgery')}</option>
                  <option value="psychiatry">{t('docConsult.specialty_psychiatry')}</option>
                  <option value="infectious-disease">{t('docConsult.specialty_infectious-disease')}</option>
                  <option value="nephrology">{t('docConsult.specialty_nephrology')}</option>
                  <option value="pulmonology">{t('docConsult.specialty_pulmonology')}</option>
                  <option value="gastroenterology">{t('docConsult.specialty_gastroenterology')}</option>
                  <option value="endocrinology">{t('docConsult.specialty_endocrinology')}</option>
                  <option value="hematology">{t('docConsult.specialty_hematology')}</option>
                  <option value="oncology">{t('docConsult.specialty_oncology')}</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {(activeTab === 'active' ? activeConsults : activeTab === 'completed' ? completedConsults : myConsults)
              .filter((c) => {
                const matchesSearch =
                  c.consultId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  c.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  c.reason.toLowerCase().includes(searchTerm.toLowerCase());
                const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
                const matchesSpecialty = specialtyFilter === 'all' || c.specialty === specialtyFilter;
                return matchesSearch && matchesStatus && matchesSpecialty;
              })
              .map((consult) => {
                const StatusIcon = getStatusIcon(consult.status);
                return (
                  <div key={consult.consultId} className="border border-border-strong rounded-lg shadow-sm bg-surface p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-bold text-content">{consult.consultId}</h3>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${getStatusBadge(consult.status)}`}>
                            <StatusIcon className="w-3 h-3" />
                            {t(`docConsult.status_${consult.status}`).toUpperCase()}
                          </span>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getUrgencyBadge(consult.urgency)}`}>
                            {t(`docConsult.urgency_${consult.urgency}`).toUpperCase()}
                          </span>
                        </div>
                        <p className="text-sm text-content-muted">{t('docConsult.requestedLine', { date: formatDateTime(consult.requestedAt) })}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-4 bg-notice-subtle rounded-lg p-4">
                      <div>
                        <p className="text-sm text-notice-subtle-fg font-semibold mb-1">{t('docConsult.lblPatient')}</p>
                        <p className="font-semibold text-content">{consult.patientName}</p>
                        <p className="text-sm text-content-muted">{consult.patientId}</p>
                      </div>
                      <div>
                        <p className="text-sm text-notice-subtle-fg font-semibold mb-1">{t('docConsult.lblSpecialty')}</p>
                        <p className="font-semibold text-content">{formatSpecialty(consult.specialty)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-notice-subtle-fg font-semibold mb-1">{t('docConsult.lblRequestedBy')}</p>
                        <p className="text-sm text-content">{consult.requestedBy}</p>
                      </div>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div className="bg-caution-subtle border border-caution rounded-lg p-3">
                        <p className="text-sm font-semibold text-caution-subtle-fg mb-1">{t('docConsult.reasonTitle')}</p>
                        <p className="text-sm text-caution-subtle-fg">{consult.reason}</p>
                      </div>

                      <div className="bg-notice-subtle border border-notice rounded-lg p-3">
                        <p className="text-sm font-semibold text-notice-subtle-fg mb-1">{t('docConsult.clinicalQuestionTitle')}</p>
                        <p className="text-sm text-notice-subtle-fg">{consult.clinicalQuestion}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-surface-sunken border border-border rounded p-3">
                          <p className="text-sm font-semibold text-content-secondary mb-1">{t('docConsult.relevantHistoryTitle')}</p>
                          <p className="text-sm text-content">{consult.relevantHistory}</p>
                        </div>
                        {consult.currentMedications && (
                          <div className="bg-surface-sunken border border-border rounded p-3">
                            <p className="text-sm font-semibold text-content-secondary mb-1">{t('docConsult.currentMedicationsTitle')}</p>
                            <p className="text-sm text-content">{consult.currentMedications}</p>
                          </div>
                        )}
                      </div>

                      {consult.vitalSigns && (
                        <div className="bg-surface-sunken border border-border rounded p-3">
                          <p className="text-sm font-semibold text-content-secondary mb-1">{t('docConsult.vitalSignsTitle')}</p>
                          <p className="text-sm text-content">{consult.vitalSigns}</p>
                        </div>
                      )}

                      {consult.labResults && (
                        <div className="bg-surface-sunken border border-border rounded p-3">
                          <p className="text-sm font-semibold text-content-secondary mb-1">{t('docConsult.labResultsTitle')}</p>
                          <p className="text-sm text-content">{consult.labResults}</p>
                        </div>
                      )}

                      {consult.imagingResults && (
                        <div className="bg-surface-sunken border border-border rounded p-3">
                          <p className="text-sm font-semibold text-content-secondary mb-1">{t('docConsult.imagingResultsTitle')}</p>
                          <p className="text-sm text-content">{consult.imagingResults}</p>
                        </div>
                      )}
                    </div>

                    {consult.acknowledgedBy && (
                      <div className="bg-ok-subtle border border-ok rounded-lg p-3 mb-4">
                        <p className="text-sm font-semibold text-ok-subtle-fg mb-1">{t('docConsult.acknowledgedTitle')}</p>
                        <p className="text-sm text-ok-subtle-fg">
                          {t('docConsult.acknowledgedByLine', { by: consult.acknowledgedBy, date: formatDateTime(consult.acknowledgedAt!) })}
                        </p>
                      </div>
                    )}

                    {consult.response && (
                      <div className="border-t pt-4">
                        <h4 className="font-bold text-content mb-3 flex items-center gap-2">
                          <MessageSquare className="w-5 h-5 text-notice-subtle-fg" />
                          {t('docConsult.consultationResponseTitle')}
                        </h4>
                        <div className="space-y-3">
                          <div className="bg-notice-subtle border border-notice rounded-lg p-4">
                            <p className="text-sm font-semibold text-notice-subtle-fg mb-2">{t('docConsult.assessmentTitle')}</p>
                            <p className="text-sm text-notice-subtle-fg whitespace-pre-line">{consult.response.assessment}</p>
                          </div>

                          <div className="bg-ok-subtle border border-ok rounded-lg p-4">
                            <p className="text-sm font-semibold text-ok-subtle-fg mb-2">{t('docConsult.recommendationsTitle')}</p>
                            <p className="text-sm text-ok-subtle-fg whitespace-pre-line">{consult.response.recommendations}</p>
                          </div>

                          {consult.response.followUp && (
                            <div className="bg-surface-sunken border border-purple-200 rounded-lg p-4">
                              <p className="text-sm font-semibold text-content-secondary mb-2">{t('docConsult.followUpPlanTitle')}</p>
                              <p className="text-sm text-content-secondary">{consult.response.followUp}</p>
                            </div>
                          )}

                          <div className="text-sm text-content-muted">
                            {t('docConsult.responseByLine', { by: consult.response.respondedBy, date: formatDateTime(consult.response.respondedAt) })}
                          </div>
                        </div>
                      </div>
                    )}

                    {consult.notes && (
                      <div className="bg-surface-sunken border border-border rounded-lg p-3 mt-4">
                        <p className="text-sm font-semibold text-content-secondary mb-1">{t('docConsult.additionalNotesTitle')}</p>
                        <p className="text-sm text-content-muted italic">{consult.notes}</p>
                      </div>
                    )}

                    {!consult.response && consult.status !== 'cancelled' && consult.status !== 'declined' && (
                      <div className="mt-4 pt-4 border-t">
                        <button
                          onClick={() => {
                            setSelectedConsult(consult.consultId);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-semibold flex items-center justify-center gap-2"
                        >
                          <Send className="w-4 h-4" />
                          {t('docConsult.respondToConsultBtn')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

            {(activeTab === 'active' ? activeConsults : activeTab === 'completed' ? completedConsults : myConsults).filter((c) => {
              const matchesSearch =
                c.consultId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.reason.toLowerCase().includes(searchTerm.toLowerCase());
              const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
              const matchesSpecialty = specialtyFilter === 'all' || c.specialty === specialtyFilter;
              return matchesSearch && matchesStatus && matchesSpecialty;
            }).length === 0 && (
              <div className="bg-surface-sunken border border-border rounded-lg p-8 text-center">
                <FileText className="w-12 h-12 text-content-muted mx-auto mb-3" />
                <p className="text-content-muted">{t('docConsult.noConsultsFound')}</p>
              </div>
            )}
          </div>

          {selectedConsult && (
            <div className="bg-surface rounded-lg shadow-sm border border-border p-6 mt-6">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                {t('docConsult.respondToConsultTitle', { id: selectedConsult })}
              </h3>

              <div className="space-y-4">
                <div>
                  <label htmlFor="consult-assessment" className="block text-sm font-semibold text-content-secondary mb-2">
                    {t('docConsult.assessmentLabel')} <span className="text-critical-subtle-fg">*</span>
                  </label>
                  <textarea
                    id="consult-assessment"
                    value={consultResponse.assessment}
                    onChange={(e) => setConsultResponse({ ...consultResponse, assessment: e.target.value })}
                    placeholder={t('docConsult.assessmentPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                    rows={4}
                  />
                </div>

                <div>
                  <label htmlFor="consult-recommendations" className="block text-sm font-semibold text-content-secondary mb-2">
                    {t('docConsult.recommendationsLabel')} <span className="text-critical-subtle-fg">*</span>
                  </label>
                  <textarea
                    id="consult-recommendations"
                    value={consultResponse.recommendations}
                    onChange={(e) => setConsultResponse({ ...consultResponse, recommendations: e.target.value })}
                    placeholder={t('docConsult.recommendationsPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                    rows={6}
                  />
                </div>

                <div>
                  <label htmlFor="consult-follow-up" className="block text-sm font-semibold text-content-secondary mb-2">{t('docConsult.followUpPlanLabel')}</label>
                  <textarea
                    id="consult-follow-up"
                    value={consultResponse.followUp}
                    onChange={(e) => setConsultResponse({ ...consultResponse, followUp: e.target.value })}
                    placeholder={t('docConsult.followUpPlanPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                    rows={3}
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleRespondToConsult}
                    disabled={isRespondingBusy}
                    className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-semibold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Send className="w-4 h-4" />
                    {isRespondingBusy
                      ? t('docConsult.submittingResponse')
                      : t('docConsult.submitResponseBtn')}
                  </button>
                  <button
                    onClick={() => {
                      setSelectedConsult('');
                      setConsultResponse({ assessment: '', recommendations: '', followUp: '' });
                    }}
                    className="px-6 py-3 border border-border-strong rounded-lg hover:bg-surface-sunken transition-colors font-semibold"
                  >
                    {t('docConsult.cancelBtn')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'new-request' && (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5" />
            {t('docConsult.requestConsultTitle')}
          </h2>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="consult-patient" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docConsult.patientLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="consult-patient"
                  value={newConsult.patientId}
                  onChange={(e) => setNewConsult({ ...newConsult, patientId: e.target.value })}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="">{t('docConsult.selectPatientPh')}</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} ({p.patient_id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="consult-specialty" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docConsult.specialtyLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="consult-specialty"
                  value={newConsult.specialty}
                  onChange={(e) => setNewConsult({ ...newConsult, specialty: e.target.value as ConsultSpecialty })}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="cardiology">{t('docConsult.specialty_cardiology')}</option>
                  <option value="neurology">{t('docConsult.specialty_neurology')}</option>
                  <option value="orthopedics">{t('docConsult.specialty_orthopedics')}</option>
                  <option value="general-surgery">{t('docConsult.specialty_general-surgery')}</option>
                  <option value="psychiatry">{t('docConsult.specialty_psychiatry')}</option>
                  <option value="infectious-disease">{t('docConsult.specialty_infectious-disease')}</option>
                  <option value="nephrology">{t('docConsult.specialty_nephrology')}</option>
                  <option value="pulmonology">{t('docConsult.specialty_pulmonology')}</option>
                  <option value="gastroenterology">{t('docConsult.specialty_gastroenterology')}</option>
                  <option value="endocrinology">{t('docConsult.specialty_endocrinology')}</option>
                  <option value="hematology">{t('docConsult.specialty_hematology')}</option>
                  <option value="oncology">{t('docConsult.specialty_oncology')}</option>
                  <option value="dermatology">{t('docConsult.specialty_dermatology')}</option>
                  <option value="urology">{t('docConsult.specialty_urology')}</option>
                  <option value="ophthalmology">{t('docConsult.specialty_ophthalmology')}</option>
                  <option value="ent">{t('docConsult.specialty_ent')}</option>
                  <option value="obstetrics-gynecology">{t('docConsult.specialty_obstetrics-gynecology')}</option>
                  <option value="pediatrics">{t('docConsult.specialty_pediatrics')}</option>
                  <option value="radiology">{t('docConsult.specialty_radiology')}</option>
                  <option value="pathology">{t('docConsult.specialty_pathology')}</option>
                  <option value="anesthesiology">{t('docConsult.specialty_anesthesiology')}</option>
                  <option value="plastic-surgery">{t('docConsult.specialty_plastic-surgery')}</option>
                  <option value="vascular-surgery">{t('docConsult.specialty_vascular-surgery')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="consult-urgency" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docConsult.urgencyLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="consult-urgency"
                  value={newConsult.urgency}
                  onChange={(e) => setNewConsult({ ...newConsult, urgency: e.target.value as ConsultUrgency })}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="routine">{t('docConsult.urgency_routine')}</option>
                  <option value="urgent">{t('docConsult.urgency_urgent')}</option>
                  <option value="emergent">{t('docConsult.urgency_emergent')}</option>
                  <option value="stat">{t('docConsult.urgency_stat')}</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="consult-reason" className="block text-sm font-semibold text-content-secondary mb-2">
                {t('docConsult.reasonLabel')} <span className="text-critical-subtle-fg">*</span>
              </label>
              <input
                id="consult-reason"
                type="text"
                value={newConsult.reason}
                onChange={(e) => setNewConsult({ ...newConsult, reason: e.target.value })}
                placeholder={t('docConsult.reasonPh')}
                className="w-full border border-border-strong rounded-lg px-3 py-2"
              />
            </div>

            <div>
              <label htmlFor="consult-clinical-question" className="block text-sm font-semibold text-content-secondary mb-2">
                {t('docConsult.clinicalQuestionLabel')} <span className="text-critical-subtle-fg">*</span>
              </label>
              <textarea
                id="consult-clinical-question"
                value={newConsult.clinicalQuestion}
                onChange={(e) => setNewConsult({ ...newConsult, clinicalQuestion: e.target.value })}
                placeholder={t('docConsult.clinicalQuestionPh')}
                className="w-full border border-border-strong rounded-lg px-3 py-2"
                rows={3}
              />
            </div>

            <div>
              <label htmlFor="consult-relevant-history" className="block text-sm font-semibold text-content-secondary mb-2">{t('docConsult.relevantHistoryLabel')}</label>
              <textarea
                id="consult-relevant-history"
                value={newConsult.relevantHistory}
                onChange={(e) => setNewConsult({ ...newConsult, relevantHistory: e.target.value })}
                placeholder={t('docConsult.relevantHistoryPh')}
                className="w-full border border-border-strong rounded-lg px-3 py-2"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="consult-current-medications" className="block text-sm font-semibold text-content-secondary mb-2">{t('docConsult.currentMedicationsLabel')}</label>
                <textarea
                  id="consult-current-medications"
                  value={newConsult.currentMedications}
                  onChange={(e) => setNewConsult({ ...newConsult, currentMedications: e.target.value })}
                  placeholder={t('docConsult.currentMedicationsPh')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>

              <div>
                <label htmlFor="consult-vital-signs" className="block text-sm font-semibold text-content-secondary mb-2">{t('docConsult.vitalSignsLabel')}</label>
                <textarea
                  id="consult-vital-signs"
                  value={newConsult.vitalSigns}
                  onChange={(e) => setNewConsult({ ...newConsult, vitalSigns: e.target.value })}
                  placeholder={t('docConsult.vitalSignsPh')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>

              <div>
                <label htmlFor="consult-lab-results" className="block text-sm font-semibold text-content-secondary mb-2">{t('docConsult.labResultsLabel')}</label>
                <textarea
                  id="consult-lab-results"
                  value={newConsult.labResults}
                  onChange={(e) => setNewConsult({ ...newConsult, labResults: e.target.value })}
                  placeholder={t('docConsult.labResultsPh')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>

              <div>
                <label htmlFor="consult-imaging-results" className="block text-sm font-semibold text-content-secondary mb-2">{t('docConsult.imagingResultsLabel')}</label>
                <textarea
                  id="consult-imaging-results"
                  value={newConsult.imagingResults}
                  onChange={(e) => setNewConsult({ ...newConsult, imagingResults: e.target.value })}
                  placeholder={t('docConsult.imagingResultsPh')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>
            </div>

            <div>
              <label htmlFor="consult-additional-notes" className="block text-sm font-semibold text-content-secondary mb-2">{t('docConsult.additionalNotesLabel')}</label>
              <textarea
                id="consult-additional-notes"
                value={newConsult.notes}
                onChange={(e) => setNewConsult({ ...newConsult, notes: e.target.value })}
                placeholder={t('docConsult.additionalNotesPh')}
                className="w-full border border-border-strong rounded-lg px-3 py-2"
                rows={2}
              />
            </div>

            <div className="bg-notice-subtle border border-notice rounded-lg p-4">
              <p className="text-sm font-semibold text-notice-subtle-fg mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {t('docConsult.guidelinesTitle')}
              </p>
              <ul className="text-sm text-notice-subtle-fg space-y-1">
                <li>• {t('docConsult.guideline1')}</li>
                <li>• {t('docConsult.guideline2')}</li>
                <li>• {t('docConsult.guideline3')}</li>
                <li>• {t('docConsult.guideline4')}</li>
                <li>• {t('docConsult.guideline5')}</li>
              </ul>
            </div>
          </div>

          <button
            onClick={handleRequestConsult}
            className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-semibold mt-6 flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            {t('docConsult.submitRequestBtn')}
          </button>
        </div>
      )}
    </div>
  );
};

export default ConsultPage;
