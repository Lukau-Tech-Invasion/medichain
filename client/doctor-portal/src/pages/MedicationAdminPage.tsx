import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import {
  getPatients,
  listMar,
  listMarAdministrations,
  administerMedication,
  useTranslation,
  Alert,
  LoadingSpinner,
  useScoringCatalog,
  isDoseOverdue,
  Input,
  Textarea,
  useValidatedForm,
  medicationAdministrationSchema,
} from '@medichain/shared';
import { Pill, Clock, User, CheckCircle, XCircle, AlertTriangle, Calendar, Search, FileText, Activity, RefreshCw } from 'lucide-react';
import PatientSelect from '../components/PatientSelect';
import { useToastActions } from '../components/Toast';

import StaffName from '../components/StaffName';
/**
 * MedicationAdminPage
 * 
 * Full electronic Medication Administration Record (eMAR)
 * - Scheduled medication tracking with time slots
 * - PRN medication documentation
 * - Five Rights verification (Patient, Drug, Dose, Route, Time)
 * - Barcode scanning simulation
 * - Reason for not given tracking
 * - Administration audit trail
 */

const ADMINISTRATION_ROUTES = ['PO', 'IV', 'IM', 'SC', 'SL', 'PR', 'Topical', 'Inhaled', 'Ophthalmic', 'Otic'] as const;
type AdministrationRoute = (typeof ADMINISTRATION_ROUTES)[number];

/** A parenteral route needs the site recorded. */
function needsSite(route: '' | AdministrationRoute): boolean {
  return route === 'IM' || route === 'SC' || route === 'IV';
}

interface ScheduledMedication {
  medId: string;
  patientId: string;
  patientName: string;
  medicationName: string;
  dose: string;
  /**
   * The route the prescription names, or '' when it names none. A prescription
   * records a form (tablet, cream, injection), not a route; the nurse records
   * the route actually used when the dose is given.
   */
  route: '' | AdministrationRoute;
  frequency: string;
  scheduledTimes: string[];
  startDate: string;
  endDate?: string;
  indication: string;
  prescriber: string;
  /** Only when the order says so; nothing is assumed routine. */
  priority?: 'stat' | 'prn';
  allergies?: string[];
  interactions?: string[];
}

interface MedicationAdmin {
  adminId: string;
  medId: string;
  patientId: string;
  patientName: string;
  medicationName: string;
  dose: string;
  route: string;
  scheduledTime: string;
  actualTime: string;
  administeredBy: string;
  status: 'given' | 'not-given' | 'held' | 'refused' | 'missed';
  reasonNotGiven?: string;
  site?: string;
  witnessedBy?: string;
  patientResponse?: string;
  barcodeScanned: boolean;
  fiveRightsVerified: boolean;
}

/** A MAR row, in either of the two casings it is stored under. */
interface RawMarRow {
  med_id?: string; medId?: string;
  patient_id?: string; patientId?: string;
  patient_name?: string; patientName?: string;
  medication_name?: string; medicationName?: string;
  dose?: string;
  route?: string;
  frequency?: string;
  scheduled_times?: string[]; scheduledTimes?: string[];
  start_date?: string; startDate?: string;
  end_date?: string; endDate?: string;
  indication?: string;
  prescriber?: string;
  priority?: string;
  allergies?: ScheduledMedication['allergies'];
  interactions?: ScheduledMedication['interactions'];
}

interface RawAdministration {
  administration_id?: string; medication_id?: string; patient_id?: string;
  medication_name?: string; dose?: string; route?: string; scheduled_time?: string;
  actual_time?: string; administered_at?: string; administered_by?: string; status?: string;
  reason_not_given?: string; site?: string; witnessed_by?: string; patient_response?: string;
  barcode_scanned?: boolean; five_rights_verified?: boolean;
}

const MedicationAdminPage: React.FC = () => {
  const { t } = useTranslation();
  const { catalog } = useScoringCatalog();
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();
  // The page-level roster existed only to fill a patient dropdown.
  // `PatientSelect` queries the server as the clinician types, so the
  // whole roster is no longer fetched into this screen.
  const [medications, setMedications] = useState<ScheduledMedication[]>([]);
  const [administrations, setAdministrations] = useState<MedicationAdmin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'mar' | 'administerMed' | 'history'>('mar');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');

  // Administer medication form state
  const [selectedMed, setSelectedMed] = useState<ScheduledMedication | null>(null);
  const [selectedTime, setSelectedTime] = useState('');
  const [actualTime, setActualTime] = useState('');
  const [status, setStatus] = useState<'given' | 'not-given' | 'held' | 'refused' | 'missed'>('given');
  const [reasonNotGiven, setReasonNotGiven] = useState('');
  const [administrationSite, setAdministrationSite] = useState('');
  const [witnessedBy, setWitnessedBy] = useState('');
  const [patientResponse, setPatientResponse] = useState('');
  const [barcodeScanned, setBarcodeScanned] = useState(false);
  const [fiveRightsVerified, setFiveRightsVerified] = useState(false);

  // Fetch all data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch patients
      const loadedPatients = await getPatients();

      // Fetch MAR (Medication Administration Records)
      const [marData, storedAdministrations] = await Promise.all([listMar(), listMarAdministrations()]);
      // Map API response to ScheduledMedication interface
      const mappedMeds: ScheduledMedication[] = (marData as unknown as RawMarRow[]).map((m) => ({
        medId: m.med_id || m.medId || '',
        patientId: m.patient_id || m.patientId || '',
        patientName: m.patient_name || m.patientName || '',
        medicationName: m.medication_name || m.medicationName || '',
        dose: m.dose || '',
        route: ADMINISTRATION_ROUTES.includes(m.route as AdministrationRoute) ? (m.route as AdministrationRoute) : '',
        frequency: m.frequency || '',
        scheduledTimes: m.scheduled_times || m.scheduledTimes || [],
        startDate: m.start_date || m.startDate || '',
        endDate: m.end_date || m.endDate,
        indication: m.indication || '',
        prescriber: m.prescriber || '',
        priority: m.priority === 'stat' || m.priority === 'prn' ? m.priority : undefined,
        allergies: m.allergies,
        interactions: m.interactions,
      }));
      setMedications(mappedMeds);

      const patientNames = new Map(loadedPatients.map(patient => [patient.patient_id, patient.full_name]));
      setAdministrations(storedAdministrations.map((raw): MedicationAdmin => {
        const event = raw as RawAdministration;
        return {
          adminId: event.administration_id || '', medId: event.medication_id || '',
          patientId: event.patient_id || '', patientName: patientNames.get(event.patient_id || '') || event.patient_id || '',
          medicationName: event.medication_name || '', dose: event.dose || '', route: event.route || '',
          scheduledTime: event.scheduled_time || 'PRN', actualTime: event.administered_at || event.actual_time || '',
          administeredBy: event.administered_by || '', status: (event.status || 'given') as MedicationAdmin['status'],
          reasonNotGiven: event.reason_not_given, site: event.site, witnessedBy: event.witnessed_by,
          patientResponse: event.patient_response, barcodeScanned: Boolean(event.barcode_scanned),
          fiveRightsVerified: Boolean(event.five_rights_verified),
        };
      }));
    } catch (err) {
      console.error('Failed to load medication data:', err);
      setError(err instanceof Error ? err.message : t('docMedicationAdmin.errorLoad'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // The route this dose was given by. Starts from the prescription's, when it
  // names one; otherwise the nurse must choose -- it is recorded on the MAR.
  const [administeredRoute, setAdministeredRoute] = useState<'' | AdministrationRoute>('');

  const handleAdministerMed = (med: ScheduledMedication, time: string) => {
    setSelectedMed(med);
    setAdministeredRoute(med.route);
    setSelectedTime(time);
    setActualTime(new Date().toTimeString().slice(0, 5));
    setStatus('given');
    setReasonNotGiven('');
    setAdministrationSite('');
    setWitnessedBy('');
    setPatientResponse('');
    setBarcodeScanned(false);
    setFiveRightsVerified(false);
    setActiveTab('administerMed');
  };

  const { errors, validate, validateField, clearField } = useValidatedForm(
    medicationAdministrationSchema
  );

  /** What the MAR entry asserts, assembled from this page's separate state. */
  const marEntry = () => ({ actualTime, status, fiveRightsVerified, reasonNotGiven });

  const handleSubmitAdministration = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Selecting a medication is a prerequisite for the form existing at all,
    // not a field error, so it keeps its toast.
    if (!selectedMed) {
      showError(t('docMedicationAdmin.errorRequiredFields'));
      return;
    }

    // The rest were three toasts. The five-rights and reason rules are
    // conditional on the status, which a toast cannot express and a schema can:
    // the message now appears on the control the nurse has to act on. The
    // five-rights message still also surfaces as a toast, because that checkbox
    // is in a different card from the submit button.
    if (status === 'given' && !administeredRoute) {
      showError(t('docMedicationAdmin.errorRouteRequired'));
      return;
    }
    if (!validate(marEntry())) {
      if (errors.fiveRightsVerified) {
        showError(t('docMedicationAdmin.errorFiveRights'));
      }
      return;
    }

    try {
      // Call the real API to record administration
      await administerMedication({
        patient_id: selectedMed.patientId,
        medication_id: selectedMed.medId,
        medication_name: selectedMed.medicationName,
        dose: selectedMed.dose,
        route: administeredRoute,
        scheduled_time: selectedTime || 'PRN',
        actual_time: actualTime,
        // No `administered_by`: the server records the authenticated caller
        // and ignored this, which was 'Unknown' whenever the store was empty.
        status,
        reason_not_given: reasonNotGiven || undefined,
        site: administrationSite || undefined,
        witnessed_by: witnessedBy || undefined,
        patient_response: patientResponse || undefined,
        barcode_scanned: barcodeScanned,
        five_rights_verified: fiveRightsVerified,
      });

      await loadData();
      showSuccess(t('docMedicationAdmin.successRecorded'));
      setActiveTab('mar');
      setSelectedMed(null);
    } catch (err) {
      console.error('Failed to record medication administration:', err);
      showError(t('docMedicationAdmin.errorRecord'));
    }
  };

  const getMedicationStatus = (med: ScheduledMedication, time: string): 'given' | 'pending' | 'overdue' | 'held' | 'refused' => {
    const admin = administrations.find(
      a => a.medId === med.medId && a.scheduledTime === time && 
      new Date(a.actualTime).toDateString() === new Date(selectedDate).toDateString()
    );

    if (admin) {
      if (admin.status === 'given') return 'given';
      if (admin.status === 'held') return 'held';
      if (admin.status === 'refused') return 'refused';
    }

    // The overdue window comes from `GET /api/clinical/scoring/catalog`, not
    // from `30 * 60000` here. It is a medication-safety policy: it decides when
    // a dose turns red on the MAR and gets put in front of the nurse. Until the
    // catalog loads, `isDoseOverdue` returns null and the dose stays pending —
    // a dose shown as pending that is actually late is recoverable; one shown
    // as overdue because the page guessed teaches the nurse to ignore the
    // colour.
    const scheduled = new Date(`${selectedDate}T${time}`);
    return isDoseOverdue(scheduled, catalog) ? 'overdue' : 'pending';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'given':
        return <CheckCircle className="h-5 w-5 text-ok-subtle-fg" />;
      case 'held':
        return <AlertTriangle className="h-5 w-5 text-caution-subtle-fg" />;
      case 'refused':
        return <XCircle className="h-5 w-5 text-critical-subtle-fg" />;
      case 'overdue':
        return <AlertTriangle className="h-5 w-5 text-critical-subtle-fg" />;
      default:
        return <Clock className="h-5 w-5 text-content-muted" />;
    }
  };

  const filteredPatientMeds = medications.filter(med => {
    if (selectedPatientId && med.patientId !== selectedPatientId) return false;
    if (searchTerm && !med.medicationName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const filteredHistory = administrations.filter(admin => {
    if (selectedPatientId && admin.patientId !== selectedPatientId) return false;
    if (searchTerm && !admin.medicationName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6">
      {/* Header with gradient */}
      <div className="bg-gradient-to-r from-indigo-700 to-blue-800 text-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Pill className="h-8 w-8" />
            <div>
              <h1 className="text-3xl font-bold">{t('docMedicationAdmin.title')}</h1>
              <p className="text-white">{t('docMedicationAdmin.subtitle')}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-white">{t('docMedicationAdmin.nurseLabel')}</p>
            <p className="font-semibold">{user?.username || 'Unknown'}</p>
          </div>
        </div>
      </div>

      {/* The page already tracked this; it just never showed it. A failed
          save left the screen unchanged, which reads as success. */}
      {error && (
        <Alert variant="error" className="mb-6" onClose={() => setError(null)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 min-h-[24px] rounded-lg border border-critical text-critical-subtle-fg hover:bg-critical-subtle disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('common.refresh')}
            </button>
          </div>
        </Alert>
      )}
      {isLoading && (
        <div role="status" className="flex items-center justify-center gap-2 py-8 text-content-muted">
          <LoadingSpinner size="sm" />
          {t('common.loading')}
        </div>
      )}

      {/* Patient and Date Selection */}
      <div className="bg-surface rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="medadmin-patient" className="block text-sm font-medium text-content-secondary mb-1">
              <User className="inline h-4 w-4 mr-1" />
              {t('docMedicationAdmin.patientLabel')}
            </label>
            <PatientSelect
              id="medadmin-patient"
              value={selectedPatientId}
              onChange={(selectedPatientId) => setSelectedPatientId(selectedPatientId)}
            />
          </div>
          <div>
            <label htmlFor="medadmin-date" className="block text-sm font-medium text-content-secondary mb-1">
              <Calendar className="inline h-4 w-4 mr-1" />
              {t('docMedicationAdmin.dateLabel')}
            </label>
            <input
              id="medadmin-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label htmlFor="medadmin-search" className="block text-sm font-medium text-content-secondary mb-1">
              <Search className="inline h-4 w-4 mr-1" />
              {t('docMedicationAdmin.searchMedicationLabel')}
            </label>
            <input
              id="medadmin-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('docMedicationAdmin.searchMedicationPh')}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b">
        <button
          onClick={() => setActiveTab('mar')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'mar'
              ? 'text-content-secondary border-b-2 border-indigo-600'
              : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          <Activity className="inline h-4 w-4 mr-2" />
          {t('docMedicationAdmin.tabMarGrid')}
        </button>
        {selectedMed && (
          <button
            onClick={() => setActiveTab('administerMed')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'administerMed'
                ? 'text-content-secondary border-b-2 border-indigo-600'
                : 'text-content-muted hover:text-content-secondary'
            }`}
          >
            <Pill className="inline h-4 w-4 mr-2" />
            {t('docMedicationAdmin.tabAdminister')}
          </button>
        )}
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'history'
              ? 'text-content-secondary border-b-2 border-indigo-600'
              : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          <FileText className="inline h-4 w-4 mr-2" />
          {t('docMedicationAdmin.tabHistory')}
        </button>
      </div>

      {/* MAR Grid Tab */}
      {activeTab === 'mar' && (
        <div className="bg-surface rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tablePatient')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableMedication')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableDoseRoute')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableFrequency')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableScheduledTimes')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableIndication')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableAlerts')}</th>
                </tr>
              </thead>
              <tbody className="bg-surface divide-y divide-border">
                {filteredPatientMeds.map((med, idx) => (
                  <tr key={med.medId ?? `m-${idx}`} className="hover:bg-surface-sunken">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-content">{med.patientName}</div>
                      <div className="text-xs text-content-muted">{med.patientId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-content">{med.medicationName}</div>
                      <div className="text-xs text-content-muted">{t('docMedicationAdmin.prescribedByLine', { name: med.prescriber })}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-content">{med.dose}</div>
                      <div className="text-xs text-content-muted">{med.route || t('docMedicationAdmin.routeNotPrescribed')}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-semibold rounded ${
                        med.priority === 'stat' ? 'bg-critical-subtle text-critical-subtle-fg' :
                        med.priority === 'prn' ? 'bg-caution-subtle text-caution-subtle-fg' :
                        'bg-surface-sunken text-content-secondary'
                      }`}>
                        {med.frequency}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {med.priority === 'prn' ? (
                        <button
                          onClick={() => handleAdministerMed(med, 'PRN')}
                          className="px-3 py-1 bg-caution-subtle text-caution-subtle-fg rounded text-sm hover:bg-yellow-200"
                        >
                          {t('docMedicationAdmin.prnGiveNowButton')}
                        </button>
                      ) : (
                        <div className="flex space-x-2">
                          {(med.scheduledTimes ?? []).length === 0 && (
                            // An e-prescription carries free-text directions, not a
                            // dosing schedule, so there are no time slots to click.
                            // Without this the row is a dead end and the drug can
                            // never be administered.
                            <button
                              onClick={() => handleAdministerMed(med, '')}
                              className="px-3 py-1 bg-notice-subtle text-notice-subtle-fg rounded text-sm hover:bg-blue-200"
                            >
                              {t('docMedicationAdmin.administerNowButton')}
                            </button>
                          )}
                          {(med.scheduledTimes ?? []).map((time, tIdx) => {
                            const status = getMedicationStatus(med, time);
                            return (
                              <button
                                key={`${med.medId}-${time}-${tIdx}`}
                                onClick={() => handleAdministerMed(med, time)}
                                className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium ${
                                  status === 'given' ? 'bg-ok-subtle text-ok-subtle-fg' :
                                  status === 'held' ? 'bg-caution-subtle text-caution-subtle-fg' :
                                  status === 'refused' ? 'bg-critical-subtle text-critical-subtle-fg' :
                                  status === 'overdue' ? 'bg-critical-subtle text-critical-subtle-fg animate-pulse' :
                                  'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'
                                }`}
                              >
                                {getStatusIcon(status)}
                                <span>{time}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-content-muted">{med.indication}</td>
                    <td className="px-4 py-3">
                      {med.allergies && med.allergies.length > 0 && (
                        <div className="text-xs text-critical-subtle-fg flex items-center mb-1">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {t('docMedicationAdmin.allergiesLine', { list: med.allergies.join(', ') })}
                        </div>
                      )}
                      {med.interactions && med.interactions.length > 0 && (
                        <div className="text-xs text-content-secondary flex items-center">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {t('docMedicationAdmin.interactionsLine', { list: med.interactions.join(', ') })}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Administer Medication Tab */}
      {activeTab === 'administerMed' && selectedMed && (
        <div className="bg-surface rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">{t('docMedicationAdmin.administerMedicationHeading')}</h2>

          {/* Medication Details */}
          <div className="bg-notice-subtle border border-notice rounded-lg p-4 mb-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium text-content-secondary">{t('docMedicationAdmin.patientDetailLabel')}</span>
                <p className="text-content">{selectedMed.patientName}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docMedicationAdmin.medicationDetailLabel')}</span>
                <p className="text-content">{selectedMed.medicationName}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docMedicationAdmin.doseDetailLabel')}</span>
                <p className="text-content">{selectedMed.dose}</p>
              </div>
              <div>
                <label htmlFor="medadmin-route" className="font-medium text-content-secondary">
                  {t('docMedicationAdmin.routeDetailLabel')}
                </label>
                <select
                  id="medadmin-route"
                  value={administeredRoute}
                  onChange={(e) => setAdministeredRoute(e.target.value as '' | AdministrationRoute)}
                  className="w-full mt-1 px-2 py-1 border rounded-md bg-surface text-content"
                >
                  <option value="">{t('docMedicationAdmin.routeNotChosen')}</option>
                  {ADMINISTRATION_ROUTES.map((route) => (
                    <option key={route} value={route}>{route}</option>
                  ))}
                </select>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docMedicationAdmin.scheduledTimeDetailLabel')}</span>
                <p className="text-content">{selectedTime}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docMedicationAdmin.indicationDetailLabel')}</span>
                <p className="text-content">{selectedMed.indication}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docMedicationAdmin.prescriberDetailLabel')}</span>
                <p className="text-content">{selectedMed.prescriber}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docMedicationAdmin.frequencyDetailLabel')}</span>
                <p className="text-content">{selectedMed.frequency}</p>
              </div>
            </div>
          </div>

          {/* Five Rights Verification */}
          <div className="bg-ok-subtle border-2 border-ok rounded-lg p-4 mb-6">
            <h3 className="font-bold text-ok-subtle-fg mb-3">{t('docMedicationAdmin.fiveRightsHeading')}</h3>
            <div className="space-y-2">
              <label className="flex items-center text-sm min-h-[24px] py-1">
                <input type="checkbox" className="mr-2" disabled checked />
                <span className="font-medium">{t('docMedicationAdmin.rightPatientLabel')}</span>
                <span className="ml-2 text-content-secondary">{selectedMed.patientName} ({selectedMed.patientId})</span>
              </label>
              <label className="flex items-center text-sm min-h-[24px] py-1">
                <input type="checkbox" className="mr-2" disabled checked />
                <span className="font-medium">{t('docMedicationAdmin.rightDrugLabel')}</span>
                <span className="ml-2 text-content-secondary">{selectedMed.medicationName}</span>
              </label>
              <label className="flex items-center text-sm min-h-[24px] py-1">
                <input type="checkbox" className="mr-2" disabled checked />
                <span className="font-medium">{t('docMedicationAdmin.rightDoseLabel')}</span>
                <span className="ml-2 text-content-secondary">{selectedMed.dose}</span>
              </label>
              <label className="flex items-center text-sm min-h-[24px] py-1">
                <input type="checkbox" className="mr-2" disabled checked />
                <span className="font-medium">{t('docMedicationAdmin.rightRouteLabel')}</span>
                <span className="ml-2 text-content-secondary">{administeredRoute || t('docMedicationAdmin.routeNotChosen')}</span>
              </label>
              <label className="flex items-center text-sm min-h-[24px] py-1">
                <input type="checkbox" className="mr-2" disabled checked />
                <span className="font-medium">{t('docMedicationAdmin.rightTimeLabel')}</span>
                <span className="ml-2 text-content-secondary">{selectedTime}</span>
              </label>
              <div className="mt-4 pt-4 border-t">
                <label htmlFor="medadmin-five-rights" className="flex items-center">
                  <input
                    id="medadmin-five-rights"
                    type="checkbox"
                    checked={fiveRightsVerified}
                    onChange={(e) => setFiveRightsVerified(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="font-bold text-ok-subtle-fg">{t('docMedicationAdmin.fiveRightsConfirm')}</span>
                </label>
              </div>
            </div>
          </div>

          {/* Administration Form */}
          <form onSubmit={handleSubmitAdministration}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="medadmin-status" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docMedicationAdmin.administrationStatusRequired')} <span className="text-critical">*</span>
                </label>
                <select
                  id="medadmin-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="given">{t('docMedicationAdmin.status_given')}</option>
                  <option value="not-given">{t('docMedicationAdmin.status_not-given')}</option>
                  <option value="held">{t('docMedicationAdmin.status_held')}</option>
                  <option value="refused">{t('docMedicationAdmin.status_refused')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="medadmin-actual-time" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docMedicationAdmin.actualTimeRequired')} <span className="text-critical">*</span>
                </label>
                <Input
                  id="medadmin-actual-time"
                  type="time"
                  value={actualTime}
                  onChange={(e) => { clearField('actualTime'); setActualTime(e.target.value); }}
                  onBlur={() => validateField('actualTime', marEntry())}
                  error={errors.actualTime}
                  required
                />
              </div>

              {(status === 'not-given' || status === 'held' || status === 'refused') && (
                <div className="md:col-span-2">
                  <label htmlFor="medadmin-reason-not-given" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('docMedicationAdmin.reasonNotGivenRequired')} <span className="text-critical">*</span>
                  </label>
                  <Textarea
                    id="medadmin-reason-not-given"
                    value={reasonNotGiven}
                    onChange={(e) => { clearField('reasonNotGiven'); setReasonNotGiven(e.target.value); }}
                    onBlur={() => validateField('reasonNotGiven', marEntry())}
                    error={errors.reasonNotGiven}
                    rows={3}
                    placeholder={t('docMedicationAdmin.reasonNotGivenPh')}
                    required
                  />
                </div>
              )}

              {status === 'given' && (
                <>
                  <div>
                    <label htmlFor="medadmin-site" className="block text-sm font-medium text-content-secondary mb-1">
                      {t('docMedicationAdmin.administrationSiteLabel')}
                      {needsSite(administeredRoute) &&
                        <span className="text-critical"> *</span>
                      }
                    </label>
                    <input
                      id="medadmin-site"
                      type="text"
                      value={administrationSite}
                      onChange={(e) => setAdministrationSite(e.target.value)}
                      placeholder={t('docMedicationAdmin.administrationSitePh')}
                      className="w-full px-3 py-2 border rounded-md"
                      required={needsSite(administeredRoute)}
                    />
                  </div>

                  <div>
                    <label htmlFor="medadmin-witnessed-by" className="block text-sm font-medium text-content-secondary mb-1">{t('docMedicationAdmin.witnessedByLabel')}</label>
                    <input
                      id="medadmin-witnessed-by"
                      type="text"
                      value={witnessedBy}
                      onChange={(e) => setWitnessedBy(e.target.value)}
                      placeholder={t('docMedicationAdmin.witnessedByPh')}
                      className="w-full px-3 py-2 border rounded-md"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label htmlFor="medadmin-patient-response" className="block text-sm font-medium text-content-secondary mb-1">{t('docMedicationAdmin.patientResponseLabel')}</label>
                    <textarea
                      id="medadmin-patient-response"
                      value={patientResponse}
                      onChange={(e) => setPatientResponse(e.target.value)}
                      rows={3}
                      placeholder={t('docMedicationAdmin.patientResponsePh')}
                      className="w-full px-3 py-2 border rounded-md"
                    />
                  </div>
                </>
              )}

              <div className="md:col-span-2">
                <label htmlFor="medadmin-barcode-scanned" className="flex items-center">
                  <input
                    id="medadmin-barcode-scanned"
                    type="checkbox"
                    checked={barcodeScanned}
                    onChange={(e) => setBarcodeScanned(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-content-secondary">{t('docMedicationAdmin.barcodeScannedCheckbox')}</span>
                </label>
              </div>
            </div>

            {/* Submit Buttons */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('mar');
                  setSelectedMed(null);
                }}
                className="px-4 py-2 border border-border-strong rounded-md text-content-secondary hover:bg-surface-sunken"
              >
                {t('docMedicationAdmin.cancelButton')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {t('docMedicationAdmin.recordAdministrationButton')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="bg-surface rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableDateTime')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tablePatient')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableMedication')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableDoseRoute')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableStatus')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableAdministeredBy')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docMedicationAdmin.tableDetails')}</th>
                </tr>
              </thead>
              <tbody className="bg-surface divide-y divide-border">
                {filteredHistory.map((admin, idx) => (
                  <tr key={admin.adminId ?? `a-${idx}`} className="hover:bg-surface-sunken">
                    <td className="px-4 py-3">
                      <div className="text-sm text-content">{selectedDate}</div>
                      <div className="text-xs text-content-muted">{admin.actualTime}</div>
                      {admin.scheduledTime !== 'PRN' && (
                        <div className="text-xs text-content-muted">{t('docMedicationAdmin.scheduledLine', { time: admin.scheduledTime })}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-content">{admin.patientName}</div>
                      <div className="text-xs text-content-muted">{admin.patientId}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-content">{admin.medicationName}</td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-content">{admin.dose}</div>
                      <div className="text-xs text-content-muted">{admin.route}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(admin.status)}
                        <span className={`text-sm font-medium ${
                          admin.status === 'given' ? 'text-ok-subtle-fg' :
                          admin.status === 'held' ? 'text-caution-subtle-fg' :
                          'text-critical-subtle-fg'
                        }`}>
                          {t(`docMedicationAdmin.status_${admin.status}`)}
                        </span>
                      </div>
                      {admin.reasonNotGiven && (
                        <div className="text-xs text-content-muted mt-1">{admin.reasonNotGiven}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-content-secondary"><StaffName id={admin.administeredBy} /></td>
                    <td className="px-4 py-3 text-xs">
                      {admin.site && <div className="text-content-muted">{t('docMedicationAdmin.siteLine', { site: admin.site })}</div>}
                      {admin.witnessedBy && <div className="text-content-muted">{t('docMedicationAdmin.witnessLine', { name: admin.witnessedBy })}</div>}
                      {admin.patientResponse && <div className="text-content-muted">{t('docMedicationAdmin.responseLine', { text: admin.patientResponse })}</div>}
                      <div className="flex items-center mt-1 space-x-2">
                        {admin.barcodeScanned && (
                          <span className="text-ok-subtle-fg flex items-center">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            {t('docMedicationAdmin.scannedBadge')}
                          </span>
                        )}
                        {admin.fiveRightsVerified && (
                          <span className="text-ok-subtle-fg flex items-center">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            {t('docMedicationAdmin.fiveRightsBadge')}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MedicationAdminPage;
