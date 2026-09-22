import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { apiUrl, getApiClient, useTranslation } from '@medichain/shared';
import { 
  Pill, Droplets, ClipboardList, Plus, Save, Clock, 
  AlertCircle, CheckCircle, User, Calendar, Loader2,
  TrendingUp, TrendingDown, Minus
} from 'lucide-react';
import StaffName from '../components/StaffName';
import PatientSelect from '../components/PatientSelect';

// Types for Medication Administration Record
interface MedicationDose {
  scheduled_time: string;
  administered_time?: string;
  administered_by?: string;
  status: 'pending' | 'given' | 'held' | 'refused' | 'not_given';
  notes?: string;
  /** Administrations are the only rows that may be actioned from this hub. */
  canAdminister?: boolean;
}

interface MedicationEntry {
  medication_name: string;
  dose: string;
  route: string;
  frequency: string;
  doses: MedicationDose[];
}

interface MAR {
  mar_id: string;
  patient_id: string;
  patient_name: string;
  date: string;
  medications: MedicationEntry[];
  created_by: string;
  created_at: string;
}

// Types for Intake/Output Record
interface FluidEntry {
  time: string;
  type: string;
  amount_ml: number;
  route?: string;
  notes?: string;
  recorded_by: string;
}

interface IntakeOutputRecord {
  io_id: string;
  patient_id: string;
  patient_name: string;
  date: string;
  shift: 'day' | 'evening' | 'night';
  intake: FluidEntry[];
  output: FluidEntry[];
  total_intake: number;
  total_output: number;
  fluid_balance: number;
  recorded_by: string;
}

// Types for Nursing Care Plan
interface NursingDiagnosis {
  diagnosis: string;
  related_to: string;
  evidenced_by: string[];
}

interface NursingIntervention {
  intervention: string;
  frequency: string;
  rationale: string;
  status: 'active' | 'completed' | 'discontinued';
}

interface NursingOutcome {
  outcome: string;
  target_date: string;
  indicators: string[];
  status: 'not_met' | 'partially_met' | 'met';
}

interface NursingCarePlan {
  plan_id: string;
  patient_id: string;
  patient_name: string;
  diagnoses: NursingDiagnosis[];
  interventions: NursingIntervention[];
  outcomes: NursingOutcome[];
  created_by: string;
  created_at: string;
  last_updated: string;
}

type JsonObject = Record<string, unknown>;

function asObjects(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Map the persisted medication-record entity without fabricating dose slots. */
export function mapMarRecord(value: unknown): MAR | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as JsonObject;
  const data = record.data as JsonObject | undefined;
  const administrations = asObjects(data?.administrations);
  const medications = asObjects(record.scheduled_medications).map((medication) => {
    const medicationId = stringValue(medication.medication_id);
    const medicationName = stringValue(medication.name);
    const doses = administrations
      .filter((administration) =>
        stringValue(administration.medication_id) === medicationId ||
        stringValue(administration.medication_name) === medicationName,
      )
      .map((administration) => ({
        scheduled_time: stringValue(administration.scheduled_time) || '\u2014',
        administered_time: stringValue(administration.actual_time) || stringValue(administration.administered_at),
        administered_by: stringValue(administration.administered_by),
        status: (stringValue(administration.status) || 'given') as MedicationDose['status'],
        notes: stringValue(administration.notes),
        canAdminister: false,
      }));
    return {
      medication_name: medicationName,
      dose: stringValue(medication.dose),
      route: stringValue(medication.route),
      frequency: stringValue(medication.frequency),
      doses,
    };
  });
  return {
    mar_id: stringValue(record.id),
    patient_id: stringValue(record.patient_id),
    patient_name: stringValue(record.patient_id),
    date: stringValue(record.record_date),
    medications,
    created_by: stringValue(record.primary_nurse),
    created_at: stringValue(record.created_at),
  };
}

/** Map the typed I/O row and preserve the individual events stored in its JSON arrays. */
function mapIoRecord(value: unknown): IntakeOutputRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as JsonObject;
  const fluidEntries = (items: unknown): FluidEntry[] => asObjects(items).map((item) => ({
    time: stringValue(item.recorded_at) || stringValue(record.record_date),
    type: stringValue(item.label) || stringValue(item.category),
    amount_ml: typeof item.amount_ml === 'number' ? item.amount_ml : 0,
    notes: stringValue(item.notes),
    recorded_by: stringValue(item.recorded_by),
  }));
  const intake = fluidEntries(record.intake_items);
  const output = fluidEntries(record.output_items);
  const totalIntake = typeof record.total_intake === 'number' ? record.total_intake : 0;
  const totalOutput = typeof record.total_output === 'number' ? record.total_output : 0;
  return {
    io_id: stringValue(record.id),
    patient_id: stringValue(record.patient_id),
    patient_name: stringValue(record.patient_id),
    date: stringValue(record.record_date),
    shift: ['day', 'evening', 'night'].includes(stringValue(record.shift))
      ? stringValue(record.shift) as IntakeOutputRecord['shift']
      : 'day',
    intake,
    output,
    total_intake: totalIntake,
    total_output: totalOutput,
    fluid_balance: typeof record.net_balance === 'number' ? record.net_balance : totalIntake - totalOutput,
    recorded_by: stringValue(record.recorded_by),
  };
}

/** Map structured care-plan entries without turning missing clinical fields into defaults. */
function mapCarePlan(value: unknown): NursingCarePlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const plan = value as JsonObject;
  const diagnoses = asObjects(plan.nursing_diagnoses).map((diagnosis) => ({
    diagnosis: stringValue(diagnosis.diagnosis),
    related_to: stringValue(diagnosis.relatedTo) || stringValue(diagnosis.related_to),
    evidenced_by: Array.isArray(diagnosis.evidencedBy) ? diagnosis.evidencedBy.filter((item): item is string => typeof item === 'string') : [],
  }));
  const textDiagnoses = Array.isArray(plan.nursing_diagnoses)
    ? plan.nursing_diagnoses.filter((item): item is string => typeof item === 'string').map((diagnosis) => ({ diagnosis, related_to: '', evidenced_by: [] }))
    : [];
  return {
    plan_id: stringValue(plan.id),
    patient_id: stringValue(plan.patient_id),
    patient_name: stringValue(plan.patient_id),
    diagnoses: diagnoses.length > 0 ? diagnoses : textDiagnoses,
    interventions: asObjects(plan.interventions).map((intervention) => ({
      intervention: stringValue(intervention.description) || stringValue(intervention.intervention),
      frequency: stringValue(intervention.frequency),
      rationale: stringValue(intervention.rationale),
      status: ['active', 'completed', 'discontinued'].includes(stringValue(intervention.status))
        ? stringValue(intervention.status) as NursingIntervention['status']
        : 'active',
    })),
    outcomes: asObjects(plan.goals).map((goal) => ({
      outcome: stringValue(goal.description) || stringValue(goal.outcome),
      target_date: stringValue(goal.targetDate) || stringValue(goal.target_date),
      indicators: stringValue(goal.measurableOutcome) ? [stringValue(goal.measurableOutcome)] : [],
      status: ['not_met', 'partially_met', 'met'].includes(stringValue(goal.status))
        ? stringValue(goal.status) as NursingOutcome['status']
        : 'not_met',
    })),
    created_by: stringValue(plan.created_by),
    created_at: stringValue(plan.created_at),
    last_updated: stringValue(plan.updated_at),
  };
}

type TabType = 'mar' | 'io' | 'careplan';

function NursingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>('mar');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Data states
  const [marRecords, setMarRecords] = useState<MAR[]>([]);
  const [ioRecords, setIoRecords] = useState<IntakeOutputRecord[]>([]);
  const [carePlans, setCarePlans] = useState<NursingCarePlan[]>([]);
  
  // Selected patient for new entries
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  // The page-level roster existed only to fill a patient dropdown.
  // `PatientSelect` queries the server as the clinician types, so the
  // whole roster is no longer fetched into this screen.

  // Auth redirect
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // Fetch data on mount
  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = { 
        ...getApiClient().getSessionHeaders(user.walletAddress),
        'X-Provider-Role': user.role,
      };
      
      const [marRes, ioRes, planRes] = await Promise.all([
        fetch(apiUrl('/api/nursing/mar'), { headers }),
        fetch(apiUrl('/api/nursing/intake-output'), { headers }),
        fetch(apiUrl('/api/nursing/care-plans'), { headers }),
      ]);

      if (marRes.ok) {
        const data = await marRes.json();
        setMarRecords(asObjects(data.records).map(mapMarRecord).filter((record): record is MAR => record !== null));
      }
      if (ioRes.ok) {
        const data = await ioRes.json();
        setIoRecords(asObjects(data.records).map(mapIoRecord).filter((record): record is IntakeOutputRecord => record !== null));
      }
      if (planRes.ok) {
        const data = await planRes.json();
        setCarePlans(asObjects(data.plans).map(mapCarePlan).filter((plan): plan is NursingCarePlan => plan !== null));
      }
      setError(null);
    } catch (err) {
      setError(t('docNursing.errorFetch'));
    } finally {
      setLoading(false);
    }
  }, [t, user]);

  const fetchPatients = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch(apiUrl('/api/patients'), {
        headers: { 
          ...getApiClient().getSessionHeaders(user.walletAddress),
          'X-Provider-Role': user.role,
        },
      });
      if (!response.ok) {
        console.error('Failed to fetch patients:', response.status);
      }
    } catch (err) {
      console.error('Failed to fetch patients:', err);
    }
  }, [user]);

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchData();
      fetchPatients();
    }
  }, [isAuthenticated, user, fetchData, fetchPatients]);

  // MAR: Administer medication
  //
  // Takes the MAR row and the medicine, not three indices.
  //
  // The previous signature posted `{mar_id, medication_index, dose_index,
  // administered_time, status}` to `/api/nursing/mar/administer`, which
  // requires `patient_id` and knows nothing about indices — so every click of
  // the Give button answered `400 MISSING_PATIENT_ID` and no dose was ever
  // recorded from this screen. `MARPage` posts to the same endpoint with the
  // patient, the drug, the dose and the route, which is the shape the endpoint
  // documents; this now sends the same thing.
  const administerMedication = async (
    mar: MAR,
    med: MedicationEntry,
    dose: MedicationDose
  ) => {
    if (!user) return;
    setSaving(true);
    try {
      const response = await fetch(apiUrl('/api/nursing/mar/administer'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getApiClient().getSessionHeaders(user.walletAddress),
          'Idempotency-Key': getApiClient().getMutationHeaders()['Idempotency-Key'],
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify({
          patient_id: mar.patient_id,
          medication_name: med.medication_name,
          dose: med.dose,
          route: med.route,
          scheduled_time: dose.scheduled_time,
          actual_time: new Date().toISOString(),
          status: 'given',
        }),
      });

      if (response.ok) {
        setSuccess(t('docNursing.successAdminister'));
        fetchData();
      } else {
        setError(t('docNursing.errorAdminister'));
      }
    } catch (err) {
      setError(t('docNursing.errorApiConnection'));
    } finally {
      setSaving(false);
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  // I/O: Record intake or output
  const [newFluidEntry, setNewFluidEntry] = useState({
    type: 'intake',
    fluidType: 'Oral',
    amount: 0,
    notes: '',
  });

  const recordFluid = async () => {
    if (!user) return;
    if (!selectedPatient || newFluidEntry.amount <= 0) {
      setError(t('docNursing.errorSelectPatientAmount'));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(apiUrl('/api/nursing/intake-output/record'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getApiClient().getSessionHeaders(user.walletAddress),
          'Idempotency-Key': getApiClient().getMutationHeaders()['Idempotency-Key'],
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify({
          patient_id: selectedPatient,
          entry_type: newFluidEntry.type,
          fluid_type: newFluidEntry.fluidType,
          amount_ml: newFluidEntry.amount,
          notes: newFluidEntry.notes,
          time: new Date().toISOString(),
        }),
      });

      if (response.ok) {
        setSuccess(t('docNursing.successFluidRecorded'));
        setNewFluidEntry({ type: 'intake', fluidType: 'Oral', amount: 0, notes: '' });
        fetchData();
      } else {
        setError(t('docNursing.errorRecordFluid'));
      }
    } catch (err) {
      setError(t('docNursing.errorApiConnection'));
    } finally {
      setSaving(false);
      setTimeout(() => { setSuccess(null); setError(null); }, 3000);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'given': return 'bg-ok-subtle text-ok-subtle-fg';
      case 'pending': return 'bg-caution-subtle text-caution-subtle-fg';
      case 'held': return 'bg-surface-sunken text-content-secondary';
      case 'refused': return 'bg-critical-subtle text-critical-subtle-fg';
      default: return 'bg-surface-sunken text-content-secondary';
    }
  };

  const getBalanceIcon = (balance: number) => {
    if (balance > 500) return <TrendingUp className="text-green-500" size={20} />;
    if (balance < -500) return <TrendingDown className="text-red-500" size={20} />;
    return <Minus className="text-content-muted" size={20} />;
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-content">{t('docNursing.title')}</h1>
        <p className="text-content-muted">{t('docNursing.subtitle')}</p>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 p-4 bg-critical-subtle border border-critical rounded-lg flex items-center gap-2">
          <AlertCircle className="text-red-500" size={20} />
          <span className="text-critical-subtle-fg">{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-ok-subtle border border-ok rounded-lg flex items-center gap-2">
          <CheckCircle className="text-green-500" size={20} />
          <span className="text-ok-subtle-fg">{success}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('mar')}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === 'mar' 
              ? 'bg-brand text-brand-fg' 
              : 'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'
          }`}
        >
          <Pill size={20} />
          {t('docNursing.tabMar')}
        </button>
        <button
          onClick={() => setActiveTab('io')}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === 'io'
              ? 'bg-brand text-brand-fg'
              : 'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'
          }`}
        >
          <Droplets size={20} />
          {t('docNursing.tabIo')}
        </button>
        <button
          onClick={() => setActiveTab('careplan')}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === 'careplan'
              ? 'bg-brand text-brand-fg'
              : 'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'
          }`}
        >
          <ClipboardList size={20} />
          {t('docNursing.tabCarePlans')}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary-500" size={48} />
        </div>
      ) : (
        <>
          {/* MAR Tab */}
          {activeTab === 'mar' && (
            <div className="space-y-6">
              {marRecords.length === 0 ? (
                <div className="bg-surface rounded-xl shadow p-8 text-center">
                  <Pill className="mx-auto mb-4 text-gray-300" size={48} />
                  <p className="text-content-muted">{t('docNursing.noMedicationRecords')}</p>
                  <p className="text-sm text-content-muted">{t('docNursing.noMedicationRecordsHint')}</p>
                </div>
              ) : (
                marRecords.map((mar) => (
                  <div key={mar.mar_id} className="bg-surface rounded-xl shadow overflow-hidden">
                    <div className="p-4 bg-surface-sunken border-b flex justify-between items-center">
                      <div>
                        <h3 className="font-semibold text-content">{mar.patient_name}</h3>
                        <p className="text-sm text-content-muted">
                          <Calendar className="inline mr-1" size={14} />
                          {mar.date}
                        </p>
                      </div>
                      <span className="text-sm text-content-muted">{t('docNursing.marIdLine', { id: mar.mar_id })}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-surface-sunken text-xs uppercase text-content-muted">
                          <tr>
                            <th className="px-4 py-3 text-left">{t('docNursing.tableMedication')}</th>
                            <th className="px-4 py-3 text-left">{t('docNursing.tableDose')}</th>
                            <th className="px-4 py-3 text-left">{t('docNursing.tableRoute')}</th>
                            <th className="px-4 py-3 text-left">{t('docNursing.tableFrequency')}</th>
                            <th className="px-4 py-3 text-center">{t('docNursing.tableScheduled')}</th>
                            <th className="px-4 py-3 text-center">{t('docNursing.tableStatus')}</th>
                            <th className="px-4 py-3 text-center">{t('docNursing.tableAction')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {(mar.medications ?? []).flatMap((med, medIdx) => {
                            const doses = med.doses ?? [];
                            if (doses.length === 0) {
                              return (
                                <tr key={`${medIdx}-none`} className="hover:bg-surface-sunken">
                                  <td className="px-4 py-3 font-medium">{med.medication_name}</td>
                                  <td className="px-4 py-3">{med.dose}</td>
                                  <td className="px-4 py-3">{med.route}</td>
                                  <td className="px-4 py-3">{med.frequency}</td>
                                  <td className="px-4 py-3 text-center text-content-muted" colSpan={2}>
                                    No recorded administrations for this medicine
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <button
                                      type="button"
                                      onClick={() => navigate(`/mar?patientId=${encodeURIComponent(mar.patient_id)}`)}
                                      className="px-3 py-1 border border-border-interactive rounded text-sm hover:bg-surface-sunken"
                                    >
                                      Open eMAR
                                    </button>
                                  </td>
                                </tr>
                              );
                            }
                            return doses.map((dose, doseIdx) => (
                              <tr key={`${medIdx}-${doseIdx}`} className="hover:bg-surface-sunken">
                                {doseIdx === 0 && (
                                  <>
                                    <td className="px-4 py-3 font-medium" rowSpan={med.doses.length}>
                                      {med.medication_name}
                                    </td>
                                    <td className="px-4 py-3" rowSpan={med.doses.length}>{med.dose}</td>
                                    <td className="px-4 py-3" rowSpan={med.doses.length}>{med.route}</td>
                                    <td className="px-4 py-3" rowSpan={med.doses.length}>{med.frequency}</td>
                                  </>
                                )}
                                <td className="px-4 py-3 text-center">
                                  <Clock className="inline mr-1" size={14} />
                                  {dose.scheduled_time}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(dose.status)}`}>
                                    {t(`docNursing.doseStatus_${dose.status}`)}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {dose.status === 'pending' && dose.canAdminister && (
                                    <button
                                      onClick={() => administerMedication(mar, med, dose)}
                                      disabled={saving}
                                      className="px-3 py-1 bg-ok text-ok-fg text-sm rounded hover:bg-ok disabled:opacity-50"
                                    >
                                      {t('docNursing.giveButton')}
                                    </button>
                                  )}
                                  {dose.status === 'given' && dose.administered_by && (
                                    <span className="text-xs text-content-muted">
                                      <User className="inline mr-1" size={12} />
                                      <StaffName id={dose.administered_by} />
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ));
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Intake/Output Tab */}
          {activeTab === 'io' && (
            <div className="space-y-6">
              {/* Quick Entry Form */}
              <div className="bg-surface rounded-xl shadow p-6">
                <h3 className="font-semibold text-content mb-4 flex items-center gap-2">
                  <Plus size={20} />
                  {t('docNursing.quickEntryHeading')}
                </h3>
                <div className="grid grid-cols-5 gap-4">
                  <div>
                    <PatientSelect
                      id="nursing-patient-select"
                      label={t('docNursing.selectPatientLabel')}
                      value={selectedPatient}
                      onChange={(selectedPatientId) => setSelectedPatient(selectedPatientId)}
                    />
                  </div>
                  <div>
                    <label htmlFor="nursing-entry-type" className="sr-only">{t('docNursing.entryTypeLabel')}</label>
                    <select
                      id="nursing-entry-type"
                      value={newFluidEntry.type}
                      onChange={(e) => setNewFluidEntry({ ...newFluidEntry, type: e.target.value })}
                      className="w-full px-3 py-2 border border-border-interactive rounded-lg"
                    >
                      <option value="intake">{t('docNursing.intakeOption')}</option>
                      <option value="output">{t('docNursing.outputOption')}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="nursing-fluid-type" className="sr-only">{t('docNursing.fluidTypeLabel')}</label>
                    <select
                      id="nursing-fluid-type"
                      value={newFluidEntry.fluidType}
                      onChange={(e) => setNewFluidEntry({ ...newFluidEntry, fluidType: e.target.value })}
                      className="w-full px-3 py-2 border border-border-interactive rounded-lg"
                    >
                      {newFluidEntry.type === 'intake' ? (
                      <>
                        <option value="Oral">{t('docNursing.fluidType_oral')}</option>
                        <option value="IV">{t('docNursing.fluidType_iv')}</option>
                        <option value="NG Tube">{t('docNursing.fluidType_ngTube')}</option>
                        <option value="Blood Products">{t('docNursing.fluidType_bloodProducts')}</option>
                      </>
                    ) : (
                      <>
                        <option value="Urine">{t('docNursing.fluidType_urine')}</option>
                        <option value="Emesis">{t('docNursing.fluidType_emesis')}</option>
                        <option value="Stool">{t('docNursing.fluidType_stool')}</option>
                        <option value="Drainage">{t('docNursing.fluidType_drainage')}</option>
                        <option value="Blood Loss">{t('docNursing.fluidType_bloodLoss')}</option>
                      </>
                    )}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="nursing-amount" className="sr-only">{t('docNursing.amountMlPh')}</label>
                    <input
                      id="nursing-amount"
                      type="number"
                      value={newFluidEntry.amount}
                      onChange={(e) => setNewFluidEntry({ ...newFluidEntry, amount: parseInt(e.target.value) || 0 })}
                      placeholder={t('docNursing.amountMlPh')}
                      className="w-full px-3 py-2 border border-border-interactive rounded-lg"
                      aria-label={t('docNursing.amountMlAriaLabel')}
                    />
                  </div>
                  <button
                    onClick={recordFluid}
                    disabled={saving}
                    className="px-4 py-2 bg-brand text-brand-fg rounded-lg hover:bg-brand disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                    {t('docNursing.recordButton')}
                  </button>
                </div>
              </div>

              {/* I/O Records */}
              {ioRecords.length === 0 ? (
                <div className="bg-surface rounded-xl shadow p-8 text-center">
                  <Droplets className="mx-auto mb-4 text-gray-300" size={48} />
                  <p className="text-content-muted">{t('docNursing.noIoRecords')}</p>
                </div>
              ) : (
                ioRecords.map((record) => (
                  <div key={record.io_id} className="bg-surface rounded-xl shadow overflow-hidden">
                    <div className="p-4 bg-surface-sunken border-b flex justify-between items-center">
                      <div>
                        <h3 className="font-semibold text-content">{record.patient_name}</h3>
                        <p className="text-sm text-content-muted">
                          {t('docNursing.dateShiftLine', { date: record.date, shift: t(`docNursing.shift_${record.shift}`) })}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm text-content-muted">{t('docNursing.balanceLabel')}</p>
                          <div className="flex items-center gap-1">
                            {getBalanceIcon(record.fluid_balance)}
                            <span className={`font-bold ${
                              record.fluid_balance > 0 ? 'text-ok-subtle-fg' : 
                              record.fluid_balance < 0 ? 'text-critical-subtle-fg' : 'text-content-muted'
                            }`}>
                              {record.fluid_balance > 0 ? '+' : ''}{record.fluid_balance} mL
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 divide-x">
                      {/* Intake */}
                      <div className="p-4">
                        <h4 className="font-medium text-ok-subtle-fg mb-3 flex items-center gap-2">
                          <TrendingUp size={16} />
                          {t('docNursing.intakeTotalLine', { total: record.total_intake })}
                        </h4>
                        <div className="space-y-2">
                          {(record.intake ?? []).map((entry, idx) => (
                            <div key={idx} className="flex justify-between text-sm">
                              <span>{entry.time.split('T')[1]?.substring(0, 5)} - {entry.type}</span>
                              <span className="font-medium">{entry.amount_ml} mL</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* Output */}
                      <div className="p-4">
                        <h4 className="font-medium text-critical-subtle-fg mb-3 flex items-center gap-2">
                          <TrendingDown size={16} />
                          {t('docNursing.outputTotalLine', { total: record.total_output })}
                        </h4>
                        <div className="space-y-2">
                          {(record.output ?? []).map((entry, idx) => (
                            <div key={idx} className="flex justify-between text-sm">
                              <span>{entry.time.split('T')[1]?.substring(0, 5)} - {entry.type}</span>
                              <span className="font-medium">{entry.amount_ml} mL</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Care Plans Tab */}
          {activeTab === 'careplan' && (
            <div className="space-y-6">
              {carePlans.length === 0 ? (
                <div className="bg-surface rounded-xl shadow p-8 text-center">
                  <ClipboardList className="mx-auto mb-4 text-gray-300" size={48} />
                  <p className="text-content-muted">{t('docNursing.noCarePlans')}</p>
                </div>
              ) : (
                carePlans.map((plan) => (
                  <div key={plan.plan_id} className="bg-surface rounded-xl shadow overflow-hidden">
                    <div className="p-4 bg-surface-sunken border-b">
                      <h3 className="font-semibold text-content">{plan.patient_name}</h3>
                      <p className="text-sm text-content-muted">{t('docNursing.lastUpdatedLine', { date: plan.last_updated })}</p>
                    </div>
                    <div className="p-4 space-y-4">
                      {/* Diagnoses */}
                      <div>
                        <h4 className="font-medium text-content-secondary mb-2">{t('docNursing.nursingDiagnosesHeading')}</h4>
                        {plan.diagnoses.map((dx, idx) => (
                          <div key={idx} className="ml-4 p-3 bg-notice-subtle rounded-lg mb-2">
                            <p className="font-medium text-notice-subtle-fg">{dx.diagnosis}</p>
                            <p className="text-sm text-notice-subtle-fg">{t('docNursing.relatedToLine', { text: dx.related_to })}</p>
                            <p className="text-sm text-notice-subtle-fg">
                              {t('docNursing.aebLine', { list: dx.evidenced_by.join(', ') })}
                            </p>
                          </div>
                        ))}
                      </div>
                      {/* Interventions */}
                      <div>
                        <h4 className="font-medium text-content-secondary mb-2">{t('docNursing.interventionsHeading')}</h4>
                        <div className="ml-4 space-y-2">
                          {plan.interventions.map((int, idx) => (
                            <div key={idx} className="flex items-center justify-between p-2 bg-surface-sunken rounded">
                              <div>
                                <p className="text-sm">{int.intervention}</p>
                                <p className="text-xs text-content-muted">{int.frequency}</p>
                              </div>
                              <span className={`px-2 py-1 rounded text-xs ${
                                int.status === 'active' ? 'bg-ok-subtle text-ok-subtle-fg' :
                                int.status === 'completed' ? 'bg-notice-subtle text-notice-subtle-fg' :
                                'bg-surface-sunken text-content-secondary'
                              }`}>
                                {t(`docNursing.interventionStatus_${int.status}`)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* Outcomes */}
                      <div>
                        <h4 className="font-medium text-content-secondary mb-2">{t('docNursing.expectedOutcomesHeading')}</h4>
                        <div className="ml-4 space-y-2">
                          {plan.outcomes.map((out, idx) => (
                            <div key={idx} className="p-2 bg-surface-sunken rounded">
                              <div className="flex justify-between items-start">
                                <p className="text-sm">{out.outcome}</p>
                                <span className={`px-2 py-1 rounded text-xs ${
                                  out.status === 'met' ? 'bg-ok-subtle text-ok-subtle-fg' :
                                  out.status === 'partially_met' ? 'bg-caution-subtle text-caution-subtle-fg' :
                                  'bg-critical-subtle text-critical-subtle-fg'
                                }`}>
                                  {t(`docNursing.outcomeStatus_${out.status}`)}
                                </span>
                              </div>
                              <p className="text-xs text-content-muted">{t('docNursing.targetLine', { date: out.target_date })}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default NursingPage;
