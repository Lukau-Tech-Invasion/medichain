import { useState, useEffect } from 'react';
import {
  LogOut,
  FileText,
  Pill,
  Calendar,
  AlertTriangle,
  CheckCircle,
  User,
  Clock,
  Loader2,
  Wifi,
  WifiOff,
  ChevronRight,
  Home,
  Heart,
  Activity,
  Clipboard,
  Download,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { apiUrl, exportDocumentToPdf, getApiClient, useTranslation } from '@medichain/shared';
import { usePatientStore } from '../store/patientStore';
import { Link, useNavigate } from 'react-router-dom';

interface DischargeInstruction {
  category: string;
  instructions: string[];
}

interface FollowUpAppointment {
  specialty: string;
  provider: string;
  date: string;
  time: string;
  location: string;
  phone: string;
}

interface DischargeMedication {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  is_new: boolean;
}

interface DischargeSummary {
  id: string;
  patient_id: string;
  patient_name: string;
  admission_date: string;
  discharge_date: string;
  discharge_disposition: string;
  primary_diagnosis: string;
  secondary_diagnoses: string[];
  procedures_performed: string[];
  discharge_condition: string;
  discharge_instructions: DischargeInstruction[];
  follow_up_appointments: FollowUpAppointment[];
  discharge_medications: DischargeMedication[];
  activity_restrictions: string[];
  diet_instructions: string;
  warning_signs: string[];
  emergency_contact_instructions: string;
  prepared_by: string;
  approved_by: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'completed';
  created_at: string;
}

interface Patient {
  patient_id: string;
  full_name: string;
  date_of_birth: string;
  admission_date?: string;
}

/**
 * DischargePage - Manage patient discharge documentation
 */
function DischargePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [discharges, setDischarges] = useState<DischargeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [apiConnected, setApiConnected] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  
  const { user, isAuthenticated } = useAuthStore();
  const { recentPatients } = usePatientStore();

  // Form state
  const [formData, setFormData] = useState({
    primary_diagnosis: '',
    secondary_diagnoses: '',
    procedures_performed: '',
    discharge_disposition: 'home',
    discharge_condition: 'stable',
    diet_instructions: 'Resume regular diet as tolerated',
    activity_restrictions: '',
    warning_signs: '',
    emergency_instructions: t('docDischarge.defaultEmergencyInstructions', { emergencyNumber: t('common.emergencyNumber') }),
  });

  const [medications, setMedications] = useState<DischargeMedication[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpAppointment[]>([]);
  const [instructions] = useState<DischargeInstruction[]>([
    { category: 'Wound Care', instructions: [] },
    { category: 'Activity', instructions: [] },
    { category: 'Medications', instructions: [] },
  ]);

  // Auth redirect
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchPatients();
      fetchDischarges();
    }
  }, [isAuthenticated, user]);

  const fetchPatients = async () => {
    if (!user) return;
    try {
      const response = await fetch(apiUrl('/api/patients'), {
        headers: { 
          ...getApiClient().getSessionHeaders(user.walletAddress),
          'X-Provider-Role': user.role,
        },
      });
      if (response.ok) {
        const data = await response.json();
        const patientArray = Array.isArray(data) ? data : (data.data || []);
        setPatients(patientArray);
        setApiConnected(true);
      } else {
        setApiConnected(false);
      }
    } catch {
      setApiConnected(false);
    }
  };

  const fetchDischarges = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const response = await fetch(apiUrl('/api/clinical/discharges'), {
        headers: { 
          ...getApiClient().getSessionHeaders(user.walletAddress),
          'X-Provider-Role': user.role,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setDischarges(data.discharges || []);
        setApiConnected(true);
      } else {
        setApiConnected(false);
        setError(t('docDischarge.errorConnectFailed'));
      }
    } catch {
      setApiConnected(false);
      setError(t('docDischarge.errorFetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const addMedication = () => {
    setMedications([...medications, {
      name: '',
      dosage: '',
      frequency: '',
      duration: '',
      instructions: '',
      is_new: true,
    }]);
  };

  const addFollowUp = () => {
    setFollowUps([...followUps, {
      specialty: '',
      provider: '',
      date: '',
      time: '',
      location: '',
      phone: '',
    }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!selectedPatient) {
      setError(t('docDischarge.errorSelectPatient'));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const patient = patients.find(p => p.patient_id === selectedPatient);
      const payload = {
        patient_id: selectedPatient,
        patient_name: patient?.full_name || '',
        admission_date: patient?.admission_date || new Date().toISOString().split('T')[0],
        discharge_date: new Date().toISOString().split('T')[0],
        discharge_disposition: formData.discharge_disposition,
        primary_diagnosis: formData.primary_diagnosis,
        secondary_diagnoses: formData.secondary_diagnoses.split('\n').filter(Boolean),
        procedures_performed: formData.procedures_performed.split('\n').filter(Boolean),
        discharge_condition: formData.discharge_condition,
        discharge_instructions: instructions.filter(i => i.instructions.length > 0),
        follow_up_appointments: followUps,
        discharge_medications: medications,
        activity_restrictions: formData.activity_restrictions.split('\n').filter(Boolean),
        diet_instructions: formData.diet_instructions,
        warning_signs: formData.warning_signs.split('\n').filter(Boolean),
        emergency_contact_instructions: formData.emergency_instructions,
        prepared_by: user.walletAddress,
      };

      const response = await fetch(apiUrl('/api/clinical/discharge-summary'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getApiClient().getSessionHeaders(user.walletAddress),
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setSuccess(t('docDischarge.successCreated'));
        setShowForm(false);
        fetchDischarges();
        resetForm();
      } else {
        setSuccess(t('docDischarge.errorCreateFailed'));
      }
    } catch (error) {
      console.error('Error creating discharge summary:', error);
      setSuccess(t('docDischarge.errorGenericCreate'));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      primary_diagnosis: '',
      secondary_diagnoses: '',
      procedures_performed: '',
      discharge_disposition: 'home',
      discharge_condition: 'stable',
      diet_instructions: 'Resume regular diet as tolerated',
      activity_restrictions: '',
      warning_signs: '',
      emergency_instructions: t('docDischarge.defaultEmergencyInstructions', { emergencyNumber: t('common.emergencyNumber') }),
    });
    setMedications([]);
    setFollowUps([]);
    setSelectedPatient('');
  };

  const handleExportPdf = async (discharge: DischargeSummary) => {
    setExportingId(discharge.id);
    try {
      await exportDocumentToPdf({
        title: t('docDischarge.pdfTitle'),
        subtitle: `${discharge.patient_name} (${discharge.patient_id}) — ${discharge.discharge_date}`,
        filename: `discharge-summary-${discharge.id}.pdf`,
        sections: [
          {
            heading: t('docDischarge.pdfDiagnosisSection'),
            lines: [
              `${t('docDischarge.lblPrimaryDiagnosis')}: ${discharge.primary_diagnosis}`,
              ...discharge.secondary_diagnoses,
              ...discharge.procedures_performed.map(p => `${t('docDischarge.pdfProcedurePrefix')}: ${p}`),
              `${t('docDischarge.lblCondition')}: ${discharge.discharge_condition}`,
            ],
          },
          {
            heading: t('docDischarge.dischargeMedicationsTitle'),
            lines: discharge.discharge_medications.map(
              m => `${m.name} ${m.dosage} — ${m.frequency} (${m.duration})${m.instructions ? `: ${m.instructions}` : ''}`
            ),
          },
          {
            heading: t('docDischarge.followUpAppointmentsTitle'),
            lines: discharge.follow_up_appointments.map(a =>
              t('docDischarge.followUpLine', { specialty: a.specialty, provider: a.provider, date: a.date, time: a.time })
            ),
          },
          ...discharge.discharge_instructions
            .filter(i => i.instructions.length > 0)
            .map(i => ({ heading: i.category, lines: i.instructions })),
          {
            heading: t('docDischarge.warningSignsTitle'),
            lines: discharge.warning_signs,
          },
        ].filter(section => section.lines.length > 0),
      });
    } catch (err) {
      console.error('Failed to export discharge summary PDF:', err);
    } finally {
      setExportingId(null);
    }
  };

  const approveDischarge = async (id: string) => {
    if (!user) return;
    try {
      await fetch(apiUrl(`/api/clinical/discharges/${id}/approve`), {
        method: 'POST',
        headers: { 
          ...getApiClient().getSessionHeaders(user.walletAddress),
          'X-Provider-Role': user.role,
        },
      });
      setSuccess(t('docDischarge.successApproved'));
      fetchDischarges();
    } catch {
      setSuccess(t('docDischarge.successApprovedDemo'));
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-surface-sunken text-content-secondary';
      case 'pending_approval': return 'bg-caution-subtle text-caution-subtle-fg';
      case 'approved': return 'bg-ok-subtle text-ok-subtle-fg';
      case 'completed': return 'bg-notice-subtle text-notice-subtle-fg';
      default: return 'bg-surface-sunken text-content-secondary';
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'improved': return 'text-ok-subtle-fg';
      case 'stable': return 'text-notice-subtle-fg';
      case 'unchanged': return 'text-caution-subtle-fg';
      case 'declined': return 'text-critical-subtle-fg';
      default: return 'text-content-muted';
    }
  };

  const pendingDischarges = discharges.filter(d => d.status !== 'completed');
  const completedDischarges = discharges.filter(d => d.status === 'completed');

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-content flex items-center gap-3">
            <LogOut className="text-brand" />
            {t('docDischarge.title')}
          </h1>
          <p className="text-content-muted mt-1">
            {t('docDischarge.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${apiConnected ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-critical-subtle text-critical-subtle-fg'}`}>
            {apiConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
            {apiConnected ? t('docDischarge.apiConnected') : t('docDischarge.offlineMode')}
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="bg-brand text-brand-fg px-4 py-2 rounded-lg hover:bg-brand flex items-center gap-2"
          >
            <FileText size={20} />
            {t('docDischarge.newDischargeBtn')}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {success && (
        <div className="mb-6 p-4 bg-ok-subtle border border-ok rounded-lg flex items-center gap-3">
          <CheckCircle className="text-green-500" size={20} />
          <span className="text-ok-subtle-fg">{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto text-green-500 hover:text-ok-subtle-fg">×</button>
        </div>
      )}
      {error && (
        <div className="mb-6 p-4 bg-critical-subtle border border-critical rounded-lg flex items-center gap-3">
          <AlertTriangle className="text-red-500" size={20} />
          <span className="text-critical-subtle-fg">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-critical-subtle-fg">×</button>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-surface rounded-xl p-4 shadow border-l-4 border-yellow-500">
          <div className="flex items-center gap-3">
            <Clock className="text-yellow-500" size={24} />
            <div>
              <p className="text-2xl font-bold text-content">{pendingDischarges.length}</p>
              <p className="text-sm text-content-muted">{t('docDischarge.statPending')}</p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-xl p-4 shadow border-l-4 border-green-500">
          <div className="flex items-center gap-3">
            <CheckCircle className="text-green-500" size={24} />
            <div>
              <p className="text-2xl font-bold text-content">{completedDischarges.length}</p>
              <p className="text-sm text-content-muted">{t('docDischarge.statCompletedToday')}</p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-xl p-4 shadow border-l-4 border-blue-500">
          <div className="flex items-center gap-3">
            <Home className="text-blue-500" size={24} />
            <div>
              <p className="text-2xl font-bold text-content">{discharges.filter(d => d.discharge_disposition === 'home').length}</p>
              <p className="text-sm text-content-muted">{t('docDischarge.statDischargedHome')}</p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-xl p-4 shadow border-l-4 border-purple-500">
          <div className="flex items-center gap-3">
            <Activity className="text-purple-500" size={24} />
            <div>
              <p className="text-2xl font-bold text-content">{recentPatients.length}</p>
              <p className="text-sm text-content-muted">{t('docDischarge.statRecentPatients')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'pending' ? 'bg-brand text-brand-fg' : 'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'}`}
        >
          {t('docDischarge.tabPending', { count: pendingDischarges.length })}
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'completed' ? 'bg-brand text-brand-fg' : 'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'}`}
        >
          {t('docDischarge.tabCompleted', { count: completedDischarges.length })}
        </button>
      </div>

      {/* Discharge List */}
      {loading ? (
        <div className="bg-surface rounded-xl shadow p-12 text-center">
          <Loader2 className="mx-auto mb-3 text-primary-500 animate-spin" size={48} />
          <p className="text-content-muted">{t('docDischarge.loadingDischarges')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(activeTab === 'pending' ? pendingDischarges : completedDischarges).map((discharge) => (
            <div key={discharge.id} className="bg-surface rounded-xl shadow overflow-hidden">
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-brand-subtle rounded-full flex items-center justify-center">
                      <User className="text-brand" size={24} />
                    </div>
                    <div>
                      <h3 className="font-bold text-content">{discharge.patient_name}</h3>
                      <p className="text-sm text-content-muted">{t('docDischarge.admittedLine', { id: discharge.patient_id, date: discharge.admission_date })}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(discharge.status)}`}>
                      {t(`docDischarge.status_${discharge.status}`)}
                    </span>
                    {discharge.status === 'pending_approval' && (
                      <button
                        onClick={() => approveDischarge(discharge.id)}
                        className="bg-ok text-ok-fg px-4 py-2 rounded-lg hover:bg-ok flex items-center gap-2"
                      >
                        <CheckCircle size={16} />
                        {t('docDischarge.approveBtn')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-content-muted">{t('docDischarge.lblPrimaryDiagnosis')}</p>
                    <p className="font-medium text-content">{discharge.primary_diagnosis}</p>
                  </div>
                  <div>
                    <p className="text-sm text-content-muted">{t('docDischarge.lblDischargeDate')}</p>
                    <p className="font-medium text-content">{discharge.discharge_date}</p>
                  </div>
                  <div>
                    <p className="text-sm text-content-muted">{t('docDischarge.lblCondition')}</p>
                    <p className={`font-medium capitalize ${getConditionColor(discharge.discharge_condition)}`}>
                      {discharge.discharge_condition}
                    </p>
                  </div>
                </div>

                {/* Medications */}
                {discharge.discharge_medications.length > 0 && (
                  <div className="mt-4 p-3 bg-notice-subtle rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Pill className="text-notice-subtle-fg" size={16} />
                      <span className="font-medium text-notice-subtle-fg">{t('docDischarge.dischargeMedicationsTitle')}</span>
                    </div>
                    <div className="space-y-1">
                      {discharge.discharge_medications.slice(0, 3).map((med, i) => (
                        <p key={i} className="text-sm text-notice-subtle-fg">
                          {med.name} {med.dosage} - {med.frequency}
                          {med.is_new && <span className="ml-2 px-2 py-0.5 bg-ok-subtle text-ok-subtle-fg rounded text-xs">{t('docDischarge.newBadge')}</span>}
                        </p>
                      ))}
                      {discharge.discharge_medications.length > 3 && (
                        <p className="text-sm text-notice-subtle-fg">{t('docDischarge.moreCount', { count: discharge.discharge_medications.length - 3 })}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Follow-ups */}
                {discharge.follow_up_appointments.length > 0 && (
                  <div className="mt-4 p-3 bg-surface-sunken rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="text-content-secondary" size={16} />
                      <span className="font-medium text-content-secondary">{t('docDischarge.followUpAppointmentsTitle')}</span>
                    </div>
                    <div className="space-y-1">
                      {discharge.follow_up_appointments.map((apt, i) => (
                        <p key={i} className="text-sm text-content-secondary">
                          {t('docDischarge.followUpLine', { specialty: apt.specialty, provider: apt.provider, date: apt.date, time: apt.time })}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Warning Signs */}
                {discharge.warning_signs.length > 0 && (
                  <div className="mt-4 p-3 bg-critical-subtle rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="text-critical-subtle-fg" size={16} />
                      <span className="font-medium text-critical-subtle-fg">{t('docDischarge.warningSignsTitle')}</span>
                    </div>
                    <ul className="text-sm text-critical-subtle-fg list-disc list-inside">
                      {discharge.warning_signs.map((sign, i) => (
                        <li key={i}>{sign}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between text-sm text-content-muted">
                  <span>{t('docDischarge.preparedByLine', { value: discharge.prepared_by })}</span>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => handleExportPdf(discharge)}
                      disabled={exportingId === discharge.id}
                      className="text-brand hover:text-brand flex items-center gap-1 disabled:opacity-50"
                    >
                      <Download size={16} />
                      {exportingId === discharge.id ? t('docDischarge.exportingPdf') : t('docDischarge.exportPdf')}
                    </button>
                    <Link to={`/patients/${discharge.patient_id}`} className="text-brand hover:text-brand flex items-center gap-1">
                      {t('docDischarge.viewPatientLink')} <ChevronRight size={16} />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {(activeTab === 'pending' ? pendingDischarges : completedDischarges).length === 0 && (
            <div className="bg-surface rounded-xl shadow p-12 text-center">
              <LogOut className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-content-muted">{t('docDischarge.noDischarges', { tab: activeTab })}</p>
            </div>
          )}
        </div>
      )}

      {/* New Discharge Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b border-border p-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-content">{t('docDischarge.createModalTitle')}</h2>
              <button onClick={() => setShowForm(false)} className="text-content-muted hover:text-content-muted text-2xl">×</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Patient Selection */}
              <div>
                <label htmlFor="dc-patient" className="text-sm font-medium text-content-secondary mb-1 flex items-center gap-1">
                  <User size={16} /> {t('docDischarge.patientLabel')}
                </label>
                <select
                  id="dc-patient"
                  value={selectedPatient}
                  onChange={(e) => setSelectedPatient(e.target.value)}
                  className="w-full p-3 border border-border rounded-lg"
                  required
                >
                  <option value="">{t('docDischarge.selectPatientPh')}</option>
                  {patients.map(p => (
                    <option key={p.patient_id} value={p.patient_id}>{p.full_name} ({p.patient_id})</option>
                  ))}
                </select>
              </div>

              {/* Diagnoses */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dc-primary-diagnosis" className="text-sm font-medium text-content-secondary mb-1 flex items-center gap-1">
                    <Heart size={16} /> {t('docDischarge.primaryDiagnosisLabel')}
                  </label>
                  <input
                    id="dc-primary-diagnosis"
                    type="text"
                    value={formData.primary_diagnosis}
                    onChange={(e) => setFormData({ ...formData, primary_diagnosis: e.target.value })}
                    className="w-full p-3 border border-border rounded-lg"
                    placeholder={t('docDischarge.primaryDiagnosisPh')}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="dc-discharge-disposition" className="text-sm font-medium text-content-secondary mb-1 flex items-center gap-1">
                    <Clipboard size={16} /> {t('docDischarge.dischargeDispositionLabel')}
                  </label>
                  <select
                    id="dc-discharge-disposition"
                    value={formData.discharge_disposition}
                    onChange={(e) => setFormData({ ...formData, discharge_disposition: e.target.value })}
                    className="w-full p-3 border border-border rounded-lg"
                  >
                    <option value="home">{t('docDischarge.disposition_home')}</option>
                    <option value="home_health">{t('docDischarge.disposition_homeHealth')}</option>
                    <option value="snf">{t('docDischarge.disposition_snf')}</option>
                    <option value="rehab">{t('docDischarge.disposition_rehab')}</option>
                    <option value="ltac">{t('docDischarge.disposition_ltac')}</option>
                    <option value="hospice">{t('docDischarge.disposition_hospice')}</option>
                    <option value="ama">{t('docDischarge.disposition_ama')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="dc-secondary-diagnoses" className="text-sm font-medium text-content-secondary mb-1">{t('docDischarge.secondaryDiagnosesLabel')}</label>
                <textarea
                  id="dc-secondary-diagnoses"
                  value={formData.secondary_diagnoses}
                  onChange={(e) => setFormData({ ...formData, secondary_diagnoses: e.target.value })}
                  className="w-full p-3 border border-border rounded-lg"
                  rows={3}
                  placeholder="Type 2 Diabetes&#10;Hypertension&#10;..."
                />
              </div>

              {/* Discharge Condition */}
              <div>
                <label id="dc-discharge-condition-label" className="text-sm font-medium text-content-secondary mb-1">{t('docDischarge.dischargeConditionLabel')}</label>
                <div className="grid grid-cols-4 gap-2" role="group" aria-labelledby="dc-discharge-condition-label">
                  {['improved', 'stable', 'unchanged', 'declined'].map((condition) => (
                    <button
                      key={condition}
                      type="button"
                      onClick={() => setFormData({ ...formData, discharge_condition: condition })}
                      className={`p-3 rounded-lg border capitalize ${formData.discharge_condition === condition ? 'border-brand bg-brand-subtle text-brand-subtle-fg' : 'border-border hover:bg-surface-sunken'}`}
                    >
                      {t(`docDischarge.condition_${condition}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Medications */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-content-secondary flex items-center gap-1">
                    <Pill size={16} /> {t('docDischarge.dischargeMedicationsLabel')}
                  </label>
                  <button type="button" onClick={addMedication} className="text-brand hover:text-brand text-sm inline-flex items-center gap-1 min-h-[24px] py-1">
                    {t('docDischarge.addMedicationBtn')}
                  </button>
                </div>
                {medications.map((med, i) => (
                  <div key={i} className="grid grid-cols-5 gap-2 mb-2">
                    <input
                      type="text"
                      value={med.name}
                      onChange={(e) => {
                        const updated = [...medications];
                        updated[i].name = e.target.value;
                        setMedications(updated);
                      }}
                      placeholder={t('docDischarge.medNamePh')}
                      className="p-2 border border-border rounded-lg"
                    />
                    <input
                      type="text"
                      value={med.dosage}
                      onChange={(e) => {
                        const updated = [...medications];
                        updated[i].dosage = e.target.value;
                        setMedications(updated);
                      }}
                      placeholder={t('docDischarge.dosagePh')}
                      className="p-2 border border-border rounded-lg"
                    />
                    <input
                      type="text"
                      value={med.frequency}
                      onChange={(e) => {
                        const updated = [...medications];
                        updated[i].frequency = e.target.value;
                        setMedications(updated);
                      }}
                      placeholder={t('docDischarge.frequencyPh')}
                      className="p-2 border border-border rounded-lg"
                    />
                    <input
                      type="text"
                      value={med.duration}
                      onChange={(e) => {
                        const updated = [...medications];
                        updated[i].duration = e.target.value;
                        setMedications(updated);
                      }}
                      placeholder={t('docDischarge.durationPh')}
                      className="p-2 border border-border rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setMedications(medications.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:text-critical-subtle-fg"
                    >
                      {t('docDischarge.removeBtn')}
                    </button>
                  </div>
                ))}
              </div>

              {/* Follow-up Appointments */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-content-secondary flex items-center gap-1">
                    <Calendar size={16} /> {t('docDischarge.followUpAppointmentsLabel')}
                  </label>
                  <button type="button" onClick={addFollowUp} className="text-brand hover:text-brand text-sm inline-flex items-center gap-1 min-h-[24px] py-1">
                    {t('docDischarge.addAppointmentBtn')}
                  </button>
                </div>
                {followUps.map((apt, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 mb-2">
                    <input
                      type="text"
                      value={apt.specialty}
                      onChange={(e) => {
                        const updated = [...followUps];
                        updated[i].specialty = e.target.value;
                        setFollowUps(updated);
                      }}
                      placeholder={t('docDischarge.specialtyPh')}
                      className="p-2 border border-border rounded-lg"
                    />
                    <input
                      type="text"
                      value={apt.provider}
                      onChange={(e) => {
                        const updated = [...followUps];
                        updated[i].provider = e.target.value;
                        setFollowUps(updated);
                      }}
                      placeholder={t('docDischarge.providerPh')}
                      className="p-2 border border-border rounded-lg"
                    />
                    <input
                      type="date"
                      value={apt.date}
                      onChange={(e) => {
                        const updated = [...followUps];
                        updated[i].date = e.target.value;
                        setFollowUps(updated);
                      }}
                      className="p-2 border border-border rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setFollowUps(followUps.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:text-critical-subtle-fg"
                    >
                      {t('docDischarge.removeBtn')}
                    </button>
                  </div>
                ))}
              </div>

              {/* Warning Signs */}
              <div>
                <label htmlFor="dc-warning-signs" className="text-sm font-medium text-content-secondary mb-1 flex items-center gap-1">
                  <AlertTriangle size={16} /> {t('docDischarge.warningSignsLabel')}
                </label>
                <textarea
                  id="dc-warning-signs"
                  value={formData.warning_signs}
                  onChange={(e) => setFormData({ ...formData, warning_signs: e.target.value })}
                  className="w-full p-3 border border-border rounded-lg"
                  rows={3}
                  placeholder="Fever above 38.5°C&#10;Worsening shortness of breath&#10;..."
                />
              </div>

              {/* Diet & Activity */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dc-diet-instructions" className="text-sm font-medium text-content-secondary mb-1">{t('docDischarge.dietInstructionsLabel')}</label>
                  <textarea
                    id="dc-diet-instructions"
                    value={formData.diet_instructions}
                    onChange={(e) => setFormData({ ...formData, diet_instructions: e.target.value })}
                    className="w-full p-3 border border-border rounded-lg"
                    rows={2}
                  />
                </div>
                <div>
                  <label htmlFor="dc-activity-restrictions" className="text-sm font-medium text-content-secondary mb-1">{t('docDischarge.activityRestrictionsLabel')}</label>
                  <textarea
                    id="dc-activity-restrictions"
                    value={formData.activity_restrictions}
                    onChange={(e) => setFormData({ ...formData, activity_restrictions: e.target.value })}
                    className="w-full p-3 border border-border rounded-lg"
                    rows={2}
                    placeholder={t('docDischarge.activityRestrictionsPh')}
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-6 py-2 border border-border rounded-lg hover:bg-surface-sunken"
                >
                  {t('docDischarge.cancelBtn')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-brand text-brand-fg rounded-lg hover:bg-brand disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
                  {t('docDischarge.createSummaryBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default DischargePage;
